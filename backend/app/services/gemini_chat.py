import json
import logging
import re
from typing import Optional
from urllib.parse import quote

import httpx

from app.config import settings
from app.services.database import search_movies, upsert_movies
from app.services.scraper import scrape_movies

logger = logging.getLogger(__name__)

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)


def _extract_json(text: str) -> Optional[dict]:
    """Extract JSON from Gemini response."""
    text = text.strip()
    fence_match = re.search(r'```(?:json)?\s*\n?(.*?)```', text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    brace_match = re.search(r'\{.*\}', text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            pass
    return None


async def _ask_gemini(prompt: str) -> Optional[dict]:
    """Send a prompt to Gemini and return parsed JSON response."""
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 4096,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GEMINI_URL,
                params={"key": settings.gemini_api_key},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        candidates = data.get("candidates", [])
        if not candidates:
            return None

        raw = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        logger.info("Gemini raw: %s", raw[:300])
        return _extract_json(raw)
    except Exception as e:
        logger.error("Gemini API error: %s", e)
        return None


async def _search_website(keywords: list[str]) -> list[dict]:
    """Search website with keywords, return deduplicated movies."""
    seen_urls: set[str] = set()
    results: list[dict] = []

    for kw in keywords:
        kw = kw.strip()
        if not kw:
            continue
        try:
            result = await scrape_movies(1, search=quote(kw))
            for m in result.get("movies", []):
                if m["url"] not in seen_urls:
                    seen_urls.add(m["url"])
                    m.setdefault("genres", "")
                    m.setdefault("plot", "")
                    m.setdefault("year", "")
                    ym = re.search(r'\((\d{4})\)', m.get("title", ""))
                    if ym:
                        m["year"] = ym.group(1)
                    results.append(m)
        except Exception as e:
            logger.warning("Website search failed for '%s': %s", kw, e)

    return results


async def detect_intent(user_query: str) -> dict:
    """
    Detect if user wants music or movie.
    Returns: {"intent": "music"|"movie", "search_query": "...", "num_results": 1-5}
    """
    if not settings.gemini_api_key:
        return {"intent": "movie", "search_query": user_query}

    prompt = f"""ผู้ใช้พิมพ์: "{user_query}"

วิเคราะห์ว่าผู้ใช้ต้องการอะไร แล้วตอบ JSON:
{{
  "intent": "music" หรือ "youtube" หรือ "movie",
  "search_query": "คำค้นหาที่เหมาะสมสำหรับ YouTube (กรณี music/youtube)",
  "message": "ข้อความตอบกลับสั้นๆ เป็นภาษาไทยเป็นกันเอง"
}}

กฎ:
- intent="music" ถ้าผู้ใช้ต้องการฟังเพลง เปิดเพลง เล่นเพลง ดู MV หรือพูดถึงศิลปิน/วง/นักร้อง
- intent="youtube" ถ้าผู้ใช้พูดถึง YouTube หรือต้องการค้นหา/ดูคลิปใน YouTube (ไม่จำเป็นต้องเป็นเพลง อาจเป็นคลิปทั่วไป รีวิว สารคดี ฯลฯ)
- intent="movie" ถ้าผู้ใช้ต้องการดูหนัง ซีรีส์ anime การ์ตูน (ไม่ได้พูดถึง YouTube)
- search_query: แก้คำผิด สร้างคำค้นที่เหมาะสมสำหรับ YouTube เพิ่ม "official" หรือ "MV" ถ้าเป็นเพลง
- ถ้าไม่แน่ใจ ให้เดาจากบริบท"""

    result = await _ask_gemini(prompt)
    if not result:
        return {"intent": "movie", "search_query": user_query}

    return {
        "intent": result.get("intent", "movie"),
        "search_query": result.get("search_query", user_query),
        "message": result.get("message", ""),
    }


async def recommend_movies(user_query: str) -> Optional[dict]:
    """
    Movie search/recommendation using Gemini + DB + website.

    Flow:
    1. User query → ask Gemini for search keywords
    2. Search our database with those keywords
    3. Ask Gemini to verify if results match user's intent
       - If yes → return results
       - If no → search website to update DB, then re-check
    4. If still nothing after web search → recommend 5 similar movies from DB
    """
    if not settings.gemini_api_key:
        results = await search_movies(user_query, limit=5)
        if results:
            return {"message": f"พบ {len(results)} เรื่องที่เกี่ยวข้อง:", "movies": results}
        return {"message": "ไม่พบหนังที่ตรงกับคำค้นหา", "movies": []}

    # --- Step 1: Ask Gemini for search keywords ---
    keyword_prompt = f"""ผู้ใช้พิมพ์: "{user_query}"

วิเคราะห์ว่าผู้ใช้ต้องการหาหนังอะไร แล้วตอบ JSON:
{{
  "keywords": ["keyword1", "keyword2", ...],
  "message": "ข้อความตอบกลับสั้นๆ เป็นภาษาไทยเป็นกันเอง"
}}

กฎการสร้าง keywords:
- ใช้ชื่อภาษาอังกฤษเป็นหลัก เช่น "Avengers", "Harry Potter"
- แต่ละ keyword ควรสั้นกระชับ 1-3 คำ เพื่อให้ค้นเจอง่าย
- ถ้าผู้ใช้ถามหนังเฉพาะเรื่อง ให้ใส่ชื่อหนังและชื่อย่อต่างๆ ที่เป็นไปได้
- ถ้าผู้ใช้ขอแนะนำแนว/ประเภท ให้ใส่ชื่อหนังดังๆ ในแนวนั้น 10-15 เรื่อง
- ถ้ามีเลขภาค ใส่ด้วย เช่น "Avengers 4", "Iron Man 3"
- ใส่ทั้งชื่อเต็มและชื่อย่อ เช่น ["Harry Potter 1", "Harry Potter", "Philosopher Stone"]"""

    keyword_result = await _ask_gemini(keyword_prompt)
    if not keyword_result:
        results = await search_movies(user_query, limit=5)
        return {"message": "ลองค้นหาให้แล้วค่ะ:", "movies": results}

    keywords = keyword_result.get("keywords", [])
    message = keyword_result.get("message", "")
    logger.info("Keywords from Gemini: %s", keywords)

    # --- Step 2: Search database with keywords ---
    db_results = []
    seen_urls: set[str] = set()
    for kw in keywords:
        matches = await search_movies(kw, limit=20)
        for m in matches:
            if m["url"] not in seen_urls:
                seen_urls.add(m["url"])
                db_results.append(m)

    logger.info("DB search found %d movies", len(db_results))

    # --- Step 3: Ask Gemini to verify results ---
    if db_results:
        verified = await _verify_movies(user_query, db_results)
        if verified:
            return {"message": message, "movies": verified}

    # --- Step 4: Not found in DB → search website to update DB ---
    logger.info("DB results insufficient, searching website...")
    web_movies = await _search_website(keywords)

    if web_movies:
        # Save new movies to database
        try:
            await upsert_movies(web_movies)
            logger.info("Upserted %d movies from web search", len(web_movies))
        except Exception as e:
            logger.warning("Failed to upsert web movies: %s", e)

        # Re-search database (now includes new web results)
        db_results = []
        seen_urls = set()
        for kw in keywords:
            matches = await search_movies(kw, limit=20)
            for m in matches:
                if m["url"] not in seen_urls:
                    seen_urls.add(m["url"])
                    db_results.append(m)

        logger.info("DB search after web update found %d movies", len(db_results))

        if db_results:
            verified = await _verify_movies(user_query, db_results)
            if verified:
                return {"message": message, "movies": verified}

    # --- Step 5: Still nothing → recommend 5 similar movies from DB ---
    logger.info("No exact match found, asking Gemini for similar recommendations...")
    similar = await _recommend_similar(user_query)
    if similar:
        return {
            "message": f"{message}\n\nไม่พบหนังที่ต้องการ แต่ขอแนะนำหนังแนวเดียวกัน:",
            "movies": similar,
        }

    return {"message": message or "ไม่พบหนังที่ตรงกับคำค้นหา", "movies": []}


async def _verify_movies(user_query: str, candidates: list[dict]) -> Optional[list[dict]]:
    """Ask Gemini to check if candidates match what the user wants."""
    # Build compact movie list for Gemini
    movie_list = []
    for i, m in enumerate(candidates[:30]):  # limit to 30 for prompt size
        movie_list.append(f"{i}: {m.get('title', '')} | {m.get('genres', '')} | {m.get('year', '')}")

    movies_text = "\n".join(movie_list)

    verify_prompt = f"""ผู้ใช้ต้องการ: "{user_query}"

รายชื่อหนังที่ค้นเจอจากฐานข้อมูล:
{movies_text}

ตรวจสอบว่าหนังไหนตรงกับที่ผู้ใช้ต้องการ ตอบ JSON:
{{
  "found": true/false,
  "selected_indexes": [0, 3, 5],
  "message": "ข้อความตอบกลับเป็นภาษาไทยเป็นกันเอง"
}}

กฎ:
- found=true ถ้ามีหนังที่ตรงหรือเกี่ยวข้องกับที่ผู้ใช้ต้องการ
- found=false ถ้าไม่มีหนังที่ตรงเลย
- selected_indexes คือ index ของหนังที่ตรง/เกี่ยวข้อง (เรียงจากตรงมากไปน้อย สูงสุด 10 เรื่อง)
- ถ้าผู้ใช้ถามหนังเฉพาะเรื่อง ให้เลือกเฉพาะเรื่องที่ตรง
- ถ้าผู้ใช้ขอแนะนำแนว ให้เลือกหนังที่ดีที่สุดในแนวนั้น"""

    result = await _ask_gemini(verify_prompt)
    if not result:
        return None

    if not result.get("found", False):
        return None

    selected = result.get("selected_indexes", [])
    if not selected:
        return None

    movies = []
    for idx in selected:
        if isinstance(idx, int) and 0 <= idx < len(candidates):
            movies.append(candidates[idx])

    return movies if movies else None


async def _recommend_similar(user_query: str) -> Optional[list[dict]]:
    """When no match found, recommend 5 similar movies from our database."""
    similar_prompt = f"""ผู้ใช้ต้องการ: "{user_query}"
แต่ไม่พบหนังที่ตรง ช่วยแนะนำชื่อหนังแนวเดียวกันที่น่าจะมีในเว็บดูหนังไทย 5 เรื่อง

ตอบ JSON:
{{
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
}}

กฎ: ใช้ชื่อภาษาอังกฤษสั้นๆ 1-3 คำ"""

    result = await _ask_gemini(similar_prompt)
    if not result:
        return None

    keywords = result.get("keywords", [])
    movies: list[dict] = []
    seen_urls: set[str] = set()

    for kw in keywords:
        if len(movies) >= 5:
            break
        matches = await search_movies(kw, limit=5)
        for m in matches:
            if m["url"] not in seen_urls and len(movies) < 5:
                seen_urls.add(m["url"])
                movies.append(m)

    return movies if movies else None
