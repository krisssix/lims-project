/**
 * převod libovolné hodnoty (number|string|date) na milisekundy.
 * vrací nan pokud není možné převést.
 */
function toMillis(src: number | string | Date): number {
  if (typeof src === 'number') return src
  if (src instanceof Date) return src.getTime()
  if (typeof src === 'string') {
    const trimmed = src.trim()
    if (!trimmed) return NaN
    // podpora iso nebo pouze číslo (už je v ms)
    const asNumber = Number(trimmed)
    if (!Number.isNaN(asNumber)) return asNumber
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? NaN : parsed
  }
  return NaN
}

export function formatDateFromTimestamp(timestamp: number | string | Date): string {
  const ms = toMillis(timestamp)
  if (Number.isNaN(ms)) return ''
  const date = new Date(ms)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}.${month}. ${year}`
}

export function formatTimeFromTimestamp(timestamp: number | string | Date): string {
  const ms = toMillis(timestamp)
  if (Number.isNaN(ms)) return ''
  const date = new Date(ms)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * formátuje dobu (ms) na hh:mm:ss.
 * vrací prázdný řetězec pro záporné nebo nan.
 */
export function formatMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return ''
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

/**
 * zkrácený formát trvání pro ui (např. 1h 05m, 05m 07s).
 */
export function formatDurationBrief(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return ''
  const totalSeconds = Math.floor(durationMs / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/**
 * iso-like bezpečný formát (yyyy-mm-dd) – vhodný pro exporty.
 */
export function formatYmd(timestamp: number | string | Date): string {
  const ms = toMillis(timestamp)
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * kombinace datum + čas (yyyy-mm-dd hh:mm) – vhodné pro logování.
 */
export function formatYmdHm(timestamp: number | string | Date): string {
  const ms = toMillis(timestamp)
  if (Number.isNaN(ms)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
