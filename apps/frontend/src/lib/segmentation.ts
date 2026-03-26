import type {
  BlockApproval,
  BlockGeometry,
  BlockResponse,
  BlockSource,
  BlockType,
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
  parent_block_id?: string | null
  geometry: BlockGeometry
  confidence: number
  is_user_corrected: boolean
  crop_url: string | null
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

export function clampGeometry(geometry: BlockGeometry): BlockGeometry {
  const x = clamp(geometry.x)
  const y = clamp(geometry.y)
  const width = clamp(geometry.width, 0.01, 1 - x)
  const height = clamp(geometry.height, 0.01, 1 - y)
  return { x, y, width, height }
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
  return {
    id: block.id,
    client_id: block.id,
    order_index: block.order_index,
    block_type: block.block_type,
    approval: block.approval,
    source: block.source,
    parent_block_id: block.parent_block_id,
    geometry: block.geometry,
    confidence: block.confidence,
    is_user_corrected: block.is_user_corrected,
    crop_url: block.crop_url,
    warnings: block.warnings,
  }
}

function normalizeOrder(blocks: DraftBlock[]): DraftBlock[] {
  return blocks.map((block, index) => ({ ...block, order_index: index }))
}

export function createManualBlock(geometry: BlockGeometry): DraftBlock {
  return {
    client_id: makeClientId(),
    order_index: 0,
    block_type: 'unknown',
    approval: 'pending',
    source: 'manual',
    parent_block_id: null,
    geometry: clampGeometry(geometry),
    confidence: 1,
    is_user_corrected: true,
    crop_url: null,
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
    parent_block_id: block.parent_block_id ?? null,
    geometry: clampGeometry(block.geometry),
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

export function mergeDraftBlock(
  draft: DraftPageLayout,
  blockKey: string,
  direction: 'previous' | 'next',
): { draft: DraftPageLayout; selectedBlockKey: string | null } {
  const blocks = [...draft.blocks]
  const index = blocks.findIndex((block) => draftBlockKey(block) === blockKey)
  const neighborIndex = direction === 'previous' ? index - 1 : index + 1
  if (index < 0 || neighborIndex < 0 || neighborIndex >= blocks.length) {
    return { draft, selectedBlockKey: blockKey }
  }

  const primaryIndex = direction === 'previous' ? neighborIndex : index
  const secondaryIndex = direction === 'previous' ? index : neighborIndex
  const primary = blocks[primaryIndex]
  const secondary = blocks[secondaryIndex]
  const left = Math.min(primary.geometry.x, secondary.geometry.x)
  const top = Math.min(primary.geometry.y, secondary.geometry.y)
  const right = Math.max(primary.geometry.x + primary.geometry.width, secondary.geometry.x + secondary.geometry.width)
  const bottom = Math.max(primary.geometry.y + primary.geometry.height, secondary.geometry.y + secondary.geometry.height)

  const merged: DraftBlock = {
    ...primary,
    source: 'manual',
    is_user_corrected: true,
    crop_url: null,
    warnings: [],
    geometry: clampGeometry({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }),
  }

  const nextBlocks = blocks.filter((_, idx) => idx !== secondaryIndex)
  nextBlocks[primaryIndex] = merged
  return {
    draft: {
      ...draft,
      review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
      blocks: normalizeOrder(nextBlocks),
    },
    selectedBlockKey: draftBlockKey(merged),
  }
}

export function splitDraftBlock(
  draft: DraftPageLayout,
  blockKey: string,
  orientation: 'horizontal' | 'vertical',
): { draft: DraftPageLayout; selectedBlockKey: string | null } {
  const blocks = [...draft.blocks]
  const index = blocks.findIndex((block) => draftBlockKey(block) === blockKey)
  if (index < 0) {
    return { draft, selectedBlockKey: blockKey }
  }

  const block = blocks[index]
  const first = createManualBlock(block.geometry)
  const second = createManualBlock(block.geometry)
  first.block_type = block.block_type
  second.block_type = block.block_type
  first.approval = block.approval
  second.approval = block.approval
  first.parent_block_id = block.id ?? null
  second.parent_block_id = block.id ?? null

  if (orientation === 'horizontal') {
    first.geometry = clampGeometry({
      x: block.geometry.x,
      y: block.geometry.y,
      width: block.geometry.width,
      height: block.geometry.height / 2,
    })
    second.geometry = clampGeometry({
      x: block.geometry.x,
      y: block.geometry.y + block.geometry.height / 2,
      width: block.geometry.width,
      height: block.geometry.height / 2,
    })
  } else {
    first.geometry = clampGeometry({
      x: block.geometry.x,
      y: block.geometry.y,
      width: block.geometry.width / 2,
      height: block.geometry.height,
    })
    second.geometry = clampGeometry({
      x: block.geometry.x + block.geometry.width / 2,
      y: block.geometry.y,
      width: block.geometry.width / 2,
      height: block.geometry.height,
    })
  }

  blocks.splice(index, 1, first, second)
  return {
    draft: {
      ...draft,
      review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
      blocks: normalizeOrder(blocks),
    },
    selectedBlockKey: draftBlockKey(first),
  }
}

export function nudgeGeometry(geometry: BlockGeometry, deltaX: number, deltaY: number): BlockGeometry {
  return clampGeometry({
    ...geometry,
    x: geometry.x + deltaX,
    y: geometry.y + deltaY,
  })
}
