export type DocumentStatus =
  | 'uploaded'
  | 'rendering'
  | 'segmenting'
  | 'review'
  | 'compiling'
  | 'completed'
  | 'failed'

export type BlockType = 'text' | 'math' | 'figure'
export type BlockApproval = 'pending' | 'approved' | 'rejected'
export type CompileStatus = 'pending' | 'completed' | 'failed' | 'skipped'
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'
export type PageReviewStatus = 'unreviewed' | 'in_review' | 'segmented'
export type BlockSource = 'manual' | 'auto'
export type BlockShapeType = 'rect' | 'polygon'
export type BlockSelectionMode = 'replace' | 'toggle' | 'range'

export interface ProjectDocumentSummary {
  id: string
  title: string
  status: DocumentStatus
  updated_at: string
  page_count: number
}

export interface ProjectSummary {
  id: string
  name: string
  document_count: number
  documents: ProjectDocumentSummary[]
  created_at: string
}

export interface BlockGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface BlockVertex {
  x: number
  y: number
}

export interface BlockResponse {
  id: string
  page_id: string
  order_index: number
  block_type: BlockType
  approval: BlockApproval
  source: BlockSource
  shape_type: BlockShapeType
  vertices: BlockVertex[] | null
  parent_block_id: string | null
  geometry: BlockGeometry
  confidence: number
  is_user_corrected: boolean
  crop_url: string | null
  generated_output: string | null
  manual_output: string | null
  user_instruction: string | null
  warnings: string[]
  updated_at: string
}

export interface PageResponse {
  id: string
  page_index: number
  image_url: string
  width: number
  height: number
  review_status: PageReviewStatus
  review_started_at: string | null
  review_completed_at: string | null
  layout_version: number
  blocks: BlockResponse[]
}

export interface CompileArtifactResponse {
  id: string
  version: number
  status: CompileStatus
  tex_url: string
  pdf_url: string | null
  log_url: string
  created_at: string
}

export interface DocumentDetailResponse {
  id: string
  project_id: string
  title: string
  filename: string
  source_kind: string
  status: DocumentStatus
  assembled_latex: string | null
  latest_compile_status: CompileStatus | null
  pages: PageResponse[]
  compile_artifacts: CompileArtifactResponse[]
  created_at: string
  updated_at: string
}

export interface DocumentMergeResponse {
  assembled_latex: string
  warnings: string[]
}

export interface JobResponse {
  id: string
  job_type: string
  resource_type: string
  resource_id: string
  status: JobStatus
  progress: number
  message: string
  payload: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  username: string
}

export interface BlockPatchPayload {
  geometry?: BlockGeometry
  shape_type?: BlockShapeType
  vertices?: BlockVertex[] | null
  block_type?: BlockType
  approval?: BlockApproval
  order_index?: number
  manual_output?: string | null
  user_instruction?: string | null
}

export interface PageLayoutBlockPayload {
  id?: string
  order_index: number
  block_type: BlockType
  approval: BlockApproval
  source: BlockSource
  shape_type?: BlockShapeType
  vertices?: BlockVertex[] | null
  parent_block_id?: string | null
  geometry: BlockGeometry
}
