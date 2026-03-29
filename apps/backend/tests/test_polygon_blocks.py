from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image


def _load_test_client(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "data"
    database_path = data_dir / "test.db"

    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")

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


def _seed_page(db, models, storage):
    with db.SessionLocal() as session:
        project = models.Project(name="Polygon Project")
        session.add(project)
        session.flush()

        document = models.Document(
            project_id=project.id,
            title="Polygon Document",
            filename="polygon.png",
            source_kind="image",
            original_file_path="uploads/polygon.png",
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
        session.commit()
        return page.id


def test_save_page_layout_round_trips_polygon_block(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        page_id = _seed_page(db, models, storage)

        payload = {
            "blocks": [
                {
                    "order_index": 0,
                    "block_type": "text",
                    "approval": "pending",
                    "source": "manual",
                    "shape_type": "polygon",
                    "vertices": [
                        {"x": 0.2, "y": 0.2},
                        {"x": 0.7, "y": 0.25},
                        {"x": 0.55, "y": 0.65},
                        {"x": 0.25, "y": 0.6},
                    ],
                    "geometry": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
                }
            ]
        }

        response = client.put(f"/api/pages/{page_id}/layout", json=payload, headers=headers)

        assert response.status_code == 200
        block = response.json()["blocks"][0]
        assert block["shape_type"] == "polygon"
        assert len(block["vertices"]) == 4
        assert block["geometry"]["x"] == pytest.approx(0.2)
        assert block["geometry"]["y"] == pytest.approx(0.2)
        assert block["geometry"]["width"] == pytest.approx(0.5)
        assert block["geometry"]["height"] == pytest.approx(0.45)
        assert block["crop_url"]


def test_polygon_patch_recomputes_bbox_and_masks_crop(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        page_id = _seed_page(db, models, storage)

        create_response = client.put(
            f"/api/pages/{page_id}/layout",
            json={
                "blocks": [
                    {
                        "order_index": 0,
                        "block_type": "text",
                        "approval": "pending",
                        "source": "manual",
                        "geometry": {"x": 0.2, "y": 0.2, "width": 0.4, "height": 0.3},
                    }
                ]
            },
            headers=headers,
        )
        assert create_response.status_code == 200
        block_id = create_response.json()["blocks"][0]["id"]

        patch_response = client.patch(
            f"/api/blocks/{block_id}",
            json={
                "shape_type": "polygon",
                "vertices": [
                    {"x": 0.2, "y": 0.2},
                    {"x": 0.55, "y": 0.2},
                    {"x": 0.42, "y": 0.55},
                ],
                "geometry": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
            },
            headers=headers,
        )

        assert patch_response.status_code == 200
        block = patch_response.json()
        assert block["shape_type"] == "polygon"
        assert block["geometry"]["x"] == pytest.approx(0.2)
        assert block["geometry"]["y"] == pytest.approx(0.2)
        assert block["geometry"]["width"] == pytest.approx(0.35)
        assert block["geometry"]["height"] == pytest.approx(0.35)

        crop_file = tmp_path / "data" / block["crop_url"].removeprefix("/storage/")
        crop = Image.open(crop_file).convert("RGBA")
        assert crop.getpixel((5, crop.height - 5))[3] == 0
        assert crop.getpixel((crop.width // 2, crop.height // 3))[3] == 255


def test_rect_layout_payload_still_saves_without_shape_fields(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        page_id = _seed_page(db, models, storage)

        response = client.put(
            f"/api/pages/{page_id}/layout",
            json={
                "blocks": [
                    {
                        "order_index": 0,
                        "block_type": "text",
                        "approval": "approved",
                        "source": "manual",
                        "geometry": {"x": 0.1, "y": 0.15, "width": 0.5, "height": 0.2},
                    }
                ]
            },
            headers=headers,
        )

        assert response.status_code == 200
        block = response.json()["blocks"][0]
        assert block["shape_type"] == "rect"
        assert block["vertices"] is None
        assert block["geometry"] == {"x": 0.1, "y": 0.15, "width": 0.5, "height": 0.2}
