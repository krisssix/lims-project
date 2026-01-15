/**
 * Helper struktury a funkce pro práci s vícero záznamy (records) v jednom měření.
 * Record = opakování stejné sady polí (definované šablonou).
 * Block = logické seskupení polí v rámci šablony (např."Základní měření", "Pokročilé parametry").
 *
 * Backend reprezentace: MeasurementValue s recordIndex a blockIndex.
 * Frontend: MeasurementRecord = { recordIndex; fields[] } kde fields odpovídají template fieldům.
 */

import { parseCzechDate } from '@/utils/czechDateParser'

export type ValueType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'

export interface RecordField {
  name: string
  type: ValueType
  required: boolean
  value: unknown
  blockIndex?: number | null
  blockTitle?: string | null
  orderIndex?: number | null
}

export interface MeasurementRecord {
  recordIndex: number
  fields: RecordField[]
}

export interface MeasuredValue {
  orderIndex: number
  recordIndex?: number | null
  blockIndex?: number | null
  name: string
  type: ValueType
  numberValue?: number | null
  textValue?: string | null
  boolValue?: boolean | null
  dateValue?: number | null
  fileUrl?: string | null
}

/* ---------- Block Types ---------- */

export interface TemplateBlockField {
  orderIndex: number
  type: ValueType
  required: boolean
  name: string
}

export interface TemplateBlock {
  id?: number
  blockIndex: number
  title: string
  kind?: 'table' | 'stats' | 'series' | 'kv'
  fields: TemplateBlockField[]
}

export interface BlockedRecord {
  recordIndex: number
  blocks: Array<{
    blockIndex: number
    blockTitle: string
    fields: RecordField[]
  }>
}

/* ---------- Converters ---------- */

/**
 * Převod matrix records -> plochý seznam MeasuredValue pro API.
 * Nyní zahrnuje blockIndex pro každou hodnotu.
 */
/**
 * Převod matrix records -> plochý seznam MeasuredValue pro API.
 * DŮLEŽITÉ: Nyní správně zahrnuje blockIndex pro každou hodnotu.
 */
export function flattenRecords(records: MeasurementRecord[]): MeasuredValue[] {
  const out: MeasuredValue[] = []

  for (const rec of records) {
    rec.fields.forEach((f, i) => {
      const mv: MeasuredValue = {
        orderIndex: i + 1,
        recordIndex: rec.recordIndex,
        blockIndex: f.blockIndex ?? 1,
        name: f.name,
        type: f.type
      }

      switch (f.type) {
        case 'float':
        case 'int': {
          const num = toNumber(f.value, f.type === 'int')
          mv.numberValue = num
          break
        }
        case 'bool':
          mv.boolValue = normalizeBool(f.value)
          break
        case 'date':
          mv.dateValue = toDateMs(f.value)
          break
        case 'file':
          mv.fileUrl =
            f.value && typeof f.value === 'object' && 'name' in (f.value as Record<string, unknown>)
              ? String((f.value as { name?: unknown }).name)
              : (typeof f.value === 'string' ? f.value : null)
          break
        case 'text':
        default:
          mv.textValue = f.value != null ? String(f.value) : null
      }

      out.push(mv)
    })
  }

  return out
}
/**
 * Převod plochého seznamu hodnot z API -> map records.
 * Zachovává blockIndex pro pozdější seskupení.
 */
/**
 * Převod plochého seznamu hodnot z API -> map records.
 * Zachovává blockIndex pro pozdější seskupení.
 */
export function groupValuesToRecords(values: MeasuredValue[]): MeasurementRecord[] {
  const map = new Map<number, MeasurementRecord>()

  for (const v of values) {
    const ri = v.recordIndex ?? 1
    if (!map.has(ri)) {
      map.set(ri, { recordIndex: ri, fields: [] })
    }

    map.get(ri)!.fields.push({
      name: v.name,
      type: v.type,
      required: true,
      blockIndex: v.blockIndex ?? 1,
      blockTitle: null, // Backend neposílá blockTitle, ale blockIndex stačí
      orderIndex: v.orderIndex, // Preserve original order from API
      value:
        v.type === 'float' || v.type === 'int'
          ? v.numberValue
          : v.type === 'bool'
            ? v.boolValue
            : v.type === 'date'
              ? v.dateValue
              : v.type === 'file'
                ? v.fileUrl
                : v.textValue
    })
  }

  // Seřadit pole uvnitř recordu podle blockIndex a pak orderIndex
  const records = [...map.values()]
  records.forEach(r => {
    r.fields.sort((a, b) => {
      const blockDiff = (a.blockIndex ?? 1) - (b.blockIndex ?? 1)
      if (blockDiff !== 0) return blockDiff
      // Use orderIndex to preserve original upload order
      return (a.orderIndex ?? 0) - (b.orderIndex ?? 0)
    })
  })

  return records.sort((a, b) => a.recordIndex - b.recordIndex)
}

/**
 * Seskupí record fields podle bloků pro zobrazení v UI.
 */
export function groupRecordByBlocks(
  record: MeasurementRecord,
  templateBlocks: TemplateBlock[]
): BlockedRecord {
  const blocksMap = new Map<number, { blockIndex: number; blockTitle: string; fields: RecordField[] }>()

  // Inicializovat bloky ze šablony
  for (const block of templateBlocks) {
    blocksMap.set(block.blockIndex, {
      blockIndex: block.blockIndex,
      blockTitle: block.title || `Tabulka hodnot ${block.blockIndex}`,
      fields: []
    })
  }

  // Přiřadit pole do bloků
  for (const field of record.fields) {
    const blockIdx = field.blockIndex ?? 1

    if (!blocksMap.has(blockIdx)) {
      // Fallback Tabulka hodnot pokud neexistuje v šabloně
      blocksMap.set(blockIdx, {
        blockIndex: blockIdx,
        blockTitle: `Tabulka hodnot ${blockIdx}`,
        fields: []
      })
    }

    blocksMap.get(blockIdx)!.fields.push(field)
  }

  return {
    recordIndex: record.recordIndex,
    blocks: [...blocksMap.values()].sort((a, b) => a.blockIndex - b.blockIndex)
  }
}

/**
 * Vrátí pole pouze pro konkrétní Tabulka hodnot.
 */
export function getFieldsForBlock(record: MeasurementRecord, blockIndex: number): RecordField[] {
  return record.fields.filter(f => (f.blockIndex ?? 1) === blockIndex)
}

/* ---------- Field factory ---------- */

/**
 * Vytvoří nový prázdný record podle template field definic.
 * Nyní podporuje bloky - přiřadí blockIndex každému poli.
 */
export function newRecordFromTemplateFields(
  recordIndex: number,
  templateFields: Array<{ name: string; type: ValueType; required: boolean; blockIndex?: number; blockTitle?: string }>
): MeasurementRecord {
  return {
    recordIndex,
    fields: templateFields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      blockIndex: f.blockIndex ?? 1,
      blockTitle: f.blockTitle ?? null,
      value: initialValueForType(f.type)
    }))
  }
}

/**
 * Vytvoří nový record z bloků šablony.
 */
export function newRecordFromBlocks(
  recordIndex: number,
  blocks: TemplateBlock[]
): MeasurementRecord {
  const fields: RecordField[] = []

  for (const block of blocks) {
    for (const field of block.fields) {
      fields.push({
        name: field.name,
        type: field.type,
        required: field.required,
        blockIndex: block.blockIndex,
        blockTitle: block.title,
        value: initialValueForType(field.type)
      })
    }
  }

  return { recordIndex, fields }
}

/**
 * Flatten bloků do pole template fields (pro kompatibilitu se starším kódem).
 */
export function flattenBlocksToFields(
  blocks: TemplateBlock[]
): Array<{ name: string; type: ValueType; required: boolean; blockIndex: number; blockTitle: string }> {
  const fields: Array<{ name: string; type: ValueType; required: boolean; blockIndex: number; blockTitle: string }> = []

  for (const block of blocks) {
    for (const field of block.fields) {
      fields.push({
        name: field.name,
        type: field.type,
        required: field.required,
        blockIndex: block.blockIndex,
        blockTitle: block.title
      })
    }
  }

  return fields
}

/* ---------- Value utilities ---------- */

function initialValueForType(t: ValueType): unknown {
  switch (t) {
    case 'float':
    case 'int':
      return null
    case 'bool':
      return null
    case 'date':
      return null
    case 'file':
      return null
    case 'text':
    default:
      return ''
  }
}

export function toNumber(raw: unknown, integer: boolean): number | null {
  if (raw === '' || raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = String(raw).replace(',', '.').trim()
  if (!s.length) return null
  const n = integer ? parseInt(s, 10) : parseFloat(s)
  return Number.isFinite(n) ? n : null
}

export function normalizeBool(raw: unknown): boolean | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'boolean') return raw
  const s = String(raw).trim().toLowerCase()
  if (['1', 'true', 'ano', 'a', 'yes', 'y', 't'].includes(s)) return true
  if (['0', 'false', 'ne', 'n', 'no', 'f'].includes(s)) return false
  return null
}

export function toDateMs(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (raw instanceof Date) return raw.getTime()
  if (typeof raw === 'string') {
    // Try Czech date parser first (handles "4. října 2022 16:58:51")
    try {
      const parsed = parseCzechDate(raw)
      if (parsed.success && parsed.date) {
        return parsed.date.getTime()
      }
    } catch {
      // Fallback if parser fails
    }
    // Fallback to standard Date.parse
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

/* ---------- Stats & Outliers ---------- */

export interface BasicStats {
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
  count: number
}

export function computeBasicStats(values: number[]): BasicStats | null {
  if (!values.length) return null
  const count = values.length
  const mean = values.reduce((a, b) => a + b, 0) / count
  const sorted = [...values].sort((a, b) => a - b)
  const median =
    count % 2
      ? sorted[(count - 1) / 2]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2
  const variance =
    count > 1
      ? values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (count - 1)
      : 0
  const stdDev = Math.sqrt(variance)
  return {
    mean,
    median,
    stdDev,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    count
  }
}

export interface IqrOutliers {
  outlierIndexes: number[]
  lowerFence: number
  upperFence: number
  q1: number
  q3: number
}

export function detectOutliersIqr(values: number[]): IqrOutliers {
  if (values.length < 4) {
    return {
      outlierIndexes: [],
      lowerFence: NaN,
      upperFence: NaN,
      q1: NaN,
      q3: NaN
    }
  }
  const s = [...values].sort((a, b) => a - b)
  const quantile = (p: number): number => {
    const pos = (s.length - 1) * p
    const base = Math.floor(pos)
    const rest = pos - base
    return s[base + 1] !== undefined
      ? s[base] + rest * (s[base + 1] - s[base])
      : s[base]
  }
  const q1 = quantile(0.25)
  const q3 = quantile(0.75)
  const iqr = q3 - q1 || 1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr
  const outlierIndexes: number[] = []
  values.forEach((v, i) => {
    if (v < lowerFence || v > upperFence) outlierIndexes.push(i)
  })
  return { outlierIndexes, lowerFence, upperFence, q1, q3 }
}

/* ---------- Series extraction ---------- */

/**
 * Vrátí hodnoty jednoho pole napříč všemi recordy.
 */
export function extractSeries(records: MeasurementRecord[], fieldName: string): number[] {
  const out: number[] = []
  for (const rec of records) {
    const f = rec.fields.find(ff => ff.name === fieldName)
    if (!f) continue
    if (f.type === 'float' || f.type === 'int') {
      const num = typeof f.value === 'number'
        ? f.value
        : toNumber(f.value, f.type === 'int')
      if (num != null) out.push(num)
    } else if (f.type === 'text') {
      const maybe = toNumber(f.value, false)
      if (maybe != null) out.push(maybe)
    }
    // ostatní typy ignorujeme (bool/date/file)
  }
  return out
}

/**
 * Vrátí hodnoty pole z konkrétního bloku napříč všemi recordy.
 */
export function extractSeriesFromBlock(
  records: MeasurementRecord[],
  fieldName: string,
  blockIndex: number
): number[] {
  const out: number[] = []
  for (const rec of records) {
    const f = rec.fields.find(ff => ff.name === fieldName && (ff.blockIndex ?? 1) === blockIndex)
    if (!f) continue
    if (f.type === 'float' || f.type === 'int') {
      const num = typeof f.value === 'number'
        ? f.value
        : toNumber(f.value, f.type === 'int')
      if (num != null) out.push(num)
    } else if (f.type === 'text') {
      const maybe = toNumber(f.value, false)
      if (maybe != null) out.push(maybe)
    }
  }
  return out
}

/**
 * Odstraní recordy, které nemají žádný numeric value pro dané pole (volitelné).
 */
export function filterRecordsWithNumericField(records: MeasurementRecord[], fieldName: string): MeasurementRecord[] {
  return records.filter(r => {
    const f = r.fields.find(ff => ff.name === fieldName)
    if (!f) return false
    if (f.type === 'float' || f.type === 'int') {
      return toNumber(f.value, f.type === 'int') != null
    }
    if (f.type === 'text') {
      return toNumber(f.value, false) != null
    }
    return false
  })
}

/* ---------- Editable operations ---------- */

export function duplicateRecord(source: MeasurementRecord, newIndex: number): MeasurementRecord {
  return {
    recordIndex: newIndex,
    fields: source.fields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      blockIndex: f.blockIndex,
      blockTitle: f.blockTitle,
      value: cloneValue(f.value)
    }))
  }
}

function cloneValue(v: unknown): unknown {
  if (v == null) return v
  if (v instanceof Date) return new Date(v.getTime())
  if (typeof v === 'object') {
    // File nebo Blob nepřekopírováváme – necháme null (ochrana)
    if (v instanceof File || v instanceof Blob) return null
    // Prostý object → shallow clone
    return { ...(v as Record<string, unknown>) }
  }
  return v
}

/**
 * Aktualizace hodnoty jednoho fieldu v recordu (immutable friendly pokud bys chtěl).
 */
export function setFieldValue(
  record: MeasurementRecord,
  fieldName: string,
  newValue: unknown
): MeasurementRecord {
  return {
    recordIndex: record.recordIndex,
    fields: record.fields.map(f =>
      f.name === fieldName ? { ...f, value: newValue } : f
    )
  }
}

/**
 * Aktualizace hodnoty fieldu v konkrétním bloku.
 */
export function setFieldValueInBlock(
  record: MeasurementRecord,
  fieldName: string,
  blockIndex: number,
  newValue: unknown
): MeasurementRecord {
  return {
    recordIndex: record.recordIndex,
    fields: record.fields.map(f =>
      f.name === fieldName && (f.blockIndex ?? 1) === blockIndex
        ? { ...f, value: newValue }
        : f
    )
  }
}

/**
 * Validace jednoho fieldu podle jeho typu + required.
 */
export function validateField(field: RecordField): string | null {
  if (!field.required) return null
  switch (field.type) {
    case 'float':
      return toNumber(field.value, false) != null ? null : 'Neplatné číslo'
    case 'int':
      return toNumber(field.value, true) != null ? null : 'Neplatné celé číslo'
    case 'bool': {
      const b = normalizeBool(field.value)
      return b === null ? 'Vyžadováno' : null
    }
    case 'date': {
      const ms = toDateMs(field.value)
      return ms != null ? null : 'Neplatné datum'
    }
    case 'file':
      return field.value != null ? null : 'Vyžadován soubor'
    case 'text':
    default: {
      const s = (field.value == null ? '' : String(field.value)).trim()
      return s.length ? null : 'Vyžadováno'
    }
  }
}

/**
 * Validace celého recordu.
 */
export function validateRecord(record: MeasurementRecord): { errors: Record<string, string>; valid: boolean } {
  const errors: Record<string, string> = {}
  record.fields.forEach(f => {
    const err = validateField(f)
    if (err) errors[f.name] = err
  })
  return { errors, valid: Object.keys(errors).length === 0 }
}

/**
 * Validace polí v konkrétním bloku.
 */
export function validateBlock(record: MeasurementRecord, blockIndex: number): { errors: Record<string, string>; valid: boolean } {
  const errors: Record<string, string> = {}
  const blockFields = record.fields.filter(f => (f.blockIndex ?? 1) === blockIndex)

  blockFields.forEach(f => {
    const err = validateField(f)
    if (err) errors[f.name] = err
  })

  return { errors, valid: Object.keys(errors).length === 0 }
}

/**
 * Bulk validace všech záznamů.
 */
export function validateAllRecords(records: MeasurementRecord[]): {
  perRecord: Array<{ recordIndex: number; errors: Record<string, string>; valid: boolean }>
  overallValid: boolean
} {
  const perRecord = records.map(r => {
    const vr = validateRecord(r)
    return { recordIndex: r.recordIndex, errors: vr.errors, valid: vr.valid }
  })
  return { perRecord, overallValid: perRecord.every(r => r.valid) }
}

/**
 * Počet vyplněných polí v bloku.
 */
export function countFilledFieldsInBlock(record: MeasurementRecord, blockIndex: number): { filled: number; total: number } {
  const blockFields = record.fields.filter(f => (f.blockIndex ?? 1) === blockIndex)
  const filled = blockFields.filter(f => {
    if (f.value == null) return false
    if (typeof f.value === 'string' && f.value.trim() === '') return false
    return true
  }).length

  return { filled, total: blockFields.length }
}

/**
 * Získá unikátní bloky z recordu.
 */
export function getUniqueBlocks(record: MeasurementRecord): Array<{ blockIndex: number; blockTitle: string | null }> {
  const seen = new Map<number, string | null>()

  for (const field of record.fields) {
    const idx = field.blockIndex ?? 1
    if (!seen.has(idx)) {
      seen.set(idx, field.blockTitle ?? null)
    }
  }

  return [...seen.entries()]
    .map(([blockIndex, blockTitle]) => ({ blockIndex, blockTitle }))
    .sort((a, b) => a.blockIndex - b.blockIndex)
}
