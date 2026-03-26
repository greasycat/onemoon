from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .models import BlockApproval, BlockType, CompileStatus, DocumentStatus, JobStatus


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class BlockGeometry(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class BlockCreate(BaseModel):
    geometry: BlockGeometry
    block_type: BlockType = BlockType.unknown


class BlockPatch(BaseModel):
    geometry: BlockGeometry | None = None
    block_type: BlockType | None = None
    approval: BlockApproval | None = None
    order_index: int | None = None
    manual_output: str | None = None
    user_instruction: str | None = None


class RegenerateBlockRequest(BaseModel):
    instruction: str | None = None


class DocumentPatch(BaseModel):
    assembled_latex: str | None = None
    title: str | None = None


class ProjectSummary(BaseModel):
    id: str
    name: str
    document_count: int
    documents: list["ProjectDocumentSummary"]
    created_at: datetime


class ProjectDocumentSummary(BaseModel):
    id: str
    title: str
    status: DocumentStatus
    updated_at: datetime
    page_count: int


class BlockResponse(BaseModel):
    id: str
    page_id: str
    order_index: int
    block_type: BlockType
    approval: BlockApproval
    geometry: BlockGeometry
    confidence: float
    is_user_corrected: bool
    crop_url: str | None
    generated_output: str | None
    manual_output: str | None
    user_instruction: str | None
    warnings: list[str]
    updated_at: datetime


class PageResponse(BaseModel):
    id: str
    page_index: int
    image_url: str
    width: int
    height: int
    blocks: list[BlockResponse]


class CompileArtifactResponse(BaseModel):
    id: str
    version: int
    status: CompileStatus
    tex_url: str
    pdf_url: str | None
    log_url: str
    created_at: datetime


class DocumentDetailResponse(BaseModel):
    id: str
    project_id: str
    title: str
    filename: str
    source_kind: str
    status: DocumentStatus
    assembled_latex: str | None
    latest_compile_status: CompileStatus | None
    pages: list[PageResponse]
    compile_artifacts: list[CompileArtifactResponse]
    created_at: datetime
    updated_at: datetime


class JobResponse(BaseModel):
    id: str
    job_type: str
    resource_type: str
    resource_id: str
    status: JobStatus
    progress: float
    message: str
    payload: dict
    created_at: datetime
    updated_at: datetime
