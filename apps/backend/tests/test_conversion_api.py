from __future__ import annotations

import importlib
import sys
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def _load_test_client(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "data"
    database_path = data_dir / "test.db"

    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("ONEMOON_LLM_PROVIDER", "mock")
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("ONEMOON_API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")

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


def _seed_document_with_figure_block(db, models, storage):
    with db.SessionLocal() as session:
        project = models.Project(name="Figure Project")
        session.add(project)
        session.flush()

        document = models.Document(
            project_id=project.id,
            title="Figure Document",
            filename="figure-note.png",
            source_kind="image",
            original_file_path="uploads/figure-note.png",
        )
        session.add(document)
        session.flush()

        image_path = storage.render_path(document.id, 0)
        Image.new("RGB", (600, 400), "white").save(image_path)
        page = models.Page(
            document_id=document.id,
            page_index=0,
            image_path=storage.relative_path(image_path),
            width=600,
            height=400,
        )
        session.add(page)
        session.flush()

        block = models.Block(
            page_id=page.id,
            order_index=0,
            block_type=models.BlockType.figure,
            approval=models.BlockApproval.approved,
            source=models.BlockSource.manual,
            x=0.1,
            y=0.1,
            width=0.4,
            height=0.4,
            confidence=1.0,
            is_user_corrected=True,
            warnings=[],
        )
        session.add(block)
        session.flush()

        crop_file = storage.crop_path(document.id, 0, block.id)
        Image.new("RGB", (200, 120), "white").save(crop_file)
        block.crop_path = storage.relative_path(crop_file)
        absolute_crop_path = storage.absolute_path(block.crop_path).as_posix()
        block.generated_output = "\n".join(
            [
                f"\\includegraphics[width=0.9\\linewidth]{{{absolute_crop_path}}}",
                "\\caption{Original absolute-path caption.}",
            ]
        )
        document.assembled_latex = (
            "\\begin{figure}[h]\n"
            "\\centering\n"
            f"{block.generated_output}\n"
            "\\end{figure}"
        )
        session.commit()
        return {
            "document_id": document.id,
            "page_id": page.id,
            "block_id": block.id,
            "absolute_crop_path": absolute_crop_path,
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
        assert block["crop_url"]

        document_response = client.get(f"/api/documents/{seeded['document_id']}", headers=headers)
        assert document_response.status_code == 200
        assembled_latex = document_response.json()["assembled_latex"]
        assert "\\includegraphics" in assembled_latex
        assert seeded["block_id"] in assembled_latex


def test_document_merge_updates_assembled_latex_with_mock_provider(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        seeded = _seed_document_with_block(db, models, storage)
        requested_source = "\\begin{textblock}\nMerged reviewer copy.\n\\end{textblock}"

        response = client.post(
            f"/api/documents/{seeded['document_id']}/merge",
            json={
                "source": requested_source,
                "suggestion": "Tighten the prose and keep the math intact.",
            },
            headers=headers,
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["assembled_latex"] == requested_source
        assert any("Mock merge reused" in warning for warning in payload["warnings"])

        document_response = client.get(f"/api/documents/{seeded['document_id']}", headers=headers)
        assert document_response.status_code == 200
        assembled_latex = document_response.json()["assembled_latex"]
        assert assembled_latex == requested_source


def test_compile_document_uses_persisted_assembled_latex_body(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        seeded = _seed_document_with_block(db, models, storage)
        merged_body = "\\begin{textblock}\nMerged reviewer copy.\n\\end{textblock}"

        patch_response = client.patch(
            f"/api/documents/{seeded['document_id']}",
            json={"assembled_latex": merged_body},
            headers=headers,
        )
        assert patch_response.status_code == 200

        compile_response = client.post(f"/api/documents/{seeded['document_id']}/compile", headers=headers)
        assert compile_response.status_code == 200

        tex_source = (storage.artifact_dir(seeded["document_id"]) / "document-v1.tex").read_text(encoding="utf-8")
        assert "\\documentclass" in tex_source
        assert "Merged reviewer copy." in tex_source
        assert "Generated note text." not in tex_source


def test_compile_document_stages_figure_assets_with_relative_paths(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        seeded = _seed_document_with_figure_block(db, models, storage)

        compile_response = client.post(f"/api/documents/{seeded['document_id']}/compile", headers=headers)
        assert compile_response.status_code == 200

        tex_source = (storage.artifact_dir(seeded["document_id"]) / "document-v1.tex").read_text(encoding="utf-8")
        assert "figures/page-001-" in tex_source
        staged_assets = list((storage.artifact_dir(seeded["document_id"]) / "figures").glob("*.png"))
        assert len(staged_assets) == 1


def test_get_document_normalizes_absolute_figure_asset_paths(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        seeded = _seed_document_with_figure_block(db, models, storage)

        with db.SessionLocal() as session:
            document = session.get(models.Document, seeded["document_id"])
            assert document is not None
            absolute_packaged_figure_path = storage.absolute_path(f"figures/page-001-{seeded['block_id']}.png").as_posix()
            document.assembled_latex = (document.assembled_latex or "").replace(
                seeded["absolute_crop_path"],
                absolute_packaged_figure_path,
            )
            session.commit()

        response = client.get(f"/api/documents/{seeded['document_id']}", headers=headers)

        assert response.status_code == 200
        assembled_latex = response.json()["assembled_latex"]
        assert "figures/page-001-" in assembled_latex
        assert "/data/figures/" not in assembled_latex


def test_package_document_download_includes_relative_figures_folder(tmp_path: Path, monkeypatch) -> None:
    client, models, db, storage = _load_test_client(tmp_path, monkeypatch)
    with client:
        headers = _login(client)
        seeded = _seed_document_with_figure_block(db, models, storage)

        response = client.post(
            f"/api/documents/{seeded['document_id']}/package",
            json={
                "source": (
                    "\\begin{figure}[h]\n"
                    "\\centering\n"
                    f"\\includegraphics[width=0.9\\linewidth]{{{seeded['absolute_crop_path']}}}\n"
                    "\\caption{Packaged.}\n"
                    "\\end{figure}"
                )
            },
            headers=headers,
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert "attachment;" in response.headers["content-disposition"]

        archive = zipfile.ZipFile(BytesIO(response.content))
        members = archive.namelist()
        tex_members = [member for member in members if member.endswith(".tex") and not member.endswith("-body.tex")]
        body_members = [member for member in members if member.endswith("-body.tex")]
        figure_members = [member for member in members if member.startswith("figures/") and member.endswith(".png")]

        assert "figures/" in members
        assert len(tex_members) == 1
        assert len(body_members) == 1
        assert len(figure_members) == 1

        packaged_body = archive.read(body_members[0]).decode("utf-8")
        packaged_tex = archive.read(tex_members[0]).decode("utf-8")
        assert "figures/page-001-" in packaged_body
        assert "figures/page-001-" in packaged_tex
