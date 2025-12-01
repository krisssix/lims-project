/**
 * Mapping utilita pro přiřazení sloupců (headers) k fieldům šablony.
 * - Strict mode: každý field musí mít unikátní sourceIndex.
 * - Validace: žádné duplicitní indexy, žádné nevyplněné povinné.
 * - Bez 'any'.
 */

export interface MappingField {
  id: string
  blockIndex: number
  fieldName: string
  required: boolean
  originalIndexGuess: number | null
  mappedSourceIndex: number | null
  headerMatched: boolean
}

export interface MappingBlock {
  blockIndex: number
  title: string
  headers: string[]
  fields: MappingField[]
}

export interface MappingModel {
  fileName: string
  delimiter: string
  blocks: MappingBlock[]
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
    blocks: Array<{ blockIndex: number; title: string; fields: Array<{ name: string; required: boolean; sourceIndex?: number }> }>
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

    for (let fi = 0; fi < tBlock.fields.length; fi++) {
      const f = tBlock.fields[fi]!
      const guessIdx = typeof f.sourceIndex === 'number' ? f.sourceIndex : fi
      let mapped: number | null = null
      let matched = false

      if (guessIdx >= 0 && guessIdx < headers.length) {
        if (headers[guessIdx].trim().toLowerCase() === f.name.trim().toLowerCase()) {
          mapped = guessIdx
          matched = true
        }
      }

      if (!matched) {
        // Hledej podle jména
        const altIdx = headers.findIndex(h => h.trim().toLowerCase() === f.name.trim().toLowerCase())
        if (altIdx >= 0) {
          mapped = altIdx
          matched = true
        }
      }

      fields.push({
        id: `${tBlock.blockIndex}-${fi}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        blockIndex: tBlock.blockIndex,
        fieldName: f.name,
        required: f.required,
        originalIndexGuess: guessIdx,
        mappedSourceIndex: mapped,
        headerMatched: matched
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
 */
export function validateMapping(model: MappingModel): string[] {
  const errors: string[] = []
  for (const block of model.blocks) {
    const used = new Set<number>()
    for (const f of block.fields) {
      if (f.required && f.mappedSourceIndex === null) {
        errors.push(`Blok ${block.blockIndex}: pole '${f.fieldName}' není namapováno`)
      }
      if (f.mappedSourceIndex != null) {
        if (used.has(f.mappedSourceIndex)) {
          errors.push(`Blok ${block.blockIndex}: duplicita sloupce index ${f.mappedSourceIndex + 1} pro '${f.fieldName}'`)
        } else {
          used.add(f.mappedSourceIndex)
        }
      }
    }
    // Kapacitní kontrola – nepřesahovat počet sloupců
    const maxIdx = Math.max(-1, ...Array.from(used.values()))
    if (maxIdx >= block.headers.length) {
      errors.push(`Blok ${block.blockIndex}: index mimo rozsah (>${block.headers.length})`)
    }
  }
  return errors
}

/**
 * Export výsledného mappingu do objektu pro apply.
 * Každý blok -> { fieldName, sourceIndex }.
 */
export function exportMapping(model: MappingModel): Array<{
  blockIndex: number
  mappings: Array<{ fieldName: string; sourceIndex: number }>
}> {
  return model.blocks.map(b => ({
    blockIndex: b.blockIndex,
    mappings: b.fields
      .filter(f => f.mappedSourceIndex != null)
      .map(f => ({
        fieldName: f.fieldName,
        sourceIndex: f.mappedSourceIndex as number
      }))
  }))
}
