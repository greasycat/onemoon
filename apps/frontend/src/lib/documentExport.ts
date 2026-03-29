import type { DraftBlock, DraftPageLayout } from './segmentation'

export const UNCONVERTED_PLACEHOLDER = 'Block/Page Unconverted Placeholder'

const MATH_ENV_PATTERN = /^\\begin\{(?:equation\*?|align\*?|gather\*?)\}[\s\S]*\\end\{(?:equation\*?|align\*?|gather\*?)\}$/
const TEXT_BLOCK_PATTERN = /^\\begin\{textblock\}[\s\S]*\\end\{textblock\}$/

type ExportPageEntry = {
  pageIndex: number
  draft: DraftPageLayout
}

export function normalizeSnippet(source: string) {
  return source.trim().replace(/\r\n/g, '\n')
}

export function extractDocumentBody(source: string | null | undefined) {
  if (!source) {
    return null
  }

  const normalized = normalizeSnippet(source)
  if (!normalized) {
    return null
  }

  const beginDocumentIndex = normalized.indexOf('\\begin{document}')
  const endDocumentIndex = normalized.lastIndexOf('\\end{document}')
  if (beginDocumentIndex < 0 || endDocumentIndex <= beginDocumentIndex) {
    return normalized
  }

  let body = normalized.slice(beginDocumentIndex + '\\begin{document}'.length, endDocumentIndex).trim()
  if (body.startsWith('\\maketitle')) {
    body = body.slice('\\maketitle'.length).trim()
  }
  return body || null
}

export function resolveBlockOutput(block: Pick<DraftBlock, 'manual_output' | 'generated_output'>) {
  for (const candidate of [block.manual_output, block.generated_output]) {
    if (!candidate) {
      continue
    }
    const normalized = normalizeSnippet(candidate)
    if (normalized) {
      return normalized
    }
  }
  return null
}

export function ensureDisplayMath(source: string) {
  if (source.startsWith('\\[') && source.endsWith('\\]')) {
    return source
  }
  if (source.startsWith('$$') && source.endsWith('$$')) {
    return source
  }
  if (MATH_ENV_PATTERN.test(source)) {
    return source
  }
  if (source.startsWith('\\(') && source.endsWith('\\)')) {
    source = source.slice(2, -2).trim()
  } else if (source.startsWith('$') && source.endsWith('$')) {
    source = source.slice(1, -1).trim()
  }
  return `\\[\n${source}\n\\]`
}

export function ensureTextBlock(source: string) {
  if (TEXT_BLOCK_PATTERN.test(source)) {
    return source
  }
  return ['\\begin{textblock}', source, '\\end{textblock}'].join('\n')
}

export function formatBlockOutput(block: Pick<DraftBlock, 'block_type'>, source: string) {
  if (block.block_type === 'math') {
    return ensureDisplayMath(source)
  }
  if (block.block_type === 'figure') {
    return ['% Figure block', '\\begin{figure}[h]', '\\centering', source, '\\end{figure}'].join('\n')
  }
  if (block.block_type === 'text') {
    return ensureTextBlock(source)
  }
  return source
}

export function buildBlockExport(
  block: Pick<DraftBlock, 'block_type' | 'manual_output' | 'generated_output'>,
  placeholder = UNCONVERTED_PLACEHOLDER,
) {
  const convertedSource = resolveBlockOutput(block)
  if (!convertedSource) {
    return placeholder
  }
  return formatBlockOutput(block, convertedSource)
}

export function buildPageExport(
  pageDraft: Pick<DraftPageLayout, 'blocks'>,
  placeholder = UNCONVERTED_PLACEHOLDER,
) {
  const orderedBlocks = [...pageDraft.blocks]
    .filter((block) => block.approval !== 'rejected')
    .sort((left, right) => left.order_index - right.order_index)

  if (orderedBlocks.length === 0) {
    return placeholder
  }

  return orderedBlocks.map((block) => buildBlockExport(block, placeholder)).join('\n\n')
}

export function buildDocumentExport(entries: ExportPageEntry[], placeholder = UNCONVERTED_PLACEHOLDER) {
  if (entries.length === 0) {
    return placeholder
  }

  return [...entries]
    .sort((left, right) => left.pageIndex - right.pageIndex)
    .map((entry) => buildPageExport(entry.draft, placeholder))
    .join('\n\n')
}
