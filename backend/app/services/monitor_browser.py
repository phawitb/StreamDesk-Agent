"""Opens the /monitorout page in Chrome with autoplay-policy disabled."""

import asyncio
import logging
import os
import platform
import shutil
import tempfile

from app.config import settings

logger = logging.getLogger(__name__)

_chrome_proc = None
_user_data_dir = None


async def open_monitor():
    """Launch Chrome in fullscreen app mode for the external monitor."""
    global _chrome_proc, _user_data_dir

    # Close existing instance first
    await close_monitor()

    url = f"http://localhost:{settings.port}/monitorout"

    chrome_path = _find_chrome()
    if not chrome_path:
        logger.warning("Chrome not found — open %s manually", url)
        return

    # Separate user-data-dir so flags work even if Chrome is already running
    _user_data_dir = tempfile.mkdtemp(prefix="streamdesk-monitor-")

    cmd = [
        chrome_path,
        f"--user-data-dir={_user_data_dir}",
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check",
        "--start-fullscreen",
        f"--app={url}",
    ]

    try:
        _chrome_proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        logger.info("Monitor Chrome opened fullscreen: %s (pid=%d)", url, _chrome_proc.pid)
    except Exception as e:
        logger.warning("Failed to open Chrome: %s — open %s manually", e, url)


async def close_monitor():
    """Close the monitor Chrome instance."""
    global _chrome_proc, _user_data_dir
    if _chrome_proc:
        try:
            _chrome_proc.terminate()
            await asyncio.wait_for(_chrome_proc.wait(), timeout=5)
        except Exception:
            try:
                _chrome_proc.kill()
            except Exception:
                pass
        _chrome_proc = None
        logger.info("Monitor Chrome closed")

    # Clean up temp user data dir
    if _user_data_dir:
        try:
            shutil.rmtree(_user_data_dir, ignore_errors=True)
        except Exception:
            pass
        _user_data_dir = None


def is_open() -> bool:
    """Check if the monitor browser is currently running."""
    return _chrome_proc is not None and _chrome_proc.returncode is None


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
