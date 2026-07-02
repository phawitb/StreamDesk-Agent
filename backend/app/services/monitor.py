import json
import logging
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class MonitorController:
    """Per-user monitor controller with in/out slots."""

    def __init__(self) -> None:
        self._monitors: dict[str, Optional[WebSocket]] = {"in": None, "out": None}
        self._active_mode: str = "out"
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

        # Pause old monitor (don't stop — keep video loaded)
        was_playing = self._status.get("playing", False)
        await self._send_to(old_mode, {"action": "PAUSE"})

        # Update external monitor standby state
        if mode == "in":
            await self._send_to("out", {"action": "SET_MODE", "mode": "in"})
        else:
            await self._send_to("out", {"action": "SET_MODE", "mode": "out"})

        # Resume on new monitor if media was loaded
        if self._status.get("url"):
            await self._send_to(mode, {
                "action": "OPEN_URL",
                "url": self._status["url"],
                "title": self._status.get("title", ""),
            })
            if self._status.get("position", 0) > 0:
                await self._send_to(mode, {
                    "action": "SEEK_TO",
                    "value": self._status["position"],
                })
            if not was_playing:
                await self._send_to(mode, {"action": "PAUSE"})

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

    async def _send_to(self, target: str, command: dict) -> None:
        ws = self._monitors.get(target)
        if not ws:
            return
        try:
            await ws.send_text(json.dumps(command, ensure_ascii=False))
        except Exception as e:
            logger.error("Failed to send to monitor %s: %s", target, e)
            self._monitors[target] = None

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

    async def open_url(self, url: str, title: str = "", platform: str = "", start_time: float = 0) -> None:
        logger.info("Opening on monitor: %s (%s) platform=%s start=%.0f", title, url[:80], platform, start_time)
        cmd = {"action": "OPEN_URL", "url": url, "title": title}
        if platform:
            cmd["platform"] = platform
        if start_time > 0:
            cmd["start_time"] = start_time
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
        self._status["muted"] = vol == 0


class MonitorManager:
    """Manages per-user MonitorControllers and device connections."""

    def __init__(self) -> None:
        self._controllers: dict[int, MonitorController] = {}
        self._device_connections: dict[str, WebSocket] = {}  # device_key -> ws
        self._user_device: dict[int, str] = {}  # user_id -> device_key
        self._device_user: dict[str, int] = {}  # device_key -> user_id (reverse)

    def get(self, user_id: int) -> MonitorController:
        if user_id not in self._controllers:
            self._controllers[user_id] = MonitorController()
        return self._controllers[user_id]

    async def register(self, ws: WebSocket, user_id: int, mode: str = "out") -> None:
        ctrl = self.get(user_id)
        await ctrl.register(ws, mode)

    async def unregister(self, user_id: int, mode: str = "out") -> None:
        ctrl = self.get(user_id)
        await ctrl.unregister(mode)

    # ── Device management ──

    async def register_device(self, ws: WebSocket, device_key: str) -> None:
        """A monitor device connected."""
        self._device_connections[device_key] = ws
        logger.info("Device connected: %s", device_key[:8])
        # If a user is paired to this device, wire it in
        user_id = self._device_user.get(device_key)
        if user_id is not None:
            ctrl = self.get(user_id)
            await ctrl.register(ws, "out")

    async def unregister_device(self, device_key: str) -> None:
        """A monitor device disconnected."""
        self._device_connections.pop(device_key, None)
        logger.info("Device disconnected: %s", device_key[:8])
        # If a user is paired, clear the out slot
        user_id = self._device_user.get(device_key)
        if user_id is not None:
            ctrl = self.get(user_id)
            await ctrl.unregister("out")

    async def pair_user(self, user_id: int, device_key: str) -> None:
        """Pair a user to a device. Last-wins if device already paired."""
        # Unpair this user from any previous device
        await self.unpair_user(user_id)
        # Unpair any other user from this device
        old_user = self._device_user.get(device_key)
        if old_user is not None and old_user != user_id:
            self._user_device.pop(old_user, None)
            old_ctrl = self.get(old_user)
            await old_ctrl.unregister("out")
            logger.info("Unpaired user %d from device %s (taken by user %d)", old_user, device_key[:8], user_id)
        # Set pairing
        self._user_device[user_id] = device_key
        self._device_user[device_key] = user_id
        logger.info("Paired user %d to device %s", user_id, device_key[:8])
        # Wire device ws if connected
        ws = self._device_connections.get(device_key)
        if ws:
            ctrl = self.get(user_id)
            await ctrl.register(ws, "out")

    async def unpair_user(self, user_id: int) -> None:
        """Unpair a user from their device."""
        device_key = self._user_device.pop(user_id, None)
        if device_key:
            self._device_user.pop(device_key, None)
            ctrl = self.get(user_id)
            await ctrl.unregister("out")
            logger.info("Unpaired user %d from device %s", user_id, device_key[:8])

    def get_device_key_for_user(self, user_id: int) -> Optional[str]:
        return self._user_device.get(user_id)

    def get_user_for_device(self, device_key: str) -> Optional[int]:
        return self._device_user.get(device_key)

    def is_device_connected(self, device_key: str) -> bool:
        return device_key in self._device_connections


monitor_manager = MonitorManager()
