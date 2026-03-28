from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DATA_DIR = REPO_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        enable_decoding=False,
        extra="ignore",
    )

    app_name: str = "OneMoon API"
    api_prefix: str = "/api"
    jwt_secret: str = "change-me-in-production"
    access_token_expiry_minutes: int = 60 * 12
    admin_username: str = "admin"
    admin_password: str = "onemoon"
    allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    allowed_origin_regex: str = (
        r"^https?://("
        r"localhost|127\.0\.0\.1|"
        r"10(?:\.\d{1,3}){3}|"
        r"100\.(?:6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}|"
        r"192\.168(?:\.\d{1,3}){2}|"
        r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}"
        r")(?::\d+)?$"
    )
    data_dir: Path = DEFAULT_DATA_DIR
    database_url: str = f"sqlite:///{(DEFAULT_DATA_DIR / 'onemoon.db').as_posix()}"
    llm_provider: str = Field(
        default="mock",
        validation_alias=AliasChoices("ONEMOON_LLM_PROVIDER", "LLM_PROVIDER", "OPENAI_PROVIDER"),
    )
    llm_model: str = Field(
        default="gpt-4.1-mini",
        validation_alias=AliasChoices("ONEMOON_LLM_MODEL", "LLM_MODEL", "OPENAI_MODEL"),
    )
    llm_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("ONEMOON_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY"),
    )
    llm_base_url: str = Field(
        default="https://api.openai.com/v1",
        validation_alias=AliasChoices("ONEMOON_LLM_BASE_URL", "LLM_BASE_URL", "OPENAI_BASE_URL"),
    )
    llm_timeout_seconds: float = Field(
        default=45.0,
        validation_alias=AliasChoices("ONEMOON_LLM_TIMEOUT_SECONDS", "LLM_TIMEOUT_SECONDS"),
    )
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
