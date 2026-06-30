from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel


class AgentState(str, Enum):
    IDLE = "idle"
    LAUNCHING = "launching"
    NAVIGATING = "navigating"
    LOADING_PLAYER = "loading_player"
    PLAYING = "playing"
    ERROR = "error"


class PlayRequest(BaseModel):
    type: str = "play_request"
    url: Optional[str] = None
    query: Optional[str] = None


class Command(BaseModel):
    type: str = "command"
    action: str  # stop, fullscreen


class StatusMessage(BaseModel):
    type: str = "status"
    state: AgentState
    message: str
    url: Optional[str] = None
    title: Optional[str] = None
    timestamp: str = ""

    def __init__(self, **data):
        if not data.get("timestamp"):
            data["timestamp"] = datetime.now().isoformat()
        super().__init__(**data)


class ChatMessage(BaseModel):
    type: str = "chat"
    role: str = "assistant"
    content: str


class ErrorMessage(BaseModel):
    type: str = "error"
    message: str
    recoverable: bool = True
