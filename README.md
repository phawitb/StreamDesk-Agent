# StreamDesk Agent

Movie streaming assistant with AI chat, remote monitor control, and auto-download.

**Architecture:** React frontend (Vite) + FastAPI backend + Playwright browser automation

## Requirements

- Python 3.10+
- Node.js 18+
- yt-dlp (`pip install yt-dlp` or `brew install yt-dlp`)
- Google OAuth credentials (for login)
- Gemini API key (for AI chat recommendations)

## Server Installation

### 1. Clone & setup backend

```bash
git clone https://github.com/phawitb/StreamDesk-Agent.git
cd StreamDesk-Agent

cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

### 2. Configure environment

```bash
cp .env.example .env   # or create manually
```

Create `backend/.env`:

```env
GEMINI_API_KEY=your-gemini-api-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
SESSION_SECRET=your-random-secret-string
```

> Google OAuth: Create credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
> Set **Authorized redirect URIs** to `https://your-domain.com/auth/callback`.

### 3. Build frontend

```bash
cd ../frontend
npm install
npm run build
```

This outputs to `frontend/dist/` which FastAPI serves as static files.

### 4. Run

```bash
cd ../backend
source .venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The app is available at `http://your-server-ip:8000`.

### 5. Expose to internet (optional)

Use ngrok, Cloudflare Tunnel, or reverse proxy (nginx):

```bash
# ngrok
ngrok http 8000

# nginx example
server {
    listen 443 ssl;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> WebSocket support is required for `/ws` endpoints.

## Development Mode

Run frontend and backend separately with hot-reload:

```bash
# Terminal 1 - Backend
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 - Frontend (proxies API to :8000)
cd frontend
npm run dev
```

Frontend dev server runs on port 3000 with proxy to backend.

## Raspberry Pi Monitor Setup

The Pi acts as a display device — it opens a browser in kiosk mode pointing to the server's monitor page.

### 1. Install Chromium (if not already)

```bash
sudo apt update
sudo apt install -y chromium-browser unclutter
```

### 2. Generate a device key

Pick any unique string as your device key (e.g. `mypi01`).

### 3. Auto-start browser on boot

Create `~/.config/autostart/streamdesk.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=StreamDesk Monitor
Exec=bash -c 'sleep 5 && chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required "https://your-server-domain/monitor?device_key=mypi01"'
```

Or add to `~/.bashrc` / cron `@reboot`:

```bash
sleep 5 && DISPLAY=:0 chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  "https://your-server-domain/monitor?device_key=mypi01" &
```

### 4. Hide cursor

```bash
# In autostart or .bashrc
unclutter -idle 0.5 -root &
```

### 5. Disable screen blanking

```bash
sudo raspi-config
# Display Options > Screen Blanking > No

# Or via xset:
xset s off
xset -dpms
xset s noblank
```

### 6. Pair with your account

On the StreamDesk app (phone/laptop):
1. Open **Settings**
2. Scan the QR code shown on the Pi's screen, or enter the device key manually

The Pi will show "Connected" and start playing videos you request.

## How It Works

```
Phone/Laptop (Frontend)          Server (Backend)              Pi (Monitor)
┌──────────────┐          ┌─────────────────────┐         ┌──────────────┐
│  React App   │◄──WS────►│  FastAPI + Playwright│◄──WS───►│  Chromium    │
│  - Chat      │          │  - AI Agent          │         │  - Kiosk     │
│  - Browse    │          │  - yt-dlp download   │         │  - Video     │
│  - Controls  │          │  - Monitor control   │         │  - Standby   │
└──────────────┘          └─────────────────────┘         └──────────────┘
```

1. **User** browses movies or chats with AI on phone/laptop
2. **Server** processes requests, downloads video (yt-dlp), or navigates to streaming site (Playwright)
3. **Monitor** (Pi or browser) receives commands via WebSocket — plays video, seeks, volume control

## Key Features

- Google OAuth login
- AI movie recommendations (Gemini)
- Movie browser with categories and search
- In-app or external monitor playback
- Resume from last position
- Remote media controls (play/pause/seek/volume)
- Watch history with analytics
- Auto-download popular movies (configurable threshold)
- Video storage management with auto-cleanup
- PWA support (installable on mobile)
- QR code pairing for Pi devices

## Admin

The admin email is configured in `backend/app/api/routes.py` (`ADMIN_EMAIL`).

Admin features (via Settings):
- **Sync Movies** — refresh movie catalog
- **Watch History** — view per-user history and popular movies
- **Video Storage** — manage downloaded files, set max storage
- **Auto Download** — auto-download movies watched by N+ users
- **Force Install** — require mobile users to install PWA
