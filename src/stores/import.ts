import { defineStore } from 'pinia'
import { post, get, del } from '@/services/api/api-requests'
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

/* -------- Learned mapping suggestions (from DB) -------- */
export type SuggestedMapping = {
  targetFieldName: string
  matchType: 'LEARNED' | 'EXACT_MATCH' | 'PARTIAL_MATCH'
  confidence: number
}
export type SuggestedSeriesMapping = {
  targetSeriesType: string
  matchType: 'LEARNED' | 'HEURISTIC'
  confidence: number
}
export type LearnedMappingSuggestions = Record<string, SuggestedMapping>
export type LearnedSeriesSuggestions = Record<string, SuggestedSeriesMapping>

/* -------- Learned mapping management DTO -------- */
export type LearnedMapping = {
  id: number
  sourceColumnRaw: string
  targetFieldName: string
  mappingType: 'VALUE' | 'SERIES'
  useCount: number
  lastUsed: number
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
   * Learned mappings: POST /measurement-import/template/{templateId}/suggest-mappings
   * Vrací uložená mapování z předchozích importů.
   */
  async function suggestLearnedMappings(
    templateId: number,
    headers: string[],
    templateFieldNames: string[]
  ): Promise<LearnedMappingSuggestions> {
    try {
      const resp = await post(
        `measurement-import/template/${templateId}/suggest-mappings`,
        { headers, templateFieldNames },
        undefined
      )
      if (!hasContent<LearnedMappingSuggestions>(resp)) {
        console.warn('Learned mappings: invalid response, using empty')
        return {}
      }
      return resp.data.content
    } catch (e) {
      // Fallback: pokud endpoint selže, vrátíme prázdný objekt
      console.warn('Learned mappings API failed, using fallback:', e)
      return {}
    }
  }

  /**
   * Získá seznam naučených mapování pro správu.
   */
  async function fetchLearnedMappings(templateId: number): Promise<LearnedMapping[]> {
    const resp = await get(`measurement-import/template/${templateId}/mappings`, undefined)
    if (!hasContent<LearnedMapping[]>(resp)) return []
    return resp.data.content
  }

  /**
   * Smaže naučené mapování.
   */
  async function deleteLearnedMapping(mappingId: number): Promise<void> {
    await del(`measurement-import/mapping/${mappingId}`, undefined)
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

  /**
   * Uloží mapování sloupců pro šablonu (learning).
   * Volat po úspěšném importu měření.
   */
  async function saveMappings(
    templateId: number,
    mapping: Record<string, string>,
    seriesMapping?: Record<string, string>
  ): Promise<void> {
    const url = `measurement-import/template/${templateId}/save-mappings`
    console.log('[saveMappings] Calling:', url, 'with', mapping)
    try {
      await post(
        url,
        { mapping, seriesMapping: seriesMapping || {} },
        undefined
      )
      console.log('[saveMappings] Saved', Object.keys(mapping).length, 'mappings for template', templateId)
    } catch (e) {
      console.warn('[saveMappings] Failed to save mappings:', e)
      // Neblokujeme UI při selhání - mapování je nice-to-have
    }
  }

  return {
    startImport,
    commitImport,
    suggestMapping,
    suggestLearnedMappings,
    fetchLearnedMappings,
    deleteLearnedMapping,
    suggestTemplate,
    saveMappings
  }
})

