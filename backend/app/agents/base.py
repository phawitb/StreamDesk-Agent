from abc import ABC, abstractmethod
from typing import Callable, Awaitable

from playwright.async_api import Page

StatusCallback = Callable[[str, str], Awaitable[None]]  # (state, message)


class BaseSiteAgent(ABC):
    """Abstract base class for site-specific browser automation agents."""

    def __init__(self, page: Page, report_status: StatusCallback, manager=None):
        self.page = page
        self._report = report_status
        self._manager = manager

    @staticmethod
    @abstractmethod
    def can_handle(url: str) -> bool:
        """Return True if this agent can handle the given URL."""

    @abstractmethod
    async def navigate_and_play(self, url: str) -> None:
        """Navigate to the URL, handle ads/overlays, and start video playback."""

    async def dismiss_overlays(self) -> None:
        """Dismiss common overlay elements. Override per site if needed."""
        common_selectors = [
            '[class*="close"]',
            '[class*="dismiss"]',
            '[aria-label="Close"]',
            '.popup-close',
        ]
        for selector in common_selectors:
            try:
                btn = self.page.locator(selector).first
                if await btn.is_visible(timeout=500):
                    await btn.click()
            except Exception:
                pass

    async def stop(self) -> None:
        """Stop playback and clean up."""
        try:
            await self.page.evaluate("document.querySelectorAll('video').forEach(v => v.pause())")
        except Exception:
            pass
