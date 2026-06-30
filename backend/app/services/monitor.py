import json
import logging
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class MonitorController:
    """Sends playback commands to the /monitor page via WebSocket."""

    def __init__(self) -> None:
        self._monitor: Optional[WebSocket] = None
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
        return self._monitor is not None

    @property
    def status(self) -> dict:
        return self._status

    async def register(self, ws: WebSocket) -> None:
        self._monitor = ws
        logger.info("Monitor connected")

    async def unregister(self) -> None:
        self._monitor = None
        logger.info("Monitor disconnected")

    async def _send(self, command: dict) -> None:
        if not self._monitor:
            logger.warning("No monitor connected, command dropped: %s", command)
            return
        try:
            await self._monitor.send_text(json.dumps(command, ensure_ascii=False))
        except Exception as e:
            logger.error("Failed to send to monitor: %s", e)
            self._monitor = None

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

    async def open_url(self, url: str, title: str = "") -> None:
        logger.info("Opening on monitor: %s (%s)", title, url[:80])
        await self._send({"action": "OPEN_URL", "url": url, "title": title})
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


monitor = MonitorController()
