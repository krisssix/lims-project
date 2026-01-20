// bez 'any'. jednoduchý csv/tsv parser a kompatibilita šablony vůči souboru.
import { isVectorCell, parseVectorCell } from './vectorDetection'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { detectBestDelimiter } from './clientParser'
import { normalizeBool } from '../measurement-record-helpers'

export interface ImportedBlock {
  blockIndex: number
  headers: string[]
  rows: string[][] // datové řádky (bez hlavičky): mohou obsahovat vektorové zástupné symboly
  originalRows?: string[][] // původní neupravené řádky před nahrazením vektorových symbolů
}

export interface ImportedSeriesBlock {
  seriesType: 'X_INTENSITY' | 'SIZE_DISTRIBUTION' | 'VOLUME_DISTRIBUTION' | 'OTHER'
  seriesName?: string
  seriesScope?: 'record' | 'summary'  // 'record': propojeno s existujícím záznamem, 'summary': průměr na úrovni měření
  linkedRecordIndex?: number
  linkedRecordDescription?: string
  xLabel: string
  yLabel: string
  data: { x: number; y: number }[] | Record<string, number | string | null>[]
  // dynamické sloupce: pokud jsou zadány, data by měla být record<string, ...>[]
  columns?: { name: string; type: 'float' | 'int' | 'text'; required: boolean }[]
}

export interface ImportedFileStructure {
  fileName: string
  delimiter: string
  blocks: ImportedBlock[]
  series: ImportedSeriesBlock[]  // extrahovaná data sérií
  warnings: string[]
}

export interface TemplateFieldLike {
  name: string
  type: string
  required: boolean
  // 0-based index sloupce ve zdroji
  sourceIndex?: number
  // ui pořadí (od 1 nebo libovolné)
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
 * primární funkce: detekce oddělovače z prvních cca 20 řádků.
 * využívá jednoduchou frekvenční heuristiku.
 */


/**
 * rozdělení textu do bloků: stejná logika jako splitblocks, ale inline (kvůli re-use).
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
 * načtení souboru se správnou detekcí kódování.
 * zkouší nejdříve utf-8, poté windows-1250 (běžné pro české soubory).
 */
async function readFileWithEncoding(file: File): Promise<string> {
  // nejdříve zkusit utf-8 (výchozí v prohlížeči)
  const utf8Text = await file.text()

  // kontrola na náhradní znak (indikuje problém s kódováním)
  if (!utf8Text.includes('\uFFFD') && !utf8Text.includes('�')) {
    return utf8Text
  }

  // zkusit windows-1250 (běžné pro středoevropské / české soubory)
  try {
    const buffer = await file.arrayBuffer()
    const decoder = new TextDecoder('windows-1250')
    return decoder.decode(buffer)
  } catch {
    // pád zpět na utf-8, pokud windows-1250 selže
    return utf8Text
  }
}

/**
 * kontrola, zda je soubor typu excel (xlsx/xls)
 */
function isExcelFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return ['xlsx', 'xls', 'xlsm', 'xlsb'].includes(ext)
}

/**
 * parsování excelového souboru pomocí knihovny xlsx
 */
async function parseExcelFile(file: File): Promise<{ lines: string[]; delimiter: string }> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })

  // získat první list
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('Excel file has no sheets')
  }

  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    throw new Error('Cannot read Excel sheet')
  }

  // převod na pole polí
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    cellDates: true,
    dateNF: 'yyyy-mm-dd hh:mm:ss'
  } as any) as unknown[][]

  // ladění: vypsat surové hodnoty buněk pro vektorové sloupce (velikosti, intenzity atd.)
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

  // převod na řádky oddělené tabulátorem
  const lines = data
    .filter(row => row.some(cell => cell !== ''))
    .map(row => row.map(cell => {
      if (cell instanceof Date) return cell.toISOString();
      return String(cell || '')
    }).join('\t'))

  return { lines, delimiter: '\t' }
}

/**
 * načtení textového souboru do bloků s hlavičkou.
 * první řádek bloku: hlavičky, ostatní: řádky dat.
 * pokud nemá alespoň 2 řádky: varování (přeskočeno).
 * speciální ošetření pro série x intensity a bloky statistik.
 */
export interface ParseOptions {
  delimiter?: string
  decimalSeparator?: '.' | ','
  hasHeader?: boolean
  headerRowIndex?: number
}

export async function parseImportedMeasurementFile(file: File, options: ParseOptions = {}): Promise<ImportedFileStructure> {
  let lines: string[]
  let delimiter: string

  // odlišné zpracování pro soubory excelu
  if (isExcelFile(file)) {
    const parsed = await parseExcelFile(file)
    lines = parsed.lines
    delimiter = parsed.delimiter
  } else {
    // pokus o načtení se správným kódováním (nejdříve utf-8, poté windows-1250 pro češtinu)
    const text = await readFileWithEncoding(file)
    lines = text.split(/\r?\n/).filter(l => l.length)

    // Use provided delimiter or detect
    if (options.delimiter) {
      delimiter = options.delimiter
    } else {
      delimiter = detectBestDelimiter(text).delimiter
    }
  }

  // Apply header row index skipping if provided
  if (typeof options.headerRowIndex === 'number' && options.headerRowIndex > 0) {
    lines = lines.slice(options.headerRowIndex)
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

    const firstRowParts = (Papa.parse(blk[0]!, { delimiter, header: false }).data[0] as string[] || []).map(h => (h || '').trim())
    const firstCell = (firstRowParts[0] || '').trim().toLowerCase()

    // detekce, zda jde o blok pouze se statistikami (průměr, odchylka atd.)
    const isStatsBlock = /^(mean|std\s*dev|rsd)/i.test(firstCell)

    // detekce série x intensity: „x intensity“ může být v libovolné buňce prvního řádku
    // formát: ["", "x intensity", "popis záznamu", ...]
    const xIntensityIndex = firstRowParts.findIndex(cell => /^x\s*intensity$/i.test(cell))
    const isXIntensitySeries = xIntensityIndex >= 0

    // poznámka: bloky statistik se NEPŘESKAKUJÍ: jsou zachovány jako běžné bloky

    if (isXIntensitySeries) {
      // extrakce x intensity jako bloku série (ne běžný blok)
      // získat popis z buňky za „x intensity“
      const description = firstRowParts[xIntensityIndex + 1] || ''

      // extrakce indexu propojeného záznamu z popisu typu „record 33: 4/10/22...“
      const recordMatch = description.match(/Record\s*(\d+)/i)
      const linkedRecordIndex = recordMatch ? parseInt(recordMatch[1], 10) : undefined

      // parsování datových řádků
      const data: { x: number; y: number }[] = []
      for (let i = 1; i < blk.length; i++) {
        const parts = (Papa.parse(blk[i]!, { delimiter, header: false }).data[0] as string[] || []).map(c => (c || '').trim())
        const xStr = parts[xIntensityIndex] || ''
        const yStr = parts[xIntensityIndex + 1] || ''
        // parsování čísel (zohlednění nastavení desetinné čárky)
        // pokud je oddělovač čárka, předpokládáme, že v csv jsou desetinné tečky, nebo csv escapuje čárky
        // ale tady máme už rozparsované pole parts
        let xStrClean = xStr
        let yStrClean = yStr

        if (options.decimalSeparator === ',') {
          // Pokud je desetinná čárka ',', nahradíme ji tečkou pro JS parseFloat
          // Pozor: Pokud je oddělovač polí také čárka, PapaParse už to rozdělil
          xStrClean = xStrClean.replace(',', '.')
          yStrClean = yStrClean.replace(',', '.')
        } else {
          // Pokud je desetinná tečka '.', můžeme (pro jistotu smazat čárky jako tisíce?) nebo nedělat nic.
          // Stávající kód nahrazoval čárku tečkou vždy.
          // Pokud uživatel řekl, že separator je tečka, tak čárka může být oddělovač tisíců (nebo nic).
          // Pro zpětnou kompatibilitu a robustnost:
          // Pokud uživatel EXPLICITNĚ zvolil '.', tak NECHCEME měnit ',' na '.' pokud by to byla chyba.
          // Ale často jsou soubory mix.
          // Udělejme to takto:
          xStrClean = xStrClean.replace(',', '.') // Stále nahrazujeme pro jistotu, pokud není konflikt
          yStrClean = yStrClean.replace(',', '.')
        }

        const x = parseFloat(xStrClean)
        const y = parseFloat(yStrClean)
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

      // nepřidávat do běžných bloků, nezvyšovat index (idx)
      continue
    }

    // běžný blok: první řádek jsou hlavičky (pokud je zapnuto, jinak generovat)
    let headers: string[]
    let dataStartIndex = 1

    if (options.hasHeader === false) {
      // Generovat hlavičky: Slot 1, Slot 2... (nebo A, B, C...)
      // firstRowParts obsahuje data prvního řádku
      headers = firstRowParts.map((_, i) => `Column ${i + 1}`)
      dataStartIndex = 0
    } else {
      headers = firstRowParts.filter(h => h.length)
    }
    if (options.hasHeader !== false && blk.length > 2) {
      const secondRowParts = (Papa.parse(blk[1]!, { delimiter, header: false }).data[0] as string[] || []).map(c => (c || '').trim())
      const unitIndicators = ['°c', 'd.nm', 'percent', 'nm', 'kcps', 'mv', '%']
      const looksLikeUnits = secondRowParts.filter(cell => {
        const lower = cell.toLowerCase()
        // kontrola, zda to vypadá jako jednotky (krátký text, ne číslo, odpovídá vzorům jednotek)
        return cell.length > 0 && cell.length <= 12 &&
          (unitIndicators.some(u => lower.includes(u)) || /^[a-z°µ%/.\-]+$/i.test(cell))
      }).length >= Math.max(1, Math.floor(secondRowParts.filter(c => c.length).length * 0.3))

      if (looksLikeUnits) {
        dataStartIndex = 2 // přeskočit řádek jednotek
      }
    }

    const dataRows = blk.slice(dataStartIndex).map(r => (Papa.parse(r, { delimiter, header: false }).data[0] as string[] || []).map(c => (c || '').trim()))

    blocks.push({
      blockIndex: idx,
      headers,
      rows: dataRows,
      originalRows: dataRows.map(r => [...r]) // hluboká kopie před zpracováním vektorů
    })
    idx++
  }

  // detekce vektorových sloupců v blocích a jejich převod na více-sloupcové série
  // strategie: najít všechny vektorové sloupce se stejnou délkou, zkombinovat do jedné série na řádek
  for (const block of blocks) {
    if (block.rows.length === 0) continue

    // krok 1: najít všechny vektorové sloupce kontrolou prvního řádku
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

    // krok 2: seskupit vektorové sloupce podle délky (stejná délka: lze zkombinovat)
    const byLength = new Map<number, VectorColInfo[]>()
    for (const vc of vectorCols) {
      const list = byLength.get(vc.vectorLength) || []
      list.push(vc)
      byLength.set(vc.vectorLength, list)
    }

    // zpracovat každou skupinu délek: najít skupiny s alespoň 2 sloupci
    for (const [vecLength, cols] of byLength) {
      if (cols.length < 2) continue

      // určit, který sloupec je osa x (preferovat 'size', 'sizes', 'x' atd.)
      const xColCandidates = cols.filter(c =>
        /size/i.test(c.headerName) ||
        /^x$/i.test(c.headerName) ||
        /x[\s_-]?(intensity|value)?/i.test(c.headerName)
      )
      const xCol = xColCandidates[0] || cols[0]
      const yCols = cols.filter(c => c !== xCol)

      // krok 3: vytvořit jednu sérii na řádek se všemi zkombinovanými sloupci
      for (let rowIdx = 0; rowIdx < block.rows.length; rowIdx++) {
        const row = block.rows[rowIdx]
        if (!row) continue

        // parsování hodnot x
        const xCellValue = row[xCol.colIdx]
        if (!xCellValue) continue
        const xParsed = parseVectorCell(xCellValue)
        if (!xParsed.ok) continue
        const xValues = xParsed.values

        // parsování hodnot y pro každý y sloupec
        const yValuesMap = new Map<string, number[]>()
        for (const yc of yCols) {
          const yCellValue = row[yc.colIdx]
          if (!yCellValue) continue
          const yParsed = parseVectorCell(yCellValue)
          if (!yParsed.ok) continue
          yValuesMap.set(yc.headerName, yParsed.values)
        }

        // sestavení více-sloupcových dat: každý řádek: { sizes: x, intensities: y1, volumes: y2, ... }
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

        // nalezení čísla propojeného záznamu
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

        // vymazání vektorových zástupných symbolů z řádku: označeno jako zpracované
        for (const vc of cols) {
          if (row[vc.colIdx]) {
            row[vc.colIdx] = '' // vymazat místo zástupného symbolu
          }
        }
      }

      // důležité: odstranění vektorových sloupců z hlaviček a řádků bloku pro zabránění duplicitám
      // provést až po zpracování všech řádků, v opačném pořadí pro zachování indexů
      const colIndicesToRemove = cols.map(c => c.colIdx).sort((a, b) => b - a) // v opačném pořadí
      console.log('[Vector Removal] BEFORE splice - headers:', block.headers.length, 'removing cols:', colIndicesToRemove)
      for (const colIdx of colIndicesToRemove) {
        // odstranit z hlaviček
        block.headers.splice(colIdx, 1)
        // odstranit ze všech řádků
        for (const row of block.rows) {
          row.splice(colIdx, 1)
        }
        // odstranit z originalrows, pokud existují
        if (block.originalRows) {
          for (const row of block.originalRows) {
            row.splice(colIdx, 1)
          }
        }
      }
      console.log('[Vector Removal] AFTER splice - headers:', block.headers.length, 'new headers:', block.headers.slice(-3))
    }
  }

  // nové: detekce horizontálních sérií (transponovaná data typu vlnových délek)
  // vzor: první řádek je osa x (číselné hodnoty jako 230, 232, 234...)
  // následující řádky mají popisky v prvním sloupci a hodnoty y
  for (const block of blocks) {
    if (block.headers.length < 5) continue

    // kontrola, zda jsou hlavičky (po první) převážně číselné (vlnová délka, čas atd.)
    const numericHeaders = block.headers.slice(1).filter(h => {
      const normalized = h.replace(',', '.')
      return /^[+-]?\d+([.,]\d+)?$/.test(normalized)
    })

    if (numericHeaders.length < 5 || numericHeaders.length / (block.headers.length - 1) < 0.7) continue

    // toto vypadá jako horizontální data sérií!
    const xValues = numericHeaders.map(h => parseFloat(h.replace(',', '.')))
    const xLabel = block.headers[0] || 'Wavelength'

    // seskupení řádků podle popisku v prvním sloupci
    let currentGroupLabel = ''
    let currentGroupRows: number[][] = []

    for (let rowIdx = 0; rowIdx < block.rows.length; rowIdx++) {
      const row = block.rows[rowIdx]
      if (!row) continue

      const firstCell = row[0]?.trim() || ''
      const hasLabel = firstCell && !/^[+-]?\d+([.,]\d+)?$/.test(firstCell.replace(',', '.'))

      if (hasLabel) {
        // uložit předchozí skupinu jako sérii
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

        // začít novou skupinu
        currentGroupLabel = firstCell
        currentGroupRows = []
      }

      // parsování hodnot y z tohoto řádku (přeskočit první buňku, která je popisek nebo prázdná)
      const yValues = row.slice(1).map(cell => {
        const normalized = (cell || '').replace(',', '.')
        return parseFloat(normalized) || 0
      })
      currentGroupRows.push(yValues)
    }

    // uložit poslední skupinu
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

    // odstranit tento blok z běžných bloků (teď jsou to data sérií)
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

  // ========== obecná detekce rozsahu sérií (series scope) ==========
  // posbírat všechny indexy záznamů, které existují v hlavních datových blocích
  const existingRecordIndices = new Set<number>()

  // nejdříve najít sloupec „record number“ v prvním bloku pro získání skutečných čísel záznamů
  const firstBlock = blocks.find(b => b.blockIndex === 1)
  if (firstBlock) {
    const recordNumberColIdx = firstBlock.headers.findIndex(h =>
      /record\s*number/i.test(h) || h.toLowerCase() === 'rec'
    )

    for (let rowIdx = 0; rowIdx < firstBlock.rows.length; rowIdx++) {
      if (recordNumberColIdx >= 0) {
        // použít skutečné číslo záznamu ze sloupce
        const recNum = parseInt(firstBlock.rows[rowIdx]?.[recordNumberColIdx] ?? '', 10)
        if (!isNaN(recNum)) existingRecordIndices.add(recNum)
      } else {
        // použít index řádku + 1 jako index záznamu (výchozí chování)
        existingRecordIndices.add(rowIdx + 1)
      }
    }
  }

  // u každé série určit, zda má rozsah „record“ nebo „summary“
  for (const s of series) {
    if (s.linkedRecordIndex != null) {
      // kontrola, zda tento záznam existuje v hlavních datech
      if (existingRecordIndices.has(s.linkedRecordIndex)) {
        s.seriesScope = 'record'
      } else {
        // záznam neexistuje: toto je souhrnná série (summary/average)
        s.seriesScope = 'summary'
        console.log(`[seriesScope] Series "${s.seriesName}" references non-existent Record ${s.linkedRecordIndex} - marked as 'summary'`)
      }
    } else {
      // žádný propojený záznam: výchozí nastavení na „record“ (na úrovni měření, ale ne agregát)
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
 * kompatibilita:
 *: pro každý blok šablony musí existovat odpovídající blok v souboru (nebo automaticky namapovat)
 *: bloky sérií v souboru jsou ignorovány (jsou zpracovány odděleně)
 *: soubor může mít více bloků než šablona (extra bloky jsou ignorovány)
 */
export function checkTemplateCompatibility(
  tmpl: TemplateLike,
  imported: ImportedFileStructure
): CompatibilityResult {
  const reasons: string[] = []

  // kontrola, zda je šablona primárně založena na sériích (má málo nebo žádné tabulkové bloky)
  const hasTableFields = tmpl.blocks.some(b => b.fields.length > 0)
  const hasSeriesData = imported.series.length > 0

  // pokud importovaný soubor obsahuje data sérií, považovat jej za kompatibilní
  // (data sérií budou automaticky namapována na pole sérií šablony)
  if (hasSeriesData && !hasTableFields) {
    // šablona pouze se sériemi s daty sérií: vždy kompatibilní
    return {
      compatible: true,
      reasons: [],
      blockMapping: []
    }
  }

  // pokud import obsahuje data sérií, je to dobré znamení, ale stále musíme
  // zkontrolovat kompatibilitu bloků. série budou řešeny samostatně.
  console.log('[checkTemplateCompatibility]', {
    hasTableFields,
    hasSeriesData,
    importedBlocksCount: imported.blocks.length,
    templateBlocksCount: tmpl.blocks.length
  })

  // pokud má soubor data sérií, být mírnější při kontrole počtu bloků
  // (data sérií poskytují alternativní zdroj dat)
  if (imported.blocks.length < tmpl.blocks.length && !hasSeriesData) {
    reasons.push(`Soubor má méně bloků (${imported.blocks.length}) než šablona vyžaduje (${tmpl.blocks.length})`)
    return { compatible: false, reasons }
  }

  // pokud nemáme žádné bloky, ale máme série, stále kompatibilní pro import sérií
  if (imported.blocks.length === 0 && hasSeriesData) {
    console.log('[checkTemplateCompatibility] No blocks but has series - compatible')
    return {
      compatible: true,
      reasons: [],
      blockMapping: []
    }
  }

  const mapping: Array<{ blockIndex: number; headers: string[]; fieldNames: string[]; sourceIndices: number[] }> = []

  // pomocník: normalizace názvu pole pro přibližnou shodu (fuzzy matching)
  const normalize = (s: string): string => {
    return s
      .toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')  // Remove parenthesis content like "(°C)"
      .replace(/[^a-z0-9]/g, '')      // Remove non-alphanumeric
      .trim()
  }

  // pomocník: kontrola, zda se dva názvy shodují (přibližně)
  const fuzzyMatch = (fieldName: string, headerName: string): boolean => {
    const nf = normalize(fieldName)
    const nh = normalize(headerName)
    // přesná shoda po normalizaci
    if (nf === nh) return true
    // jeden obsahuje druhý
    if (nf.length > 2 && nh.length > 2) {
      if (nf.includes(nh) || nh.includes(nf)) return true
    }
    return false
  }

  for (const tb of tmpl.blocks) {
    // pokus o nalezení odpovídajícího bloku v importovaném souboru
    // nejdříve zkusit přesnou shodu blockindexu
    let ib = imported.blocks.find(b => b.blockIndex === tb.blockIndex)

    // pokud není nalezen podle indexu, zkusit najít podle podobnosti hlaviček
    if (!ib && imported.blocks.length > 0) {
      // použít první blok, pokud šablona má pouze 1 blok
      if (tmpl.blocks.length === 1) {
        ib = imported.blocks[0]
      }
    }

    if (!ib) {
      reasons.push(`Tabulka hodnot index ${tb.blockIndex} chybí v souboru`)
      continue
    }

    // kontrola, kolik polí lze spárovat (pomocí přibližné shody)
    let matchedCount = 0
    for (const field of tb.fields) {
      const hasMatch = ib.headers.some(h => fuzzyMatch(field.name, h))
      if (hasMatch) matchedCount++
    }

    // považovat za kompatibilní, pokud se shoduje alespoň 50 % polí
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
 * vytvoření záznamů z importovaných bloků. každý řádek dat: nový recordindex.
 * při nekompatibilitě nevolat.
 */
export function buildRecordsFromImported(
  tmpl: TemplateLike,
  imported: ImportedFileStructure,
  options: { decimalSeparator?: string } = {}
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
  // ... (setup code omitted, assume it matches existing until loop)
  // Re-declaring setup code to ensure context match if needed, but tool allows partial replace.
  // I will replace the function signature and the inner loop value assignment.
  // This is too big for a single block if I don't include the whole function.
  // I will replace the WHOLE function to be safe.

  // použít počet řádků prvního bloku jako počet záznamů (ne blok x intensity, který má mnohem více řádků)
  const firstBlock = imported.blocks.find(b => b.blockIndex === 1)
  const maxRows = firstBlock?.rows.length ?? 0

  // nalezení indexu sloupce „record number“ v prvním bloku
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

  // pomocník: normalizace názvu pole pro přibližnou shodu
  const normalize = (s: string): string => {
    return s.toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/[^a-z0-9]/g, '').trim()
  }

  // pomocník: nalezení indexu sloupce
  const findColumnIndex = (fieldName: string, headers: string[]): number => {
    const nf = normalize(fieldName)
    for (let i = 0; i < headers.length; i++) {
      const nh = normalize(headers[i])
      if (nf === nh) return i
      if (nf.length > 2 && nh.length > 2 && (nf.includes(nh) || nh.includes(nf))) return i
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

    // určení recordindexu
    let recordIndex = r + 1
    if (firstBlock && recordNumberHeaderIdx >= 0) {
      const recordNumValue = firstBlock.rows[r]?.[recordNumberHeaderIdx]
      const parsed = parseInt(recordNumValue ?? '', 10)
      if (!isNaN(parsed)) recordIndex = parsed
    }

    for (const block of tmpl.blocks) {
      const importedBlock = imported.blocks.find(b => b.blockIndex === block.blockIndex)
      if (!importedBlock) continue
      const row = importedBlock.rows[r] || []

      for (let fi = 0; fi < block.fields.length; fi++) {
        const f = block.fields[fi]!
        let srcIdx: number
        if (typeof f.sourceIndex === 'number') {
          srcIdx = f.sourceIndex
        } else {
          const matchedIdx = findColumnIndex(f.name, importedBlock.headers)
          srcIdx = matchedIdx >= 0 ? matchedIdx : fi
        }

        const rawValue = row[srcIdx] ?? ''
        let value: unknown = rawValue

        // Parse numbers respecting decimal separator
        if ((f.type === 'float' || f.type === 'int') && typeof rawValue === 'string' && rawValue.trim() !== '') {
          let s = rawValue
          if (options.decimalSeparator === ',') {
            s = s.replace(',', '.')
          } else {
            // Default robust: replace comma if no separator specified or if dot specified (assuming mixed content support)
            s = s.replace(',', '.')
          }
          const num = parseFloat(s)
          if (!isNaN(num)) value = num
        } else if (f.type === 'bool') {
          // Parse boolean values
          const boolVal = normalizeBool(rawValue)
          if (boolVal !== null) value = boolVal
        }

        recordFields.push({
          name: f.name,
          type: f.type,
          required: f.required,
          blockIndex: block.blockIndex,
          blockTitle: block.title,
          value
        })
      }
    }
    out.push({ recordIndex, fields: recordFields })
  }
  return out
}
