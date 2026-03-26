import type {
  BlockPatchPayload,
  BlockResponse,
  CompileArtifactResponse,
  DocumentDetailResponse,
  JobResponse,
  LoginResponse,
  PageLayoutBlockPayload,
  PageResponse,
  ProjectSummary,
} from './types'

function defaultApiRoot() {
  if (typeof window === 'undefined') {
    return 'http://localhost:8000/api'
  }
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:8000/api`
}

function resolveApiRoot() {
  const configured = import.meta.env.VITE_API_URL
  if (!configured || typeof window === 'undefined') {
    return configured ?? defaultApiRoot()
  }

  try {
    const url = new URL(configured)
    const currentHost = window.location.hostname
    const isLoopbackTarget = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    const isRemoteBrowser = currentHost !== 'localhost' && currentHost !== '127.0.0.1'

    if (isLoopbackTarget && isRemoteBrowser) {
      url.hostname = currentHost
      return url.toString().replace(/\/$/, '')
    }
  } catch {
    return configured
  }

  return configured
}

const API_ROOT = resolveApiRoot()

type RequestBody = BodyInit | object | undefined
type ApiOptions = Omit<RequestInit, 'body'> & {
  token?: string | null
  body?: RequestBody
  isFormData?: boolean
}

function formatApiDetail(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string' && item.trim()) {
          return item
        }
        if (!item || typeof item !== 'object') {
          return null
        }

        const payload = item as { loc?: unknown; msg?: unknown }
        const location = Array.isArray(payload.loc) ? payload.loc.join('.') : null
        const message = typeof payload.msg === 'string' ? payload.msg : null
        return [location, message].filter(Boolean).join(': ') || null
      })
      .filter((message): message is string => Boolean(message))

    return messages.length > 0 ? messages.join('; ') : null
  }

  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail)
  }

  return null
}

async function request<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`)
  }

  let body = options.body
  if (body && !options.isFormData && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }

  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers,
    body: body as BodyInit | null | undefined,
  })

  if (!response.ok) {
    let message = response.statusText
    try {
      const payload = (await response.json()) as { detail?: unknown }
      message = formatApiDetail(payload.detail) ?? message
    } catch {
      message = response.statusText
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
    }),
  getProjects: (token: string) =>
    request<ProjectSummary[]>('/projects', {
      token,
    }),
  createProject: (token: string, name: string) =>
    request<ProjectSummary>('/projects', {
      method: 'POST',
      token,
      body: { name },
    }),
  uploadDocument: (token: string, projectId: string, file: File) => {
    const formData = new FormData()
    formData.append('project_id', projectId)
    formData.append('file', file)
    return request<JobResponse>('/documents', {
      method: 'POST',
      token,
      body: formData,
      isFormData: true,
    })
  },
  getDocument: (token: string, documentId: string) =>
    request<DocumentDetailResponse>(`/documents/${documentId}`, {
      token,
    }),
  getDocumentPages: (token: string, documentId: string) =>
    request<PageResponse[]>(`/documents/${documentId}/pages`, {
      token,
    }),
  getPageLayout: (token: string, pageId: string) =>
    request<PageResponse>(`/pages/${pageId}/layout`, {
      token,
    }),
  savePageLayout: (token: string, pageId: string, blocks: PageLayoutBlockPayload[]) =>
    request<PageResponse>(`/pages/${pageId}/layout`, {
      method: 'PUT',
      token,
      body: { blocks },
    }),
  markPageSegmented: (token: string, pageId: string) =>
    request<PageResponse>(`/pages/${pageId}/mark-segmented`, {
      method: 'POST',
      token,
    }),
  reopenPage: (token: string, pageId: string) =>
    request<PageResponse>(`/pages/${pageId}/reopen`, {
      method: 'POST',
      token,
    }),
  updateDocument: (token: string, documentId: string, payload: { title?: string; assembled_latex?: string }) =>
    request<DocumentDetailResponse>(`/documents/${documentId}`, {
      method: 'PATCH',
      token,
      body: payload,
    }),
  compileDocument: (token: string, documentId: string) =>
    request<JobResponse>(`/documents/${documentId}/compile`, {
      method: 'POST',
      token,
    }),
  getArtifacts: (token: string, documentId: string) =>
    request<CompileArtifactResponse[]>(`/documents/${documentId}/artifacts`, {
      token,
    }),
  createBlock: (
    token: string,
    pageId: string,
    payload: { geometry: BlockResponse['geometry']; block_type: BlockResponse['block_type'] },
  ) =>
    request<BlockResponse>(`/pages/${pageId}/blocks`, {
      method: 'POST',
      token,
      body: payload,
    }),
  resegmentPage: (token: string, pageId: string) =>
    request<JobResponse>(`/pages/${pageId}/resegment`, {
      method: 'POST',
      token,
    }),
  updateBlock: (token: string, blockId: string, payload: BlockPatchPayload) =>
    request<BlockResponse>(`/blocks/${blockId}`, {
      method: 'PATCH',
      token,
      body: payload,
    }),
  regenerateBlock: (token: string, blockId: string, instruction: string) =>
    request<JobResponse>(`/blocks/${blockId}/regenerate`, {
      method: 'POST',
      token,
      body: { instruction },
    }),
  getJob: (token: string, jobId: string) =>
    request<JobResponse>(`/jobs/${jobId}`, {
      token,
    }),
}

export function withApiRoot(path: string | null | undefined): string | null {
  if (!path) {
    return null
  }
  if (path.startsWith('http')) {
    return path
  }
  const base = API_ROOT.endsWith('/api') ? API_ROOT.slice(0, -4) : API_ROOT
  return `${base}${path}`
}
