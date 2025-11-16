/* Enhanced clipboard/table parser with:
   - robust units-to-header alignment
   - separation of trailing summary statistics (Mean/Std/RSD/Median)
   - detection of metadata (key:value) blocks
   - NO 'any' in types
*/
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
}

/* ------------ helpers ------------- */
function normalizeHeader(raw?: string): string {
  const s = (raw ?? '').trim()
  return s.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').toLowerCase()
}

function isNumberLike(s?: string): boolean {
  if (!s) return false
  const t = s.trim().replace(',', '.')
  if (!t.length) return false
  return !Number.isNaN(Number(t))
}
function containsAny(lower: string, needles: string[]): boolean {
  for (const n of needles) if (lower.includes(n)) return true
  return false
}

export function inferFieldType(headerRaw?: string, name?: string): ColumnType {
  const h = (headerRaw ?? name ?? '').trim().toLowerCase()
  if (!h) return 'text'
  if (containsAny(h, ['date', 'datum', 'time', 'čas'])) return 'date'
  if (containsAny(h, ['yes/no', 'true/false', 'boolean'])) return 'bool'
  if (containsAny(h, ['file', 'image', 'screenshot'])) return 'file'
  if (containsAny(h, ['count', 'number ']) || /^number\b/.test(h)) return 'int'
  if (containsAny(h, ['mean', 'avg', 'average', 'size', 'pdi', 'intensity', 'volume', 'peak', 'z-average', 'z average', 'number'])) return 'float'
  return 'text'
}

/* block & delimiter */
function splitIntoBlocks(lines: string[]): { start: number; end: number; lines: string[] }[] {
  const blocks: { start: number; end: number; lines: string[] }[] = []
  let i = 0
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++
    if (i >= lines.length) break
    const s = i
    while (i < lines.length && lines[i].trim() !== '') i++
    const e = i - 1
    blocks.push({ start: s, end: e, lines: lines.slice(s, e + 1) })
  }
  return blocks
}

function detectDelimiter(blockText: string): 'tab' | 'semicolon' | 'comma' | 'pipe' | 'spaces' {
  if (/\t/.test(blockText)) return 'tab'
  const counts: Record<'semicolon'|'comma'|'pipe', number> = {
    semicolon: (blockText.match(/;/g) || []).length,
    comma: (blockText.match(/,/g) || []).length,
    pipe: (blockText.match(/\|/g) || []).length
  }
  const best = Object.entries(counts).reduce((a, b) => a[1] >= b[1] ? a : b)
  if (best[1] > 0) return best[0] as 'semicolon'|'comma'|'pipe'
  if (/\s{2,}/.test(blockText)) return 'spaces'
  return 'comma'
}
function smartSplit(line: string, delim: ReturnType<typeof detectDelimiter>): string[] {
  if (delim === 'tab') return line.split('\t') // keep empties for alignment
  if (delim === 'semicolon') return line.split(';')
  if (delim === 'comma') return line.split(',')
  if (delim === 'pipe') return line.split('|')
  if (delim === 'spaces') return /\s{2,}/.test(line) ? line.split(/\s{2,}/) : [line]
  return [line]
}
function countNonEmpty(tokens: string[]): number {
  return tokens.reduce((acc, s) => acc + ((s ?? '').trim().length > 0 ? 1 : 0), 0)
}

/* stats */
function isStatsStart(s: string): boolean {
  const l = s.trim().toLowerCase()
  return /^(mean|std|std dev|stddev|rsd|rsd %|median)\b/.test(l)
}

/* metadata (key: value) */
function isLikelyKvLine(rawLine: string, tokens: string[]): boolean {
  const first = (tokens[0] ?? '').trim()
  if (!first) return false
  // direct "Key: value" in the first token
  if (/^[^:]{1,80}:\s*\S/.test(first)) return true
  // or multiple tokens but first contains "Label:" / "Start Time:" / "Temperature:" etc.
  if (/:\s*$/.test(first)) return true
  // fallback: whole raw line contains colon with some value after
  return /^[^:]{1,80}:\s*\S/.test(rawLine.trim())
}
function parseKvPair(rawLine: string): KvPair | null {
  const m = rawLine.match(/^([^:]{1,200}):\s*(.*)$/)
  if (!m) return null
  const key = m[1]?.trim() ?? ''
  const value = m[2]?.trim() ?? ''
  if (!key) return null
  return { key, value }
}

/* units alignment */
const UNIT_HINTS = ['°c', '°', 'percent', '%', 'd.nm', 'dnm', 'nm', 'µm', 'um', 'μm']
function looksLikeUnitToken(raw: string): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return false
  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(v)) return false
  if (UNIT_HINTS.some(h => v.includes(h))) return true
  if (/^[a-zµμ°/%\-\\/]+$/i.test(v) && v.length <= 8) return true
  if (v.includes('%') || v.includes('°')) return true
  return false
}
function looksLikeUnitRow(tokens: string[]): boolean {
  let nonEmpty = 0
  let units = 0
  for (const t of tokens) {
    const s = (t ?? '').trim()
    if (!s) continue
    nonEmpty++
    if (looksLikeUnitToken(s)) units++
  }
  return nonEmpty > 0 && units >= Math.max(1, Math.round(nonEmpty * 0.5))
}
type UnitFamily = 'degc' | 'dnm' | 'percent' | 'unknown'
function unitFamilyFromToken(token: string): UnitFamily {
  const t = token.trim().toLowerCase()
  if (!t) return 'unknown'
  if (t.includes('°c') || t === '°' || t.includes('celsius')) return 'degc'
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
function mergeHeaderWithUnitsSmart(headers: string[], units: string[]): string[] {
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
    // additional strong tie-breaker for Temperature ↔ °C
    const ti = headers.findIndex(h => h.toLowerCase().includes('temperature'))
    if (ti >= 0) {
      const j = ti - s
      const tok = (units[j] ?? '').trim().toLowerCase()
      if (tok.includes('°c') || tok === '°' || tok.includes('celsius')) total += 10
    }
    if (total > bestScore) { bestScore = total; bestS = s }
  }
  return headers.map((h, i) => {
    const j = i - bestS
    const unit = (j >= 0 && j < U) ? (units[j] ?? '').trim() : ''
    const base = (h ?? '').trim()
    if (unit) return base ? `${base} (${unit})` : unit
    return base
  })
}

/* header features */
const HEADER_KEYWORDS = [
  'record', 'sample', 'measurement', 'date', 'time', 'temperature', 'z-average',
  'intensity', 'volume', 'number', 'pdi', 'size', 'peak', 'attenuator',
  'sizes', 'intensities', 'volumes', 'numbers', 'wavel', 'wavelength'
]
type RowFeatures = {
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
function featuresFor(tokens: string[], idx: number, rawLine: string): RowFeatures {
  let numNumeric = 0
  let numText = 0
  let keywordHits = 0
  for (const raw of tokens) {
    const t = (raw ?? '').trim()
    if (!t) continue
    if (isNumberLike(t)) numNumeric++
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
    startsWithStats: isStatsStart((tokens[0] ?? '').trim()),
    looksUnits: looksLikeUnitRow(tokens),
    looksKv: isLikelyKvLine(rawLine, tokens)
  }
}
function headerScore(f: RowFeatures, next?: RowFeatures): number {
  if (f.nonEmpty < 2) return -Infinity
  if (f.startsWithStats) return -Infinity
  if (f.looksKv) return -Infinity // metadata řádek není hlavička tabulky
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

/* repeat detection */
export function buildRepeatMetaFromHeaders(headers: string[]): RepeatMeta {
  const tmp: Record<string, number[]> = {}
  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i] ?? ''
    const base = raw.trim().replace(/\s+\d+$/u, '')
    const key = base || raw || `#${i + 1}`
    if (!tmp[key]) tmp[key] = []
    tmp[key].push(i)
  }
  const filtered: Record<string, number[]> = {}
  for (const k of Object.keys(tmp)) {
    if (tmp[k].length > 1) filtered[k] = tmp[k]
  }
  const detected = Object.keys(filtered).length > 0
  const replicateCount = detected ? Math.max(...Object.values(filtered).map(v => v.length)) : null
  return { repeatDetected: detected, replicateCount, repeatMap: filtered }
}

/* series detection */
function tryParseSeries(lines: string[]): SeriesBlock | null {
  const vals: number[] = []
  for (const ln of lines) {
    const t = ln.trim()
    if (!t) continue
    const parts = t.split(/[\t,; ]+/).filter(Boolean)
    let found = false
    for (const p of parts) {
      const n = Number(p.replace(',', '.'))
      if (!Number.isNaN(n)) { vals.push(n); found = true; break }
    }
    if (!found) return null
  }
  if (vals.length >= 2) {
    return { kind: 'series', startLine: -1, endLine: -1, header: lines[0]?.trim(), values: vals }
  }
  return null
}

/* ------------- analyzer -------------- */
export function analyzeClipboard(rawText: string): AnalyzeResult {
  const rawLines = (rawText ?? '').split(/\r?\n/).map(l => l.replace(/\u00A0/g, ' '))
  const blocksRaw = splitIntoBlocks(rawLines)
  const blocksOut: Array<TableBlock | StatsBlock | SeriesBlock | KvBlock> = []
  let mainTable: TableBlock | undefined
  let statsBlock: StatsBlock | null = null
  let seriesBlock: SeriesBlock | null = null

  for (const b of blocksRaw) {
    const nonEmpty = b.lines.filter(l => l.trim().length > 0)
    if (!nonEmpty.length) continue

    const delim = detectDelimiter(nonEmpty.join('\n'))
    const tokenRows = nonEmpty.map(l => smartSplit(l, delim).map(s => (s ?? '').trim()))
    const feats = tokenRows.map((r, i) => featuresFor(r, i, nonEmpty[i] ?? ''))

    // 0) Pull off leading metadata (kv) lines as a distinct block
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

    // Work on the remainder (after metadata)
    const remLines = nonEmpty.slice(kvCount)
    if (!remLines.length) continue
    const remTokens = tokenRows.slice(kvCount)
    const remFeats = feats.slice(kvCount)

    // 1) Try TABLE first
    let bestIdx = -1
    let bestScore = -Infinity
    for (let i = 0; i < remFeats.length; i++) {
      const sc = headerScore(remFeats[i], remFeats[i + 1])
      if (sc > bestScore) { bestScore = sc; bestIdx = i }
    }

    // remove trailing summary stats from remainder (for preview and correctness)
    const trailing: string[][] = []
    for (let i = remTokens.length - 1; i >= 0; i--) {
      const firstCell = (remTokens[i][0] ?? '').trim()
      if (isStatsStart(firstCell)) trailing.unshift(remTokens[i].slice())
      else break
    }
    const effectiveTokens = trailing.length ? remTokens.slice(0, remTokens.length - trailing.length) : remTokens

    // If we have a plausible header
    if (bestIdx >= 0 && bestScore >= 0.5 && effectiveTokens.length > 0) {
      const header0 = effectiveTokens[bestIdx]?.slice() ?? []
      let dataStart = bestIdx + 1
      if (effectiveTokens[dataStart] && looksLikeUnitRow(effectiveTokens[dataStart])) {
        const merged = mergeHeaderWithUnitsSmart(header0, effectiveTokens[dataStart] ?? [])
        for (let i = 0; i < merged.length; i++) header0[i] = merged[i]
        dataStart++
      }
      const cols = header0.length
      const dataRows: string[][] = []
      for (let r = dataStart; r < effectiveTokens.length; r++) {
        const row = effectiveTokens[r]?.slice() ?? []
        if (row.length < cols) while (row.length < cols) row.push('')
        else if (row.length > cols) row.length = cols
        dataRows.push(row)
      }
      const headersRaw = header0.map(c => (c ?? '').trim())
      const headersNormalized = headersRaw.map(normalizeHeader)
      const table: TableBlock = { kind: 'table', startLine: b.start + kvCount, endLine: b.end, headersRaw, headersNormalized, rows: dataRows }
      blocksOut.push(table)
      if (!mainTable) mainTable = table
      else if (table.headersRaw.length > (mainTable.headersRaw.length || 0)) mainTable = table

      // trailing stats as their own block (only once per block)
      if (trailing.length) {
        const statsLines = trailing.map(r => r.join('\t'))
        const sb: StatsBlock = { kind: 'stats', startLine: b.start, endLine: b.end, lines: statsLines }
        blocksOut.push(sb)
        if (!statsBlock) statsBlock = sb
      }
      continue
    }

    // 2) SERIES
    const seriesTry = tryParseSeries(remLines)
    if (seriesTry) {
      seriesTry.startLine = b.start + kvCount
      seriesTry.endLine = b.end
      blocksOut.push(seriesTry)
      if (!seriesBlock) seriesBlock = seriesTry
      continue
    }

    // 3) STATS (strict)
    if (remLines.every(l => isStatsStart(l.split(/\t|;/)[0] ?? ''))) {
      const sb: StatsBlock = { kind: 'stats', startLine: b.start + kvCount, endLine: b.end, lines: remLines.slice() }
      blocksOut.push(sb)
      if (!statsBlock) statsBlock = sb
      continue
    }
  }

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

  return {
    rawLines,
    mainTable: mainTable || null,
    stats: statsBlock || null,
    series: seriesBlock || null,
    columns,
    headersRaw: headersRawOut,
    headersNormalized: headersNormalizedOut,
    repeat,
    blocks: blocksOut
  }
}
