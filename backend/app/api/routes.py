import asyncio
import json
import logging
import math
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.schemas.messages import (
    AgentState,
    StatusMessage,
    ChatMessage,
    ErrorMessage,
)
from app.services.agent_manager import agent_manager
from app.services.scraper import scrape_movies, scrape_categories, sync_all_movies
from app.services.gemini_chat import recommend_movies
from app.services.database import upsert_movies

logger = logging.getLogger(__name__)
router = APIRouter()

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
    return {"status": "ok"}


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


@router.post("/api/sync")
async def sync_movies():
    """Trigger full sync — all pages, all categories. Runs in background."""
    async def _run_sync():
        try:
            total = await sync_all_movies(callback=status_callback_sync)
            logger.info("Full sync complete: %d", total)
        except Exception as e:
            logger.error("Sync failed: %s", e)
            await broadcast(ChatMessage(content=f"Sync ล้มเหลว: {e}").model_dump())

    async def status_callback_sync(msg: str):
        await broadcast(ChatMessage(content=msg).model_dump())

    asyncio.create_task(_run_sync())
    return {"status": "syncing"}


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
                if action == "stop":
                    await agent_manager.stop_playback()
                elif action == "download":
                    await broadcast(ChatMessage(
                        content="เริ่มดาวน์โหลด..."
                    ).model_dump())
                    asyncio.create_task(agent_manager.download())
                elif action in ("pause", "resume", "seek_forward", "seek_backward", "seek_to"):
                    value = float(msg.get("value", 0))
                    asyncio.create_task(agent_manager.media_control(action, value))

            elif msg.get("type") == "select_episode":
                index = int(msg.get("index", 0))
                agent_manager.select_episode(index)

            elif msg.get("type") == "media_control":
                action = msg.get("action", "")
                value = float(msg.get("value", 0))
                if action == "get_status":
                    # Run in background so it doesn't block the receive loop
                    async def _send_status(target_ws=ws):
                        try:
                            result = await agent_manager.media_control("get_status", 0)
                            if result and target_ws.client_state.name == "CONNECTED":
                                await target_ws.send_text(json.dumps(
                                    {"type": "media_status", **_sanitize_floats(result)},
                                    ensure_ascii=False,
                                ))
                        except Exception:
                            pass
                    asyncio.create_task(_send_status())
                else:
                    asyncio.create_task(agent_manager.media_control(action, value))

    except WebSocketDisconnect:
        _connections.remove(ws)
        logger.info("WebSocket disconnected (total: %d)", len(_connections))
    except Exception as e:
        logger.exception("WebSocket error")
        if ws in _connections:
            _connections.remove(ws)
