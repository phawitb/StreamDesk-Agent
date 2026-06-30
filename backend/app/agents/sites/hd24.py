import asyncio
import logging

from playwright.async_api import Page, Frame

from app.agents.base import BaseSiteAgent
from app.agents.registry import register
from app.services.self_healing import SelfHealing

logger = logging.getLogger(__name__)

# Selectors used in this agent — grouped for self-healing fallback
PLAYER_IFRAME_SELECTORS = [
    'iframe[name="box-player"]',
    'iframe[class*="player"]',
    'iframe[id*="player"]',
]

SKIP_AD_SELECTORS = [
    ".jw-skip",
    ".jw-skipButton",
    "[class*='skip-ad']",
    "[class*='skip_ad']",
    ".vast-skip-button",
    ".skip-button",
    "button:has-text('ข้าม')",
]

FULLSCREEN_SELECTORS = [
    ".jw-icon-fullscreen",
    "[aria-label='Fullscreen']",
    "[aria-label='fullscreen']",
    "[class*='fullscreen']",
]


@register
class HD24Agent(BaseSiteAgent):
    """Browser automation agent for 24hd.net streaming site."""

    @staticmethod
    def can_handle(url: str) -> bool:
        return "24hd.net" in url

    async def navigate_and_play(self, url: str) -> None:
        # Initialize self-healing helper
        self._healer = SelfHealing(self.page, self._report)

        await self._report("navigating", f"กำลังเปิดหน้าเว็บ: {url}")
        await self.page.goto(url, wait_until="domcontentloaded", timeout=30000)

        title = await self.page.title()
        await self._report("navigating", f"เปิดหน้า: {title}")
        await self.page.wait_for_timeout(2000)

        # Check for episode list (series page)
        await self._handle_episodes()

        await self._report("loading_player", "กำลังหา video player...")

        # Get player iframe
        frame = await self._get_player_frame()
        if not frame:
            await self._report("loading_player", "ลองตัวเล่นสำรอง...")
            await self._switch_to_backup()
            frame = await self._get_player_frame()

        if not frame:
            # Self-healing: ask Gemini what's on screen
            analysis = await self._healer.analyze_page()
            if analysis:
                await self._report("error", f"AI วิเคราะห์: {analysis[:200]}")
            else:
                await self._report("error", "ไม่พบ video player")
            return

        # Click play to start — use JS play() to avoid hitting pause on the video
        await self._report("loading_player", "กำลังกดเล่น...")
        await frame.evaluate("""() => {
            const v = document.querySelector('video');
            if (v) { v.muted = true; v.play().catch(() => {}); }
            // Also try clicking the JWPlayer display icon (big play button)
            const playBtn = document.querySelector('.jw-display-icon-container');
            if (playBtn) playBtn.click();
        }""")
        await asyncio.sleep(2)
        await self._close_popups()

        # If video still not playing, try clicking body once
        is_paused = await frame.evaluate("() => { const v = document.querySelector('video'); return v ? v.paused : true; }")
        if is_paused:
            try:
                await frame.click("body", timeout=3000)
                await asyncio.sleep(1)
                await self._close_popups()
            except Exception:
                pass

        # Skip all VAST pre-roll ads
        await self._skip_all_ads_and_wait(frame)

        # Verify movie is playing
        is_movie = await self._is_movie_playing(frame)

        if not is_movie:
            await self._report("loading_player", "ลองตัวเล่นสำรอง...")
            await self._switch_to_backup()
            frame = await self._get_player_frame()
            if frame:
                await frame.evaluate("""() => {
                    const v = document.querySelector('video');
                    if (v) { v.muted = true; v.play().catch(() => {}); }
                    const playBtn = document.querySelector('.jw-display-icon-container');
                    if (playBtn) playBtn.click();
                }""")
                await asyncio.sleep(3)
                await self._close_popups()
                await self._skip_all_ads_and_wait(frame)
                is_movie = await self._is_movie_playing(frame)

        if is_movie:
            await self._report("loading_player", f"จับ stream ได้แล้ว: {title}")
        else:
            # Self-healing: analyze why it failed
            analysis = await self._healer.analyze_page()
            if analysis:
                await self._report("error", f"เล่นไม่ได้ — AI วิเคราะห์: {analysis[:200]}")
            else:
                await self._report("error", "ไม่สามารถเล่นวิดีโอได้")

    # ──────────────────────────────────────────────
    # Episode detection
    # ──────────────────────────────────────────────

    async def _handle_episodes(self):
        """Detect episode buttons on series pages and ask the user to choose."""
        try:
            episodes = await self.page.evaluate("""() => {
                const buttons = document.querySelectorAll('.swicth-ep');
                const eps = Array.from(buttons).map((btn, i) => ({
                    index: i,
                    text: btn.innerText.trim(),
                    active: btn.classList.contains('active'),
                }));
                // Check if any button text looks like an episode (EP., ตอนที่, etc.)
                const hasEpText = eps.some(e =>
                    /EP[.\s]*\d|ตอนที่|ตอน\s*\d|ep\s*\d/i.test(e.text)
                );
                return hasEpText ? eps : [];
            }""")

            if not episodes or len(episodes) < 2:
                return  # Not a series page, continue normally

            logger.info("Found %d episodes", len(episodes))
            await self._report("navigating", f"พบ {len(episodes)} ตอน กำลังรอเลือกตอน...")

            if not self._manager:
                logger.warning("No manager reference, cannot ask for episode selection")
                return

            selected = await self._manager.wait_for_episode_selection(episodes)
            logger.info("User selected episode index: %d", selected)

            # Click the selected episode button
            await self.page.evaluate(f"""() => {{
                const buttons = document.querySelectorAll('.swicth-ep');
                if (buttons[{selected}]) buttons[{selected}].click();
            }}""")
            await self.page.wait_for_timeout(3000)

            ep_text = episodes[selected]["text"] if selected < len(episodes) else f"#{selected}"
            await self._report("navigating", f"เลือก {ep_text} แล้ว")

        except Exception as e:
            logger.warning("Episode detection error: %s", e)

    # ──────────────────────────────────────────────
    # Player iframe
    # ──────────────────────────────────────────────

    async def _get_player_frame(self) -> Frame | None:
        """Get the content frame of the player iframe. Falls back to Gemini on failure."""
        # Try normal selectors first
        for selector in PLAYER_IFRAME_SELECTORS:
            try:
                iframe_el = await self.page.wait_for_selector(selector, timeout=5000)
                if iframe_el:
                    frame = await iframe_el.content_frame()
                    if frame:
                        await frame.wait_for_load_state("domcontentloaded", timeout=10000)
                        await asyncio.sleep(1)
                        return frame
            except Exception:
                continue

        # Self-healing fallback: ask Gemini to find the iframe
        logger.info("Normal iframe selectors failed, trying Gemini...")
        iframe_el = await self._healer.find_element(
            self.page, PLAYER_IFRAME_SELECTORS, "find_player_iframe", timeout=5000
        )
        if iframe_el:
            try:
                frame = await iframe_el.content_frame()
                if frame:
                    await frame.wait_for_load_state("domcontentloaded", timeout=10000)
                    await asyncio.sleep(1)
                    return frame
            except Exception as e:
                logger.warning("Gemini iframe failed: %s", e)

        return None

    async def _switch_to_backup(self):
        """Click the backup player button."""
        try:
            buttons = self.page.locator(".swicth-ep, .switch-ep")
            count = await buttons.count()
            if count >= 2:
                await buttons.nth(1).click()
                await self.page.wait_for_timeout(3000)
        except Exception as e:
            logger.warning("Failed to switch to backup: %s", e)

    # ──────────────────────────────────────────────
    # Ad skipping
    # ──────────────────────────────────────────────

    async def _is_in_ad_mode(self, frame: Frame) -> bool:
        """Check if JWPlayer is still in ad mode."""
        try:
            return await frame.evaluate("""() => {
                const player = document.querySelector('.jwplayer');
                if (!player) return false;
                if (player.classList.contains('jw-flag-ads')) return true;
                const skip = document.querySelector('.jw-skip');
                if (skip) {
                    const style = window.getComputedStyle(skip);
                    if (style.display !== 'none' && style.visibility !== 'hidden') return true;
                }
                const vast = document.querySelector('.jw-plugin-vast');
                if (vast) {
                    const style = window.getComputedStyle(vast);
                    const rect = vast.getBoundingClientRect();
                    if (style.display !== 'none' && rect.height > 50) {
                        const children = vast.querySelectorAll('div, iframe, a');
                        for (const c of children) {
                            const cs = window.getComputedStyle(c);
                            if (cs.display !== 'none' && c.getBoundingClientRect().height > 30) return true;
                        }
                    }
                }
                const video = document.querySelector('video');
                if (video && video.duration && video.duration < 60 && !video.paused) return true;
                return false;
            }""")
        except Exception:
            return False

    async def _find_skip_button(self, frame: Frame):
        """Find skip button — normal selectors first, then Gemini fallback."""
        # Try normal selectors
        for selector in SKIP_AD_SELECTORS:
            try:
                el = frame.locator(selector).first
                if await el.is_visible(timeout=500):
                    return el
            except Exception:
                continue

        # Gemini fallback: screenshot the frame and ask
        logger.info("Skip button not found with normal selectors, asking Gemini...")
        try:
            # Screenshot the iframe element
            iframe_el = await self.page.query_selector('iframe[name="box-player"]')
            if iframe_el:
                screenshot = await iframe_el.screenshot()
            else:
                screenshot = await self.page.screenshot()

            response = await self._healer._ask_gemini(screenshot, self._healer.__class__.__dict__.get("_prompts", {}).get("find_skip_button", ""))
            if not response:
                from app.services.self_healing import PROMPTS
                response = await self._healer._ask_gemini(screenshot, PROMPTS["find_skip_button"])

            new_selector = self._healer._extract_selector(response)
            if new_selector:
                logger.info("Gemini suggested skip selector: %s", new_selector)
                await self._report("loading_player", f"AI แนะนำปุ่มข้าม: {new_selector}")
                el = frame.locator(new_selector).first
                if await el.is_visible(timeout=2000):
                    return el
        except Exception as e:
            logger.warning("Gemini skip fallback error: %s", e)

        return None

    async def _skip_all_ads_and_wait(self, frame: Frame):
        """Skip all VAST pre-roll ads. Uses Gemini fallback if skip button selector changed."""
        ads_skipped = 0
        no_skip_streak = 0
        gemini_skip_used = False

        for round_num in range(30):
            # Debug: log full ad state
            ad_debug = await frame.evaluate("""() => {
                const player = document.querySelector('.jwplayer');
                const skip = document.querySelector('.jw-skip');
                const video = document.querySelector('video');
                return {
                    hasPlayer: !!player,
                    playerClasses: player ? Array.from(player.classList).filter(c => c.includes('ad') || c.includes('flag')).join(' ') : '',
                    hasSkip: !!skip,
                    skipText: skip ? skip.innerText.trim() : '',
                    skipDisplay: skip ? window.getComputedStyle(skip).display : '',
                    skipVisibility: skip ? window.getComputedStyle(skip).visibility : '',
                    skipRect: skip ? (() => { const r = skip.getBoundingClientRect(); return `${r.x},${r.y} ${r.width}x${r.height}`; })() : '',
                    videoDuration: video ? video.duration : 0,
                    videoPaused: video ? video.paused : true,
                    videoTime: video ? video.currentTime : 0,
                };
            }""")
            logger.info("Ad debug round %d: %s", round_num, ad_debug)

            # Check if skip button is visible (normal way)
            has_skip = await frame.evaluate("""() => {
                const skip = document.querySelector('.jw-skip');
                if (!skip) return false;
                const style = window.getComputedStyle(skip);
                return style.display !== 'none' && style.visibility !== 'hidden';
            }""")

            if has_skip:
                no_skip_streak = 0
                ads_skipped += 1
                await self._report("loading_player", f"กำลังข้ามโฆษณา {ads_skipped}...")

                # Wait for countdown — ensure ad video is playing
                for wait_sec in range(25):
                    state = await frame.evaluate("""() => {
                        const el = document.querySelector('.jw-skip');
                        const v = document.querySelector('video');
                        const text = el ? el.innerText : '';
                        const paused = v ? v.paused : false;
                        // If video is paused, resume it so countdown progresses
                        if (v && paused) {
                            v.play().catch(() => {});
                        }
                        return { text, paused };
                    }""")
                    text = state.get("text", "")
                    if state.get("paused"):
                        logger.info("Ad video was paused, resumed it")
                    if text and "ใน" not in text:
                        break
                    if wait_sec % 3 == 0 and text:
                        await self._report("loading_player", f"รอข้ามโฆษณา: {text.strip()}")
                    await asyncio.sleep(1)

                # Click skip — use evaluate to click the exact element
                try:
                    click_info = await frame.evaluate("""() => {
                        const skip = document.querySelector('.jw-skip');
                        if (!skip) return { clicked: false, reason: 'not found' };
                        const rect = skip.getBoundingClientRect();
                        const text = skip.innerText.trim();
                        const style = window.getComputedStyle(skip);
                        // Only click if it's actually the skip button (visible, has text)
                        if (style.display === 'none' || style.visibility === 'hidden') {
                            return { clicked: false, reason: 'hidden', text, rect: {x: rect.x, y: rect.y, w: rect.width, h: rect.height} };
                        }
                        skip.click();
                        return { clicked: true, text, rect: {x: rect.x, y: rect.y, w: rect.width, h: rect.height} };
                    }""")
                    logger.info("Skip ad %d result: %s", ads_skipped, click_info)
                    await self._close_popups()
                    await asyncio.sleep(2)
                except Exception as e:
                    logger.warning("Skip click failed: %s", e)

            else:
                no_skip_streak += 1
                still_ad = await self._is_in_ad_mode(frame)

                if still_ad:
                    # Still in ad mode but no skip button — maybe selector changed
                    if no_skip_streak == 3 and not gemini_skip_used:
                        # Try Gemini to find the skip button
                        skip_el = await self._find_skip_button(frame)
                        if skip_el:
                            gemini_skip_used = True
                            try:
                                # Wait for countdown on this element too
                                text = await skip_el.inner_text()
                                while text and "ใน" in text:
                                    await asyncio.sleep(1)
                                    text = await skip_el.inner_text()

                                await skip_el.click(force=True, timeout=2000)
                                ads_skipped += 1
                                no_skip_streak = 0
                                await self._close_popups()
                                await asyncio.sleep(2)
                                continue
                            except Exception as e:
                                logger.warning("Gemini skip click failed: %s", e)

                    if no_skip_streak <= 5:
                        await asyncio.sleep(2)
                        continue
                    else:
                        await self._report("loading_player", "รอโฆษณาจบ...")
                        await asyncio.sleep(3)
                        continue
                else:
                    if no_skip_streak >= 2:
                        logger.info("Ad mode ended after %d skips", ads_skipped)
                        break
                    else:
                        await asyncio.sleep(2)
                        continue

        if ads_skipped:
            await self._report("loading_player", f"ข้ามโฆษณาแล้ว {ads_skipped} รายการ")

        await self._report("loading_player", "รอหนังเริ่ม...")
        await asyncio.sleep(3)

    # ──────────────────────────────────────────────
    # Movie verification
    # ──────────────────────────────────────────────

    async def _find_video_frame(self) -> tuple[Frame | None, dict | None]:
        """Search ALL frames (including nested iframes) for a video element."""
        for f in self.page.frames:
            try:
                info = await f.evaluate("""() => {
                    const video = document.querySelector('video');
                    if (!video) return null;
                    const d = video.duration;
                    return {
                        paused: video.paused,
                        duration: (d && isFinite(d)) ? d : 0,
                        currentTime: video.currentTime || 0,
                        readyState: video.readyState,
                        src: (video.src || video.currentSrc || '').substring(0, 80),
                    };
                }""")
                if info:
                    return f, info
            except Exception:
                continue
        return None, None

    async def _is_movie_playing(self, frame: Frame) -> bool:
        """Check if the actual movie is playing. Searches all frames for the video."""
        try:
            if await self._is_in_ad_mode(frame):
                return False

            for attempt in range(6):
                video_frame, info = await self._find_video_frame()

                if not info:
                    if attempt < 3:
                        logger.info("No video element in any frame, attempt %d", attempt)
                        await asyncio.sleep(2)
                        continue
                    # Still no video after retries
                    logger.info("No video element found after retries, asking Gemini...")
                    analysis = await self._healer.analyze_page()
                    if analysis:
                        await self._report("loading_player", f"AI: {analysis[:150]}")
                    return False

                duration = info.get("duration", 0) or 0
                paused = info.get("paused", True)
                current_time = info.get("currentTime", 0) or 0
                ready = info.get("readyState", 0) or 0

                logger.info("Video attempt %d: duration=%.1f ct=%.1f paused=%s ready=%d src=%s",
                            attempt, duration, current_time, paused, ready, info.get("src", ""))

                # Case 1: Video is playing with known long duration
                if duration > 60 and not paused:
                    return True

                # Case 2: Video is not paused and currentTime is advancing
                if not paused and current_time > 0:
                    return True

                # Case 3: Video not paused, has src, readyState >= 2 — verify time advances
                if not paused and ready >= 2 and info.get("src"):
                    await asyncio.sleep(2)
                    ct2 = await video_frame.evaluate("""() => {
                        const v = document.querySelector('video');
                        return v ? v.currentTime : 0;
                    }""")
                    if ct2 and ct2 > current_time:
                        return True

                # Video paused or not started — try to play
                if paused or ready < 2:
                    if attempt < 2:
                        await self._report("loading_player", "กำลังเริ่มเล่นวิดีโอ...")

                    await video_frame.evaluate("""() => {
                        const v = document.querySelector('video');
                        if (!v) return;
                        v.play().catch(() => { v.muted = true; v.play(); });
                    }""")

                    # Also try JWPlayer play button
                    try:
                        play_btn = video_frame.locator(".jw-icon-playback, .jw-display-icon-container").first
                        if await play_btn.is_visible(timeout=1000):
                            await play_btn.click(force=True, timeout=2000)
                    except Exception:
                        pass

                    await asyncio.sleep(3)
                    continue

                await asyncio.sleep(2)

            return False
        except Exception as e:
            logger.warning("Error checking movie state: %s", e)
            return False

    # ──────────────────────────────────────────────
    # Fullscreen
    # ──────────────────────────────────────────────

    async def _enter_fullscreen(self, frame: Frame):
        """Enter fullscreen. Falls back to Gemini if button not found."""
        try:
            await frame.hover(".jwplayer", timeout=3000)
            await asyncio.sleep(0.5)

            # Try normal selectors
            for sel in FULLSCREEN_SELECTORS:
                try:
                    btn = frame.locator(sel).first
                    if await btn.is_visible(timeout=1000):
                        await btn.click(timeout=2000)
                        logger.info("Clicked fullscreen: %s", sel)
                        await asyncio.sleep(1)
                        return
                except Exception:
                    continue

            # Try JWPlayer JS API
            result = await frame.evaluate("""() => {
                try {
                    const api = jwplayer();
                    if (api && api.setFullscreen) { api.setFullscreen(true); return true; }
                } catch(e) {}
                return false;
            }""")
            if result:
                logger.info("Fullscreen via JS API")
                return

            # Gemini fallback: find fullscreen button
            logger.info("Fullscreen button not found, asking Gemini...")
            clicked = await self._healer.find_and_click(
                frame, FULLSCREEN_SELECTORS, "find_fullscreen_button", timeout=3000
            )
            if clicked:
                return

            # Last resort: keyboard
            await self.page.keyboard.press("f")

        except Exception as e:
            logger.warning("Fullscreen failed: %s", e)
            try:
                await self.page.keyboard.press("f")
            except Exception:
                pass

    # ──────────────────────────────────────────────
    # Utilities
    # ──────────────────────────────────────────────

    async def _close_popups(self):
        """Close any popup windows/tabs opened by ads."""
        try:
            for p in self.page.context.pages:
                if p != self.page:
                    logger.info("Closing popup: %s", p.url[:60])
                    await p.close()
        except Exception:
            pass
