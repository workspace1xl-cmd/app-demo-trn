from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "OneWork API"
    environment: str = "development"
    database_url: str = "sqlite:///./onework.db"
    jwt_secret: str = "development-only-change-me"
    jwt_expiry_minutes: int = 480
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-4-5"
    cors_origins: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
