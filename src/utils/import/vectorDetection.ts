/**
 * detekce vektorových buněk pro identifikaci datových sérií.
 * vektorová buňka obsahuje více číselných hodnot oddělených mezerami.
 */

// ============ typy ============

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

// ============ konstanty ============

const MIN_VECTOR_TOKENS = 5
const NUMERIC_RATIO_THRESHOLD = 0.8
const MAX_CELL_LENGTH = 20000
const MIN_CONSISTENT_ROWS = 2

// ============ parsování čísel ============

/**
 * parsování jednoho číselného tokenu, s podporou pro:
 * : desetinná čísla s . nebo ,
 * : záporná čísla
 * : vědecký zápis (e+03, e-2)
 * : oddělovače tisíců (částečně)
 */
function parseNumericToken(token: string): number | null {
    const trimmed = token.trim()
    if (!trimmed) return null

    // normalizace: nahrazení čárky tečkou pro desetinná místa
    // ošetření případů jako „1,234“ jako 1.234 (ne oddělovač tisíců)
    let normalized = trimmed

    // pokud existuje čárka i tečka, předpokládat, že čárka je oddělovač tisíců
    if (normalized.includes(',') && normalized.includes('.')) {
        normalized = normalized.replace(/,/g, '')
    } else {
        // nahradit čárku tečkou
        normalized = normalized.replace(',', '.')
    }

    // pokus o parsování
    const num = parseFloat(normalized)
    if (Number.isFinite(num)) {
        return num
    }

    return null
}

// ============ detekce vektorových buněk ============

/**
 * kontrola, zda hodnota buňky vypadá jako vektor (alespoň 5 číselných tokenů).
 * podporuje více oddělovačů: mezery, tabulátory, středníky.
 * omezení:
 * : maximální délka buňky kvůli výkonu
 * : kontrola podílu číselných hodnot
 */
export function isVectorCell(value: string): boolean {
    if (!value || typeof value !== 'string') return false
    if (value.length > MAX_CELL_LENGTH) return false

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

    if (bestTokens.length < MIN_VECTOR_TOKENS) return false

    // kontrola podílu číselných hodnot
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
 * parsování vektorové buňky do pole čísel.
 * podporuje více oddělovačů: mezery, tabulátory, středníky.
 * nikdy nevyhazuje výjimku: při selhání vrací { ok: false, reason }.
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


    for (const token of bestTokens) {
        const num = parseNumericToken(token)
        if (num !== null) {
            values.push(num)
        } else {
            // failedCount++
        }
    }

    // povolení určité tolerance pro nečíselné tokeny
    if (values.length < MIN_VECTOR_TOKENS) {
        return { ok: false, values: [], reason: `Too few numeric values (${values.length})` }
    }

    const ratio = values.length / bestTokens.length
    if (ratio < NUMERIC_RATIO_THRESHOLD) {
        return { ok: false, values: [], reason: `Low numeric ratio (${(ratio * 100).toFixed(0)}%)` }
    }

    return { ok: true, values }
}

// ============ detekce sloupců ============

/**
 * detekce, které sloupce obsahují vektorová data.
 * vyžaduje konzistentní délku vektoru napříč více řádky.
 */
export function detectVectorColumns(rows: string[][]): VectorColumn[] {
    if (!rows || rows.length < MIN_CONSISTENT_ROWS) return []

    const colCount = Math.max(...rows.map(r => r.length))
    const candidates: VectorColumn[] = []

    for (let col = 0; col < colCount; col++) {
        const samples: number[][] = []
        const vectorLengths: number[] = []

        for (const row of rows.slice(0, 10)) { // ukázka prvních 10 řádků
            const cell = row[col]
            if (!cell) continue

            const parseResult = parseVectorCell(cell)
            if (parseResult.ok) {
                samples.push(parseResult.values)
                vectorLengths.push(parseResult.values.length)
            }
        }

        // potřeba alespoň min_consistent_rows platných vektorů
        if (samples.length < MIN_CONSISTENT_ROWS) continue

        // kontrola konzistence délky
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
 * nalezení spárovaných vektorových sloupců (stejná délka vektoru) pro x/y série.
 * vrací [xcolumnindex, ycolumnindex] nebo null, pokud není nalezen žádný pár.
 */
export function findPairedVectors(vectors: VectorColumn[]): [number, number] | null {
    if (vectors.length < 2) return null

    // seskupení podle délky vektoru
    const byLength = new Map<number, VectorColumn[]>()
    for (const v of vectors) {
        const list = byLength.get(v.vectorLength) || []
        list.push(v)
        byLength.set(v.vectorLength, list)
    }

    // nalezení první skupiny s alespoň 2 sloupci
    for (const [, group] of byLength) {
        if (group.length >= 2) {
            // vrátit první dva sloupce jako x a y
            return [group[0].columnIndex, group[1].columnIndex]
        }
    }

    return null
}

// ============ pomocníci ============

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

// ============ utilita: kontrola, zda v datech existují nějaké vektory ============

export function hasVectorCells(rows: string[][]): boolean {
    return detectVectorColumns(rows).length > 0
}
