from __future__ import annotations

import re
import shutil
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from ..models import BlockType, Document
from ..storage import absolute_path, sanitize_filename
from .latex import build_document_from_body

DEFAULT_FIGURE_ASSET_DIR = "figures"
SAFE_PATH_SEGMENT_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass(frozen=True, slots=True)
class FigureAsset:
    block_id: str
    relative_path: str
    storage_relative_path: str
    source_path: Path


def normalize_figure_asset_dir(asset_dir: str = DEFAULT_FIGURE_ASSET_DIR) -> str:
    cleaned = asset_dir.strip().replace("\\", "/")
    segments = [
        SAFE_PATH_SEGMENT_PATTERN.sub("-", segment).strip("-")
        for segment in cleaned.split("/")
        if segment not in {"", ".", ".."}
    ]
    return "/".join(segment for segment in segments if segment) or DEFAULT_FIGURE_ASSET_DIR


def build_figure_asset_path(*, block_id: str, page_index: int, asset_dir: str = DEFAULT_FIGURE_ASSET_DIR) -> str:
    normalized_dir = normalize_figure_asset_dir(asset_dir)
    safe_block_id = SAFE_PATH_SEGMENT_PATTERN.sub("-", block_id).strip("-") or "block"
    return f"{normalized_dir}/page-{page_index + 1:03}-{safe_block_id}.png"


def collect_document_figure_assets(document: Document, *, asset_dir: str = DEFAULT_FIGURE_ASSET_DIR) -> list[FigureAsset]:
    assets: list[FigureAsset] = []
    normalized_dir = normalize_figure_asset_dir(asset_dir)

    for page in sorted(document.pages, key=lambda item: item.page_index):
        for block in sorted(page.blocks, key=lambda item: item.order_index):
            if block.block_type != BlockType.figure or not block.crop_path:
                continue
            assets.append(
                FigureAsset(
                    block_id=block.id,
                    relative_path=build_figure_asset_path(
                        block_id=block.id,
                        page_index=page.page_index,
                        asset_dir=normalized_dir,
                    ),
                    storage_relative_path=block.crop_path,
                    source_path=absolute_path(block.crop_path),
                )
            )
    return assets


def normalize_document_figure_paths(source: str, document: Document, *, asset_dir: str = DEFAULT_FIGURE_ASSET_DIR) -> str:
    normalized_source = source
    for asset in collect_document_figure_assets(document, asset_dir=asset_dir):
        for candidate in (
            asset.storage_relative_path,
            asset.source_path.as_posix(),
            absolute_path(asset.relative_path).as_posix(),
        ):
            normalized_source = normalized_source.replace(candidate, asset.relative_path)
    return normalized_source


def stage_document_figure_assets(
    document: Document,
    destination_root: Path,
    *,
    asset_dir: str = DEFAULT_FIGURE_ASSET_DIR,
) -> list[FigureAsset]:
    figure_dir = normalize_figure_asset_dir(asset_dir)
    (destination_root / figure_dir).mkdir(parents=True, exist_ok=True)

    assets = collect_document_figure_assets(document, asset_dir=figure_dir)
    for asset in assets:
        target_path = destination_root / asset.relative_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(asset.source_path, target_path)
    return assets


def build_document_package_archive(
    document: Document,
    source: str,
    *,
    asset_dir: str = DEFAULT_FIGURE_ASSET_DIR,
) -> tuple[bytes, str, str]:
    normalized_body = normalize_document_figure_paths(source.strip() or "% No approved blocks yet.", document, asset_dir=asset_dir)
    complete_source = build_document_from_body(document.title, normalized_body)
    archive_stem = sanitize_filename(Path(document.filename).stem or document.title or "document")
    archive_filename = f"{archive_stem}-package.zip"
    normalized_dir = normalize_figure_asset_dir(asset_dir)

    archive_buffer = BytesIO()
    with zipfile.ZipFile(archive_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{normalized_dir}/", "")
        archive.writestr(f"{archive_stem}.tex", complete_source)
        archive.writestr(f"{archive_stem}-body.tex", f"{normalized_body}\n")
        for asset in collect_document_figure_assets(document, asset_dir=normalized_dir):
            archive.writestr(asset.relative_path, asset.source_path.read_bytes())

    return archive_buffer.getvalue(), archive_filename, normalized_body
