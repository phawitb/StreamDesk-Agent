from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    headless: bool = True
    browser_slow_mo: int = 0
    gemini_api_key: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    session_secret: str = "change-me-in-production"

    class Config:
        env_file = ".env"


settings = Settings()
