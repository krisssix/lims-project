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

export type AnalyzeResult = {
  rawLines: string[]
  mainTable?: TableBlock | null
  stats?: StatsBlock | null
  series?: SeriesBlock | null
  columns: ColumnSuggestion[]
  headersRaw: string[]
  headersNormalized: string[]
  repeat: RepeatMeta
  blocks: Array<TableBlock | StatsBlock | SeriesBlock>
}

/* helpers */
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
  if (containsAny(h, ['mean', 'avg', 'average', 'size', 'pdi', 'intensity', 'volume', 'peak'])) return 'float'
  return 'text'
}

function detectDelimiterForLine(line: string): string | RegExp {
  if (!line) return /\s+/
  if (line.indexOf('\t') >= 0) return '\t'
  const semicol = (line.match(/;/g) || []).length
  const comma = (line.match(/,/g) || []).length
  const pipe = (line.match(/\|/g) || []).length
  const max = Math.max(semicol, comma, pipe)
  if (max === semicol && semicol > 0) return ';'
  if (max === pipe && pipe > 0) return '|'
  if (max === comma && comma > 0) return ','
  return /\s+/
}

function parseTableWithDelimiter(lines: string[], delim: string | RegExp): string[][] {
  const out: string[][] = []
  for (const ln of lines) {
    if (typeof delim === 'string') out.push(ln.split(delim).map(c => c.trim()))
    else out.push(ln.split(delim).map(c => c.trim()))
  }
  return out
}

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

function isStatsLine(lower: string): boolean {
  return containsAny(lower, ['mean', 'std', 'std dev', 'median', 'rsd', 'percent'])
}

function tryParseSeries(blockLines: string[]): number[] {
  const vals: number[] = []
  for (const ln of blockLines) {
    const t = ln.trim()
    if (!t) continue
    const parts = t.split(/[\t,; ]+/).map(p => p.trim()).filter(Boolean)
    let found = false
    for (const p of parts) {
      const n = Number(p.replace(',', '.'))
      if (!Number.isNaN(n)) { vals.push(n); found = true; break }
    }
    if (!found) return []
  }
  return vals
}

function buildRepeatMetaFromHeaders(headers: string[]): RepeatMeta {
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

export function analyzeClipboard(rawText: string): AnalyzeResult {
  const rawLines = (rawText ?? '').split(/\r?\n/).map(l => l.replace(/\u00A0/g, ' '))
  const blocksRaw = splitIntoBlocks(rawLines)
  const blocksOut: Array<TableBlock | StatsBlock | SeriesBlock> = []
  let mainTable: TableBlock | undefined
  let statsBlock: StatsBlock | null = null
  let seriesBlock: SeriesBlock | null = null

  for (const b of blocksRaw) {
    const lowerLines = b.lines.map(l => l.trim().toLowerCase())
    const anyStats = lowerLines.some(l => isStatsLine(l))
    if (anyStats) {
      const sb: StatsBlock = { kind: 'stats', startLine: b.start, endLine: b.end, lines: b.lines.slice() }
      blocksOut.push(sb)
      if (!statsBlock) statsBlock = sb
      continue
    }

    const candidate = b.lines.find(l => l.trim().length > 0) ?? ''
    const delim = detectDelimiterForLine(candidate)
    const rows = parseTableWithDelimiter(b.lines, delim)
    const avgTokens = rows.reduce((s, r) => s + r.filter(c => c.trim().length > 0).length, 0) / Math.max(1, rows.length)
    if (avgTokens >= 2.0) {
      let headerRowIndex = 0
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const nonNumericCount = row.filter(c => !isNumberLike(c)).length
        if (nonNumericCount >= 1) { headerRowIndex = i; break }
      }
      const headersRaw = rows[headerRowIndex].map(c => c.trim())
      const dataRows = rows.slice(headerRowIndex + 1).map(r => r.map(c => c.trim()))
      const headersNormalized = headersRaw.map(normalizeHeader)
      const table: TableBlock = { kind: 'table', startLine: b.start, endLine: b.end, headersRaw, headersNormalized, rows: dataRows }
      if (!mainTable) mainTable = table
      else if (table.headersRaw.length > (mainTable.headersRaw.length || 0)) mainTable = table
      blocksOut.push(table)
      continue
    }

    const seriesVals = tryParseSeries(b.lines)
    if (seriesVals.length >= 2) {
      const hdr = b.lines[0].trim()
      const sb: SeriesBlock = { kind: 'series', startLine: b.start, endLine: b.end, header: hdr, values: seriesVals }
      if (!seriesBlock) seriesBlock = sb
      blocksOut.push(sb)
      continue
    }
  }

  let columns: ColumnSuggestion[] = []
  let headersRawOut: string[] = []
  let headersNormalizedOut: string[] = []
  if (mainTable) {
    headersRawOut = mainTable.headersRaw
    headersNormalizedOut = mainTable.headersNormalized
    columns = headersRawOut.map((h, idx) => ({ index: idx, headerRaw: h, headerNormalized: headersNormalizedOut[idx] ?? normalizeHeader(h), detectedType: inferFieldType(h) }))
  }

  const repeat = buildRepeatMetaFromHeaders(headersRawOut)

  return {
    rawLines,
    mainTable,
    stats: statsBlock || null,
    series: seriesBlock || null,
    columns,
    headersRaw: headersRawOut,
    headersNormalized: headersNormalizedOut,
    repeat,
    blocks: blocksOut
  }
}
