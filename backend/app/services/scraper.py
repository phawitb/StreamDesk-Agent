import re
import logging
from typing import Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://www.24hd.net"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# Regex to extract background-image URL from inline style
BG_IMAGE_RE = re.compile(r'background-image\s*:\s*url\(["\']?(.*?)["\']?\)')


def _extract_bg_image(style_block: str, item_id: str) -> Optional[str]:
    """Extract background-image URL from a CSS style block for a specific loop item."""
    # Look for the specific item's background-image
    pattern = re.compile(
        rf'\.e-loop-item-{re.escape(item_id)}\s+[^{{]*\{{[^}}]*background-image\s*:\s*url\(["\']?(.*?)["\']?\)',
        re.DOTALL,
    )
    match = pattern.search(style_block)
    if match:
        return match.group(1)
    return None


async def scrape_movies(page: int = 1, category: str = "", search: str = "") -> dict:
    """
    Scrape movie listing from 24hd.net.
    Returns dict with movies list and pagination info.
    """
    if search:
        # Search URL: /?s=query or /page/N/?s=query
        if page <= 1:
            url = f"{BASE_URL}/?s={search}"
        else:
            url = f"{BASE_URL}/page/{page}/?s={search}"
    elif category:
        base = f"{BASE_URL}/category/{category}"
        url = base if page <= 1 else f"{base}/page/{page}/"
    else:
        url = BASE_URL if page <= 1 else f"{BASE_URL}/page/{page}/"

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")

    # Collect all inline style blocks for background-image extraction
    all_styles = "\n".join(
        style.string or "" for style in soup.find_all("style")
    )

    movies = []

    # Find all loop items (Elementor loop)
    loop_items = soup.select("[class*='e-loop-item-']")

    for item in loop_items:
        # Extract item ID from class
        item_classes = item.get("class", [])
        item_id = None
        for cls in item_classes:
            if cls.startswith("e-loop-item-"):
                item_id = cls.replace("e-loop-item-", "")
                break

        if not item_id:
            continue

        # Extract link
        link_el = item.select_one("a[href]")
        if not link_el:
            continue
        href = link_el.get("href", "")
        if not href or href == "#" or BASE_URL not in href:
            continue

        # Extract title from heading
        title_el = item.select_one(
            ".elementor-heading-title, h3, h2, [class*='heading']"
        )
        # Sometimes the title is the last heading in the card
        headings = item.select(".elementor-heading-title")

        title = ""
        rating = ""
        quality = ""
        language = ""

        # Parse headings — typically: rating, quality, language, title (in order)
        heading_texts = [h.get_text(strip=True) for h in headings]

        LANG_KEYWORDS = ["พากย์", "ซับ", "Sound", "Soundtrack"]

        for text in heading_texts:
            if not text:
                continue
            # Rating: looks like a number (e.g., "8.7", "9.4")
            if re.match(r'^\d+\.?\d*$', text) and not rating:
                rating = text
            # Quality: HD, 4K, ZOOM, CAM, etc.
            elif text.upper() in ("HD", "4K", "ZOOM", "CAM", "HDCAM", "HDRIP", "DVDRIP"):
                quality = text
            # Long text with year pattern = title (even if it contains language keywords)
            elif len(text) > 15 and re.search(r'\(\d{4}\)', text):
                if len(text) > len(title):
                    # Extract language hint from title text
                    for kw in LANG_KEYWORDS:
                        if kw in text and not language:
                            language = kw + text.split(kw, 1)[1].split(")")[0] + ")" if ")" in text.split(kw, 1)[1] else kw
                            break
                    title = text
            # Language: short text like "พากย์ไทย", "ซับไทย" (not a full title)
            elif any(kw in text for kw in LANG_KEYWORDS) and len(text) < 30:
                language = text
            # Title: the longest text
            elif len(text) > len(title):
                title = text

        if not title:
            # Fallback: try getting text from any heading
            if title_el:
                title = title_el.get_text(strip=True)
            else:
                title = link_el.get_text(strip=True)

        if not title:
            continue

        # Extract poster image from style block
        poster = _extract_bg_image(all_styles, item_id) or ""

        # Also try img tag inside the item
        if not poster:
            img_el = item.select_one("img[src]")
            if img_el:
                poster = img_el.get("src", "") or img_el.get("data-src", "")

        # Extract slug from URL
        slug = href.rstrip("/").split("/")[-1]

        movies.append({
            "title": title,
            "url": href,
            "slug": slug,
            "poster": poster,
            "rating": rating,
            "quality": quality,
            "language": language,
        })

    # Deduplicate by URL
    seen_urls = set()
    unique_movies = []
    for m in movies:
        if m["url"] not in seen_urls:
            seen_urls.add(m["url"])
            unique_movies.append(m)

    # Pagination info
    total_pages = 1
    page_links = soup.select("a.page-numbers, a[class*='page']")
    for pl in page_links:
        href = pl.get("href", "")
        match = re.search(r'/page/(\d+)/', href)
        if match:
            p = int(match.group(1))
            if p > total_pages:
                total_pages = p

    logger.info("Scraped page %d: %d movies, %d total pages", page, len(unique_movies), total_pages)

    return {
        "page": page,
        "total_pages": total_pages,
        "count": len(unique_movies),
        "movies": unique_movies,
    }


async def scrape_categories() -> list[dict]:
    """Scrape genre/category list from the site."""
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(BASE_URL, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")

    categories = []
    seen = set()

    # Find category links
    for link in soup.select('a[href*="/category/"]'):
        href = link.get("href", "").rstrip("/")
        name = link.get_text(strip=True)
        if href and name and href not in seen:
            seen.add(href)
            slug = href.split("/category/")[-1].rstrip("/")
            categories.append({"name": name, "url": href, "slug": slug})

    return categories


async def scrape_movie_detail(url: str) -> dict:
    """Scrape extra metadata (genres, plot, year) from a movie detail page."""
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
    except Exception as e:
        logger.warning("Failed to fetch detail %s: %s", url, e)
        return {}

    soup = BeautifulSoup(resp.text, "lxml")
    text = soup.get_text(" ", strip=True)

    # Extract genres from category links on the page
    genres = []
    for link in soup.select('a[href*="/category/"]'):
        name = link.get_text(strip=True)
        if name and len(name) < 40:
            genres.append(name)

    # Extract year from title pattern like (2026)
    year = ""
    year_match = re.search(r'\((\d{4})\)', text)
    if year_match:
        year = year_match.group(1)

    # Extract plot/synopsis — look for long paragraphs
    plot = ""
    for p in soup.select("p"):
        p_text = p.get_text(strip=True)
        if len(p_text) > 50 and not any(kw in p_text.lower() for kw in ["copyright", "dmca", "ติดต่อ", "cookie"]):
            plot = p_text[:500]
            break

    return {
        "genres": ", ".join(dict.fromkeys(genres)),  # dedupe preserving order
        "plot": plot,
        "year": year,
    }


async def _sync_pages(label: str, callback=None, category: str = "", search: str = "") -> int:
    """Scrape all pages of a category or search query."""
    from app.services.database import upsert_movies

    saved = 0
    page_num = 1

    while True:
        if callback:
            await callback(f"[{label}] กำลังดึงหน้า {page_num}...")

        try:
            result = await scrape_movies(page_num, category=category, search=search)
        except Exception as e:
            logger.warning("Failed to scrape %s page %d: %s", label, page_num, e)
            break

        movies = result["movies"]
        if not movies:
            break

        for m in movies:
            m.setdefault("genres", "")
            m.setdefault("plot", "")
            m.setdefault("year", "")
            ym = re.search(r'\((\d{4})\)', m.get("title", ""))
            if ym:
                m["year"] = ym.group(1)

        await upsert_movies(movies)
        saved += len(movies)

        if page_num >= result.get("total_pages", 1):
            break
        page_num += 1

    logger.info("Synced %s: %d movies", label, saved)
    return saved


# Search terms for comprehensive scraping — use 2+ char terms to avoid server memory errors
SEARCH_TERMS = [
    # Common English movie title prefixes (2-char)
    "the", "man", "bad", "big", "red", "top", "war", "die", "spy",
    "ice", "run", "gun", "cop", "day", "god", "mad", "old", "new",
    "fast", "dark", "dead", "fear", "fire", "free", "game", "hero",
    "home", "hunt", "iron", "jack", "john", "king", "last", "life",
    "lion", "love", "lost", "miss", "moon", "night", "one", "star",
    "time", "wolf", "zero", "alien", "angel", "black", "blood",
    "bride", "death", "devil", "dream", "dragon", "ghost", "harry",
    "house", "magic", "money", "power", "queen", "robot", "rocky",
    "seven", "shark", "snake", "speed", "super", "sword", "titan",
    "train", "world", "zombie", "marvel", "avenger", "spider",
    "batman", "mission", "jurassic", "transformer", "pirates",
    # Thai keywords
    "หนัง", "ซีรี่ย์", "เกาหลี", "จีน", "ไทย", "ญี่ปุ่น", "อนิเมะ",
    "ผี", "รัก", "ตลก", "บู๊", "สงคราม", "มาร์เวล", "ดิสนีย์",
]


async def sync_all_movies(callback=None):
    """
    Scrape ALL pages of ALL categories + search A-Z and store to database.
    """
    from app.services.database import get_movie_count

    total_saved = 0

    # 1. Scrape main listing (all pages)
    if callback:
        await callback("กำลัง sync หน้าหลัก...")
    total_saved += await _sync_pages("หน้าหลัก", callback)

    # 2. Get all categories
    try:
        categories = await scrape_categories()
    except Exception as e:
        logger.warning("Failed to scrape categories: %s", e)
        categories = []

    # 3. Scrape each category (all pages)
    for i, cat in enumerate(categories, 1):
        slug = cat.get("slug", "")
        name = cat.get("name", slug)
        if callback:
            await callback(f"กำลัง sync หมวด {name} ({i}/{len(categories)})...")
        total_saved += await _sync_pages(name, callback, category=slug)

    # 4. Search A-Z, 0-9, common Thai keywords to find movies not in categories
    if callback:
        await callback("กำลัง sync จากการค้นหา A-Z, 0-9...")
    for i, term in enumerate(SEARCH_TERMS, 1):
        if callback and i % 5 == 1:
            await callback(f"กำลังค้นหา '{term}' ({i}/{len(SEARCH_TERMS)})...")
        total_saved += await _sync_pages(f"search:{term}", callback=None, search=term)

    count = await get_movie_count()
    msg = f"Sync เสร็จ! บันทึก {total_saved} รายการ (ทั้งหมดในฐานข้อมูล: {count} เรื่อง)"
    logger.info(msg)
    if callback:
        await callback(msg)

    return total_saved
