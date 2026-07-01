#!/bin/bash
# ──────────────────────────────────────────────────────────
# StreamDesk Monitor — Raspberry Pi launcher
#
# Usage:
#   ./start.sh <server_url> <device_key>
#
# Example:
#   ./start.sh http://192.168.1.100:8000 my-pi-living-room
#
# This script launches Chromium in kiosk mode with autoplay
# enabled, connects to the StreamDesk server, and displays
# the monitor page. No manual activation (tap) required.
#
# Prerequisites:
#   sudo apt install chromium-browser
# ──────────────────────────────────────────────────────────

set -e

SERVER_URL="${1:?Usage: $0 <server_url> <device_key>}"
DEVICE_KEY="${2:?Usage: $0 <server_url> <device_key>}"

MONITOR_URL="${SERVER_URL}/monitor?device_key=${DEVICE_KEY}&autoplay=1"

echo "StreamDesk Monitor"
echo "  Server:     ${SERVER_URL}"
echo "  Device Key: ${DEVICE_KEY}"
echo "  URL:        ${MONITOR_URL}"
echo ""

# Kill any existing Chromium instances
pkill -f chromium-browser 2>/dev/null || true
sleep 1

# Disable screen blanking
xset -dpms 2>/dev/null || true
xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Clear Chromium crash flags (prevents "restore session" prompt)
CHROMIUM_DIR="${HOME}/.config/chromium/Default"
if [ -f "${CHROMIUM_DIR}/Preferences" ]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "${CHROMIUM_DIR}/Preferences" 2>/dev/null || true
    sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "${CHROMIUM_DIR}/Preferences" 2>/dev/null || true
fi

# Launch Chromium in kiosk mode
exec chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --autoplay-policy=no-user-gesture-required \
    --check-for-update-interval=31536000 \
    --disable-features=TranslateUI \
    --disable-component-update \
    --no-first-run \
    "${MONITOR_URL}"
