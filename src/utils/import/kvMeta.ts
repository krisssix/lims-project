const KV_REGEX = /^([^:]+):\s*(.+)$/u

export function extractKeyValueMeta(lines: string[]): { meta: { key: string; value: string; lineNumber: number }[]; remaining: string[] } {
  const meta: { key: string; value: string; lineNumber: number }[] = []
  const remaining: string[] = []
  lines.forEach((line, idx) => {
    const m = line.match(KV_REGEX)
    if (m) {
      meta.push({ key: m[1].trim(), value: m[2].trim(), lineNumber: idx })
    } else {
      remaining.push(line)
    }
  })
  return { meta, remaining }
}
