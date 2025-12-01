export interface BasicStats {
  count: number
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
}

export function computeStats(values: (string | number)[]): BasicStats {
  const nums = values
    .map(v => {
      if (typeof v === 'number') return v
      const s = v.trim().replace(',', '.')
      const n = parseFloat(s)
      return Number.isFinite(n) ? n : NaN
    })
    .filter(n => Number.isFinite(n)) as number[]

  if (!nums.length) {
    return { count: 0, mean: NaN, median: NaN, stdDev: NaN, min: NaN, max: NaN }
  }
  const count = nums.length
  const sum = nums.reduce((a, b) => a + b, 0)
  const mean = sum / count
  const sorted = [...nums].sort((a, b) => a - b)
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const variance = nums.reduce((acc, n) => acc + (n - mean) * (n - mean), 0) / Math.max(1, count - 1)
  const stdDev = Math.sqrt(variance)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  return { count, mean, median, stdDev, min, max }
}
