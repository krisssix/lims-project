const COMMON_DELIMITERS = [',', ';', '\t', '|']

export interface DelimiterDetection {
  delimiter: string
  scoreMap: Record<string, number>
}

export function detectDelimiter(lines: string[], hint?: string): DelimiterDetection {
  if (hint && COMMON_DELIMITERS.includes(hint)) {
    return { delimiter: hint, scoreMap: { [hint]: 1 } }
  }
  const sample = lines.slice(0, Math.min(20, lines.length))
  const scores: Record<string, number> = {}
  for (const d of COMMON_DELIMITERS) {
    let consistency = 0
    let prevCount: number | null = null
    for (const line of sample) {
      const count = line.split(d).length
      if (prevCount === null) prevCount = count
      else if (count === prevCount) consistency++
    }
    scores[d] = consistency / Math.max(1, sample.length - 1)
  }
  // Pokud tab dosáhne aspoň 0.6 preferuj ho; jinak max
  const bestDelimiter = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ','
  return { delimiter: bestDelimiter, scoreMap: scores }
}
