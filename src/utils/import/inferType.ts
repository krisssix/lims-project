export type PrimitiveType = 'int' | 'float' | 'bool' | 'date' | 'file' | 'text'

const BOOL_VALUES_TRUE = new Set(['true','1','yes','y','ano','a','t'])
const BOOL_VALUES_FALSE = new Set(['false','0','no','n','ne','f'])

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
  /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(:\d{2})?$/ // with time
]

const FILE_HINTS = /\.(png|jpe?g|tiff?|gif|bmp|csv|xlsx?|pdf|txt)$/i

export function inferType(samples: string[]): PrimitiveType {
  const nonEmpty = samples.filter(s => s.trim().length)
  if (!nonEmpty.length) return 'text'

  let intCount = 0
  let floatCount = 0
  let boolCount = 0
  let dateCount = 0
  let fileCount = 0

  for (const raw of nonEmpty) {
    const s = raw.trim()
    if (/^[+-]?\d+$/.test(s)) { intCount++; continue }
    const replaced = s.replace(',', '.')
    if (/^[+-]?\d+(\.\d+)?$/.test(replaced)) { floatCount++; continue }
    if (BOOL_VALUES_TRUE.has(s.toLowerCase()) || BOOL_VALUES_FALSE.has(s.toLowerCase())) { boolCount++; continue }
    if (DATE_PATTERNS.some(rx => rx.test(s))) { dateCount++; continue }
    if (FILE_HINTS.test(s) || /^https?:\/\//.test(s) || /^file:\/\//.test(s)) { fileCount++; continue }
  }

  const total = nonEmpty.length
  const pct = (c: number) => c / total

  if (pct(intCount) >= 0.8) return 'int'
  if (pct(floatCount + intCount) >= 0.8) return 'float'
  if (pct(boolCount) >= 0.8) return 'bool'
  if (pct(dateCount) >= 0.6) return 'date'
  if (pct(fileCount) >= 0.6) return 'file'
  return 'text'
}
