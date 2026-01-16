/**
 * mapping utilita pro přiřazení sloupců (headers) k polím šablony.
 * : striktní režim: každé pole musí mít unikátní sourceindex.
 * : validace: žádné duplicitní indexy, žádné nevyplněné povinné údaje.
 * : bez 'any'.
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
  confidence?: number
  /** datový typ pole (text, float, int atd.) */
  type?: string
}

export interface MappingBlock {
  blockIndex: number
  title: string
  headers: string[]
  fields: MappingField[]
}

/** mapování sloupců sérií pro datové série (x, y, c, d atd.) */
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
 * normalizace názvu hlavičky/pole pro přibližné porovnání:
 * : odstranění přípony jednotky typu „ (°c)“, „ (d.nm)“, „ (percent)“
 * : odstranění koncových čísel typu „ 1“, „ 2“
 * : převod na malá písmena a ořezání mezer
 */
function normalizeForMatch(s: string): string {
  return s
    .replace(/\s*\([^)]*\)\s*/g, ' ')  // Remove (unit) including spaces
    .replace(/\s+\d+$/u, '')            // Remove trailing number
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')               // sloučení více mezer do jedné
}

/**
 * kontrola, zda se dva názvy shodují (přibližně):
 * : přesná shoda po normalizaci
 * : nebo je jeden předponou druhého (pro shodu „size peak“ s „size peak (d.nm)“)
 */
function namesMatch(fieldName: string, headerName: string): boolean {
  const normField = normalizeForMatch(fieldName)
  const normHeader = normalizeForMatch(headerName)

  // přesná shoda
  if (normField === normHeader) return true

  // shoda předpony (pole je předponou hlavičky nebo naopak)
  if (normHeader.startsWith(normField) || normField.startsWith(normHeader)) return true

  return false
}

/**
 * vytvoří mapping model ze šablony a importované struktury.
 * originalindexguess: pokud název odpovídá hlavičce na stejné pozici (bez ohledu na velikost písmen),
 * nebo pokud je hlavička nalezena jinde: nastaví se mappedsourceindex (automatická shoda).
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

      // nejdříve zkusit shodu na základě pozice (pokud je dostupná a názvy souhlasí)
      if (guessIdx >= 0 && guessIdx < headers.length && !usedIndices.has(guessIdx)) {
        if (namesMatch(f.name, headers[guessIdx])) {
          mapped = guessIdx
          matched = true
          usedIndices.add(guessIdx)
        }
      }

      // pokud není shoda podle pozice, prohledat všechny hlavičky
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
 * validace mapování:
 * : všechna povinná pole mají mappedsourceindex !== null
 * : žádné duplicitní sourceindexy v rámci stejného bloku
 * vrací chyby (pokud je pole prázdné: je platné).
 * 
 * @param enabledFields pokud je definováno, validují se jen pole, jejichž id je v množině.
 */
export function validateMapping(model: MappingModel, enabledFields?: Set<string>): string[] {
  const errors: string[] = []
  for (const block of model.blocks) {
    const used = new Set<number>()
    for (const f of block.fields) {
      // přeskočit, pokud je aktivní filtrování a pole je zakázáno
      if (enabledFields && !enabledFields.has(f.id)) continue

      if (f.required && f.mappedSourceIndex === null) {
        // přeskočení validace pro povinná textová pole na žádost uživatele (umožňuje prázdné textové sloupce)
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
    // kapacitní kontrola: nepřesahovat počet sloupců
    const maxIdx = Math.max(-1, ...Array.from(used.values()))
    if (maxIdx >= block.headers.length) {
      errors.push(`Tabulka hodnot ${block.blockIndex}: index mimo rozsah (>${block.headers.length})`)
    }
  }
  return errors
}

/**
 * export výsledného mapování do objektu pro aplikaci (apply).
 * každá tabulka hodnot -> { fieldname, sourceindex }.
 * série -> { columnname, sourceindex }.
 * 
 * @param enabledFields pokud je definováno, exportují se jen pole v množině.
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
      .filter(c => c.mappedSourceIndex != null) // sloupce sérií zatím nemají samostatná id pro povolení v tomto modelu, nebo mají?
      .map(c => ({
        columnName: c.columnName,
        sourceIndex: c.mappedSourceIndex as number
      }))
  }))

  return { blockMappings, seriesMappings }
}

/**
 * aplikuje naučená mapování z backendu na mapping model.
 * 
 * priorita:
 * 1. learned (95% spolehlivost) : z databáze
 * 2. exact_match (90%) : přesná shoda názvu
 * 3. partial_match (70%) : částečná shoda
 * 4. position (50%) : pozice sloupce
 * 
 * @param model aktuální mapping model
 * @param suggestions návrhy z backendu (header -> suggestedmapping)
 * @returns nový model s aplikovanými návrhy
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
      // najdi hlavičku, která odpovídá tomuto poli
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
 * normalizuje hlavičku pro porovnání (stejně jako na backendu).
 * slouží pro záložní porovnávání na straně klienta (fallback matching).
 */
export function normalizeHeader(raw: string): string {
  if (!raw) return ''
  let s = raw.trim()
  s = s.replace(/\s+/g, '_')
  s = s.replace(/[^A-Za-z0-9_]/g, '_')
  s = s.replace(/_+/g, '_')
  return s.toLowerCase()
}
