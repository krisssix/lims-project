const UNIT_REGEX = /^([a-zA-Z°µμ%\/.\-]+|\d*\.?\d+\s*[a-zA-Z%]+)$/u

export function isProbableUnitRow(cells: string[]): boolean {
  if (!cells.length) return false
  let matches = 0
  for (const c of cells) {
    const trimmed = c.trim()
    if (!trimmed) continue
    if (UNIT_REGEX.test(trimmed) && trimmed.length <= 12) matches++
  }
  const ratio = matches / cells.length
  return ratio >= 0.6
}
