import json
import logging
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class MonitorController:
    """Sends playback commands to the monitor page via WebSocket."""

    def __init__(self) -> None:
        self._monitors: dict[str, Optional[WebSocket]] = {"in": None, "out": None}
        self._active_mode: str = "out"  # "in" or "out"
        self._status: dict = {
            "playing": False,
            "title": "",
            "url": "",
            "volume": 50,
            "muted": False,
            "duration": 0.0,
            "position": 0.0,
        }

    @property
    def connected(self) -> bool:
        return self._monitors.get(self._active_mode) is not None

    @property
    def in_connected(self) -> bool:
        return self._monitors.get("in") is not None

    @property
    def out_connected(self) -> bool:
        return self._monitors.get("out") is not None

    @property
    def status(self) -> dict:
        return self._status

    async def set_active_mode(self, mode: str) -> None:
        old_mode = self._active_mode
        if old_mode == mode:
            return
        self._active_mode = mode
        logger.info("Monitor switch: %s → %s", old_mode, mode)

        url = self._status.get("url", "")
        title = self._status.get("title", "")
        position = self._status.get("position", 0.0)
        volume = self._status.get("volume", 50)
        was_playing = self._status.get("playing", False)

        # 1) Stop old monitor, show standby on external if going to inapp
        await self._send_to(old_mode, {"action": "PAUSE"})
        if old_mode == "out":
            await self._send_to("out", {"action": "SET_MODE", "mode": "in"})
        elif old_mode == "in":
            await self._send_to("out", {"action": "SET_MODE", "mode": "out"})

        # 2) If there's media playing, hand it off to the new monitor
        if url:
            await self._send_to(mode, {"action": "OPEN_URL", "url": url, "title": title})
            await self._send_to(mode, {"action": "SET_VOLUME", "value": volume})
            if position > 1:
                await self._send_to(mode, {"action": "SEEK_TO", "value": position})
            if not was_playing:
                await self._send_to(mode, {"action": "PAUSE"})

    async def _send_to(self, target: str, command: dict) -> None:
        """Send command to a specific monitor slot."""
        ws = self._monitors.get(target)
        if not ws:
            return
        try:
            await ws.send_text(json.dumps(command, ensure_ascii=False))
        except Exception as e:
            logger.error("Failed to send to monitor %s: %s", target, e)
            self._monitors[target] = None

    async def register(self, ws: WebSocket, mode: str = "out") -> None:
        self._monitors[mode] = ws
        logger.info("Monitor connected: %s", mode)

    async def unregister(self, mode: str = "out") -> None:
        self._monitors[mode] = None
        logger.info("Monitor disconnected: %s", mode)

    async def _send(self, command: dict) -> None:
        ws = self._monitors.get(self._active_mode)
        if not ws:
            logger.warning("No monitor connected (mode=%s), command dropped: %s", self._active_mode, command)
            return
        try:
            await ws.send_text(json.dumps(command, ensure_ascii=False))
        except Exception as e:
            logger.error("Failed to send to monitor: %s", e)
            self._monitors[self._active_mode] = None

    def update_status(self, data: dict) -> None:
        self._status["playing"] = data.get("playing", False)
        self._status["duration"] = data.get("duration", 0.0)
        self._status["position"] = data.get("position", 0.0)
        self._status["volume"] = data.get("volume", self._status["volume"])
        self._status["muted"] = data.get("muted", False)
        if data.get("url"):
            self._status["url"] = data["url"]
        if data.get("title"):
            self._status["title"] = data["title"]

    async def open_url(self, url: str, title: str = "", platform: str = "") -> None:
        logger.info("Opening on monitor: %s (%s) platform=%s", title, url[:80], platform)
        cmd = {"action": "OPEN_URL", "url": url, "title": title}
        if platform:
            cmd["platform"] = platform
        await self._send(cmd)
        self._status["playing"] = True
        self._status["title"] = title
        self._status["url"] = url

    async def play(self) -> None:
        await self._send({"action": "PLAY"})
        self._status["playing"] = True

    async def pause(self) -> None:
        await self._send({"action": "PAUSE"})
        self._status["playing"] = False

    async def stop(self) -> None:
        await self._send({"action": "STOP"})
        self._status["playing"] = False
        self._status["title"] = ""
        self._status["url"] = ""
        self._status["duration"] = 0.0
        self._status["position"] = 0.0

    async def seek_forward(self, seconds: int = 10) -> None:
        await self._send({"action": "SEEK_FORWARD", "value": seconds})

    async def seek_backward(self, seconds: int = 10) -> None:
        await self._send({"action": "SEEK_BACKWARD", "value": seconds})

    async def seek_to(self, position: float = 0) -> None:
        await self._send({"action": "SEEK_TO", "value": position})

    async def volume_up(self, amount: int = 10) -> None:
        await self._send({"action": "VOLUME_UP", "value": amount})

    async def volume_down(self, amount: int = 10) -> None:
        await self._send({"action": "VOLUME_DOWN", "value": amount})

    async def mute(self) -> None:
        await self._send({"action": "MUTE"})

    async def unmute(self) -> None:
        await self._send({"action": "UNMUTE"})

    async def set_volume(self, volume: int) -> None:
        vol = max(0, min(100, volume))
        await self._send({"action": "SET_VOLUME", "value": vol})
        self._status["volume"] = vol
        if vol == 0:
            self._status["muted"] = True
        else:
            self._status["muted"] = False


monitor = MonitorController()
