import asyncio
import json
import logging
import math
from pathlib import Path

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

from app.schemas.messages import (
    AgentState,
    StatusMessage,
    ChatMessage,
    ErrorMessage,
)
from app.services.agent_manager import agent_manager
from app.services.monitor import monitor_manager
from app.services.scraper import scrape_movies, scrape_categories, sync_all_movies
from app.services.gemini_chat import recommend_movies
from app.services.database import (
    upsert_movies, get_user_by_id, get_user_by_monitor_token, log_watch,
    get_app_setting, set_app_setting, get_all_watch_history,
)

logger = logging.getLogger(__name__)
router = APIRouter()

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
ADMIN_EMAIL = "phawit.boo@gmail.com"

# Store active WebSocket connections per user: {user_id: [ws, ...]}
_connections: dict[int, list[WebSocket]] = {}


def _sanitize_floats(obj: dict) -> dict:
    return {
        k: (0 if isinstance(v, float) and (math.isnan(v) or math.isinf(v)) else v)
        for k, v in obj.items()
    }


async def broadcast(message: dict, user_id: int | None = None):
    """Send a message to connected clients. If user_id given, only to that user."""
    data = json.dumps(message, ensure_ascii=False)
    targets = _connections.get(user_id, []) if user_id else [ws for wss in _connections.values() for ws in wss]
    disconnected = []
    for ws in targets:
        try:
            await ws.send_text(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        for uid, wss in _connections.items():
            if ws in wss:
                wss.remove(ws)


def _get_user_id(request: Request) -> int | None:
    return request.session.get("user_id")


async def status_callback(state: str, message: str):
    msg = StatusMessage(state=AgentState(state), message=message)
    await broadcast(msg.model_dump())


@router.get("/health")
async def health():
    return {"status": "ok"}


# ── Monitor pages ──

@router.get("/monitor", response_class=HTMLResponse)
async def monitor_page():
    """Serve monitor page. Use ?device_key=xxx for Raspberry Pi."""
    html_path = TEMPLATES_DIR / "monitor.html"
    html = html_path.read_text(encoding="utf-8")
    return HTMLResponse(html)


@router.get("/m/{token}", response_class=HTMLResponse)
async def monitor_url_page(token: str):
    """Per-user monitor URL (e.g. /m/vd7Sc). Open on any browser as a monitor."""
    user = await get_user_by_monitor_token(token)
    if not user:
        return HTMLResponse("<h1>Invalid monitor link</h1>", status_code=404)
    html_path = TEMPLATES_DIR / "monitor.html"
    html = html_path.read_text(encoding="utf-8")
    # Inject the token so JS connects via /ws/monitor-url/{token}
    html = html.replace(
        "const urlParams = new URLSearchParams(location.search);",
        f"const urlParams = new URLSearchParams(location.search);\n"
        f"        urlParams.set('monitor_token', '{token}');",
    )
    # No QR standby for URL monitor
    html = html.replace("let showStandbyOnIdle = true;", "let showStandbyOnIdle = false;")
    return HTMLResponse(html)


@router.get("/monitorin", response_class=HTMLResponse)
async def monitor_in_page():
    html_path = TEMPLATES_DIR / "monitor.html"
    html = html_path.read_text(encoding="utf-8")
    html = html.replace("/ws/monitor", "/ws/monitorin")
    # In-app monitor: auto-activate (no tap needed, user already interacted with app)
    html = html.replace("let userActivated = false;", "let userActivated = true;")
    html = html.replace('<div id="activate-overlay">', '<div id="activate-overlay" class="hidden">')
    # No standby screen for in-app
    html = html.replace("let showStandbyOnIdle = true;", "let showStandbyOnIdle = false;")
    return HTMLResponse(html)


@router.websocket("/ws/monitorin")
async def ws_monitor_in(ws: WebSocket):
    # Get user_id from session cookie
    user_id = ws.session.get("user_id") if hasattr(ws, "session") else None
    if not user_id:
        # Try scope session (Starlette middleware)
        user_id = ws.scope.get("session", {}).get("user_id")
    if not user_id:
        await ws.close(code=4001)
        return

    await ws.accept()
    await monitor_manager.register(ws, user_id, "in")
    ctrl = monitor_manager.get(user_id)
    await broadcast({"type": "monitor_status", "in_connected": ctrl.in_connected, "out_connected": ctrl.out_connected}, user_id)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                if data.get("type") == "status":
                    ctrl.update_status(data)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await monitor_manager.unregister(user_id, "in")
        ctrl = monitor_manager.get(user_id)
        await broadcast({"type": "monitor_status", "in_connected": ctrl.in_connected, "out_connected": ctrl.out_connected}, user_id)


@router.websocket("/ws/monitor-device/{device_key}")
async def ws_monitor_device(ws: WebSocket, device_key: str):
    """Monitor device (e.g. Raspberry Pi) connects here."""
    await ws.accept()
    await monitor_manager.register_device(ws, device_key)

    # Broadcast status if a user is paired
    user_id = monitor_manager.get_user_for_device(device_key)
    if user_id is not None:
        ctrl = monitor_manager.get(user_id)
        await broadcast({"type": "monitor_status", "in_connected": ctrl.in_connected, "out_connected": ctrl.out_connected}, user_id)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                if data.get("type") == "status":
                    uid = monitor_manager.get_user_for_device(device_key)
                    if uid is not None:
                        ctrl = monitor_manager.get(uid)
                        ctrl.update_status(data)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        # Broadcast disconnect before unregistering
        user_id = monitor_manager.get_user_for_device(device_key)
        await monitor_manager.unregister_device(device_key)
        if user_id is not None:
            ctrl = monitor_manager.get(user_id)
            await broadcast({"type": "monitor_status", "in_connected": ctrl.in_connected, "out_connected": ctrl.out_connected}, user_id)


@router.websocket("/ws/monitor-url/{token}")
async def ws_monitor_url(ws: WebSocket, token: str):
    """URL-based monitor — authenticated by per-user token."""
    user = await get_user_by_monitor_token(token)
    if not user:
        await ws.close(code=4001)
        return

    user_id = user["id"]
    await ws.accept()
    await monitor_manager.register(ws, user_id, "out")
    ctrl = monitor_manager.get(user_id)
    await broadcast({"type": "monitor_status", "in_connected": ctrl.in_connected, "out_connected": ctrl.out_connected}, user_id)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                if data.get("type") == "status":
                    ctrl.update_status(data)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await monitor_manager.unregister(user_id, "out")
        ctrl = monitor_manager.get(user_id)
        await broadcast({"type": "monitor_status", "in_connected": ctrl.in_connected, "out_connected": ctrl.out_connected}, user_id)


# ── Monitor pairing ──

@router.post("/api/monitor/pair")
async def pair_monitor(request: Request, body: dict):
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    device_key = body.get("device_key", "").strip()
    if not device_key:
        return JSONResponse({"error": "Missing device_key"}, status_code=400)
    await monitor_manager.pair_user(user_id, device_key)
    ctrl = monitor_manager.get(user_id)
    await broadcast({
        "type": "monitor_status",
        "in_connected": ctrl.in_connected,
        "out_connected": ctrl.out_connected,
        "paired_device": device_key,
    }, user_id)
    return {"ok": True, "device_key": device_key, "connected": ctrl.out_connected}


@router.post("/api/monitor/unpair")
async def unpair_monitor(request: Request):
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    await monitor_manager.unpair_user(user_id)
    ctrl = monitor_manager.get(user_id)
    await broadcast({
        "type": "monitor_status",
        "in_connected": ctrl.in_connected,
        "out_connected": ctrl.out_connected,
        "paired_device": None,
    }, user_id)
    return {"ok": True}


# ── Settings ──

@router.get("/api/settings")
async def get_settings(request: Request):
    user_id = _get_user_id(request)
    user = await get_user_by_id(user_id) if user_id else None
    paired_key = monitor_manager.get_device_key_for_user(user_id) if user_id else None
    monitor_token = user["monitor_token"] if user else None
    return {
        "paired_device_key": paired_key,
        "monitor_token": monitor_token,
    }


@router.patch("/api/settings")
async def update_settings(request: Request, body: dict):
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    ctrl = monitor_manager.get(user_id)
    if "monitor_mode" in body:
        mode = "in" if body["monitor_mode"] == "inapp" else "out"
        old_mode = ctrl._active_mode
        await ctrl.set_active_mode(mode)
        # Only reset state if mode actually changed
        if old_mode != mode:
            logger.info("Monitor mode set to %s for user %d", mode, user_id)
            msg = StatusMessage(state=AgentState.IDLE, message="เปลี่ยนจอแล้ว รอคำสั่งใหม่")
            await broadcast(msg.model_dump(), user_id)
    return {"ok": True}


# ── App Settings (global, admin-only write) ──

@router.get("/api/app-settings")
async def get_app_settings_api():
    force_install = await get_app_setting("force_install", "true")
    max_storage_gb = await get_app_setting("max_storage_gb", "10")
    return {
        "force_install": force_install == "true",
        "max_storage_gb": float(max_storage_gb),
    }


@router.patch("/api/app-settings")
async def update_app_settings_api(request: Request, body: dict):
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    user = await get_user_by_id(user_id)
    if not user or user["email"] != ADMIN_EMAIL:
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    if "force_install" in body:
        await set_app_setting("force_install", "true" if body["force_install"] else "false")
    if "max_storage_gb" in body:
        await set_app_setting("max_storage_gb", str(float(body["max_storage_gb"])))
    return {"ok": True}


# ── Admin: Watch History ──

@router.get("/api/admin/watch-history")
async def admin_watch_history(request: Request, limit: int = 200):
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    user = await get_user_by_id(user_id)
    if not user or user["email"] != ADMIN_EMAIL:
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    history = await get_all_watch_history(limit=limit)
    return history


# ── Admin: Video Storage Management ──

VIDEOS_DIR = Path(__file__).parent.parent.parent / "downloads"


@router.get("/api/admin/videos")
async def admin_list_videos(request: Request):
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    user = await get_user_by_id(user_id)
    if not user or user["email"] != ADMIN_EMAIL:
        return JSONResponse({"error": "Forbidden"}, status_code=403)

    videos = []
    total_size = 0
    if VIDEOS_DIR.exists():
        for f in sorted(VIDEOS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.is_file():
                stat = f.stat()
                total_size += stat.st_size
                videos.append({
                    "filename": f.name,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                })
    max_gb = float(await get_app_setting("max_storage_gb", "10"))
    return {"videos": videos, "total_size": total_size, "max_storage_bytes": int(max_gb * 1024 * 1024 * 1024)}


@router.delete("/api/admin/videos/{filename}")
async def admin_delete_video(request: Request, filename: str):
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    user = await get_user_by_id(user_id)
    if not user or user["email"] != ADMIN_EMAIL:
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    filepath = VIDEOS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)
    # Security: ensure path is within VIDEOS_DIR
    if not filepath.resolve().parent == VIDEOS_DIR.resolve():
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    filepath.unlink()
    return {"ok": True}


@router.delete("/api/admin/videos")
async def admin_delete_all_videos(request: Request):
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    user = await get_user_by_id(user_id)
    if not user or user["email"] != ADMIN_EMAIL:
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    deleted = 0
    if VIDEOS_DIR.exists():
        for f in VIDEOS_DIR.iterdir():
            if f.is_file():
                f.unlink()
                deleted += 1
    return {"ok": True, "deleted": deleted}


# ── Movie API ──

@router.get("/api/movies")
async def list_movies(page: int = 1, category: str = ""):
    result = await scrape_movies(page, category)
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
    return await scrape_categories()


@router.get("/api/recent")
async def recent_movies_api(limit: int = 20):
    from app.services.database import get_recent_movies
    return await get_recent_movies(limit=limit)


@router.get("/api/search")
async def search_movies_api(q: str = "", limit: int = 8):
    from app.services.database import search_movies
    if not q.strip():
        return []
    return await search_movies(q.strip(), limit=limit)


@router.post("/api/sync")
async def sync_movies():
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

async def _handle_recommendation(query: str, user_id: int | None = None):
    try:
        await broadcast(ChatMessage(content="กำลังค้นหาหนังที่เกี่ยวข้อง...").model_dump(), user_id)
        result = await recommend_movies(query)
        if result:
            await broadcast({
                "type": "movie_recommendations",
                "message": result.get("message", ""),
                "movies": result.get("movies", []),
            }, user_id)
        else:
            await broadcast(ChatMessage(content="ไม่พบหนังที่ตรงกับคำค้นหา").model_dump(), user_id)
    except Exception as e:
        logger.error("Recommendation error: %s", e)
        await broadcast(ChatMessage(content=f"เกิดข้อผิดพลาดในการค้นหา: {e}").model_dump(), user_id)


# ── Main WebSocket ──

@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    # Get user from session
    user_id = ws.scope.get("session", {}).get("user_id")
    if not user_id:
        await ws.send_text(json.dumps({"type": "error", "message": "Not authenticated"}, ensure_ascii=False))
        await ws.close(code=4001)
        return

    if user_id not in _connections:
        _connections[user_id] = []
    _connections[user_id].append(ws)
    logger.info("WebSocket connected: user=%d (total: %d)", user_id, len(_connections[user_id]))

    ctrl = monitor_manager.get(user_id)

    # Set up callbacks scoped to this user
    async def user_status_callback(state: str, message: str):
        msg = StatusMessage(state=AgentState(state), message=message)
        await broadcast(msg.model_dump(), user_id)

    agent_manager.set_user(user_id)
    agent_manager.set_status_callback(user_status_callback)

    async def episode_callback(episodes: list[dict]):
        await broadcast({"type": "episode_list", "episodes": episodes}, user_id)

    agent_manager.set_episode_callback(episode_callback)

    # Send initial status — restore current playback state if media is loaded
    status = ctrl.status
    if status.get("url"):
        is_playing = status.get("playing", False)
        title = status.get("title", "")
        msg_text = f"กำลังเล่น: {title}" if is_playing else f"หยุดชั่วคราว: {title}"
        await ws.send_text(json.dumps(
            StatusMessage(
                state=AgentState.PLAYING,
                message=msg_text,
                title=title,
                url=status.get("url"),
            ).model_dump(),
            ensure_ascii=False,
        ))
        # Send current media position so controls can resume immediately
        await ws.send_text(json.dumps(
            {"type": "media_status", **_sanitize_floats({
                "currentTime": status.get("position", 0),
                "duration": status.get("duration", 0),
                "paused": not is_playing,
                "volume": status.get("volume", 50),
                "muted": status.get("muted", False),
            })},
            ensure_ascii=False,
        ))
    else:
        await ws.send_text(json.dumps(
            StatusMessage(state=AgentState.IDLE, message="พร้อมรับคำสั่ง").model_dump(),
            ensure_ascii=False,
        ))
    paired_key = monitor_manager.get_device_key_for_user(user_id)
    await ws.send_text(json.dumps(
        {"type": "monitor_status", "in_connected": ctrl.in_connected, "out_connected": ctrl.out_connected, "paired_device": paired_key},
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
                    await broadcast(ChatMessage(content=f"รับคำสั่งแล้ว กำลังเปิด: {url}").model_dump(), user_id)
                    # Log watch history
                    user = await get_user_by_id(user_id)
                    if user:
                        asyncio.create_task(log_watch(user["email"], url))
                    asyncio.create_task(agent_manager.play(url))
                elif query:
                    asyncio.create_task(_handle_recommendation(query, user_id))
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
                    await ctrl.stop()
                elif action == "download":
                    await broadcast(ChatMessage(content="เริ่มดาวน์โหลด...").model_dump(), user_id)
                    asyncio.create_task(agent_manager.download())
                elif action in ("pause", "resume", "seek_forward", "seek_backward", "seek_to"):
                    value = float(msg.get("value", 0))
                    if action == "pause":
                        await ctrl.pause()
                    elif action == "resume":
                        await ctrl.play()
                    elif action == "seek_forward":
                        await ctrl.seek_forward(int(value) or 10)
                    elif action == "seek_backward":
                        await ctrl.seek_backward(int(value) or 10)
                    elif action == "seek_to":
                        await ctrl.seek_to(value)

            elif msg.get("type") == "select_episode":
                index = int(msg.get("index", 0))
                agent_manager.select_episode(index)

            elif msg.get("type") == "media_control":
                action = msg.get("action", "")
                value = float(msg.get("value") or 0)
                if action == "get_status":
                    async def _send_status(target_ws=ws):
                        try:
                            status = ctrl.status
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
                    await ctrl.pause()
                elif action == "resume":
                    await ctrl.play()
                elif action == "seek_forward":
                    await ctrl.seek_forward(int(value) or 10)
                elif action == "seek_backward":
                    await ctrl.seek_backward(int(value) or 10)
                elif action == "seek_to":
                    await ctrl.seek_to(value)
                elif action == "volume_up":
                    await ctrl.volume_up(int(value) or 10)
                elif action == "volume_down":
                    await ctrl.volume_down(int(value) or 10)
                elif action == "set_volume":
                    await ctrl.set_volume(int(value))
                elif action == "mute":
                    await ctrl.mute()
                elif action == "unmute":
                    await ctrl.unmute()

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error")
    finally:
        if user_id in _connections and ws in _connections[user_id]:
            _connections[user_id].remove(ws)
            if not _connections[user_id]:
                del _connections[user_id]
        logger.info("WebSocket disconnected: user=%d", user_id)
