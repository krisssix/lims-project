/**
 * Block detection for multi-block import architecture.
 * Detects: Key-Value, Table, Series, Stats, Unknown blocks.
 */
import type { DetectedBlock, BlockType, ParseProposal } from '@/types/import-blocks'
import { generateBlockId } from '@/types/import-blocks'

// ============ CONSTANTS ============

const MIN_TABLE_ROWS = 2
const MIN_TABLE_COLS = 2
const MIN_KV_PAIRS = 3
const KV_SEPARATOR_PATTERN = /^([^:=\t]+)[:=\t]\s*(.+)$/
const STATS_KEYWORDS = ['mean', 'std', 'dev', 'rsd', 'average', 'min', 'max', 'průměr', 'odchylka']
const SERIES_MIN_TOKENS = 5
const NUMERIC_RATIO_THRESHOLD = 0.8

// ============ BLOCK DETECTION ============

/**
 * Detect blocks in text data.
 * Always returns at least 1 block (unknown fallback).
 */
export function detectBlocks(lines: string[], delimiter: string): DetectedBlock[] {
    const blocks: DetectedBlock[] = []

    // 1. Detect Key-Value blocks
    const kvBlocks = detectKVBlocks(lines)
    blocks.push(...kvBlocks)

    // 2. Detect Table blocks
    const tableBlocks = detectTableBlocks(lines, delimiter, kvBlocks)
    blocks.push(...tableBlocks)

    // 3. Detect Stats blocks
    const statsBlocks = detectStatsBlocks(lines, delimiter)
    blocks.push(...statsBlocks)

    // 4. Detect Series blocks (within tables)
    const seriesBlocks = detectSeriesBlocks(lines, delimiter, tableBlocks)
    blocks.push(...seriesBlocks)

    // 5. If no blocks found, create unknown block for whole file
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

    // Sort by startRow
    blocks.sort((a, b) => a.startRow - b.startRow)

    return blocks
}

/**
 * Detect Key-Value blocks (header metadata).
 * Pattern: "Key: Value" or "Key = Value" or "Key\tValue"
 */
function detectKVBlocks(lines: string[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []
    let kvStart: number | null = null
    let kvCount = 0

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()

        // Check if line matches KV pattern
        const isKV = KV_SEPARATOR_PATTERN.test(line) && !looksLikeTableRow(line)

        if (isKV) {
            if (kvStart === null) kvStart = i
            kvCount++
        } else {
            // End of KV block
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

    // Handle trailing KV block
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
    // Has multiple columns separated by common delimiters
    const parts = line.split(/[\t;,|]/)
    return parts.length >= 3
}

/**
 * Detect Table blocks (main data tables).
 * Looks for consistent column counts.
 */
function detectTableBlocks(lines: string[], delimiter: string, excludeBlocks: DetectedBlock[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []

    // Parse lines into cells
    const parsed: string[][] = lines.map(line => line.split(delimiter).map(c => c.trim()))

    // Track excluded ranges
    const isExcluded = (row: number) => excludeBlocks.some(b => row >= b.startRow && row <= b.endRow)

    // Find consecutive rows with similar column counts
    let tableStart: number | null = null
    let prevColCount = 0
    let consistentRows = 0

    for (let i = 0; i < parsed.length; i++) {
        if (isExcluded(i)) {
            // End current table if in excluded zone
            if (tableStart !== null && consistentRows >= MIN_TABLE_ROWS) {
                const headers = extractHeaders(parsed, tableStart, delimiter)
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

        // Skip empty or single-column rows
        if (colCount < MIN_TABLE_COLS) {
            if (tableStart !== null && consistentRows >= MIN_TABLE_ROWS) {
                const headers = extractHeaders(parsed, tableStart, delimiter)
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

        // Check column count consistency
        const isConsistent = tableStart === null || Math.abs(colCount - prevColCount) <= 2

        if (isConsistent) {
            if (tableStart === null) tableStart = i
            prevColCount = colCount
            consistentRows++
        } else {
            // Column count changed significantly - end current table
            if (tableStart !== null && consistentRows >= MIN_TABLE_ROWS) {
                const headers = extractHeaders(parsed, tableStart, delimiter)
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

    // Handle trailing table
    if (tableStart !== null && consistentRows >= MIN_TABLE_ROWS) {
        const headers = extractHeaders(parsed, tableStart, delimiter)
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

function extractHeaders(parsed: string[][], startRow: number, _delimiter: string): string[] {
    if (startRow >= parsed.length) return []
    const row = parsed[startRow]
    // Check if this looks like headers (mostly text, not numbers)
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

    // Mode column count
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
 * Detect Stats blocks (Mean, Std Dev, etc.).
 */
function detectStatsBlocks(lines: string[], _delimiter: string): DetectedBlock[] {
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

    // Handle trailing stats
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
 * Detect Series blocks (columns with vector data).
 */
function detectSeriesBlocks(lines: string[], delimiter: string, tableBlocks: DetectedBlock[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []

    for (const table of tableBlocks) {
        const parsed = lines.slice(table.startRow, table.endRow + 1)
            .map(line => line.split(delimiter).map(c => c.trim()))

        if (parsed.length < 2) continue

        // Check each column for vector-like data
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
            // Extract header names for vector columns
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

    // Also detect horizontal series (transposed data)
    const horizontalSeries = detectHorizontalSeriesBlocks(lines, delimiter, tableBlocks)
    blocks.push(...horizontalSeries)

    return blocks
}

/**
 * Detect horizontal series blocks (transposed data).
 * Pattern: First row is X-axis (e.g., wavelength 230, 232, 234...)
 * Following rows are Y-values grouped by label in first column.
 * 
 * Example:
 *   Wavel.   230    232    234    236   ...
 *   K2       0.77   0.76   0.84   0.05  ...
 *            0.21   0.32   0.04   0.35  ...
 *   (KR SLN) 0.39   0.09   0.09   0.17  ...
 *            0.17   0.13   0.11   0.13  ...
 *            ...
 */
function detectHorizontalSeriesBlocks(lines: string[], delimiter: string, tableBlocks: DetectedBlock[]): DetectedBlock[] {
    const blocks: DetectedBlock[] = []

    for (const table of tableBlocks) {
        const parsed = lines.slice(table.startRow, table.endRow + 1)
            .map(line => line.split(delimiter).map(c => c.trim()))

        if (parsed.length < 3 || parsed[0].length < 5) continue

        // Check if first row looks like X-axis (mostly numbers after first cell)
        const headerRow = parsed[0]
        const headerLabel = headerRow[0]?.toLowerCase() || ''

        // Look for wavelength-like pattern or sequential numbers in header
        const numericHeaderCells = headerRow.slice(1).filter(cell => {
            const normalized = cell.replace(',', '.')
            return /^[+-]?\d+([.,]\d+)?$/.test(normalized)
        })

        // Need at least 5 numeric values in header row to consider it X-axis
        if (numericHeaderCells.length < 5) continue

        // Check if header row has sequential/patterned numbers (wavelength, time, etc.)
        const sequentialRatio = numericHeaderCells.length / (headerRow.length - 1)
        if (sequentialRatio < 0.7) continue

        // This looks like horizontal series data!
        // Now detect the grouped series (rows with labels vs continuation rows)
        const seriesGroups: Array<{
            label: string
            startRow: number  // relative to table start
            rowCount: number
        }> = []

        let currentGroupLabel = ''
        let currentGroupStart = 1  // skip header row
        let currentRowCount = 0

        for (let r = 1; r < parsed.length; r++) {
            const row = parsed[r]
            const firstCell = row[0]?.trim() || ''

            // Check if this row starts a new group (has label in first column)
            const hasLabel = firstCell && !/^[+-]?\d+([.,]\d+)?$/.test(firstCell.replace(',', '.'))

            if (hasLabel) {
                // Save previous group if exists
                if (currentRowCount > 0) {
                    seriesGroups.push({
                        label: currentGroupLabel,
                        startRow: currentGroupStart,
                        rowCount: currentRowCount
                    })
                }
                // Start new group
                currentGroupLabel = firstCell
                currentGroupStart = r
                currentRowCount = 1
            } else {
                // Continuation row (no label = part of current group)
                currentRowCount++
            }
        }

        // Save last group
        if (currentRowCount > 0) {
            seriesGroups.push({
                label: currentGroupLabel,
                startRow: currentGroupStart,
                rowCount: currentRowCount
            })
        }

        // Create series block if we found valid groups
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
                description: `Horizontální série - X: ${headerLabel || 'index'} (${numericHeaderCells.length} bodů), skupiny: ${groupDescriptions}`,
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

    // Try multiple separators: whitespace, semicolon, tab
    // Use the one that produces the most tokens
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

// ============ PROPOSAL BUILDER ============

/**
 * Build a ParseProposal from raw data.
 */
export function buildProposal(
    rawLines: string[],
    rawGrid: string[][] | undefined,
    delimiter: string
): ParseProposal {
    const lines = rawGrid ? rawGrid.map(row => row.join(delimiter)) : rawLines
    const blocks = detectBlocks(lines, delimiter)

    // Find suggested main block (largest table by default)
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

    // Fallback to first non-kv, non-stats block
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
