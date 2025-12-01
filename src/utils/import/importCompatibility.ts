// Bez 'any'. Jednoduchý CSV/TSV parser + kompatibilita template vs file.

export interface ImportedBlock {
  blockIndex: number
  headers: string[]
  rows: string[][] // data rows (bez headeru)
}

export interface ImportedFileStructure {
  fileName: string
  delimiter: string
  blocks: ImportedBlock[]
  warnings: string[]
}

export interface TemplateFieldLike {
  name: string
  type: string
  required: boolean
  // 0-based index sloupce ve zdroji
  sourceIndex?: number
  // UI pořadí (1-based nebo libovolné)
  orderIndex: number
}

export interface TemplateBlockLike {
  blockIndex: number
  title: string
  fields: TemplateFieldLike[]
}

export interface TemplateLike {
  name: string
  deviceId: string
  blocks: TemplateBlockLike[]
}

export interface CompatibilityResult {
  compatible: boolean
  reasons: string[]
  blockMapping?: Array<{
    blockIndex: number
    headers: string[]
    fieldNames: string[]
    sourceIndices: number[]
  }>
}

/**
 * Primární funkce: detekce delimiteru z prvních ~20 řádků.
 * Využívá jednoduchou frekvenční heuristiku.
 */
function detectDelimiterFromLines(lines: string[]): string {
  const candidates = ['\t', ';', ',', '|']
  const score: Record<string, number> = {}
  for (const c of candidates) score[c] = 0
  for (const line of lines.slice(0, 20)) {
    for (const c of candidates) {
      const parts = line.split(c)
      // penalizace extrémně malého počtu
      if (parts.length > 1) score[c] += 1
    }
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : ','
}

/**
 * Rozdělení textu do bloků – stejná logika jako splitBlocks, ale inline (kvůli re-use).
 */
function splitIntoBlocksRaw(lines: string[]): string[][] {
  const out: string[][] = []
  let current: string[] = []
  for (const l of lines) {
    if (l.trim() === '' || /^#{3,}$/.test(l.trim())) {
      if (current.length) {
        out.push(current)
        current = []
      }
      continue
    }
    current.push(l)
  }
  if (current.length) out.push(current)
  return out
}

/**
 * Načtení textového souboru do bloků s hlavičkou.
 * První řádek bloku = headers, ostatní = řádky dat.
 * Pokud blok nemá aspoň 2 řádky → warning (přeskočen).
 */
export function parseImportedMeasurementFile(file: File): Promise<ImportedFileStructure> {
  return file.text().then(text => {
    const lines = text.split(/\r?\n/).filter(l => l.length)
    const delimiter = detectDelimiterFromLines(lines)
    const rawBlocks = splitIntoBlocksRaw(lines)

    const blocks: ImportedBlock[] = []
    const warnings: string[] = []
    let idx = 1
    for (const blk of rawBlocks) {
      if (blk.length < 2) {
        warnings.push(`Blok ${idx} má méně než 2 řádky – přeskočeno.`)
        idx++
        continue
      }
      const headers = blk[0]!.split(delimiter).map(h => h.trim()).filter(h => h.length)
      const dataRows = blk.slice(1).map(r => r.split(delimiter).map(c => c.trim()))
      blocks.push({
        blockIndex: idx,
        headers,
        rows: dataRows
      })
      idx++
    }

    return {
      fileName: file.name,
      delimiter,
      blocks,
      warnings
    }
  })
}

/**
 * Striktní kompatibilita:
 * - Stejný počet bloků
 * - Každý block má stejně fieldů jako headerů
 * - Pro každý field: (sourceIndex||pořadí) odpovídá pozici v headeru a jméno (case-insensitive) se rovná
 */
export function checkTemplateCompatibility(
  tmpl: TemplateLike,
  imported: ImportedFileStructure
): CompatibilityResult {
  const reasons: string[] = []
  if (tmpl.blocks.length !== imported.blocks.length) {
    reasons.push(`Počet bloků šablony (${tmpl.blocks.length}) != v souboru (${imported.blocks.length})`)
    return { compatible: false, reasons }
  }

  const mapping: Array<{ blockIndex: number; headers: string[]; fieldNames: string[]; sourceIndices: number[] }> = []

  for (const tb of tmpl.blocks) {
    const ib = imported.blocks.find(b => b.blockIndex === tb.blockIndex)
    if (!ib) {
      reasons.push(`Blok index ${tb.blockIndex} chybí v souboru`)
      continue
    }
    if (tb.fields.length !== ib.headers.length) {
      reasons.push(`Blok ${tb.blockIndex}: počet polí (${tb.fields.length}) != počet hlaviček (${ib.headers.length})`)
      continue
    }

    const lowerHeaders = ib.headers.map(h => h.toLowerCase().trim())
    for (let fi = 0; fi < tb.fields.length; fi++) {
      const field = tb.fields[fi]!
      const srcIdx = typeof field.sourceIndex === 'number' ? field.sourceIndex : fi
      if (srcIdx < 0 || srcIdx >= ib.headers.length) {
        reasons.push(`Blok ${tb.blockIndex}: field '${field.name}' má sourceIndex ${srcIdx} mimo rozsah`)
        break
      }
      const headerAtPos = lowerHeaders[srcIdx]
      if (headerAtPos !== field.name.toLowerCase().trim()) {
        reasons.push(`Blok ${tb.blockIndex}: mismatch '${field.name}' != '${ib.headers[srcIdx]}' na pozici ${srcIdx + 1}`)
        break
      }
    }

    mapping.push({
      blockIndex: tb.blockIndex,
      headers: ib.headers,
      fieldNames: tb.fields.map(f => f.name),
      sourceIndices: tb.fields.map((f, i) => (typeof f.sourceIndex === 'number' ? f.sourceIndex : i))
    })
  }

  const compatible = reasons.length === 0
  return { compatible, reasons, blockMapping: mapping }
}

/**
 * Vytvoření záznamů z importovaných bloků. Každý řádek dat = nový recordIndex.
 * Při nekompatibilitě NEVOLAT.
 */
export function buildRecordsFromImported(
  tmpl: TemplateLike,
  imported: ImportedFileStructure
): Array<{
  recordIndex: number
  fields: Array<{
    name: string
    type: string
    required: boolean
    blockIndex: number
    blockTitle: string
    value: unknown
  }>
}> {
  // Každý blok může mít N řádků – spojením podle max délky
  const maxRows = Math.max(...imported.blocks.map(b => b.rows.length), 0)
  const out: Array<{ recordIndex: number; fields: Array<{
      name: string
      type: string
      required: boolean
      blockIndex: number
      blockTitle: string
      value: unknown
    }> }> = []

  for (let r = 0; r < maxRows; r++) {
    const recordFields: Array<{
      name: string
      type: string
      required: boolean
      blockIndex: number
      blockTitle: string
      value: unknown
    }> = []
    for (const block of tmpl.blocks) {
      const importedBlock = imported.blocks.find(b => b.blockIndex === block.blockIndex)
      if (!importedBlock) continue
      const row = importedBlock.rows[r] || []
      for (let fi = 0; fi < block.fields.length; fi++) {
        const f = block.fields[fi]!
        const srcIdx = typeof f.sourceIndex === 'number' ? f.sourceIndex : fi
        const rawValue = row[srcIdx] ?? ''
        recordFields.push({
          name: f.name,
          type: f.type,
          required: f.required,
          blockIndex: block.blockIndex,
          blockTitle: block.title,
          value: rawValue
        })
      }
    }
    out.push({ recordIndex: r + 1, fields: recordFields })
  }
  return out
}
