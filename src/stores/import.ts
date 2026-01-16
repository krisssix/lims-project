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

/* -------- návrhy naučených mapování (z db) -------- */
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

/* -------- správa naučených mapování dto -------- */
export type LearnedMapping = {
  id: number
  sourceColumnRaw: string
  targetFieldName: string
  mappingType: 'VALUE' | 'SERIES'
  useCount: number
  lastUsed: number
}

/* -------- dto pro náhled a potvrzení importu (v souladu s be) -------- */
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
  mapping: Record<string, string> // hlavička: název pole v šabloně
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

/* -------- návrh šablony pouze na fe (zpětná kompatibilita) -------- */
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

/* pomocné funkce */
function toColumnType(t: FieldType): ColumnType { return t }

/** základní název bez koncového čísla, např. "size peak 3" -> "size peak" */
function baseNameForRepeat(headerRaw: string): string {
  if (!headerRaw) return ''
  return headerRaw.trim().replace(/\s+\d+$/u, '')
}

/** heuristika opakovaných sad z hlaviček */
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

/** type-guard pro odpověď ve tvaru { data: { content: t } } (bez použití any) */
type RespWithContent<T> = { data: { content: T } }
function hasContent<T>(r: unknown): r is RespWithContent<T> {
  if (typeof r !== 'object' || r === null) return false
  const d = (r as { data?: unknown }).data
  if (typeof d !== 'object' || d === null) return false
  return Object.prototype.hasOwnProperty.call(d as Record<string, unknown>, 'content')
}

export const useImportStore = defineStore('import', () => {
  /**
   * náhled backendu (be preview): post /measurement-import/project/{projectid}/start
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
   * potvrzení backendu (be commit): post /measurement-import/{sessionid}/commit
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
   * ai mapování: post /measurement-import/ai/suggest-mapping
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
   * naučená mapování: post /measurement-import/template/{templateid}/suggest-mappings
   * vrací uložená mapování z předchozích importů.
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
        console.warn('naučená mapování: neplatná odpověď, vracím prázdný objekt')
        return {}
      }
      return resp.data.content
    } catch (e) {
      // fallback: pokud koncový bod selže, vrátíme prázdný objekt
      console.warn('volání naučených mapování selhalo, používám fallback:', e)
      return {}
    }
  }

  /**
   * získá seznam naučených mapování pro správu.
   */
  async function fetchLearnedMappings(templateId: number): Promise<LearnedMapping[]> {
    const resp = await get(`measurement-import/template/${templateId}/mappings`, undefined)
    if (!hasContent<LearnedMapping[]>(resp)) return []
    return resp.data.content
  }

  /**
   * smaže naučené mapování.
   */
  async function deleteLearnedMapping(mappingId: number): Promise<void> {
    await del(`measurement-import/mapping/${mappingId}`, undefined)
  }

  /**
   * pouze na fe: návrh šablony nad náhledem odpovědi – zpětná kompatibilita pro ui.
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
   * uloží mapování sloupců pro šablonu (učení).
   * volat po úspěšném importu měření.
   */
  async function saveMappings(
    templateId: number,
    mapping: Record<string, string>,
    seriesMapping?: Record<string, string>
  ): Promise<void> {
    const url = `measurement-import/template/${templateId}/save-mappings`
    console.log('[savemappings] volám:', url, 's', mapping)
    try {
      await post(
        url,
        { mapping, seriesMapping: seriesMapping || {} },
        undefined
      )
      console.log('[savemappings] uloženo', Object.keys(mapping).length, 'mapování pro šablonu', templateId)
    } catch (e) {
      console.warn('[savemappings] nepodařilo se uložit mapování:', e)
      // neblokujeme ui při selhání: mapování je doplňková funkce
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

