import asyncio
import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.services.agent_manager import agent_manager
from app.services.monitor_browser import open_monitor, close_monitor
from app.services.database import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    await agent_manager.start()
    asyncio.create_task(_start_monitor())
    yield
    # Shutdown
    await close_monitor()
    await agent_manager.stop()


async def _start_monitor():
    await asyncio.sleep(2)
    try:
        await open_monitor()
    except Exception as e:
        logging.getLogger(__name__).warning("Monitor browser: %s", e)


app = FastAPI(title="StreamDesk Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Serve downloaded videos as static files
downloads_dir = Path(__file__).parent.parent / "downloads"
downloads_dir.mkdir(exist_ok=True)
app.mount("/downloads", StaticFiles(directory=str(downloads_dir)), name="downloads")
