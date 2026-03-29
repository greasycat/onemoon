import type {
  BlockApproval,
  BlockGeometry,
  BlockResponse,
  BlockShapeType,
  BlockSource,
  BlockType,
  BlockVertex,
  PageLayoutBlockPayload,
  PageResponse,
  PageReviewStatus,
} from './types'

export interface DraftBlock {
  id?: string
  client_id: string
  order_index: number
  block_type: BlockType
  approval: BlockApproval
  source: BlockSource
  shape_type: BlockShapeType
  vertices: BlockVertex[] | null
  cut_path?: BlockVertex[] | null
  parent_block_id?: string | null
  geometry: BlockGeometry
  confidence: number
  is_user_corrected: boolean
  crop_url: string | null
  generated_output: string | null
  manual_output: string | null
  user_instruction: string | null
  warnings: string[]
}

export interface DraftPageLayout {
  page_id: string
  review_status: PageReviewStatus
  layout_version: number
  blocks: DraftBlock[]
}

function makeClientId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `draft-${Math.random().toString(36).slice(2)}`
}

export function draftBlockKey(block: Pick<DraftBlock, 'id' | 'client_id'>) {
  return block.id ?? block.client_id
}

export function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

export function clampVertex(vertex: BlockVertex): BlockVertex {
  return {
    x: clamp(vertex.x),
    y: clamp(vertex.y),
  }
}

export function clampGeometry(geometry: BlockGeometry): BlockGeometry {
  const x = clamp(geometry.x)
  const y = clamp(geometry.y)
  const width = clamp(geometry.width, 0.01, 1 - x)
  const height = clamp(geometry.height, 0.01, 1 - y)
  return { x, y, width, height }
}

export function geometryFromVertices(vertices: BlockVertex[]): BlockGeometry {
  const normalizedVertices = vertices.map(clampVertex)
  const minX = Math.min(...normalizedVertices.map((vertex) => vertex.x))
  const minY = Math.min(...normalizedVertices.map((vertex) => vertex.y))
  const maxX = Math.max(...normalizedVertices.map((vertex) => vertex.x))
  const maxY = Math.max(...normalizedVertices.map((vertex) => vertex.y))
  const x = clamp(minX)
  const y = clamp(minY)
  return {
    x,
    y,
    width: clamp(maxX - minX, 0, 1 - x),
    height: clamp(maxY - minY, 0, 1 - y),
  }
}

export function normalizeVertices(vertices: BlockVertex[] | null | undefined): BlockVertex[] | null {
  if (!vertices || vertices.length === 0) {
    return null
  }
  return vertices.map(clampVertex)
}

function verticesAreNear(first: BlockVertex, second: BlockVertex, epsilon: number) {
  return Math.abs(first.x - second.x) <= epsilon && Math.abs(first.y - second.y) <= epsilon
}

function dedupeSequentialVertices(vertices: BlockVertex[], epsilon: number) {
  return vertices.reduce<BlockVertex[]>((accumulator, vertex) => {
    const previous = accumulator[accumulator.length - 1]
    if (!previous || !verticesAreNear(previous, vertex, epsilon)) {
      accumulator.push(vertex)
    }
    return accumulator
  }, [])
}

function normalizePathOrientation(path: BlockVertex[]) {
  if (path.length < 2) {
    return path
  }
  const start = path[0]
  const end = path[path.length - 1]
  if (start.x < end.x - Number.EPSILON) {
    return path
  }
  if (start.x > end.x + Number.EPSILON) {
    return [...path].reverse()
  }
  return start.y <= end.y ? path : [...path].reverse()
}

function pathAverageY(path: BlockVertex[]) {
  return path.reduce((sum, vertex) => sum + vertex.y, 0) / path.length
}

function circularSlice(vertices: BlockVertex[], startIndex: number, endIndex: number) {
  if (vertices.length === 0) {
    return []
  }
  const result: BlockVertex[] = []
  let index = startIndex
  while (true) {
    result.push(vertices[index])
    if (index === endIndex) {
      return result
    }
    index = (index + 1) % vertices.length
  }
}

function deriveCutPath(vertices: BlockVertex[] | null): BlockVertex[] | null {
  if (!vertices || vertices.length < 4) {
    return null
  }

  const epsilon = 0.001
  const geometry = geometryFromVertices(vertices)
  if (geometry.x > epsilon || geometry.x + geometry.width < 1 - epsilon || geometry.width < 1 - epsilon * 2) {
    return null
  }

  const leftIndices = vertices.flatMap((vertex, index) => (vertex.x <= epsilon ? [index] : []))
  const rightIndices = vertices.flatMap((vertex, index) => (vertex.x >= 1 - epsilon ? [index] : []))
  if (leftIndices.length === 0 || rightIndices.length === 0) {
    return null
  }

  const leftCutIndex = leftIndices.reduce((selected, index) =>
    vertices[index].y > vertices[selected].y ? index : selected,
  )
  const rightCutIndex = rightIndices.reduce((selected, index) =>
    vertices[index].y > vertices[selected].y ? index : selected,
  )
  if (leftCutIndex === rightCutIndex) {
    return null
  }

  const firstChain = normalizePathOrientation(dedupeSequentialVertices(circularSlice(vertices, leftCutIndex, rightCutIndex), epsilon))
  const secondChain = normalizePathOrientation(dedupeSequentialVertices(circularSlice(vertices, rightCutIndex, leftCutIndex), epsilon))
  const lowerChain = pathAverageY(firstChain) > pathAverageY(secondChain) ? firstChain : secondChain
  const upperChain = lowerChain === firstChain ? secondChain : firstChain

  if (lowerChain.length < 2 || lowerChain[0].x > epsilon || lowerChain[lowerChain.length - 1].x < 1 - epsilon) {
    return null
  }
  return pathAverageY(lowerChain) > pathAverageY(upperChain) + epsilon ? lowerChain : null
}

export function translateVertices(vertices: BlockVertex[], deltaX: number, deltaY: number): BlockVertex[] {
  return vertices.map((vertex) =>
    clampVertex({
      x: vertex.x + deltaX,
      y: vertex.y + deltaY,
    }),
  )
}

export function isPolygonBlock(block: Pick<DraftBlock, 'shape_type'> | null | undefined) {
  return block?.shape_type === 'polygon'
}

export function pageToDraft(page: PageResponse): DraftPageLayout {
  return {
    page_id: page.id,
    review_status: page.review_status,
    layout_version: page.layout_version,
    blocks: page.blocks.map(toDraftBlock),
  }
}

export function toDraftBlock(block: BlockResponse): DraftBlock {
  const vertices = normalizeVertices(block.vertices)
  return {
    id: block.id,
    client_id: block.id,
    order_index: block.order_index,
    block_type: block.block_type,
    approval: block.approval,
    source: block.source,
    shape_type: block.shape_type,
    vertices,
    cut_path: block.shape_type === 'polygon' ? deriveCutPath(vertices) : null,
    parent_block_id: block.parent_block_id,
    geometry: block.geometry,
    confidence: block.confidence,
    is_user_corrected: block.is_user_corrected,
    crop_url: block.crop_url,
    generated_output: block.generated_output,
    manual_output: block.manual_output,
    user_instruction: block.user_instruction,
    warnings: block.warnings,
  }
}

function normalizeOrder(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block, index) => ({ ...block, order_index: index }))
}

export function createManualBlock(
  geometry: BlockGeometry,
  options: { shape_type?: BlockShapeType; vertices?: BlockVertex[] | null; cut_path?: BlockVertex[] | null } = {},
): DraftBlock {
  const shapeType = options.shape_type ?? 'rect'
  const vertices = shapeType === 'polygon' ? normalizeVertices(options.vertices) : null
  const cutPath = normalizeVertices(options.cut_path)
  const nextGeometry = shapeType === 'polygon' && vertices ? geometryFromVertices(vertices) : clampGeometry(geometry)
  return {
    client_id: makeClientId(),
    order_index: 0,
    block_type: 'text',
    approval: 'pending',
    source: 'manual',
    shape_type: shapeType,
    vertices,
    cut_path: cutPath,
    parent_block_id: null,
    geometry: nextGeometry,
    confidence: 1,
    is_user_corrected: true,
    crop_url: null,
    generated_output: null,
    manual_output: null,
    user_instruction: null,
    warnings: [],
  }
}

export function toPageLayoutPayload(draft: DraftPageLayout): PageLayoutBlockPayload[] {
  return normalizeOrder(draft.blocks).map((block, index) => ({
    id: block.id,
    order_index: index,
    block_type: block.block_type,
    approval: block.approval,
    source: block.source,
    shape_type: block.shape_type,
    vertices: normalizeVertices(block.vertices),
    parent_block_id: block.parent_block_id ?? null,
    geometry: isPolygonBlock(block) && block.vertices ? geometryFromVertices(block.vertices) : clampGeometry(block.geometry),
  }))
}

export function updateDraftBlock(
  draft: DraftPageLayout,
  blockKey: string,
  updater: (block: DraftBlock) => DraftBlock,
): DraftPageLayout {
  return {
    ...draft,
    review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
    blocks: normalizeOrder(
      draft.blocks.map((block) =>
        draftBlockKey(block) === blockKey
          ? updater({ ...block, source: 'manual', is_user_corrected: true })
          : block,
      ),
    ),
  }
}

export function deleteDraftBlock(draft: DraftPageLayout, blockKey: string): DraftPageLayout {
  return {
    ...draft,
    review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
    blocks: normalizeOrder(draft.blocks.filter((block) => draftBlockKey(block) !== blockKey)),
  }
}

export function deleteDraftBlocks(draft: DraftPageLayout, blockKeys: Iterable<string>): DraftPageLayout {
  const keysToDelete = new Set(blockKeys)
  if (keysToDelete.size === 0) {
    return draft
  }
  return {
    ...draft,
    review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
    blocks: normalizeOrder(draft.blocks.filter((block) => !keysToDelete.has(draftBlockKey(block)))),
  }
}

export function getLatestDraftCutPath(draft: DraftPageLayout): BlockVertex[] | null {
  for (let index = draft.blocks.length - 1; index >= 0; index -= 1) {
    const cutPath = draft.blocks[index]?.cut_path
    if (cutPath && cutPath.length > 1) {
      return cutPath
    }
  }
  return null
}

export function duplicateDraftBlock(draft: DraftPageLayout, blockKey: string): { draft: DraftPageLayout; selectedBlockKey: string } {
  const blocks = [...draft.blocks]
  const index = blocks.findIndex((block) => draftBlockKey(block) === blockKey)
  if (index < 0) {
    return { draft, selectedBlockKey: blockKey }
  }
  const original = blocks[index]
  const duplicate = createManualBlock({
    x: clamp(original.geometry.x + 0.02),
    y: clamp(original.geometry.y + 0.02),
    width: original.geometry.width,
    height: original.geometry.height,
  }, {
    shape_type: original.shape_type,
    vertices: original.vertices ? translateVertices(original.vertices, 0.02, 0.02) : null,
  })
  duplicate.block_type = original.block_type
  duplicate.approval = original.approval
  blocks.splice(index + 1, 0, duplicate)
  return {
    draft: {
      ...draft,
      review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
      blocks: normalizeOrder(blocks),
    },
    selectedBlockKey: draftBlockKey(duplicate),
  }
}

export function reorderDraftBlock(
  draft: DraftPageLayout,
  blockKey: string,
  direction: 'up' | 'down',
): { draft: DraftPageLayout; selectedBlockKey: string } {
  const blocks = [...draft.blocks]
  const index = blocks.findIndex((block) => draftBlockKey(block) === blockKey)
  if (index < 0) {
    return { draft, selectedBlockKey: blockKey }
  }
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= blocks.length) {
    return { draft, selectedBlockKey: blockKey }
  }
  ;[blocks[index], blocks[targetIndex]] = [blocks[targetIndex], blocks[index]]
  return {
    draft: {
      ...draft,
      review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
      blocks: normalizeOrder(blocks),
    },
    selectedBlockKey: blockKey,
  }
}

export function nudgeGeometry(geometry: BlockGeometry, deltaX: number, deltaY: number): BlockGeometry {
  return clampGeometry({
    ...geometry,
    x: geometry.x + deltaX,
    y: geometry.y + deltaY,
  })
}
