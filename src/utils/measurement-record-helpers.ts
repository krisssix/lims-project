/**
 * Helper struktury a funkce pro práci s vícero záznamy (records) v jednom měření.
 * Record = opakování stejné sady polí (definované šablonou).
 *
 * Backend reprezentace: MeasurementValue s recordIndex.
 * Frontend: MeasurementRecord = { recordIndex; fields[] } kde fields odpovídají template fieldům.
 */

export type ValueType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'

export interface RecordField {
  name: string
  type: ValueType
  required: boolean
  value: unknown
}

export interface MeasurementRecord {
  recordIndex: number
  fields: RecordField[]
}

export interface MeasuredValue {
  orderIndex: number
  recordIndex?: number | null
  name: string
  type: ValueType
  numberValue?: number | null
  textValue?: string | null
  boolValue?: boolean | null
  dateValue?: number | null
  fileUrl?: string | null
}

/* ---------- Converters ---------- */

/**
 * Převod matrix records -> plochý seznam MeasuredValue pro API.
 */
export function flattenRecords(records: MeasurementRecord[]): MeasuredValue[] {
  const out: MeasuredValue[] = []
  for (const rec of records) {
    rec.fields.forEach((f, i) => {
      const mv: MeasuredValue = {
        orderIndex: i + 1,
        recordIndex: rec.recordIndex,
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
  // Seřadit pole uvnitř recordu podle jména (nebo lze dle původního orderIndex pokud ho přidáš do DTO)
  const records = [...map.values()]
  records.forEach(r => {
    r.fields.sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  })
  return records.sort((a, b) => a.recordIndex - b.recordIndex)
}

/* ---------- Field factory ---------- */

/**
 * Vytvoří nový prázdný record podle template field definic.
 */
export function newRecordFromTemplateFields(
  recordIndex: number,
  templateFields: Array<{ name: string; type: ValueType; required: boolean }>
): MeasurementRecord {
  return {
    recordIndex,
    fields: templateFields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      value: initialValueForType(f.type)
    }))
  }
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
 * Bulk validace všech recordů.
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
