from __future__ import annotations

import importlib
import sys
from pathlib import Path

from fastapi.testclient import TestClient


def _load_test_client(tmp_path: Path, monkeypatch) -> TestClient:
    data_dir = tmp_path / "data"
    database_path = data_dir / "test.db"

    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")

    for module_name in list(sys.modules):
        if module_name == "onemoon_backend" or module_name.startswith("onemoon_backend."):
            del sys.modules[module_name]

    documents = importlib.import_module("onemoon_backend.api.documents")
    monkeypatch.setattr(documents, "ingest_document_job", lambda *_args, **_kwargs: None)
    main = importlib.import_module("onemoon_backend.main")
    return TestClient(main.create_app())


def test_upload_document_accepts_project_id_from_multipart_form(tmp_path: Path, monkeypatch) -> None:
    with _load_test_client(tmp_path, monkeypatch) as client:
        login_response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "onemoon"},
        )
        assert login_response.status_code == 200
        token = login_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        project_response = client.post(
            "/api/projects",
            json={"name": "Upload Test"},
            headers=headers,
        )
        assert project_response.status_code == 200
        project_id = project_response.json()["id"]

        upload_response = client.post(
            "/api/documents",
            headers=headers,
            data={"project_id": project_id},
            files={"file": ("sample.pdf", b"%PDF-1.4\n%%EOF\n", "application/pdf")},
        )

        assert upload_response.status_code == 200
        payload = upload_response.json()
        assert payload["resource_type"] == "document"
        assert payload["resource_id"]
        assert payload["status"] == "pending"
