export type FieldType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date' | 'time' | 'datetime'

function includesOne(haystack: string, needles: string[]): boolean {
  const s = haystack.toLowerCase()
  return needles.some(n => s.includes(n))
}

function headerHeuristic(headerRaw: string): FieldType | null {
  const h = headerRaw.trim().toLowerCase()
  if (includesOne(h, ['date', 'datum', 'time', 'čas', 'measurement date'])) return 'date'
  if (includesOne(h, ['yes/no', 'true/false', 'boolean'])) return 'bool'
  if (includesOne(h, ['file', 'image', 'screenshot'])) return 'file'
  if (includesOne(h, ['count', 'number ']) || /^number\b/u.test(h)) return 'int'
  if (includesOne(h, ['mean', 'avg', 'average', 'size', 'z-average', 'pdi', 'intensity', 'volume', 'number', 'peak'])) return 'float'
  return null
}

export function inferFieldType(detectedTypeRaw: string | undefined, headerRaw: string | undefined): FieldType {
  const dt = (detectedTypeRaw || '').trim().toLowerCase()
  const h = (headerRaw || '').trim()
  switch (dt) {
    case 'float': case 'double': case 'decimal': case 'number': case 'numeric': case 'real': case 'float64': case 'float32':
      return 'float'
    case 'int': case 'integer': case 'int32': case 'int64':
      return 'int'
    case 'bool': case 'boolean':
      return 'bool'
    case 'date': case 'datetime': case 'timestamp':
      return 'date'
    case 'file': case 'binary': case 'blob':
      return 'file'
    case 'text': case 'string': case 'varchar': case 'unknown': case 'empty':
      break
    default:
      break
  }
  const viaHeader = headerHeuristic(h)
  if (viaHeader) return viaHeader
  return 'text'
}
