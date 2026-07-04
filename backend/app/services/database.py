import aiosqlite
import logging
import os
import random
import string
from typing import Optional

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "movies.db")


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    """Create tables if they don't exist."""
    db = await get_db()
    try:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS movies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                url TEXT UNIQUE NOT NULL,
                slug TEXT,
                poster TEXT,
                rating TEXT,
                quality TEXT,
                language TEXT,
                genres TEXT DEFAULT '',
                plot TEXT DEFAULT '',
                year TEXT DEFAULT '',
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                picture TEXT,
                monitor_token TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS watch_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL,
                url TEXT NOT NULL,
                title TEXT DEFAULT '',
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS downloaded_movies (
                url TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS stream_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_url TEXT NOT NULL,
                episode_index INTEGER DEFAULT -1,
                stream_url TEXT NOT NULL,
                title TEXT DEFAULT '',
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(page_url, episode_index)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS episode_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_url TEXT NOT NULL,
                episode_index INTEGER NOT NULL,
                episode_text TEXT NOT NULL,
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(page_url, episode_index)
            )
        """)
        # Migrate watch_history columns (safe to re-run)
        for col, coldef in [
            ("poster", "TEXT DEFAULT ''"),
            ("episode_index", "INTEGER DEFAULT -1"),
            ("episode_text", "TEXT DEFAULT ''"),
            ("current_time", "REAL DEFAULT 0"),
            ("duration", "REAL DEFAULT 0"),
        ]:
            try:
                await db.execute(f"ALTER TABLE watch_history ADD COLUMN {col} {coldef}")
            except Exception:
                pass  # Column already exists
        await db.commit()
        logger.info("Database initialized at %s", DB_PATH)
    finally:
        await db.close()


def _generate_short_token(length: int = 5) -> str:
    """Generate a short alphanumeric token (e.g. 'vd7Sc')."""
    chars = string.ascii_letters + string.digits
    return "".join(random.choice(chars) for _ in range(length))


async def get_or_create_user(email: str, name: str = "", picture: str = "") -> dict:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE email = ?", (email,))
        row = await cursor.fetchone()
        if row:
            user = dict(row)
            # Migrate long tokens to short 5-char tokens
            if len(user.get("monitor_token", "")) > 5:
                new_token = _generate_short_token()
                await db.execute(
                    "UPDATE users SET monitor_token = ? WHERE id = ?",
                    (new_token, user["id"]),
                )
                await db.commit()
                user["monitor_token"] = new_token
            return user
        # Generate unique 5-char token
        for _ in range(100):
            token = _generate_short_token()
            existing = await db.execute(
                "SELECT 1 FROM users WHERE monitor_token = ?", (token,)
            )
            if not await existing.fetchone():
                break
        await db.execute(
            "INSERT INTO users (email, name, picture, monitor_token) VALUES (?, ?, ?, ?)",
            (email, name, picture, token),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM users WHERE email = ?", (email,))
        row = await cursor.fetchone()
        return dict(row)
    finally:
        await db.close()


async def get_user_by_id(user_id: int) -> Optional[dict]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_user_by_monitor_token(token: str) -> Optional[dict]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE monitor_token = ?", (token,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def upsert_movie(movie: dict):
    """Insert or update a movie record."""
    db = await get_db()
    try:
        await db.execute("""
            INSERT INTO movies (title, url, slug, poster, rating, quality, language, genres, plot, year)
            VALUES (:title, :url, :slug, :poster, :rating, :quality, :language, :genres, :plot, :year)
            ON CONFLICT(url) DO UPDATE SET
                title=excluded.title, poster=excluded.poster, rating=excluded.rating,
                quality=excluded.quality, language=excluded.language,
                genres=CASE WHEN excluded.genres != '' THEN excluded.genres ELSE movies.genres END,
                plot=CASE WHEN excluded.plot != '' THEN excluded.plot ELSE movies.plot END,
                year=CASE WHEN excluded.year != '' THEN excluded.year ELSE movies.year END,
                cached_at=CURRENT_TIMESTAMP
        """, {
            "title": movie.get("title", ""),
            "url": movie.get("url", ""),
            "slug": movie.get("slug", ""),
            "poster": movie.get("poster", ""),
            "rating": movie.get("rating", ""),
            "quality": movie.get("quality", ""),
            "language": movie.get("language", ""),
            "genres": movie.get("genres", ""),
            "plot": movie.get("plot", ""),
            "year": movie.get("year", ""),
        })
        await db.commit()
    finally:
        await db.close()


async def upsert_movies(movies: list[dict]):
    """Batch upsert movies."""
    db = await get_db()
    try:
        for movie in movies:
            await db.execute("""
                INSERT INTO movies (title, url, slug, poster, rating, quality, language, genres, plot, year)
                VALUES (:title, :url, :slug, :poster, :rating, :quality, :language, :genres, :plot, :year)
                ON CONFLICT(url) DO UPDATE SET
                    title=excluded.title, poster=excluded.poster, rating=excluded.rating,
                    quality=excluded.quality, language=excluded.language,
                    genres=CASE WHEN excluded.genres != '' THEN excluded.genres ELSE movies.genres END,
                    plot=CASE WHEN excluded.plot != '' THEN excluded.plot ELSE movies.plot END,
                    year=CASE WHEN excluded.year != '' THEN excluded.year ELSE movies.year END,
                    cached_at=CURRENT_TIMESTAMP
            """, {
                "title": movie.get("title", ""),
                "url": movie.get("url", ""),
                "slug": movie.get("slug", ""),
                "poster": movie.get("poster", ""),
                "rating": movie.get("rating", ""),
                "quality": movie.get("quality", ""),
                "language": movie.get("language", ""),
                "genres": movie.get("genres", ""),
                "plot": movie.get("plot", ""),
                "year": movie.get("year", ""),
            })
        await db.commit()
        logger.info("Upserted %d movies", len(movies))
    finally:
        await db.close()


async def search_movies(query: str, limit: int = 20) -> list[dict]:
    """Search movies by title (fuzzy LIKE match)."""
    db = await get_db()
    try:
        terms = query.strip().split()
        if not terms:
            return []

        # Build WHERE clause: each term must match title OR genres OR plot
        conditions = []
        params = {}
        for i, term in enumerate(terms):
            key = f"t{i}"
            conditions.append(
                f"(title LIKE :{key} OR genres LIKE :{key} OR plot LIKE :{key})"
            )
            params[key] = f"%{term}%"

        where = " AND ".join(conditions)
        sql = f"SELECT * FROM movies WHERE {where} ORDER BY cached_at DESC LIMIT :limit"
        params["limit"] = limit

        cursor = await db.execute(sql, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_recent_movies(limit: int = 20) -> list[dict]:
    """Get most recently cached movies."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT title, url, slug, poster, rating, quality, language "
            "FROM movies ORDER BY cached_at DESC LIMIT ?",
            (limit,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_all_movies_summary(limit: int = 2000) -> list[dict]:
    """Get all movies with title, genres, rating, language, url for AI context."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT title, url, poster, rating, quality, language, genres, plot, year "
            "FROM movies ORDER BY cached_at DESC LIMIT ?",
            (limit,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_movie_count() -> int:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT COUNT(*) FROM movies")
        row = await cursor.fetchone()
        return row[0]
    finally:
        await db.close()


async def log_watch(user_email: str, url: str, title: str = ""):
    """Log a user's watch event for analytics."""
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO watch_history (user_email, url, title) VALUES (?, ?, ?)",
            (user_email, url, title),
        )
        await db.commit()
    finally:
        await db.close()


async def get_app_setting(key: str, default: str = "") -> str:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else default
    finally:
        await db.close()


async def set_app_setting(key: str, value: str):
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await db.commit()
    finally:
        await db.close()


async def get_all_watch_history(limit: int = 200) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            """
            SELECT wh.user_email, u.name as user_name, u.picture as user_picture,
                   wh.url, wh.title, wh.started_at
            FROM watch_history wh
            LEFT JOIN users u ON wh.user_email = u.email
            ORDER BY wh.started_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_popular_movies() -> list[dict]:
    """Aggregate watch history by URL, count unique users, return sorted by viewer count."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """
            SELECT url, MAX(title) as title,
                   COUNT(DISTINCT user_email) as viewer_count,
                   COUNT(*) as play_count,
                   MAX(started_at) as last_watched
            FROM watch_history
            WHERE url != ''
            GROUP BY url
            ORDER BY viewer_count DESC, play_count DESC
            """,
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


async def get_viewer_count(url: str) -> int:
    """Get number of unique viewers for a URL."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT COUNT(DISTINCT user_email) FROM watch_history WHERE url = ?",
            (url,),
        )
        row = await cursor.fetchone()
        return row[0] if row else 0
    finally:
        await db.close()


async def mark_downloaded(url: str, filename: str):
    """Record that a URL has been downloaded to a file."""
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO downloaded_movies (url, filename) VALUES (?, ?) ON CONFLICT(url) DO UPDATE SET filename = excluded.filename, downloaded_at = CURRENT_TIMESTAMP",
            (url, filename),
        )
        await db.commit()
    finally:
        await db.close()


async def get_downloaded_urls() -> dict[str, str]:
    """Get all downloaded URL -> filename mappings."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT url, filename FROM downloaded_movies")
        rows = await cursor.fetchall()
        return {row["url"]: row["filename"] for row in rows}
    finally:
        await db.close()


async def remove_downloaded(filename: str):
    """Remove download record when file is deleted."""
    db = await get_db()
    try:
        await db.execute("DELETE FROM downloaded_movies WHERE filename = ?", (filename,))
        await db.commit()
    finally:
        await db.close()


# ── Stream Cache ──────────────────────────────────────────

async def upsert_stream_cache(page_url: str, episode_index: int, stream_url: str, title: str = ""):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO stream_cache (page_url, episode_index, stream_url, title)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(page_url, episode_index) DO UPDATE SET
                   stream_url = excluded.stream_url,
                   title = CASE WHEN excluded.title != '' THEN excluded.title ELSE stream_cache.title END,
                   cached_at = CURRENT_TIMESTAMP""",
            (page_url, episode_index, stream_url, title),
        )
        await db.commit()
    finally:
        await db.close()


async def get_cached_stream(page_url: str, episode_index: int = -1) -> Optional[str]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT stream_url FROM stream_cache WHERE page_url = ? AND episode_index = ?",
            (page_url, episode_index),
        )
        row = await cursor.fetchone()
        return row["stream_url"] if row else None
    finally:
        await db.close()


async def delete_stream_cache(page_url: str, episode_index: int = -1):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM stream_cache WHERE page_url = ? AND episode_index = ?",
            (page_url, episode_index),
        )
        await db.commit()
    finally:
        await db.close()


# ── Enhanced Watch History ────────────────────────────────

async def log_watch_enhanced(
    user_email: str, url: str, title: str = "", poster: str = "",
    episode_index: int = -1, episode_text: str = "",
):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO watch_history
               (user_email, url, title, poster, episode_index, episode_text)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_email, url, title, poster, episode_index, episode_text),
        )
        await db.commit()
    finally:
        await db.close()


async def get_user_history(user_email: str, limit: int = 30) -> list[dict]:
    """Get user's watch history, deduplicated by url (latest per url).
    Joins with movies table to fill in poster/title if watch_history is missing them."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT wh.url, wh.title, wh.poster, wh.episode_index, wh.episode_text,
                      wh.current_time, wh.duration, wh.started_at,
                      m.poster as movie_poster, m.title as movie_title
               FROM watch_history wh
               LEFT JOIN movies m ON wh.url = m.url
               WHERE wh.user_email = ? AND wh.id IN (
                   SELECT MAX(id) FROM watch_history WHERE user_email = ? GROUP BY url
               )
               ORDER BY wh.started_at DESC
               LIMIT ?""",
            (user_email, user_email, limit),
        )
        rows = await cursor.fetchall()
        result = []
        for row in rows:
            d = dict(row)
            # Use movie data as fallback
            if not d.get("poster") and d.get("movie_poster"):
                d["poster"] = d["movie_poster"]
            if not d.get("title") and d.get("movie_title"):
                d["title"] = d["movie_title"]
            d.pop("movie_poster", None)
            d.pop("movie_title", None)
            result.append(d)
        return result
    finally:
        await db.close()


async def update_watch_progress(
    user_email: str, url: str, current_time: float, duration: float,
    episode_index: int = -1,
):
    db = await get_db()
    try:
        await db.execute(
            """UPDATE watch_history SET current_time = ?, duration = ?
               WHERE id = (
                   SELECT MAX(id) FROM watch_history
                   WHERE user_email = ? AND url = ? AND episode_index = ?
               )""",
            (current_time, duration, user_email, url, episode_index),
        )
        await db.commit()
    finally:
        await db.close()


async def get_user_progress(user_email: str) -> dict:
    """Get all watch progress for a user, keyed by url or url::ep{n}."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT url, episode_index, current_time, duration
               FROM watch_history
               WHERE user_email = ? AND current_time > 0
                 AND id IN (
                     SELECT MAX(id) FROM watch_history
                     WHERE user_email = ? GROUP BY url, episode_index
                 )""",
            (user_email, user_email),
        )
        rows = await cursor.fetchall()
        result = {}
        for row in rows:
            ep = row["episode_index"]
            key = f"{row['url']}::ep{ep}" if ep >= 0 else row["url"]
            result[key] = {"currentTime": row["current_time"], "duration": row["duration"]}
        return result
    finally:
        await db.close()


async def get_last_episode(user_email: str, url: str) -> Optional[int]:
    """Get last watched episode index for a series URL."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT episode_index FROM watch_history
               WHERE user_email = ? AND url = ? AND episode_index >= 0
               ORDER BY id DESC LIMIT 1""",
            (user_email, url),
        )
        row = await cursor.fetchone()
        return row["episode_index"] if row else None
    finally:
        await db.close()


# ── Episode Cache ─────────────────────────────────────────

async def save_episode_cache(page_url: str, episodes: list[dict]):
    """Save episode list for a page URL."""
    db = await get_db()
    try:
        # Clear old episodes for this URL and insert fresh
        await db.execute("DELETE FROM episode_cache WHERE page_url = ?", (page_url,))
        for ep in episodes:
            await db.execute(
                """INSERT INTO episode_cache (page_url, episode_index, episode_text)
                   VALUES (?, ?, ?)""",
                (page_url, ep.get("index", 0), ep.get("text", "")),
            )
        await db.commit()
    finally:
        await db.close()


async def get_episode_cache(page_url: str) -> list[dict]:
    """Get cached episode list for a page URL."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT episode_index, episode_text FROM episode_cache WHERE page_url = ? ORDER BY episode_index",
            (page_url,),
        )
        rows = await cursor.fetchall()
        return [{"index": row["episode_index"], "text": row["episode_text"], "active": False} for row in rows]
    finally:
        await db.close()
