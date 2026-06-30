"""Opens the /monitor page in Chrome with autoplay-policy disabled."""

import asyncio
import logging
import os
import platform
import shutil
import tempfile

from app.config import settings

logger = logging.getLogger(__name__)

_chrome_proc = None


async def open_monitor():
    """Launch Chrome with --autoplay-policy=no-user-gesture-required."""
    global _chrome_proc
    url = f"http://localhost:{settings.port}/monitor"

    chrome_path = _find_chrome()
    if not chrome_path:
        logger.warning("Chrome not found — open %s manually", url)
        return

    # Separate user-data-dir so flags work even if Chrome is already running
    user_data = tempfile.mkdtemp(prefix="streamdesk-monitor-")

    cmd = [
        chrome_path,
        f"--user-data-dir={user_data}",
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check",
        f"--app={url}",
    ]

    try:
        _chrome_proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        logger.info("Monitor Chrome opened: %s (pid=%d)", url, _chrome_proc.pid)
    except Exception as e:
        logger.warning("Failed to open Chrome: %s — open %s manually", e, url)


async def close_monitor():
    global _chrome_proc
    if _chrome_proc:
        try:
            _chrome_proc.terminate()
        except Exception:
            pass
        _chrome_proc = None


def _find_chrome() -> str | None:
    system = platform.system()
    if system == "Darwin":
        paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
        for p in paths:
            if os.path.exists(p):
                return p
    elif system == "Linux":
        for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]:
            p = shutil.which(name)
            if p:
                return p
    elif system == "Windows":
        for p in [
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        ]:
            if os.path.exists(p):
                return p
    return None
