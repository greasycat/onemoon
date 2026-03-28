import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { EditorToolbar, type EditorToolbarProps } from './EditorToolbar'
import { withApiRoot } from '../lib/api'
import {
  clamp,
  clampGeometry,
  clampVertex,
  draftBlockKey,
  geometryFromVertices,
  isPolygonBlock,
  translateVertices,
  type DraftBlock,
} from '../lib/segmentation'
import type { BlockGeometry, BlockSelectionMode, BlockShapeType, BlockVertex, PageResponse } from '../lib/types'
import type { WorkspaceDebugSettings } from '../lib/workspaceDebug'

type ActiveTool = 'select' | 'rect' | 'freeform' | 'cut'
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type CanvasPoint = { x: number; y: number }

export type CanvasViewMode = 'fit-page' | 'fit-width' | 'manual'

export interface CanvasViewportState {
  zoom: number
  mode: CanvasViewMode
  panX: number
  panY: number
}

export interface DocumentCanvasHandle {
  fitPage: () => void
  fitWidth: () => void
  resetZoom: () => void
  zoomIn: () => void
  zoomOut: () => void
}

type InteractionState =
  | {
      kind: 'rect-create'
      pointerId: number
      start: CanvasPoint
      current: CanvasPoint
      settings: WorkspaceDebugSettings
    }
  | {
      kind: 'freeform-create'
      pointerId: number
      points: CanvasPoint[]
      current: CanvasPoint
      settings: WorkspaceDebugSettings
    }
  | {
      kind: 'cut-create'
      pointerId: number
      points: CanvasPoint[]
      current: CanvasPoint
      settings: WorkspaceDebugSettings
    }
  | {
      kind: 'move'
      pointerId: number
      blockId: string
      start: CanvasPoint
      initialGeometry: BlockGeometry
      initialVertices: BlockVertex[] | null
    }
  | {
      kind: 'resize'
      pointerId: number
      blockId: string
      start: CanvasPoint
      handle: ResizeHandle
      initial: BlockGeometry
      settings: WorkspaceDebugSettings
    }
  | {
      kind: 'vertex'
      pointerId: number
      blockId: string
      vertexIndex: number
      initialVertices: BlockVertex[]
      settings: WorkspaceDebugSettings
    }

interface DocumentCanvasProps {
  page: PageResponse
  blocks: DraftBlock[]
  cutCeilingPath: BlockVertex[] | null
  toolbar?: EditorToolbarProps | null
  blockListPanel?: ReactNode
  blockInfoPanel?: ReactNode
  toast?: {
    tone: 'saving' | 'success' | 'error'
    message: string
  } | null
  selectedBlockIds: string[]
  activeBlockId: string | null
  activeTool: ActiveTool
  isLocked: boolean
  debugSettings: WorkspaceDebugSettings
  onViewportChange: (viewport: CanvasViewportState) => void
  onSelectBlock: (blockId: string | null, mode?: BlockSelectionMode) => void
  onCycleBlockType: (blockId: string) => void
  onHoveredBlockChange: (blockId: string | null) => void
  onCreateBlock: (payload: {
    shape_type: BlockShapeType
    geometry: BlockGeometry
    vertices: BlockVertex[] | null
    cut_path?: BlockVertex[] | null
  }) => void
  onUpdateBlock: (blockId: string, payload: { geometry: BlockGeometry; vertices: BlockVertex[] | null }) => void
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 4
const ZOOM_STEP = 0.2
const WHEEL_SCROLL_EPSILON = 1
const resizeHandles: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function normalizeGeometry(start: CanvasPoint, end: CanvasPoint, minBlockSize: number): BlockGeometry {
  const x = clamp(Math.min(start.x, end.x))
  const y = clamp(Math.min(start.y, end.y))
  const width = clamp(Math.abs(end.x - start.x), minBlockSize, 1 - x)
  const height = clamp(Math.abs(end.y - start.y), minBlockSize, 1 - y)
  return { x, y, width, height }
}

function pointerToRelative(
  event: PointerEvent | ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>,
  target: HTMLElement,
): CanvasPoint {
  const rect = target.getBoundingClientRect()
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  }
}

function resizeGeometry(
  geometry: BlockGeometry,
  handle: ResizeHandle,
  point: CanvasPoint,
  minBlockSize: number,
): BlockGeometry {
  const left = geometry.x
  const top = geometry.y
  const right = geometry.x + geometry.width
  const bottom = geometry.y + geometry.height

  let nextLeft = left
  let nextTop = top
  let nextRight = right
  let nextBottom = bottom

  if (handle.includes('w')) {
    nextLeft = clamp(point.x, 0, right - minBlockSize)
  }
  if (handle.includes('e')) {
    nextRight = clamp(point.x, left + minBlockSize, 1)
  }
  if (handle.includes('n')) {
    nextTop = clamp(point.y, 0, bottom - minBlockSize)
  }
  if (handle.includes('s')) {
    nextBottom = clamp(point.y, top + minBlockSize, 1)
  }

  return clampGeometry({
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  })
}

function distanceBetween(a: CanvasPoint, b: CanvasPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pointsAreNear(a: CanvasPoint, b: CanvasPoint, pointEpsilon: number) {
  return distanceBetween(a, b) <= pointEpsilon
}

function distanceToSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  if (Math.abs(deltaX) <= Number.EPSILON && Math.abs(deltaY) <= Number.EPSILON) {
    return distanceBetween(point, start)
  }

  const projection = ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / (deltaX * deltaX + deltaY * deltaY)
  const clampedProjection = clamp(projection)
  const projectedPoint = {
    x: start.x + clampedProjection * deltaX,
    y: start.y + clampedProjection * deltaY,
  }
  return distanceBetween(point, projectedPoint)
}

function simplifyFreeformVertices(
  vertices: BlockVertex[],
  pointEpsilon: number,
  freeformSimplifyEpsilon: number,
): BlockVertex[] {
  if (vertices.length <= 3) {
    return vertices
  }

  const simplified = [...vertices]
  let changed = true
  while (changed && simplified.length > 3) {
    changed = false
    for (let index = 0; index < simplified.length; index += 1) {
      const previous = simplified[(index - 1 + simplified.length) % simplified.length]
      const current = simplified[index]
      const next = simplified[(index + 1) % simplified.length]
      if (
        pointsAreNear(previous, current, pointEpsilon) ||
        pointsAreNear(current, next, pointEpsilon) ||
        distanceToSegment(current, previous, next) > freeformSimplifyEpsilon
      ) {
        continue
      }
      simplified.splice(index, 1)
      changed = true
      break
    }
  }
  return simplified
}

function simplifyOpenPathVertices(
  vertices: BlockVertex[],
  pointEpsilon: number,
  freeformSimplifyEpsilon: number,
): BlockVertex[] {
  if (vertices.length <= 2) {
    return vertices
  }

  const simplified = [...vertices]
  let changed = true
  while (changed && simplified.length > 2) {
    changed = false
    for (let index = 1; index < simplified.length - 1; index += 1) {
      const previous = simplified[index - 1]
      const current = simplified[index]
      const next = simplified[index + 1]
      if (
        pointsAreNear(previous, current, pointEpsilon) ||
        pointsAreNear(current, next, pointEpsilon) ||
        distanceToSegment(current, previous, next) > freeformSimplifyEpsilon
      ) {
        continue
      }
      simplified.splice(index, 1)
      changed = true
      break
    }
  }
  return simplified
}

function buildDraftPathVertices(
  points: CanvasPoint[],
  current: CanvasPoint,
  pointEpsilon: number,
  shouldCloseLoop: boolean,
): BlockVertex[] {
  const deduped = points.reduce<CanvasPoint[]>((accumulator, point) => {
    if (accumulator.length === 0 || !pointsAreNear(accumulator[accumulator.length - 1], point, pointEpsilon)) {
      accumulator.push(clampVertex(point))
    }
    return accumulator
  }, [])

  if (deduped.length === 0 || !pointsAreNear(deduped[deduped.length - 1], current, pointEpsilon)) {
    deduped.push(clampVertex(current))
  }

  if (shouldCloseLoop && deduped.length > 1 && pointsAreNear(deduped[0], deduped[deduped.length - 1], pointEpsilon)) {
    deduped.pop()
  }

  return deduped
}

function buildDraftFreeformVertices(points: CanvasPoint[], current: CanvasPoint, pointEpsilon: number): BlockVertex[] {
  return buildDraftPathVertices(points, current, pointEpsilon, true)
}

function buildDraftCutVertices(points: CanvasPoint[], current: CanvasPoint, pointEpsilon: number): BlockVertex[] {
  return buildDraftPathVertices(points, current, pointEpsilon, false)
}

function finalizeFreeformVertices(points: CanvasPoint[], current: CanvasPoint, settings: WorkspaceDebugSettings): BlockVertex[] {
  const draftVertices = buildDraftFreeformVertices(points, current, settings.pointEpsilon)
  const simplifiedVertices = simplifyFreeformVertices(
    draftVertices,
    settings.pointEpsilon,
    settings.freeformSimplifyEpsilon,
  )
  return isValidPolygon(simplifiedVertices, settings.minBlockSize) ? simplifiedVertices : draftVertices
}

function finalizeCutPathVertices(points: CanvasPoint[], current: CanvasPoint, settings: WorkspaceDebugSettings): BlockVertex[] {
  const draftVertices = buildDraftCutVertices(points, current, settings.pointEpsilon)
  return simplifyOpenPathVertices(draftVertices, settings.pointEpsilon, settings.freeformSimplifyEpsilon)
}

function maybeAppendPoint(points: CanvasPoint[], current: CanvasPoint, freeformDrawStep: number): CanvasPoint[] {
  if (points.length === 0 || distanceBetween(points[points.length - 1], current) >= freeformDrawStep) {
    return [...points, current]
  }
  return points
}

function orientation(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(value) <= Number.EPSILON) {
    return 0
  }
  return value > 0 ? 1 : 2
}

function onSegment(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) {
  return (
    Math.min(a.x, c.x) - Number.EPSILON <= b.x &&
    b.x <= Math.max(a.x, c.x) + Number.EPSILON &&
    Math.min(a.y, c.y) - Number.EPSILON <= b.y &&
    b.y <= Math.max(a.y, c.y) + Number.EPSILON
  )
}

function segmentsIntersect(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint) {
  const first = orientation(a, b, c)
  const second = orientation(a, b, d)
  const third = orientation(c, d, a)
  const fourth = orientation(c, d, b)

  if (first !== second && third !== fourth) {
    return true
  }
  if (first === 0 && onSegment(a, c, b)) {
    return true
  }
  if (second === 0 && onSegment(a, d, b)) {
    return true
  }
  if (third === 0 && onSegment(c, a, d)) {
    return true
  }
  if (fourth === 0 && onSegment(c, b, d)) {
    return true
  }
  return false
}

function isSelfIntersectingPolygon(vertices: BlockVertex[]) {
  const totalSegments = vertices.length
  for (let index = 0; index < totalSegments; index += 1) {
    const firstStart = vertices[index]
    const firstEnd = vertices[(index + 1) % totalSegments]
    for (let compareIndex = index + 1; compareIndex < totalSegments; compareIndex += 1) {
      const areAdjacent =
        compareIndex === index ||
        compareIndex === index + 1 ||
        (index === 0 && compareIndex === totalSegments - 1)
      if (areAdjacent) {
        continue
      }
      const secondStart = vertices[compareIndex]
      const secondEnd = vertices[(compareIndex + 1) % totalSegments]
      if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
        return true
      }
    }
  }
  return false
}

function isValidPolygon(vertices: BlockVertex[], minBlockSize = 0.02) {
  if (vertices.length < 3) {
    return false
  }
  const geometry = geometryFromVertices(vertices)
  return geometry.width >= minBlockSize && geometry.height >= minBlockSize && !isSelfIntersectingPolygon(vertices)
}

function pointInPolygon(point: CanvasPoint, vertices: BlockVertex[]) {
  let inside = false
  for (let index = 0, previousIndex = vertices.length - 1; index < vertices.length; previousIndex = index, index += 1) {
    const current = vertices[index]
    const previous = vertices[previousIndex]
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function pointInGeometry(point: CanvasPoint, geometry: BlockGeometry) {
  return (
    point.x >= geometry.x &&
    point.x <= geometry.x + geometry.width &&
    point.y >= geometry.y &&
    point.y <= geometry.y + geometry.height
  )
}

function findTopmostBlockAtPoint(blocks: DraftBlock[], point: CanvasPoint) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (isPolygonBlock(block) && block.vertices) {
      if (pointInPolygon(point, block.vertices)) {
        return block
      }
      continue
    }
    if (pointInGeometry(point, block.geometry)) {
      return block
    }
  }
  return null
}

function clampMoveDelta(geometry: BlockGeometry, deltaX: number, deltaY: number) {
  return {
    x: clamp(deltaX, -geometry.x, 1 - (geometry.x + geometry.width)),
    y: clamp(deltaY, -geometry.y, 1 - (geometry.y + geometry.height)),
  }
}

function polygonPointsToLocalString(block: DraftBlock) {
  if (!block.vertices || block.geometry.width <= 0 || block.geometry.height <= 0) {
    return ''
  }
  return block.vertices
    .map((vertex) => {
      const x = ((vertex.x - block.geometry.x) / block.geometry.width) * 100
      const y = ((vertex.y - block.geometry.y) / block.geometry.height) * 100
      return `${x},${y}`
    })
    .join(' ')
}

function polygonPointsToCanvasString(points: CanvasPoint[]) {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')
}

function lineMagnitude(vector: CanvasPoint) {
  return Math.hypot(vector.x, vector.y)
}

function sampleCountForPath(points: CanvasPoint[]) {
  return Math.min(points.length, Math.max(2, Math.min(8, Math.round(points.length * 0.2))))
}

function boundaryProgress(point: CanvasPoint) {
  const epsilon = 1e-6
  if (Math.abs(point.y) <= epsilon) {
    return clamp(point.x)
  }
  if (Math.abs(point.x - 1) <= epsilon) {
    return 1 + clamp(point.y)
  }
  if (Math.abs(point.y - 1) <= epsilon) {
    return 3 - clamp(point.x)
  }
  return 4 - clamp(point.y)
}

function rayToBoundary(origin: CanvasPoint, direction: CanvasPoint): CanvasPoint | null {
  const candidates: CanvasPoint[] = []
  const epsilon = 1e-6

  if (Math.abs(direction.x) > epsilon) {
    for (const boundaryX of [0, 1]) {
      const t = (boundaryX - origin.x) / direction.x
      if (t <= epsilon) {
        continue
      }
      const y = origin.y + t * direction.y
      if (y >= -epsilon && y <= 1 + epsilon) {
        candidates.push(clampVertex({ x: boundaryX, y }))
      }
    }
  }

  if (Math.abs(direction.y) > epsilon) {
    for (const boundaryY of [0, 1]) {
      const t = (boundaryY - origin.y) / direction.y
      if (t <= epsilon) {
        continue
      }
      const x = origin.x + t * direction.x
      if (x >= -epsilon && x <= 1 + epsilon) {
        candidates.push(clampVertex({ x, y: boundaryY }))
      }
    }
  }

  if (candidates.length === 0) {
    return null
  }

  return candidates.reduce((nearest, candidate) =>
    distanceBetween(origin, candidate) < distanceBetween(origin, nearest) ? candidate : nearest,
  )
}

const perimeterCorners: CanvasPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

function clockwiseBoundaryCorners(from: CanvasPoint, to: CanvasPoint) {
  const fromProgress = boundaryProgress(from)
  let toProgress = boundaryProgress(to)
  if (toProgress < fromProgress) {
    toProgress += 4
  }

  return perimeterCorners.filter((_, index) => {
    let progress = index
    if (progress < fromProgress) {
      progress += 4
    }
    return progress > fromProgress && progress < toProgress
  })
}

function dedupeSequentialVertices(vertices: BlockVertex[], pointEpsilon: number) {
  return vertices.reduce<BlockVertex[]>((accumulator, vertex) => {
    if (accumulator.length === 0 || !pointsAreNear(accumulator[accumulator.length - 1], vertex, pointEpsilon)) {
      accumulator.push(vertex)
    }
    return accumulator
  }, [])
}

function polygonSignedArea(vertices: BlockVertex[]) {
  let area = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]
    const next = vertices[(index + 1) % vertices.length]
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

function polygonCentroid(vertices: BlockVertex[]) {
  const area = polygonSignedArea(vertices)
  if (Math.abs(area) <= Number.EPSILON) {
    const fallback = vertices.reduce(
      (sum, vertex) => ({ x: sum.x + vertex.x, y: sum.y + vertex.y }),
      { x: 0, y: 0 },
    )
    return { x: fallback.x / vertices.length, y: fallback.y / vertices.length }
  }

  let centroidX = 0
  let centroidY = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]
    const next = vertices[(index + 1) % vertices.length]
    const cross = current.x * next.y - next.x * current.y
    centroidX += (current.x + next.x) * cross
    centroidY += (current.y + next.y) * cross
  }

  return {
    x: centroidX / (6 * area),
    y: centroidY / (6 * area),
  }
}

function normalizeCutPathOrientation(path: BlockVertex[]) {
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

function buildExtendedCutPath(
  path: BlockVertex[],
  settings: WorkspaceDebugSettings,
  interpolationPath: BlockVertex[] = path,
): BlockVertex[] | null {
  if (path.length < 2 || interpolationPath.length < 2) {
    return null
  }

  const start = interpolationPath[0]
  const end = interpolationPath[interpolationPath.length - 1]
  if (pointsAreNear(start, end, settings.pointEpsilon * 2)) {
    return null
  }

  const sampleCount = sampleCountForPath(interpolationPath)
  const startSample = interpolationPath.slice(0, sampleCount)
  const endSample = interpolationPath.slice(-sampleCount)
  const fallbackDirection = {
    x: end.x - start.x,
    y: end.y - start.y,
  }

  const startDirection = {
    x: startSample[0].x - startSample[startSample.length - 1].x,
    y: startSample[0].y - startSample[startSample.length - 1].y,
  }
  const endDirection = {
    x: endSample[endSample.length - 1].x - endSample[0].x,
    y: endSample[endSample.length - 1].y - endSample[0].y,
  }

  const safeStartDirection = lineMagnitude(startDirection) > Number.EPSILON ? startDirection : { ...fallbackDirection, x: -fallbackDirection.x, y: -fallbackDirection.y }
  const safeEndDirection = lineMagnitude(endDirection) > Number.EPSILON ? endDirection : fallbackDirection
  const startBoundary = rayToBoundary(start, safeStartDirection)
  const endBoundary = rayToBoundary(end, safeEndDirection)
  if (!startBoundary || !endBoundary || pointsAreNear(startBoundary, endBoundary, settings.pointEpsilon)) {
    return null
  }

  if (Math.abs(endBoundary.x - startBoundary.x) < Math.abs(endBoundary.y - startBoundary.y)) {
    return null
  }

  const cutPath = dedupeSequentialVertices(
    [
      ...(pointsAreNear(startBoundary, start, settings.pointEpsilon) ? [] : [startBoundary]),
      ...path,
      ...(pointsAreNear(endBoundary, end, settings.pointEpsilon) ? [] : [endBoundary]),
    ],
    settings.pointEpsilon,
  )
  return normalizeCutPathOrientation(cutPath)
}

function buildRegionBetweenPaths(ceilingPath: BlockVertex[], floorPath: BlockVertex[], settings: WorkspaceDebugSettings) {
  if (ceilingPath.length < 2 || floorPath.length < 2) {
    return null
  }

  if (pathAverageY(floorPath) <= pathAverageY(ceilingPath) + settings.pointEpsilon) {
    return null
  }

  const polygon = dedupeSequentialVertices([...ceilingPath, ...[...floorPath].reverse()], settings.pointEpsilon)
  if (polygon.length > 1 && pointsAreNear(polygon[0], polygon[polygon.length - 1], settings.pointEpsilon)) {
    polygon.pop()
  }
  return isValidPolygon(polygon, settings.minBlockSize) ? polygon : null
}

function buildBoundaryCeilingCandidates(path: BlockVertex[], settings: WorkspaceDebugSettings) {
  const start = path[0]
  const end = path[path.length - 1]
  return [
    dedupeSequentialVertices([start, ...clockwiseBoundaryCorners(start, end), end], settings.pointEpsilon),
    dedupeSequentialVertices([start, ...clockwiseBoundaryCorners(end, start).reverse(), end], settings.pointEpsilon),
  ]
}

function buildCutRegion(
  path: BlockVertex[],
  settings: WorkspaceDebugSettings,
  interpolationPath: BlockVertex[] = path,
  ceilingPath: BlockVertex[] | null = null,
): { polygon: BlockVertex[]; cutPath: BlockVertex[] } | null {
  const cutPath = buildExtendedCutPath(path, settings, interpolationPath)
  if (!cutPath) {
    return null
  }

  const normalizedCeilingPath = ceilingPath ? normalizeCutPathOrientation(dedupeSequentialVertices(ceilingPath, settings.pointEpsilon)) : null
  if (normalizedCeilingPath) {
    const polygon = buildRegionBetweenPaths(normalizedCeilingPath, cutPath, settings)
    return polygon ? { polygon, cutPath } : null
  }

  const candidates = buildBoundaryCeilingCandidates(cutPath, settings)
    .map((candidate) => {
      const polygon = buildRegionBetweenPaths(candidate, cutPath, settings)
      return polygon ? { polygon, cutPath } : null
    })
    .filter((candidate): candidate is { polygon: BlockVertex[]; cutPath: BlockVertex[] } => candidate !== null)

  if (candidates.length === 0) {
    return null
  }

  return candidates.reduce((selected, candidate) =>
    polygonCentroid(candidate.polygon).y < polygonCentroid(selected.polygon).y ? candidate : selected,
  )
}

export const DocumentCanvas = forwardRef<DocumentCanvasHandle, DocumentCanvasProps>(function DocumentCanvas(
  {
    page,
    blocks,
    cutCeilingPath,
    toolbar,
    blockListPanel,
    blockInfoPanel,
    toast,
    selectedBlockIds,
    activeBlockId,
    activeTool,
    isLocked,
    debugSettings,
    onViewportChange,
    onSelectBlock,
    onCycleBlockType,
    onHoveredBlockChange,
    onCreateBlock,
    onUpdateBlock,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const [interaction, setInteraction] = useState<InteractionState | null>(null)
  const [localToast, setLocalToast] = useState<DocumentCanvasProps['toast']>(null)
  const [viewport, setViewport] = useState<CanvasViewportState>({
    zoom: 1,
    mode: 'fit-page',
    panX: 0,
    panY: 0,
  })
  const [spacePressed, setSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const panStateRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(
    null,
  )

  function showCanvasToast(nextToast: NonNullable<DocumentCanvasProps['toast']>) {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current)
    }
    setLocalToast(nextToast)
    toastTimeoutRef.current = window.setTimeout(() => {
      setLocalToast(null)
      toastTimeoutRef.current = null
    }, 2200)
  }

  function startPanning(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewportRef.current?.scrollLeft ?? 0,
      scrollTop: viewportRef.current?.scrollTop ?? 0,
    }
    setIsPanning(true)
  }

  function scrollPageBy(deltaY: number) {
    const scrollingElement = document.scrollingElement
    if (!(scrollingElement instanceof HTMLElement)) {
      return
    }

    const maxScrollTop = scrollingElement.scrollHeight - window.innerHeight
    if (maxScrollTop <= WHEEL_SCROLL_EPSILON) {
      return
    }

    const nextScrollTop = clamp(scrollingElement.scrollTop + deltaY, 0, maxScrollTop)
    if (Math.abs(nextScrollTop - scrollingElement.scrollTop) <= WHEEL_SCROLL_EPSILON) {
      return
    }

    scrollingElement.scrollTop = nextScrollTop
  }

  function syncViewport(nextViewport: CanvasViewportState, resetPan = false) {
    const viewportElement = viewportRef.current
    if (!viewportElement) {
      setViewport(nextViewport)
      return
    }

    const panX = resetPan ? 0 : Math.max(0, Math.min(nextViewport.panX, viewportElement.scrollWidth))
    const panY = resetPan ? 0 : Math.max(0, Math.min(nextViewport.panY, viewportElement.scrollHeight))
    viewportElement.scrollLeft = panX
    viewportElement.scrollTop = panY
    setViewport({ ...nextViewport, panX, panY })
  }

  function computeFitZoom(mode: Exclude<CanvasViewMode, 'manual'>) {
    const viewportElement = viewportRef.current
    if (!viewportElement) {
      return 1
    }
    const widthZoom = viewportElement.clientWidth / page.width
    const heightZoom = viewportElement.clientHeight / page.height
    const nextZoom = mode === 'fit-width' ? widthZoom : Math.min(widthZoom, heightZoom)
    return clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  }

  function applyViewMode(mode: Exclude<CanvasViewMode, 'manual'>) {
    const nextZoom = computeFitZoom(mode)
    syncViewport({ zoom: nextZoom, mode, panX: 0, panY: 0 }, true)
  }

  function applyManualZoom(zoom: number) {
    syncViewport({ zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM), mode: 'manual', panX: viewport.panX, panY: viewport.panY })
  }

  useImperativeHandle(ref, () => ({
    fitPage: () => applyViewMode('fit-page'),
    fitWidth: () => applyViewMode('fit-width'),
    resetZoom: () => syncViewport({ zoom: 1, mode: 'manual', panX: 0, panY: 0 }, true),
    zoomIn: () => applyManualZoom(viewport.zoom + ZOOM_STEP),
    zoomOut: () => applyManualZoom(viewport.zoom - ZOOM_STEP),
  }))

  useEffect(() => {
    applyViewMode('fit-page')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])

  useEffect(() => {
    onViewportChange(viewport)
  }, [onViewportChange, viewport])

  useEffect(() => {
    const viewportElement = viewportRef.current
    if (!viewportElement || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(() => {
      setViewport((current) => {
        if (current.mode === 'manual') {
          return current
        }
        const nextZoom = computeFitZoom(current.mode)
        const nextViewport: CanvasViewportState = { zoom: nextZoom, mode: current.mode, panX: 0, panY: 0 }
        viewportElement.scrollLeft = 0
        viewportElement.scrollTop = 0
        return nextViewport
      })
    })

    observer.observe(viewportElement)
    return () => {
      observer.disconnect()
    }
  }, [onViewportChange, page.height, page.width])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === 'Space') {
        setSpacePressed(true)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') {
        setSpacePressed(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!interaction || isLocked) {
      return undefined
    }
    const currentInteraction = interaction

    function handlePointerMove(event: PointerEvent) {
      if (!surfaceRef.current || currentInteraction.pointerId !== event.pointerId) {
        return
      }
      const point = pointerToRelative(event, surfaceRef.current)

      if (currentInteraction.kind === 'rect-create') {
        setInteraction({
          kind: 'rect-create',
          pointerId: currentInteraction.pointerId,
          start: currentInteraction.start,
          current: point,
          settings: currentInteraction.settings,
        })
        return
      }

      if (currentInteraction.kind === 'freeform-create' || currentInteraction.kind === 'cut-create') {
        setInteraction({
          kind: currentInteraction.kind,
          pointerId: currentInteraction.pointerId,
          points: maybeAppendPoint(currentInteraction.points, point, currentInteraction.settings.freeformDrawStep),
          current: point,
          settings: currentInteraction.settings,
        })
        return
      }

      if (currentInteraction.kind === 'move') {
        const delta = clampMoveDelta(
          currentInteraction.initialGeometry,
          point.x - currentInteraction.start.x,
          point.y - currentInteraction.start.y,
        )
        if (currentInteraction.initialVertices) {
          const vertices = translateVertices(currentInteraction.initialVertices, delta.x, delta.y)
          onUpdateBlock(currentInteraction.blockId, {
            vertices,
            geometry: geometryFromVertices(vertices),
          })
          return
        }
        onUpdateBlock(currentInteraction.blockId, {
          vertices: null,
          geometry: clampGeometry({
            ...currentInteraction.initialGeometry,
            x: currentInteraction.initialGeometry.x + delta.x,
            y: currentInteraction.initialGeometry.y + delta.y,
          }),
        })
        return
      }

      if (currentInteraction.kind === 'resize') {
        onUpdateBlock(currentInteraction.blockId, {
          vertices: null,
          geometry: resizeGeometry(
            currentInteraction.initial,
            currentInteraction.handle,
            point,
            currentInteraction.settings.minBlockSize,
          ),
        })
        return
      }

      const vertices = currentInteraction.initialVertices.map((vertex, index) =>
        index === currentInteraction.vertexIndex ? clampVertex(point) : vertex,
      )
      onUpdateBlock(currentInteraction.blockId, {
        vertices,
        geometry: geometryFromVertices(vertices),
      })
    }

    function handlePointerUp(event: PointerEvent) {
      if (currentInteraction.pointerId !== event.pointerId) {
        return
      }

      if (currentInteraction.kind === 'rect-create') {
        const geometry = normalizeGeometry(
          currentInteraction.start,
          currentInteraction.current,
          currentInteraction.settings.minBlockSize,
        )
        if (
          geometry.width >= currentInteraction.settings.minBlockSize &&
          geometry.height >= currentInteraction.settings.minBlockSize
        ) {
          onCreateBlock({ shape_type: 'rect', geometry, vertices: null })
        }
      }

      if (currentInteraction.kind === 'freeform-create') {
        const vertices = finalizeFreeformVertices(currentInteraction.points, currentInteraction.current, currentInteraction.settings)
        if (!isValidPolygon(vertices, currentInteraction.settings.minBlockSize)) {
          showCanvasToast({ tone: 'error', message: 'Ignored invalid free-form path.' })
          setInteraction(null)
          return
        }
        onCreateBlock({
          shape_type: 'polygon',
          geometry: geometryFromVertices(vertices),
          vertices,
        })
      }

      if (currentInteraction.kind === 'cut-create') {
        const rawPathVertices = buildDraftCutVertices(
          currentInteraction.points,
          currentInteraction.current,
          currentInteraction.settings.pointEpsilon,
        )
        const pathVertices = finalizeCutPathVertices(
          currentInteraction.points,
          currentInteraction.current,
          currentInteraction.settings,
        )
        const cutRegion = buildCutRegion(pathVertices, currentInteraction.settings, rawPathVertices, cutCeilingPath)
        if (!cutRegion || !isValidPolygon(cutRegion.polygon, currentInteraction.settings.minBlockSize)) {
          showCanvasToast({ tone: 'error', message: 'Ignored invalid cut path.' })
          setInteraction(null)
          return
        }
        onCreateBlock({
          shape_type: 'polygon',
          geometry: geometryFromVertices(cutRegion.polygon),
          vertices: cutRegion.polygon,
          cut_path: cutRegion.cutPath,
        })
      }

      if (currentInteraction.kind === 'vertex') {
        const nextBlock = blocks.find((block) => draftBlockKey(block) === currentInteraction.blockId)
        if (
          !nextBlock ||
          !nextBlock.vertices ||
          isValidPolygon(nextBlock.vertices, currentInteraction.settings.minBlockSize)
        ) {
          setInteraction(null)
          return
        }
        onUpdateBlock(currentInteraction.blockId, {
          vertices: currentInteraction.initialVertices,
          geometry: geometryFromVertices(currentInteraction.initialVertices),
        })
        showCanvasToast({ tone: 'error', message: 'Ignored invalid polygon edit.' })
      }

      setInteraction(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [blocks, cutCeilingPath, interaction, isLocked, onCreateBlock, onUpdateBlock])

  useEffect(() => {
    if (!isPanning) {
      return undefined
    }

    function handlePointerMove(event: PointerEvent) {
      const viewportElement = viewportRef.current
      const panState = panStateRef.current
      if (!viewportElement || !panState || panState.pointerId !== event.pointerId) {
        return
      }

      viewportElement.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX)
      viewportElement.scrollTop = panState.scrollTop - (event.clientY - panState.startY)
      setViewport({
        ...viewport,
        panX: viewportElement.scrollLeft,
        panY: viewportElement.scrollTop,
      })
    }

    function handlePointerUp(event: PointerEvent) {
      const panState = panStateRef.current
      if (!panState || panState.pointerId !== event.pointerId) {
        return
      }
      panStateRef.current = null
      setIsPanning(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isPanning, onViewportChange, viewport])

  useEffect(() => {
    onHoveredBlockChange(null)
  }, [onHoveredBlockChange, page.id])

  const draftRectGeometry =
    interaction?.kind === 'rect-create'
      ? normalizeGeometry(interaction.start, interaction.current, interaction.settings.minBlockSize)
      : null
  const draftFreeformPoints =
    interaction?.kind === 'freeform-create'
      ? buildDraftFreeformVertices(interaction.points, interaction.current, interaction.settings.pointEpsilon)
      : null
  const draftCutPoints =
    interaction?.kind === 'cut-create'
      ? buildDraftCutVertices(interaction.points, interaction.current, interaction.settings.pointEpsilon)
      : null
  const draftCutPolygon =
    interaction?.kind === 'cut-create' && draftCutPoints
      ? buildCutRegion(draftCutPoints, interaction.settings, draftCutPoints, cutCeilingPath)?.polygon ?? null
      : null
  const activeToast = toast ?? localToast
  const selectedBlockIdSet = new Set(selectedBlockIds)
  const hasSingleSelectedBlock = selectedBlockIds.length === 1

  function selectionModeForEvent(
    event: Pick<ReactPointerEvent<HTMLElement>, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  ): BlockSelectionMode {
    if (event.shiftKey) {
      return 'range'
    }
    if (event.metaKey || event.ctrlKey) {
      return 'toggle'
    }
    return 'replace'
  }

  return (
    <section className={`canvas-panel canvas-panel-embedded ${toolbar ? '' : 'canvas-panel-toolbar-hidden'}`}>
      <div className="canvas-stage">
        <div className={`canvas-overlay-stack ${toolbar ? '' : 'canvas-overlay-stack-toolbar-hidden'}`.trim()}>
          {toolbar ? <EditorToolbar {...toolbar} /> : null}
          {blockListPanel ? <div className="canvas-block-list-overlay">{blockListPanel}</div> : null}
        </div>
        {blockInfoPanel ? <div className="canvas-side-overlay">{blockInfoPanel}</div> : null}
        {activeToast ? (
          <div
            className={`canvas-toast canvas-toast-${activeToast.tone}`}
            role={activeToast.tone === 'error' ? 'alert' : 'status'}
            aria-live={activeToast.tone === 'error' ? 'assertive' : 'polite'}
          >
            {activeToast.message}
          </div>
        ) : null}

        <div
          className={`canvas-viewport ${isPanning ? 'canvas-viewport-panning' : ''}`}
          ref={viewportRef}
          onWheelCapture={(event) => {
            if (!toolbar || event.ctrlKey || event.metaKey || Math.abs(event.deltaY) <= WHEEL_SCROLL_EPSILON) {
              return
            }

            scrollPageBy(event.deltaY)
            event.preventDefault()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
          }}
          onScroll={(event) => {
            setViewport({
              ...viewport,
              panX: event.currentTarget.scrollLeft,
              panY: event.currentTarget.scrollTop,
            })
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) {
              return
            }
            if (spacePressed || event.button === 1) {
              if (viewport.zoom > 1) {
                startPanning(event)
              }
              return
            }
            if (event.button === 0 && (isLocked || activeTool === 'select')) {
              onSelectBlock(null, 'replace')
            }
          }}
        >
          <div
            className={`canvas-frame ${activeTool !== 'select' && !isLocked ? 'canvas-frame-draw' : ''}`}
            ref={surfaceRef}
            style={{
              width: `${page.width * viewport.zoom}px`,
              height: `${page.height * viewport.zoom}px`,
            }}
            onPointerLeave={() => {
              onHoveredBlockChange(null)
            }}
            onPointerMove={(event) => {
              const point = pointerToRelative(event, event.currentTarget)
              const hoveredBlock = findTopmostBlockAtPoint(blocks, point)
              onHoveredBlockChange(hoveredBlock ? draftBlockKey(hoveredBlock) : null)
            }}
            onPointerDown={(event) => {
              if (spacePressed || event.button === 1) {
                startPanning(event)
                return
              }
              if (isLocked || activeTool === 'select') {
                if (event.button === 0) {
                  onSelectBlock(null, 'replace')
                }
                return
              }
              const point = pointerToRelative(event, event.currentTarget)
              if (activeTool === 'rect') {
                setInteraction({
                  kind: 'rect-create',
                  pointerId: event.pointerId,
                  start: point,
                  current: point,
                  settings: { ...debugSettings },
                })
                return
              }
              setInteraction(
                activeTool === 'freeform'
                  ? {
                      kind: 'freeform-create',
                      pointerId: event.pointerId,
                      points: [point],
                      current: point,
                      settings: { ...debugSettings },
                    }
                  : {
                      kind: 'cut-create',
                      pointerId: event.pointerId,
                      points: [point],
                      current: point,
                      settings: { ...debugSettings },
                    },
              )
            }}
          >
            <img className="canvas-image" src={withApiRoot(page.image_url) ?? undefined} alt={`Page ${page.page_index + 1}`} />
            {blocks.map((block) => {
              const blockId = draftBlockKey(block)
              const isSelected = selectedBlockIdSet.has(blockId)
              const isPrimarySelected = blockId === activeBlockId
              const commonStyle = {
                left: `${block.geometry.x * 100}%`,
                top: `${block.geometry.y * 100}%`,
                width: `${block.geometry.width * 100}%`,
                height: `${block.geometry.height * 100}%`,
              }

              if (isPolygonBlock(block) && block.vertices) {
                const polygonVertices = block.vertices
                return (
                  <div
                    key={blockId}
                    className={`region region-${block.block_type} region-polygon ${isSelected ? 'region-selected' : ''} ${isPrimarySelected ? 'region-selected-primary' : ''}`}
                    style={commonStyle}
                    onPointerDown={(event) => {
                      const point = surfaceRef.current ? pointerToRelative(event, surfaceRef.current) : null
                      const selectionMode = selectionModeForEvent(event)
                      if (activeTool === 'select' && point && !pointInPolygon(point, polygonVertices)) {
                        event.stopPropagation()
                        const hitBlock = findTopmostBlockAtPoint(blocks, point)
                        if (!hitBlock) {
                          onSelectBlock(null, 'replace')
                          return
                        }
                        onSelectBlock(draftBlockKey(hitBlock), selectionMode)
                        return
                      }
                      event.stopPropagation()
                      onSelectBlock(blockId, selectionMode)
                      if (selectionMode !== 'replace') {
                        return
                      }
                      if (spacePressed || event.button === 1) {
                        startPanning(event)
                        return
                      }
                      if (isLocked || activeTool !== 'select' || !point) {
                        return
                      }
                      setInteraction({
                        kind: 'move',
                        pointerId: event.pointerId,
                        blockId,
                        start: point,
                        initialGeometry: block.geometry,
                        initialVertices: polygonVertices,
                      })
                    }}
                    onDoubleClick={(event) => {
                      const point = surfaceRef.current ? pointerToRelative(event, surfaceRef.current) : null
                      event.stopPropagation()
                      if (!point) {
                        return
                      }
                      if (!pointInPolygon(point, polygonVertices)) {
                        const hitBlock = findTopmostBlockAtPoint(blocks, point)
                        if (!hitBlock) {
                          return
                        }
                        onCycleBlockType(draftBlockKey(hitBlock))
                        return
                      }
                      onCycleBlockType(blockId)
                    }}
                  >
                    <svg className="region-polygon-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <polygon className="region-polygon-shape" points={polygonPointsToLocalString(block)} />
                    </svg>
                    <span className="region-label">
                      {block.block_type}
                      <strong>#{block.order_index + 1}</strong>
                    </span>
                    {isPrimarySelected && hasSingleSelectedBlock && !isLocked
                      ? polygonVertices.map((vertex, index) => (
                          <span
                            key={`${blockId}-vertex-${index}`}
                            className="region-handle region-handle-vertex"
                            style={{
                              left: `${((vertex.x - block.geometry.x) / block.geometry.width) * 100}%`,
                              top: `${((vertex.y - block.geometry.y) / block.geometry.height) * 100}%`,
                            }}
                            onPointerDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setInteraction({
                                kind: 'vertex',
                                pointerId: event.pointerId,
                                blockId,
                                vertexIndex: index,
                                initialVertices: polygonVertices,
                                settings: { ...debugSettings },
                              })
                            }}
                          />
                        ))
                      : null}
                  </div>
                )
              }

              return (
                <div
                  key={blockId}
                  className={`region region-${block.block_type} ${isSelected ? 'region-selected' : ''} ${isPrimarySelected ? 'region-selected-primary' : ''}`}
                  style={commonStyle}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    const selectionMode = selectionModeForEvent(event)
                    onSelectBlock(blockId, selectionMode)
                    if (selectionMode !== 'replace') {
                      return
                    }
                    if (spacePressed || event.button === 1) {
                      startPanning(event)
                      return
                    }
                    if (isLocked || activeTool !== 'select' || !surfaceRef.current) {
                      return
                    }
                    setInteraction({
                      kind: 'move',
                      pointerId: event.pointerId,
                      blockId,
                      start: pointerToRelative(event, surfaceRef.current),
                      initialGeometry: block.geometry,
                      initialVertices: null,
                    })
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    onCycleBlockType(blockId)
                  }}
                >
                  <span className="region-label">
                    {block.block_type}
                    <strong>#{block.order_index + 1}</strong>
                  </span>
                  {isPrimarySelected && hasSingleSelectedBlock && !isLocked
                    ? resizeHandles.map((handle) => (
                        <span
                          key={handle}
                          className={`region-handle region-handle-${handle}`}
                          onPointerDown={(event) => {
                            if (!surfaceRef.current) {
                              return
                            }
                            event.preventDefault()
                            event.stopPropagation()
                            setInteraction({
                              kind: 'resize',
                              pointerId: event.pointerId,
                              blockId,
                              handle,
                              start: pointerToRelative(event, surfaceRef.current),
                              initial: block.geometry,
                              settings: { ...debugSettings },
                            })
                          }}
                        />
                      ))
                    : null}
                </div>
              )
            })}
            {draftRectGeometry ? (
              <div
                className="region region-draft"
                style={{
                  left: `${draftRectGeometry.x * 100}%`,
                  top: `${draftRectGeometry.y * 100}%`,
                  width: `${draftRectGeometry.width * 100}%`,
                  height: `${draftRectGeometry.height * 100}%`,
                }}
              />
            ) : null}
            {draftFreeformPoints && draftFreeformPoints.length >= 2 ? (
              <svg className="canvas-draft-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polygon className="canvas-draft-polygon" points={polygonPointsToCanvasString(draftFreeformPoints)} />
              </svg>
            ) : null}
            {draftCutPoints && draftCutPoints.length >= 2 ? (
              <svg className="canvas-draft-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {draftCutPolygon ? (
                  <polygon className="canvas-draft-cut-region" points={polygonPointsToCanvasString(draftCutPolygon)} />
                ) : null}
                <polyline className="canvas-draft-polyline" points={polygonPointsToCanvasString(draftCutPoints)} />
              </svg>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
})
