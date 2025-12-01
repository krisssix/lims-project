export type RawFileKind = 'csv' | 'tsv' | 'txt' | 'xlsx' | 'xls' | 'unknown'

export interface KeyValueMeta {
  key: string
  value: string
  lineNumber: number
}

export interface ParsedBlock {
  blockIndex: number
  title: string | null
  header: string[]
  unitRow?: string[] | null
  rows: string[][]
  stats?: ColumnStatsMap
}

export interface ColumnStats {
  count: number
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
  numericRate: number
}

export type ColumnStatsMap = Record<string, ColumnStats>

export interface FileParseResult {
  fileName: string
  kind: RawFileKind
  delimiter: string
  originalText?: string
  blocks: ParsedBlock[]
  meta: KeyValueMeta[]
  warnings: string[]
  errors: string[]
  headerConfidence: number
  usedSecondLineAsUnits: boolean
}

export type InferredValueType = 'int' | 'float' | 'bool' | 'date' | 'file' | 'text'

export interface InferredColumn {
  name: string
  normalizedName: string
  originalName: string
  type: InferredValueType
  unit?: string | null
  index: number
  stats?: ColumnStats
}

export interface TemplateDraft {
  name: string
  deviceId: string
  columns: InferredColumn[]
  blocks: {
    blockIndex: number
    title: string
    fields: InferredColumn[]
  }[]
}

export interface MeasurementRecordDraft {
  recordIndex: number
  fields: {
    name: string
    type: InferredValueType
    value: unknown
    blockIndex: number
    blockTitle?: string
  }[]
}

export interface MeasurementImportPreview {
  templateDraft: TemplateDraft
  records: MeasurementRecordDraft[]
  meta: KeyValueMeta[]
  delimiter: string
  sourceFile: string
}
