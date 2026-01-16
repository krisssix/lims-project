export type ResItem = {
  id: number
  title: string
  deviceId: string
  start: string
  end: string
  status: 'plan' | 'running' | 'done'
  username: string | null
  note: string | null
}

export type Slot = { start: Date; end: Date }
export type Gap = { start: Date; end: Date }

function toMs(d: Date): number { return d.getTime() }
function fromIsoLocal(s: string): Date {
  // s ve formátu rrrr-mm-ddthh:mm:ss
  return new Date(s)
}

export function overlaps(a: Slot, b: Slot): boolean {
  return toMs(a.end) > toMs(b.start) && toMs(a.start) < toMs(b.end)
}

export function buildDayGaps(eventsForDevice: ResItem[], dayBase: Date): Gap[] {
  const dayStart = new Date(dayBase); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayBase); dayEnd.setHours(24, 0, 0, 0)

  const sorted = [...eventsForDevice]
    .map(e => ({ start: fromIsoLocal(e.start), end: fromIsoLocal(e.end) }))
    .sort((a, b) => toMs(a.start) - toMs(b.start))

  const gaps: Gap[] = []
  let cursor = dayStart
  for (const ev of sorted) {
    if (toMs(ev.start) > toMs(cursor)) {
      gaps.push({ start: new Date(cursor), end: new Date(ev.start) })
    }
    if (toMs(ev.end) > toMs(cursor)) cursor = new Date(ev.end)
  }
  if (toMs(cursor) < toMs(dayEnd)) gaps.push({ start: new Date(cursor), end: new Date(dayEnd) })

  return gaps
}

export function proposeSlotsAround(target: Slot, gaps: Gap[]): Slot[] {
  const durationMs = Math.max(0, toMs(target.end) - toMs(target.start))
  const proposals: Slot[] = []

  // „po“: první mezera, jejíž začátek >= target.start a vejde se délka
  const after = gaps.find(g => toMs(g.start) >= toMs(target.start) && (toMs(g.end) - toMs(g.start)) >= durationMs)
  if (after) proposals.push({ start: new Date(after.start), end: new Date(after.start.getTime() + durationMs) })

  // „před“: poslední mezera, jejíž konec <= target.end a vejde se délka
  const beforeCandidates = gaps.filter(g => toMs(g.end) <= toMs(target.end) && (toMs(g.end) - toMs(g.start)) >= durationMs)
  const before = beforeCandidates.length ? beforeCandidates[beforeCandidates.length - 1] : undefined
  if (before) proposals.push({ start: new Date(before.end.getTime() - durationMs), end: new Date(before.end) })

  return proposals
}

export function addDays(base: Date, n: number): Date {
  const d = new Date(base); d.setDate(d.getDate() + n); return d
}

export function firstGapNextDays(
  getEventsForDayDevice: (day: Date, deviceId: string) => ResItem[],
  baseDay: Date,
  deviceId: string,
  durationMs: number,
  maxScanDays = 30
): { day: Date; slot: Slot } | null {
  for (let i = 1; i <= maxScanDays; i++) {
    const day = addDays(baseDay, i)
    const gaps = buildDayGaps(getEventsForDayDevice(day, deviceId), day)
    const g = gaps.find(gg => (toMs(gg.end) - toMs(gg.start)) >= durationMs)
    if (g) return { day, slot: { start: new Date(g.start), end: new Date(g.start.getTime() + durationMs) } }
  }
  return null
}
