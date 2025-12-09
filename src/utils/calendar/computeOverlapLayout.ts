export type CalEvent = {
  id: number
  startMs: number
  endMs: number
}

export type EventLayout = Record<number, { left: number; width: number }>

/**
 * Stabilní layout překryvů: události ve stejných "clusterch" (překrývajících se v čase)
 * rozdělí do sloupců tak, aby se nekryly.
 * - Seřadí eventy podle start, tie-break end.
 * - Staví sloupce greedily: event jde do prvního sloupce, kde nekoliduje.
 * - left/width vypočítá z celkového počtu sloupců v clusteru.
 * - Nepoužívá žádnou normalizaci pozic (žádný “návrat” pro kolize).
 */
export function computeOverlapLayout(events: CalEvent[]): EventLayout {
  // Normalize and sort
  const evs = [...events].sort((a, b) =>
    a.startMs === b.startMs ? a.endMs - b.endMs : a.startMs - b.startMs
  )

  // Cluster builder: group overlapping events into clusters
  type Cluster = CalEvent[]
  const clusters: Cluster[] = []
  let current: Cluster = []

  function overlaps(a: CalEvent, b: CalEvent): boolean {
    return a.startMs < b.endMs && b.startMs < a.endMs
  }

  for (const e of evs) {
    if (!current.length) {
      current.push(e)
      continue
    }
    const lastEnd = Math.max(...current.map(x => x.endMs))
    if (e.startMs < lastEnd) {
      // still overlapping cluster
      current.push(e)
    } else {
      // close previous cluster and start new
      clusters.push(current)
      current = [e]
    }
  }
  if (current.length) clusters.push(current)

  const layout: EventLayout = {}

  // Within each cluster, assign columns
  for (const c of clusters) {
    // columns[i] = last event in that column (to test overlap)
    const columns: CalEvent[][] = []

    for (const e of c) {
      let placedCol = -1
      for (let ci = 0; ci < columns.length; ci++) {
        const lastEv = columns[ci][columns[ci].length - 1]
        if (!overlaps(lastEv, e)) {
          placedCol = ci
          break
        }
      }
      if (placedCol === -1) {
        columns.push([e])
        placedCol = columns.length - 1
      } else {
        columns[placedCol].push(e)
      }
    }

    const colCount = Math.max(1, columns.length)
    for (let ci = 0; ci < columns.length; ci++) {
      const colEvents = columns[ci]
      const left = ci / colCount
      const width = 1 / colCount
      for (const e of colEvents) {
        layout[e.id] = { left, width }
      }
    }
  }

  return layout
}

/**
 * Pomocný builder pro zařízení: přijme seznam událostí pro jedno deviceId.
 */
export function layoutForDeviceEvents(items: Array<{ id: number; start: string; end: string }>): EventLayout {
  const data: CalEvent[] = items.map(i => ({
    id: i.id,
    startMs: new Date(i.start).getTime(),
    endMs: new Date(i.end).getTime(),
  }))
  return computeOverlapLayout(data)
}

/**
 * Pomocný builder pro den: přijme seznam událostí pro konkrétní den.
 */
export function layoutForDayEvents(items: Array<{ id: number; start: string; end: string }>): EventLayout {
  const data: CalEvent[] = items.map(i => ({
    id: i.id,
    startMs: new Date(i.start).getTime(),
    endMs: new Date(i.end).getTime(),
  }))
  return computeOverlapLayout(data)
}
