export function pad2(n: number) { return String(n).padStart(2, '0') }
export function toYmdLocal(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

export function normalizeToDate(v: string | Date | null): Date {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 0, 0, 0, 0)
  if (typeof v === 'string') return new Date(v)
  return new Date()
}

export function toMs(v: unknown): number {
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    if (!Number.isNaN(ms)) return ms
  }
  return NaN
}

export function formatLocal(ts: unknown): string {
  const ms = toMs(ts)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  })
}

export function dayBoundsLocal(val: string | Date) {
  const base = (val instanceof Date)
    ? val
    : (/^\d{4}-\d{2}-\d{2}$/.test(val) ? new Date(val + 'T00:00:00') : new Date(val))
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0).getTime()
  const end   = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999).getTime()
  return { start, end }
}
