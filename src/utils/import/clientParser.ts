/**
 * csv/tsv parser na straně klienta s robustním ošetřením chyb.
 * používá papaparse pro tokenizaci a vlastní heuristiku pro určení stavu.
 */
import Papa from 'papaparse'

// ============ typy ============

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

// ============ konstanty ============

const DELIMITER_CANDIDATES = ['\t', ';', ',', '|'] as const
const MAX_SAMPLE_ROWS = 50
const MAX_COLS = 200
const MAX_CELL_LENGTH = 20000

// ============ hodnocení oddělovačů (scoring) ============

interface DelimiterScore {
    delimiter: string
    avgCols: number
    consistency: number // 0:1, jak konzistentní jsou počty sloupců
    singleColumnRate: number // 0:1, podíl řádků s jedním sloupcem
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
        // použít papa pro správné ošetření polí v uvozovkách
        const result = Papa.parse(line, { delimiter })
        const cols = (result.data[0] as string[]) || []
        const validCols = cols.filter(c => c !== undefined)
        colCounts.push(validCols.length)
        if (validCols.length <= 1) singleColCount++
    }

    // výpočet modu (nejčastější počet sloupců)
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

    // skóre: preference více sloupců, vysoké konzistence a nízkého podílu jednoho sloupce
    const score = avgCols * consistency * (1 - singleColumnRate * 0.5)

    return { delimiter, avgCols, consistency, singleColumnRate, score }
}

export function detectBestDelimiter(text: string): { delimiter: string; score: DelimiterScore } {
    const lines = text.split(/\r?\n/).filter(l => l.trim())

    const scores = DELIMITER_CANDIDATES.map(d => scoreDelimiter(lines, d))
    scores.sort((a, b) => b.score - a.score)

    return { delimiter: scores[0]?.delimiter || ',', score: scores[0]! }
}

// ============ detekce hlavičky ============

function isJunkRow(cells: string[]): boolean {
    // všechny buňky prázdné nebo obsahující pouze oddělovače
    return cells.every(c => !c || !c.trim())
}

function isNumericOrDateRow(cells: string[]): boolean {
    if (!cells.length) return false
    const validCells = cells.filter(c => c && c.trim())
    if (!validCells.length) return true // vše prázdné: smetí (junk), řešeno jinde

    let numericCount = 0
    for (const cell of validCells) {
        const trimmed = cell.trim().replace(',', '.')
        // kontrola číselných hodnot (včetně vědeckého zápisu)
        if (/^[+-]?(\d+\.?\d*|\d*\.?\d+)(e[+-]?\d+)?$/i.test(trimmed)) {
            numericCount++
        }
        // kontrola, zda to vypadá jako datum
        else if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(trimmed)) {
            numericCount++
        }
    }

    return numericCount / validCells.length > 0.7
}

function detectHeaderRow(rows: string[][], option: ParseOptions['header']): number | null {
    if (option === 'no_header') return null
    if (typeof option === 'number') return option

    // auto: najít první řádek, který není smetí ani číselný řádek
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i]
        if (!row || isJunkRow(row)) continue
        if (!isNumericOrDateRow(row)) {
            return i
        }
    }

    // nebyla nalezena žádná vhodná hlavička
    return null
}

// ============ odhad typů (inference) ============

export function inferColumnType(samples: string[]): InferredType {
    const validSamples = samples.filter(s => s && s.trim()).slice(0, 50)
    if (!validSamples.length) return 'text'

    let ints = 0
    let floats = 0
    let bools = 0
    let dates = 0

    for (const s of validSamples) {
        const t = s.trim()

        // vzory pro datum
        if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(t)) {
            dates++
            continue
        }

        // booleovské hodnoty
        if (/^(true|false|1|0|yes|no|ano|ne)$/i.test(t)) {
            bools++
            continue
        }

        // celá čísla
        if (/^[+-]?\d+$/.test(t)) {
            ints++
            continue
        }

        // desetinná čísla (podpora pro . i , jako oddělovač)
        const normalized = t.replace(',', '.')
        if (/^[+-]?(\d+\.?\d*|\d*\.?\d+)(e[+-]?\d+)?$/i.test(normalized)) {
            floats++
            continue
        }
    }

    // Strict check: if a significant portion of samples are not defined types, fall back to text.
    // This catches cases like 'HPLC_4805' mixed with numbers being detected as int/float due to loose threshold.
    const definedTypesCount = dates + bools + ints + floats
    // If ANY valid sample is unidentified (text), force text type.
    if (validSamples.length > 0 && (validSamples.length - definedTypesCount) > 0) {
        return 'text'
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

// ============ generování názvů sloupců ============

export function generateColumnNames(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `Column ${i + 1}`)
}

// ============ převod desetinných míst ============



// ============ hlavní parsovací funkce ============

export function parseWithOptions(text: string, opts: ParseOptions): ParseResult {
    const reasons: string[] = []

    // sjednocení konců řádků
    const normalizedText = text
        .replace(/\uFEFF/g, '') // bom (byte order mark)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')

    // detekce oddělovače
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

    // parsování pomocí papaparse
    const parseResult = Papa.parse<string[]>(normalizedText, {
        delimiter: usedDelimiter,
        skipEmptyLines: opts.skipEmptyLines,
        header: false
    })

    let allRows = parseResult.data

    // omezení počtu sloupců z důvodu výkonu
    allRows = allRows.map(row => row.slice(0, MAX_COLS).map(cell =>
        typeof cell === 'string' && cell.length > MAX_CELL_LENGTH
            ? cell.slice(0, MAX_CELL_LENGTH)
            : String(cell || '')
    ))

    // přeskočení úvodních řádků se smetím
    let startIdx = 0
    while (startIdx < allRows.length && isJunkRow(allRows[startIdx])) {
        startIdx++
    }
    allRows = allRows.slice(startIdx)

    // detekce řádku hlavičky
    const headerRowIdx = detectHeaderRow(allRows, opts.header)
    const usedHeaderRow = headerRowIdx

    let headers: string[] = []
    let dataRows: string[][] = []

    if (headerRowIdx !== null && headerRowIdx < allRows.length) {
        headers = allRows[headerRowIdx].map(h => (h || '').trim())
        dataRows = allRows.slice(headerRowIdx + 1)
    } else {
        // žádná hlavička: použít všechny řádky jako data
        dataRows = allRows
        // generování názvů sloupců podle maximálního počtu sloupců
        const maxCols = Math.max(...dataRows.map(r => r.length), 0)
        headers = generateColumnNames(maxCols)
    }

    // odfiltrování prázdných hlaviček
    headers = headers.filter(h => h)

    // výpočet metrik
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

    // určení stavu (status)
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

    // zpracování desetinných míst
    const usedDecimal = opts.decimal === 'auto' ? '.' : opts.decimal

    return {
        status,
        reasons,
        headers,
        rows: dataRows.slice(0, MAX_SAMPLE_ROWS), // limit pro náhled
        usedDelimiter,
        usedHeaderRow,
        usedDecimal,
        metrics
    }
}

// ============ výchozí nastavení ============

// ============ raw preview helper ============

export function parseRawPreview(text: string, maxLines = 100): string[][] {
    if (!text) return []

    // Oříznutí textu pro preview (optimalizace)
    let limitIndex = -1
    let found = 0
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            found++
            if (found >= maxLines) {
                limitIndex = i
                break
            }
        }
    }
    const previewText = limitIndex === -1 ? text : text.substring(0, limitIndex)

    const { delimiter } = detectBestDelimiter(previewText)

    const result = Papa.parse<string[]>(previewText, {
        delimiter,
        header: false,
        skipEmptyLines: false
    })

    return result.data as string[][]
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
    delimiter: 'auto',
    decimal: 'auto',
    header: 'auto',
    skipEmptyLines: true
}
