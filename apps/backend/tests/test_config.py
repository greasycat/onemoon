from __future__ import annotations

import importlib
import sys


def test_allowed_origins_accepts_comma_delimited_env(monkeypatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173, http://127.0.0.1:5173")

    for module_name in list(sys.modules):
        if module_name == "onemoon_backend.config":
            del sys.modules[module_name]

    config = importlib.import_module("onemoon_backend.config")
    settings = config.Settings()

    assert settings.allowed_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]
