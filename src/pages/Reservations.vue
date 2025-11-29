<script setup lang="ts">

import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import EntityEditorDialog from '@/components/EntityEditorDialog.vue'
import Dialog from '@/components/Dialog.vue'
import { useReservationsStore } from '@/stores/reservations'
import { useProjectStore } from '@/stores/project/project'
import { auth } from '@/stores/auth'

import DailyMachinesView from '@/components/reservations/DailyMachinesView.vue'
import DailyListView from '@/components/reservations/DailyListView.vue'
import WeekView from '@/components/reservations/WeekView.vue'
import LeftFiltersPanel from '@/components/LeftFiltersPanel.vue'

const HOURS_START = 0
const HOURS_END = 24
const GRID_MINUTES = 15
const VIEWPORT_HEIGHT = 640
const HOUR_HEIGHT = 80
const MIN_EVENT_PX = 24
const DRAG_CLICK_THRESHOLD = 5
const DAY_HOURS = 24

const isSideFilterOpen = ref(false)

type ViewMode = 'daily-machines' | 'daily-list' | 'week-work' | 'week-all'
type StatusType = 'plan' | 'running' | 'done'

function onDailyListRowDblClick(_ev: MouseEvent, payload: { item: any }) {
  openEdit(dtoToResItem(payload.item._raw))
}

interface ResItem {
  id: number
  title: string
  deviceId: string
  start: string
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

const route = useRoute()
const projectId = Number((route.params as any).projectId)
const reservations = useReservationsStore()
const projectStore = useProjectStore()

function pad2(n: number): string { return String(n).padStart(2, '0') }
function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
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
function hmFromDate(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
function setHM(base: Date, hm: string) {
  const [h, m] = hm.split(':').map(v => parseInt(v, 10) || 0)
  const d = new Date(base); d.setHours(h, m, 0, 0); return d
}
function toIsoLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// DTO from DailyListView
interface ReservationDto {
  id: number
  title: string
  deviceCode: string
  startTime: number
  endTime: number
  username: string | null
  projectId: number
  note: string | null
}
function dtoToResItem(r: ReservationDto): ResItem {
  const s = new Date(r.startTime)
  const e = new Date(r.endTime)
  return {
    id: r.id,
    title: r.title,
    deviceId: r.deviceCode,
    start: toIsoLocal(s),
    end: toIsoLocal(e),
    status: 'plan',
    username: r.username ?? null,
    note: r.note ?? null
  }
}
function openEditFromDto(raw: ReservationDto) { openEdit(dtoToResItem(raw)) }
function askDeleteFromDto(raw: ReservationDto) { askDelete(dtoToResItem(raw)) }

/* Date selection  */
const selectedDate = ref<string | Date>(toYmdLocal(new Date()))
function addDays(n: number) {
  const d = normalizeToDate(selectedDate.value)
  d.setDate(d.getDate() + n)
  selectedDate.value = toYmdLocal(d)
}
function goToday() { selectedDate.value = toYmdLocal(new Date()) }
const currentDay = computed<Date>(() => normalizeToDate(selectedDate.value))

/* Intl */
const fmtDateLongFmt   = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtTimeFmt       = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
const fmtDetailDateFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDetailTimeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
const fmtDateLong    = (d: Date) => fmtDateLongFmt.format(d)
const fmtTime        = (d: Date) => fmtTimeFmt.format(d)
const fmtDetailDate  = (d: Date) => fmtDetailDateFmt.format(d)
const fmtDetailTime  = (d: Date) => fmtDetailTimeFmt.format(d)

/* Filters */
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

type GroupConfig = {
  key: string
  title: string
  label?: string
  items: any[]
  itemTitle?: string
  itemValue?: string
  type?: 'plain' | 'devices'
  colorKey?: string
  showField?: string
}
const leftSelection = ref<Record<string, string[]>>({ devices: [], members: [] })
const leftGroups = computed<GroupConfig[]>(() => [
  {
    key: 'members',
    title: 'Členové',
    label: 'Členové',
    items: membersList.value.map(u => ({ username: u })),
    itemTitle: 'username',
    itemValue: 'username',
    type: 'plain',
  },
  {
    key: 'devices',
    title: 'Přístroje',
    label: 'Přístroje',
    items: allDevices.value,
    itemTitle: 'name',
    itemValue: 'id',
    type: 'devices',
    colorKey: 'color',
    showField: 'id',
  },
])
function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const as = [...a].sort(), bs = [...b].sort()
  return as.every((v, i) => v === bs[i])
}
watch(leftSelection, (sel) => {
  const devs = Array.isArray(sel.devices) ? sel.devices : []
  const mems = Array.isArray(sel.members) ? sel.members : []
  if (!arraysEqual(devs, pickedDevices.value)) pickedDevices.value = [...devs]
  if (!arraysEqual(mems, pickedMembers.value)) pickedMembers.value = [...mems]
}, { deep: true, immediate: true })
watch(pickedDevices, (v) => {
  const next = Array.isArray(v) ? v : []
  if (!arraysEqual(next, leftSelection.value.devices)) leftSelection.value.devices = [...next]
})
watch(pickedMembers, (v) => {
  const next = Array.isArray(v) ? v : []
  if (!arraysEqual(next, leftSelection.value.members)) leftSelection.value.members = [...next]
})

/* View Mode */
const viewMode = ref<ViewMode>('daily-machines')
const viewLabel = computed(() => {
  switch (viewMode.value) {
    case 'daily-machines': return 'DENNÍ – STROJE'
    case 'week-work': return 'TÝDENNÍ (PRACOVNÍ)'
    case 'week-all': return 'TÝDENNÍ (S VÍKENDY)'
    case 'daily-list': return 'REZERVACE'
  }
})

/* Menu control passed to child (FIX: make it reactive on key changes) */
const openMenu = ref<Record<number, boolean>>({})
function isMenuOpen(id: number) { return !!openMenu.value[id] }
function setMenuOpen(id: number, v: boolean) {
  // reassign a new object so Vue tracks the change
  openMenu.value = { ...openMenu.value, [id]: v }
}

/* Viewport refs */
const viewportDaily = ref<HTMLElement | null>(null)
const viewportWeek = ref<HTMLElement | null>(null)
function setDailyViewportRef(el: HTMLElement | null) { viewportDaily.value = el }
function setWeekViewportRef(el: HTMLElement | null) { viewportWeek.value = el }

/* Time grid helpers */
const tickHeight = computed<number>(() => HOUR_HEIGHT)
const PX_PER_MIN = computed<number>(() => HOUR_HEIGHT / 60)
const FULL_TRACK_HEIGHT = computed<number>(() => DAY_HOURS * HOUR_HEIGHT)
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
function scrollToHour(hour = 7) {
  const el = viewportDaily.value || viewportWeek.value
  if (!el) return
  const targetY = hour * 60 * PX_PER_MIN.value
  const y = Math.max(0, Math.min(FULL_TRACK_HEIGHT.value - el.clientHeight, targetY))
  el.scrollTop = y
}

/* Data structures */
const eventsByDay = ref<Record<string, ResItem[]>>({})
function dateKey(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function ensureDay(d: Date): ResItem[] {
  const k = dateKey(d)
  if (!eventsByDay.value[k]) eventsByDay.value[k] = []
  return eventsByDay.value[k]
}

/* Week calculations */
function weekRange(date: Date) {
  const base = new Date(date)
  const day = (base.getDay() + 6) % 7
  const monday = new Date(base); monday.setDate(base.getDate() - day)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday); x.setDate(monday.getDate() + i); return x
  })
}
const weekDaysAll = computed<Date[]>(() => weekRange(currentDay.value))
const weekDaysWork = computed<Date[]>(() => weekDaysAll.value.slice(0, 5))
const daysForView = computed<Date[]>(() =>
  viewMode.value === 'week-work' ? weekDaysWork.value : weekDaysAll.value
)
const colsDevices = computed<number>(() => devicesToShow.value.length)
const colsWeek = computed<number>(() => viewMode.value === 'week-work' ? 5 : 7)

/* Load events */
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
  await nextTick()
  scrollToHour(7)
}

/* Initial load */
onMounted(async () => {
  await reservations.fetchDevices()
  await projectStore.fetchProjectMembers(projectId)
  await loadWeekFor(currentDay.value)
  await nextTick()
  scrollToHour(7)
})
watch(selectedDate, async v => { await loadWeekFor(normalizeToDate(v)) })
watch(viewMode, async () => { await nextTick(); scrollToHour(7) })

/* Daily list auto-load */
type DailyListViewExposed = { loadListRange: () => void | Promise<void>; loadAll?: () => void | Promise<void> }
const dailyListRef = ref<DailyListViewExposed | null>(null)
const isDailyList = computed(() => viewMode.value === 'daily-list')
watch(isDailyList, async v => { if (v) { await nextTick(); dailyListRef.value?.loadListRange() } })

/* Filtering helpers */
function filterItems(arr: ResItem[]): ResItem[] {
  return arr.filter(i => {
    const byDevice = !pickedDevices.value.length || pickedDevices.value.includes(i.deviceId)
    const byMember = !pickedMembers.value.length || pickedMembers.value.includes(i.username ?? '')
    return byDevice && byMember
  })
}
function itemsFor(day: Date): ResItem[] { return eventsByDay.value[dateKey(day)] ?? [] }
const itemsForDayFiltered = computed<ResItem[]>(() => filterItems(itemsFor(currentDay.value)))
function itemsForDayDevice(deviceId: string) {
  return itemsForDayFiltered.value.filter(i => i.deviceId === deviceId)
}

/* Device color + event style */
const deviceColorOf = (id: string) => allDevices.value.find(d => d.id === id)?.color || 'primary'
function eventBgClass(i: ResItem) {
  const color = deviceColorOf(i.deviceId)
  return (color === 'primary' || color === 'secondary') ? `bg-${color}` : `bg-${color}-lighten-4`
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
function deviceHeaderStyle(d: { id: string; color: string }) {
  const base = `var(--v-theme-${d.color})`
  return {
    background: `color-mix(in srgb, ${base} 18%, #ffffff)`,
    boxShadow: `inset 0 -3px 0 0 ${base}`,
  }
}
function initials(u: string | null) { return (u?.[0] ?? '?').toUpperCase() }

/* Layout (collisions) */
function eventsCollide(a: ResItem, b: ResItem): boolean {
  const aS = +new Date(a.start), aE = +new Date(a.end), bS = +new Date(b.start), bE = +new Date(b.end)
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
    const start = +new Date(ev.start), end = +new Date(ev.end)
    if (lastEnd !== undefined && start >= lastEnd) { groups.push(columns); columns = []; lastEnd = undefined }
    let placed = false
    for (const col of columns) {
      const last = col[col.length - 1]
      if (!eventsCollide(last, ev)) { col.push(ev); placed = true; break }
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

/* Drag & Drop */
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
  const relY = clamp(y - rect.top - offsetY, 0, FULL_TRACK_HEIGHT.value)
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
onBeforeUnmount(() => { window.removeEventListener('pointermove', onPointerMove) })
function onEventClick(id: number, _e: MouseEvent) {
  if (suppressClick.value || movedBeyondThreshold.value || drag.value) return
  // ensure single menu open and make changes reactive
  openMenu.value = { [id]: true }
}

/* Delete */
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
const confirmDeleteOpen = ref(false)
const deleteTarget = ref<ResItem | null>(null)
const deleteLoading = ref(false)


function askDelete(i: ResItem) {
  deleteTarget.value = i
  confirmDeleteOpen.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value) { confirmDeleteOpen.value = false; return }
  deleteLoading.value = true
  try {
    await handleDelete(deleteTarget.value)
    deleteTarget.value = null
    confirmDeleteOpen.value = false
  } finally {
    deleteLoading.value = false
  }
}

function cancelDelete() {
  confirmDeleteOpen.value = false
  deleteTarget.value = null
}

/* Track click -> open Create editor with prefilled fields */
function onTrackClick(evt: MouseEvent, ctx: { type: 'device' | 'day'; deviceId?: string; day?: Date }) {
  if (drag.value || suppressClick.value) return
  const track = evt.currentTarget as HTMLElement | null
  if (!track) return
  const rect = track.getBoundingClientRect()
  const baseDay = ctx.type === 'day' ? (ctx.day as Date) : currentDay.value
  const relY = clamp(evt.clientY - rect.top, 0, FULL_TRACK_HEIGHT.value)
  const minutes = (relY / PX_PER_MIN.value) + HOURS_START * 60
  const snapped = clamp(roundToStep(minutes, GRID_MINUTES), HOURS_START * 60, HOURS_END * 60)
  const start = new Date(baseDay); start.setHours(Math.floor(snapped / 60), snapped % 60, 0, 0)
  const end = new Date(start.getTime() + 60 * 60000)
  const deviceCode = ctx.type === 'device'
    ? (ctx.deviceId as string)
    : (devicesToShow.value[0]?.id || allDevices.value[0]?.id || 'M1')
  openCreateWith({ baseDay, start, end, deviceCode })
}

/* Unified Reservation Editor (create/edit) */
type ReservationEditorForm = {
  id?: number
  title: string
  deviceCode: string
  dateYmd: string
  startHM: string
  endHM: string
  username: string | null
  note: string
}
const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editorSaving = ref(false)
const resForm = ref<ReservationEditorForm | null>(null)

function openCreateWith(opts: { baseDay: Date; start: Date; end: Date; deviceCode: string }) {
  const me = auth.getUserInfo().preferredUsername
  resForm.value = {
    title: 'Nová rezervace',
    deviceCode: opts.deviceCode,
    dateYmd: toYmdLocal(opts.baseDay),
    startHM: hmFromDate(opts.start),
    endHM: hmFromDate(opts.end),
    username: me,
    note: ''
  }
  editorMode.value = 'create'
  editorOpen.value = true
}

function openEdit(i: ResItem) {
  const s = new Date(i.start)
  const e = new Date(i.end)
  resForm.value = {
    id: i.id,
    title: i.title,
    deviceCode: i.deviceId,
    dateYmd: toYmdLocal(new Date(s.getFullYear(), s.getMonth(), s.getDate())),
    startHM: hmFromDate(s),
    endHM: hmFromDate(e),
    username: i.username || '',
    note: i.note || ''
  }
  editorMode.value = 'edit'
  editorOpen.value = true
}

watch(() => resForm.value?.dateYmd, (v) => { if (v) selectedDate.value = v })

const isEditorValid = computed(() => {
  const f = resForm.value
  if (!f) return false
  const titleOk = !!f.title.trim()
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(f.dateYmd)
  const startOk = /^\d{2}:\d{2}$/.test(f.startHM)
  const endOk   = /^\d{2}:\d{2}$/.test(f.endHM)
  if (!(titleOk && dateOk && startOk && endOk)) return false
  const day = fromYmdLocal(f.dateYmd)
  const s = setHM(day, f.startHM)
  const e = setHM(day, f.endHM)
  return e.getTime() > s.getTime()
})

async function saveReservation() {
  if (!resForm.value || !isEditorValid.value) return
  editorSaving.value = true
  const f = resForm.value
  const day = fromYmdLocal(f.dateYmd)
  let start = setHM(day, f.startHM)
  let end = setHM(day, f.endHM)
  if (end <= start) end = new Date(start.getTime() + 30 * 60000)
  const clampStart = new Date(day); clampStart.setHours(HOURS_START, 0, 0, 0)
  const clampEnd = new Date(day); clampEnd.setHours(HOURS_END, 0, 0, 0)
  if (start < clampStart) start = clampStart
  if (end > clampEnd) end = clampEnd

  try {
    if (editorMode.value === 'create') {
      const created = await reservations.createReservation({
        title: f.title?.trim() || 'Rezervace',
        deviceCode: f.deviceCode,
        startTime: start.getTime(),
        endTime: end.getTime(),
        projectId,
        username: f.username || '',
        note: (f.note ?? '').trim() || null
      })
      // place optimistically if week is same, else reload
      const baseDay = day
      const currentMonday = weekRange(currentDay.value)[0]
      const newMonday = weekRange(baseDay)[0]
      if (currentMonday.getTime() !== newMonday.getTime()) {
        await loadWeekFor(baseDay)
      } else {
        const arr = ensureDay(baseDay)
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
      }
    } else {
      const id = f.id!
      await reservations.updateReservation(id, {
        title: f.title?.trim() || 'Rezervace',
        deviceCode: f.deviceCode,
        startTime: start.getTime(),
        endTime: end.getTime(),
        username: (f.username ?? '').trim() || null,
        note: (f.note ?? '').trim() || null
      })
      await loadWeekFor(currentDay.value)
    }
    editorOpen.value = false
    resForm.value = null
  } catch (e) {
    console.error('Save reservation failed', e)
  } finally {
    editorSaving.value = false
  }
}

function openCreateFromToolbar() {
  const day = normalizeToDate(selectedDate.value)
  const start = new Date(day); start.setHours(9, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60000)
  const deviceCode = devicesToShow.value[0]?.id || allDevices.value[0]?.id || 'M1'
  openCreateWith({ baseDay: day, start, end, deviceCode })
}

const confirmPrimaryBtn = ref<HTMLButtonElement | null>(null)
watch(confirmDeleteOpen, v => {
  if (v) nextTick(() => confirmPrimaryBtn.value?.focus())
})

/* Global hotkeys (sjednocení s Measurements/Board: Ctrl+B pro procházet) */
function onHotkeys(e: KeyboardEvent) {
  // Toggle postranní panel (sjednocení s Board.vue)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); isSideFilterOpen.value = !isSideFilterOpen.value; return }
  // Quick new
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openCreateFromToolbar(); return }
  // Datum navigace mimo editor
  if (!editorOpen.value && e.key === 'ArrowLeft') { e.preventDefault(); addDays(-1); return }
  if (!editorOpen.value && e.key === 'ArrowRight') { e.preventDefault(); addDays(1); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') { e.preventDefault(); goToday(); return }
  // Editor
  if (confirmDeleteOpen.value) {
    // Enter = potvrdit smazání, Esc = zrušit, nic nepropustit dál
    if (e.key === 'Enter') { e.preventDefault(); if (!deleteLoading.value) void confirmDelete(); return }
    if (e.key === 'Escape') { e.preventDefault(); if (!deleteLoading.value) cancelDelete(); return }
    e.preventDefault()
    return
  }
  if (editorOpen.value) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (isEditorValid.value) saveReservation(); return }
    if (e.key === 'Escape') { e.preventDefault(); editorOpen.value = false; resForm.value = null; return }
  }
}
onMounted(() => window.addEventListener('keydown', onHotkeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkeys))
</script>

<template>
  <v-container fluid class="pa-0">
    <!-- Sjednocená horní lišta jako v Board.vue -->
    <v-toolbar color="white" class="border-b-sm pl-3 pr-3" density="comfortable">
      <v-btn color="primary"variant="tonal" @click="isSideFilterOpen = !isSideFilterOpen">
        Procházet
      </v-btn>

      <v-btn color="primary" variant="flat" class="ml-2" @click="openCreateFromToolbar">
        VYTVOŘIT REZERVACI
      </v-btn>

      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" append-icon="mdi-menu-down" variant="tonal" class="ml-2">
            {{ viewLabel }}
          </v-btn>
        </template>
        <v-list>
          <v-list-item @click="viewMode = 'daily-machines'">Denní – stroje</v-list-item>
          <v-list-item @click="viewMode = 'week-work'">Týdenní (pracovní)</v-list-item>
          <v-list-item @click="viewMode = 'week-all'">Týdenní (s víkendy)</v-list-item>
          <v-list-item @click="viewMode = 'daily-list'">Rezervace (seznam)</v-list-item>
        </v-list>
      </v-menu>

      <v-spacer />
      <div class="text-subtitle-1 mx-2" style="text-transform: capitalize; min-width: 180px;">
        {{ selectedDate ? fmtDateLong(normalizeToDate(selectedDate)) : '' }}
      </div>
      <v-btn variant="tonal" @click="goToday" title="Dnes (Ctrl+T)">DNES</v-btn>
      <v-btn icon="mdi-chevron-left" variant="text" @click="addDays(-1)" />
      <v-btn icon="mdi-chevron-right" variant="text" @click="addDays(1)" />

    </v-toolbar>

    <v-container fluid class="pa-4">
      <v-row>
        <!-- LEFT PANEL (toggle jako v Board.vue) -->
        <v-col v-if="isSideFilterOpen" cols="12" md="3">
          <LeftFiltersPanel
            v-model:date="selectedDate"
            v-model:selection="leftSelection"
            :groups="leftGroups"
          />
        </v-col>

        <!-- RIGHT PANEL -->
        <v-col :cols="12" :md="isSideFilterOpen ? 9 : 12">
          <v-card>
            <v-card-text>
              <DailyMachinesView
                v-if="viewMode === 'daily-machines'"
                :devices="devicesToShow"
                :cols="colsDevices"
                :day-hours="24"
                :tick-height="tickHeight"
                :viewport-height="VIEWPORT_HEIGHT"
                :full-track-height="FULL_TRACK_HEIGHT"
                :get-items-for-device="(id: string) => itemsForDayDevice(id)"
                :layout-for-device="layoutDailyByDevice"
                :device-header-style="deviceHeaderStyle"
                :event-bg-class="eventBgClass"
                :event-style="eventStyle"
                :fmt-time="fmtTime"
                :fmt-detail-date="fmtDetailDate"
                :fmt-detail-time="fmtDetailTime"
                :initials="initials"
                :device-color-of="deviceColorOf"
                :is-menu-open="isMenuOpen"
                :set-menu-open="setMenuOpen"
                :on-track-click="onTrackClick"
                :on-event-pointer-down="onEventPointerDown"
                :on-event-click="onEventClick"
                :open-edit="openEdit"
                :ask-delete="askDelete"
                :set-viewport-ref="setDailyViewportRef"
              />

              <DailyListView
                v-else-if="isDailyList"
                ref="dailyListRef"
                :project-id="projectId"
                :device-codes="pickedDevices"
                :on-dblclick-row="onDailyListRowDblClick"
                :open-edit="openEditFromDto"
                :ask-delete="askDeleteFromDto"
                :selected-date="selectedDate"
              />

              <WeekView
                v-else
                :days="daysForView"
                :cols="colsWeek"
                :tick-height="tickHeight"
                :viewport-height="VIEWPORT_HEIGHT"
                :full-track-height="FULL_TRACK_HEIGHT"
                :date-key="dateKey"
                :items-for-day="(d: Date) => itemsFor(d)"
                :filter-items="filterItems"
                :layout-for-day="layoutWeeklyByDay"
                :event-bg-class="eventBgClass"
                :event-style="eventStyle"
                :fmt-time="fmtTime"
                :fmt-detail-date="fmtDetailDate"
                :fmt-detail-time="fmtDetailTime"
                :initials="initials"
                :device-color-of="deviceColorOf"
                :is-menu-open="isMenuOpen"
                :set-menu-open="setMenuOpen"
                :on-track-click="onTrackClick"
                :on-event-pointer-down="onEventPointerDown"
                :on-event-click="onEventClick"
                :open-edit="openEdit"
                :ask-delete="askDelete"
                :set-viewport-ref="setWeekViewportRef"
              />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <EntityEditorDialog
        v-model:is-open="editorOpen"
        :entity-label="'rezervace'"
        :mode="editorMode"
        :saving="editorSaving"
        :deletable="editorMode === 'edit'"
        @save="saveReservation"
        @delete="() => { if (resForm?.id) askDelete({ id: resForm.id, title: '', deviceId: resForm.deviceCode, start: '', end: '', status: 'plan', username: resForm.username, note: resForm.note ?? null }) }"
        @cancel="() => { resForm = null }"
        :width="'600px'"
      >
        <div v-if="resForm" class="pa-1">
          <v-text-field v-model="resForm.title" label="Název" density="comfortable" variant="outlined" class="mb-2"
                        :rules="[v => !!(v && v.trim()) || 'Název je povinný']" autofocus />
          <v-select v-model="resForm.deviceCode" :items="allDevices" item-title="name" item-value="id" label="Přístroj"
                    density="comfortable" variant="outlined" class="mb-2" />
          <v-select v-model="resForm.username" :items="membersList" label="Člen" density="comfortable"
                    variant="outlined" class="mb-2" :clearable="true" />
          <v-text-field v-model="resForm.dateYmd" label="Datum" type="date" density="comfortable" variant="outlined" class="mb-2" />
          <div class="d-flex" style="gap:12px">
            <v-text-field v-model="resForm.startHM" label="Začátek" type="time" density="comfortable" variant="outlined" />
            <v-text-field v-model="resForm.endHM" label="Konec" type="time" density="comfortable" variant="outlined" />
          </div>
          <v-textarea v-model="resForm.note" label="Poznámka" auto-grow rows="2" density="comfortable" variant="outlined" class="mt-2" />
        </div>
      </EntityEditorDialog>

      <!-- CONFIRM DELETE -->
      <Dialog v-model:is-open="confirmDeleteOpen" width="auto" :hide-footer="true">
        <template #content>
          <div class="pa-4">
            <div class="text-h6 mb-6">Opravdu chcete rezervaci zrušit?</div>
            <div class="d-flex align-center" style="gap:14px">
              <v-btn
                color="primary" variant="flat"
                size="large"
                :loading="deleteLoading"
                :disabled="deleteLoading || !deleteTarget"
                @click="confirmDelete"
              >
                Smazat rezervaci
              </v-btn>
              <v-btn
                variant="tonal"
                color="text"
                size="large"
                :disabled="deleteLoading"
                @click="cancelDelete"
              >
                Ponechat
              </v-btn>
            </div>
          </div>
        </template>
      </Dialog>
    </v-container>
  </v-container>
</template>

<style scoped>
.event {
  position: absolute;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  padding: 8px 10px 20px 10px;
  cursor: grab;
  user-select: none;
  will-change: transform, top, height;
  transform: translateZ(0);
  contain: layout paint style;
}
.event:active { cursor: grabbing; }
.event-title { font-weight: 600; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical;text-overflow: ellipsis; white-space: normal; }
.event-time { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.event-avatar { position: absolute; right: 4px; top: 4px; background: #f2f2f2; font-size: 18px; line-height: 18px; text-transform: uppercase; border: 2px solid var(--v-theme-primary); }
.event-note-icon { position: absolute; right: 6px; bottom: 6px; color: rgba(0,0,0,.60); pointer-events: none; opacity: .85; }
.event-note-icon:hover { opacity: 1; }
.text-ellipsis { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.drag-ghost { position: fixed; z-index: 9999; pointer-events: none; opacity: .9; box-shadow: 0 8px 20px rgba(0,0,0,.20); border-radius: 10px; background: white; will-change: transform; }
.drop-highlight { outline: 2px dashed var(--v-theme-primary); outline-offset: -2px; }
.schedule { border-radius: 12px; overflow: hidden; }
.tracks.row.header { display: grid; grid-template-columns: 80px repeat(var(--cols, 5), 1fr); gap: 0; border-bottom: 1px solid #e5e5e5; }
.tracks.row.body { display: grid; grid-template-columns: 80px repeat(var(--cols, 5), 1fr); }
.time-col { background: #fafafa; border-right: 1px solid #e5e5e5; }
.time-tick { padding: 4px 8px; font-size: 12px; color: #777; border-bottom: 1px dashed #eee; }
.track-name { padding: 12px 8px; text-align: center; border-left: 1px solid #f1f1f1; }
.track-name .weekday { text-transform: uppercase; font-weight: 700; letter-spacing: .02em; }
.track-name.weekend { background: #fafaff; }
.track { position: relative; border-left: 1px solid #f1f1f1;
  background: repeating-linear-gradient(to bottom, rgba(0,0,0,0.02) 0, rgba(0,0,0,0.02) calc(var(--tick-h) / 2), transparent calc(var(--tick-h) / 2), transparent var(--tick-h)); }
.track.weekend {
  background: linear-gradient(to bottom, rgba(70,120,255,0.04), rgba(70,120,255,0.04)),
  repeating-linear-gradient(to bottom, rgba(0,0,0,0.02) 0, rgba(0,0,0,0.02) calc(var(--tick-h) / 2), transparent calc(var(--tick-h) / 2), transparent var(--tick-h)); }
.text-truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.schedule { border-radius: 12px; overflow: hidden; }

.tracks.row.header { display: grid; gap: 0; border-bottom: 1px solid #e5e5e5; }
.tracks.row.body   { display: grid; }

.scroll-viewport { overflow-y: auto; }
.time-col { background: #fafafa; border-right: 1px solid #e5e5e5; }
.time-tick { padding: 4px 8px; font-size: 12px; color: #777; border-bottom: 1px dashed #eee; }
.track-name { padding: 12px 8px; text-align: center; border-left: 1px solid #f1f1f1; }
.track-name .weekday { text-transform: uppercase; font-weight: 700; letter-spacing: .02em; }
.track-name.weekend { background: #fafaff; }

.track {
  position: relative;
  border-left: 1px solid #f1f1f1;
  background:
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0.02) 0,
      rgba(0,0,0,0.02) calc(var(--tick-h) / 2),
      transparent calc(var(--tick-h) / 2),
      transparent var(--tick-h)
    );
}
.track.weekend {
  background:
    linear-gradient(to bottom, rgba(70,120,255,0.04), rgba(70,120,255,0.04)),
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0.02) 0,
      rgba(0,0,0,0.02) calc(var(--tick-h) / 2),
      transparent calc(var(--tick-h) / 2),
      transparent var(--tick-h)
    );
}

.event {
  position: absolute;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  padding: 8px 10px 20px 10px;
  cursor: grab;
  user-select: none;
}
.event:active { cursor: grabbing; }
.event-title { font-weight: 600; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; text-overflow: ellipsis; white-space: normal; }
.event-time { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.event-avatar { position: absolute; right: 4px; top: 4px; background: #f2f2f2; font-size: 18px; line-height: 18px; text-transform: uppercase; border: 2px solid var(--v-theme-primary); }
.event-note-icon { position: absolute; right: 6px; bottom: 6px; color: rgba(0,0,0,.60); pointer-events: none; opacity: .85; }
.event-note-icon:hover { opacity: 1; }

.detail-card { background: #eceff1; border-radius: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
.text-ellipsis { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.event.event--xs { padding: 0; }
.event.event--xs .event-title,
.event.event--xs .event-time,
.event.event--xs .event-note-icon,
.event.event--xs .event-avatar { display: none !important; }

.event.event--sm { padding: 4px 8px; }
.event.event--sm .event-time,
.event.event--sm .event-note-icon,
.event.event--sm .event-avatar { display: none !important; }
.event.event--sm .event-title { font-size: 12px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }

.event.event--md { padding: 6px 8px 10px 8px; }
.event.event--md .event-avatar { display: none; }
.event.event--md .event-time { font-size: 12px; }
</style>
