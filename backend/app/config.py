from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    headless: bool = False
    browser_slow_mo: int = 0
    gemini_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
