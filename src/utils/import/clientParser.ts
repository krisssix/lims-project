/**
 * Client-side CSV/TSV parser with robust fallback handling.
 * Uses PapaParse for tokenization + custom heuristics for status determination.
 */
import Papa from 'papaparse'

// ============ TYPES ============

export type ParseStatus = 'SUCCESS' | 'PARTIAL' | 'FAIL'

export interface ParseOptions {
    delimiter: 'auto' | ',' | ';' | '\t' | '|'
    decimal: 'auto' | '.' | ','
    header: 'auto' | 'no_header' | number
    skipEmptyLines: boolean
}

export interface ParseMetrics {
    rowWidthMode: number
    inconsistentRowWidthRate: number
    singleColumnRate: number
    totalRows: number
    totalCols: number
}

export interface ParseResult {
    status: ParseStatus
    reasons: string[]
    headers: string[]
    rows: string[][]
    usedDelimiter: string
    usedHeaderRow: number | null
    usedDecimal: string
    metrics: ParseMetrics
}

export type InferredType = 'int' | 'float' | 'bool' | 'date' | 'text'

// ============ CONSTANTS ============

const DELIMITER_CANDIDATES = ['\t', ';', ',', '|'] as const
const MAX_SAMPLE_ROWS = 50
const MAX_COLS = 200
const MAX_CELL_LENGTH = 20000

// ============ DELIMITER SCORING ============

interface DelimiterScore {
    delimiter: string
    avgCols: number
    consistency: number // 0-1, how consistent column counts are
    singleColumnRate: number // 0-1, rate of single-column rows
    score: number
}

function scoreDelimiter(lines: string[], delimiter: string): DelimiterScore {
    const sampleLines = lines.slice(0, MAX_SAMPLE_ROWS).filter(l => l.trim())
    if (!sampleLines.length) {
        return { delimiter, avgCols: 0, consistency: 0, singleColumnRate: 1, score: 0 }
    }

    const colCounts: number[] = []
    let singleColCount = 0

    for (const line of sampleLines) {
        // Use Papa for proper quoted field handling
        const result = Papa.parse(line, { delimiter })
        const cols = (result.data[0] as string[]) || []
        const validCols = cols.filter(c => c !== undefined)
        colCounts.push(validCols.length)
        if (validCols.length <= 1) singleColCount++
    }

    // Calculate mode (most common column count)
    const countFreq = new Map<number, number>()
    for (const c of colCounts) {
        countFreq.set(c, (countFreq.get(c) || 0) + 1)
    }
    let mode = 1
    let maxFreq = 0
    for (const [count, freq] of countFreq) {
        if (freq > maxFreq) {
            maxFreq = freq
            mode = count
        }
    }

    const avgCols = colCounts.reduce((a, b) => a + b, 0) / colCounts.length
    const consistentCount = colCounts.filter(c => c === mode).length
    const consistency = consistentCount / colCounts.length
    const singleColumnRate = singleColCount / colCounts.length

    // Score: prefer more columns, high consistency, low single-column rate
    const score = avgCols * consistency * (1 - singleColumnRate * 0.5)

    return { delimiter, avgCols, consistency, singleColumnRate, score }
}

function detectBestDelimiter(text: string): { delimiter: string; score: DelimiterScore } {
    const lines = text.split(/\r?\n/).filter(l => l.trim())

    const scores = DELIMITER_CANDIDATES.map(d => scoreDelimiter(lines, d))
    scores.sort((a, b) => b.score - a.score)

    return { delimiter: scores[0]?.delimiter || ',', score: scores[0]! }
}

// ============ HEADER DETECTION ============

function isJunkRow(cells: string[]): boolean {
    // All empty or separator-only
    return cells.every(c => !c || !c.trim())
}

function isNumericOrDateRow(cells: string[]): boolean {
    if (!cells.length) return false
    const validCells = cells.filter(c => c && c.trim())
    if (!validCells.length) return true // All empty = junk, treated elsewhere

    let numericCount = 0
    for (const cell of validCells) {
        const trimmed = cell.trim().replace(',', '.')
        // Check if numeric (including scientific notation)
        if (/^[+-]?(\d+\.?\d*|\d*\.?\d+)(e[+-]?\d+)?$/i.test(trimmed)) {
            numericCount++
        }
        // Check if date-like
        else if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(trimmed)) {
            numericCount++
        }
    }

    return numericCount / validCells.length > 0.7
}

function detectHeaderRow(rows: string[][], option: ParseOptions['header']): number | null {
    if (option === 'no_header') return null
    if (typeof option === 'number') return option

    // auto: find first non-junk, non-numeric row
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i]
        if (!row || isJunkRow(row)) continue
        if (!isNumericOrDateRow(row)) {
            return i
        }
    }

    // No suitable header found
    return null
}

// ============ TYPE INFERENCE ============

export function inferColumnType(samples: string[]): InferredType {
    const validSamples = samples.filter(s => s && s.trim()).slice(0, 50)
    if (!validSamples.length) return 'text'

    let ints = 0
    let floats = 0
    let bools = 0
    let dates = 0

    for (const s of validSamples) {
        const t = s.trim()

        // Date patterns
        if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(t)) {
            dates++
            continue
        }

        // Boolean
        if (/^(true|false|1|0|yes|no|ano|ne)$/i.test(t)) {
            bools++
            continue
        }

        // Integer
        if (/^[+-]?\d+$/.test(t)) {
            ints++
            continue
        }

        // Float (both . and , as decimal)
        const normalized = t.replace(',', '.')
        if (/^[+-]?(\d+\.?\d*|\d*\.?\d+)(e[+-]?\d+)?$/i.test(normalized)) {
            floats++
            continue
        }
    }

    const threshold = validSamples.length * 0.6
    if (dates >= threshold) return 'date'
    if (bools >= threshold) return 'bool'
    if (ints >= threshold && floats === 0) return 'int'
    if (ints + floats >= threshold) return 'float'
    return 'text'
}

export function inferColumnTypes(rows: string[][]): InferredType[] {
    if (!rows.length) return []

    const colCount = Math.max(...rows.map(r => r.length))
    const types: InferredType[] = []

    for (let col = 0; col < colCount; col++) {
        const samples = rows.map(r => r[col] || '').slice(0, MAX_SAMPLE_ROWS)
        types.push(inferColumnType(samples))
    }

    return types
}

// ============ COLUMN NAME GENERATION ============

export function generateColumnNames(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `Column ${i + 1}`)
}

// ============ DECIMAL CONVERSION ============

function normalizeDecimal(value: string, decimal: 'auto' | '.' | ','): string {
    if (decimal === '.') return value
    if (decimal === ',') return value.replace(',', '.')

    // Auto: prefer comma as decimal if it looks like "123,45" pattern
    if (/^\d+,\d+$/.test(value.trim())) {
        return value.replace(',', '.')
    }
    return value
}

// ============ MAIN PARSE FUNCTION ============

export function parseWithOptions(text: string, opts: ParseOptions): ParseResult {
    const reasons: string[] = []

    // Normalize line endings
    const normalizedText = text
        .replace(/\uFEFF/g, '') // BOM
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')

    // Detect delimiter
    let usedDelimiter: string
    if (opts.delimiter === 'auto') {
        const { delimiter, score } = detectBestDelimiter(normalizedText)
        usedDelimiter = delimiter
        if (score.consistency < 0.7) {
            reasons.push('Nízká konzistence počtu sloupců')
        }
        if (score.singleColumnRate > 0.5) {
            reasons.push('Mnoho řádků má jen 1 sloupec')
        }
    } else {
        usedDelimiter = opts.delimiter
    }

    // Parse with PapaParse
    const parseResult = Papa.parse<string[]>(normalizedText, {
        delimiter: usedDelimiter,
        skipEmptyLines: opts.skipEmptyLines,
        header: false
    })

    let allRows = parseResult.data

    // Limit columns for performance
    allRows = allRows.map(row => row.slice(0, MAX_COLS).map(cell =>
        typeof cell === 'string' && cell.length > MAX_CELL_LENGTH
            ? cell.slice(0, MAX_CELL_LENGTH)
            : String(cell || '')
    ))

    // Skip leading junk rows
    let startIdx = 0
    while (startIdx < allRows.length && isJunkRow(allRows[startIdx])) {
        startIdx++
    }
    allRows = allRows.slice(startIdx)

    // Detect header row
    const headerRowIdx = detectHeaderRow(allRows, opts.header)
    const usedHeaderRow = headerRowIdx

    let headers: string[] = []
    let dataRows: string[][] = []

    if (headerRowIdx !== null && headerRowIdx < allRows.length) {
        headers = allRows[headerRowIdx].map(h => (h || '').trim())
        dataRows = allRows.slice(headerRowIdx + 1)
    } else {
        // No header - use all rows as data
        dataRows = allRows
        // Generate column names based on max columns
        const maxCols = Math.max(...dataRows.map(r => r.length), 0)
        headers = generateColumnNames(maxCols)
    }

    // Filter empty headers
    headers = headers.filter(h => h)

    // Calculate metrics
    const colCounts = dataRows.map(r => r.length)
    const countFreq = new Map<number, number>()
    for (const c of colCounts) {
        countFreq.set(c, (countFreq.get(c) || 0) + 1)
    }
    let rowWidthMode = 0
    let maxFreq = 0
    for (const [count, freq] of countFreq) {
        if (freq > maxFreq) {
            maxFreq = freq
            rowWidthMode = count
        }
    }

    const inconsistentCount = colCounts.filter(c => c !== rowWidthMode).length
    const inconsistentRowWidthRate = dataRows.length ? inconsistentCount / dataRows.length : 0
    const singleColumnCount = colCounts.filter(c => c <= 1).length
    const singleColumnRate = dataRows.length ? singleColumnCount / dataRows.length : 0

    const metrics: ParseMetrics = {
        rowWidthMode,
        inconsistentRowWidthRate,
        singleColumnRate,
        totalRows: dataRows.length,
        totalCols: headers.length
    }

    // Determine status
    let status: ParseStatus = 'SUCCESS'

    if (headers.length === 0) {
        status = 'FAIL'
        reasons.push('Žádná pole nebyla rozpoznána')
    } else if (dataRows.length === 0) {
        status = 'PARTIAL'
        reasons.push('Žádné datové řádky')
    } else {
        if (inconsistentRowWidthRate > 0.2) {
            status = 'PARTIAL'
            reasons.push('Nekonzistentní počet sloupců')
        }
        if (singleColumnRate > 0.8) {
            status = 'FAIL'
            reasons.push('Delimiter nejspíš špatně')
        }
    }

    // Decimal handling
    const usedDecimal = opts.decimal === 'auto' ? '.' : opts.decimal

    return {
        status,
        reasons,
        headers,
        rows: dataRows.slice(0, MAX_SAMPLE_ROWS), // Limit for preview
        usedDelimiter,
        usedHeaderRow,
        usedDecimal,
        metrics
    }
}

// ============ DEFAULT OPTIONS ============

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
    delimiter: 'auto',
    decimal: 'auto',
    header: 'auto',
    skipEmptyLines: true
}
