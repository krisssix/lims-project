export function normalizeHeader(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  return s
    .replace(/[()<>[\]{}⟨⟩]/g, ' ')
    .replace(/[°µμ]/g, ' ') // jednotky pryč pro identifikátor
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_/, '')
    .replace(/_$/, '')
    .toLowerCase()
}
