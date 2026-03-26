from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import get_current_user
from ..db import get_db
from ..models import Document, Project, User
from ..schemas import ProjectCreate, ProjectDocumentSummary, ProjectSummary

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectSummary])
def list_projects(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> list[ProjectSummary]:
    projects = db.scalars(
        select(Project)
        .options(selectinload(Project.documents).selectinload(Document.pages))
        .order_by(Project.updated_at.desc())
    ).all()
    return [serialize_project(project) for project in projects]


@router.post("", response_model=ProjectSummary)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ProjectSummary:
    project = Project(name=payload.name.strip())
    db.add(project)
    db.commit()
    db.refresh(project)
    return serialize_project(project)


def serialize_project(project: Project) -> ProjectSummary:
    documents = sorted(project.documents, key=lambda item: item.updated_at, reverse=True)
    return ProjectSummary(
        id=project.id,
        name=project.name,
        document_count=len(documents),
        documents=[
            ProjectDocumentSummary(
                id=document.id,
                title=document.title,
                status=document.status,
                updated_at=document.updated_at,
                page_count=len(document.pages),
            )
            for document in documents
        ],
        created_at=project.created_at,
    )
