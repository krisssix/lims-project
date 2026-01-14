// Bez 'any'. Jednoduchý CSV/TSV parser + kompatibilita template vs file.
import { isVectorCell, parseVectorCell } from './vectorDetection'
import * as XLSX from 'xlsx'

export interface ImportedBlock {
  blockIndex: number
  headers: string[]
  rows: string[][] // data rows (bez headeru) - may have vector placeholders
  originalRows?: string[][] // original unmodified rows before vector placeholder replacement
}

export interface ImportedSeriesBlock {
  seriesType: 'X_INTENSITY' | 'SIZE_DISTRIBUTION' | 'VOLUME_DISTRIBUTION' | 'OTHER'
  seriesName?: string
  seriesScope?: 'record' | 'summary'  // 'record' = linked to existing record, 'summary' = measurement-level average
  linkedRecordIndex?: number
  linkedRecordDescription?: string
  xLabel: string
  yLabel: string
  data: { x: number; y: number }[] | Record<string, number | string | null>[]
  // Dynamic columns - if provided, data should be Record<string, ...>[]
  columns?: { name: string; type: 'float' | 'int' | 'text'; required: boolean }[]
}

export interface ImportedFileStructure {
  fileName: string
  delimiter: string
  blocks: ImportedBlock[]
  series: ImportedSeriesBlock[]  // NEW: extracted series data
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
 * Read file with proper encoding detection.
 * Tries UTF-8 first, then Windows-1250 (common for Czech files).
 */
async function readFileWithEncoding(file: File): Promise<string> {
  // First, try UTF-8 (browser default)
  const utf8Text = await file.text()

  // Check for replacement character (indicates encoding issue)
  if (!utf8Text.includes('\uFFFD') && !utf8Text.includes('�')) {
    return utf8Text
  }

  // Try Windows-1250 (common for Central European / Czech files)
  try {
    const buffer = await file.arrayBuffer()
    const decoder = new TextDecoder('windows-1250')
    return decoder.decode(buffer)
  } catch {
    // Fallback to UTF-8 if windows-1250 fails
    return utf8Text
  }
}

/**
 * Check if file is an Excel file (XLSX/XLS)
 */
function isExcelFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return ['xlsx', 'xls', 'xlsm', 'xlsb'].includes(ext)
}

/**
 * Parse Excel file using XLSX library
 */
async function parseExcelFile(file: File): Promise<{ lines: string[]; delimiter: string }> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })

  // Get the first sheet
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('Excel file has no sheets')
  }

  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    throw new Error('Cannot read Excel sheet')
  }

  // Convert to array of arrays
  const data: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false // Get string values
  }) as string[][]

  // Debug: Log raw cell values for vector columns (Sizes, Intensities, etc.)
  if (data.length > 0) {
    const headers = data[0] || []
    const vectorColIndices: number[] = []
    headers.forEach((h, i) => {
      if (/sizes|intensities|volumes|numbers/i.test(String(h))) {
        vectorColIndices.push(i)
      }
    })
    if (vectorColIndices.length > 0 && data.length > 1) {
      console.log('[XLSX Debug] Found vector column headers at indices:', vectorColIndices.map(i => ({ idx: i, name: headers[i] })))
      console.log('[XLSX Debug] First data row vector cells:')
      for (const colIdx of vectorColIndices) {
        const cellValue = data[1]?.[colIdx]
        console.log(`  Column ${colIdx} (${headers[colIdx]}):`, typeof cellValue, 'length:', String(cellValue || '').length, 'preview:', String(cellValue || '').substring(0, 80))
      }
    }
  }

  // Convert to tab-separated lines
  const lines = data
    .filter(row => row.some(cell => cell !== ''))
    .map(row => row.map(cell => String(cell || '')).join('\t'))

  return { lines, delimiter: '\t' }
}

/**
 * Načtení textového souboru do bloků s hlavičkou.
 * První řádek bloku = headers, ostatní = řádky dat.
 * Pokud  nemá aspoň 2 řádky → warning (přeskočen).
 * Special handling for X Intensity series and stats blocks.
 */
export async function parseImportedMeasurementFile(file: File): Promise<ImportedFileStructure> {
  let lines: string[]
  let delimiter: string

  // Handle Excel files differently
  if (isExcelFile(file)) {
    const parsed = await parseExcelFile(file)
    lines = parsed.lines
    delimiter = parsed.delimiter
  } else {
    // Try to read with proper encoding (UTF-8 first, fallback to Windows-1250 for Czech)
    const text = await readFileWithEncoding(file)
    lines = text.split(/\r?\n/).filter(l => l.length)
    delimiter = detectDelimiterFromLines(lines)
  }

  const rawBlocks = splitIntoBlocksRaw(lines)

  const blocks: ImportedBlock[] = []
  const series: ImportedSeriesBlock[] = []
  const warnings: string[] = []
  let idx = 1
  for (const blk of rawBlocks) {
    if (blk.length < 2) {
      warnings.push(`Tabulka hodnot ${idx} má méně než 2 řádky – přeskočeno.`)
      idx++
      continue
    }

    const firstRowParts = blk[0]!.split(delimiter).map(h => h.trim())
    const firstCell = (firstRowParts[0] || '').trim().toLowerCase()

    // Detect if this is a stats-only block (Mean, Std Dev, RSD)
    const isStatsBlock = /^(mean|std\s*dev|rsd)/i.test(firstCell)

    // Detect X Intensity series - "X Intensity" can be in ANY cell of the first row
    // Format: ["", "X Intensity", "Record description", ...]
    const xIntensityIndex = firstRowParts.findIndex(cell => /^x\s*intensity$/i.test(cell))
    const isXIntensitySeries = xIntensityIndex >= 0

    // Note: Stats blocks are NOT skipped - they are preserved as regular blocks

    if (isXIntensitySeries) {
      // Extract X Intensity as a SERIES block (not regular block)
      // Get the description from the cell after "X Intensity"
      const description = firstRowParts[xIntensityIndex + 1] || ''

      // Extract linked record index from description like "Record 33: 4/10/22..."
      const recordMatch = description.match(/Record\s*(\d+)/i)
      const linkedRecordIndex = recordMatch ? parseInt(recordMatch[1], 10) : undefined

      // Parse data rows
      const data: { x: number; y: number }[] = []
      for (let i = 1; i < blk.length; i++) {
        const parts = blk[i]!.split(delimiter).map(c => c.trim())
        const xStr = parts[xIntensityIndex] || ''
        const yStr = parts[xIntensityIndex + 1] || ''
        // Parse numbers (handle European decimal comma)
        const x = parseFloat(xStr.replace(',', '.'))
        const y = parseFloat(yStr.replace(',', '.'))
        if (!isNaN(x) && !isNaN(y)) {
          data.push({ x, y })
        }
      }

      series.push({
        seriesType: 'X_INTENSITY',
        seriesName: 'X Intensity',
        linkedRecordIndex,
        linkedRecordDescription: description || undefined,
        xLabel: 'X Intensity',
        yLabel: 'Intensity',
        data,
        columns: [
          { name: 'X Intensity', type: 'float', required: true },
          { name: 'Intensity', type: 'float', required: true }
        ]
      })

      // Don't add to regular blocks, don't increment idx
      continue
    }

    // Normal block - first row is headers
    const headers = firstRowParts.filter(h => h.length)

    // Check if second row is a unit row (contains °C, d.nm, Percent, etc.)
    let dataStartIndex = 1
    if (blk.length > 2) {
      const secondRowParts = blk[1]!.split(delimiter).map(c => c.trim())
      const unitIndicators = ['°c', 'd.nm', 'percent', 'nm', 'kcps', 'mv', '%']
      const looksLikeUnits = secondRowParts.filter(cell => {
        const lower = cell.toLowerCase()
        // Check if it's a unit-like value (short text, not a number, matches unit patterns)
        return cell.length > 0 && cell.length <= 12 &&
          (unitIndicators.some(u => lower.includes(u)) || /^[a-z°µ%/.\-]+$/i.test(cell))
      }).length >= Math.max(1, Math.floor(secondRowParts.filter(c => c.length).length * 0.3))

      if (looksLikeUnits) {
        dataStartIndex = 2 // Skip the unit row
      }
    }

    const dataRows = blk.slice(dataStartIndex).map(r => r.split(delimiter).map(c => c.trim()))

    blocks.push({
      blockIndex: idx,
      headers,
      rows: dataRows,
      originalRows: dataRows.map(r => [...r]) // deep copy before vector processing
    })
    idx++
  }

  // NEW: Detect vector columns in blocks and convert to MULTI-COLUMN series
  // Strategy: Find all vector columns with the same length, combine into one series per row
  for (const block of blocks) {
    if (block.rows.length === 0) continue

    // Step 1: Find all vector columns by checking first row
    interface VectorColInfo {
      colIdx: number
      headerName: string
      vectorLength: number
    }
    const vectorCols: VectorColInfo[] = []

    console.log('[Vector Detection] Block headers:', block.headers)
    console.log('[Vector Detection] First row sample:', block.rows[0]?.slice(0, 5))

    for (let colIdx = 0; colIdx < block.headers.length; colIdx++) {
      const headerName = block.headers[colIdx] || `Column ${colIdx + 1}`
      const sampleCell = block.rows[0]?.[colIdx]

      if (!sampleCell) continue

      const isVector = isVectorCell(sampleCell)
      if (headerName.toLowerCase().includes('sizes') ||
        headerName.toLowerCase().includes('intensities') ||
        headerName.toLowerCase().includes('volumes') ||
        headerName.toLowerCase().includes('numbers')) {
        console.log(`[Vector Detection] Column ${colIdx} "${headerName}": cell length=${sampleCell.length}, isVector=${isVector}`)
        console.log(`[Vector Detection] Cell preview:`, sampleCell.substring(0, 100))
      }

      if (!isVector) continue

      const parseResult = parseVectorCell(sampleCell)
      if (!parseResult.ok) continue

      vectorCols.push({ colIdx, headerName, vectorLength: parseResult.values.length })
    }

    console.log('[Vector Detection] Found vector columns:', vectorCols.length, vectorCols.map(c => c.headerName))

    // If no vector columns or only one, skip (need at least 2 for meaningful series)
    if (vectorCols.length < 2) continue

    // Step 2: Group vector columns by length (same length = can be combined)
    const byLength = new Map<number, VectorColInfo[]>()
    for (const vc of vectorCols) {
      const list = byLength.get(vc.vectorLength) || []
      list.push(vc)
      byLength.set(vc.vectorLength, list)
    }

    // Process each length group - find groups with at least 2 columns
    for (const [vecLength, cols] of byLength) {
      if (cols.length < 2) continue

      // Determine which column is X axis (prefer 'size', 'sizes', 'x', etc.)
      const xColCandidates = cols.filter(c =>
        /size/i.test(c.headerName) ||
        /^x$/i.test(c.headerName) ||
        /x[\s_-]?(intensity|value)?/i.test(c.headerName)
      )
      const xCol = xColCandidates[0] || cols[0]
      const yCols = cols.filter(c => c !== xCol)

      // Step 3: Create one series per row with all columns combined
      for (let rowIdx = 0; rowIdx < block.rows.length; rowIdx++) {
        const row = block.rows[rowIdx]
        if (!row) continue

        // Parse X values
        const xCellValue = row[xCol.colIdx]
        if (!xCellValue) continue
        const xParsed = parseVectorCell(xCellValue)
        if (!xParsed.ok) continue
        const xValues = xParsed.values

        // Parse Y values for each Y column
        const yValuesMap = new Map<string, number[]>()
        for (const yc of yCols) {
          const yCellValue = row[yc.colIdx]
          if (!yCellValue) continue
          const yParsed = parseVectorCell(yCellValue)
          if (!yParsed.ok) continue
          yValuesMap.set(yc.headerName, yParsed.values)
        }

        // Build multi-column data: each row = { Sizes: x, Intensities: y1, Volumes: y2, ... }
        const data: Record<string, number | string | null>[] = []
        for (let i = 0; i < xValues.length; i++) {
          const dataRow: Record<string, number | string | null> = {
            [xCol.headerName]: xValues[i]
          }
          for (const [yColName, yVals] of yValuesMap) {
            dataRow[yColName] = yVals[i] ?? null
          }
          data.push(dataRow)
        }

        // Find linked record number
        const recNumColIdx = block.headers.findIndex(h =>
          /record[\s_-]*number/i.test(h) || h.toLowerCase() === 'rec'
        )
        let linkedRecordIndex = rowIdx + 1
        if (recNumColIdx >= 0) {
          const recNum = parseInt(row[recNumColIdx] ?? '', 10)
          if (!isNaN(recNum)) linkedRecordIndex = recNum
        }

        // Build columns array
        const columns = [
          { name: xCol.headerName, type: 'float' as const, required: true },
          ...yCols.map(yc => ({ name: yc.headerName, type: 'float' as const, required: false }))
        ]

        series.push({
          seriesType: 'SIZE_DISTRIBUTION',
          seriesName: `DLS Data`,
          linkedRecordIndex,
          linkedRecordDescription: `Record ${linkedRecordIndex}`,
          xLabel: xCol.headerName,
          yLabel: yCols.map(c => c.headerName).join(', '),
          data,
          columns
        })

        // Clear vector placeholders from row - mark as processed
        for (const vc of cols) {
          if (row[vc.colIdx]) {
            row[vc.colIdx] = '' // Clear instead of placeholder
          }
        }
      }

      // IMPORTANT: Remove vector columns from block headers and rows to prevent duplication
      // Do this AFTER processing all rows, in reverse order to preserve indices
      const colIndicesToRemove = cols.map(c => c.colIdx).sort((a, b) => b - a) // reverse order
      console.log('[Vector Removal] BEFORE splice - headers:', block.headers.length, 'removing cols:', colIndicesToRemove)
      for (const colIdx of colIndicesToRemove) {
        // Remove from headers
        block.headers.splice(colIdx, 1)
        // Remove from all rows
        for (const row of block.rows) {
          row.splice(colIdx, 1)
        }
        // Remove from originalRows if exists
        if (block.originalRows) {
          for (const row of block.originalRows) {
            row.splice(colIdx, 1)
          }
        }
      }
      console.log('[Vector Removal] AFTER splice - headers:', block.headers.length, 'new headers:', block.headers.slice(-3))
    }
  }

  // NEW: Detect horizontal series (transposed data like wavelength readings)
  // Pattern: First row is X-axis (numeric values like 230, 232, 234...)
  // Following rows have labels in first column and Y-values
  for (const block of blocks) {
    if (block.headers.length < 5) continue

    // Check if headers (after first) are mostly numeric (wavelength, time, etc.)
    const numericHeaders = block.headers.slice(1).filter(h => {
      const normalized = h.replace(',', '.')
      return /^[+-]?\d+([.,]\d+)?$/.test(normalized)
    })

    if (numericHeaders.length < 5 || numericHeaders.length / (block.headers.length - 1) < 0.7) continue

    // This looks like horizontal series data!
    const xValues = numericHeaders.map(h => parseFloat(h.replace(',', '.')))
    const xLabel = block.headers[0] || 'Wavelength'

    // Group rows by label in first column
    let currentGroupLabel = ''
    let currentGroupRows: number[][] = []

    for (let rowIdx = 0; rowIdx < block.rows.length; rowIdx++) {
      const row = block.rows[rowIdx]
      if (!row) continue

      const firstCell = row[0]?.trim() || ''
      const hasLabel = firstCell && !/^[+-]?\d+([.,]\d+)?$/.test(firstCell.replace(',', '.'))

      if (hasLabel) {
        // Save previous group as series
        if (currentGroupLabel && currentGroupRows.length > 0) {
          for (let i = 0; i < currentGroupRows.length; i++) {
            const yValues = currentGroupRows[i] || []
            const seriesName = currentGroupRows.length === 1
              ? currentGroupLabel
              : `${currentGroupLabel} ${i + 1}`

            series.push({
              seriesType: 'OTHER',
              seriesName,
              linkedRecordIndex: rowIdx + 1,
              linkedRecordDescription: seriesName,
              xLabel,
              yLabel: seriesName,
              data: xValues.map((x, xi) => ({
                x,
                y: yValues[xi] ?? 0
              })),
              columns: [
                { name: xLabel, type: 'float', required: true },
                { name: seriesName, type: 'float', required: true }
              ]
            })
          }
        }

        // Start new group
        currentGroupLabel = firstCell
        currentGroupRows = []
      }

      // Parse Y values from this row (skip first cell which is label or empty)
      const yValues = row.slice(1).map(cell => {
        const normalized = (cell || '').replace(',', '.')
        return parseFloat(normalized) || 0
      })
      currentGroupRows.push(yValues)
    }

    // Save last group
    if (currentGroupLabel && currentGroupRows.length > 0) {
      for (let i = 0; i < currentGroupRows.length; i++) {
        const yValues = currentGroupRows[i] || []
        const seriesName = currentGroupRows.length === 1
          ? currentGroupLabel
          : `${currentGroupLabel} ${i + 1}`

        series.push({
          seriesType: 'OTHER',
          seriesName,
          xLabel,
          yLabel: seriesName,
          data: xValues.map((x, xi) => ({
            x,
            y: yValues[xi] ?? 0
          })),
          columns: [
            { name: xLabel, type: 'float', required: true },
            { name: seriesName, type: 'float', required: true }
          ]
        })
      }
    }

    // Remove this block from regular blocks (it's now series data)
    const blockIdx = blocks.indexOf(block)
    if (blockIdx >= 0) {
      blocks.splice(blockIdx, 1)
    }
  }

  console.log('[parseImportedMeasurementFile] Result:', {
    fileName: file.name,
    blocksCount: blocks.length,
    seriesCount: series.length,
    blockDetails: blocks.map(b => ({ idx: b.blockIndex, headers: b.headers.slice(0, 3), rows: b.rows.length }))
  })

  // ========== GENERIC SERIES SCOPE DETECTION ==========
  // Collect all record indices that exist in main data blocks
  const existingRecordIndices = new Set<number>()

  // First, find the "Record Number" column in the first block to get actual record numbers
  const firstBlock = blocks.find(b => b.blockIndex === 1)
  if (firstBlock) {
    const recordNumberColIdx = firstBlock.headers.findIndex(h =>
      /record\s*number/i.test(h) || h.toLowerCase() === 'rec'
    )

    for (let rowIdx = 0; rowIdx < firstBlock.rows.length; rowIdx++) {
      if (recordNumberColIdx >= 0) {
        // Use actual record number from column
        const recNum = parseInt(firstBlock.rows[rowIdx]?.[recordNumberColIdx] ?? '', 10)
        if (!isNaN(recNum)) existingRecordIndices.add(recNum)
      } else {
        // Use row index + 1 as record index (default behavior)
        existingRecordIndices.add(rowIdx + 1)
      }
    }
  }

  // For each series, determine if it's 'record' or 'summary' scope
  for (const s of series) {
    if (s.linkedRecordIndex != null) {
      // Check if this record exists in main data
      if (existingRecordIndices.has(s.linkedRecordIndex)) {
        s.seriesScope = 'record'
      } else {
        // Record doesn't exist - this is a summary/average series
        s.seriesScope = 'summary'
        console.log(`[seriesScope] Series "${s.seriesName}" references non-existent Record ${s.linkedRecordIndex} - marked as 'summary'`)
      }
    } else {
      // No linked record - default to 'record' (measurement-level but not aggregate)
      s.seriesScope = 'record'
    }
  }

  return {
    fileName: file.name,
    delimiter,
    blocks,
    series,
    warnings
  }
}

/**
 * Kompatibilita:
 * - Pro každý block šablony musí existovat odpovídající block v souboru (NEBO automaticky namapovat)
 * - Series bloky v souboru jsou ignorovány (jsou zpracovány odděleně)
 * - File může mít VÍC bloků než šablona (extra bloky jsou ignorovány)
 */
export function checkTemplateCompatibility(
  tmpl: TemplateLike,
  imported: ImportedFileStructure
): CompatibilityResult {
  const reasons: string[] = []

  // Check if template is primarily series-based (has few or empty table blocks)
  const hasTableFields = tmpl.blocks.some(b => b.fields.length > 0)
  const hasSeriesData = imported.series.length > 0

  // If imported file has series data, consider it compatible
  // (series data will be mapped to template series fields automatically)
  if (hasSeriesData && !hasTableFields) {
    // Series-only template with series data = always compatible
    return {
      compatible: true,
      reasons: [],
      blockMapping: []
    }
  }

  // If imported has series data, that's a good sign but we still need to
  // check block compatibility. Series will be handled separately.
  console.log('[checkTemplateCompatibility]', {
    hasTableFields,
    hasSeriesData,
    importedBlocksCount: imported.blocks.length,
    templateBlocksCount: tmpl.blocks.length
  })

  // If file has series data, be more lenient with block count check
  // (series data provides alternative data source)
  if (imported.blocks.length < tmpl.blocks.length && !hasSeriesData) {
    reasons.push(`Soubor má méně bloků (${imported.blocks.length}) než šablona vyžaduje (${tmpl.blocks.length})`)
    return { compatible: false, reasons }
  }

  // If we have no blocks but have series, still compatible for series import
  if (imported.blocks.length === 0 && hasSeriesData) {
    console.log('[checkTemplateCompatibility] No blocks but has series - compatible')
    return {
      compatible: true,
      reasons: [],
      blockMapping: []
    }
  }

  const mapping: Array<{ blockIndex: number; headers: string[]; fieldNames: string[]; sourceIndices: number[] }> = []

  // Helper: normalize field name for fuzzy matching
  const normalize = (s: string): string => {
    return s
      .toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')  // Remove parenthesis content like "(°C)"
      .replace(/[^a-z0-9]/g, '')      // Remove non-alphanumeric
      .trim()
  }

  // Helper: check if two names match (fuzzy)
  const fuzzyMatch = (fieldName: string, headerName: string): boolean => {
    const nf = normalize(fieldName)
    const nh = normalize(headerName)
    // Exact match after normalization
    if (nf === nh) return true
    // One contains the other
    if (nf.length > 2 && nh.length > 2) {
      if (nf.includes(nh) || nh.includes(nf)) return true
    }
    return false
  }

  for (const tb of tmpl.blocks) {
    // Try to find a matching block in the imported file
    // First, try exact blockIndex match
    let ib = imported.blocks.find(b => b.blockIndex === tb.blockIndex)

    // If not found by index, try to find by header similarity
    if (!ib && imported.blocks.length > 0) {
      // Use the first block if template only has 1 block
      if (tmpl.blocks.length === 1) {
        ib = imported.blocks[0]
      }
    }

    if (!ib) {
      reasons.push(`Tabulka hodnot index ${tb.blockIndex} chybí v souboru`)
      continue
    }

    // Check how many fields can be matched (using fuzzy matching)
    let matchedCount = 0
    for (const field of tb.fields) {
      const hasMatch = ib.headers.some(h => fuzzyMatch(field.name, h))
      if (hasMatch) matchedCount++
    }

    // Consider compatible if at least 50% of fields match
    const matchThreshold = Math.max(1, Math.floor(tb.fields.length * 0.5))
    if (matchedCount < matchThreshold) {
      reasons.push(`Tabulka hodnot ${tb.blockIndex}: málo shodných polí (${matchedCount}/${tb.fields.length})`)
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
  // Use the FIRST block's row count as the number of records (not X Intensity block which has many more rows)
  const firstBlock = imported.blocks.find(b => b.blockIndex === 1)
  const maxRows = firstBlock?.rows.length ?? 0

  // Find the "Record Number" column index in the first block
  const recordNumberHeaderIdx = firstBlock?.headers.findIndex(h =>
    /record\s*number/i.test(h)
  ) ?? -1

  const out: Array<{
    recordIndex: number; fields: Array<{
      name: string
      type: string
      required: boolean
      blockIndex: number
      blockTitle: string
      value: unknown
    }>
  }> = []
  // Helper: normalize field name for fuzzy matching (same as in checkTemplateCompatibility)
  const normalize = (s: string): string => {
    return s
      .toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')  // Remove parenthesis content like "(°C)"
      .replace(/[^a-z0-9]/g, '')      // Remove non-alphanumeric
      .trim()
  }

  // Helper: find column index by fuzzy name matching
  const findColumnIndex = (fieldName: string, headers: string[]): number => {
    const nf = normalize(fieldName)
    for (let i = 0; i < headers.length; i++) {
      const nh = normalize(headers[i])
      if (nf === nh) return i
      // One contains the other
      if (nf.length > 2 && nh.length > 2) {
        if (nf.includes(nh) || nh.includes(nf)) return i
      }
    }
    return -1
  }

  for (let r = 0; r < maxRows; r++) {
    const recordFields: Array<{
      name: string
      type: string
      required: boolean
      blockIndex: number
      blockTitle: string
      value: unknown
    }> = []

    // Determine recordIndex from Record Number column or fallback to r+1
    let recordIndex = r + 1
    if (firstBlock && recordNumberHeaderIdx >= 0) {
      const recordNumValue = firstBlock.rows[r]?.[recordNumberHeaderIdx]
      const parsed = parseInt(recordNumValue ?? '', 10)
      if (!isNaN(parsed)) {
        recordIndex = parsed
      }
    }

    for (const block of tmpl.blocks) {
      const importedBlock = imported.blocks.find(b => b.blockIndex === block.blockIndex)
      if (!importedBlock) continue
      const row = importedBlock.rows[r] || []

      for (let fi = 0; fi < block.fields.length; fi++) {
        const f = block.fields[fi]!

        // Get source index: explicit > find by name > fallback to field index
        let srcIdx: number
        if (typeof f.sourceIndex === 'number') {
          srcIdx = f.sourceIndex
        } else {
          // Try to find by header name matching
          const matchedIdx = findColumnIndex(f.name, importedBlock.headers)
          srcIdx = matchedIdx >= 0 ? matchedIdx : fi
        }

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
    out.push({ recordIndex, fields: recordFields })
  }
  return out
}
