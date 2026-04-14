from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import get_current_user
from ..db import SessionLocal, get_db
from ..models import (
    Block,
    BlockApproval,
    BlockShapeType,
    BlockSource,
    BlockType,
    CompileArtifact,
    CompileStatus,
    Document,
    OutputFormat,
    DocumentStatus,
    Page,
    PageReviewStatus,
    Project,
    User,
)
from ..schemas import (
    BlockCreate,
    BlockGeometry,
    BlockPatch,
    BlockResponse,
    BlockVertex,
    CompileArtifactResponse,
    ConvertAllResponse,
    DocumentDetailResponse,
    DocumentPatch,
    JobResponse,
    MergeDocumentResponse,
    MergeDocumentRequest,
    PackageDocumentRequest,
    PageLayoutBlockPayload,
    PageLayoutPayload,
    PageResponse,
    RegenerateBlockRequest,
)
from ..services.pipeline import (
    assemble_document,
    batch_convert_blocks_job,
    compile_document_job,
    create_job,
    ingest_document_job,
    merge_document_content,
    regenerate_block_job,
    resegment_page_job,
    save_crop,
)
from ..services.figure_assets import build_document_package_archive, normalize_document_figure_paths
from ..storage import public_url, relative_path, sanitize_filename, upload_path

router = APIRouter(tags=["documents"])


def normalize_vertices(vertices: list[BlockVertex] | None) -> list[dict[str, float]] | None:
    if vertices is None:
        return None

    normalized = [{"x": float(vertex.x), "y": float(vertex.y)} for vertex in vertices]
    if len(normalized) > 1 and normalized[0] == normalized[-1]:
        normalized = normalized[:-1]
    if len(normalized) < 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Polygon blocks require at least three vertices")
    return normalized


def geometry_from_vertices(vertices: list[dict[str, float]]) -> BlockGeometry:
    return BlockGeometry(
        x=min(vertex["x"] for vertex in vertices),
        y=min(vertex["y"] for vertex in vertices),
        width=max(vertex["x"] for vertex in vertices) - min(vertex["x"] for vertex in vertices),
        height=max(vertex["y"] for vertex in vertices) - min(vertex["y"] for vertex in vertices),
    )


def resolve_shape_payload(
    *,
    shape_type: BlockShapeType | None,
    geometry: BlockGeometry,
    vertices: list[BlockVertex] | None,
) -> tuple[BlockShapeType, BlockGeometry, list[dict[str, float]] | None]:
    effective_shape = shape_type or BlockShapeType.rect
    if effective_shape == BlockShapeType.polygon:
        normalized_vertices = normalize_vertices(vertices)
        if normalized_vertices is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Polygon blocks require vertices")
        return effective_shape, geometry_from_vertices(normalized_vertices), normalized_vertices
    return BlockShapeType.rect, geometry, None


def serialize_vertices(vertices: list[dict[str, float]] | None) -> list[BlockVertex] | None:
    if not vertices:
        return None
    return [BlockVertex(x=vertex["x"], y=vertex["y"]) for vertex in vertices]


def serialize_block(block: Block) -> BlockResponse:
    return BlockResponse(
        id=block.id,
        page_id=block.page_id,
        order_index=block.order_index,
        block_type=BlockType.text if block.block_type == BlockType.unknown else block.block_type,
        approval=block.approval,
        source=block.source,
        shape_type=block.shape_type or BlockShapeType.rect,
        vertices=serialize_vertices(block.vertices),
        parent_block_id=block.parent_block_id,
        geometry=BlockGeometry(x=block.x, y=block.y, width=block.width, height=block.height),
        confidence=block.confidence,
        is_user_corrected=block.is_user_corrected,
        crop_url=public_url(block.crop_path),
        generated_output=block.generated_output,
        manual_output=block.manual_output,
        user_instruction=block.user_instruction,
        warnings=block.warnings or [],
        updated_at=block.updated_at,
    )


def serialize_page(page: Page) -> PageResponse:
    return PageResponse(
        id=page.id,
        page_index=page.page_index,
        image_url=public_url(page.image_path) or "",
        width=page.width,
        height=page.height,
        review_status=page.review_status,
        review_started_at=page.review_started_at,
        review_completed_at=page.review_completed_at,
        layout_version=page.layout_version,
        blocks=[serialize_block(block) for block in sorted(page.blocks, key=lambda item: item.order_index)],
    )


def serialize_artifact(artifact: CompileArtifact) -> CompileArtifactResponse:
    return CompileArtifactResponse(
        id=artifact.id,
        version=artifact.version,
        status=artifact.status,
        tex_url=public_url(artifact.tex_path) or "",
        pdf_url=public_url(artifact.pdf_path),
        log_url=public_url(artifact.log_path) or "",
        created_at=artifact.created_at,
    )


def load_document(db: Session, document_id: str) -> Document:
    document = db.scalar(
        select(Document)
        .where(Document.id == document_id)
        .options(
            selectinload(Document.pages).selectinload(Page.blocks),
            selectinload(Document.compile_artifacts),
        )
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return document


def load_page(db: Session, page_id: str) -> Page:
    page = db.scalar(select(Page).where(Page.id == page_id).options(selectinload(Page.blocks), selectinload(Page.document)))
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    return page


def upsert_page_layout(db: Session, page: Page, blocks: list[PageLayoutBlockPayload]) -> Page:
    existing_by_id = {block.id: block for block in page.blocks}
    kept_ids: set[str] = set()

    for fallback_order, payload in enumerate(sorted(blocks, key=lambda item: item.order_index)):
        block = existing_by_id.get(payload.id) if payload.id else None
        if block is None:
            block = Block(page_id=page.id)
            db.add(block)

        shape_type, geometry, vertices = resolve_shape_payload(
            shape_type=payload.shape_type,
            geometry=payload.geometry,
            vertices=payload.vertices,
        )

        block.order_index = fallback_order
        block.block_type = payload.block_type
        block.approval = payload.approval
        block.source = payload.source
        block.shape_type = shape_type
        block.vertices = vertices
        block.parent_block_id = payload.parent_block_id
        block.x = geometry.x
        block.y = geometry.y
        block.width = geometry.width
        block.height = geometry.height
        block.is_user_corrected = payload.source == BlockSource.manual
        block.confidence = 1.0 if payload.source == BlockSource.manual else block.confidence
        block.generated_output = None
        block.manual_output = None
        block.user_instruction = None
        block.raw_response = None
        block.warnings = []
        db.flush()
        save_crop(page, block)
        kept_ids.add(block.id)

    for block in list(page.blocks):
        if block.id not in kept_ids:
            db.delete(block)

    page.layout_version += 1
    if page.review_status == PageReviewStatus.unreviewed and blocks:
        page.review_status = PageReviewStatus.in_review
        page.review_started_at = page.review_started_at or datetime.now(UTC)
    if page.review_status == PageReviewStatus.segmented:
        page.review_completed_at = page.review_completed_at or datetime.now(UTC)
    page.document.status = DocumentStatus.review
    assemble_document(db, page.document_id)
    db.flush()
    db.refresh(page)
    return page


@router.post("/documents", response_model=JobResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    project_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> JobResponse:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    document = Document(
        project_id=project_id,
        title=Path(file.filename or "Untitled").stem,
        filename=sanitize_filename(file.filename or "upload.bin"),
        source_kind="pdf" if (file.filename or "").lower().endswith(".pdf") else "image",
        original_file_path="",
    )
    db.add(document)
    db.flush()

    target_path = upload_path(document.id, document.filename)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    payload = await file.read()
    target_path.write_bytes(payload)
    document.original_file_path = relative_path(target_path)
    db.commit()
    db.refresh(document)

    job = create_job(db, "ingest_document", "document", document.id, message="Queued document ingestion")
    background_tasks.add_task(ingest_document_job, job.id, document.id)
    return JobResponse.model_validate(job, from_attributes=True)


@router.get("/documents/{document_id}", response_model=DocumentDetailResponse)
def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DocumentDetailResponse:
    document = load_document(db, document_id)
    return DocumentDetailResponse(
        id=document.id,
        project_id=document.project_id,
        title=document.title,
        filename=document.filename,
        source_kind=document.source_kind,
        status=document.status,
        output_format=document.output_format,
        assembled_latex=normalize_document_figure_paths(document.assembled_latex, document) if document.assembled_latex else None,
        latest_compile_status=document.latest_compile_status,
        pages=[serialize_page(page) for page in sorted(document.pages, key=lambda item: item.page_index)],
        compile_artifacts=[serialize_artifact(artifact) for artifact in document.compile_artifacts],
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


@router.get("/documents/{document_id}/pages", response_model=list[PageResponse])
def list_pages(
    document_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[PageResponse]:
    document = load_document(db, document_id)
    return [serialize_page(page) for page in sorted(document.pages, key=lambda item: item.page_index)]


@router.get("/pages/{page_id}/layout", response_model=PageResponse)
def get_page_layout(
    page_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> PageResponse:
    page = load_page(db, page_id)
    return serialize_page(page)


@router.put("/pages/{page_id}/layout", response_model=PageResponse)
def save_page_layout(
    page_id: str,
    payload: PageLayoutPayload,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> PageResponse:
    page = load_page(db, page_id)
    upsert_page_layout(db, page, payload.blocks)
    db.commit()
    return serialize_page(load_page(db, page_id))


@router.post("/pages/{page_id}/mark-segmented", response_model=PageResponse)
def mark_page_segmented(
    page_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> PageResponse:
    page = load_page(db, page_id)
    if not page.blocks:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Page must contain at least one block")
    page.review_status = PageReviewStatus.segmented
    page.review_started_at = page.review_started_at or datetime.now(UTC)
    page.review_completed_at = datetime.now(UTC)
    page.document.status = DocumentStatus.review
    db.commit()
    return serialize_page(load_page(db, page_id))


@router.post("/pages/{page_id}/reopen", response_model=PageResponse)
def reopen_page(
    page_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> PageResponse:
    page = load_page(db, page_id)
    page.review_status = PageReviewStatus.in_review
    page.review_started_at = page.review_started_at or datetime.now(UTC)
    page.review_completed_at = None
    page.document.status = DocumentStatus.review
    db.commit()
    return serialize_page(load_page(db, page_id))


@router.patch("/documents/{document_id}", response_model=DocumentDetailResponse)
def update_document(
    document_id: str,
    payload: DocumentPatch,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DocumentDetailResponse:
    document = load_document(db, document_id)
    if payload.title is not None:
        document.title = payload.title.strip() or document.title
    if payload.assembled_latex is not None:
        document.assembled_latex = payload.assembled_latex
    if payload.output_format is not None:
        document.output_format = payload.output_format
    db.commit()
    db.refresh(document)
    return get_document(document_id, db, _)


@router.post("/documents/{document_id}/merge", response_model=MergeDocumentResponse)
def merge_document(
    document_id: str,
    payload: MergeDocumentRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> MergeDocumentResponse:
    document = load_document(db, document_id)
    source = payload.source.strip() or "% No approved blocks yet."
    suggestion = payload.suggestion.strip() if payload.suggestion and payload.suggestion.strip() else None
    result = merge_document_content(document, source=source, suggestion=suggestion)
    db.commit()
    return MergeDocumentResponse(assembled_latex=document.assembled_latex or source, warnings=result.warnings)


@router.post("/documents/{document_id}/package")
def package_document(
    document_id: str,
    payload: PackageDocumentRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> StreamingResponse:
    document = load_document(db, document_id)
    requested_source = payload.source.strip() if payload.source and payload.source.strip() else None
    if not requested_source:
        requested_source = document.assembled_latex or assemble_document(db, document.id)

    archive_bytes, archive_filename, _normalized_body = build_document_package_archive(document, requested_source)
    return StreamingResponse(
        BytesIO(archive_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{archive_filename}"'},
    )


@router.delete(
    "/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    db.delete(document)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/documents/{document_id}/artifacts", response_model=list[CompileArtifactResponse])
def list_artifacts(
    document_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[CompileArtifactResponse]:
    document = load_document(db, document_id)
    return [serialize_artifact(artifact) for artifact in document.compile_artifacts]


@router.post("/documents/{document_id}/compile", response_model=JobResponse)
def compile_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> JobResponse:
    document = load_document(db, document_id)
    document.status = DocumentStatus.compiling
    document.latest_compile_status = CompileStatus.pending
    db.commit()
    job = create_job(db, "compile_document", "document", document_id, message="Queued compilation")
    background_tasks.add_task(compile_document_job, job.id, document_id)
    return JobResponse.model_validate(job, from_attributes=True)


@router.post("/documents/{document_id}/convert-all", response_model=ConvertAllResponse)
def convert_all_document_blocks(
    document_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ConvertAllResponse:
    document = load_document(db, document_id)
    unconverted_block_ids = [
        block.id
        for page in document.pages
        for block in page.blocks
        if block.generated_output is None
    ]
    if not unconverted_block_ids:
        return ConvertAllResponse(job_ids=[])
    job = create_job(db, "batch_convert_blocks", "document", document_id, message="Queued batch block conversion")
    background_tasks.add_task(batch_convert_blocks_job, job.id, unconverted_block_ids)
    return ConvertAllResponse(job_ids=[job.id])


@router.post("/pages/{page_id}/resegment", response_model=JobResponse)
def resegment_page(
    page_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> JobResponse:
    page = db.get(Page, page_id)
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    document = db.get(Document, page.document_id)
    if document is not None:
        document.status = DocumentStatus.segmenting
        db.commit()
    job = create_job(db, "resegment_page", "page", page_id, message="Queued page re-segmentation")
    background_tasks.add_task(resegment_page_job, job.id, page_id)
    return JobResponse.model_validate(job, from_attributes=True)


@router.post("/pages/{page_id}/blocks", response_model=BlockResponse)
def create_block(
    page_id: str,
    payload: BlockCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> BlockResponse:
    page = db.get(Page, page_id)
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")

    next_order = len(page.blocks)
    block = Block(
        page_id=page_id,
        order_index=next_order,
        block_type=payload.block_type,
        approval=BlockApproval.pending,
        confidence=1.0,
        is_user_corrected=True,
        source=BlockSource.manual,
    )
    shape_type, geometry, vertices = resolve_shape_payload(
        shape_type=payload.shape_type,
        geometry=payload.geometry,
        vertices=payload.vertices,
    )
    block.shape_type = shape_type
    block.vertices = vertices
    block.x = geometry.x
    block.y = geometry.y
    block.width = geometry.width
    block.height = geometry.height
    db.add(block)
    db.flush()
    save_crop(page, block)
    page.review_status = PageReviewStatus.in_review if page.review_status == PageReviewStatus.unreviewed else page.review_status
    page.review_started_at = page.review_started_at or datetime.now(UTC)
    page.layout_version += 1
    assemble_document(db, page.document_id)
    db.commit()
    db.refresh(block)
    return serialize_block(block)


@router.patch("/blocks/{block_id}", response_model=BlockResponse)
def update_block(
    block_id: str,
    payload: BlockPatch,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> BlockResponse:
    block = db.scalar(select(Block).where(Block.id == block_id).options(selectinload(Block.page)))
    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Block not found")

    should_reset_conversion = False

    if payload.shape_type is not None or payload.vertices is not None or payload.geometry is not None:
        next_shape_type = payload.shape_type or block.shape_type or BlockShapeType.rect
        if next_shape_type == BlockShapeType.polygon:
            if payload.vertices is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Polygon block updates require vertices")
            shape_type, geometry, vertices = resolve_shape_payload(
                shape_type=next_shape_type,
                geometry=payload.geometry or BlockGeometry(x=block.x, y=block.y, width=block.width, height=block.height),
                vertices=payload.vertices,
            )
            block.shape_type = shape_type
            block.vertices = vertices
            block.x = geometry.x
            block.y = geometry.y
            block.width = geometry.width
            block.height = geometry.height
        elif payload.geometry is not None:
            block.shape_type = BlockShapeType.rect
            block.vertices = None
            block.x = payload.geometry.x
            block.y = payload.geometry.y
            block.width = payload.geometry.width
            block.height = payload.geometry.height
        elif payload.shape_type == BlockShapeType.rect:
            block.shape_type = BlockShapeType.rect
            block.vertices = None
        block.is_user_corrected = True
        save_crop(block.page, block)
        should_reset_conversion = True
    if payload.block_type is not None:
        block.block_type = payload.block_type
        block.is_user_corrected = True
        should_reset_conversion = True
    block.source = BlockSource.manual
    if payload.approval is not None:
        block.approval = payload.approval
    if payload.order_index is not None:
        block.order_index = payload.order_index
    if "manual_output" in payload.model_fields_set:
        block.manual_output = payload.manual_output
    if "user_instruction" in payload.model_fields_set:
        block.user_instruction = payload.user_instruction

    if should_reset_conversion:
        block.generated_output = None
        block.manual_output = None
        block.user_instruction = None
        block.raw_response = None
        block.warnings = []
    block.page.review_status = (
        PageReviewStatus.in_review if block.page.review_status == PageReviewStatus.unreviewed else block.page.review_status
    )
    block.page.review_started_at = block.page.review_started_at or datetime.now(UTC)
    block.page.layout_version += 1
    assemble_document(db, block.page.document_id)
    db.commit()
    db.refresh(block)
    return serialize_block(block)


@router.post("/blocks/{block_id}/regenerate", response_model=JobResponse)
def regenerate_block(
    block_id: str,
    payload: RegenerateBlockRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> JobResponse:
    block = db.get(Block, block_id)
    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Block not found")
    if payload.instruction is not None:
        block.user_instruction = payload.instruction
        db.commit()
    job = create_job(db, "regenerate_block", "block", block_id, message="Queued block regeneration")
    background_tasks.add_task(regenerate_block_job, job.id, block_id, payload.save_masked_crop_debug)
    return JobResponse.model_validate(job, from_attributes=True)


@router.get("/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> JobResponse:
    from ..models import Job

    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return JobResponse.model_validate(job, from_attributes=True)


@router.get("/documents/{document_id}/events")
async def stream_document_events(
    document_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> StreamingResponse:
    load_document(db, document_id)

    async def event_stream():
        previous_payload = ""
        while True:
            with SessionLocal() as stream_db:
                document = load_document(stream_db, document_id)
                payload = json.dumps(
                    {
                        "documentId": document.id,
                        "status": document.status,
                        "updatedAt": document.updated_at.isoformat(),
                        "pageCount": len(document.pages),
                    }
                )
            if payload != previous_payload:
                previous_payload = payload
                yield f"data: {payload}\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
