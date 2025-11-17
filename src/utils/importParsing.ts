/*
 Universal Clipboard/Table Parser – v2
 -----------------------------------------------------
 Goals:
 - Robust block segmentation for mixed clipboard dumps
 - Header detection with optional unit-row alignment
 - Delimiter auto-detection with CSV quotes + Markdown/TSV/space tables
 - Trailing summary statistics separation (Mean/Std/RSD/Median...)
 - Metadata (key: value) detection before/after tables
 - Series-only blocks (one value per line)
 - Locale-friendly numeric parsing (comma/point; thin spaces)
 - Strong TypeScript types (no `any`), no external deps
 - Diagnostics to see what heuristics fired

 This file exports a single `analyzeClipboard` function and richly typed
 support structures. Drop-in replacement for the user's original API.
*/

/* ===================== Types ===================== */
export type ColumnType = 'float' | 'int' | 'bool' | 'date' | 'text' | 'file'

export type ColumnSuggestion = {
  index: number
  headerRaw: string
  headerNormalized: string
  detectedType: ColumnType
}

export type RepeatMeta = {
  repeatDetected: boolean
  replicateCount: number | null
  repeatMap: Record<string, number[]>
}

export type TableBlock = {
  kind: 'table'
  startLine: number
  endLine: number
  headersRaw: string[]
  headersNormalized: string[]
  rows: string[][]
  delimiter: DetectedDelimiter
}

export type StatsBlock = {
  kind: 'stats'
  startLine: number
  endLine: number
  lines: string[]
}

export type SeriesBlock = {
  kind: 'series'
  startLine: number
  endLine: number
  header?: string
  values: number[]
}

export type KvPair = { key: string; value: string }
export type KvBlock = {
  kind: 'kv'
  startLine: number
  endLine: number
  pairs: KvPair[]
  lines: string[] // original lines for preview
}

export type AnalyzeDiagnostics = {
  blocksDetected: number
  kvBlocks: number
  tableBlocks: number
  statsBlocks: number
  seriesBlocks: number
  headersChosenFromBlockIndex: number | null
  unitRowMerged: boolean
  delimiterGuesses: Array<{ blockIndex: number; chosen: DetectedDelimiter; competitors: Array<{ delim: Delimiter; score: number }> }>
}

export type AnalyzeResult = {
  rawLines: string[]
  mainTable?: TableBlock | null
  stats?: StatsBlock | null
  series?: SeriesBlock | null
  columns: ColumnSuggestion[]
  headersRaw: string[]
  headersNormalized: string[]
  repeat: RepeatMeta
  blocks: Array<TableBlock | StatsBlock | SeriesBlock | KvBlock>
  diagnostics: AnalyzeDiagnostics
}

/* ===================== Options ===================== */
export type ParserOptions = {
  /** Prefer decimal comma if ambiguous */
  preferDecimalComma?: boolean
  /** Accept markdown tables with header divider (|---|) */
  acceptMarkdownTables?: boolean
  /** Merge single leading unit row with headers when likely */
  mergeUnitsWithHeaders?: boolean
  /** Minimum score to treat a row as header */
  headerScoreThreshold?: number
  /** Treat solitary numbers-per-line as a numeric series block */
  enableSeriesDetection?: boolean
  /** Force a delimiter instead of auto-detection ('auto' = keep autodetect) */
  delimiterOverride?: Delimiter | 'auto'
}

const DEFAULT_OPTS: Required<ParserOptions> = {
  preferDecimalComma: false,
  acceptMarkdownTables: true,
  mergeUnitsWithHeaders: true,
  headerScoreThreshold: 0.5,
  enableSeriesDetection: true,
  delimiterOverride: 'auto',
}

/* ===================== Helpers ===================== */
export function normalizeHeader(raw?: string): string {
  const s = (raw ?? '').trim()
  return s
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function stripNBSP(s: string): string { return s.replace(/\u00A0/g, ' ') }

function safeTrim(s?: string): string { return (s ?? '').trim() }

function containsAny(lower: string, needles: readonly string[]): boolean {
  for (const n of needles) if (lower.includes(n)) return true
  return false
}

function unquote(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

/* ===================== Number & Date Detection ===================== */
const NUM_GROUP = /[\u00A0\u2009\u202F\s]/g // nbsp + thin spaces

function normalizeDecimal(token: string, preferComma: boolean): string {
  let t = token.replace(NUM_GROUP, '')
  // If both comma and dot present, assume comma is thousands sep when dot appears later
  const hasComma = t.includes(',')
  const hasDot = t.includes('.')
  if (hasComma && hasDot) {
    // If last separator is comma, likely decimal comma
    const lastComma = t.lastIndexOf(',')
    const lastDot = t.lastIndexOf('.')
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.')
    else t = t.replace(/,/g, '')
    return t
  }
  if (hasComma && !hasDot) return preferComma ? t.replace(',', '.') : t.replace(/,/g, '')
  return t
}

function isNumberLike(raw?: string, preferComma = false): boolean {
  if (!raw) return false
  const t = safeTrim(raw)
  if (!t) return false
  const n = Number(normalizeDecimal(t, preferComma))
  return !Number.isNaN(n)
}

function toNumber(raw: string, preferComma = false): number | null {
  const t = safeTrim(raw)
  if (!t) return null
  const n = Number(normalizeDecimal(t, preferComma))
  return Number.isNaN(n) ? null : n
}

// quick date heuristics: 2025-11-16, 16.11.2025, 11/16/2025 14:05, etc.
function isDateLike(s?: string): boolean {
  if (!s) return false
  const t = safeTrim(s)
  if (!t) return false
  // ISO or EU
  if (/^\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(t)) return true
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(t)) return true
  return false
}

/* ===================== Delimiters & Tokenization ===================== */
export type Delimiter = 'tab' | 'semicolon' | 'comma' | 'pipe' | 'spaces' | 'markdown'
export type DetectedDelimiter = { delim: Delimiter; reason: string }

function detectDelimiter(blockText: string, opts: Required<ParserOptions>): DetectedDelimiter {
  const hasTab = /\t/.test(blockText)
  if (hasTab) return { delim: 'tab', reason: 'Tab characters present' }

  // markdown table detection
  if (opts.acceptMarkdownTables) {
    const lines = blockText.split(/\r?\n/).map(l => l.trim())
    const dividerIdx = lines.findIndex(l => /^\|?\s*:?[-]{2,}.*\|.*$/.test(l))
    if (dividerIdx > 0) return { delim: 'markdown', reason: 'Markdown header divider found' }
  }

  const counts: ReadonlyArray<{ delim: Delimiter; count: number }> = [
    { delim: 'semicolon', count: (blockText.match(/;/g) || []).length },
    { delim: 'comma', count: (blockText.match(/,/g) || []).length },
    { delim: 'pipe', count: (blockText.match(/\|/g) || []).length },
  ]
  const best = counts.reduce((a, b) => (a.count >= b.count ? a : b))
  if (best.count > 0) return { delim: best.delim, reason: 'Most frequent separator' }
  if (/\s{2,}/.test(blockText)) return { delim: 'spaces', reason: 'Aligned by multiple spaces' }
  return { delim: 'comma', reason: 'Fallback to comma' }
}

function splitCSVWithQuotes(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ } // escaped quote
      else inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch === sep) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

function smartSplit(line: string, dd: DetectedDelimiter): string[] {
  if (dd.delim === 'tab') return line.split('\t')
  if (dd.delim === 'semicolon') return splitCSVWithQuotes(line, ';')
  if (dd.delim === 'comma') return splitCSVWithQuotes(line, ',')
  if (dd.delim === 'pipe') return splitCSVWithQuotes(line, '|')
  if (dd.delim === 'spaces') return /\s{2,}/.test(line) ? line.split(/\s{2,}/) : [line]
  if (dd.delim === 'markdown') {
    const raw = line.replace(/^\|?\s*|\s*\|$/g, '')
    return raw.split('|').map(s => s.trim())
  }
  return [line]
}

function countNonEmpty(tokens: readonly string[]): number {
  let n = 0
  for (const s of tokens) if (safeTrim(s).length > 0) n++
  return n
}

/* ===================== Stats & KV ===================== */
function isStatsStart(s: string): boolean {
  const l = s.trim().toLowerCase()
  return /^(mean|std|std dev|stddev|rsd|rsd %|median|min|max|sum|count)\b/.test(l)
}

function isLikelyKvLine(rawLine: string, tokens: readonly string[]): boolean {
  const first = safeTrim(tokens[0])
  if (!first) return false
  if (/^[^:]{1,120}:\s*\S/.test(first)) return true
  if (/:\s*$/.test(first)) return true
  return /^[^:]{1,120}:\s*\S/.test(rawLine.trim())
}

function parseKvPair(rawLine: string): KvPair | null {
  const m = rawLine.match(/^([^:]{1,200}):\s*(.*)$/)
  if (!m) return null
  const key = safeTrim(m[1])
  const value = safeTrim(m[2] ?? '')
  if (!key) return null
  return { key, value }
}

/* ===================== Units Alignment ===================== */
const UNIT_HINTS = ['°c', '°f', '°', 'percent', '%', 'd.nm', 'dnm', 'nm', 'µm', 'um', 'μm', 'm', 'kg', 'g', 'mm'] as const
function looksLikeUnitToken(raw: string): boolean {
  const v = safeTrim(raw).toLowerCase()
  if (!v) return false
  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(v)) return false
  if (UNIT_HINTS.some(h => v.includes(h))) return true
  if (/^[a-zµμ°/%\-\\/]+$/i.test(v) && v.length <= 8) return true
  if (v.includes('%') || v.includes('°')) return true
  return false
}

function looksLikeUnitRow(tokens: readonly string[]): boolean {
  let nonEmpty = 0
  let units = 0
  for (const t of tokens) {
    const s = safeTrim(t)
    if (!s) continue
    nonEmpty++
    if (looksLikeUnitToken(s)) units++
  }
  return nonEmpty > 0 && units >= Math.max(1, Math.round(nonEmpty * 0.5))
}

type UnitFamily = 'degc' | 'degf' | 'dnm' | 'percent' | 'unknown'
function unitFamilyFromToken(token: string): UnitFamily {
  const t = token.trim().toLowerCase()
  if (!t) return 'unknown'
  if (t.includes('°c') || t === '°' || t.includes('celsius')) return 'degc'
  if (t.includes('°f') || t.includes('fahrenheit')) return 'degf'
  if (t.includes('d.nm') || t === 'nm' || /\bnm\b/.test(t)) return 'dnm'
  if (t.includes('percent') || t.includes('%')) return 'percent'
  return 'unknown'
}

function expectedUnitFamilyFromHeader(header: string): UnitFamily | 'unitless' {
  const h = header.trim().toLowerCase()
  if (!h) return 'unknown'
  if (h.includes('temperature')) return 'degc'
  if (h.includes('z-average') || h.includes('size') || h.includes('mean') || h.includes('peak') || h.includes('sizes')) return 'dnm'
  if (h.includes('intensities') || h.includes('volumes') || h.includes('numbers') || h.includes('percent')) return 'percent'
  if (h.includes('record number') || h.includes('sample name') || h.includes('measurement date') || h.includes('date and time')) return 'unitless'
  if (h.includes('attenuator') || h.includes('pdi')) return 'unitless'
  return 'unknown'
}

function scoreUnitMatch(header: string, unitTok: string): number {
  if (!unitTok.trim()) return 0
  const fam = unitFamilyFromToken(unitTok)
  const exp = expectedUnitFamilyFromHeader(header)
  let sc = 0.5
  if (header.toLowerCase().includes('temperature') && fam === 'degc') sc += 10
  if (exp === 'degc' && fam === 'degc') sc += 6
  if (exp === 'dnm' && fam === 'dnm') sc += 3
  if (exp === 'percent' && fam === 'percent') sc += 3
  if (exp === 'unitless' && fam !== 'unknown') sc -= 3
  if (fam === 'degc' && !header.toLowerCase().includes('temperature')) sc -= 6
  return sc
}

function mergeHeaderWithUnitsSmart(headers: readonly string[], units: readonly string[]): string[] {
  const H = headers.length
  const U = units.length
  if (!H || !U) return headers.slice()
  const minS = -Math.min(5, U)
  const maxS = Math.max(H - U, 0) + 5
  let bestS = 0
  let bestScore = -Infinity
  for (let s = minS; s <= maxS; s++) {
    let total = 0
    for (let i = 0; i < H; i++) {
      const j = i - s
      if (j < 0 || j >= U) continue
      total += scoreUnitMatch(headers[i] ?? '', units[j] ?? '')
    }
    const ti = headers.findIndex(h => h.toLowerCase().includes('temperature'))
    if (ti >= 0) {
      const j = ti - s
      const tok = safeTrim(units[j] ?? '').toLowerCase()
      if (tok.includes('°c') || tok === '°' || tok.includes('celsius')) total += 10
    }
    if (total > bestScore) { bestScore = total; bestS = s }
  }
  return headers.map((h, i) => {
    const j = i - bestS
    const unit = (j >= 0 && j < U) ? safeTrim(units[j] ?? '') : ''
    const base = safeTrim(h)
    if (unit) return base ? `${base} (${unit})` : unit
    return base
  })
}

/* ===================== Header Detection ===================== */
const HEADER_KEYWORDS = [
  'record', 'sample', 'measurement', 'date', 'time', 'temperature', 'z-average',
  'intensity', 'volume', 'number', 'pdi', 'size', 'peak', 'attenuator',
  'sizes', 'intensities', 'volumes', 'numbers', 'wavel', 'wavelength', 'mean'
] as const

export type RowFeatures = {
  idx: number
  tokens: string[]
  nonEmpty: number
  numNumeric: number
  numText: number
  keywordHits: number
  startsWithStats: boolean
  looksUnits: boolean
  looksKv: boolean
}

function featuresFor(tokens: string[], idx: number, rawLine: string, preferComma: boolean): RowFeatures {
  let numNumeric = 0
  let numText = 0
  let keywordHits = 0
  for (const raw of tokens) {
    const t = safeTrim(raw)
    if (!t) continue
    if (isNumberLike(t, preferComma)) numNumeric++
    else {
      numText++
      const low = t.toLowerCase()
      if (HEADER_KEYWORDS.some(k => low.includes(k))) keywordHits++
    }
  }
  return {
    idx,
    tokens,
    nonEmpty: countNonEmpty(tokens),
    numNumeric,
    numText,
    keywordHits,
    startsWithStats: isStatsStart(safeTrim(tokens[0] ?? '')),
    looksUnits: looksLikeUnitRow(tokens),
    looksKv: isLikelyKvLine(rawLine, tokens)
  }
}

function headerScore(f: RowFeatures, next: RowFeatures | undefined): number {
  if (f.nonEmpty < 2) return -Infinity
  if (f.startsWithStats) return -Infinity
  if (f.looksKv) return -Infinity
  let s = 0
  const total = f.numNumeric + f.numText
  const textRatio = total ? f.numText / total : 0
  const numRatio = total ? f.numNumeric / total : 0
  s += textRatio * 5
  s -= numRatio * 2
  s += f.keywordHits * 1.5
  if (f.numNumeric > f.numText && f.keywordHits === 0) s -= 3
  if (next && next.looksUnits) s += 4
  if (textRatio < 0.25 && f.keywordHits === 0) s -= 4
  return s
}

/* ===================== Repeat Detection ===================== */
export function buildRepeatMetaFromHeaders(headers: readonly string[]): RepeatMeta {
  const tmp: Record<string, number[]> = {}
  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i] ?? ''
    const base = raw.trim().replace(/\s+\d+$/u, '')
    const key = base || raw || `#${i + 1}`
    if (!tmp[key]) tmp[key] = []
    tmp[key].push(i)
  }
  const filtered: Record<string, number[]> = {}
  for (const k of Object.keys(tmp)) if (tmp[k].length > 1) filtered[k] = tmp[k]
  const detected = Object.keys(filtered).length > 0
  const replicateCount = detected ? Math.max(...Object.values(filtered).map(v => v.length)) : null
  return { repeatDetected: detected, replicateCount, repeatMap: filtered }
}

/* ===================== Series Detection ===================== */
function tryParseSeries(lines: readonly string[], preferComma: boolean): SeriesBlock | null {
  const vals: number[] = []
  for (const ln of lines) {
    const t = ln.trim()
    if (!t) continue
    // support: "value" or "label value" (first numeric wins)
    const parts = t.split(/[\t,; ]+/).filter(Boolean)
    let found = false
    for (const p of parts) {
      const num = toNumber(p, preferComma)
      if (num !== null) { vals.push(num); found = true; break }
    }
    if (!found) return null
  }
  if (vals.length >= 2) return { kind: 'series', startLine: -1, endLine: -1, header: lines[0]?.trim(), values: vals }
  return null
}

/* ===================== Block Split ===================== */
function splitIntoBlocks(lines: readonly string[]): Array<{ start: number; end: number; lines: string[] }> {
  const blocks: Array<{ start: number; end: number; lines: string[] }> = []
  let i = 0
  while (i < lines.length) {
    while (i < lines.length && safeTrim(lines[i]) === '') i++
    if (i >= lines.length) break
    const s = i
    while (i < lines.length && safeTrim(lines[i]) !== '') i++
    const e = i - 1
    blocks.push({ start: s, end: e, lines: lines.slice(s, e + 1) })
  }
  return blocks
}

/* ===================== Field Type Inference ===================== */
export function inferFieldType(headerRaw?: string, name?: string): ColumnType {
  const h = safeTrim(headerRaw ?? name ?? '').toLowerCase()
  if (!h) return 'text'
  if (containsAny(h, ['date', 'datum', 'time', 'čas'])) return 'date'
  if (containsAny(h, ['yes/no', 'true/false', 'boolean'])) return 'bool'
  if (containsAny(h, ['file', 'image', 'screenshot'])) return 'file'
  if (containsAny(h, ['count', 'number ']) || /^number\b/.test(h)) return 'int'
  if (containsAny(h, ['mean', 'avg', 'average', 'size', 'pdi', 'intensity', 'volume', 'peak', 'z-average', 'z average', 'number'])) return 'float'
  return 'text'
}

/* ===================== Analyzer ===================== */
export function analyzeClipboard(rawText: string, options?: ParserOptions): AnalyzeResult {
  const opts = { ...DEFAULT_OPTS, ...(options ?? {}) }
  const rawLines = (rawText ?? '').split(/\r?\n/).map(stripNBSP)
  const blocksRaw = splitIntoBlocks(rawLines)

  const blocksOut: Array<TableBlock | StatsBlock | SeriesBlock | KvBlock> = []
  let mainTable: TableBlock | undefined
  let statsBlock: StatsBlock | null = null
  let seriesBlock: SeriesBlock | null = null
  const delimiterGuesses: AnalyzeDiagnostics['delimiterGuesses'] = []
  let headersChosenFromBlockIndex: number | null = null
  let unitRowMerged = false

  for (let bi = 0; bi < blocksRaw.length; bi++) {
    const b = blocksRaw[bi]
    const nonEmpty = b.lines.filter(l => safeTrim(l).length > 0)
    if (!nonEmpty.length) continue

    const dd =
             opts.delimiterOverride !== 'auto'
               ? ({ delim: opts.delimiterOverride as Delimiter, reason: 'User override' } as DetectedDelimiter)
                 : detectDelimiter(nonEmpty.join('\n'), opts)
    const tokenRows = nonEmpty.map(l => smartSplit(l, dd).map(s => unquote(s)))
    delimiterGuesses.push({ blockIndex: bi, chosen: dd, competitors: [
        { delim: 'tab', score: /\t/.test(nonEmpty.join('\n')) ? 1 : 0 },
        { delim: 'semicolon', score: (nonEmpty.join('\n').match(/;/g) || []).length },
        { delim: 'comma', score: (nonEmpty.join('\n').match(/,/g) || []).length },
        { delim: 'pipe', score: (nonEmpty.join('\n').match(/\|/g) || []).length },
      ] })

    const feats = tokenRows.map((r, i) => featuresFor(r, i, nonEmpty[i] ?? '', opts.preferDecimalComma))

    // 0) Leading metadata (kv) lines
    let kvCount = 0
    while (kvCount < feats.length && feats[kvCount].looksKv) kvCount++
    if (kvCount >= 1) {
      const pairs: KvPair[] = []
      for (let i = 0; i < kvCount; i++) {
        const p = parseKvPair(nonEmpty[i] ?? '')
        if (p) pairs.push(p)
      }
      const kv: KvBlock = { kind: 'kv', startLine: b.start, endLine: b.start + kvCount - 1, pairs, lines: nonEmpty.slice(0, kvCount) }
      blocksOut.push(kv)
    }

    // Work on remainder
    const remLines = nonEmpty.slice(kvCount)
    if (!remLines.length) continue
    const remTokens = tokenRows.slice(kvCount)
    const remFeats = feats.slice(kvCount)

    // 1) Try TABLE
    let bestIdx = -1
    let bestScore = -Infinity
    for (let i = 0; i < remFeats.length; i++) {
      const sc = headerScore(remFeats[i], remFeats[i + 1])
      if (sc > bestScore) { bestScore = sc; bestIdx = i }
    }

    // Trailing STATS peel-off for cleanliness
    const trailing: string[][] = []
    for (let i = remTokens.length - 1; i >= 0; i--) {
      const firstCell = safeTrim(remTokens[i][0])
      if (isStatsStart(firstCell)) trailing.unshift(remTokens[i].slice())
      else break
    }
    const effectiveTokens = trailing.length ? remTokens.slice(0, remTokens.length - trailing.length) : remTokens

    if (bestIdx >= 0 && bestScore >= opts.headerScoreThreshold && effectiveTokens.length > 0) {
      const header0 = effectiveTokens[bestIdx]?.slice() ?? []
      let dataStart = bestIdx + 1
      if (opts.mergeUnitsWithHeaders && effectiveTokens[dataStart] && looksLikeUnitRow(effectiveTokens[dataStart])) {
        const merged = mergeHeaderWithUnitsSmart(header0, effectiveTokens[dataStart] ?? [])
        for (let i = 0; i < merged.length; i++) header0[i] = merged[i]
        dataStart++
        unitRowMerged = true
      }
      const cols = header0.length
      const dataRows: string[][] = []
      for (let r = dataStart; r < effectiveTokens.length; r++) {
        const row = effectiveTokens[r]?.slice() ?? []
        if (row.length < cols) while (row.length < cols) row.push('')
        else if (row.length > cols) row.length = cols
        dataRows.push(row)
      }
      const headersRaw = header0.map(c => safeTrim(c))
      const headersNormalized = headersRaw.map(normalizeHeader)
      const table: TableBlock = { kind: 'table', startLine: b.start + kvCount, endLine: b.end, headersRaw, headersNormalized, rows: dataRows, delimiter: dd }
      blocksOut.push(table)
      if (!mainTable || table.headersRaw.length > (mainTable.headersRaw.length || 0)) {
        mainTable = table
        headersChosenFromBlockIndex = bi
      }

      if (trailing.length) {
        const statsLines = trailing.map(r => r.join('\t'))
        const sb: StatsBlock = { kind: 'stats', startLine: b.start, endLine: b.end, lines: statsLines }
        blocksOut.push(sb)
        if (!statsBlock) statsBlock = sb
      }
      continue
    }

    // 2) SERIES
    if (opts.enableSeriesDetection) {
      const seriesTry = tryParseSeries(remLines, opts.preferDecimalComma)
      if (seriesTry) {
        seriesTry.startLine = b.start + kvCount
        seriesTry.endLine = b.end
        blocksOut.push(seriesTry)
        if (!seriesBlock) seriesBlock = seriesTry
        continue
      }
    }

    // 3) STATS (strict)
    if (remLines.every(l => isStatsStart(l.split(/\t|;/)[0] ?? ''))) {
      const sb: StatsBlock = { kind: 'stats', startLine: b.start + kvCount, endLine: b.end, lines: remLines.slice() }
      blocksOut.push(sb)
      if (!statsBlock) statsBlock = sb
      continue
    }
  }

  // Column suggestions
  let columns: ColumnSuggestion[] = []
  let headersRawOut: string[] = []
  let headersNormalizedOut: string[] = []
  if (mainTable) {
    headersRawOut = mainTable.headersRaw
    headersNormalizedOut = mainTable.headersNormalized
    columns = headersRawOut.map((h, idx) => ({
      index: idx,
      headerRaw: h,
      headerNormalized: headersNormalizedOut[idx] ?? normalizeHeader(h),
      detectedType: inferFieldType(h)
    }))
  }

  const repeat = buildRepeatMetaFromHeaders(headersRawOut)

  const diagnostics: AnalyzeDiagnostics = {
    blocksDetected: blocksRaw.length,
    kvBlocks: blocksOut.filter(b => b.kind === 'kv').length,
    tableBlocks: blocksOut.filter(b => b.kind === 'table').length,
    statsBlocks: blocksOut.filter(b => b.kind === 'stats').length,
    seriesBlocks: blocksOut.filter(b => b.kind === 'series').length,
    headersChosenFromBlockIndex,
    unitRowMerged,
    delimiterGuesses,
  }

  return {
    rawLines,
    mainTable: mainTable || null,
    stats: statsBlock || null,
    series: seriesBlock || null,
    columns,
    headersRaw: headersRawOut,
    headersNormalized: headersNormalizedOut,
    repeat,
    blocks: blocksOut,
    diagnostics,
  }
}

/* ===================== Extras: Coercion Helpers ===================== */
export type CoerceOptions = {
  preferDecimalComma?: boolean
}

export function coerceRowToTypes(row: readonly string[], columns: readonly ColumnSuggestion[], opts: CoerceOptions = {}): Array<string | number | boolean | Date | null> {
  const prefer = opts.preferDecimalComma ?? false
  const out: Array<string | number | boolean | Date | null> = []
  for (let i = 0; i < columns.length; i++) {
    const v = row[i] ?? ''
    const type = columns[i]?.detectedType ?? 'text'
    if (type === 'int') { const n = toNumber(v, prefer); out.push(n !== null ? Math.trunc(n) : null); continue }
    if (type === 'float') { const n = toNumber(v, prefer); out.push(n !== null ? n : null); continue }
    if (type === 'bool') { const t = safeTrim(v).toLowerCase(); out.push(t === 'true' || t === 'yes' || t === '1'); continue }
    if (type === 'date') { const t = safeTrim(v); out.push(isDateLike(t) ? new Date(t) : (t ? new Date(t) : null)); continue }
    out.push(v || null)
  }
  return out
}

export function coerceTable(block: TableBlock, cols: readonly ColumnSuggestion[], opts?: CoerceOptions): Array<Array<string | number | boolean | Date | null>> {
  return block.rows.map(r => coerceRowToTypes(r, cols, opts))
}
