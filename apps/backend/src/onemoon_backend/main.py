from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import auth as auth_routes
from .api import documents as document_routes
from .api import projects as project_routes
from .config import get_settings
from .db import init_db
from .storage import ensure_storage_layout

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    ensure_storage_layout()
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_origin_regex=settings.allowed_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_routes.router, prefix=settings.api_prefix)
    app.include_router(project_routes.router, prefix=settings.api_prefix)
    app.include_router(document_routes.router, prefix=settings.api_prefix)
    app.mount("/storage", StaticFiles(directory=settings.data_dir), name="storage")
    return app


app = create_app()


def run() -> None:
    uvicorn.run("onemoon_backend.main:app", host="0.0.0.0", port=8000, reload=True)
