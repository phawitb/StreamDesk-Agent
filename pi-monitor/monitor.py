#!/usr/bin/env python3
"""
StreamDesk Monitor — Raspberry Pi launcher using Playwright.

Opens the monitor page in a real Chromium browser, clicks "Tap to activate"
to unlock autoplay, then keeps the browser open indefinitely.

Usage:
    python3 monitor.py <server_url> <device_key>

Example:
    python3 monitor.py http://192.168.1.100:8000 my-pi-living-room

Setup on Raspberry Pi:
    pip install playwright
    playwright install chromium
"""

import sys
import signal
import logging
from playwright.sync_api import sync_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("streamdesk-monitor")


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <server_url> <device_key>")
        print(f"Example: {sys.argv[0]} http://192.168.1.100:8000 my-pi-living-room")
        sys.exit(1)

    server_url = sys.argv[1].rstrip("/")
    device_key = sys.argv[2]
    monitor_url = f"{server_url}/monitor?device_key={device_key}"

    log.info("StreamDesk Monitor")
    log.info("  Server:     %s", server_url)
    log.info("  Device Key: %s", device_key)
    log.info("  URL:        %s", monitor_url)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=False,
            args=[
                "--kiosk",
                "--noerrdialogs",
                "--disable-infobars",
                "--no-first-run",
                "--disable-features=TranslateUI,MemorySaver,TabDiscarding,HighEfficiencyMode,BatterySaverModeAvailable",
                "--autoplay-policy=no-user-gesture-required",
                "--start-fullscreen",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-hang-monitor",
                "--disable-ipc-flooding-protection",
                "--memory-pressure-off",
                "--max-old-space-size=4096",
                "--disable-dev-shm-usage",
                "--disable-gpu-memory-buffer-video-frames",
                "--force-memory-pressure-notification-level-none",
            ],
        )
        context = browser.new_context(
            viewport=None,  # Use full screen size
            no_viewport=True,
            ignore_https_errors=True,
        )
        page = context.new_page()

        log.info("Opening monitor page...")
        page.goto(monitor_url, wait_until="load")

        # Click the "Tap to activate" overlay to unlock autoplay
        overlay = page.locator("#activate-overlay:not(.hidden)")
        try:
            overlay.wait_for(state="visible", timeout=5000)
            overlay.click()
            log.info("Clicked activate overlay — autoplay unlocked")
        except Exception:
            log.info("Activate overlay not visible — already activated or not needed")

        log.info("Monitor is running. Press Ctrl+C to stop.")

        # Keep the browser open — block until signal
        stop = False

        def handle_signal(sig, frame):
            nonlocal stop
            stop = True

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        # If page crashes or disconnects, reload it
        while not stop:
            try:
                page.wait_for_timeout(5000)
                # Check if WebSocket is still connected
                ws_state = page.evaluate(
                    "() => (typeof ws !== 'undefined' && ws) ? ws.readyState : -1"
                )
                if ws_state != 1:  # WebSocket.OPEN = 1
                    log.warning("WebSocket disconnected (state=%s), reloading...", ws_state)
                    page.reload(wait_until="domcontentloaded")
                    # Re-click activate overlay after reload
                    try:
                        overlay = page.locator("#activate-overlay")
                        overlay.wait_for(state="visible", timeout=3000)
                        overlay.click()
                        log.info("Re-activated after reload")
                    except Exception:
                        pass
            except KeyboardInterrupt:
                break
            except Exception as e:
                log.error("Error: %s — reloading in 5s...", e)
                try:
                    page.wait_for_timeout(5000)
                    page.reload(wait_until="domcontentloaded")
                except Exception:
                    pass

        log.info("Shutting down...")
        browser.close()


if __name__ == "__main__":
    main()
