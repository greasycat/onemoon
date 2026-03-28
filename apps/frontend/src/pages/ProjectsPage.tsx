import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileUp,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Upload,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
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

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return null
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  const { token } = useAuth()
  const [projectName, setProjectName] = useState('Spring Notebook')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(null)
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null)

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
  const selectedFileSize = selectedFile ? formatFileSize(selectedFile.size) : null

  const uploadMutation = useMutation({
    mutationFn: () => api.uploadDocument(token!, activeProjectId, selectedFile!),
    onSuccess: (job) => {
      navigate(`/documents/${job.resource_id}`)
    },
    onError: (error: Error) => {
      setUploadErrorMessage(error.message)
    },
  })

  return (
    <main className="page-shell projects-dashboard">
      <section className="panel projects-dashboard-hero">
        <div className="projects-dashboard-hero-copy">
          <p className="eyebrow">Dashboard</p>
          <h1>Upload fast. Review cleanly. Re-enter work instantly.</h1>
          <p className="lede">
            Keep notebooks separated by workspace, route the next file into the right queue, and reopen the latest review session without scanning clutter.
          </p>
          <div className="projects-dashboard-pill-row">
            <span className="projects-dashboard-pill">Projects {projects.length}</span>
            <span className="projects-dashboard-pill">In review {reviewDocuments}</span>
            <span className="projects-dashboard-pill">Completed {completedDocuments}</span>
          </div>
          {latestDocument ? (
            <Link className="secondary-button projects-dashboard-link-button" to={`/documents/${latestDocument.document.id}`}>
              <span>Open latest document</span>
              <ArrowRight className="button-inline-icon" aria-hidden="true" />
            </Link>
          ) : null}
        </div>

        <div className="projects-dashboard-stat-grid" aria-label="Dashboard summary">
          <article className="projects-dashboard-stat-card">
            <div className="projects-dashboard-stat-icon">
              <LayoutGrid aria-hidden="true" />
            </div>
            <strong>{projects.length}</strong>
            <span>workspaces</span>
          </article>
          <article className="projects-dashboard-stat-card">
            <div className="projects-dashboard-stat-icon">
              <FileUp aria-hidden="true" />
            </div>
            <strong>{totalDocuments}</strong>
            <span>uploads tracked</span>
          </article>
          <article className="projects-dashboard-stat-card">
            <div className="projects-dashboard-stat-icon">
              <Clock3 aria-hidden="true" />
            </div>
            <strong>{processingDocuments + reviewDocuments}</strong>
            <span>active queue</span>
          </article>
          <article className="projects-dashboard-stat-card">
            <div className="projects-dashboard-stat-icon">
              <CheckCircle2 aria-hidden="true" />
            </div>
            <strong>{completedDocuments}</strong>
            <span>completed</span>
          </article>
        </div>
      </section>

      <section className="projects-dashboard-layout">
        <div className="projects-dashboard-main">
          <section className="panel projects-dashboard-create-panel">
            <div className="panel-heading projects-dashboard-section-heading">
              <div>
                <p className="eyebrow">Workspace setup</p>
                <h2>Create a new notebook lane</h2>
              </div>
              <div className="projects-dashboard-inline-meta">
                <FolderPlus aria-hidden="true" />
                <span>Reusable grouping for future uploads and review sessions.</span>
              </div>
            </div>

            <form
              className="projects-dashboard-create-form"
              onSubmit={(event) => {
                event.preventDefault()
                setCreateErrorMessage(null)
                createProjectMutation.mutate()
              }}
            >
              <label className="field">
                <span>Name</span>
                <input
                  name="projectName"
                  autoComplete="off"
                  placeholder="Spring Notebook"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </label>
              <button type="submit" className="primary-button" disabled={createProjectMutation.isPending || !projectName.trim()}>
                {createProjectMutation.isPending ? 'Creating…' : 'Create workspace'}
              </button>
            </form>

            {createErrorMessage ? <p className="error-text" role="alert">{createErrorMessage}</p> : null}
            {projectsQuery.isError ? <p className="error-text" role="alert">Unable to load workspaces.</p> : null}
          </section>

          <section className="panel projects-dashboard-library-panel">
            <div className="panel-heading projects-dashboard-section-heading">
              <div>
                <p className="eyebrow">Library</p>
                <h2>Choose a workspace</h2>
              </div>
              <p className="muted-text">
                {activeProject ? `Selected: ${activeProject.name}` : 'Create a workspace to begin.'}
              </p>
            </div>

            {projects.length > 0 ? (
              <div className="projects-dashboard-project-list">
                {projects.map((project) => {
                  const projectIsActive = activeProjectId === project.id
                  const recentDocuments = [...project.documents]
                    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
                    .slice(0, 3)

                  return (
                    <article
                      key={project.id}
                      className={`project-card projects-dashboard-project-card ${projectIsActive ? 'project-card-active' : ''}`}
                    >
                      <button
                        type="button"
                        className="project-card-select"
                        aria-pressed={projectIsActive}
                        onClick={() => {
                          setSelectedProjectId(project.id)
                          setUploadErrorMessage(null)
                        }}
                      >
                        <div className="projects-dashboard-project-head">
                          <div>
                            <h3>{project.name}</h3>
                            <p className="projects-dashboard-project-date">
                              Updated {formatDateTime(getProjectLastActivity(project))}
                            </p>
                          </div>
                          <span className="status-chip status-review">{project.document_count} docs</span>
                        </div>
                        <div className="projects-dashboard-project-action">
                          <span>{projectIsActive ? 'Active workspace' : 'Set as active'}</span>
                          <ArrowRight className="button-inline-icon" aria-hidden="true" />
                        </div>
                      </button>

                      {recentDocuments.length > 0 ? (
                        <ul className="document-list projects-dashboard-document-list">
                          {recentDocuments.map((document) => (
                            <li key={document.id}>
                              <Link className="projects-dashboard-document-link" to={`/documents/${document.id}`}>
                                <span>
                                  {document.title}
                                  <small>{document.page_count} pages</small>
                                </span>
                                <span className={`status-chip status-${document.status}`}>{document.status}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted-text">No uploads yet. Use the action rail to add the first file.</p>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="projects-dashboard-empty-state">
                <FolderOpen aria-hidden="true" />
                <div>
                  <strong>No workspaces yet</strong>
                  <p className="muted-text">Create one above, then upload a source file to open the review workspace.</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="projects-dashboard-rail">
          <section className="panel projects-dashboard-upload-panel">
            <div className="panel-heading projects-dashboard-section-heading">
              <div>
                <p className="eyebrow">Upload</p>
                <h2>Send a file into review</h2>
              </div>
              <div className="projects-dashboard-inline-meta">
                <Upload aria-hidden="true" />
                <span>PDF or image</span>
              </div>
            </div>

            <form
              className="stacked-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (!selectedFile || !activeProjectId) {
                  return
                }
                setUploadErrorMessage(null)
                uploadMutation.mutate()
              }}
            >
              <label className="field">
                <span>Target workspace</span>
                <select
                  name="projectId"
                  value={activeProjectId}
                  onChange={(event) => {
                    setSelectedProjectId(event.target.value)
                    setUploadErrorMessage(null)
                  }}
                >
                  <option value="">Select a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field projects-dashboard-file-field">
                <span>Source file</span>
                <input
                  name="sourceFile"
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(event) => {
                    setSelectedFile(event.target.files?.[0] ?? null)
                    setUploadErrorMessage(null)
                  }}
                />
              </label>

              {selectedFile ? (
                <div className="projects-dashboard-file-summary">
                  <strong>{selectedFile.name}</strong>
                  <span>{selectedFileSize ?? 'Ready to upload'}</span>
                </div>
              ) : null}

              {uploadErrorMessage ? <p className="error-text" role="alert">{uploadErrorMessage}</p> : null}

              <button type="submit" className="primary-button projects-dashboard-upload-button" disabled={!activeProjectId || !selectedFile || uploadMutation.isPending}>
                {uploadMutation.isPending ? 'Uploading…' : 'Start ingestion'}
              </button>
            </form>
          </section>

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
                  <p className="muted-text">This workspace is empty. Upload a file above to create the first review session.</p>
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
