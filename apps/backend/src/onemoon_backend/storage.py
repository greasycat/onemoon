from __future__ import annotations

import re
from pathlib import Path

from .config import get_settings

settings = get_settings()


def ensure_storage_layout() -> None:
    for folder in ("uploads", "renders", "crops", "artifacts", "logs"):
        (settings.data_dir / folder).mkdir(parents=True, exist_ok=True)


def sanitize_filename(filename: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip("-") or "upload"


def absolute_path(relative_path: str) -> Path:
    return settings.data_dir / relative_path


def relative_path(path: Path) -> str:
    return path.resolve().relative_to(settings.data_dir).as_posix()


def public_url(relative_or_none: str | None) -> str | None:
    if not relative_or_none:
        return None
    return f"/storage/{relative_or_none}"


def upload_path(document_id: str, filename: str) -> Path:
    suffix = Path(filename).suffix.lower() or ".bin"
    return settings.data_dir / "uploads" / f"{document_id}{suffix}"


def render_path(document_id: str, page_index: int) -> Path:
    folder = settings.data_dir / "renders" / document_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"page-{page_index + 1:03}.png"


def crop_path(document_id: str, page_index: int, block_id: str) -> Path:
    folder = settings.data_dir / "crops" / document_id / f"page-{page_index + 1:03}"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{block_id}.png"


def artifact_dir(document_id: str) -> Path:
    folder = settings.data_dir / "artifacts" / document_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def log_dir(document_id: str) -> Path:
    folder = settings.data_dir / "logs" / document_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder
