import asyncio
import logging
import re
from typing import Optional, Callable, Awaitable

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright

import socket
from app.config import settings
from app.agents.base import BaseSiteAgent
from app.agents.registry import get_agent_for_url
from app.services.monitor import monitor_manager, MonitorController

YOUTUBE_RE = re.compile(r'(youtube\.com|youtu\.be)')
BILIBILI_RE = re.compile(r'(bilibili\.com|bilibili\.tv|b23\.tv|bili\.im)')

# Import site agents to trigger registration
import app.agents.sites.hd24  # noqa: F401

logger = logging.getLogger(__name__)

AD_DOMAINS = [
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "adnxs.com",
    "adsrvr.org",
    "facebook.net/tr",
    "analytics.google.com",
    "adservice.google",
    "pagead2.googlesyndication.com",
    "tpc.googlesyndication.com",
    "fundingchoicesmessages.google.com",
    "securepubads.g.doubleclick.net",
    "pop-under",
    "popunder",
    "popads.net",
    "popcash.net",
    "propellerads.com",
    "juicyads.com",
    "exoclick.com",
    "trafficjunky.com",
    "hilltopads.net",
    "a-ads.com",
    "ad.doubleclick.net",
]


class AgentManager:
    def __init__(self):
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._current_agent: Optional[BaseSiteAgent] = None
        self._status_callback: Optional[Callable[[str, str], Awaitable[None]]] = None
        self._captured_m3u8: list[str] = []
        self._current_url: Optional[str] = None
        self._current_title: Optional[str] = None
        self._episode_future: Optional[asyncio.Future] = None
        self._episode_callback: Optional[Callable] = None
        self._user_id: Optional[int] = None
        self._active_proc: Optional[asyncio.subprocess.Process] = None  # track subprocess for cancellation
        self._current_episode_index: int = -1
        self._use_cached_stream: bool = False
        self._cached_stream_url: Optional[str] = None
        self._preselected_episode: Optional[int] = None  # Skip episode picker if set
        self._episode_resume_position: float = 0  # Resume position from episode selection

    def set_user(self, user_id: int):
        self._user_id = user_id

    @staticmethod
    def _get_local_ip() -> str:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "localhost"

    @property
    def _monitor(self) -> MonitorController:
        if self._user_id is None:
            raise RuntimeError("No user set on agent_manager")
        return monitor_manager.get(self._user_id)

    async def start(self):
        """Launch Playwright and browser."""
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=settings.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ],
        )
        logger.info("Browser launched (headless=%s)", settings.headless)

    async def stop(self):
        """Shut down browser and Playwright."""
        if self._current_agent:
            await self._current_agent.stop()
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        logger.info("Browser shut down")

    def set_status_callback(self, callback: Callable[[str, str], Awaitable[None]]):
        self._status_callback = callback

    def set_episode_callback(self, callback):
        self._episode_callback = callback

    async def wait_for_episode_selection(self, episodes: list[dict]) -> int:
        """Send episode list to frontend and wait for user selection."""
        if self._episode_callback:
            await self._episode_callback(episodes)
        self._episode_future = asyncio.get_event_loop().create_future()
        selected = await self._episode_future
        self._episode_future = None
        return selected

    def select_episode(self, index: int):
        if self._episode_future and not self._episode_future.done():
            self._episode_future.set_result(index)

    async def _report(self, state: str, message: str):
        logger.info("[%s] %s", state, message)
        if self._status_callback:
            await self._status_callback(state, message)

    async def _block_ads(self, route):
        url = route.request.url
        if any(ad_domain in url for ad_domain in AD_DOMAINS):
            await route.abort()
        else:
            await route.continue_()

    async def _create_context(self) -> BrowserContext:
        """Create a new browser context with ad blocking."""
        if self._context:
            await self._context.close()

        self._context = await self._browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        )

        # Block ads
        await self._context.route("**/*", self._block_ads)

        # Auto-close popup windows
        self._context.on("page", lambda page: asyncio.create_task(self._handle_popup(page)))

        return self._context

    async def _close_browser(self):
        """Close browser context and page after m3u8 is captured."""
        self._current_agent = None
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
            self._context = None
        self._page = None
        logger.info("Browser context closed (m3u8 sent to monitor)")

    async def _handle_popup(self, page: Page):
        await asyncio.sleep(0.5)
        if page != self._page:
            logger.info("Closing popup: %s", page.url)
            await page.close()

    def _on_request(self, request):
        """Intercept requests to capture m3u8 URLs."""
        url = request.url
        if ".m3u8" in url:
            if url not in self._captured_m3u8:
                self._captured_m3u8.append(url)
                logger.info("Captured m3u8: %s", url[:120])

    async def cancel_active(self):
        """Kill any running subprocess (yt-dlp, ffmpeg, etc.)."""
        if self._active_proc and self._active_proc.returncode is None:
            try:
                self._active_proc.kill()
                logger.info("Killed active subprocess pid=%d", self._active_proc.pid)
            except Exception:
                pass
            self._active_proc = None
        # Close browser context if mid-navigation
        if self._current_agent:
            try:
                await self._current_agent.stop()
            except Exception:
                pass
            self._current_agent = None

    async def play(self, url: str, resume_position: float = 0):
        """Play a URL — route to YouTube, Bilibili, or site agent."""
        # Stop current playback before starting new one
        if self._monitor.connected and self._monitor.status.get("playing"):
            logger.info("Stopping current playback before new request")
            await self._monitor.pause()

        try:
            if YOUTUBE_RE.search(url):
                await self._play_youtube(url, resume_position)
            elif BILIBILI_RE.search(url):
                await self._play_with_ytdlp(url, "Bilibili", resume_position)
            else:
                await self._play_site(url, resume_position)
        except asyncio.CancelledError:
            logger.info("Play task cancelled for: %s", url[:80])
            await self.cancel_active()
            raise

    async def _play_youtube(self, url: str, resume_position: float = 0):
        """YouTube: extract stream URL with yt-dlp and play directly."""
        await self._report("launching", "กำลังเปิด YouTube...")

        if not self._monitor.connected:
            await self._report("error", "ไม่มี monitor เชื่อมต่อ เปิด /monitor ก่อน")
            return

        title = await self._get_title_ytdlp(url)
        await self._report("loading_player", f"กำลังโหลด: {title}...")

        stream_url = await self._extract_stream_ytdlp(url)
        if not stream_url:
            await self._report("error", "ไม่สามารถดึง stream URL ได้")
            return

        await self._monitor.open_url(stream_url, title, start_time=resume_position)
        await self._report("playing", f"กำลังเล่น: {title}")

    async def _play_with_ytdlp(self, url: str, platform_name: str = "Video", resume_position: float = 0):
        """Extract stream URL with yt-dlp and play directly."""
        await self._report("launching", f"กำลังเปิด {platform_name}...")

        if not self._monitor.connected:
            await self._report("error", "ไม่มี monitor เชื่อมต่อ เปิด /monitor ก่อน")
            return

        title = await self._get_title_ytdlp(url)
        await self._report("loading_player", f"กำลังโหลด: {title}...")

        stream_url = await self._extract_stream_ytdlp(url)
        if not stream_url:
            await self._report("error", "ไม่สามารถดึง stream URL ได้")
            return

        await self._monitor.open_url(stream_url, title, start_time=resume_position)
        await self._report("playing", f"กำลังเล่น: {title}")

    async def _get_title_ytdlp(self, url: str) -> str:
        """Get video title using yt-dlp."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "yt-dlp", "--get-title", "--no-playlist", url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
            title = stdout.decode().strip()
            return title if title else url
        except Exception as e:
            logger.warning("yt-dlp get-title failed: %s", e)
            return url

    async def _extract_stream_ytdlp(self, url: str) -> Optional[str]:
        """Extract direct stream URL using yt-dlp. Returns single URL or None."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "yt-dlp", "-g", "-f", "best[ext=mp4]/best", "--no-playlist", url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
            lines = [l for l in stdout.decode().strip().split("\n") if l.startswith("http")]
            # Only return if we get exactly 1 URL (combined stream).
            # If 2+ URLs, video/audio are separate — can't play directly.
            if len(lines) == 1:
                logger.info("yt-dlp extracted: %s", lines[0][:120])
                return lines[0]
        except Exception as e:
            logger.warning("yt-dlp extract failed: %s", e)
        return None

    async def _test_m3u8_url(self, url: str) -> bool:
        """Test if an m3u8 URL is still valid (HEAD request)."""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
                resp = await client.head(url)
                return resp.status_code == 200
        except Exception:
            return False

    async def _get_cached_title(self, url: str, episode_index: int = -1) -> str:
        """Get title from stream_cache or watch_history."""
        from app.services.database import get_db
        try:
            db = await get_db()
            cur = await db.execute(
                "SELECT title FROM stream_cache WHERE page_url = ? AND episode_index = ?",
                (url, episode_index))
            row = await cur.fetchone()
            if row and row["title"]:
                title = row["title"]
            else:
                cur2 = await db.execute(
                    "SELECT title FROM watch_history WHERE url = ? AND title != '' ORDER BY id DESC LIMIT 1",
                    (url,))
                row2 = await cur2.fetchone()
                title = row2["title"] if row2 else "Movie"
            await db.close()
            return title
        except Exception:
            return "Movie"

    async def _try_cached_stream(self, url: str, episode_index: int, resume_position: float) -> bool:
        """Try to play from cached stream URL. Returns True if successful."""
        from app.services.database import get_cached_stream, delete_stream_cache
        cached = await get_cached_stream(url, episode_index=episode_index)
        if not cached:
            return False
        await self._report("launching", "พบ stream URL ที่เคยเล่น กำลังทดสอบ...")
        if await self._test_m3u8_url(cached):
            if not self._monitor.connected:
                await self._report("error", "ไม่มี monitor เชื่อมต่อ เปิด /monitor ก่อน")
                return True  # Return True to stop further processing
            self._current_title = await self._get_cached_title(url, episode_index)
            await self._monitor.open_url(cached, self._current_title, start_time=resume_position)
            await self._monitor.unmute()
            await self._report("playing", f"กำลังเล่น: {self._current_title}")
            logger.info("Playing from cached stream: %s", cached[:120])
            return True
        else:
            await delete_stream_cache(url, episode_index=episode_index)
            logger.info("Cached stream expired for ep=%d", episode_index)
            return False

    async def _play_site(self, url: str, resume_position: float = 0):
        """Navigate to URL with Playwright, capture m3u8, and send to monitor."""
        from app.services.database import get_cached_stream, upsert_stream_cache, delete_stream_cache
        from app.services.database import get_episode_cache, save_episode_cache

        self._current_url = url
        self._current_title = None
        self._current_episode_index = -1

        # ── Check if we have cached episodes for this URL ──
        cached_episodes = await get_episode_cache(url)
        if cached_episodes and len(cached_episodes) >= 2:
            logger.info("Found %d cached episodes for %s", len(cached_episodes), url[:80])
            await self._report("navigating", f"พบ {len(cached_episodes)} ตอน (จาก cache) กำลังรอเลือกตอน...")

            # Send episode list to frontend and wait for selection
            if self._episode_callback:
                await self._episode_callback(cached_episodes)
            self._episode_future = asyncio.get_event_loop().create_future()
            selected = await self._episode_future
            self._episode_future = None
            self._current_episode_index = selected
            logger.info("User selected cached episode index: %d", selected)

            # Try cached stream for this episode (use episode-specific resume position)
            ep_resume = self._episode_resume_position or resume_position
            if await self._try_cached_stream(url, selected, ep_resume):
                return
            # Cache miss — fall through to browser, auto-select this episode
            self._preselected_episode = selected
            logger.info("No cached stream for ep=%d, opening browser with preselection", selected)

        # ── Try cached stream URL (non-series / no cached episodes) ──
        if not cached_episodes or len(cached_episodes) < 2:
            if await self._try_cached_stream(url, episode_index=-1, resume_position=resume_position):
                return

        # ── Normal browser automation flow ──
        await self._report("launching", "กำลังเปิด browser...")

        agent_cls = get_agent_for_url(url)
        if not agent_cls:
            await self._report("error", f"ไม่รองรับเว็บไซต์: {url}")
            return

        self._captured_m3u8 = []

        # Create fresh context and page
        context = await self._create_context()
        self._page = await context.new_page()

        # Listen for m3u8 requests
        self._page.on("request", self._on_request)

        # Create agent instance
        self._current_agent = agent_cls(self._page, self._report, manager=self)

        try:
            await self._current_agent.navigate_and_play(url)

            # Check if agent used cached stream (set by _handle_episodes)
            if getattr(self, '_use_cached_stream', False) and getattr(self, '_cached_stream_url', None):
                m3u8_url = self._cached_stream_url
                self._use_cached_stream = False
                self._cached_stream_url = None
                try:
                    raw_title = await self._page.title()
                    self._current_title = raw_title.split(" ดูหนัง")[0].split(" - ")[0].strip() or raw_title[:80]
                except Exception:
                    self._current_title = "Movie"

                if not self._monitor.connected:
                    await self._report("error", "ไม่มี monitor เชื่อมต่อ เปิด /monitor ก่อน")
                    return

                ep_resume = self._episode_resume_position or resume_position
                await self._monitor.open_url(m3u8_url, self._current_title, start_time=ep_resume)
                await self._monitor.unmute()
                await self._report("playing", f"กำลังเล่น: {self._current_title} (จาก cache)")
                return

            # Get title
            try:
                raw_title = await self._page.title()
                self._current_title = raw_title.split(" ดูหนัง")[0].split(" - ")[0].strip() or raw_title[:80]
            except Exception:
                self._current_title = "Movie"

            # Wait a bit for m3u8 to be captured
            if not self._captured_m3u8:
                await self._report("loading_player", "รอจับ URL สตรีม...")
                for _ in range(15):
                    await asyncio.sleep(1)
                    if self._captured_m3u8:
                        break

            if self._captured_m3u8:
                m3u8_url = self._captured_m3u8[-1]
                logger.info("Sending m3u8 to monitor: %s", m3u8_url[:120])

                if not self._monitor.connected:
                    await self._report("error", "ไม่มี monitor เชื่อมต่อ เปิด /monitor ก่อน")
                    return

                await self._monitor.open_url(m3u8_url, self._current_title, start_time=resume_position)
                await self._monitor.unmute()
                await self._report("playing", f"กำลังเล่น: {self._current_title}")

                # Save stream URL to cache
                ep_idx = getattr(self, '_current_episode_index', -1)
                asyncio.create_task(upsert_stream_cache(url, ep_idx, m3u8_url, self._current_title or ""))
                logger.info("Cached stream URL for %s ep=%d", url[:80], ep_idx)
            else:
                await self._report("error", "ไม่พบ stream URL จากหน้าเว็บ")

        except Exception as e:
            logger.exception("Agent error")
            await self._report("error", f"เกิดข้อผิดพลาด: {str(e)}")
        finally:
            await self._close_browser()

    async def stop_playback(self):
        """Stop current playback."""
        if self._current_agent:
            await self._current_agent.stop()
            await self._report("idle", "หยุดเล่นแล้ว")

    async def reset(self):
        """Kill all running processes, close browser context, reset state."""
        logger.info("Resetting agent manager...")

        # Cancel pending episode selection
        if self._episode_future and not self._episode_future.done():
            self._episode_future.cancel()
        self._episode_future = None

        # Stop current agent
        if self._current_agent:
            try:
                await self._current_agent.stop()
            except Exception:
                pass
            self._current_agent = None

        # Close browser context (kills all pages)
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
            self._context = None

        self._page = None
        self._captured_m3u8 = []
        self._current_url = None
        self._current_title = None
        self._current_episode_index = -1
        self._use_cached_stream = False
        self._cached_stream_url = None
        self._preselected_episode = None

        # Stop monitor playback
        await self._monitor.stop()

        await self._report("idle", "รีเซ็ตเรียบร้อย พร้อมรับคำสั่งใหม่")
        logger.info("Reset complete")

    async def media_control(self, action: str, value: float = 0):
        """Route media controls through monitor."""
        if action == "pause":
            await self._monitor.pause()
        elif action == "resume":
            await self._monitor.play()
        elif action == "seek_forward":
            await self._monitor.seek_forward(int(value) or 10)
        elif action == "seek_backward":
            await self._monitor.seek_backward(int(value) or 10)
        elif action == "seek_to":
            await self._monitor.seek_to(value)
        elif action == "get_status":
            return self._monitor.status
        return None


agent_manager = AgentManager()
