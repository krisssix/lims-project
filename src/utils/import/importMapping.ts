/**
 * Mapping utilita pro přiřazení sloupců (headers) k fieldům šablony.
 * - Strict mode: každý field musí mít unikátní sourceIndex.
 * - Validace: žádné duplicitní indexy, žádné nevyplněné povinné.
 * - Bez 'any'.
 */

import type { SuggestedMapping } from '@/stores/import'

export type MatchSource = 'LEARNED' | 'EXACT_MATCH' | 'PARTIAL_MATCH' | 'POSITION' | 'MANUAL' | null

export interface MappingField {
  id: string
  blockIndex: number
  fieldName: string
  required: boolean
  originalIndexGuess: number | null
  mappedSourceIndex: number | null
  headerMatched: boolean
  matchSource?: MatchSource
  /** Confidence score z BE (0-1) */
  confidence?: number
  /** Data type of the field (text, float, int, etc.) */
  type?: string
}

export interface MappingBlock {
  blockIndex: number
  title: string
  headers: string[]
  fields: MappingField[]
}

/** Series column mapping for data series (X, Y, C, D etc.) */
export interface SeriesMappingField {
  id: string
  columnName: string
  required: boolean
  mappedSourceIndex: number | null
  headerMatched: boolean
  matchSource?: MatchSource
  confidence?: number
}

export interface SeriesMappingBlock {
  seriesName: string
  seriesType: string
  headers: string[]
  columns: SeriesMappingField[]
}

export interface MappingModel {
  fileName: string
  delimiter: string
  blocks: MappingBlock[]
  seriesBlocks?: SeriesMappingBlock[]
}



/**
 * Normalize a header/field name for fuzzy comparison:
 * - Strip unit suffix like " (°C)", " (d.nm)", " (Percent)"
 * - Strip trailing numbers like " 1", " 2"
 * - Lowercase and trim
 */
function normalizeForMatch(s: string): string {
  return s
    .replace(/\s*\([^)]*\)\s*/g, ' ')  // Remove (unit) including spaces
    .replace(/\s+\d+$/u, '')            // Remove trailing number
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')               // Collapse multiple spaces
}

/**
 * Check if two names match (fuzzy):
 * - Exact match after normalization
 * - Or one is a prefix of the other (for "Size Peak" matching "Size Peak (d.nm)")
 */
function namesMatch(fieldName: string, headerName: string): boolean {
  const normField = normalizeForMatch(fieldName)
  const normHeader = normalizeForMatch(headerName)

  // Exact match
  if (normField === normHeader) return true

  // Prefix match (field is prefix of header or vice versa)
  if (normHeader.startsWith(normField) || normField.startsWith(normHeader)) return true

  return false
}

/**
 * Vytvoří mapping model z template-like + imported structure.
 * originalIndexGuess = pokud jméno odpovídá header na stejné pozici (case-insensitive),
 * nebo pokud header nalezen jinde -> nastaven mappedSourceIndex (auto-match).
 */
export function buildMappingModel(
  template: {
    name: string
    deviceId: string
    blocks: Array<{ blockIndex: number; title: string; fields: Array<{ name: string; required: boolean; sourceIndex?: number; type?: string }> }>
  },
  imported: {
    fileName: string
    delimiter: string
    blocks: Array<{ blockIndex: number; headers: string[] }>
  }
): MappingModel {
  const modelBlocks: MappingBlock[] = []

  for (const tBlock of template.blocks) {
    const iBlock = imported.blocks.find(b => b.blockIndex === tBlock.blockIndex)
    const headers = iBlock?.headers ?? []
    const fields: MappingField[] = []
    const usedIndices = new Set<number>()

    for (let fi = 0; fi < tBlock.fields.length; fi++) {
      const f = tBlock.fields[fi]!
      const guessIdx = typeof f.sourceIndex === 'number' ? f.sourceIndex : fi
      let mapped: number | null = null
      let matched = false

      // Try position-based match first (if available and names match)
      if (guessIdx >= 0 && guessIdx < headers.length && !usedIndices.has(guessIdx)) {
        if (namesMatch(f.name, headers[guessIdx])) {
          mapped = guessIdx
          matched = true
          usedIndices.add(guessIdx)
        }
      }

      // If no position match, search all headers
      if (!matched) {
        for (let hi = 0; hi < headers.length; hi++) {
          if (!usedIndices.has(hi) && namesMatch(f.name, headers[hi])) {
            mapped = hi
            matched = true
            usedIndices.add(hi)
            break
          }
        }
      }

      fields.push({
        id: `${tBlock.blockIndex}-${fi}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        blockIndex: tBlock.blockIndex,
        fieldName: f.name,
        required: f.required,
        originalIndexGuess: guessIdx,
        mappedSourceIndex: mapped,
        headerMatched: matched,
        type: f.type
      })
    }

    modelBlocks.push({
      blockIndex: tBlock.blockIndex,
      title: tBlock.title,
      headers,
      fields
    })
  }

  return {
    fileName: imported.fileName,
    delimiter: imported.delimiter,
    blocks: modelBlocks
  }
}

/**
 * Validace mappingu:
 * - Všechny required fields mají mappedSourceIndex !== null
 * - Žádné duplicitní sourceIndex v rámci stejného blocku
 * Vrací chyby (pokud prázdné pole = validní).
 * 
 * @param enabledFields Pokud je definováno, validují se jen pole, jejichž ID je v setu.
 */
export function validateMapping(model: MappingModel, enabledFields?: Set<string>): string[] {
  const errors: string[] = []
  for (const block of model.blocks) {
    const used = new Set<number>()
    for (const f of block.fields) {
      // Skip if filtering is active and field is disabled
      if (enabledFields && !enabledFields.has(f.id)) continue

      if (f.required && f.mappedSourceIndex === null) {
        // Skip validation for required text fields as per user request (allows empty text columns)
        if (f.type !== 'text') {
          errors.push(`Tabulka hodnot ${block.blockIndex}: pole '${f.fieldName}' není namapováno`)
        }
      }
      if (f.mappedSourceIndex != null) {
        if (used.has(f.mappedSourceIndex)) {
          errors.push(`Tabulka hodnot ${block.blockIndex}: duplicita sloupce index ${f.mappedSourceIndex + 1} pro '${f.fieldName}'`)
        } else {
          used.add(f.mappedSourceIndex)
        }
      }
    }
    // Kapacitní kontrola – nepřesahovat počet sloupců
    const maxIdx = Math.max(-1, ...Array.from(used.values()))
    if (maxIdx >= block.headers.length) {
      errors.push(`Tabulka hodnot ${block.blockIndex}: index mimo rozsah (>${block.headers.length})`)
    }
  }
  return errors
}

/**
 * Export výsledného mappingu do objektu pro apply.
 * Každý Tabulka hodnot -> { fieldName, sourceIndex }.
 * Série -> { columnName, sourceIndex }.
 * 
 * @param enabledFields Pokud je definováno, exportují se jen pole v setu.
 */
export function exportMapping(
  model: MappingModel,
  enabledFields?: Set<string>
): {
  blockMappings: Array<{
    blockIndex: number
    mappings: Array<{ fieldName: string; sourceIndex: number }>
  }>
  seriesMappings: Array<{
    seriesName: string
    seriesType: string
    columnMappings: Array<{ columnName: string; sourceIndex: number }>
  }>
} {
  const blockMappings = model.blocks.map(b => ({
    blockIndex: b.blockIndex,
    mappings: b.fields
      .filter(f => f.mappedSourceIndex != null && (!enabledFields || enabledFields.has(f.id)))
      .map(f => ({
        fieldName: f.fieldName,
        sourceIndex: f.mappedSourceIndex as number
      }))
  }))

  const seriesMappings = (model.seriesBlocks ?? []).map(s => ({
    seriesName: s.seriesName,
    seriesType: s.seriesType,
    columnMappings: s.columns
      .filter(c => c.mappedSourceIndex != null) // Series columns don't have separate enable IDs yet in this model, or they do?
      .map(c => ({
        columnName: c.columnName,
        sourceIndex: c.mappedSourceIndex as number
      }))
  }))

  return { blockMappings, seriesMappings }
}

/**
 * Aplikuje naučená mapování z backendu na mapping model.
 * 
 * Priorita:
 * 1. LEARNED (95% confidence) - z DB
 * 2. EXACT_MATCH (90%) - přesná shoda názvu
 * 3. PARTIAL_MATCH (70%) - částečná shoda
 * 4. POSITION (50%) - pozice sloupce
 * 
 * @param model Aktuální mapping model
 * @param suggestions Návrhy z backendu (header -> SuggestedMapping)
 * @returns Nový model s aplikovanými návrhy
 */
export function applyLearnedSuggestions(
  model: MappingModel,
  suggestions: Record<string, SuggestedMapping>
): MappingModel {
  if (!suggestions || Object.keys(suggestions).length === 0) {
    return model
  }

  const newBlocks = model.blocks.map(block => {
    const usedIndices = new Set<number>()

    const newFields = block.fields.map(field => {
      // Najdi header, který odpovídá tomuto poli
      for (let headerIdx = 0; headerIdx < block.headers.length; headerIdx++) {
        const header = block.headers[headerIdx]
        const suggestion = suggestions[header]

        if (suggestion &&
          suggestion.targetFieldName === field.fieldName &&
          !usedIndices.has(headerIdx)) {
          usedIndices.add(headerIdx)
          return {
            ...field,
            mappedSourceIndex: headerIdx,
            headerMatched: true,
            matchSource: suggestion.matchType as MatchSource,
            confidence: suggestion.confidence
          }
        }
      }
      return field
    })

    return { ...block, fields: newFields }
  })

  return { ...model, blocks: newBlocks }
}

/**
 * Normalizuje header pro porovnání (same as backend).
 * Slouží pro client-side fallback matching.
 */
export function normalizeHeader(raw: string): string {
  if (!raw) return ''
  let s = raw.trim()
  s = s.replace(/\s+/g, '_')
  s = s.replace(/[^A-Za-z0-9_]/g, '_')
  s = s.replace(/_+/g, '_')
  return s.toLowerCase()
}
