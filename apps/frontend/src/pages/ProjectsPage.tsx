import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'

import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

export function ProjectsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { token } = useAuth()
  const [projectName, setProjectName] = useState('Spring Notebook')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const projectsQuery = useQuery({
    queryKey: ['projects', token],
    queryFn: () => api.getProjects(token!),
    enabled: Boolean(token),
  })

  const createProjectMutation = useMutation({
    mutationFn: () => api.createProject(token!, projectName),
    onSuccess: async (project) => {
      setSelectedProjectId(project.id)
      setProjectName('')
      await queryClient.invalidateQueries({ queryKey: ['projects', token] })
    },
  })

  const uploadMutation = useMutation({
    mutationFn: () => api.uploadDocument(token!, selectedProjectId, selectedFile!),
    onSuccess: (job) => {
      navigate(`/documents/${job.resource_id}`)
    },
    onError: (error: Error) => {
      setErrorMessage(error.message)
    },
  })

  const projects = projectsQuery.data ?? []
  const activeProjectId = selectedProjectId || projectsQuery.data?.[0]?.id || ''

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Manage notebooks and send pages into review.</h1>
        </div>
        <p className="lede">
          Projects persist document history and page layouts so you can return to the same notebook and continue manual segmentation later.
        </p>
      </section>

      <section className="two-column-layout">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Projects</p>
              <h2>Create a workspace</h2>
            </div>
          </div>
          <form
            className="stacked-form"
            onSubmit={(event) => {
              event.preventDefault()
              createProjectMutation.mutate()
            }}
          >
            <label className="field">
              <span>Name</span>
              <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </label>
            <button type="submit" className="primary-button" disabled={createProjectMutation.isPending || !projectName.trim()}>
              {createProjectMutation.isPending ? 'Creating...' : 'Create project'}
            </button>
          </form>

          <div className="project-list">
            {projects.map((project) => (
              <article
                key={project.id}
                className={`project-card ${activeProjectId === project.id ? 'project-card-active' : ''}`}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <div className="project-card-head">
                  <h3>{project.name}</h3>
                  <span className="status-chip status-review">{project.document_count} docs</span>
                </div>
                {project.documents.length > 0 ? (
                  <ul className="document-list">
                    {project.documents.map((document) => (
                      <li key={document.id}>
                        <Link to={`/documents/${document.id}`}>
                          <span>{document.title}</span>
                          <span className={`status-chip status-${document.status}`}>{document.status}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text">No uploads yet.</p>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Upload</p>
              <h2>Add a PDF or image</h2>
            </div>
          </div>
          <form
            className="stacked-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!selectedFile || !activeProjectId) {
                return
              }
              setErrorMessage(null)
              uploadMutation.mutate()
            }}
          >
            <label className="field">
              <span>Target project</span>
              <select value={activeProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Source file</span>
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
            <button type="submit" className="primary-button" disabled={!activeProjectId || !selectedFile || uploadMutation.isPending}>
              {uploadMutation.isPending ? 'Uploading...' : 'Start ingestion'}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
