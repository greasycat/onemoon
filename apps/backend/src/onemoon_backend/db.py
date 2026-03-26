from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models

    Base.metadata.create_all(bind=engine)
    _apply_development_schema_compatibility()
    with SessionLocal() as db:
        existing_user = db.scalar(select(models.User).where(models.User.username == settings.admin_username))
        if existing_user is None:
            db.add(models.User(username=settings.admin_username, role="admin"))
            db.commit()


def _apply_development_schema_compatibility() -> None:
    if not settings.database_url.startswith("sqlite"):
        return

    inspector = inspect(engine)
    page_columns = {column["name"] for column in inspector.get_columns("pages")} if inspector.has_table("pages") else set()
    block_columns = {column["name"] for column in inspector.get_columns("blocks")} if inspector.has_table("blocks") else set()

    statements: list[str] = []
    if "review_status" not in page_columns:
        statements.append("ALTER TABLE pages ADD COLUMN review_status VARCHAR(32) DEFAULT 'unreviewed'")
    if "review_started_at" not in page_columns:
        statements.append("ALTER TABLE pages ADD COLUMN review_started_at DATETIME")
    if "review_completed_at" not in page_columns:
        statements.append("ALTER TABLE pages ADD COLUMN review_completed_at DATETIME")
    if "layout_version" not in page_columns:
        statements.append("ALTER TABLE pages ADD COLUMN layout_version INTEGER DEFAULT 1")
    if "source" not in block_columns:
        statements.append("ALTER TABLE blocks ADD COLUMN source VARCHAR(32) DEFAULT 'manual'")
    if "parent_block_id" not in block_columns:
        statements.append("ALTER TABLE blocks ADD COLUMN parent_block_id VARCHAR(32)")

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
