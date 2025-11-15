import { defineStore } from 'pinia'
import { post } from '@/services/api/api-requests'
import { inferFieldType, type FieldType } from '@/utils/inferFieldType'

export type ColumnType = 'float' | 'int' | 'bool' | 'date' | 'text' | 'file' | 'empty' | 'unknown'

export type AiMatch = { header: string; fieldName: string; score: number }
export type SuggestMappingResponse = {
  mapping: Record<string, string>
  matches: AiMatch[]
  model: string
}
export type SuggestMappingRequest = {
  templateId: number
  headers: string[]
  threshold?: number
}

/* -------- Import preview/commit DTOs (v souladu s BE) -------- */
export type ImportStartRequest = {
  sourceType: 'text' | 'csv' | 'xlsx'
  rawText?: string
  fileBase64?: string
  delimiter?: string
  decimal?: string
  headerRowIndex?: number
}
export type ImportPreviewResponse = {
  sessionId: number
  rawHeaders: string[]
  normalizedHeaders: string[]
  sampleRows: Array<Record<string, string>>
  suggestedTemplateId?: number | null
  suggestedMapping?: Record<string, string> | null
  summaryRowIndexes: number[]
  state: string
}
export type ImportCommitRequest = {
  mapping: Record<string, string> // header -> templateFieldName
  templateId: number
  selectedRowIndexes: number[]
}
export type ImportCommitResponse = {
  sessionId: number
  persistedMeasurements: number
  persistedValues: number
  skippedRows: number
  state: string
}

/* -------- FE-only návrh šablony (zpětná kompatibilita) -------- */
export type ColumnSuggestion = {
  index: number
  headerRaw: string
  headerNormalized: string
  detectedType: ColumnType
}
export type TemplateSuggestionResponse = {
  headersRaw: string[]
  headersNormalized: string[]
  columns: ColumnSuggestion[]
  repeatDetected: boolean
  repeatOrientation: 'HORIZONTAL' | 'VERTICAL' | string
  replicateCount: number | null
  repeatMap: Record<string, number[]>
}

/* Helpers */
function toColumnType(t: FieldType): ColumnType { return t }

/** Base název bez trailing čísla, např. "Size Peak 3" -> "Size Peak" */
function baseNameForRepeat(headerRaw: string): string {
  if (!headerRaw) return ''
  return headerRaw.trim().replace(/\s+\d+$/u, '')
}

/** Heuristika opakovaných sad z hlaviček */
function buildRepeatMap(headers: string[]): {
  repeatMap: Record<string, number[]>
  repeatDetected: boolean
  replicateCount: number | null
} {
  const tmp: Record<string, number[]> = {}
  headers.forEach((h, idx) => {
    const base = baseNameForRepeat(h)
    const key = base || h || `#${idx + 1}`
    if (!tmp[key]) tmp[key] = []
    tmp[key]!.push(idx)
  })
  const filtered: Record<string, number[]> = {}
  Object.keys(tmp).forEach(k => { if (tmp[k]!.length > 1) filtered[k] = tmp[k]! })
  const repeatDetected = Object.keys(filtered).length > 0
  const replicateCount = repeatDetected ? Math.max(...Object.values(filtered).map(v => v.length)) : null
  return { repeatMap: filtered, repeatDetected, replicateCount }
}

/** Type-guard na odpověď tvaru { data: { content: T } } (bez použití any) */
type RespWithContent<T> = { data: { content: T } }
function hasContent<T>(r: unknown): r is RespWithContent<T> {
  if (typeof r !== 'object' || r === null) return false
  const d = (r as { data?: unknown }).data
  if (typeof d !== 'object' || d === null) return false
  return Object.prototype.hasOwnProperty.call(d as Record<string, unknown>, 'content')
}

export const useImportStore = defineStore('import', () => {
  /**
   * BE preview: POST /measurement-import/project/{projectId}/start
   */
  async function startImport(projectId: number, req: ImportStartRequest): Promise<ImportPreviewResponse> {
    const forceDelim = (req.sourceType === 'text' && (req.rawText ?? '').includes('\t')) ? '\t' : undefined
    const resp = await post(
      `measurement-import/project/${projectId}/start`,
      { ...req, delimiter: req.delimiter ?? forceDelim },
      undefined
    )
    if (!hasContent<ImportPreviewResponse>(resp)) {
      throw new Error('Neplatná odpověď z /measurement-import/.../start (chybí content)')
    }
    return resp.data.content
  }

  /**
   * BE commit: POST /measurement-import/{sessionId}/commit
   */
  async function commitImport(sessionId: number, payload: ImportCommitRequest): Promise<ImportCommitResponse> {
    const resp = await post(
      `measurement-import/${sessionId}/commit`,
      payload,
      undefined
    )
    if (!hasContent<ImportCommitResponse>(resp)) {
      throw new Error('Neplatná odpověď z /measurement-import/{id}/commit (chybí content)')
    }
    return resp.data.content
  }

  /**
   * AI mapping: POST /measurement-import/ai/suggest-mapping
   */
  async function suggestMapping(req: SuggestMappingRequest): Promise<SuggestMappingResponse> {
    const resp = await post(
      'measurement-import/ai/suggest-mapping',
      req,
      undefined
    )
    if (!hasContent<SuggestMappingResponse>(resp)) {
      throw new Error('Neplatná odpověď z /measurement-import/ai/suggest-mapping (chybí content)')
    }
    return resp.data.content
  }

  /**
   * FE-only: Návrh šablony nad preview odpovědí – zpětná kompatibilita pro UI.
   */
  async function suggestTemplate(projectId: number, req: ImportStartRequest): Promise<TemplateSuggestionResponse> {
    const preview = await startImport(projectId, req)
    const headersRaw: string[] = Array.isArray(preview.rawHeaders) ? preview.rawHeaders : []
    const headersNormalized: string[] = Array.isArray(preview.normalizedHeaders) ? preview.normalizedHeaders : []

    const columns: ColumnSuggestion[] = headersRaw.map((h: string, idx: number) => {
      const ft = inferFieldType(undefined, h)
      return {
        index: idx,
        headerRaw: h,
        headerNormalized: headersNormalized[idx] ?? '',
        detectedType: toColumnType(ft),
      }
    })

    const { repeatMap, repeatDetected, replicateCount } = buildRepeatMap(headersRaw)
    return {
      headersRaw,
      headersNormalized,
      columns,
      repeatDetected,
      repeatOrientation: 'HORIZONTAL',
      replicateCount,
      repeatMap,
    }
  }

  return { startImport, commitImport, suggestMapping, suggestTemplate }
})
