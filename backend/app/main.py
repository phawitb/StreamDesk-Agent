import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.api.routes import router
from app.api.auth import router as auth_router
from app.config import settings
from app.services.agent_manager import agent_manager
from app.services.database import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await agent_manager.start()
    yield
    await agent_manager.stop()


app = FastAPI(title="StreamDesk Agent", lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key=settings.session_secret)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(router)

# Serve downloaded videos as static files
downloads_dir = Path(__file__).parent.parent / "downloads"
downloads_dir.mkdir(exist_ok=True)
app.mount("/downloads", StaticFiles(directory=str(downloads_dir)), name="downloads")

# Serve frontend build (must be last mount)
frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
