from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DATA_DIR = REPO_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "OneMoon API"
    api_prefix: str = "/api"
    jwt_secret: str = "change-me-in-production"
    access_token_expiry_minutes: int = 60 * 12
    admin_username: str = "admin"
    admin_password: str = "onemoon"
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    allowed_origin_regex: str = (
        r"^https?://("
        r"localhost|127\.0\.0\.1|"
        r"10(?:\.\d{1,3}){3}|"
        r"192\.168(?:\.\d{1,3}){2}|"
        r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}"
        r")(?::\d+)?$"
    )
    data_dir: Path = DEFAULT_DATA_DIR
    database_url: str = f"sqlite:///{(DEFAULT_DATA_DIR / 'onemoon.db').as_posix()}"
    llm_provider: str = "mock"
    llm_model: str = "mock-notes-v1"
    render_dpi: int = 180

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, list):
            return value
        if not value:
            return []
        return [origin.strip() for origin in value.split(",") if origin.strip()]

    @field_validator("data_dir", mode="before")
    @classmethod
    def normalize_data_dir(cls, value: str | Path) -> Path:
        return Path(value).expanduser().resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings
