from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import get_current_user
from ..db import SessionLocal, get_db
from ..models import Block, BlockApproval, CompileArtifact, CompileStatus, Document, DocumentStatus, Page, Project, User
from ..schemas import (
    BlockCreate,
    BlockGeometry,
    BlockPatch,
    BlockResponse,
    CompileArtifactResponse,
    DocumentDetailResponse,
    DocumentPatch,
    JobResponse,
    PageResponse,
    RegenerateBlockRequest,
)
from ..services.pipeline import (
    assemble_document,
    compile_document_job,
    create_job,
    ingest_document_job,
    regenerate_block_job,
    resegment_page_job,
    save_crop,
)
from ..storage import public_url, relative_path, sanitize_filename, upload_path

router = APIRouter(tags=["documents"])


def serialize_block(block: Block) -> BlockResponse:
    return BlockResponse(
        id=block.id,
        page_id=block.page_id,
        order_index=block.order_index,
        block_type=block.block_type,
        approval=block.approval,
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


@router.post("/documents", response_model=JobResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    project_id: str,
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
        assembled_latex=document.assembled_latex,
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
    db.commit()
    db.refresh(document)
    return get_document(document_id, db, _)


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
        x=payload.geometry.x,
        y=payload.geometry.y,
        width=payload.geometry.width,
        height=payload.geometry.height,
        confidence=1.0,
        is_user_corrected=True,
    )
    db.add(block)
    db.flush()
    save_crop(page, block)
    from ..services.pipeline import convert_block

    convert_block(block, page)
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

    if payload.geometry is not None:
        block.x = payload.geometry.x
        block.y = payload.geometry.y
        block.width = payload.geometry.width
        block.height = payload.geometry.height
        block.is_user_corrected = True
        save_crop(block.page, block)
    if payload.block_type is not None:
        block.block_type = payload.block_type
        block.is_user_corrected = True
    if payload.approval is not None:
        block.approval = payload.approval
    if payload.order_index is not None:
        block.order_index = payload.order_index
    if payload.manual_output is not None:
        block.manual_output = payload.manual_output
    if payload.user_instruction is not None:
        block.user_instruction = payload.user_instruction

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
    background_tasks.add_task(regenerate_block_job, job.id, block_id)
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
