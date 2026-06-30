import asyncio
import logging
from typing import Optional, Callable, Awaitable

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright

from app.config import settings
from app.agents.base import BaseSiteAgent
from app.agents.registry import get_agent_for_url

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
        self._episode_future: Optional[asyncio.Future] = None
        self._episode_callback: Optional[Callable] = None

    async def start(self):
        """Launch Playwright and browser."""
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=settings.headless,
            slow_mo=settings.browser_slow_mo,
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
        """Send episode list to frontend and wait for user selection. Returns episode index."""
        if self._episode_callback:
            await self._episode_callback(episodes)
        self._episode_future = asyncio.get_event_loop().create_future()
        selected = await self._episode_future
        self._episode_future = None
        return selected

    def select_episode(self, index: int):
        """Called when user selects an episode from the frontend."""
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

    async def _handle_popup(self, page: Page):
        """Close popup windows opened by ads."""
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

    async def play(self, url: str):
        """Navigate to URL and play video using the appropriate site agent."""
        await self._report("launching", "กำลังเปิด browser...")

        # Find the right agent
        agent_cls = get_agent_for_url(url)
        if not agent_cls:
            await self._report("error", f"ไม่รองรับเว็บไซต์: {url}")
            return

        # Reset captured URLs
        self._captured_m3u8 = []
        self._current_url = url

        # Create fresh context and page
        context = await self._create_context()
        self._page = await context.new_page()

        # Listen for m3u8 requests
        self._page.on("request", self._on_request)

        # Create agent instance
        self._current_agent = agent_cls(self._page, self._report, manager=self)

        try:
            await self._current_agent.navigate_and_play(url)
        except Exception as e:
            logger.exception("Agent error")
            await self._report("error", f"เกิดข้อผิดพลาด: {str(e)}")

    async def download(self):
        """Download the currently playing video."""
        from app.services.downloader import download_hls

        if not self._captured_m3u8:
            await self._report("error", "ไม่พบ m3u8 URL สำหรับดาวน์โหลด กรุณาเล่นหนังก่อน")
            return

        # Use the last m3u8 (usually the actual movie, not ads)
        m3u8_url = self._captured_m3u8[-1]
        logger.info("Downloading from: %s", m3u8_url)

        # Get title from page
        title = "movie"
        if self._page:
            try:
                raw_title = await self._page.title()
                # Clean up title — remove site name suffix
                title = raw_title.split(" ดูหนัง")[0].split(" - ")[0].strip()
                if not title:
                    title = raw_title[:50]
            except Exception:
                pass

        await self._report("loading_player", f"เริ่มดาวน์โหลด: {title}")

        result = await download_hls(m3u8_url, title, self._report)
        if result:
            await self._report("playing", f"ดาวน์โหลดเสร็จ: {result}")

    async def stop_playback(self):
        """Stop current playback."""
        if self._current_agent:
            await self._current_agent.stop()
            await self._report("idle", "หยุดเล่นแล้ว")

    async def _run_video_js(self, js_code: str) -> any:
        """Execute JS on the video element inside the player iframe."""
        if not self._page:
            return None
        # Find the video in any frame
        for frame in self._page.frames:
            try:
                result = await frame.evaluate(f"""() => {{
                    const v = document.querySelector('video');
                    if (!v) return null;
                    {js_code}
                }}""")
                if result is not None:
                    return result
            except Exception:
                continue
        return None

    async def media_control(self, action: str, value: float = 0):
        """Control video playback: pause, resume, seek_forward, seek_backward, seek_to."""
        if not self._page:
            await self._report("error", "ยังไม่ได้เปิดหนัง")
            return

        if action == "pause":
            await self._run_video_js("v.pause(); return true;")
            await self._report("playing", "หยุดชั่วคราว ⏸")

        elif action == "resume":
            await self._run_video_js("v.play(); return true;")
            await self._report("playing", "เล่นต่อ ▶")

        elif action == "seek_forward":
            secs = value or 10
            await self._run_video_js(f"v.currentTime += {secs}; return true;")
            await self._report("playing", f"ข้ามไป {secs:.0f} วินาที ⏩")

        elif action == "seek_backward":
            secs = value or 10
            await self._run_video_js(f"v.currentTime = Math.max(0, v.currentTime - {secs}); return true;")
            await self._report("playing", f"ถอยกลับ {secs:.0f} วินาที ⏪")

        elif action == "seek_to":
            await self._run_video_js(f"v.currentTime = {value}; return true;")
            mins = int(value) // 60
            secs = int(value) % 60
            await self._report("playing", f"ข้ามไปที่ {mins:02d}:{secs:02d}")

        elif action == "get_status":
            info = await self._run_video_js("""
                return {
                    currentTime: v.currentTime,
                    duration: v.duration || 0,
                    paused: v.paused,
                };
            """)
            return info

        return None


agent_manager = AgentManager()
