import aiosqlite
import logging
import os
import secrets
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
        await db.commit()
        logger.info("Database initialized at %s", DB_PATH)
    finally:
        await db.close()


async def get_or_create_user(email: str, name: str = "", picture: str = "") -> dict:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE email = ?", (email,))
        row = await cursor.fetchone()
        if row:
            return dict(row)
        token = secrets.token_urlsafe(16)
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
