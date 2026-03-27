from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import JSON, DateTime, Enum as SqlEnum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def generate_id() -> str:
    return uuid.uuid4().hex


class DocumentStatus(str, Enum):
    uploaded = "uploaded"
    rendering = "rendering"
    segmenting = "segmenting"
    review = "review"
    compiling = "compiling"
    completed = "completed"
    failed = "failed"


class BlockType(str, Enum):
    text = "text"
    math = "math"
    figure = "figure"
    unknown = "unknown"


class BlockApproval(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class CompileStatus(str, Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"
    skipped = "skipped"


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class PageReviewStatus(str, Enum):
    unreviewed = "unreviewed"
    in_review = "in_review"
    segmented = "segmented"


class BlockSource(str, Enum):
    manual = "manual"
    auto = "auto"


class BlockShapeType(str, Enum):
    rect = "rect"
    polygon = "polygon"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    username: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32), default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    documents: Mapped[list["Document"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Document.created_at.desc()",
    )


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    filename: Mapped[str] = mapped_column(String(255))
    source_kind: Mapped[str] = mapped_column(String(16))
    original_file_path: Mapped[str] = mapped_column(String(512))
    status: Mapped[DocumentStatus] = mapped_column(SqlEnum(DocumentStatus, native_enum=False), default=DocumentStatus.uploaded)
    assembled_latex: Mapped[str | None] = mapped_column(Text, nullable=True)
    latest_compile_status: Mapped[CompileStatus | None] = mapped_column(
        SqlEnum(CompileStatus, native_enum=False),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    project: Mapped[Project] = relationship(back_populates="documents")
    pages: Mapped[list["Page"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="Page.page_index.asc()",
    )
    compile_artifacts: Mapped[list["CompileArtifact"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="CompileArtifact.version.desc()",
    )


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    page_index: Mapped[int] = mapped_column(Integer)
    image_path: Mapped[str] = mapped_column(String(512))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    review_status: Mapped[PageReviewStatus] = mapped_column(
        SqlEnum(PageReviewStatus, native_enum=False),
        default=PageReviewStatus.unreviewed,
    )
    review_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    layout_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    document: Mapped[Document] = relationship(back_populates="pages")
    blocks: Mapped[list["Block"]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
        order_by="Block.order_index.asc()",
    )


class Block(Base):
    __tablename__ = "blocks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id"), index=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    block_type: Mapped[BlockType] = mapped_column(SqlEnum(BlockType, native_enum=False), default=BlockType.unknown)
    approval: Mapped[BlockApproval] = mapped_column(
        SqlEnum(BlockApproval, native_enum=False),
        default=BlockApproval.pending,
    )
    shape_type: Mapped[BlockShapeType] = mapped_column(
        SqlEnum(BlockShapeType, native_enum=False),
        default=BlockShapeType.rect,
    )
    vertices: Mapped[list[dict[str, float]] | None] = mapped_column(JSON, nullable=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    width: Mapped[float] = mapped_column(Float)
    height: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    is_user_corrected: Mapped[bool] = mapped_column(default=False)
    source: Mapped[BlockSource] = mapped_column(
        SqlEnum(BlockSource, native_enum=False),
        default=BlockSource.manual,
    )
    parent_block_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    crop_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    generated_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    manual_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    page: Mapped[Page] = relationship(back_populates="blocks")


class CompileArtifact(Base):
    __tablename__ = "compile_artifacts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[CompileStatus] = mapped_column(SqlEnum(CompileStatus, native_enum=False), default=CompileStatus.pending)
    tex_path: Mapped[str] = mapped_column(String(512))
    pdf_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    log_path: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    document: Mapped[Document] = relationship(back_populates="compile_artifacts")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=generate_id)
    job_type: Mapped[str] = mapped_column(String(64), index=True)
    resource_type: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[JobStatus] = mapped_column(SqlEnum(JobStatus, native_enum=False), default=JobStatus.pending)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(String(255), default="Queued")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
