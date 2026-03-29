import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Trash2,
  Upload,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { DocumentStatus, ProjectDocumentSummary, ProjectSummary } from '../lib/types'

const PROCESSING_STATUSES: DocumentStatus[] = ['uploaded', 'rendering', 'segmenting', 'compiling']
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatShortDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Recently' : SHORT_DATE_FORMATTER.format(parsed)
}

function formatDateTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Recently updated' : TIMESTAMP_FORMATTER.format(parsed)
}

function getProjectLastActivity(project: ProjectSummary) {
  return project.documents.reduce((latest, document) => (
    document.updated_at > latest ? document.updated_at : latest
  ), project.created_at)
}

function countDocumentsByStatus(projects: ProjectSummary[], statuses: DocumentStatus[]) {
  const statusSet = new Set(statuses)
  return projects.reduce((count, project) => (
    count + project.documents.filter((document) => statusSet.has(document.status)).length
  ), 0)
}

function getLatestDocument(projects: ProjectSummary[]) {
  let latestProject: ProjectSummary | null = null
  let latestDocument: ProjectDocumentSummary | null = null

  for (const project of projects) {
    for (const document of project.documents) {
      if (!latestDocument || document.updated_at > latestDocument.updated_at) {
        latestDocument = document
        latestProject = project
      }
    }
  }

  if (!latestProject || !latestDocument) {
    return null
  }

  return { project: latestProject, document: latestDocument }
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const filePickerRef = useRef<HTMLInputElement | null>(null)
  const { token } = useAuth()
  const [projectName, setProjectName] = useState('Spring Notebook')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [uploadProjectId, setUploadProjectId] = useState<string | null>(null)
  const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(null)
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ type: 'project' | 'document'; id: string } | null>(null)

  const projectsQuery = useQuery({
    queryKey: ['projects', token],
    queryFn: () => api.getProjects(token!),
    enabled: Boolean(token),
  })

  const createProjectMutation = useMutation({
    mutationFn: () => api.createProject(token!, projectName.trim()),
    onSuccess: async (project) => {
      setSelectedProjectId(project.id)
      setProjectName('')
      setCreateErrorMessage(null)
      await queryClient.invalidateQueries({ queryKey: ['projects', token] })
    },
    onError: (error: Error) => {
      setCreateErrorMessage(error.message)
    },
  })

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => api.deleteProject(token!, projectId),
    onSuccess: async () => {
      setPendingDelete(null)
      setSelectedProjectId('')
      await queryClient.invalidateQueries({ queryKey: ['projects', token] })
    },
  })

  const deleteDocumentMutation = useMutation({
    mutationFn: (documentId: string) => api.deleteDocument(token!, documentId),
    onSuccess: async () => {
      setPendingDelete(null)
      await queryClient.invalidateQueries({ queryKey: ['projects', token] })
    },
  })

  const projects = projectsQuery.data ?? []
  const activeProjectId = selectedProjectId || projects[0]?.id || ''
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  )
  const activeProjectDocuments = useMemo(
    () => (activeProject ? [...activeProject.documents].sort((left, right) => right.updated_at.localeCompare(left.updated_at)) : []),
    [activeProject],
  )
  const latestDocument = useMemo(() => getLatestDocument(projects), [projects])
  const totalDocuments = useMemo(
    () => projects.reduce((count, project) => count + project.document_count, 0),
    [projects],
  )
  const reviewDocuments = useMemo(
    () => countDocumentsByStatus(projects, ['review']),
    [projects],
  )
  const processingDocuments = useMemo(
    () => countDocumentsByStatus(projects, PROCESSING_STATUSES),
    [projects],
  )
  const completedDocuments = useMemo(
    () => countDocumentsByStatus(projects, ['completed']),
    [projects],
  )

  const uploadMutation = useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: File }) =>
      api.uploadDocument(token!, projectId, file),
    onSuccess: (job) => {
      setUploadErrorMessage(null)
      navigate(`/documents/${job.resource_id}`, {
        state: { pendingUploadJobId: job.id },
      })
    },
    onError: (error: Error) => {
      setUploadErrorMessage(error.message)
    },
    onSettled: () => {
      setUploadProjectId(null)
      if (filePickerRef.current) {
        filePickerRef.current.value = ''
      }
    },
  })

  function startUpload(projectId: string) {
    setSelectedProjectId(projectId)
    setUploadProjectId(projectId)
    setUploadErrorMessage(null)
    filePickerRef.current?.click()
  }

  return (
    <main className="page-shell projects-dashboard">
      <header className="projects-dashboard-header">
        <div className="projects-dashboard-header-title">
          <p className="eyebrow">Dashboard</p>
          <h1>Your workspaces</h1>
        </div>
        <div className="projects-dashboard-header-actions">
          <div className="projects-dashboard-meta-row" aria-label="Dashboard summary">
            <span className="projects-dashboard-meta-item">
              <LayoutGrid aria-hidden="true" />
              {projects.length} workspaces
            </span>
            <span className="projects-dashboard-meta-item">
              <FileUp aria-hidden="true" />
              {totalDocuments} uploads
            </span>
            <span className="projects-dashboard-meta-item">
              <Clock3 aria-hidden="true" />
              {processingDocuments + reviewDocuments} active
            </span>
            <span className="projects-dashboard-meta-item">
              <CheckCircle2 aria-hidden="true" />
              {completedDocuments} done
            </span>
          </div>
          {latestDocument ? (
            <Link className="secondary-button projects-dashboard-link-button" to={`/documents/${latestDocument.document.id}`}>
              <span>Open latest</span>
              <ArrowRight className="button-inline-icon" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </header>

      <section className="projects-dashboard-layout">
        <div className="projects-dashboard-main">
          <section className="panel projects-dashboard-library-panel">
            <input
              ref={filePickerRef}
              className="projects-dashboard-upload-input"
              type="file"
              accept="application/pdf,image/*"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                if (!file || !uploadProjectId) {
                  setUploadProjectId(null)
                  return
                }
                setUploadErrorMessage(null)
                uploadMutation.mutate({ projectId: uploadProjectId, file })
              }}
            />
            <div className="panel-heading projects-dashboard-section-heading">
              <div>
                <p className="eyebrow">Library</p>
                <h2>Workspaces</h2>
              </div>
              <p className="muted-text">
                {activeProject ? `Active: ${activeProject.name}` : 'Create a workspace to begin.'}
              </p>
            </div>

            <form
              className="projects-dashboard-create-bar"
              onSubmit={(event) => {
                event.preventDefault()
                setCreateErrorMessage(null)
                createProjectMutation.mutate()
              }}
            >
              <label className="field">
                <span>New workspace</span>
                <input
                  name="projectName"
                  autoComplete="off"
                  placeholder="Spring Notebook"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </label>
              <button type="submit" className="secondary-button" disabled={createProjectMutation.isPending || !projectName.trim()}>
                <FolderPlus className="button-inline-icon" aria-hidden="true" />
                <span>{createProjectMutation.isPending ? 'Creating…' : 'Create'}</span>
              </button>
            </form>

            {createErrorMessage ? <p className="error-text" role="alert">{createErrorMessage}</p> : null}
            {uploadErrorMessage ? <p className="error-text" role="alert">{uploadErrorMessage}</p> : null}
            {projectsQuery.isError ? <p className="error-text" role="alert">Unable to load workspaces.</p> : null}

            {projects.length > 0 ? (
              <div className="projects-dashboard-project-list">
                {projects.map((project) => {
                  const projectIsActive = activeProjectId === project.id
                  const sortedDocuments = [...project.documents]
                    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))

                  const projectPendingDelete = pendingDelete?.type === 'project' && pendingDelete.id === project.id

                  return (
                    <article
                      key={project.id}
                      className={`projects-dashboard-folder ${projectIsActive ? 'projects-dashboard-folder-open' : ''}`}
                    >
                      {projectPendingDelete ? (
                        <div className="projects-dashboard-folder-row projects-dashboard-delete-confirm">
                          <Trash2 className="projects-dashboard-delete-confirm-icon" aria-hidden="true" />
                          <span className="projects-dashboard-delete-confirm-label">Delete "{project.name}"?</span>
                          <button type="button" className="projects-dashboard-delete-cancel" onClick={() => setPendingDelete(null)}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="projects-dashboard-delete-ok"
                            disabled={deleteProjectMutation.isPending}
                            onClick={() => deleteProjectMutation.mutate(project.id)}
                          >
                            {deleteProjectMutation.isPending ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      ) : (
                        <div className="projects-dashboard-folder-row">
                          <button
                            type="button"
                            className="projects-dashboard-folder-toggle"
                            aria-expanded={projectIsActive}
                            onClick={() => {
                              setSelectedProjectId(projectIsActive ? '' : project.id)
                              setUploadErrorMessage(null)
                            }}
                          >
                            <ChevronRight className="projects-dashboard-folder-chevron" aria-hidden="true" />
                            {projectIsActive
                              ? <FolderOpen className="projects-dashboard-folder-icon" aria-hidden="true" />
                              : <Folder className="projects-dashboard-folder-icon" aria-hidden="true" />
                            }
                            <span className="projects-dashboard-folder-name">{project.name}</span>
                          </button>
                          <div className="projects-dashboard-folder-actions">
                            <button
                              type="button"
                              className="projects-dashboard-upload-trigger"
                              aria-label={`Upload into ${project.name}`}
                              disabled={uploadMutation.isPending}
                              onClick={() => startUpload(project.id)}
                            >
                              <Upload aria-hidden="true" />
                              <span>{uploadMutation.isPending && uploadProjectId === project.id ? 'Uploading…' : 'Upload'}</span>
                            </button>
                            <span className="projects-dashboard-folder-meta">
                              <span className="projects-dashboard-project-date">{formatDateTime(getProjectLastActivity(project))}</span>
                              <span className="projects-dashboard-doc-count">{project.document_count} docs</span>
                            </span>
                            <button
                              type="button"
                              className="projects-dashboard-delete-btn"
                              aria-label={`Delete ${project.name}`}
                              onClick={() => setPendingDelete({ type: 'project', id: project.id })}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="projects-dashboard-folder-contents">
                        <div className="projects-dashboard-folder-inner">
                          {sortedDocuments.length > 0 ? (
                            <ul className="document-list projects-dashboard-document-list">
                              {sortedDocuments.map((document) => {
                                const docPendingDelete = pendingDelete?.type === 'document' && pendingDelete.id === document.id
                                return (
                                  <li key={document.id}>
                                    {docPendingDelete ? (
                                      <div className="projects-dashboard-file-confirm">
                                        <FileText className="projects-dashboard-file-icon" aria-hidden="true" />
                                        <span className="projects-dashboard-delete-confirm-label">Delete file?</span>
                                        <button type="button" className="projects-dashboard-delete-cancel" onClick={() => setPendingDelete(null)}>
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          className="projects-dashboard-delete-ok"
                                          disabled={deleteDocumentMutation.isPending}
                                          onClick={() => deleteDocumentMutation.mutate(document.id)}
                                        >
                                          {deleteDocumentMutation.isPending ? 'Deleting…' : 'Delete'}
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="projects-dashboard-file-row">
                                        <Link className="projects-dashboard-document-link" to={`/documents/${document.id}`}>
                                          <FileText className="projects-dashboard-file-icon" aria-hidden="true" />
                                          <span>
                                            {document.title}
                                            <small>{document.page_count} pages</small>
                                          </span>
                                        </Link>
                                        <button
                                          type="button"
                                          className="projects-dashboard-delete-btn"
                                          aria-label={`Delete ${document.title}`}
                                          onClick={() => setPendingDelete({ type: 'document', id: document.id })}
                                        >
                                          <Trash2 aria-hidden="true" />
                                        </button>
                                      </div>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          ) : (
                            <p className="projects-dashboard-folder-empty">No uploads yet.</p>
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="projects-dashboard-empty-state">
                <FolderOpen aria-hidden="true" />
                <div>
                  <strong>No workspaces yet</strong>
                  <p className="muted-text">Create one above, then use its row upload button to open the review workspace.</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="projects-dashboard-rail">
          <section className="panel projects-dashboard-focus-panel">
            <div className="panel-heading projects-dashboard-section-heading">
              <div>
                <p className="eyebrow">Focus</p>
                <h2>{activeProject ? activeProject.name : 'Selected workspace'}</h2>
              </div>
              {activeProject ? (
                <span className="projects-dashboard-focus-date">Created {formatShortDate(activeProject.created_at)}</span>
              ) : null}
            </div>

            {activeProject ? (
              <>
                <div className="projects-dashboard-focus-metrics">
                  <div>
                    <strong>{activeProject.document_count}</strong>
                    <span>documents</span>
                  </div>
                  <div>
                    <strong>{activeProjectDocuments.filter((document) => document.status === 'review').length}</strong>
                    <span>in review</span>
                  </div>
                  <div>
                    <strong>{activeProjectDocuments.filter((document) => PROCESSING_STATUSES.includes(document.status)).length}</strong>
                    <span>processing</span>
                  </div>
                </div>

                {activeProjectDocuments.length > 0 ? (
                  <ul className="document-list projects-dashboard-focus-list">
                    {activeProjectDocuments.slice(0, 4).map((document) => (
                      <li key={document.id}>
                        <Link className="projects-dashboard-focus-link" to={`/documents/${document.id}`}>
                          <span>
                            {document.title}
                            <small>Updated {formatDateTime(document.updated_at)}</small>
                          </span>
                          <span className={`status-chip status-${document.status}`}>{document.status}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">This workspace is empty. Use the Upload button in its row to create the first review session.</p>
                )}
              </>
            ) : (
              <p className="muted-text">Choose a workspace to inspect recent uploads and route the next file into review.</p>
            )}
          </section>
        </aside>
      </section>
    </main>
  )
}
