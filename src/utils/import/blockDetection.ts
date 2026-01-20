/**
 * detekce bloků pro multi-blokovou importní architekturu.
 * detekuje: klíč-hodnota, tabulku, série, statistiky, neznámé bloky.
 */
import type { DetectedBlock, ParseProposal } from '@/types/import-blocks'
import { generateBlockId } from '@/types/import-blocks'

// ============ konstanty ============

const MIN_TABLE_ROWS = 2
const MIN_TABLE_COLS = 2
const MIN_KV_PAIRS = 3
const KV_SEPARATOR_PATTERN = /^([^:=\t]+)[:=\t]\s*(.+)$/
const STATS_KEYWORDS = ['mean', 'std', 'dev', 'rsd', 'average', 'min', 'max', 'průměr', 'odchylka']
const SERIES_MIN_TOKENS = 5
const NUMERIC_RATIO_THRESHOLD = 0.8

// ============ detekce bloků ============

/**
 * detekce bloků v textových datech.
 * vždy vrací alespoň 1 blok (pád zpět na neznámý blok).
 */
export function detectBlocks(lines: string[], delimiter: string): DetectedBlock[] {
    const blocks: DetectedBlock[] = []

    // 1. detekce bloků klíč:hodnota (kv blocks)
    const kvBlocks = detectKVBlocks(lines)
    blocks.push(...kvBlocks)

    // 2. detekce tabulkových bloků
    const tableBlocks = detectTableBlocks(lines, delimiter, kvBlocks)
    blocks.push(...tableBlocks)

    // 3. detekce bloků statistik
    const statsBlocks = detectStatsBlocks(lines)
    blocks.push(...statsBlocks)

    // 4. detekce sérií (uvnitř tabulek)
    const seriesBlocks = detectSeriesBlocks(lines, delimiter, tableBlocks)
    blocks.push(...seriesBlocks)

    // 5. pokud nejsou nalezeny žádné bloky, vytvořit neznámý blok pro celý soubor
    if (blocks.length === 0) {
        blocks.push({
            id: generateBlockId(),
            type: 'unknown',
            startRow: 0,
            endRow: lines.length - 1,
            confidence: 0.1,
            description: 'Celý soubor (nerozpoznáno)'
        })
    }

    // seřazení podle startrow (počátečního řádku)
    blocks.sort((a, b) => a.startRow - b.startRow)

    return blocks
}

/**
 * detekce bloků klíč:hodnota (metadata hlavičky).
 * vzor: „klíč: hodnota“ nebo „klíč = hodnota“ nebo „klíč\thodnota“
 */
function detectKVBlocks(lines: string[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []
    let kvStart: number | null = null
    let kvCount = 0

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()

        // kontrola, zda řádek odpovídá vzoru kv (klíč:hodnota)
        const isKV = KV_SEPARATOR_PATTERN.test(line) && !looksLikeTableRow(line)

        if (isKV) {
            if (kvStart === null) kvStart = i
            kvCount++
        } else {
            // konec kv bloku
            if (kvStart !== null && kvCount >= MIN_KV_PAIRS) {
                blocks.push({
                    id: generateBlockId(),
                    type: 'kv',
                    startRow: kvStart,
                    endRow: i - 1,
                    confidence: 0.7 + Math.min(kvCount / 20, 0.2),
                    description: `Metadata (${kvCount} párů)`
                })
            }
            kvStart = null
            kvCount = 0
        }
    }

    // obsluha kv bloku na konci souboru
    if (kvStart !== null && kvCount >= MIN_KV_PAIRS) {
        blocks.push({
            id: generateBlockId(),
            type: 'kv',
            startRow: kvStart,
            endRow: lines.length - 1,
            confidence: 0.7 + Math.min(kvCount / 20, 0.2),
            description: `Metadata (${kvCount} párů)`
        })
    }

    return blocks
}

function looksLikeTableRow(line: string): boolean {
    // má více sloupců oddělených běžnými oddělovači
    const parts = line.split(/[\t;,|]/)
    return parts.length >= 3
}

/**
 * detekce tabulkových bloků (hlavní datové tabulky).
 * hledá konzistentní počty sloupců.
 */
function detectTableBlocks(lines: string[], delimiter: string, excludeBlocks: DetectedBlock[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []

    // rozklad řádků na buňky
    const parsed: string[][] = lines.map(line => line.split(delimiter).map(c => c.trim()))

    // sledování vyloučených rozsahů
    const isExcluded = (row: number) => excludeBlocks.some(b => row >= b.startRow && row <= b.endRow)

    // hledání po sobě jdoucích řádků s podobným počtem sloupců
    let tableStart: number | null = null
    let prevColCount = 0
    let consistentRows = 0

    for (let i = 0; i < parsed.length; i++) {
        if (isExcluded(i)) {
            // ukončení aktuální tabulky, pokud jsme ve vyloučené zóně
            if (tableStart !== null && consistentRows >= MIN_TABLE_ROWS) {
                const headers = extractHeaders(parsed, tableStart)
                const colCount = prevColCount
                blocks.push({
                    id: generateBlockId(),
                    type: 'table',
                    startRow: tableStart,
                    endRow: i - 1,
                    columnCount: colCount,
                    confidence: calculateTableConfidence(parsed, tableStart, i - 1),
                    description: `Tabulka (${i - tableStart} řádků × ${colCount} sloupců)`,
                    headers,
                    sampleRows: parsed.slice(tableStart + 1, Math.min(tableStart + 6, i))
                })
            }
            tableStart = null
            consistentRows = 0
            continue
        }

        const row = parsed[i]
        const colCount = row.filter(c => c).length

        // přeskočení prázdných řádků nebo řádků s jedním sloupcem
        if (colCount < MIN_TABLE_COLS) {
            if (tableStart !== null && consistentRows >= MIN_TABLE_ROWS) {
                const headers = extractHeaders(parsed, tableStart)
                blocks.push({
                    id: generateBlockId(),
                    type: 'table',
                    startRow: tableStart,
                    endRow: i - 1,
                    columnCount: prevColCount,
                    confidence: calculateTableConfidence(parsed, tableStart, i - 1),
                    description: `Tabulka (${i - tableStart} řádků × ${prevColCount} sloupců)`,
                    headers,
                    sampleRows: parsed.slice(tableStart + 1, Math.min(tableStart + 6, i))
                })
            }
            tableStart = null
            consistentRows = 0
            continue
        }

        // kontrola konzistence počtu sloupců
        const isConsistent = tableStart === null || Math.abs(colCount - prevColCount) <= 2

        if (isConsistent) {
            if (tableStart === null) tableStart = i
            prevColCount = colCount
            consistentRows++
        } else {
            // počet sloupců se výrazně změnil: ukončení aktuální tabulky
            if (tableStart !== null && consistentRows >= MIN_TABLE_ROWS) {
                const headers = extractHeaders(parsed, tableStart)
                blocks.push({
                    id: generateBlockId(),
                    type: 'table',
                    startRow: tableStart,
                    endRow: i - 1,
                    columnCount: prevColCount,
                    confidence: calculateTableConfidence(parsed, tableStart, i - 1),
                    description: `Tabulka (${i - tableStart} řádků × ${prevColCount} sloupců)`,
                    headers,
                    sampleRows: parsed.slice(tableStart + 1, Math.min(tableStart + 6, i))
                })
            }
            tableStart = i
            prevColCount = colCount
            consistentRows = 1
        }
    }

    // obsluha tabulky na konci souboru
    if (tableStart !== null && consistentRows >= MIN_TABLE_ROWS) {
        const headers = extractHeaders(parsed, tableStart)
        blocks.push({
            id: generateBlockId(),
            type: 'table',
            startRow: tableStart,
            endRow: lines.length - 1,
            columnCount: prevColCount,
            confidence: calculateTableConfidence(parsed, tableStart, lines.length - 1),
            description: `Tabulka (${lines.length - tableStart} řádků × ${prevColCount} sloupců)`,
            headers,
            sampleRows: parsed.slice(tableStart + 1, Math.min(tableStart + 6, lines.length))
        })
    }

    return blocks
}

function extractHeaders(parsed: string[][], startRow: number): string[] {
    if (startRow >= parsed.length) return []
    const row = parsed[startRow]
    // kontrola, zda to vypadá jako hlavičky (převážně text, ne čísla)
    const numericCount = row.filter(c => /^\d+([.,]\d+)?$/.test(c.trim())).length
    if (numericCount / row.length < 0.5) {
        return row.map(c => c.trim()).filter(c => c)
    }
    return []
}

function calculateTableConfidence(parsed: string[][], startRow: number, endRow: number): number {
    if (endRow <= startRow) return 0.3

    const rows = parsed.slice(startRow, endRow + 1)
    const colCounts = rows.map(r => r.filter(c => c).length)

    // nejčastější počet sloupců (tzv. mode)
    const countFreq = new Map<number, number>()
    for (const c of colCounts) {
        countFreq.set(c, (countFreq.get(c) || 0) + 1)
    }
    let modeCount = 0
    let modeFreq = 0
    for (const [count, freq] of countFreq) {
        if (freq > modeFreq) {
            modeFreq = freq
            modeCount = count
        }
    }

    const consistentRatio = modeFreq / rows.length
    const colFactor = Math.min(modeCount / 10, 1)
    const rowFactor = Math.min(rows.length / 20, 1)

    return 0.3 + (consistentRatio * 0.4) + (colFactor * 0.15) + (rowFactor * 0.15)
}

/**
 * detekce bloků statistik (průměr, směrodatná odchylka atd.).
 */
function detectStatsBlocks(lines: string[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []
    let statsStart: number | null = null
    let statsCount = 0

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase()
        const isStats = STATS_KEYWORDS.some(kw => line.includes(kw))

        if (isStats) {
            if (statsStart === null) statsStart = i
            statsCount++
        } else if (statsStart !== null) {
            if (statsCount >= 1) {
                blocks.push({
                    id: generateBlockId(),
                    type: 'stats',
                    startRow: statsStart,
                    endRow: i - 1,
                    confidence: 0.7,
                    description: `Statistiky (${statsCount} řádků)`
                })
            }
            statsStart = null
            statsCount = 0
        }
    }

    // obsluha statistik na konci souboru
    if (statsStart !== null && statsCount >= 1) {
        blocks.push({
            id: generateBlockId(),
            type: 'stats',
            startRow: statsStart,
            endRow: lines.length - 1,
            confidence: 0.7,
            description: `Statistiky (${statsCount} řádků)`
        })
    }

    return blocks
}

/**
 * detekce bloků sérií (sloupce s vektorovými daty).
 */
function detectSeriesBlocks(lines: string[], delimiter: string, tableBlocks: DetectedBlock[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []

    for (const table of tableBlocks) {
        const parsed = lines.slice(table.startRow, table.endRow + 1)
            .map(line => line.split(delimiter).map(c => c.trim()))

        if (parsed.length < 2) continue

        // kontrola každého sloupce na přítomnost vektorových dat
        const colCount = Math.max(...parsed.map(r => r.length))
        const vectorCols: number[] = []
        const headerRow = parsed[0] || []

        for (let col = 0; col < colCount; col++) {
            let vectorCount = 0
            for (let row = 1; row < Math.min(parsed.length, 10); row++) {
                const cell = parsed[row]?.[col] || ''
                if (isVectorCell(cell)) vectorCount++
            }
            if (vectorCount >= 2) vectorCols.push(col)
        }

        if (vectorCols.length >= 2) {
            // extrakce názvů hlaviček pro vektorové sloupce
            const vectorHeaders = vectorCols.map(colIdx => headerRow[colIdx] || `Sloupec ${colIdx + 1}`)

            console.log('[detectSeriesBlocks] Found vector columns:', vectorCols, 'headers:', vectorHeaders)

            blocks.push({
                id: generateBlockId(),
                type: 'series',
                startRow: table.startRow,
                endRow: table.endRow,
                columnCount: vectorCols.length,
                confidence: 0.85,
                description: `Datová série (${vectorHeaders.join(', ')})`,
                headers: vectorHeaders,
                vectorColumnIndices: vectorCols
            })
        }
    }

    // také detekovat horizontální série (transponovaná data)
    const horizontalSeries = detectHorizontalSeriesBlocks(lines, delimiter, tableBlocks)
    blocks.push(...horizontalSeries)

    return blocks
}

/**
 * detekce bloků horizontálních sérií (transponovaná data).
 * vzor: první řádek je osa x (např. vlnová délka 230, 232, 234...)
 * následující řádky jsou hodnoty y seskupené podle popisku v prvním sloupci.
 * 
 * příklad:
 *   vln. d.  230    232    234    236   ...
 *   k2       0.77   0.76   0.84   0.05  ...
 *            0.21   0.32   0.04   0.35  ...
 *   (kr sln) 0.39   0.09   0.09   0.17  ...
 *            0.17   0.13   0.11   0.13  ...
 *            ...
 */
function detectHorizontalSeriesBlocks(lines: string[], delimiter: string, tableBlocks: DetectedBlock[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []

    for (const table of tableBlocks) {
        const parsed = lines.slice(table.startRow, table.endRow + 1)
            .map(line => line.split(delimiter).map(c => c.trim()))

        if (parsed.length < 3 || parsed[0].length < 5) continue

        // kontrola, zda první řádek vypadá jako osa x (převážně čísla po první buňce)
        const headerRow = parsed[0]
        const headerLabel = headerRow[0]?.toLowerCase() || ''

        // hledání vzoru vlnové délky nebo sekvenčních čísel v hlavičce
        const numericHeaderCells = headerRow.slice(1).filter(cell => {
            const normalized = cell.replace(',', '.')
            return /^[+-]?\d+([.,]\d+)?$/.test(normalized)
        })

        // pro uvážení osy x je potřeba alespoň 5 číselných hodnot v řádku hlavičky
        if (numericHeaderCells.length < 5) continue

        // kontrola, zda řádek hlavičky obsahuje sekvenční:vzorovaná čísla (vlnová délka, čas atd.)
        const sequentialRatio = numericHeaderCells.length / (headerRow.length - 1)
        if (sequentialRatio < 0.7) continue

        // toto vypadá jako horizontální data sérií:
        // nyní detekovat seskupené série (řádky s popisky versus pokračující řádky)
        const seriesGroups: Array<{
            label: string
            startRow: number  // relativní k začátku tabulky
            rowCount: number
        }> = []

        let currentGroupLabel = ''
        let currentGroupStart = 1  // přeskočit řádek hlavičky
        let currentRowCount = 0

        for (let r = 1; r < parsed.length; r++) {
            const row = parsed[r]
            const firstCell = row[0]?.trim() || ''

            // kontrola, zda tento řádek začíná novou skupinu (má popisek v prvním sloupci)
            const hasLabel = firstCell && !/^[+-]?\d+([.,]\d+)?$/.test(firstCell.replace(',', '.'))

            if (hasLabel) {
                // uložit předchozí skupinu, pokud existuje
                if (currentRowCount > 0) {
                    seriesGroups.push({
                        label: currentGroupLabel,
                        startRow: currentGroupStart,
                        rowCount: currentRowCount
                    })
                }
                // začít novou skupinu
                currentGroupLabel = firstCell
                currentGroupStart = r
                currentRowCount = 1
            } else {
                // pokračující řádek (bez popisku: součást aktuální skupiny)
                currentRowCount++
            }
        }

        // uložit poslední skupinu
        if (currentRowCount > 0) {
            seriesGroups.push({
                label: currentGroupLabel,
                startRow: currentGroupStart,
                rowCount: currentRowCount
            })
        }

        // vytvořit blok série, pokud jsme našli platné skupiny
        if (seriesGroups.length > 0) {
            const groupDescriptions = seriesGroups
                .map(g => `${g.label || 'bez názvu'} (${g.rowCount} ${g.rowCount === 1 ? 'řádek' : 'řádky'})`)
                .join(', ')

            blocks.push({
                id: generateBlockId(),
                type: 'series',
                startRow: table.startRow,
                endRow: table.endRow,
                columnCount: numericHeaderCells.length,
                confidence: 0.85,
                description: `Horizontální série: X: ${headerLabel || 'index'} (${numericHeaderCells.length} bodů), skupiny: ${groupDescriptions}`,
                headers: [headerLabel || 'X', ...seriesGroups.map(g => g.label)],
                horizontalSeries: {
                    xAxisRow: 0,
                    xAxisLabel: headerLabel,
                    xValues: numericHeaderCells.map(v => parseFloat(v.replace(',', '.'))),
                    groups: seriesGroups
                }
            })
        }
    }

    return blocks
}

function isVectorCell(value: string): boolean {
    if (!value || value.length > 20000) return false
    const trimmed = value.trim()
    if (!trimmed) return false

    // pokus o více oddělovačů: mezery, středník, tabulátor
    // použije se ten, který vytvoří nejvíce tokenů
    const separators = [/\s+/, /;/, /\t/]
    let bestTokens: string[] = []

    for (const sep of separators) {
        const tokens = trimmed.split(sep).filter(t => t.trim().length > 0)
        if (tokens.length > bestTokens.length) {
            bestTokens = tokens
        }
    }

    if (bestTokens.length < SERIES_MIN_TOKENS) return false

    let numericCount = 0
    for (const token of bestTokens) {
        const normalized = token.replace(',', '.')
        if (/^[+-]?(\d+\.?\d*|\d*\.?\d+)(e[+-]?\d+)?$/i.test(normalized)) {
            numericCount++
        }
    }

    return numericCount / bestTokens.length >= NUMERIC_RATIO_THRESHOLD
}

// ============ tvůrce návrhů (proposal builder) ============

/**
 * vytvoření návrhu parsování (parseproposal) z hrubých dat.
 */
export function buildProposal(
    rawLines: string[],
    rawGrid: string[][] | undefined,
    delimiter: string
): ParseProposal {
    const lines = rawGrid ? rawGrid.map(row => row.join(delimiter)) : rawLines
    const blocks = detectBlocks(lines, delimiter)

    // vyhledání navrhovaného hlavního bloku (standardně největší tabulka)
    let suggestedMainBlock: string | null = null
    let maxRows = 0
    for (const block of blocks) {
        if (block.type === 'table') {
            const rows = block.endRow - block.startRow + 1
            if (rows > maxRows) {
                maxRows = rows
                suggestedMainBlock = block.id
            }
        }
    }

    // pád zpět na první blok, který není kv nebo stats
    if (!suggestedMainBlock) {
        const fallback = blocks.find(b => b.type !== 'kv' && b.type !== 'stats')
        suggestedMainBlock = fallback?.id || blocks[0]?.id || null
    }

    return {
        blocks,
        suggestedMainBlock,
        rawKind: rawGrid ? 'grid' : 'text',
        rawLines: rawGrid ? undefined : rawLines,
        rawGrid
    }
}
