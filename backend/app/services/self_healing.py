import asyncio
import logging
import re
from typing import Optional, Callable, Awaitable

from playwright.async_api import Page, Frame, ElementHandle

from app.services.gemini_vision import analyze_screenshot

logger = logging.getLogger(__name__)

StatusCallback = Callable[[str, str], Awaitable[None]]

# Prompts for different scenarios
PROMPTS = {
    "find_player_iframe": (
        "This is a streaming movie website. I need to find the video player iframe element. "
        "Look at the page and tell me the CSS selector for the iframe that contains the video player. "
        "Reply with ONLY the CSS selector, nothing else. Example: iframe[name='player']"
    ),
    "find_skip_button": (
        "This is a video player showing a pre-roll advertisement. "
        "I need to find the 'skip ad' button (ข้ามโฆษณา / ข้าม / Skip). "
        "Look at the screenshot and tell me the CSS selector for the skip button. "
        "Reply with ONLY the CSS selector, nothing else. Example: .skip-btn"
    ),
    "find_play_button": (
        "This is a video player page. I need to find the play button to start the video. "
        "Look at the screenshot and tell me the CSS selector for the play button. "
        "Reply with ONLY the CSS selector, nothing else. Example: .play-btn"
    ),
    "find_fullscreen_button": (
        "This is a video player. I need to find the fullscreen button. "
        "Look at the screenshot and tell me the CSS selector for the fullscreen button. "
        "Reply with ONLY the CSS selector, nothing else. Example: .fullscreen-btn"
    ),
    "find_video": (
        "This is a streaming page. I need to find the video element. "
        "Describe what you see and tell me the CSS selector for the video element or its container. "
        "Reply with ONLY the CSS selector, nothing else. Example: video.main-player"
    ),
    "analyze_error": (
        "This is a streaming website that should be playing a movie but something went wrong. "
        "Look at the screenshot and describe:\n"
        "1. What is currently showing on screen?\n"
        "2. Is there an error message? If yes, what does it say?\n"
        "3. Is there an ad/popup blocking the player? If yes, what CSS selector could close it?\n"
        "4. What action should I take to get the video to play?\n"
        "Be concise."
    ),
}


class SelfHealing:
    """
    Self-healing wrapper for Playwright actions.
    Uses existing selectors first; on failure, uses Gemini Vision to find alternatives.
    """

    def __init__(self, page: Page, report_status: StatusCallback):
        self.page = page
        self._report = report_status
        self._gemini_calls = 0
        self._max_gemini_calls = 5

    async def _can_call_gemini(self) -> bool:
        if self._gemini_calls >= self._max_gemini_calls:
            logger.warning("Gemini call limit reached (%d)", self._max_gemini_calls)
            return False
        return True

    async def _screenshot(self, target=None) -> Optional[bytes]:
        """Take a screenshot of the page or a specific element."""
        try:
            if target and hasattr(target, "screenshot"):
                return await target.screenshot()
            return await self.page.screenshot()
        except Exception as e:
            logger.warning("Screenshot failed: %s", e)
            return None

    async def _ask_gemini(self, image_bytes: bytes, prompt: str) -> Optional[str]:
        """Ask Gemini to analyze a screenshot."""
        if not await self._can_call_gemini():
            return None
        self._gemini_calls += 1
        await self._report("loading_player", "AI กำลังวิเคราะห์หน้าจอ...")
        result = await analyze_screenshot(image_bytes, prompt)
        return result

    def _extract_selector(self, gemini_response: str) -> Optional[str]:
        """Extract a CSS selector from Gemini's response."""
        if not gemini_response:
            return None

        text = gemini_response.strip()

        # Remove markdown backticks
        text = re.sub(r"```[a-z]*\n?", "", text)
        text = text.replace("`", "").strip()

        # Take first non-empty line
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("//"):
                continue
            # Basic validation: should look like a CSS selector
            if any(c in line for c in [".", "#", "[", ":"]) or line in ["video", "iframe", "button"]:
                return line

        return None

    async def find_element(
        self,
        frame_or_page,
        selectors: list[str],
        purpose: str,
        timeout: int = 2000,
    ) -> Optional[ElementHandle]:
        """
        Try to find an element using a list of selectors.
        If all fail, use Gemini Vision to suggest a new selector.
        """
        # Step 1: Try existing selectors
        for selector in selectors:
            try:
                el = await frame_or_page.wait_for_selector(selector, timeout=timeout)
                if el:
                    return el
            except Exception:
                continue

        # Step 2: All selectors failed — ask Gemini
        logger.info("All selectors failed for '%s', asking Gemini...", purpose)

        prompt = PROMPTS.get(purpose, PROMPTS["analyze_error"])

        # Try to screenshot the relevant area
        screenshot = await self._screenshot(
            frame_or_page if hasattr(frame_or_page, "screenshot") else None
        )
        if not screenshot:
            return None

        response = await self._ask_gemini(screenshot, prompt)
        new_selector = self._extract_selector(response)

        if not new_selector:
            logger.warning("Gemini didn't provide a valid selector for '%s'", purpose)
            return None

        logger.info("Gemini suggested selector: %s", new_selector)
        await self._report("loading_player", f"AI แนะนำ selector: {new_selector}")

        # Step 3: Try the Gemini-suggested selector
        try:
            el = await frame_or_page.wait_for_selector(new_selector, timeout=5000)
            if el:
                logger.info("Gemini selector worked: %s", new_selector)
                return el
        except Exception as e:
            logger.warning("Gemini selector failed: %s — %s", new_selector, e)

        return None

    async def find_and_click(
        self,
        frame_or_page,
        selectors: list[str],
        purpose: str,
        timeout: int = 2000,
    ) -> bool:
        """
        Try to find and click an element. Falls back to Gemini on failure.
        Returns True if click succeeded.
        """
        el = await self.find_element(frame_or_page, selectors, purpose, timeout)
        if el:
            try:
                await el.click(timeout=3000)
                return True
            except Exception as e:
                logger.warning("Click failed on found element: %s", e)
        return False

    async def analyze_page(self, frame_or_page=None) -> Optional[str]:
        """
        Take a screenshot and ask Gemini to analyze what's wrong.
        Returns Gemini's analysis text.
        """
        target = frame_or_page or self.page
        screenshot = await self._screenshot(target)
        if not screenshot:
            return None
        return await self._ask_gemini(screenshot, PROMPTS["analyze_error"])
