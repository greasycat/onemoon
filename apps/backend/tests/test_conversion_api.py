from __future__ import annotations

import importlib
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def _load_test_client(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "data"
    database_path = data_dir / "test.db"

    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("LLM_PROVIDER", "mock")

    for module_name in list(sys.modules):
        if module_name == "onemoon_backend" or module_name.startswith("onemoon_backend."):
            del sys.modules[module_name]

    main = importlib.import_module("onemoon_backend.main")
    models = importlib.import_module("onemoon_backend.models")
    db = importlib.import_module("onemoon_backend.db")
    storage = importlib.import_module("onemoon_backend.storage")
    return TestClient(main.create_app()), models, db, storage


def _login(client: TestClient) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"username": "admin", "password": "onemoon"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _seed_document_with_block(db, models, storage):
    with db.SessionLocal() as session:
        project = models.Project(name="Conversion Project")
        session.add(project)
        session.flush()

        document = models.Document(
            project_id=project.id,
            title="Conversion Document",
            filename="conversion.png",
            source_kind="image",
            original_file_path="uploads/conversion.png",
        )
        session.add(document)
        session.flush()

        image_path = storage.render_path(document.id, 0)
        Image.new("RGB", (1000, 1000), "white").save(image_path)
        page = models.Page(
            document_id=document.id,
            page_index=0,
            image_path=storage.relative_path(image_path),
            width=1000,
            height=1000,
        )
        session.add(page)
        session.flush()

        block = models.Block(
            page_id=page.id,
            order_index=0,
            block_type=models.BlockType.text,
            approval=models.BlockApproval.pending,
            source=models.BlockSource.manual,
            x=0.1,
            y=0.15,
            width=0.5,
            height=0.2,
            confidence=1.0,
            is_user_corrected=True,
            generated_output="Generated note text.",
            manual_output=None,
            user_instruction="Preserve wording",
            warnings=["Needs review"],
        )
        session.add(block)
        session.commit()
        return {
            "document_id": document.id,
            "page_id": page.id,
            "block_id": block.id,
        }


def test_patching_manual_output_refreshes_document_latex(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        seeded = _seed_document_with_block(db, models, storage)

        response = client.patch(
            f"/api/blocks/{seeded['block_id']}",
            json={
                "manual_output": "Manual reviewer copy.",
                "approval": "approved",
            },
            headers=headers,
        )

        assert response.status_code == 200
        block = response.json()
        assert block["manual_output"] == "Manual reviewer copy."
        assert block["generated_output"] == "Generated note text."

        document_response = client.get(f"/api/documents/{seeded['document_id']}", headers=headers)
        assert document_response.status_code == 200
        assert "Manual reviewer copy." in document_response.json()["assembled_latex"]


def test_saving_page_layout_clears_stale_conversion_fields(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        seeded = _seed_document_with_block(db, models, storage)

        response = client.put(
            f"/api/pages/{seeded['page_id']}/layout",
            json={
                "blocks": [
                    {
                        "id": seeded["block_id"],
                        "order_index": 0,
                        "block_type": "text",
                        "approval": "pending",
                        "source": "manual",
                        "geometry": {"x": 0.1, "y": 0.15, "width": 0.5, "height": 0.2},
                    }
                ]
            },
            headers=headers,
        )

        assert response.status_code == 200
        block = response.json()["blocks"][0]
        assert block["generated_output"] is None
        assert block["manual_output"] is None
        assert block["user_instruction"] is None
        assert block["warnings"] == []

        document_response = client.get(f"/api/documents/{seeded['document_id']}", headers=headers)
        assert document_response.status_code == 200
        assert "% Pending block review." in document_response.json()["assembled_latex"]
