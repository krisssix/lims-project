<script setup lang="ts">
/**
 * Reservations calendar (daily / weekly) with:
 * - Filtering by members and devices
 * - Drag & Drop (persisted to backend, optimistic with revert)
 * - Create & Edit dialogs (incl. note)
 * - Device color based event styling and note indicator icon
 */

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from '@/components/Dialog.vue'
import { useReservationsStore } from '@/stores/reservations'
import { useProjectStore } from '@/stores/project/project'
import { auth } from '@/stores/auth'

/* ------------------------------------------------------------------ */
/* Constants & Types                                                   */
/* ------------------------------------------------------------------ */
const HOURS_START = 4          // inclusive (04:00)
const HOURS_END = 13           // exclusive upper bound for visual grid end hour
const GRID_MINUTES = 15        // snap step
const TRACK_HEIGHT = 640       // px height for time grid
const MIN_EVENT_PX = 24        // minimum visible block height
const DRAG_CLICK_THRESHOLD = 5 // px movement to treat as drag

type ViewMode = 'daily-machines' | 'daily-list' | 'week-work' | 'week-all'
type StatusType = 'plan' | 'running' | 'done'

interface ResItem {
  id: number
  title: string
  deviceId: string
  start: string        // ISO
  end: string
  status: StatusType
  username: string | null
  note: string | null
}

interface DragState {
  id: number
  pointerId: number
  offsetY: number
  offsetX: number
  originTop: number
  originLeft: number
  durationMin: number
  origDayKey: string
  origDeviceId: string
  view: ViewMode
  ghostEl: HTMLElement
}

type EventLayout = Record<number, { left: number; width: number }>

/* ------------------------------------------------------------------ */
/* Stores & Routing                                                    */
/* ------------------------------------------------------------------ */
const route = useRoute()
const projectId = Number((route.params as any).projectId)
const reservations = useReservationsStore()
const projectStore = useProjectStore()

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */
function toYmdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fromYmdLocal(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
}
function normalizeToDate(v: string | Date): Date {
  return v instanceof Date
    ? new Date(v.getFullYear(), v.getMonth(), v.getDate(), 0, 0, 0, 0)
    : fromYmdLocal(v)
}
function pad2(n: number): string { return String(n).padStart(2, '0') }
function hmFromDate(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
function setHM(base: Date, hm: string) {
  const [h, m] = hm.split(':').map(v => parseInt(v, 10) || 0)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}
function toIsoLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/* ------------------------------------------------------------------ */
/* Date selection & navigation                                         */
/* ------------------------------------------------------------------ */
const selectedDate = ref<string | Date>(toYmdLocal(new Date()))
function addDays(n: number) {
  const d = normalizeToDate(selectedDate.value)
  d.setDate(d.getDate() + n)
  selectedDate.value = toYmdLocal(d)
}
function goToday() { selectedDate.value = toYmdLocal(new Date()) }
const currentDay = computed<Date>(() => normalizeToDate(selectedDate.value))

/* ------------------------------------------------------------------ */
/* Intl formatters                                                     */
/* ------------------------------------------------------------------ */
const fmtDateLongFmt   = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtTimeFmt       = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
const fmtDetailDateFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDetailTimeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
const fmtDateLong    = (d: Date) => fmtDateLongFmt.format(d)
const fmtTime        = (d: Date) => fmtTimeFmt.format(d)
const fmtDetailDate  = (d: Date) => fmtDetailDateFmt.format(d)
const fmtDetailTime  = (d: Date) => fmtDetailTimeFmt.format(d)

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */
const pickedMembers = ref<string[]>([])
const pickedDevices = ref<string[]>([])
const membersList = computed<string[]>(() =>
  projectStore.projectMembers.map((m: { username: string }) => m.username)
)
const allDevices = computed(() => reservations.devices.map(d => ({
  id: d.code,
  name: d.name,
  color: d.color || 'primary'
})))
const devicesToShow = computed(() =>
  pickedDevices.value.length
    ? allDevices.value.filter(d => pickedDevices.value.includes(d.id))
    : allDevices.value
)

/* ------------------------------------------------------------------ */
/* View Mode                                                           */
/* ------------------------------------------------------------------ */
const viewMode = ref<ViewMode>('daily-machines')
const viewLabel = computed(() => {
  switch (viewMode.value) {
    case 'daily-machines': return 'DENNÍ – STROJE'
    case 'daily-list': return 'REZERVACE'
    case 'week-work': return 'TÝDENNÍ (PRACOVNÍ)'
    case 'week-all': return 'TÝDENNÍ (S VÍKENDY)'
  }
})

/* ------------------------------------------------------------------ */
/* Time grid helpers                                                   */
/* ------------------------------------------------------------------ */
const hourTicks = computed<number>(() => HOURS_END - HOURS_START + 1)
const tickHeight = computed<number>(() => TRACK_HEIGHT / hourTicks.value)
const PX_PER_MIN = computed<number>(() => TRACK_HEIGHT / ((HOURS_END - HOURS_START) * 60))
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }
function roundToStep(v: number, step: number) { return Math.round(v / step) * step }
function topFromDate(d: Date) {
  const minutes = (d.getHours() - HOURS_START) * 60 + d.getMinutes()
  return Math.max(0, minutes * PX_PER_MIN.value)
}
function heightFromRange(start: Date, end: Date) {
  const diffMin = (end.getTime() - start.getTime()) / 60000
  return Math.max(MIN_EVENT_PX, diffMin * PX_PER_MIN.value)
}

/* ------------------------------------------------------------------ */
/* Data structures (in-memory events grouped by day)                   */
/* ------------------------------------------------------------------ */
const eventsByDay = ref<Record<string, ResItem[]>>({})
function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function ensureDay(d: Date): ResItem[] {
  const k = dateKey(d)
  if (!eventsByDay.value[k]) eventsByDay.value[k] = []
  return eventsByDay.value[k]
}

/* ------------------------------------------------------------------ */
/* Week calculations                                                   */
/* ------------------------------------------------------------------ */
function weekRange(date: Date) {
  const base = new Date(date)
  const day = (base.getDay() + 6) % 7 // Monday=0
  const monday = new Date(base)
  monday.setDate(base.getDate() - day)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday)
    x.setDate(monday.getDate() + i)
    return x
  })
}
const weekDaysAll = computed<Date[]>(() => weekRange(currentDay.value))
const weekDaysWork = computed<Date[]>(() => weekDaysAll.value.slice(0, 5))
const daysForView = computed<Date[]>(() =>
  viewMode.value === 'week-work' ? weekDaysWork.value : weekDaysAll.value
)
const colsDevices = computed<number>(() => devicesToShow.value.length)
const colsWeek = computed<number>(() => viewMode.value === 'week-work' ? 5 : 7)

/* ------------------------------------------------------------------ */
/* Loading events from backend (week interval)                        */
/* ------------------------------------------------------------------ */
function resetAllDays(days: Date[]) {
  for (const d of days) eventsByDay.value[dateKey(d)] = []
}

async function loadWeekFor(date: Date) {
  const days = weekRange(date)
  const from = new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate(), 0, 0, 0, 0).getTime()
  const last = days[days.length - 1]
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999).getTime()

  resetAllDays(days)
  const data = await reservations.fetchByProject(projectId, from, to)
  for (const r of data) {
    const s = new Date(r.startTime)
    const e = new Date(r.endTime)
    const item: ResItem = {
      id: r.id,
      title: r.title,
      deviceId: r.deviceCode,
      start: toIsoLocal(s),
      end: toIsoLocal(e),
      status: 'plan',
      username: r.username ?? null,
      note: r.note ?? null
    }

    const list = ensureDay(s)
    list.push(item)
    list.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  }
}

/* Initial load */
onMounted(async () => {
  await reservations.fetchDevices()
  await projectStore.fetchProjectMembers(projectId)
  await loadWeekFor(currentDay.value)
})

/* Reload on selected date change (week-based) */
watch(selectedDate, async v => {
  await loadWeekFor(normalizeToDate(v))
})

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */
function filterItems(arr: ResItem[]): ResItem[] {
  return arr.filter(i => {
    const byDevice = !pickedDevices.value.length || pickedDevices.value.includes(i.deviceId)
    const byMember = !pickedMembers.value.length || pickedMembers.value.includes(i.username ?? '')
    return byDevice && byMember
  })
}

function itemsFor(day: Date): ResItem[] {
  return eventsByDay.value[dateKey(day)] ?? []
}
const itemsForDayFiltered = computed<ResItem[]>(() => filterItems(itemsFor(currentDay.value)))
function itemsForDayDevice(deviceId: string) {
  return itemsForDayFiltered.value.filter(i => i.deviceId === deviceId)
}

/* ------------------------------------------------------------------ */
/* Device color + event style                                          */
/* ------------------------------------------------------------------ */
const deviceColorOf = (id: string) => allDevices.value.find(d => d.id === id)?.color || 'primary'

function eventBgClass(i: ResItem) {
  const color = deviceColorOf(i.deviceId)
  return (color === 'primary' || color === 'secondary')
    ? `bg-${color}`
    : `bg-${color}-lighten-4`
}

function eventStyle(i: ResItem, left: number, width: number) {
  const color = deviceColorOf(i.deviceId)
  return {
    top: `${topFromDate(new Date(i.start))}px`,
    height: `${heightFromRange(new Date(i.start), new Date(i.end))}px`,
    left: `calc(${left * 100}% + 8px)`,
    width: `calc(${width * 100}% - 16px)`,
    borderLeft: `4px solid var(--v-theme-${color})`,
    background: `color-mix(in srgb, var(--v-theme-${color}) 18%, #fff)`
  } as Record<string, string>
}

function initials(u: string | null) {
  return (u?.[0] ?? '?').toUpperCase()
}

/* ------------------------------------------------------------------ */
/* Layout algorithm (collisions)                                      */
/* ------------------------------------------------------------------ */
function eventsCollide(a: ResItem, b: ResItem): boolean {
  const aS = +new Date(a.start)
  const aE = +new Date(a.end)
  const bS = +new Date(b.start)
  const bE = +new Date(b.end)
  return aE > bS && aS < bE
}

function layoutForTrack(trackEvents: ResItem[]): EventLayout {
  const evs = [...trackEvents].sort((a, b) => {
    const as = +new Date(a.start), bs = +new Date(b.start)
    if (as !== bs) return as - bs
    const ae = +new Date(a.end), be = +new Date(b.end)
    return ae - be
  })

  const groups: ResItem[][][] = []
  let columns: ResItem[][] = []
  let lastEnd: number | undefined

  for (const ev of evs) {
    const start = +new Date(ev.start)
    const end = +new Date(ev.end)
    if (lastEnd !== undefined && start >= lastEnd) {
      groups.push(columns)
      columns = []
      lastEnd = undefined
    }
    let placed = false
    for (const col of columns) {
      const last = col[col.length - 1]
      if (!eventsCollide(last, ev)) {
        col.push(ev)
        placed = true
        break
      }
    }
    if (!placed) columns.push([ev])
    if (lastEnd === undefined || end > lastEnd) lastEnd = end
  }
  if (columns.length) groups.push(columns)

  const layout: EventLayout = {}

  function expand(ev: ResItem, colIdx: number, cols: ResItem[][]) {
    let span = 1
    for (let c = colIdx + 1; c < cols.length; c++) {
      if (cols[c].some(e => eventsCollide(e, ev))) break
      span++
    }
    return span
  }

  for (const cols of groups) {
    const n = cols.length
    cols.forEach((col, i) => {
      col.forEach(ev => {
        const span = expand(ev, i, cols)
        layout[ev.id] = { left: i / n, width: span / n }
      })
    })
  }
  return layout
}

const layoutDailyByDevice = computed<Record<string, EventLayout>>(() => {
  const out: Record<string, EventLayout> = {}
  for (const d of devicesToShow.value) out[d.id] = layoutForTrack(itemsForDayDevice(d.id))
  return out
})

const layoutWeeklyByDay = computed<Record<string, EventLayout>>(() => {
  const out: Record<string, EventLayout> = {}
  for (const day of daysForView.value) out[dateKey(day)] = layoutForTrack(filterItems(itemsFor(day)))
  return out
})

/* ------------------------------------------------------------------ */
/* Drag & Drop                                                         */
/* ------------------------------------------------------------------ */
const drag = ref<DragState | null>(null)
let movePending = false
let lastMoveEvent: PointerEvent | null = null
let highlightEl: HTMLElement | null = null
const pointerStart = ref({ x: 0, y: 0 })
const movedBeyondThreshold = ref(false)
const suppressClick = ref(false)
let suppressTimer: number | null = null

function attachHighlight(el: HTMLElement | null) {
  if (highlightEl && highlightEl !== el) highlightEl.classList.remove('drop-highlight')
  highlightEl = el
  if (highlightEl) highlightEl.classList.add('drop-highlight')
}
function clearHighlight() {
  if (highlightEl) highlightEl.classList.remove('drop-highlight')
  highlightEl = null
}

function onEventPointerDown(e: PointerEvent, item: ResItem) {
  if (e.button !== 0) return
  const target = e.currentTarget as HTMLElement | null
  if (!target) return

  const rect = target.getBoundingClientRect()
  const start = new Date(item.start)
  const end = new Date(item.end)

  pointerStart.value = { x: e.clientX, y: e.clientY }
  movedBeyondThreshold.value = false

  const ghost = target.cloneNode(true) as HTMLElement
  ghost.classList.add('drag-ghost')
  ghost.style.width = rect.width + 'px'
  ghost.style.height = rect.height + 'px'
  ghost.style.left = rect.left + 'px'
  ghost.style.top = rect.top + 'px'
  ghost.style.pointerEvents = 'none'
  document.body.appendChild(ghost)

  drag.value = {
    id: item.id,
    pointerId: e.pointerId,
    offsetY: e.clientY - rect.top,
    offsetX: e.clientX - rect.left,
    originTop: rect.top,
    originLeft: rect.left,
    durationMin: Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000)),
    origDayKey: dateKey(start),
    origDeviceId: item.deviceId,
    view: viewMode.value,
    ghostEl: ghost
  }

  try { target.setPointerCapture(e.pointerId) } catch {}
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

function onPointerMove(ev: PointerEvent) {
  if (!drag.value) return
  lastMoveEvent = ev
  const dx = Math.abs(ev.clientX - pointerStart.value.x)
  const dy = Math.abs(ev.clientY - pointerStart.value.y)
  if (dx > DRAG_CLICK_THRESHOLD || dy > DRAG_CLICK_THRESHOLD) movedBeyondThreshold.value = true

  if (!movePending) {
    movePending = true
    requestAnimationFrame(() => {
      movePending = false
      if (!drag.value || !lastMoveEvent) return
      const d = drag.value
      const e = lastMoveEvent
      const newLeft = e.clientX - d.offsetX
      const newTop = e.clientY - d.offsetY
      d.ghostEl.style.transform = `translate(${newLeft - d.originLeft}px, ${newTop - d.originTop}px)`
      const hit = findTrackAt(e.clientX, e.clientY)
      attachHighlight(hit?.el ?? null)
    })
  }
}

function findTrackAt(x: number, y: number) {
  let el = document.elementFromPoint(x, y) as HTMLElement | null
  while (el) {
    if (el.classList.contains('track')) {
      return {
        el,
        type: el.dataset.trackType || '',
        id: el.dataset.trackId || '',
        rect: el.getBoundingClientRect()
      }
    }
    el = el.parentElement
  }
  return null
}

function minutesFromTrackY(y: number, rect: DOMRect, offsetY: number) {
  const relY = clamp(y - rect.top - offsetY, 0, TRACK_HEIGHT)
  const minutes = (relY / PX_PER_MIN.value) + HOURS_START * 60
  return clamp(roundToStep(minutes, GRID_MINUTES), HOURS_START * 60, HOURS_END * 60)
}

async function commitMove(d: DragState, x: number, y: number) {
  const hit = findTrackAt(x, y)
  if (!hit) return

  const { type, id, rect } = hit
  let newDayKey = d.origDayKey
  let newDeviceId = d.origDeviceId

  if (d.view === 'daily-machines' && type === 'device') newDeviceId = id
  else if ((d.view === 'week-work' || d.view === 'week-all') && type === 'day') newDayKey = id
  else return

  const [Y, M, D] = newDayKey.split('-').map(Number)
  const baseDay = new Date(Y, (M || 1) - 1, D || 1, 0, 0, 0, 0)

  let startMinutes = minutesFromTrackY(y, rect, d.offsetY)
  const endMinutes = Math.min(HOURS_END * 60, startMinutes + d.durationMin)
  if (endMinutes - startMinutes < d.durationMin) {
    startMinutes = Math.max(HOURS_START * 60, endMinutes - d.durationMin)
  }

  const startDate = new Date(baseDay)
  startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0)
  const endDate = new Date(startDate.getTime() + d.durationMin * 60000)

  const sourceArr = eventsByDay.value[d.origDayKey] || []
  const idx = sourceArr.findIndex(x => x.id === d.id)
  if (idx === -1) return
  const ev = sourceArr[idx]
  const prev = { dayKey: d.origDayKey, deviceId: ev.deviceId, start: ev.start, end: ev.end }

  if (newDayKey !== d.origDayKey) {
    sourceArr.splice(idx, 1)
    const targetArr = ensureDay(baseDay)
    ev.deviceId = newDeviceId
    ev.start = toIsoLocal(startDate)
    ev.end = toIsoLocal(endDate)
    targetArr.push(ev)
    targetArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  } else {
    ev.deviceId = newDeviceId
    ev.start = toIsoLocal(startDate)
    ev.end = toIsoLocal(endDate)
    sourceArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  }

  try {
    await reservations.updateReservation(d.id, {
      startTime: startDate.getTime(),
      endTime: endDate.getTime(),
      deviceCode: newDeviceId
    })
    await loadWeekFor(currentDay.value)
  } catch (err) {
    // Revert optimistic change
    if (newDayKey !== prev.dayKey) {
      const newArr = eventsByDay.value[newDayKey] || []
      const nIdx = newArr.findIndex(x => x.id === d.id)
      if (nIdx !== -1) newArr.splice(nIdx, 1)
      const origDate = new Date(prev.start)
      const origArr = ensureDay(origDate)
      ev.deviceId = prev.deviceId
      ev.start = prev.start
      ev.end = prev.end
      origArr.push(ev)
      origArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
    } else {
      ev.deviceId = prev.deviceId
      ev.start = prev.start
      ev.end = prev.end
      sourceArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
    }
    console.error('Reservation update failed, reverted.', err)
  }
}

function onPointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove)
  if (!drag.value) return

  if (movedBeyondThreshold.value) {
    suppressClick.value = true
    if (suppressTimer) window.clearTimeout(suppressTimer)
    suppressTimer = window.setTimeout(() => { suppressClick.value = false }, 200)
  }

  commitMove(drag.value, e.clientX, e.clientY)
  clearHighlight()
  try { (e.target as HTMLElement)?.releasePointerCapture?.(drag.value.pointerId) } catch {}
  drag.value.ghostEl.remove()
  drag.value = null
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
})

function onEventClick(id: number, e: MouseEvent) {
  if (suppressClick.value || movedBeyondThreshold.value || drag.value) return
  openMenu.value[id] = true
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */
async function handleDelete(i: ResItem) {
  try {
    await reservations.deleteReservation(i.id)
    const k = dateKey(new Date(i.start))
    const arr = eventsByDay.value[k] || []
    const idx = arr.findIndex(x => x.id === i.id)
    if (idx !== -1) arr.splice(idx, 1)
    openMenu.value[i.id] = false
    await loadWeekFor(currentDay.value)
  } catch (e) {
    console.error('Delete failed', e)
  }
}

/* ------------------------------------------------------------------ */
/* Create dialog                                                       */
/* ------------------------------------------------------------------ */
const createOpen = ref(false)
const createForm = ref<{
  title: string
  deviceCode: string
  dateYmd: string
  startHM: string
  endHM: string
  username: string
  note?: string
} | null>(null)

function onTrackClick(evt: MouseEvent, ctx: { type: 'device' | 'day'; deviceId?: string; day?: Date }) {
  if (drag.value || suppressClick.value) return
  const track = evt.currentTarget as HTMLElement | null
  if (!track) return
  const rect = track.getBoundingClientRect()
  const baseDay = ctx.type === 'day' ? ctx.day as Date : currentDay.value
  const relY = clamp(evt.clientY - rect.top, 0, TRACK_HEIGHT)
  const minutes = (relY / PX_PER_MIN.value) + HOURS_START * 60
  const snapped = clamp(roundToStep(minutes, GRID_MINUTES), HOURS_START * 60, HOURS_END * 60)

  const start = new Date(baseDay)
  start.setHours(Math.floor(snapped / 60), snapped % 60, 0, 0)
  const end = new Date(start.getTime() + 60 * 60000)
  const deviceCode = ctx.type === 'device'
    ? (ctx.deviceId as string)
    : (devicesToShow.value[0]?.id || allDevices.value[0]?.id || 'M1')
  const me = auth.getUserInfo().preferredUsername

  createForm.value = {
    title: 'Nová rezervace',
    deviceCode,
    dateYmd: toYmdLocal(baseDay),
    startHM: hmFromDate(start),
    endHM: hmFromDate(end),
    username: me,
    note: ''
  }
  createOpen.value = true
}

async function saveCreatedEvent() {
  if (!createForm.value) return
  const { title, deviceCode, dateYmd, startHM, endHM, username, note } = createForm.value
  const day = fromYmdLocal(dateYmd)
  let start = setHM(day, startHM)
  let end = setHM(day, endHM)
  if (end <= start) end = new Date(start.getTime() + 30 * 60000)

  const clampStart = new Date(day); clampStart.setHours(HOURS_START, 0, 0, 0)
  const clampEnd = new Date(day); clampEnd.setHours(HOURS_END, 0, 0, 0)
  if (start < clampStart) start = clampStart
  if (end > clampEnd) end = clampEnd

  try {
    const created = await reservations.createReservation({
      title: title?.trim() || 'Rezervace',
      deviceCode,
      startTime: start.getTime(),
      endTime: end.getTime(),
      projectId,
      username,
      note: note?.trim() || null
    })
    const arr = ensureDay(day)
    arr.push({
      id: created.id,
      title: created.title,
      deviceId: created.deviceCode,
      start: toIsoLocal(start),
      end: toIsoLocal(end),
      status: 'plan',
      username: created.username ?? null,
      note: created.note ?? null
    })
    arr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
    createOpen.value = false
    createForm.value = null
    suppressClick.value = false
  } catch (err) {
    console.error('Save reservation failed', err)
  }
}

/* ------------------------------------------------------------------ */
/* Edit dialog                                                         */
/* ------------------------------------------------------------------ */
const editOpen = ref(false)
const editForm = ref<{
  id: number
  title: string
  deviceCode: string
  dateYmd: string
  startHM: string
  endHM: string
  username: string
  note?: string
} | null>(null)

function openEdit(i: ResItem) {
  const s = new Date(i.start)
  const e = new Date(i.end)
  editForm.value = {
    id: i.id,
    title: i.title,
    deviceCode: i.deviceId,
    dateYmd: toYmdLocal(new Date(s.getFullYear(), s.getMonth(), s.getDate())),
    startHM: hmFromDate(s),
    endHM: hmFromDate(e),
    username: i.username || '',
    note: i.note || ''
  }
  editOpen.value = true
}

async function saveEditedEvent() {
  if (!editForm.value) return
  const { id, deviceCode, dateYmd, startHM, endHM, note, title, username } = editForm.value

  const day = fromYmdLocal(dateYmd)
  let start = setHM(day, startHM)
  let end = setHM(day, endHM)
  if (end <= start) end = new Date(start.getTime() + 30 * 60000)

  const clampStart = new Date(day); clampStart.setHours(HOURS_START, 0, 0, 0)
  const clampEnd = new Date(day); clampEnd.setHours(HOURS_END, 0, 0, 0)
  if (start < clampStart) start = clampStart
  if (end > clampEnd) end = clampEnd

  const payload = {
    title: title?.trim() || 'Rezervace',
    deviceCode,
    startTime: start.getTime(),
    endTime: end.getTime(),
    username: username?.trim() || null,
    note: (note ?? '').trim() || null
  }

  try {
    await reservations.updateReservation(id, payload)
    editOpen.value = false
    editForm.value = null
    await loadWeekFor(currentDay.value)
  } catch (e) {
    console.error('Edit failed', e)
  }
}

/* ------------------------------------------------------------------ */
/* Menus state                                                         */
/* ------------------------------------------------------------------ */
const openMenu = ref<Record<number, boolean>>({})
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <!-- LEFT PANEL -->
      <v-col cols="3">
        <v-sheet elevation="1" class="pa-4">
          <v-date-picker v-model="selectedDate" color="primary" />
        </v-sheet>

        <v-sheet elevation="1" class="pa-4 mt-4">
          <v-select
            v-model="pickedMembers"
            :items="membersList"
            label="Členové"
            clearable
            multiple
            density="comfortable"
          />
          <v-select
            v-model="pickedDevices"
            :items="allDevices"
            item-title="name"
            item-value="id"
            label="Přístroje"
            clearable
            multiple
            density="comfortable"
            class="mt-4"
          />
        </v-sheet>
      </v-col>

      <!-- RIGHT PANEL -->
      <v-col cols="12" md="9">
        <v-card class="mb-3">
          <v-card-text class="d-flex flex-wrap align-center">
            <v-btn
              color="primary"
              class="mr-2"
              @click="() => {
                const day = normalizeToDate(selectedDate)
                const start = new Date(day); start.setHours(9,0,0,0)
                const end = new Date(start.getTime() + 60*60000)
                const me = auth.getUserInfo().preferredUsername
                createForm = {
                  title: 'Nová rezervace',
                  deviceCode: devicesToShow[0]?.id || allDevices[0]?.id || 'M1',
                  dateYmd: toYmdLocal(day),
                  startHM: (start.getHours()+'').padStart(2,'0') + ':' + (start.getMinutes()+'').padStart(2,'0'),
                  endHM: (end.getHours()+'').padStart(2,'0') + ':' + (end.getMinutes()+'').padStart(2,'0'),
                  username: me,
                  note: ''
                }
                createOpen = true
              }"
            >
              VYTVOŘIT REZERVACI
            </v-btn>

            <v-menu>
              <template #activator="{ props }">
                <v-btn v-bind="props" append-icon="mdi-menu-down" variant="tonal">
                  {{ viewLabel }}
                </v-btn>
              </template>
              <v-list>
                <v-list-item @click="viewMode = 'daily-machines'">Denní – stroje</v-list-item>
                <v-list-item @click="viewMode = 'daily-list'">Rezervace (seznam)</v-list-item>
                <v-list-item @click="viewMode = 'week-work'">Týdenní (pracovní)</v-list-item>
                <v-list-item @click="viewMode = 'week-all'">Týdenní (s víkendy)</v-list-item>
              </v-list>
            </v-menu>

            <v-spacer />

            <v-btn variant="tonal" @click="goToday">DNES</v-btn>
            <v-btn icon="mdi-chevron-left" variant="text" @click="addDays(-1)" />
            <div class="text-subtitle-1 mx-2">
              {{ fmtDateLong(normalizeToDate(selectedDate)) }}
            </div>
            <v-btn icon="mdi-chevron-right" variant="text" @click="addDays(1)" />
          </v-card-text>
        </v-card>

        <v-card>
          <v-card-text>
            <!-- DAILY / MACHINES -->
            <div v-if="viewMode === 'daily-machines'">
              <div class="d-flex flex-wrap mb-3">
                <div
                  v-for="d in devicesToShow"
                  :key="d.id"
                  class="d-flex align-center mr-4 mb-1"
                >
                  <v-chip :color="d.color" size="x-small" class="mr-2" />
                  <span class="text-caption">{{ d.name }}</span>
                </div>
              </div>

              <div class="schedule">
                <!-- header -->
                <div class="tracks row header" :style="{ '--cols': String(colsDevices) }">
                  <div class="time-col"></div>
                  <div
                    v-for="d in devicesToShow"
                    :key="d.id"
                    class="track-name"
                  >
                    <div class="weekday">{{ d.name }}</div>
                  </div>
                </div>

                <!-- body -->
                <div class="tracks row body" :style="{ '--cols': String(colsDevices) }">
                  <div class="time-col">
                    <div
                      v-for="h in hourTicks"
                      :key="h"
                      class="time-tick"
                      :style="{ height: tickHeight + 'px' }"
                    >
                      {{ (HOURS_START + h - 1).toString().padStart(2,'0') }}:00
                    </div>
                  </div>

                  <div
                    v-for="d in devicesToShow"
                    :key="d.id"
                    class="track"
                    :style="{ height: TRACK_HEIGHT + 'px' }"
                    data-track-type="device"
                    :data-track-id="d.id"
                    @click.self="onTrackClick($event, { type: 'device', deviceId: d.id })"
                  >
                    <v-menu
                      v-for="i in itemsForDayDevice(d.id)"
                      :key="i.id"
                      v-model="openMenu[i.id]"
                      location="bottom start"
                      offset="10"
                      max-width="520"
                      :close-on-content-click="false"
                      transition="fade-transition"
                      :open-on-click="false"
                    >
                      <template #activator="{ props }">
                        <div
                          class="event"
                          :class="eventBgClass(i)"
                          v-bind="props"
                          @pointerdown.stop.prevent="onEventPointerDown($event, i)"
                          @click.stop="onEventClick(i.id, $event)"
                          :style="eventStyle(i, (layoutDailyByDevice[d.id]?.[i.id]?.left ?? 0), (layoutDailyByDevice[d.id]?.[i.id]?.width ?? 1))"
                        >
                          <v-icon
                            v-if="i.note && i.note.trim().length"
                            size="16"
                            class="event-note-icon"
                          >
                            mdi-text
                          </v-icon>
                          <div class="event-title">{{ i.title }}</div>
                          <div class="event-time">
                            {{ fmtTime(new Date(i.start)) }} – {{ fmtTime(new Date(i.end)) }}
                          </div>
                          <v-avatar size="18" class="event-avatar">
                            <span>{{ initials(i.username) }}</span>
                          </v-avatar>
                        </div>
                      </template>

                      <v-card class="detail-card pa-3">
                        <div class="d-flex align-start">
                          <v-icon
                            :color="deviceColorOf(i.deviceId)"
                            size="16"
                            class="mr-3 mt-1"
                          >
                            mdi-checkbox-blank-circle
                          </v-icon>
                          <div class="flex-grow-1">
                            <div class="d-flex align-center justify-space-between mb-1">
                              <div class="text-subtitle-1 font-weight-medium">
                                {{ i.title }}
                              </div>
                              <div class="d-flex align-center">
                                <v-btn
                                  icon="mdi-pencil-outline"
                                  size="small"
                                  variant="text"
                                  @click="openEdit(i)"
                                />
                                <v-btn
                                  icon="mdi-delete-outline"
                                  size="small"
                                  variant="text"
                                  @click="handleDelete(i)"
                                />
                                <v-btn
                                  icon="mdi-close"
                                  size="small"
                                  variant="text"
                                  @click="openMenu[i.id] = false"
                                />
                              </div>
                            </div>

                            <div class="d-flex align-center text-medium-emphasis mt-1">
                              <v-icon size="18" class="mr-2">mdi-calendar-clock</v-icon>
                              <div class="text-body-2">
                                {{ fmtDetailDate(new Date(i.start)) }} ·
                                {{ fmtDetailTime(new Date(i.start)) }} – {{ fmtDetailTime(new Date(i.end)) }}
                              </div>
                            </div>

                            <div class="d-flex align-center text-medium-emphasis mt-2">
                              <v-icon size="18" class="mr-2">mdi-account-outline</v-icon>
                              <div class="text-body-2">{{ i.username ?? '—' }}</div>
                            </div>

                            <div
                              v-if="i.note && i.note.trim().length"
                              class="d-flex align-center text-medium-emphasis mt-2"
                            >
                              <v-icon size="18" class="mr-2">mdi-text</v-icon>
                              <div
                                class="text-body-2 text-ellipsis"
                                :title="i.note"
                              >{{ i.note }}</div>
                            </div>
                          </div>
                        </div>
                      </v-card>
                    </v-menu>
                  </div>
                </div>
              </div>
            </div>

            <!-- DAILY LIST -->
            <div v-else-if="viewMode === 'daily-list'">
              <v-data-table
                :headers="[
                  { title: 'Datum', key: 'date' },
                  { title: 'Stroj', key: 'device' },
                  { title: 'Stav',  key: 'status' },
                ]"
                :items="itemsForDayFiltered.map(i => ({
                  date: fmtDateLong(new Date(i.start)),
                  device: i.deviceId,
                  status: i.status,
                  _raw: i
                }))"
                items-per-page="10"
                class="elevation-1"
              >
                <template #item.status="{ item }">
                  <v-chip
                    size="small"
                    :color="item._raw.status === 'done'
                      ? 'green'
                      : (item._raw.status === 'running'
                        ? 'blue'
                        : 'grey')"
                    text-color="white"
                    variant="flat"
                    class="text-capitalize"
                  >
                    {{
                      item._raw.status === 'plan'
                        ? 'Plánované'
                        : item._raw.status === 'running'
                          ? 'Probíhá'
                          : 'Dokončeno'
                    }}
                  </v-chip>
                </template>
              </v-data-table>
            </div>

            <!-- WEEK VIEW -->
            <div v-else>
              <div class="schedule">
                <!-- header -->
                <div class="tracks row header" :style="{ '--cols': String(colsWeek) }">
                  <div class="time-col"></div>
                  <div
                    v-for="d in daysForView"
                    :key="d.toISOString()"
                    class="track-name"
                    :class="{ weekend: [0,6].includes(d.getDay()) }"
                  >
                    <div class="weekday">
                      {{ new Intl.DateTimeFormat('cs-CZ', { weekday: 'long' }).format(d) }}
                    </div>
                    <div class="text-caption">
                      {{ new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit' }).format(d) }}
                    </div>
                  </div>
                </div>

                <!-- body -->
                <div class="tracks row body" :style="{ '--cols': String(colsWeek) }">
                  <div class="time-col">
                    <div
                      v-for="h in hourTicks"
                      :key="h"
                      class="time-tick"
                      :style="{ height: tickHeight + 'px' }"
                    >
                      {{ (HOURS_START + h - 1).toString().padStart(2,'0') }}:00
                    </div>
                  </div>

                  <div
                    v-for="day in daysForView"
                    :key="day.toISOString()"
                    class="track"
                    :class="{ weekend: [0,6].includes(day.getDay()) }"
                    :style="{ height: TRACK_HEIGHT + 'px' }"
                    data-track-type="day"
                    :data-track-id="dateKey(day)"
                    @click.self="onTrackClick($event, { type: 'day', day })"
                  >
                    <v-menu
                      v-for="i in filterItems(itemsFor(day))"
                      :key="i.id"
                      v-model="openMenu[i.id]"
                      location="bottom start"
                      offset="10"
                      max-width="520"
                      :close-on-content-click="false"
                      transition="fade-transition"
                      :open-on-click="false"
                    >
                      <template #activator="{ props }">
                        <div
                          class="event"
                          :class="eventBgClass(i)"
                          v-bind="props"
                          @pointerdown.stop.prevent="onEventPointerDown($event, i)"
                          @click.stop="onEventClick(i.id, $event)"
                          :style="eventStyle(i, (layoutWeeklyByDay[dateKey(day)]?.[i.id]?.left ?? 0), (layoutWeeklyByDay[dateKey(day)]?.[i.id]?.width ?? 1))"
                        >
                          <v-icon
                            v-if="i.note && i.note.trim().length"
                            size="16"
                            class="event-note-icon"
                          >
                            mdi-text
                          </v-icon>
                          <div class="event-title">{{ i.title }}</div>
                          <div class="event-time">
                            {{ fmtTime(new Date(i.start)) }} – {{ fmtTime(new Date(i.end)) }}
                          </div>
                          <v-avatar size="18" class="event-avatar">
                            <span>{{ initials(i.username) }}</span>
                          </v-avatar>
                        </div>
                      </template>

                      <v-card class="detail-card pa-3">
                        <div class="d-flex align-start">
                          <v-icon
                            :color="deviceColorOf(i.deviceId)"
                            size="16"
                            class="mr-3 mt-1"
                          >
                            mdi-checkbox-blank-circle
                          </v-icon>
                          <div class="flex-grow-1">
                            <div class="d-flex align-center justify-space-between mb-1">
                              <div class="text-subtitle-1 font-weight-medium">{{ i.title }}</div>
                              <div class="d-flex align-center">
                                <v-btn
                                  icon="mdi-pencil-outline"
                                  size="small"
                                  variant="text"
                                  @click="openEdit(i)"
                                />
                                <v-btn
                                  icon="mdi-delete-outline"
                                  size="small"
                                  variant="text"
                                  @click="handleDelete(i)"
                                />
                                <v-btn
                                  icon="mdi-close"
                                  size="small"
                                  variant="text"
                                  @click="openMenu[i.id] = false"
                                />
                              </div>
                            </div>

                            <div class="d-flex align-center text-medium-emphasis mt-1">
                              <v-icon size="18" class="mr-2">mdi-calendar-clock</v-icon>
                              <div class="text-body-2">
                                {{ fmtDetailDate(new Date(i.start)) }} ·
                                {{ fmtDetailTime(new Date(i.start)) }} – {{ fmtDetailTime(new Date(i.end)) }}
                              </div>
                            </div>

                            <div class="d-flex align-center text-medium-emphasis mt-2">
                              <v-icon size="18" class="mr-2">mdi-account-outline</v-icon>
                              <div class="text-body-2">{{ i.username ?? '—' }}</div>
                            </div>

                            <div
                              v-if="i.note && i.note.trim().length"
                              class="d-flex align-center text-medium-emphasis mt-2"
                            >
                              <v-icon size="18" class="mr-2">mdi-text</v-icon>
                              <div
                                class="text-body-2 text-ellipsis"
                                :title="i.note"
                              >{{ i.note }}</div>
                            </div>
                          </div>
                        </div>
                      </v-card>
                    </v-menu>
                  </div>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- CREATE DIALOG -->
    <Dialog v-model:is-open="createOpen" width="600px" :hide-footer="false">
      <template #header>Vytvořit rezervaci</template>
      <template #content>
        <div v-if="createForm">
          <v-text-field v-model="createForm.title" label="Název" density="comfortable" variant="outlined" class="mb-2" />
          <v-select v-model="createForm.deviceCode" :items="allDevices" item-title="name" item-value="id" label="Přístroj" density="comfortable" variant="outlined" class="mb-2" />
          <v-select v-model="createForm.username" :items="membersList" label="Člen" density="comfortable" variant="outlined" class="mb-2" />
          <v-text-field v-model="createForm.dateYmd" label="Datum" type="date" density="comfortable" variant="outlined" class="mb-2" />
          <div class="d-flex" style="gap:12px">
            <v-text-field v-model="createForm.startHM" label="Začátek" type="time" density="comfortable" variant="outlined" />
            <v-text-field v-model="createForm.endHM" label="Konec" type="time" density="comfortable" variant="outlined" />
          </div>
          <v-textarea v-model="createForm.note" label="Poznámka" auto-grow rows="2" density="comfortable" variant="outlined" class="mt-2" />
        </div>
      </template>
      <template #footer>
        <v-btn color="primary" @click="saveCreatedEvent">Uložit</v-btn>
        <v-btn variant="text" @click="() => { createOpen = false; createForm = null }">Zrušit</v-btn>
      </template>
    </Dialog>

    <!-- EDIT DIALOG -->
    <Dialog v-model:is-open="editOpen" width="600px" :hide-footer="false">
      <template #header>Upravit rezervaci</template>
      <template #content>
        <div v-if="editForm">
          <v-text-field
            v-model="editForm.title"
            label="Název"
            density="comfortable"
            variant="outlined"
            class="mb-2"
            :rules="[v => !!(v && v.trim()) || 'Název je povinný']"
          />
          <v-select
            v-model="editForm.deviceCode"
            :items="allDevices"
            item-title="name"
            item-value="id"
            label="Přístroj"
            density="comfortable"
            variant="outlined"
            class="mb-2"
          />
          <v-select
            v-model="editForm.username"
            :items="membersList"
            label="Člen"
            density="comfortable"
            variant="outlined"
            class="mb-2"
            :clearable="true"
          />
          <v-text-field
            v-model="editForm.dateYmd"
            label="Datum"
            type="date"
            density="comfortable"
            variant="outlined"
            class="mb-2"
          />
          <div class="d-flex" style="gap:12px">
            <v-text-field
              v-model="editForm.startHM"
              label="Začátek"
              type="time"
              density="comfortable"
              variant="outlined"
            />
            <v-text-field
              v-model="editForm.endHM"
              label="Konec"
              type="time"
              density="comfortable"
              variant="outlined"
            />
          </div>
          <v-textarea
            v-model="editForm.note"
            label="Poznámka"
            auto-grow
            rows="2"
            density="comfortable"
            variant="outlined"
            class="mt-2"
          />
        </div>
      </template>
      <template #footer>
        <v-btn color="primary" @click="saveEditedEvent">Uložit změny</v-btn>
        <v-btn variant="text" @click="() => { editOpen = false; editForm = null }">Zrušit</v-btn>
      </template>
    </Dialog>
  </v-container>
</template>

<style scoped>
/* Event */
.event {
  position: absolute;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  padding: 8px 10px 20px 10px; /* extra bottom for note icon */
  cursor: grab;
  user-select: none;
}
.event:active { cursor: grabbing; }
.event-title {
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  text-overflow: ellipsis;
  white-space: normal;
}
.event-time {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.event-avatar {
  position: absolute;
  right: 4px;
  top: 4px;
  background: #f2f2f2;
  font-size: 10px;
  line-height: 18px;
  text-transform: uppercase;
}
.event-note-icon {
  position: absolute;
  right: 6px;
  bottom: 6px;
  color: rgba(0,0,0,.60);
  pointer-events: none;
  opacity: .85;
}
.event-note-icon:hover { opacity: 1; }

/* Truncate text utility */
.text-ellipsis {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Drag ghost */
.drag-ghost {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  opacity: .9;
  box-shadow: 0 8px 20px rgba(0,0,0,.20);
  border-radius: 10px;
  background: white;
  will-change: transform;
}

/* Drop highlight */
.drop-highlight {
  outline: 2px dashed var(--v-theme-primary);
  outline-offset: -2px;
}

/* Detail popover */
.detail-card {
  background: #eceff1;
  border-radius: 14px;
  box-shadow: 0 6px 20px rgba(0,0,0,.18);
}

/* Schedule grid */
.schedule {
  border-radius: 12px;
  overflow: hidden;
}

.tracks.row.header {
  display: grid;
  grid-template-columns: 80px repeat(var(--cols, 5), 1fr);
  gap: 0;
  border-bottom: 1px solid #e5e5e5;
}

.tracks.row.body {
  display: grid;
  grid-template-columns: 80px repeat(var(--cols, 5), 1fr);
}

.time-col {
  background: #fafafa;
  border-right: 1px solid #e5e5e5;
}

.time-tick {
  padding: 4px 8px;
  font-size: 12px;
  color: #777;
  border-bottom: 1px dashed #eee;
}

.track-name {
  padding: 12px 8px;
  text-align: center;
  border-left: 1px solid #f1f1f1;
}
.track-name .weekday {
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: .02em;
}
.track-name.weekend { background: #fafaff; }

.track {
  position: relative;
  border-left: 1px solid #f1f1f1;
  background:
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0.02) 0,
      rgba(0,0,0,0.02) 40px,
      transparent 40px,
      transparent 80px
    );
}
.track.weekend {
  background:
    linear-gradient(to bottom, rgba(70,120,255,0.04), rgba(70,120,255,0.04)),
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0.02) 0,
      rgba(0,0,0,0.02) 40px,
      transparent 40px,
      transparent 80px
    );
}
</style>
