export type StatsObj = {
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
  count: number
}

export type OutliersMeta = {
  outlierIndexes: number[]
  lowerFence: number
  upperFence: number
  q1: number
  q3: number
}

function toNumberSafe(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (!s) return null
  // povolení čárky jako oddělovače desetinných míst (allow comma)
  const normalized = s.replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}


export type MultiSeriesItem = {
  label: string
  points: number[]
  color?: string
  colorAssigned?: string // přidané pro interní logiku (internal logic)
}

// Helper pro formátování
export function fmt2(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '-'
}

export function niceNumber(x: number): string {
  if (!Number.isFinite(x)) return ''
  const abs = Math.abs(x)
  if (abs >= 1000 || abs < 0.01) return x.toExponential(1)
  if (abs >= 100) return x.toFixed(0)
  if (abs >= 10) return x.toFixed(1)
  return x.toFixed(2)
}


/* základní pomocné funkce operující na poli čísel (math helpers) */
export function mean(values: number[]): number {
  if (!values.length) return NaN
  const sum = values.reduce((acc, x) => acc + x, 0)
  return sum / values.length
}

export function median(values: number[]): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  if (n % 2 === 1) return s[(n - 1) / 2]!
  return (s[n / 2 - 1]! + s[n / 2]!) / 2
}

/**
 * výběrová směrodatná odchylka (sample standard deviation, dělíme n-1 pokud n > 1).
 * pokud je délka pole 1 nebo méně, vrací 0 (nulový rozptyl).
 */
export function std(values: number[]): number {
  if (values.length <= 1) return 0
  const m = mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/**
 * hlavní funkce pro výpočet statistik: přijme seznam hodnot (může obsahovat i řetězce), 
 * převede je na čísla a vrátí objekt statistik (statsobj).
 * - převádí pomocí tonumbersafe
 * - filtruje neplatné hodnoty (null)
 * - pokud nejsou žádná čísla, vrací count=0 a číselná pole jako nan
 */
export function computeBasicStats(rawValues: Array<number | string | null | undefined>): StatsObj {
  const nums: number[] = rawValues
    .map(v => toNumberSafe(v))
    .filter((n): n is number => n !== null)

  const count = nums.length
  if (count === 0) {
    return { mean: NaN, median: NaN, stdDev: NaN, min: NaN, max: NaN, count: 0 }
  }

  const m = mean(nums)
  const med = median(nums)
  const s = std(nums)
  const mn = Math.min(...nums)
  const mx = Math.max(...nums)

  return { mean: m, median: med, stdDev: s, min: mn, max: mx, count }
}
