/**
 * Universal Import Parsing Utility for LIMS System
 * - Smart block detection (table, kv, stats, series)
 * - Auto-skip stats rows that are already computed by ChartPanel
 * - Device/template recognition for "memory" feature
 * - Keyboard-friendly design for lab workers
 */

// ============ TYPES ============

export type ColumnType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'

export interface TableBlock {
  kind: 'table'
  headersRaw: string[]
  headersNormalized: string[]
  rows: string[][]
  unitRow?: string[]
  startLine: number
  delimiter: string
}

export interface KvBlock {
  kind: 'kv'
  pairs: Array<{ key: string; value: string }>
  startLine: number
}

export interface StatsBlock {
  kind: 'stats'
  lines: string[]
  /** Statistiky které systém už počítá – budou skipnuty */
  skippedStats: string[]
  /** Statistiky navíc které systém nepočítá */
  extraStats: Array<{ name: string; values: string[] }>
  startLine: number
}

export interface SeriesBlock {
  kind: 'series'
  header: string
  values: string[]
  startLine: number
}

export type ParsedBlock = TableBlock | KvBlock | StatsBlock | SeriesBlock

export interface RepeatMeta {
  repeatDetected: boolean
  baseHeaders: string[]
  repeatCount: number
}

export interface AnalyzeResult {
  blocks: ParsedBlock[]
  headersRaw?: string[]
  detectedDevice?: string
  detectedDelimiter: string
  warnings: string[]
}

export interface ParserOptions {
  preferDecimalComma?: boolean
  acceptMarkdownTables?: boolean
  mergeUnitsWithHeaders?: boolean
  delimiterOverride?: 'tab' | 'semicolon' | 'comma' | 'pipe' | 'spaces'
}

export interface ImportProfile {
  deviceCode: string
  typicalHeaders: string[]
  typicalTypes: Record<string, ColumnType>
  lastUsed: number
}

// ============ CONSTANTS ============

/** Statistiky které ChartPanel už počítá - budou automaticky skipnuty */
const COMPUTED_STATS = new Set([
  'mean', 'avg', 'average', 'průměr',
  'std', 'stddev', 'std dev', 'standard deviation', 'směrodatná odchylka',
  'median', 'medián',
  'min', 'minimum',
  'max', 'maximum',
  'rsd', 'cv', 'coefficient of variation', 'variační koeficient',
  'sum', 'součet',
  'count', 'n', 'počet',
  'variance', 'var', 'rozptyl'
])

const UNIT_INDICATORS: ReadonlyArray<string> = [
  '°', '%', 'mv', 'ms/cm', 's/cm', 'mS', 'mS/cm',
  'cm', 'nm', 'um', 'µm', 'µ', 'μ', 'ohm', 'kda', 'v', 'a', 'hz', 'ppm', '/cm', '/vs', 'vs',
  'mg', 'kg', 'g', 'ml', 'l', 'mol', 'mmol', 'µmol', 'mm', 'm', 'µl'
]

interface DevicePattern {
  pattern: RegExp
  device: string
}

const DEVICE_PATTERNS: ReadonlyArray<DevicePattern> = [
  { pattern: /zetasizer/i, device: 'ZETASIZER' },
  { pattern: /spectrophotometer|spektrofotometr/i, device: 'SPECTROPHOTOMETER' },
  { pattern: /hplc/i, device: 'HPLC' },
  { pattern: /gc[\s-]?ms/i, device: 'GC-MS' },
  { pattern: /microscop|mikroskop/i, device: 'MICROSCOPE' },
  { pattern: /ph[\s-]?meter/i, device: 'PH_METER' },
  { pattern: /centrifug/i, device: 'CENTRIFUGE' },
  { pattern: /incubator|inkubátor/i, device: 'INCUBATOR' },
  { pattern: /\bM\d{1,3}\b/i, device: 'GENERIC_M' },
]

const PROFILE_STORAGE_KEY = 'cenagrivet_import_profiles'

// ============ MAIN ANALYSIS FUNCTION ============

export function analyzeClipboard(text: string, options: ParserOptions = {}): AnalyzeResult {
  const warnings: string[] = []
  const normalized = normalizeText(text)
  const lines = normalized.split('\n')

  const delimiter = options.delimiterOverride
    ? mapDelimiterOverride(options.delimiterOverride)
    : detectDelimiter(normalized)

  const detectedDevice = detectDevice(normalized)

  const blocks: ParsedBlock[] = []
  const segments = splitIntoSegments(lines)

  for (const seg of segments) {
    const block = classifyAndParseSegment(seg.lines, seg.startLine, delimiter, options)
    if (block) {
      blocks.push(block)
    }
  }

  // Post-process: merge unit rows into headers if enabled
  if (options.mergeUnitsWithHeaders) {
    for (const block of blocks) {
      if (block.kind === 'table' && block.unitRow) {
        block.headersRaw = mergeHeadersWithUnits(block.headersRaw, block.unitRow)
      }
    }
  }

  return {
    blocks,
    headersRaw: blocks.find(b => b.kind === 'table')?.headersRaw,
    detectedDevice,
    detectedDelimiter: delimiter,
    warnings
  }
}

// ============ TEXT NORMALIZATION ============

function normalizeText(s: string): string {
  return s
    .replace(/\uFEFF/g, '') // BOM
    .replace(/\r\n? /g, '\n') // CRLF -> LF
    .replace(/\u00A0/g, ' ') // NBSP -> space
    .trim()
}

function mapDelimiterOverride(override: NonNullable<ParserOptions['delimiterOverride']>): string {
  const mapping: Record<typeof override, string> = {
    tab: '\t',
    semicolon: ';',
    comma: ',',
    pipe: '|',
    spaces: '  '
  }
  return mapping[override]
}

// ============ DELIMITER DETECTION ============

function detectDelimiter(text: string): string {
  const counts = {
    tab: countChar(text, '\t'),
    semi: countChar(text, ';'),
    comma: countChar(text, ','),
    pipe: countChar(text, '|'),
  }

  const max = Math.max(counts.tab, counts.semi, counts.comma, counts.pipe)

  if (max === counts.tab && counts.tab > 0) return '\t'
  if (max === counts.semi && counts.semi > 0) return ';'
  if (max === counts.pipe && counts.pipe > 0) return '|'
  if (/\s{2,}/.test(text)) return '  '
  return ','
}

function countChar(text: string, char: string): number {
  let count = 0
  for (const c of text) {
    if (c === char) count++
  }
  return count
}

// ============ DEVICE DETECTION ============

function detectDevice(text: string): string | undefined {
  for (const { pattern, device } of DEVICE_PATTERNS) {
    if (pattern.test(text)) return device
  }
  return undefined
}

// ============ SEGMENT SPLITTING ============

interface Segment {
  lines: string[]
  startLine: number
}

function splitIntoSegments(lines: string[]): Segment[] {
  const segments: Segment[] = []
  let current: string[] = []
  let start = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      if (current.length > 0) {
        segments.push({ lines: current, startLine: start })
        current = []
      }
      start = i + 1
    } else {
      current.push(line)
    }
  }

  if (current.length > 0) {
    segments.push({ lines: current, startLine: start })
  }

  return segments
}

// ============ BLOCK CLASSIFICATION ============

type BlockKind = 'table' | 'stats' | 'kv' | 'series'

function classifyBlockKind(lines: string[], delimiter: string): BlockKind {
  if (lines.length === 0) return 'table'

  // Check for KV block (key: value or key = value pairs)
  const kvCount = lines.filter(line => /^[^:=]+[:=][^:=]+$/.test(line.trim())).length
  if (kvCount >= lines.length * 0.6) return 'kv'

  // Check for stats block
  let statsCount = 0
  for (const line of lines) {
    const parts = smartSplit(line, delimiter)
    if (parts.length > 0 && isComputedStat(parts[0].trim())) {
      statsCount++
    }
  }
  if (statsCount >= lines.length * 0.5 && statsCount >= 2) return 'stats'

  // Check for series (single column of values)
  if (isSeriesBlock(lines, delimiter)) return 'series'

  return 'table'
}

function isComputedStat(value: string): boolean {
  const lower = value.toLowerCase().trim()

  // Exact match
  if (COMPUTED_STATS.has(lower)) return true

  // Prefix match
  for (const stat of COMPUTED_STATS) {
    if (lower.startsWith(stat)) return true
  }

  return false
}

function isSeriesBlock(lines: string[], delimiter: string): boolean {
  if (lines.length < 3) return false

  let singleColCount = 0
  for (const line of lines) {
    const parts = smartSplit(line, delimiter)
    const nonEmpty = parts.filter(p => p.trim() !== '').length
    if (nonEmpty === 1) singleColCount++
  }

  return singleColCount >= lines.length * 0.8
}

// ============ BLOCK PARSING ============

function classifyAndParseSegment(
  lines: string[],
  startLine: number,
  delimiter: string,
  options: ParserOptions
): ParsedBlock | null {
  if (lines.length === 0) return null

  const kind = classifyBlockKind(lines, delimiter)

  switch (kind) {
    case 'kv':
      return parseKvBlock(lines, startLine)
    case 'stats':
      return parseStatsBlock(lines, startLine, delimiter)
    case 'series':
      return parseSeriesBlock(lines, startLine)
    case 'table':
      return parseTableBlock(lines, startLine, delimiter, options)
  }
}

function parseKvBlock(lines: string[], startLine: number): KvBlock {
  const pairs: Array<{ key: string; value: string }> = []

  for (const line of lines) {
    const match = line.match(/^([^:=]+)[:=](.+)$/)
    if (match) {
      pairs.push({
        key: match[1].trim(),
        value: match[2].trim()
      })
    }
  }

  return { kind: 'kv', pairs, startLine }
}

function parseStatsBlock(lines: string[], startLine: number, delimiter: string): StatsBlock {
  const skippedStats: string[] = []
  const extraStats: Array<{ name: string; values: string[] }> = []

  for (const line of lines) {
    const parts = smartSplit(line, delimiter).map(s => s.trim())
    const firstCell = parts[0]?.toLowerCase() || ''

    if (isComputedStat(firstCell)) {
      skippedStats.push(firstCell)
    } else if (/^(mean|std|avg|median|min|max|rsd|cv|sum|count|var)/i.test(firstCell)) {
      extraStats.push({ name: firstCell, values: parts.slice(1) })
    }
  }

  return {
    kind: 'stats',
    lines,
    skippedStats,
    extraStats,
    startLine
  }
}

function parseSeriesBlock(lines: string[], startLine: number): SeriesBlock {
  const header = lines[0]?.trim() || 'Value'
  const values = lines.slice(1).map(l => l.trim()).filter(Boolean)
  return { kind: 'series', header, values, startLine }
}

function parseTableBlock(
  lines: string[],
  startLine: number,
  delimiter: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: ParserOptions // Reserved for future use (decimal comma handling, markdown tables)
): TableBlock {
  const rows: string[][] = []

  for (const line of lines) {
    const parts = smartSplit(line, delimiter).map(s => s.trim())
    rows.push(parts)
  }

  if (rows.length === 0) {
    return {
      kind: 'table',
      headersRaw: [],
      headersNormalized: [],
      rows: [],
      startLine,
      delimiter
    }
  }

  // First row is headers
  const headersRaw = rows[0]
  let dataRows = rows.slice(1)
  let unitRow: string[] | undefined

  // Check if second row is units
  if (dataRows.length > 0 && looksLikeUnitRow(dataRows[0])) {
    unitRow = dataRows[0]
    dataRows = dataRows.slice(1)
  }

  // Filter out stats rows from data
  dataRows = dataRows.filter(row => {
    const firstCell = row[0]?.toLowerCase().trim() || ''
    return ! isComputedStat(firstCell)
  })

  const headersNormalized = headersRaw.map(normalizeHeader)

  return {
    kind: 'table',
    headersRaw,
    headersNormalized,
    rows: dataRows,
    unitRow,
    startLine,
    delimiter
  }
}

// ============ SMART SPLIT (CSV-aware) ============

function smartSplit(line: string, delimiter: string): string[] {
  if (! line) return []

  // Handle quoted CSV
  if (delimiter === ',' || delimiter === ';') {
    return splitCsvLine(line, delimiter)
  }

  if (delimiter === '\t') return line.split('\t')
  if (delimiter === '|') return line.split('|').map(s => s.trim())
  if (delimiter === '  ') return line.split(/\s{2,}/)

  return line.split(delimiter)
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuote = !inQuote
      }
    } else if (! inQuote && ch === sep) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

// ============ UNIT ROW DETECTION ============

function looksLikeUnitRow(parts: string[]): boolean {
  if (! parts || parts.length === 0) return false

  let unitCount = 0
  let nonEmpty = 0

  for (const p of parts) {
    const s = p.trim()
    if (! s) continue
    nonEmpty++

    const low = s.toLowerCase()

    // Pure numbers are not units
    if (/^[+-]?\d+([.,]\d+)? $/.test(s)) continue

    // Check for unit indicators
    const hasUnit = UNIT_INDICATORS.some(u => low.includes(u)) ||
      (low.length <= 6 && /^[a-zµμ°/%\-/]+$/.test(low))

    if (hasUnit) unitCount++
  }

  return nonEmpty > 0 && unitCount >= Math.max(1, Math.round(nonEmpty * 0.5))
}

function mergeHeadersWithUnits(headers: string[], units: string[]): string[] {
  const result: string[] = []
  const offset = Math.max(0, headers.length - units.length)

  for (let i = 0; i < headers.length; i++) {
    const base = headers[i]?.trim() || ''
    const unitIdx = i - offset
    const unit = (unitIdx >= 0 && unitIdx < units.length) ?  units[unitIdx].trim() : ''

    if (unit && ! base.includes(unit)) {
      result.push(base ?  `${base} (${unit})` : unit)
    } else {
      result.push(base)
    }
  }

  return result
}

// ============ HEADER NORMALIZATION ============

function normalizeHeader(h: string): string {
  if (!h) return ''
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

// ============ FIELD TYPE INFERENCE ============

export function inferFieldType(header: string): ColumnType {
  const h = header.toLowerCase()

  if (/datum|date|time|čas|timestamp/.test(h)) return 'date'
  if (/bool|ano|ne|yes|no|true|false/.test(h)) return 'bool'
  if (/soubor|file|image|foto|picture|img/.test(h)) return 'file'
  if (/počet|count|id|index|pořadí/.test(h)) return 'int'
  if (/hodnota|value|měření|num|float|%|°|size|diameter|intensity/.test(h)) return 'float'

  return 'text'
}

export function inferFieldTypeFromSamples(samples: string[]): ColumnType {
  if (! samples || samples.length === 0) return 'text'

  let ints = 0
  let floats = 0
  let bools = 0
  let dates = 0
  let files = 0
  let n = 0

  for (const s of samples) {
    if (! s || s.trim() === '') continue
    n++
    const t = s.trim()

    if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2}\.\d{1,2}\.\d{4}/.test(t)) {
      dates++
    } else if (/^(true|false|1|0|yes|no|ano|ne)$/i.test(t)) {
      bools++
    } else if (/\.(png|jpg|jpeg|gif|pdf|csv|xlsx?)$/i.test(t) || /^https?:\/\//.test(t)) {
      files++
    } else if (/^[+-]?\d+$/.test(t)) {
      ints++
    } else if (/^[+-]? (\d+[.,]\d*|\d*[.,]\d+)$/.test(t)) {
      floats++
    }
  }

  if (n === 0) return 'text'
  const threshold = n * 0.6

  if (dates >= threshold) return 'date'
  if (bools >= threshold) return 'bool'
  if (files >= threshold) return 'file'
  if (ints + floats >= threshold) return floats > 0 ? 'float' : 'int'

  return 'text'
}

// ============ REPEAT SET DETECTION ============

export function buildRepeatMetaFromHeaders(headers: string[]): RepeatMeta {
  if (! headers || headers.length < 2) {
    return { repeatDetected: false, baseHeaders: headers || [], repeatCount: 1 }
  }

  const extractBase = (h: string): string => h.trim().replace(/\s+\d+$/u, '')
  const bases = headers.map(extractBase)
  const counts: Record<string, number> = {}

  for (const b of bases) {
    counts[b] = (counts[b] || 0) + 1
  }

  const repeatedEntries = Object.entries(counts).filter(([, count]) => count > 1)

  if (repeatedEntries.length === 0) {
    return { repeatDetected: false, baseHeaders: headers, repeatCount: 1 }
  }

  const maxRepeat = Math.max(...repeatedEntries.map(([, count]) => count))
  const uniqueBases = [...new Set(bases)]

  return {
    repeatDetected: true,
    baseHeaders: uniqueBases,
    repeatCount: maxRepeat
  }
}

// ============ IMPORT PROFILE MANAGEMENT (MEMORY) ============

export function loadImportProfiles(): ImportProfile[] {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    return raw ? JSON.parse(raw) as ImportProfile[] : []
  } catch {
    return []
  }
}

export function saveImportProfile(profile: ImportProfile): void {
  const profiles = loadImportProfiles()
  const existingIndex = profiles.findIndex(p => p.deviceCode === profile.deviceCode)

  const updatedProfile = { ...profile, lastUsed: Date.now() }

  if (existingIndex >= 0) {
    profiles[existingIndex] = updatedProfile
  } else {
    profiles.push(updatedProfile)
  }

  // Keep only last 20 profiles, sorted by lastUsed desc
  profiles.sort((a, b) => b.lastUsed - a.lastUsed)
  const toSave = profiles.slice(0, 20)

  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(toSave))
}

export function findMatchingProfile(headers: string[]): ImportProfile | null {
  const profiles = loadImportProfiles()
  if (profiles.length === 0 || ! headers.length) return null

  const normalizedInput = new Set(headers.map(normalizeHeader))

  let bestMatch: ImportProfile | null = null
  let bestScore = 0

  for (const profile of profiles) {
    const profileNorm = new Set(profile.typicalHeaders.map(normalizeHeader))
    let matches = 0

    for (const h of normalizedInput) {
      if (profileNorm.has(h)) matches++
    }

    const score = matches / Math.max(normalizedInput.size, profileNorm.size)

    if (score > bestScore && score >= 0.5) {
      bestScore = score
      bestMatch = profile
    }
  }

  return bestMatch
}

// ============ UTILITY EXPORTS ============

export { isComputedStat, normalizeHeader }
