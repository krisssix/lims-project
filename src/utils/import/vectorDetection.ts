/**
 * Vector cell detection for data series identification.
 * A vector cell contains multiple numeric values separated by whitespace.
 */

// ============ TYPES ============

export interface VectorColumn {
    columnIndex: number
    vectorLength: number
    samples: number[][]
}

export interface VectorParseResult {
    ok: boolean
    values: number[]
    reason?: string
}

// ============ CONSTANTS ============

const MIN_VECTOR_TOKENS = 5
const NUMERIC_RATIO_THRESHOLD = 0.8
const MAX_CELL_LENGTH = 20000
const MIN_CONSISTENT_ROWS = 2

// ============ NUMERIC PARSING ============

/**
 * Parse a single numeric token, supporting:
 * - Decimal with . or ,
 * - Negative numbers
 * - Scientific notation (E+03, e-2)
 * - Thousands separators (partially)
 */
function parseNumericToken(token: string): number | null {
    const trimmed = token.trim()
    if (!trimmed) return null

    // Normalize: replace comma with dot for decimal
    // Handle cases like "1,234" as 1.234 (not thousand separator)
    let normalized = trimmed

    // If both , and . exist, assume , is thousands separator
    if (normalized.includes(',') && normalized.includes('.')) {
        normalized = normalized.replace(/,/g, '')
    } else {
        // Replace comma with dot
        normalized = normalized.replace(',', '.')
    }

    // Try parsing
    const num = parseFloat(normalized)
    if (Number.isFinite(num)) {
        return num
    }

    return null
}

// ============ VECTOR CELL DETECTION ============

/**
 * Check if a cell value looks like a vector (≥5 numeric tokens).
 * Supports multiple separators: spaces, tabs, semicolons.
 * Guardrails:
 * - Max cell length for performance
 * - Numeric ratio check
 */
export function isVectorCell(value: string): boolean {
    if (!value || typeof value !== 'string') return false
    if (value.length > MAX_CELL_LENGTH) return false

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

    if (bestTokens.length < MIN_VECTOR_TOKENS) return false

    // Check numeric ratio
    let numericCount = 0
    for (const token of bestTokens) {
        if (parseNumericToken(token) !== null) {
            numericCount++
        }
    }

    const ratio = numericCount / bestTokens.length
    return ratio >= NUMERIC_RATIO_THRESHOLD
}

/**
 * Parse a vector cell into an array of numbers.
 * Supports multiple separators: spaces, tabs, semicolons.
 * Never throws - returns { ok: false, reason } on failure.
 */
export function parseVectorCell(value: string): VectorParseResult {
    if (!value || typeof value !== 'string') {
        return { ok: false, values: [], reason: 'Empty or invalid value' }
    }

    if (value.length > MAX_CELL_LENGTH) {
        return { ok: false, values: [], reason: 'Cell too long' }
    }

    const trimmed = value.trim()
    if (!trimmed) {
        return { ok: false, values: [], reason: 'Empty value' }
    }

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

    const values: number[] = []
    let failedCount = 0

    for (const token of bestTokens) {
        const num = parseNumericToken(token)
        if (num !== null) {
            values.push(num)
        } else {
            failedCount++
        }
    }

    // Allow some tolerance for non-numeric tokens
    if (values.length < MIN_VECTOR_TOKENS) {
        return { ok: false, values: [], reason: `Too few numeric values (${values.length})` }
    }

    const ratio = values.length / bestTokens.length
    if (ratio < NUMERIC_RATIO_THRESHOLD) {
        return { ok: false, values: [], reason: `Low numeric ratio (${(ratio * 100).toFixed(0)}%)` }
    }

    return { ok: true, values }
}

// ============ COLUMN DETECTION ============

/**
 * Detect which columns contain vector data.
 * Requires consistent vector length across multiple rows.
 */
export function detectVectorColumns(rows: string[][]): VectorColumn[] {
    if (!rows || rows.length < MIN_CONSISTENT_ROWS) return []

    const colCount = Math.max(...rows.map(r => r.length))
    const candidates: VectorColumn[] = []

    for (let col = 0; col < colCount; col++) {
        const samples: number[][] = []
        let vectorLengths: number[] = []

        for (const row of rows.slice(0, 10)) { // Sample first 10 rows
            const cell = row[col]
            if (!cell) continue

            const parseResult = parseVectorCell(cell)
            if (parseResult.ok) {
                samples.push(parseResult.values)
                vectorLengths.push(parseResult.values.length)
            }
        }

        // Need at least MIN_CONSISTENT_ROWS valid vectors
        if (samples.length < MIN_CONSISTENT_ROWS) continue

        // Check length consistency
        const lengthMode = findMode(vectorLengths)
        const consistentCount = vectorLengths.filter(l => l === lengthMode).length
        if (consistentCount < MIN_CONSISTENT_ROWS) continue

        candidates.push({
            columnIndex: col,
            vectorLength: lengthMode,
            samples
        })
    }

    return candidates
}

/**
 * Find paired vector columns (same vector length) for X/Y series.
 * Returns [xColumnIndex, yColumnIndex] or null if no pair found.
 */
export function findPairedVectors(vectors: VectorColumn[]): [number, number] | null {
    if (vectors.length < 2) return null

    // Group by vector length
    const byLength = new Map<number, VectorColumn[]>()
    for (const v of vectors) {
        const list = byLength.get(v.vectorLength) || []
        list.push(v)
        byLength.set(v.vectorLength, list)
    }

    // Find first group with at least 2 columns
    for (const [, group] of byLength) {
        if (group.length >= 2) {
            // Return first two columns as X and Y
            return [group[0].columnIndex, group[1].columnIndex]
        }
    }

    return null
}

// ============ HELPERS ============

function findMode(arr: number[]): number {
    const freq = new Map<number, number>()
    for (const n of arr) {
        freq.set(n, (freq.get(n) || 0) + 1)
    }

    let mode = arr[0] || 0
    let maxFreq = 0
    for (const [val, count] of freq) {
        if (count > maxFreq) {
            maxFreq = count
            mode = val
        }
    }

    return mode
}

// ============ UTILITY: Check if any vectors exist in data ============

export function hasVectorCells(rows: string[][]): boolean {
    return detectVectorColumns(rows).length > 0
}
