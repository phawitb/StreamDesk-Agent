import asyncio
import json
import logging
import math
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from app.schemas.messages import (
    AgentState,
    StatusMessage,
    ChatMessage,
    ErrorMessage,
)
from app.services.agent_manager import agent_manager
from app.services.monitor import monitor
from app.services.scraper import scrape_movies, scrape_categories, sync_all_movies
from app.services.gemini_chat import recommend_movies
from app.services.database import upsert_movies

logger = logging.getLogger(__name__)
router = APIRouter()

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"

# Store active WebSocket connections
_connections: list[WebSocket] = []


def _sanitize_floats(obj: dict) -> dict:
    """Replace NaN/Infinity with 0 so JSON.parse won't fail on the client."""
    return {
        k: (0 if isinstance(v, float) and (math.isnan(v) or math.isinf(v)) else v)
        for k, v in obj.items()
    }


async def broadcast(message: dict):
    """Send a message to all connected WebSocket clients."""
    data = json.dumps(message, ensure_ascii=False)
    disconnected = []
    for ws in _connections:
        try:
            await ws.send_text(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        _connections.remove(ws)


async def status_callback(state: str, message: str):
    """Called by agent_manager to report status changes."""
    msg = StatusMessage(state=AgentState(state), message=message)
    await broadcast(msg.model_dump())


@router.get("/health")
async def health():
    return {"status": "ok", "monitor_connected": monitor.connected}


# ── Monitor pages ──

@router.get("/monitorin", response_class=HTMLResponse)
async def monitor_in_page():
    """Serve the in-app monitor page."""
    html_path = TEMPLATES_DIR / "monitor.html"
    html = html_path.read_text(encoding="utf-8")
    html = html.replace("/ws/monitor", "/ws/monitorin")
    return HTMLResponse(html)


@router.get("/monitorout", response_class=HTMLResponse)
async def monitor_out_page():
    """Serve the external monitor page."""
    html_path = TEMPLATES_DIR / "monitor.html"
    html = html_path.read_text(encoding="utf-8")
    html = html.replace("/ws/monitor", "/ws/monitorout")
    return HTMLResponse(html)


@router.websocket("/ws/monitorin")
async def ws_monitor_in(ws: WebSocket):
    """WebSocket for in-app monitor."""
    await ws.accept()
    await monitor.register(ws, "in")
    await broadcast({"type": "monitor_status", "in_connected": monitor.in_connected, "out_connected": monitor.out_connected})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                if data.get("type") == "status":
                    monitor.update_status(data)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await monitor.unregister("in")
        await broadcast({"type": "monitor_status", "in_connected": monitor.in_connected, "out_connected": monitor.out_connected})


@router.websocket("/ws/monitorout")
async def ws_monitor_out(ws: WebSocket):
    """WebSocket for external monitor."""
    await ws.accept()
    await monitor.register(ws, "out")
    await broadcast({"type": "monitor_status", "in_connected": monitor.in_connected, "out_connected": monitor.out_connected})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                if data.get("type") == "status":
                    monitor.update_status(data)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await monitor.unregister("out")
        await broadcast({"type": "monitor_status", "in_connected": monitor.in_connected, "out_connected": monitor.out_connected})


# ── Movie API ──

@router.get("/api/settings")
async def get_settings():
    """Get current app settings."""
    from app.config import settings
    return {"headless": settings.headless}


@router.patch("/api/settings")
async def update_settings(body: dict):
    """Update app settings (headless, etc.)."""
    from app.config import settings
    if "headless" in body:
        settings.headless = bool(body["headless"])
        logger.info("Headless mode set to %s", settings.headless)
    if "monitor_mode" in body:
        mode = "in" if body["monitor_mode"] == "inapp" else "out"
        await monitor.set_active_mode(mode)
        logger.info("Monitor mode set to %s", mode)
    return {"headless": settings.headless}


@router.get("/api/movies")
async def list_movies(page: int = 1, category: str = ""):
    """Scrape movie listings from 24hd.net, optionally filtered by category slug."""
    result = await scrape_movies(page, category)
    # Save to DB in background
    if result.get("movies"):
        movies_for_db = []
        for m in result["movies"]:
            m_copy = dict(m)
            m_copy.setdefault("genres", "")
            m_copy.setdefault("plot", "")
            m_copy.setdefault("year", "")
            movies_for_db.append(m_copy)
        asyncio.create_task(_save_movies_bg(movies_for_db))
    return result


async def _save_movies_bg(movies: list[dict]):
    try:
        await upsert_movies(movies)
    except Exception as e:
        logger.warning("Failed to save movies to DB: %s", e)


@router.get("/api/categories")
async def list_categories():
    """Get genre/category list."""
    return await scrape_categories()


@router.get("/api/recent")
async def recent_movies_api(limit: int = 20):
    """Get recently added movies from DB."""
    from app.services.database import get_recent_movies
    return await get_recent_movies(limit=limit)


@router.get("/api/search")
async def search_movies_api(q: str = "", limit: int = 8):
    """Search movies in local DB by title (real-time autocomplete)."""
    from app.services.database import search_movies
    if not q.strip():
        return []
    results = await search_movies(q.strip(), limit=limit)
    return results


@router.post("/api/sync")
async def sync_movies():
    """Trigger full sync — all pages, all categories. Runs in background."""
    async def _run_sync():
        try:
            total = await sync_all_movies(callback=status_callback_sync)
            logger.info("Full sync complete: %d", total)
        except Exception as e:
            logger.error("Sync failed: %s", e)
            await broadcast(ChatMessage(content=f"Sync failed: {e}").model_dump())

    async def status_callback_sync(msg: str):
        await broadcast(ChatMessage(content=msg).model_dump())

    asyncio.create_task(_run_sync())
    return {"status": "syncing"}


# ── Chat / Recommendation ──

async def _handle_recommendation(query: str):
    """Run Gemini recommendation and broadcast results."""
    try:
        await broadcast(ChatMessage(
            content="กำลังค้นหาหนังที่เกี่ยวข้อง..."
        ).model_dump())

        result = await recommend_movies(query)
        if result:
            await broadcast({
                "type": "movie_recommendations",
                "message": result.get("message", ""),
                "movies": result.get("movies", []),
            })
        else:
            await broadcast(ChatMessage(
                content="ไม่พบหนังที่ตรงกับคำค้นหา"
            ).model_dump())
    except Exception as e:
        logger.error("Recommendation error: %s", e)
        await broadcast(ChatMessage(
            content=f"เกิดข้อผิดพลาดในการค้นหา: {e}"
        ).model_dump())


# ── Main WebSocket ──

@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _connections.append(ws)
    logger.info("WebSocket connected (total: %d)", len(_connections))

    # Set up callbacks
    agent_manager.set_status_callback(status_callback)

    async def episode_callback(episodes: list[dict]):
        await broadcast({"type": "episode_list", "episodes": episodes})

    agent_manager.set_episode_callback(episode_callback)

    # Send initial status
    await ws.send_text(json.dumps(
        StatusMessage(state=AgentState.IDLE, message="พร้อมรับคำสั่ง").model_dump(),
        ensure_ascii=False,
    ))
    # Send current monitor connection status
    await ws.send_text(json.dumps(
        {"type": "monitor_status", "in_connected": monitor.in_connected, "out_connected": monitor.out_connected},
        ensure_ascii=False,
    ))

    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "play_request":
                url = msg.get("url", "")
                query = msg.get("query", "")

                if url:
                    # Direct URL → play immediately
                    await broadcast(ChatMessage(
                        content=f"รับคำสั่งแล้ว กำลังเปิด: {url}"
                    ).model_dump())
                    asyncio.create_task(agent_manager.play(url))
                elif query:
                    # Text query → ask Gemini for recommendations
                    asyncio.create_task(_handle_recommendation(query))
                else:
                    await ws.send_text(json.dumps(
                        ErrorMessage(message="กรุณาระบุ URL หรือชื่อหนัง").model_dump(),
                        ensure_ascii=False,
                    ))

            elif msg.get("type") == "command":
                action = msg.get("action")
                if action == "reset":
                    asyncio.create_task(agent_manager.reset())
                elif action == "stop":
                    await agent_manager.stop_playback()
                    await monitor.stop()
                elif action == "download":
                    await broadcast(ChatMessage(
                        content="เริ่มดาวน์โหลด..."
                    ).model_dump())
                    asyncio.create_task(agent_manager.download())
                elif action in ("pause", "resume", "seek_forward", "seek_backward", "seek_to"):
                    value = float(msg.get("value", 0))
                    # Route media controls through monitor
                    if action == "pause":
                        await monitor.pause()
                    elif action == "resume":
                        await monitor.play()
                    elif action == "seek_forward":
                        await monitor.seek_forward(int(value) or 10)
                    elif action == "seek_backward":
                        await monitor.seek_backward(int(value) or 10)
                    elif action == "seek_to":
                        await monitor.seek_to(value)

            elif msg.get("type") == "select_episode":
                index = int(msg.get("index", 0))
                agent_manager.select_episode(index)

            elif msg.get("type") == "media_control":
                action = msg.get("action", "")
                value = float(msg.get("value") or 0)
                if action == "get_status":
                    async def _send_status(target_ws=ws):
                        try:
                            status = monitor.status
                            if target_ws.client_state.name == "CONNECTED":
                                await target_ws.send_text(json.dumps(
                                    {"type": "media_status", **_sanitize_floats({
                                        "currentTime": status.get("position", 0),
                                        "duration": status.get("duration", 0),
                                        "paused": not status.get("playing", False),
                                        "volume": status.get("volume", 50),
                                        "muted": status.get("muted", False),
                                    })},
                                    ensure_ascii=False,
                                ))
                        except Exception:
                            pass
                    asyncio.create_task(_send_status())
                elif action == "pause":
                    await monitor.pause()
                elif action == "resume":
                    await monitor.play()
                elif action == "seek_forward":
                    await monitor.seek_forward(int(value) or 10)
                elif action == "seek_backward":
                    await monitor.seek_backward(int(value) or 10)
                elif action == "seek_to":
                    await monitor.seek_to(value)
                elif action == "volume_up":
                    await monitor.volume_up(int(value) or 10)
                elif action == "volume_down":
                    await monitor.volume_down(int(value) or 10)
                elif action == "set_volume":
                    await monitor.set_volume(int(value))
                elif action == "mute":
                    await monitor.mute()
                elif action == "unmute":
                    await monitor.unmute()

    except WebSocketDisconnect:
        if ws in _connections:
            _connections.remove(ws)
        logger.info("WebSocket disconnected (total: %d)", len(_connections))
    except Exception as e:
        logger.exception("WebSocket error")
        if ws in _connections:
            _connections.remove(ws)
