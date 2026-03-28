from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import fitz
from PIL import Image, ImageDraw
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..db import SessionLocal
from ..models import (
    Block,
    BlockApproval,
    BlockShapeType,
    BlockSource,
    BlockType,
    CompileArtifact,
    CompileStatus,
    Document,
    DocumentStatus,
    Job,
    JobStatus,
    Page,
    PageReviewStatus,
)
from ..storage import absolute_path, artifact_dir, crop_path, ensure_storage_layout, log_dir, relative_path, render_path
from ..services.latex import build_document_latex, compile_latex
from ..services.llm import ConversionPayload, ConversionResult, get_llm_adapter
from ..services.segmentation import ProposedBlock, segment_page

settings = get_settings()


def create_job(db: Session, job_type: str, resource_type: str, resource_id: str, message: str = "Queued") -> Job:
    job = Job(job_type=job_type, resource_type=resource_type, resource_id=resource_id, message=message)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def update_job(job: Job, *, status: JobStatus, progress: float, message: str, payload: dict | None = None) -> None:
    job.status = status
    job.progress = progress
    job.message = message
    job.payload = payload or job.payload
    job.updated_at = datetime.now(UTC)


def render_document(document: Document) -> list[tuple[int, Path, int, int]]:
    source_path = absolute_path(document.original_file_path)
    ensure_storage_layout()

    if document.source_kind == "pdf":
        pdf = fitz.open(source_path)
        pages: list[tuple[int, Path, int, int]] = []
        scale = settings.render_dpi / 72
        matrix = fitz.Matrix(scale, scale)
        for page_index, page in enumerate(pdf):
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            output_path = render_path(document.id, page_index)
            pixmap.save(output_path)
            pages.append((page_index, output_path, pixmap.width, pixmap.height))
        pdf.close()
        return pages

    image = Image.open(source_path).convert("RGB")
    output_path = render_path(document.id, 0)
    image.save(output_path)
    return [(0, output_path, image.width, image.height)]


def save_crop(page: Page, block: Block) -> None:
    image = Image.open(absolute_path(page.image_path)).convert("RGBA")
    left = int(block.x * page.width)
    top = int(block.y * page.height)
    right = int((block.x + block.width) * page.width)
    bottom = int((block.y + block.height) * page.height)
    crop_box = (left, top, max(left + 1, right), max(top + 1, bottom))
    cropped = image.crop(crop_box)
    if (block.shape_type or BlockShapeType.rect) == BlockShapeType.polygon and block.vertices:
        width = crop_box[2] - crop_box[0]
        height = crop_box[3] - crop_box[1]
        mask = Image.new("L", (width, height), 0)
        polygon = [
            ((vertex["x"] * page.width) - left, (vertex["y"] * page.height) - top)
            for vertex in block.vertices
        ]
        ImageDraw.Draw(mask).polygon(polygon, fill=255)
        cropped.putalpha(mask)
    target = crop_path(page.document_id, page.page_index, block.id)
    cropped.save(target)
    block.crop_path = relative_path(target)


def convert_block(block: Block, page: Page, *, save_debug_image: bool = False) -> ConversionResult:
    adapter = get_llm_adapter()
    result = adapter.convert(
        ConversionPayload(
            block_id=block.id,
            block_type=BlockType(block.block_type),
            image_path=absolute_path(block.crop_path) if block.crop_path else absolute_path(page.image_path),
            instruction=block.user_instruction,
            context_summary=f"page={page.page_index + 1}",
            save_debug_image=save_debug_image,
        )
    )
    block.generated_output = result.normalized_output
    block.raw_response = result.raw_output
    block.warnings = result.warnings
    return result


def assemble_document(db: Session, document_id: str) -> str:
    document = db.scalar(
        select(Document)
        .where(Document.id == document_id)
        .options(selectinload(Document.pages).selectinload(Page.blocks))
    )
    if document is None:
        raise ValueError(f"Unknown document {document_id}")

    ordered_blocks: list[Block] = []
    for page in sorted(document.pages, key=lambda item: item.page_index):
        ordered_blocks.extend(sorted(page.blocks, key=lambda item: item.order_index))

    latex_source = build_document_latex(document.title, ordered_blocks)
    document.assembled_latex = latex_source
    document.updated_at = datetime.now(UTC)
    return latex_source


def _replace_page_blocks(db: Session, page: Page, proposed_blocks: list[ProposedBlock]) -> None:
    db.execute(delete(Block).where(Block.page_id == page.id))
    db.flush()

    for order_index, proposed in enumerate(proposed_blocks):
        block = Block(
            page_id=page.id,
            order_index=order_index,
            block_type=proposed.block_type,
            approval=BlockApproval.pending,
            x=proposed.x,
            y=proposed.y,
            width=proposed.width,
            height=proposed.height,
            confidence=proposed.confidence,
            is_user_corrected=False,
            source=BlockSource.auto,
        )
        db.add(block)
        db.flush()
        save_crop(page, block)


def ingest_document_job(job_id: str, document_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        document = db.get(Document, document_id)
        if job is None or document is None:
            return

        try:
            update_job(job, status=JobStatus.running, progress=0.05, message="Rendering document pages")
            document.status = DocumentStatus.rendering
            db.commit()

            rendered_pages = render_document(document)
            db.execute(delete(Page).where(Page.document_id == document.id))
            db.flush()

            page_records: list[Page] = []
            for page_index, output_path, width, height in rendered_pages:
                page_record = Page(
                    document_id=document.id,
                    page_index=page_index,
                    image_path=relative_path(output_path),
                    width=width,
                    height=height,
                )
                db.add(page_record)
                page_records.append(page_record)
            db.commit()

            document.status = DocumentStatus.review
            update_job(
                job,
                status=JobStatus.completed,
                progress=1.0,
                message="Document ready for manual segmentation",
                payload={"page_count": len(page_records)},
            )
            db.commit()
        except Exception as exc:
            document.status = DocumentStatus.failed
            update_job(job, status=JobStatus.failed, progress=1.0, message=str(exc))
            db.commit()
            raise


def resegment_page_job(job_id: str, page_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        page = db.scalar(select(Page).where(Page.id == page_id).options(selectinload(Page.document)))
        if job is None or page is None:
            return

        try:
            update_job(job, status=JobStatus.running, progress=0.1, message="Re-segmenting page")
            page.document.status = DocumentStatus.segmenting
            db.commit()

            proposed_blocks = segment_page(absolute_path(page.image_path))
            _replace_page_blocks(db, page, proposed_blocks)
            page.review_status = PageReviewStatus.in_review
            page.review_started_at = page.review_started_at or datetime.now(UTC)
            page.review_completed_at = None
            page.layout_version += 1
            page.document.status = DocumentStatus.review
            update_job(job, status=JobStatus.completed, progress=1.0, message="Page segmentation refreshed")
            db.commit()
        except Exception as exc:
            page.document.status = DocumentStatus.failed
            update_job(job, status=JobStatus.failed, progress=1.0, message=str(exc))
            db.commit()
            raise


def regenerate_block_job(job_id: str, block_id: str, save_masked_crop_debug: bool = False) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        block = db.scalar(select(Block).where(Block.id == block_id).options(selectinload(Block.page)))
        if job is None or block is None:
            return

        try:
            update_job(job, status=JobStatus.running, progress=0.2, message="Generating block output")
            db.commit()
            save_crop(block.page, block)
            result = convert_block(block, block.page, save_debug_image=save_masked_crop_debug)
            assemble_document(db, block.page.document_id)
            debug_payload: dict[str, str] = {}
            if result.debug_image_path:
                debug_payload["debug_masked_crop_path"] = result.debug_image_path
            if result.debug_response_path:
                debug_payload["debug_response_path"] = result.debug_response_path
            update_job(
                job,
                status=JobStatus.completed,
                progress=1.0,
                message="Block output updated",
                payload=debug_payload or None,
            )
            db.commit()
        except Exception as exc:
            update_job(job, status=JobStatus.failed, progress=1.0, message=str(exc))
            db.commit()
            raise


def compile_document_job(job_id: str, document_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        document = db.scalar(
            select(Document)
            .where(Document.id == document_id)
            .options(selectinload(Document.compile_artifacts), selectinload(Document.pages).selectinload(Page.blocks))
        )
        if job is None or document is None:
            return

        try:
            update_job(job, status=JobStatus.running, progress=0.15, message="Building LaTeX source")
            document.status = DocumentStatus.compiling
            db.commit()

            latex_source = assemble_document(db, document.id)
            out_dir = artifact_dir(document.id)
            logs = log_dir(document.id)
            version = len(document.compile_artifacts) + 1
            tex_path = out_dir / f"document-v{version}.tex"
            log_path = logs / f"compile-v{version}.log"
            tex_path.write_text(latex_source, encoding="utf-8")

            update_job(job, status=JobStatus.running, progress=0.6, message="Compiling preview")
            db.commit()

            compile_result = compile_latex(tex_path, out_dir)
            log_path.write_text(compile_result.log_text, encoding="utf-8")

            artifact = CompileArtifact(
                document_id=document.id,
                version=version,
                status=CompileStatus(compile_result.status),
                tex_path=relative_path(tex_path),
                pdf_path=relative_path(compile_result.pdf_path) if compile_result.pdf_path else None,
                log_path=relative_path(log_path),
            )
            db.add(artifact)
            document.latest_compile_status = CompileStatus(compile_result.status)
            document.status = DocumentStatus.completed if compile_result.status == "completed" else DocumentStatus.review
            update_job(
                job,
                status=JobStatus.completed if compile_result.status != "failed" else JobStatus.failed,
                progress=1.0,
                message="Compilation finished" if compile_result.status != "failed" else "Compilation failed",
                payload={"status": compile_result.status},
            )
            db.commit()
        except Exception as exc:
            document.status = DocumentStatus.failed
            document.latest_compile_status = CompileStatus.failed
            update_job(job, status=JobStatus.failed, progress=1.0, message=str(exc))
            db.commit()
            raise
