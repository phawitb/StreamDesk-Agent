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
# Setup:
#   pip install playwright
#   playwright install chromium
# ──────────────────────────────────────────────────────────

set -e

SERVER_URL="${1:?Usage: $0 <server_url> <device_key>}"
DEVICE_KEY="${2:?Usage: $0 <server_url> <device_key>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Disable screen blanking
xset -dpms 2>/dev/null || true
xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true

exec python3 "${SCRIPT_DIR}/monitor.py" "${SERVER_URL}" "${DEVICE_KEY}"
