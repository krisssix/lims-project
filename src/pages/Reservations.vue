<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import Dialog from '@/components/Dialog.vue'

/** ---------- LocalStorage persistence ---------- */
const LS_KEY = 'reservations_state_v1'
type PersistState = {
  eventsByDay: Record<string, ResItem[]>
  selectedDate?: string
  viewMode?: ViewMode
}

/** --- helpers: local YYYY-MM-DD <-> Date --- */
function toYmdLocal(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fromYmdLocal(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
}
function setHM(base: Date, hm: string) {
  const [h, m] = hm.split(':').map(v => parseInt(v, 10) || 0)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}
function pad2(n: number) { return String(n).padStart(2, '0') }
function hmFromDate(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

/** --- datum / navigace --- */
const selectedDate = ref<string>(toYmdLocal(new Date())) // YYYY-MM-DD
function addDays(n: number) {
  const d = fromYmdLocal(selectedDate.value)
  d.setDate(d.getDate() + n)
  selectedDate.value = toYmdLocal(d)
}
function goToday() {
  selectedDate.value = toYmdLocal(new Date())
}

/** --- formátování lokálním časem --- */
const fmtDateLongFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtTimeFmt     = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
const fmtDetailDateFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDetailTimeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })

const fmtDateLong = (d: Date) => fmtDateLongFmt.format(d)
const fmtTime     = (d: Date) => fmtTimeFmt.format(d)
const fmtDetailDate = (d: Date) => fmtDetailDateFmt.format(d)
const fmtDetailTime = (d: Date) => fmtDetailTimeFmt.format(d)

/** --- filtry (jen UI) --- */
const pickedMembers = ref<string[]>([])
const pickedDevices = ref<string[]>([])
const members = ['Jenny Fermin', 'Miloš Novák', 'Anna K.']
const devices = ref([
  { id: 'M1', name: 'M1', color: 'deep-purple' },
  { id: 'M2', name: 'M2', color: 'blue' },
  { id: 'M3', name: 'M3', color: 'teal' },
  { id: 'Spektro1', name: 'Spektro1', color: 'orange' },
  { id: 'Spektro2', name: 'Spektro2', color: 'amber' },
])
const colsDevices = computed(() => devices.value.length)

/** --- přepínání pohledů --- */
type ViewMode = 'daily-machines' | 'daily-list' | 'week-work' | 'week-all'
const viewMode = ref<ViewMode>('daily-machines')
const viewLabel = computed(() => {
  switch (viewMode.value) {
    case 'daily-machines': return 'DENNÍ – STROJE'
    case 'daily-list':     return 'REZERVACE'
    case 'week-work':      return 'TÝDENNÍ (PRACOVNÍ)'
    case 'week-all':       return 'TÝDENNÍ (S VÍKENDY)'
  }
})

/** --- typy a konstanta času --- */
type ResItem = {
  id: number
  title: string
  deviceId: string
  start: string  // ISO local-like string (no TZ)
  end: string
  status: 'plan' | 'running' | 'done'
}
const H_START = 4   // 4:00
const H_END   = 13  // 13:00
const TRACK_HEIGHT = 640
const hourTicks = computed(() => H_END - H_START + 1)
const tickHeight = computed(() => TRACK_HEIGHT / hourTicks.value)
const GRID_MINUTES = 15 // snap to 15 min

const PX_PER_MIN = computed(() => TRACK_HEIGHT / ((H_END - H_START) * 60))
function topFromDate(d: Date) {
  const minutes = (d.getHours() - H_START) * 60 + d.getMinutes()
  return Math.max(0, minutes * PX_PER_MIN.value)
}
function heightFromRange(start: Date, end: Date) {
  const diff = (end.getTime() - start.getTime()) / (1000 * 60)
  return Math.max(24, diff * PX_PER_MIN.value)
}
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }
function roundToStep(v: number, step: number) { return Math.round(v / step) * step }

/** --- helpery data --- */
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}
const currentDay = computed(() => fromYmdLocal(selectedDate.value))

/** ========= ÚLOŽIŠTĚ REZERVACÍ + PERSISTENCE ========= */
const eventsByDay = ref<Record<string, ResItem[]>>({})
function dateKey(d: Date) {
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function ensureDay(day: Date): ResItem[] {
  const k = dateKey(day)
  if (!eventsByDay.value[k]) eventsByDay.value[k] = []
  return eventsByDay.value[k]
}
function toIsoLocal(d: Date) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`
}

/** Seed fake data pro hezký start (jen pokud pro daný den nic není) */
let autoId = 1
const titles = [
  'Kalibrace A', 'Kontrola', 'Měření enzymatiky', 'Viskozita', 'Mikroskop indexy',
  'Peptidy', 'Test vzorku', 'Spektrum', 'Údržba', 'Záloha dat'
]
function makeRng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17; s >>>= 0
    s ^= s << 5;  s >>>= 0
    return (s % 1000) / 1000
  }
}
function seedDay(day: Date) {
  const key = dateKey(day)
  if (eventsByDay.value[key]?.length) return
  const seed = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate()
  const rnd  = makeRng(seed)

  const items: ResItem[] = []
  const total = 4 + Math.floor(rnd() * 6)

  const takenByDevice: Record<string, Array<[number, number]>> = {}
  devices.value.forEach(d => { takenByDevice[d.id] = [] })

  const startMin = H_START * 60
  const endMin   = H_END * 60

  for (let i = 0; i < total; i++) {
    const dev = devices.value[Math.floor(rnd() * devices.value.length)]
    const dur = [45, 60, 75, 90, 105, 120][Math.floor(rnd() * 6)]
    const startCandidate = startMin + Math.floor(rnd() * (endMin - startMin - dur))
    const start = Math.floor(startCandidate / 30) * 30
    const end   = start + dur
    const overlaps = takenByDevice[dev.id].some(([a, b]) => !(end <= a || start >= b))
    if (overlaps) { i--; continue }
    takenByDevice[dev.id].push([start, end])

    const s = new Date(day); s.setHours(Math.floor(start / 60), start % 60, 0, 0)
    const e = new Date(day); e.setHours(Math.floor(end / 60),   end % 60,   0, 0)

    const title = titles[Math.floor(rnd() * titles.length)]
    let status: ResItem['status'] = 'plan'
    const now = new Date()
    if (sameDay(now, day)) {
      if (now.getTime() > e.getTime()) status = 'done'
      else if (now.getTime() >= s.getTime() && now.getTime() <= e.getTime()) status = 'running'
      else status = rnd() > 0.5 ? 'plan' : 'done'
    } else if (now.getTime() > day.getTime()) status = 'done'
    else status = 'plan'

    items.push({ id: autoId++, title, deviceId: dev.id, start: toIsoLocal(s), end: toIsoLocal(e), status })
  }
  items.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  eventsByDay.value[key] = items
}

/** Načtení/uložení do localStorage */
function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as PersistState
    if (parsed?.eventsByDay) {
      eventsByDay.value = parsed.eventsByDay
      const maxId = Object.values(parsed.eventsByDay).flat().reduce((m, i) => Math.max(m, i.id), 0)
      autoId = Math.max(autoId, maxId + 1)
    }
    if (parsed?.selectedDate) selectedDate.value = parsed.selectedDate
    if (parsed?.viewMode) viewMode.value = parsed.viewMode
  } catch (e) {
    console.warn('Failed to load reservations from LS', e)
  }
}
function savePersisted() {
  const state: PersistState = {
    eventsByDay: eventsByDay.value,
    selectedDate: selectedDate.value,
    viewMode: viewMode.value,
  }
  localStorage.setItem(LS_KEY, JSON.stringify(state))
}
watch([eventsByDay, selectedDate, viewMode], savePersisted, { deep: true })

/** Seed current day and its week if empty */
onMounted(() => {
  loadPersisted()
  const d = currentDay.value
  seedDay(d)
  weekRange(d).forEach(seedDay)
})

/** --- computed pro aktuální den a tabulku --- */
function itemsFor(day: Date) {
  const k = dateKey(day)
  ensureDay(day)
  return eventsByDay.value[k]
}
const itemsForDay = computed(() => itemsFor(currentDay.value))
const tableHeaders = [
  { title: 'Datum', key: 'date' },
  { title: 'Stroj', key: 'device' },
  { title: 'Stav',  key: 'status' },
]
const tableItems = computed(() =>
  itemsForDay.value.map(i => ({
    date: fmtDateLong(new Date(i.start)),
    device: i.deviceId,
    status: i.status,
    _raw: i,
  }))
)

/** --- týden --- */
function weekRange(date: Date) {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7 // 0=po … 6=ne
  const monday = new Date(d); monday.setDate(d.getDate() - day)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday); x.setDate(monday.getDate() + i); return x
  })
}
const weekDaysAll  = computed(() => weekRange(currentDay.value))
const weekDaysWork = computed(() => weekDaysAll.value.slice(0, 5))
const daysForView  = computed(() => viewMode.value === 'week-work' ? weekDaysWork.value : weekDaysAll.value)
const colsWeek     = computed(() => viewMode.value === 'week-work' ? 5 : 7)

/** --- detail: data + formátování --- */
const deviceColorOf = (id: string) => devices.value.find(d => d.id === id)?.color || 'deep-purple'

/** fake doplňky (vlastník + poznámka) – memoized **/
const people = ['Kristina Nazarjanová', 'Jenny Fermin', 'Miloš Novák', 'Anna K.', 'Tomáš Marek']
function seedFromItem(i: ResItem) {
  let s = i.id
  for (const ch of i.start) s = ((s << 5) - s) + ch.charCodeAt(0)
  return s >>> 0
}
function rngFrom(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17; s >>>= 0
    s ^= s << 5;  s >>>= 0
    return (s >>> 0) / 4294967296
  }
}
const extrasCache = new Map<number, { owner: string; note: string }>()
function extrasFor(i: ResItem) {
  const cached = extrasCache.get(i.id)
  if (cached) return cached
  const r = rngFrom(seedFromItem(i))
  const owner = people[Math.floor(r() * people.length)]
  const notes = [
    'Lorem ipsum dolor amet Lorem ipsum…',
    'Kontrolní série A, připravit předhřev…',
    'Pozn.: vzorky skladovat při 4 °C…',
  ]
  const note = notes[Math.floor(r() * notes.length)]
  const v = { owner, note }
  extrasCache.set(i.id, v)
  return v
}

/** --- layout: side-by-side packing like Google Calendar --- */
type EventLayout = Record<number, { left: number; width: number }>

function eventsCollide(a: ResItem, b: ResItem): boolean {
  const aS = new Date(a.start).getTime()
  const aE = new Date(a.end).getTime()
  const bS = new Date(b.start).getTime()
  const bE = new Date(b.end).getTime()
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
    const end   = +new Date(ev.end)

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

  function expand(ev: ResItem, colIdx: number, cols: ResItem[][]): number {
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
        layout[ev.id] = {
          left: i / n,
          width: span / n,
        }
      })
    })
  }
  return layout
}

const layoutDailyByDevice = computed<Record<string, EventLayout>>(() => {
  const out: Record<string, EventLayout> = {}
  for (const d of devices.value) {
    const evs = itemsForDay.value.filter(x => x.deviceId === d.id)
    out[d.id] = layoutForTrack(evs)
  }
  return out
})

const layoutWeeklyByDay = computed<Record<string, EventLayout>>(() => {
  const days = daysForView.value
  const out: Record<string, EventLayout> = {}
  for (const day of days) {
    const key = dateKey(day)
    out[key] = layoutForTrack(itemsFor(day))
  }
  return out
})

/** --- Drag & drop – svižný ghost jako na Boardu + CLICK guard --- */
type DragState = {
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
const drag = ref<DragState | null>(null)
let movePending = false
let lastMoveEvent: PointerEvent | null = null
let highlightEl: HTMLElement | null = null

// click guard
const DRAG_CLICK_THRESHOLD = 5
const pointerStart = ref<{ x: number; y: number }>({ x: 0, y: 0 })
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
  const end   = new Date(item.end)

  // click guard init
  pointerStart.value = { x: e.clientX, y: e.clientY }
  movedBeyondThreshold.value = false

  // vytvoř ghost element (nezávislý na Vue reaktivitě)
  const ghost = target.cloneNode(true) as HTMLElement
  ghost.classList.add('drag-ghost')
  ghost.style.width = rect.width + 'px'
  ghost.style.height = rect.height + 'px'
  ghost.style.left = rect.left + 'px'
  ghost.style.top = rect.top + 'px'
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
    ghostEl: ghost,
  }

  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

function onPointerMove(ev: PointerEvent) {
  if (!drag.value) return
  lastMoveEvent = ev
  const dxAbs = Math.abs(ev.clientX - pointerStart.value.x)
  const dyAbs = Math.abs(ev.clientY - pointerStart.value.y)
  if (dxAbs > DRAG_CLICK_THRESHOLD || dyAbs > DRAG_CLICK_THRESHOLD) movedBeyondThreshold.value = true

  if (!movePending) {
    movePending = true
    requestAnimationFrame(() => {
      movePending = false
      if (!drag.value || !lastMoveEvent) return
      const d = drag.value
      const e = lastMoveEvent

      // posuň ghost v obou osách (aby byl vidět i mezi sloupci)
      const newLeft = e.clientX - d.offsetX
      const newTop = e.clientY - d.offsetY
      d.ghostEl.style.transform = `translate(${newLeft - d.originLeft}px, ${newTop - d.originTop}px)`

      // highlight trácku pod kurzorem
      const hit = findTrackAt(e.clientX, e.clientY)
      attachHighlight(hit?.el ?? null)
    })
  }
}

function findTrackAt(x: number, y: number) {
  let el = document.elementFromPoint(x, y) as HTMLElement | null
  while (el) {
    if (el.dataset && el.dataset.trackType && el.dataset.trackId) {
      const type = el.dataset.trackType
      const id = el.dataset.trackId
      const rect = el.getBoundingClientRect()
      return { el, type, id, rect }
    }
    el = el.parentElement
  }
  return null
}

function minutesFromTrackY(y: number, rect: DOMRect, offsetY: number) {
  const relY = clamp(y - rect.top - offsetY, 0, TRACK_HEIGHT)
  const minutes = (relY / PX_PER_MIN.value) + H_START * 60
  const snapped = clamp(roundToStep(minutes, GRID_MINUTES), H_START * 60, H_END * 60)
  return snapped
}

function commitMove(d: DragState, x: number, y: number) {
  const hit = findTrackAt(x, y)
  if (!hit) return

  const { type, id, rect } = hit
  let newDayKey = d.origDayKey
  let newDeviceId = d.origDeviceId

  if (d.view === 'daily-machines' && type === 'device') {
    newDeviceId = id
  } else if ((d.view === 'week-work' || d.view === 'week-all') && type === 'day') {
    newDayKey = id
  } else {
    return
  }

  const [Y, M, D] = newDayKey.split('-').map(Number)
  const baseDay = new Date(Y, (M || 1) - 1, D || 1, 0, 0, 0, 0)
  let startMinutes = minutesFromTrackY(y, rect, d.offsetY)
  const endMinutes = Math.min(H_END * 60, startMinutes + d.durationMin)
  if (endMinutes - startMinutes < d.durationMin) {
    startMinutes = Math.max(H_START * 60, endMinutes - d.durationMin)
  }

  const startDate = new Date(baseDay)
  startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0)
  const endDate = new Date(startDate.getTime() + d.durationMin * 60000)

  const sourceArr = eventsByDay.value[d.origDayKey] || []
  const srcIdx = sourceArr.findIndex(x => x.id === d.id)
  if (srcIdx === -1) return
  const ev = sourceArr[srcIdx]

  if (newDayKey !== d.origDayKey) {
    sourceArr.splice(srcIdx, 1)
    const targetArr = ensureDay(baseDay)
    targetArr.push({
      ...ev,
      deviceId: newDeviceId,
      start: toIsoLocal(startDate),
      end: toIsoLocal(endDate),
      status: ev.status,
    })
    targetArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  } else {
    ev.deviceId = newDeviceId
    ev.start = toIsoLocal(startDate)
    ev.end = toIsoLocal(endDate)
    sourceArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  }
}

function onPointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove)
  if (!drag.value) return

  // pokud se hýblo, potlač klik po dropu
  if (movedBeyondThreshold.value) {
    suppressClick.value = true
    if (suppressTimer) window.clearTimeout(suppressTimer)
    suppressTimer = window.setTimeout(() => { suppressClick.value = false }, 200)
  }

  commitMove(drag.value, e.clientX, e.clientY)
  // úklid
  clearHighlight()
  try { (e.target as HTMLElement)?.releasePointerCapture?.(drag.value.pointerId) } catch {}
  drag.value.ghostEl.remove()
  drag.value = null
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
})

function onEventClick(itemId: number, e: MouseEvent) {
  // otevřít detail jen při čistém kliku (bez drag)
  if (suppressClick.value || movedBeyondThreshold.value || drag.value) return
  openMenu.value[itemId] = true
}

/** --- Click-to-create --- */
const createOpen = ref(false)
const createForm = ref<{
  title: string
  deviceId: string
  dateYmd: string
  startHM: string
  endHM: string
} | null>(null)

function onTrackClick(evt: MouseEvent, ctx: { type: 'device'|'day'; deviceId?: string; day?: Date }) {
  // pokud se právě dnd dokončilo, ignoruj click
  if (drag.value || suppressClick.value) return
  const track = (evt.currentTarget as HTMLElement | null)
  if (!track) return
  const rect = track.getBoundingClientRect()
  const baseDay = ctx.type === 'day' ? (ctx.day as Date) : currentDay.value
  const minutes = minutesFromTrackY(evt.clientY, rect, 0)
  const start = new Date(baseDay)
  start.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  const defaultDur = 60
  const end = new Date(start.getTime() + defaultDur * 60000)
  const ymd = toYmdLocal(baseDay)

  const deviceId = ctx.type === 'device' ? (ctx.deviceId as string) : (devices.value[0]?.id || 'M1')

  createForm.value = {
    title: 'Nová rezervace',
    deviceId,
    dateYmd: ymd,
    startHM: hmFromDate(start),
    endHM: hmFromDate(end),
  }
  createOpen.value = true
}

function saveCreatedEvent() {
  if (!createForm.value) return
  const { title, deviceId, dateYmd, startHM, endHM } = createForm.value
  const day = fromYmdLocal(dateYmd)
  let start = setHM(day, startHM)
  let end   = setHM(day, endHM)
  if (end <= start) end = new Date(start.getTime() + 30 * 60000)

  const clampStart = new Date(day); clampStart.setHours(H_START, 0, 0, 0)
  const clampEnd   = new Date(day); clampEnd.setHours(H_END, 0, 0, 0)
  if (start < clampStart) start = clampStart
  if (end > clampEnd) end = clampEnd

  const arr = ensureDay(day)
  arr.push({
    id: autoId++,
    title: title?.trim() || 'Rezervace',
    deviceId,
    start: toIsoLocal(start),
    end: toIsoLocal(end),
    status: 'plan',
  })
  arr.sort((a, b) => +new Date(a.start) - +new Date(b.start))

  createOpen.value = false
  createForm.value = null
}

/** --- dialog/menus --- */
const openMenu = ref<Record<number, boolean>>({})
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <!-- LEVÝ PANEL -->
      <v-col cols="3">
        <v-sheet elevation="1" class="pa-4">
          <v-date-picker v-model="selectedDate" color="primary" />
        </v-sheet>
        <v-sheet elevation="1" class="pa-4 mt-4">
          <v-select v-model="pickedMembers" :items="members" label="Členové" clearable multiple density="comfortable" />
          <v-select v-model="pickedDevices" :items="devices.map(d => d.name)" label="Přístroje" clearable multiple density="comfortable" class="mt-4" />
        </v-sheet>
      </v-col>

      <!-- PRAVÝ PANEL -->
      <v-col cols="12" md="9">
        <v-card class="mb-3">
          <v-card-text class="d-flex flex-wrap align-center">
            <v-btn color="primary" class="mr-2" @click="() => {
              const day = fromYmdLocal(selectedDate)
              const start = new Date(day); start.setHours(9, 0, 0, 0)
              const end = new Date(start.getTime() + 60*60000)
              createForm = {
                title: 'Nová rezervace',
                deviceId: devices[0]?.id || 'M1',
                dateYmd: selectedDate,
                startHM: (start.getHours()+'').padStart(2,'0') + ':' + (start.getMinutes()+'').padStart(2,'0'),
                endHM: (end.getHours()+'').padStart(2,'0') + ':' + (end.getMinutes()+'').padStart(2,'0'),
              }
              createOpen = true
            }">VYTVOŘIT REZERVACI</v-btn>

            <v-menu>
              <template #activator="{ props }">
                <v-btn v-bind="props" append-icon="mdi-menu-down" variant="tonal">{{ viewLabel }}</v-btn>
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
            <div class="text-subtitle-1 mx-2">{{ fmtDateLong(fromYmdLocal(selectedDate)) }}</div>
            <v-btn icon="mdi-chevron-right" variant="text" @click="addDays(1)" />
          </v-card-text>
        </v-card>

        <v-card>
          <v-card-text>
            <!-- Denní – stroje -->
            <div v-if="viewMode === 'daily-machines'">
              <div class="d-flex flex-wrap mb-3">
                <div v-for="d in devices" :key="d.id" class="d-flex align-center mr-4 mb-1">
                  <v-chip :color="d.color" size="x-small" class="mr-2" />
                  <span class="text-caption">{{ d.name }}</span>
                </div>
              </div>

              <div class="schedule">
                <!-- hlavička -->
                <div class="tracks row header" :style="{ '--cols': String(colsDevices) }">
                  <div class="time-col"></div>
                  <div v-for="d in devices" :key="d.id" class="track-name">
                    <div class="weekday">{{ d.name }}</div>
                  </div>
                </div>

                <!-- tělo -->
                <div class="tracks row body" :style="{ '--cols': String(colsDevices) }">
                  <div class="time-col">
                    <div v-for="h in hourTicks" :key="h" class="time-tick" :style="{ height: tickHeight + 'px' }">
                      {{ (H_START + h - 1).toString().padStart(2,'0') }}:00
                    </div>
                  </div>

                  <div
                    v-for="d in devices"
                    :key="d.id"
                    class="track"
                    :style="{ height: TRACK_HEIGHT + 'px' }"
                    :data-track-type="'device'"
                    :data-track-id="d.id"
                    @click.self="onTrackClick($event, { type: 'device', deviceId: d.id })"
                  >
                    <v-menu
                      v-for="i in itemsForDay.filter(x => x.deviceId === d.id)"
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
                          v-bind="props"
                          @pointerdown.stop.prevent="onEventPointerDown($event, i)"
                          @click.stop="onEventClick(i.id, $event)"
                          :style="{
                            top: topFromDate(new Date(i.start)) + 'px',
                            height: heightFromRange(new Date(i.start), new Date(i.end)) + 'px',
                            left: `calc(${(layoutDailyByDevice[d.id]?.[i.id]?.left ?? 0) * 100}% + 8px)`,
                            width: `calc(${(layoutDailyByDevice[d.id]?.[i.id]?.width ?? 1) * 100}% - 16px)`,
                            borderLeft: `4px solid var(--v-theme-${d.color})`
                          }"
                        >
                          <div class="event-title">{{ i.title }}</div>
                          <div class="event-time">{{ fmtTime(new Date(i.start)) }} – {{ fmtTime(new Date(i.end)) }}</div>
                        </div>
                      </template>

                      <v-card class="detail-card pa-3">
                        <div class="d-flex align-start">
                          <v-icon :color="deviceColorOf(i.deviceId)" size="16" class="mr-3 mt-1">mdi-checkbox-blank-circle</v-icon>

                          <div class="flex-grow-1">
                            <div class="d-flex align-center justify-space-between mb-1">
                              <div class="text-subtitle-1 font-weight-medium">{{ i.title }}</div>
                              <div class="d-flex align-center">
                                <v-btn icon="mdi-pencil-outline" size="small" variant="text" />
                                <v-btn icon="mdi-delete-outline" size="small" variant="text" @click="() => {
                                  const k = dateKey(new Date(i.start))
                                  const arr = eventsByDay[k] || []
                                  const idx = arr.findIndex(x => x.id === i.id)
                                  if (idx !== -1) arr.splice(idx, 1)
                                  openMenu[i.id] = false
                                }" />
                                <v-btn icon="mdi-close" size="small" variant="text" @click="openMenu[i.id] = false" />
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
                              <div class="text-body-2">{{ extrasFor(i).owner }}</div>
                            </div>

                            <div class="d-flex align-center text-medium-emphasis mt-2">
                              <v-icon size="18" class="mr-2">mdi-text</v-icon>
                              <div class="text-body-2 text-truncate-1">{{ extrasFor(i).note }}</div>
                            </div>
                          </div>
                        </div>
                      </v-card>
                    </v-menu>
                  </div>
                </div>
              </div>
            </div>

            <!-- Denní – seznam -->
            <div v-else-if="viewMode === 'daily-list'">
              <v-data-table :headers="tableHeaders" :items="tableItems" items-per-page="10" class="elevation-1">
                <template #item.status="{ item }">
                  <v-chip
                    size="small"
                    :color="item._raw.status === 'done' ? 'green' : (item._raw.status === 'running' ? 'blue' : 'grey')"
                    text-color="white"
                    variant="flat"
                    class="text-capitalize"
                  >
                    {{ item._raw.status === 'plan' ? 'Plánované' : item._raw.status === 'running' ? 'Probíhá' : 'Dokončeno' }}
                  </v-chip>
                </template>
              </v-data-table>
            </div>

            <!-- Týdenní -->
            <div v-else>
              <div class="schedule">
                <!-- hlavička: dny -->
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

                <!-- tělo -->
                <div class="tracks row body" :style="{ '--cols': String(colsWeek) }">
                  <div class="time-col">
                    <div v-for="h in hourTicks" :key="h" class="time-tick" :style="{ height: tickHeight + 'px' }">
                      {{ (H_START + h - 1).toString().padStart(2,'0') }}:00
                    </div>
                  </div>

                  <div
                    v-for="day in daysForView"
                    :key="day.toISOString()"
                    class="track"
                    :class="{ weekend: [0,6].includes(day.getDay()) }"
                    :style="{ height: TRACK_HEIGHT + 'px' }"
                    :data-track-type="'day'"
                    :data-track-id="dateKey(day)"
                    @click.self="onTrackClick($event, { type: 'day', day })"
                  >
                    <v-menu
                      v-for="i in itemsFor(day)"
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
                          v-bind="props"
                          @pointerdown.stop.prevent="onEventPointerDown($event, i)"
                          @click.stop="onEventClick(i.id, $event)"
                          :style="{
                            top: topFromDate(new Date(i.start)) + 'px',
                            height: heightFromRange(new Date(i.start), new Date(i.end)) + 'px',
                            left: `calc(${(layoutWeeklyByDay[dateKey(day)]?.[i.id]?.left ?? 0) * 100}% + 8px)`,
                            width: `calc(${(layoutWeeklyByDay[dateKey(day)]?.[i.id]?.width ?? 1) * 100}% - 16px)`,
                            borderLeft: `4px solid var(--v-theme-${(devices.find(d => d.id === i.deviceId)?.color) || 'primary'})`
                          }"
                        >
                          <div class="event-title">{{ i.title }}</div>
                          <div class="event-time">{{ fmtTime(new Date(i.start)) }} – {{ fmtTime(new Date(i.end)) }}</div>
                        </div>
                      </template>

                      <v-card class="detail-card pa-3">
                        <div class="d-flex align-start">
                          <v-icon :color="deviceColorOf(i.deviceId)" size="16" class="mr-3 mt-1">mdi-checkbox-blank-circle</v-icon>
                          <div class="flex-grow-1">
                            <div class="d-flex align-center justify-space-between mb-1">
                              <div class="text-subtitle-1 font-weight-medium">{{ i.title }}</div>
                              <div class="d-flex align-center">
                                <v-btn icon="mdi-pencil-outline" size="small" variant="text" />
                                <v-btn icon="mdi-delete-outline" size="small" variant="text" @click="() => {
                                  const k = dateKey(new Date(i.start))
                                  const arr = eventsByDay[k] || []
                                  const idx = arr.findIndex(x => x.id === i.id)
                                  if (idx !== -1) arr.splice(idx, 1)
                                  openMenu[i.id] = false
                                }" />
                                <v-btn icon="mdi-close" size="small" variant="text" @click="openMenu[i.id] = false" />
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
                              <div class="text-body-2">{{ extrasFor(i).owner }}</div>
                            </div>
                            <div class="d-flex align-center text-medium-emphasis mt-2">
                              <v-icon size="18" class="mr-2">mdi-text</v-icon>
                              <div class="text-body-2 text-truncate-1">{{ extrasFor(i).note }}</div>
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

    <!-- Dialog – vytvoření rezervace -->
    <Dialog v-model:is-open="createOpen" width="600px" :hide-footer="false">
      <template #header>Vytvořit rezervaci</template>
      <template #content>
        <v-text-field
          v-model="createForm!.title"
          label="Název"
          density="comfortable"
          variant="outlined"
          class="mb-2"
        />
        <v-select
          v-model="createForm!.deviceId"
          :items="devices"
          item-title="name"
          item-value="id"
          label="Přístroj"
          density="comfortable"
          variant="outlined"
          class="mb-2"
        />
        <v-text-field
          v-model="createForm!.dateYmd"
          label="Datum"
          type="date"
          density="comfortable"
          variant="outlined"
          class="mb-2"
        />
        <div class="d-flex" style="gap:12px">
          <v-text-field
            v-model="createForm!.startHM"
            label="Začátek"
            type="time"
            density="comfortable"
            variant="outlined"
          />
          <v-text-field
            v-model="createForm!.endHM"
            label="Konec"
            type="time"
            density="comfortable"
            variant="outlined"
          />
        </div>
      </template>
      <template #footer>
        <v-btn color="primary" @click="saveCreatedEvent">Uložit</v-btn>
        <v-btn variant="text" @click="createOpen = false">Zrušit</v-btn>
      </template>
    </Dialog>
  </v-container>
</template>

<style scoped>
/* Event základ */
.event { cursor: grab; user-select: none; }
.event:active { cursor: grabbing; }

/* Ghost element pro svižný drag (DOM, mimo Vue render) */
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

/* Zvýraznění tracku pod kurzorem */
.drop-highlight {
  outline: 2px dashed var(--v-theme-primary);
  outline-offset: -2px;
}

/* pop-over detail */
.detail-card {
  background: #eceff1;
  border-radius: 14px;
  box-shadow: 0 6px 20px rgba(0,0,0,.18);
}

.text-truncate-1 {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* rozvrh */
.schedule { border-radius: 12px; overflow: hidden; }
.tracks.row.header { display: grid; grid-template-columns: 80px repeat(var(--cols, 5), 1fr); gap: 0; border-bottom: 1px solid #e5e5e5; }
.tracks.row.body   { display: grid; grid-template-columns: 80px repeat(var(--cols, 5), 1fr); }

.time-col { background: #fafafa; border-right: 1px solid #e5e5e5; }
.time-tick { padding: 4px 8px; font-size: 12px; color: #777; border-bottom: 1px dashed #eee; }

.track-name { padding: 12px 8px; text-align: center; border-left: 1px solid #f1f1f1; }
.track-name .weekday { text-transform: uppercase; font-weight: 700; letter-spacing: .02em; }
.track-name.weekend { background: #fafaff; }

.track {
  position: relative; border-left: 1px solid #f1f1f1;
  background: repeating-linear-gradient(to bottom, rgba(0,0,0,0.02) 0, rgba(0,0,0,0.02) 40px, transparent 40px, transparent 80px);
}
.track.weekend {
  background:
    linear-gradient(to bottom, rgba(70,120,255,0.04), rgba(70,120,255,0.04)),
    repeating-linear-gradient(to bottom, rgba(0,0,0,0.02) 0, rgba(0,0,0,0.02) 40px, transparent 40px, transparent 80px);
}

.event {
  position: absolute;
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  padding: 8px 10px 8px 10px;
}
.event-title {
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  text-overflow: ellipsis;
  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
  hyphens: auto;
}
.event-time {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
