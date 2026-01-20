<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
//conflict dialog in calendar
import ConflictDialog from '@/components/reservations/ConflictDialog.vue'
import { buildDayGaps, proposeSlotsAround, firstGapNextDays, type ResItem as ResItemSlot } from '@/utils/calendar/calendarSlotHelpers'
import EntityEditorDialog from '@/components/EntityEditorDialog.vue'
import Dialog from '@/components/Dialog.vue'
import { layoutForDeviceEvents, type EventLayout as EventLayoutImported} from '@/utils/calendar/computeOverlapLayout'
import { useReservationsStore } from '@/stores/reservations'
import { useDeviceStore } from '@/stores/devices'
import { useProjectStore } from '@/stores/project/project'
import { auth } from '@/stores/auth'
import DailyMachinesView from '@/components/reservations/DailyMachinesView.vue'
import DailyListView from '@/components/reservations/DailyListView.vue'
import WeekView from '@/components/reservations/WeekView.vue'
import RecurrenceEditor from '@/components/reservations/RecurrenceEditor.vue'
import ReservationEditorDialog from '@/components/reservations/ReservationEditorDialog.vue'
import LeftFiltersPanel from '@/components/LeftFiltersPanel.vue'
import FilterMultiSelect from '@/components/ui/FilterMultiSelect.vue'
import DateFilterPanel, { type DateFilter } from '@/components/ui/DateFilterPanel.vue'
import SeriesScopeDialog from '@/components/reservations/SeriesScopeDialog.vue'
import type { RecurrenceRequest } from '@/stores/reservations'
const HOURS_START = 0
const HOURS_END = 24
const GRID_MINUTES = 15
const VIEWPORT_HEIGHT = 780
const VIEWPORT_HEIGHT_TWO_WEEKS = 365 // Slightly larger for better visibility
const HOUR_HEIGHT = 90
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
  seriesId?: string | null
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
  copyMode?: boolean
  mode: 'move' | 'resize'
  origStart: Date
  origEnd: Date
  origHeight: number
}
type EventLayoutLocal = Record<number, { left: number; width: number }>


type EventLayout = Record<number, { left: number; width: number }>
const route = useRoute()
const projectId = Number((route.params as any).projectId)
const reservations = useReservationsStore()
const projectStore = useProjectStore()
function pad2(n: number): string { return String(n).padStart(2, '0') }

function fromYmdLocal(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
}

function hmFromDate(d: Date): string { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

function setHM(base: Date, hm: string) {
  const [h, m] = hm.split(':').map(v => parseInt(v, 10) || 0)
  const d = new Date(base); d.setHours(h, m, 0, 0); return d
}
function toIsoLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/* CONFLICT DIALOG CALLBACKS */



function onConfirmConflict(slot: { start: Date; end: Date }) {
  conflictOpen.value = false
  const ctx = conflictCtx.value
  conflictCtx.value = null
  if (!ctx) return

  const { reservationId, deviceId, dayKey } = ctx
  const startMs = slot.start.getTime()
  const endMs = slot.end.getTime()

  if (wouldConflict(reservationId, deviceId, slot.start, slot.end, dayKey)) {
    // závod na FE – neriskuj, nevolej PATCH
    return
  }

  reservations.updateReservation(reservationId, {
    startTime: startMs,
    endTime: endMs,
    deviceCode: deviceId
  })
    .then(async () => {
      // Navigate to the new date if different
      const newDateYmd = toYmdLocal(slot.start)
      if (selectedDate.value !== newDateYmd) {
        selectedDate.value = newDateYmd
      }

      await nextTick()
      await loadWeekFor(slot.start)

      // Scroll to the new time and highlight the reservation
      await nextTick()
      scrollToTime(slot.start)
      highlightReservation(reservationId)
    })
    .catch((e) => {
      console.error('Confirm-conflict update failed', e)
    })
}

function onSuggestNextDay() {
  conflictOpen.value = false
  const next = conflictFallbackNext.value
  conflictCtx.value = null
  if (next) {
    selectedDate.value = toYmdLocal(next.day)
    // Volitelné: rovnou otevři editor
    // const deviceCode = conflictCtx.value?.deviceId ?? (devicesToShow.value[0]?.id || allDevices.value[0]?.id || 'M1')
    // openCreateWith({ baseDay: next.day, start: next.slot.start, end: next.slot.end, deviceCode })
  }
}




// DTO from DailyListView
function toYmdLocal(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeToDate(val: string | Date): Date {
  if (val instanceof Date) return val
  return new Date(val + 'T00:00:00')
}

interface ReservationDto {
  id: number
  title: string
  deviceCode: string
  startTime: number
  endTime: number
  username: string | null
  projectId: number
  note: string | null
  seriesId?: string | null
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
    note: r.note ?? null,
    seriesId: r.seriesId ?? null
  }
}
function openEditFromDto(raw: ReservationDto) { openEdit(dtoToResItem(raw)) }
function askDeleteFromDto(raw: ReservationDto) { askDelete(dtoToResItem(raw)) }
/* Date selection  */
const selectedDate = ref<string | Date>(toYmdLocal(new Date()))
const navigationStep = ref<'day' | 'week' | 'month'>('day')
let isNavigating = false

function addDays(n: number) {
  isNavigating = true
  const d = normalizeToDate(selectedDate.value)

  if (navigationStep.value === 'month') {
    // Go to first day of target month
    d.setDate(1)
    d.setMonth(d.getMonth() + n)

    // Calculate full month range for the new month
    const newFrom = new Date(d)
    const newTo = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)

    // Update filter model explicitly to keep 'to' in sync
    // IMPORTANT: Keep preset as 'thisMonth' so the UI button stays active
    dateFilterModel.value = {
      ...dateFilterModel.value,
      from: newFrom,
      to: newTo,
      preset: 'thisMonth'
    }

    selectedDate.value = toYmdLocal(d)

    nextTick(() => { isNavigating = false })
    return
  }

  // Use week step (7 days) for week views OR if week navigation is active
  const isWeekStep = viewMode.value.startsWith('week-') || navigationStep.value === 'week'
  const step = isWeekStep ? 7 : 1

  // Calculate shift
  const shiftDays = n * step
  d.setDate(d.getDate() + shiftDays)

  // If we have a range defined (from & to), we should shift the 'to' date as well
  if (dateFilterModel.value.from && dateFilterModel.value.to) {
     const diffMs = dateFilterModel.value.to.getTime() - dateFilterModel.value.from.getTime()
     const newFrom = new Date(d)
     const newTo = new Date(d.getTime() + diffMs)

     // For week navigation, try to preserve the 'week' preset look if effective
     let newPreset = dateFilterModel.value.preset
     if (isWeekStep && (newPreset === 'thisWeek' || newPreset === 'nextWeek')) {
        newPreset = 'thisWeek'
     } else {
        newPreset = null
     }

     dateFilterModel.value = {
       ...dateFilterModel.value,
       from: newFrom,
       to: newTo,
       preset: newPreset
     }
  }

  selectedDate.value = toYmdLocal(d)
  nextTick(() => { isNavigating = false })
}

function goToday() { selectedDate.value = toYmdLocal(new Date()) }
const currentDay = computed<Date>(() => normalizeToDate(selectedDate.value))

/* DateFilterPanel sync */
const dateFilterModel = ref<DateFilter>({
  field: 'date',
  preset: null,
  from: normalizeToDate(selectedDate.value),
  to: null
})

// Update navigation mode based on preset
watch(() => dateFilterModel.value.preset, (p) => {
  if (isNavigating) return
  if (p === 'thisMonth') navigationStep.value = 'month'
  else if (p === 'thisWeek' || p === 'nextWeek') navigationStep.value = 'week'
  else navigationStep.value = 'day'
})

// Sync selectedDate -> dateFilterModel
watch(selectedDate, (val) => {
   const d = normalizeToDate(val)
   if (dateFilterModel.value.from?.getTime() !== d.getTime()) {
      dateFilterModel.value = { ...dateFilterModel.value, from: d, preset: null }
   }
})

// Sync dateFilterModel -> selectedDate
function onDateFilterUpdate(val: DateFilter) {
   dateFilterModel.value = val;
   if (val.from) {
      selectedDate.value = toYmdLocal(val.from)
   }
}

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
const showTwoWeeks = ref(false)
const membersList = computed<string[]>(() =>
  projectStore.projectMembers.map((m: { username: string }) => m.username)
)

const deviceStore = useDeviceStore()


const allDevices = computed(() => deviceStore.devices.map(d => ({
  id: d.code,
  name: d.name,
  color: d.color || 'primary'
})))
const devicesToShow = computed(() =>
  pickedDevices.value.length
    ? allDevices.value.filter(d => pickedDevices.value.includes(d.id))
    : allDevices.value
)

const devicesForFilter = computed(() => {
  if (viewMode.value === 'daily-list' && dailyListRef.value?.usedDeviceCodes) {
    const codes = new Set(dailyListRef.value.usedDeviceCodes)
    // If list is loaded, filter available devices to only those present in the list
    return allDevices.value.filter(d => codes.has(d.id))
  }
  return allDevices.value
})

const membersForFilter = computed(() => {
  if (viewMode.value === 'daily-list' && dailyListRef.value?.usedUsernames) {
    const users = new Set(dailyListRef.value.usedUsernames)
    return membersList.value.filter(u => users.has(u))
  }
  return membersList.value
})


// function arraysEqual(a: string[], b: string[]) {
//   if (a.length !== b.length) return false
//   const as = [...a].sort(), bs = [...b].sort()
//   return as.every((v, i) => v === bs[i])
// }


// Stav cofnlict dialogu
type ConflictContext = {
  reservationId: number
  deviceId: string
  dayKey: string
} | null

const conflictCtx = ref<ConflictContext>(null)

const conflictOpen = ref(false)
const conflictDeviceName = ref<string>('')
const conflictRequested = ref<{ start: Date; end: Date }>({ start: new Date(), end: new Date() })
const conflictProposals = ref<Array<{ slot: { start: Date; end: Date }; label: string }>>([])
const conflictFallbackNext = ref<{ day: Date; slot: { start: Date; end: Date } } | null>(null)

interface ConflictItem {
  id: number
  title: string
  start: Date
  end: Date
  username: string | null
}

const conflictAllReservations = ref<ConflictItem[]>([])


// list of conflicting reservations for display
const conflictItems = ref<Array<{ id: number; title: string; start: Date; end: Date; username: string | null }>>([])
// Pending force-create payload (saved when conflict occurs)
type PendingForceContext = {
  action: 'create' | 'update_single' | 'update_series'
  id?: number
  scope?: 'single' | 'series' | 'following'
  payload: {
    title: string
    deviceCode: string
    startTime: number
    endTime: number
    projectId: number
    username: string
    note: string | null
    recurrence?: RecurrenceRequest | null
  }
}
const pendingForcePayload = ref<PendingForceContext | null>(null)

function deviceNameById(id: string): string {
  return allDevices.value.find(d => d.id === id)?.name || id
}
function getEventsForDayDevice(day: Date, deviceId: string): ResItem[] {
  const k = dateKey(day)
  return (eventsByDay.value[k] ?? []).filter(e => e.deviceId === deviceId)
}

const allReservationsForDevice = ref<ConflictItem[]>([])


function openConflictDialog(
  deviceId: string,
  requested: { start: Date; end: Date },
  ctx: { reservationId: number; dayKey: string }
) {
  conflictCtx.value = { reservationId: ctx.reservationId, deviceId, dayKey: ctx.dayKey }
  conflictDeviceName.value = deviceNameById(deviceId)
  conflictRequested.value = requested
  const dayBase = new Date(requested.start.getFullYear(), requested.start.getMonth(), requested.start.getDate(), 0, 0, 0, 0)
  const gaps = buildDayGaps(getEventsForDayDevice(dayBase, deviceId), dayBase)
  const props = proposeSlotsAround(requested, gaps)
  conflictProposals.value = props.map((s, idx) => ({ slot: s, label: idx === 0 ? 'Nejbližší po' : 'Nejbližší před' }))
  conflictFallbackNext.value = firstGapNextDays(getEventsForDayDevice, dayBase, deviceId, requested.end.getTime() - requested.start.getTime(), 30)
  conflictOpen.value = true
    const all: ConflictItem[] = []
  for (const [dayKey, events] of Object.entries(eventsByDay.value)) {
    for (const ev of events) {
      if (ev.deviceId === deviceId) {
        all.push({
          id: ev.id,
          title: ev.title,
          start: new Date(ev.start),
          end: new Date(ev.end),
          username: ev.username
        })
      }
    }
  }
  allReservationsForDevice.value = all

  // Filter actual conflicts for the dialog
  conflictItems.value = all.filter(e => {
    if (e.id === ctx.reservationId) return false
    const s = e.start.getTime()
    const E = e.end.getTime()
    const rs = requested.start.getTime()
    const re = requested.end.getTime()
    return s < re && E > rs
  })
}

// Pomocník – kontrola kolize s jinou rezervací na stejném zařízení (aktuální den):
function wouldConflict(id: number, deviceId: string, start: Date, end: Date, dayKey: string): boolean {
  const arr = (eventsByDay.value[dayKey] ?? []).filter(e => e.deviceId === deviceId)
  const target = { start, end }
  return arr.some(e => e.id !== id && (new Date(e.end).getTime() > start.getTime() && new Date(e.start).getTime() < end.getTime()))
}



/* View Mode */
const viewMode = ref<ViewMode>('daily-machines')
const listIncludeWeekends = ref(true) // Defaultně true pro seznamový pohled
const viewLabel = computed(() => {
  switch (viewMode.value) {
    case 'daily-machines': return 'DENNÍ – STROJE'
    case 'week-work': return 'TÝDENNÍ (PRACOVNÍ)'
    case 'week-all': return 'TÝDENNÍ (S VÍKENDY)'
    case 'daily-list': return 'SEZNAM REZERVACÍ'
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

// Scroll to a specific time (smooth scroll)
function scrollToTime(date: Date) {
  const el = viewportDaily.value || viewportWeek.value
  if (!el) return
  const hour = date.getHours() + date.getMinutes() / 60
  // Scroll a bit before the time so the event is visible
  const targetHour = Math.max(0, hour - 1)
  const targetY = targetHour * 60 * PX_PER_MIN.value
  const y = Math.max(0, Math.min(FULL_TRACK_HEIGHT.value - el.clientHeight, targetY))
  el.scrollTo({ top: y, behavior: 'smooth' })
}

// Highlight state for reservation
const highlightedReservationId = ref<number | null>(null)

// Highlight a reservation with flash animation
function highlightReservation(reservationId: number) {
  highlightedReservationId.value = reservationId
  // Clear highlight after animation
  setTimeout(() => {
    highlightedReservationId.value = null
  }, 2000)
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
function weekRange(date: Date, showNextWeekOnWeekend: boolean = false) {
  const base = new Date(date)
  const dayOfWeek = base.getDay() // 0 = Sunday, 6 = Saturday

  // Calculate offset to Monday (0 = already Monday, 1 = Sunday needs +1, etc.)
  let offsetToMonday = (dayOfWeek === 0) ? -6 : 1 - dayOfWeek

  // If we're on weekend and showing work week, show NEXT week instead
  if (showNextWeekOnWeekend && (dayOfWeek === 0 || dayOfWeek === 6)) {
    // Sunday: add 1 day to get to Monday
    // Saturday: add 2 days to get to Monday
    offsetToMonday = dayOfWeek === 0 ? 1 : 2
  }

  const monday = new Date(base)
  monday.setDate(base.getDate() + offsetToMonday)

  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday); x.setDate(monday.getDate() + i); return x
  })
}
const weekDaysAll = computed<Date[]>(() => weekRange(currentDay.value, false))
const weekDaysWork = computed<Date[]>(() => {
  // For work week view, show next week on weekends
  const isWeekend = currentDay.value.getDay() === 0 || currentDay.value.getDay() === 6
  const showNextWeek = viewMode.value === 'week-work' && isWeekend
  return weekRange(currentDay.value, showNextWeek).slice(0, 5)
})

// Week 2 (next week) for two-week view
const week2DaysAll = computed<Date[]>(() => {
  const lastDayOfWeek1 = weekDaysAll.value[weekDaysAll.value.length - 1]
  if (!lastDayOfWeek1) return []
  const nextMonday = new Date(lastDayOfWeek1)
  nextMonday.setDate(lastDayOfWeek1.getDate() + 1)
  return weekRange(nextMonday, false)
})
const week2DaysWork = computed<Date[]>(() => {
  const lastDayOfWeek1 = weekDaysWork.value[weekDaysWork.value.length - 1]
  if (!lastDayOfWeek1) return []
  const nextMonday = new Date(lastDayOfWeek1)
  nextMonday.setDate(lastDayOfWeek1.getDate() + 3) // Skip weekend (Fri + 3 = Mon)
  return weekRange(nextMonday, false).slice(0, 5)
})

const daysForView = computed<Date[]>(() => {
  // 1. Custom range logic (only if NOT in 2-week mode, because 2-week mode uses split views)
  if (!showTwoWeeks.value && dateFilterModel.value.preset === 'custom' && dateFilterModel.value.from && dateFilterModel.value.to) {
    const s = startOfDay(dateFilterModel.value.from)
    const e = endOfDay(dateFilterModel.value.to)
    // Generate all days between from/to inclusive
    const days: Date[] = []
    const cur = new Date(s)
    let safeGuard = 0
    while (cur <= e && safeGuard < 366) {
      const d = new Date(cur)
      const isWeekend = d.getDay() === 0 || d.getDay() === 6
      // In work mode, skip weekends
      if (viewMode.value !== 'week-work' || !isWeekend) {
        days.push(d)
      }
      cur.setDate(cur.getDate() + 1)
      safeGuard++
    }
    return days
  }

  // 2. Default View logic (used for standard week view AND for the first week of 2-week view)
  return viewMode.value === 'week-work' ? weekDaysWork.value : weekDaysAll.value
})

// Days for second week view (when showTwoWeeks is enabled)
const daysForWeek2 = computed<Date[]>(() => {
  return viewMode.value === 'week-work' ? week2DaysWork.value : week2DaysAll.value
})

const colsDevices = computed<number>(() => devicesToShow.value.length)
const colsWeek = computed<number>(() => daysForView.value.length)
/* Load events */
function resetAllDays(days: Date[]) {
  for (const d of days) eventsByDay.value[dateKey(d)] = []
}
async function loadWeekFor(date: Date) {
  // NOTE: When using custom range, loadWeekFor needs to respect that range too.
  // However, loadWeekFor is often called with `currentDay` (single date) when navigating or changing view.
  // We need to decide if we fetch exactly daysForView or a standard week around `date`.
  // Given the requirement "zobrazení pouze těch dnl", let's use daysForView if compatible with `date` (i.e. `date` falls within).

  let days: Date[]
  const dateMs = date.getTime()

  // Check if `date` is within the current `daysForView` range. If so, reuse that range.
  // Otherwise, fallback to standard week logic around `date`.
  const currentViewDays = daysForView.value
  const first = currentViewDays[0]
  const last = currentViewDays[currentViewDays.length - 1]

  if (first && last && dateMs >= first.getTime() && dateMs <= last.getTime()) {
     days = currentViewDays
  } else {
     // Fallback to standard 7 days if we navigate outside or if the custom range isn't active/applicable
     days = weekRange(date)
  }

  // If showTwoWeeks is enabled, also fetch data for week 2
  if (showTwoWeeks.value && daysForWeek2.value.length > 0) {
    days = [...days, ...daysForWeek2.value]
  }

  const from = new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate(), 0, 0, 0, 0).getTime()
  const lastDay = days[days.length - 1]
  const to = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59, 999).getTime()

  // Fetch new data BEFORE clearing old data to avoid "blink"
  const data = await reservations.fetchByProject(projectId, from, to)

  // Build new structure
  const newEventsByDay: Record<string, ResItem[]> = {}
  for (const d of days) newEventsByDay[dateKey(d)] = []

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
      note: r.note ?? null,
      seriesId: r.seriesId ?? null
    }
    const k = dateKey(s)
    if (!newEventsByDay[k]) newEventsByDay[k] = []
    newEventsByDay[k].push(item)
  }

  // Sort each day's events
  for (const k of Object.keys(newEventsByDay)) {
    newEventsByDay[k].sort((a, b) => +new Date(a.start) - +new Date(b.start))
  }

  // Atomic replacement - no blink
  for (const k of Object.keys(newEventsByDay)) {
    eventsByDay.value[k] = newEventsByDay[k]
  }
  // NOTE: scrollToHour removed here - scroll should only happen on initial load or view switch
}
/* Initial load */
onMounted(async () => {
  await deviceStore.fetchDevices()              // ← místo reservations.fetchDevices()
  await projectStore.fetchProjectMembers(projectId)
  await loadWeekFor(currentDay.value)
  await nextTick()
  scrollToHour(7)
})


watch(selectedDate, async v => {
  if (drag.value) {
    drag.value.ghostEl.remove()
    drag.value = null
    clearHighlight()
    window.removeEventListener('pointermove', onPointerMove)
  }
  await loadWeekFor(normalizeToDate(v))
  await nextTick()
  scrollToHour(7) // Scroll to default when user navigates dates
})


watch(viewMode, async (newMode, oldMode) => {
  // pokud běží drag, force ukončení
  if (drag.value) {
    drag.value.ghostEl.remove()
    drag.value = null
    clearHighlight()
    window.removeEventListener('pointermove', onPointerMove)
  }

  // When switching TO daily-machines from any other view, reset to today
  if (newMode === 'daily-machines' && oldMode !== 'daily-machines') {
    const today = new Date()
    selectedDate.value = toYmdLocal(today)
    dateFilterModel.value = {
      field: 'date',
      preset: 'today',
      from: today,
      to: null
    }
    navigationStep.value = 'day'
  }

  // When switching TO week views from daily-list, reset to this week
  if ((newMode === 'week-work' || newMode === 'week-all') && oldMode === 'daily-list') {
    const today = new Date()
    // Calculate week start (Monday)
    const dayOfWeek = today.getDay()
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() + diffToMonday)
    weekStart.setHours(0, 0, 0, 0)

    // Calculate week end based on view mode
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + (newMode === 'week-all' ? 6 : 4))
    weekEnd.setHours(23, 59, 59, 999)

    selectedDate.value = toYmdLocal(today)
    dateFilterModel.value = {
      field: 'date',
      preset: 'thisWeek',
      from: weekStart,
      to: weekEnd
    }
    navigationStep.value = 'week'
  }

  await nextTick()
  scrollToHour(7)
})


/* Daily list auto-load */
type DailyListViewExposed = {
  loadListRange: (silent?: boolean) => void | Promise<void>
  loadAll?: (silent?: boolean) => void | Promise<void>
  addReservation?: (item: { id: number; title: string; deviceCode: string; startTime: number; endTime: number; username: string | null; projectId: number; note: string | null }) => void
  updateReservation?: (id: number, updates: Partial<{ title: string; deviceCode: string; startTime: number; endTime: number; username: string | null; note: string | null }>) => void
  removeReservation?: (id: number) => void
  usedDeviceCodes?: string[]
  usedUsernames?: string[]
  highlightSeries?: (sid: string) => void
}
const dailyListRef = ref<DailyListViewExposed | null>(null)
const isDailyList = computed(() => viewMode.value === 'daily-list')
watch(isDailyList, async v => { if (v) { await nextTick(); dailyListRef.value?.loadListRange() } })

// Reload data when showTwoWeeks changes
watch(showTwoWeeks, async () => {
  if (!isDailyList.value) {
    await loadWeekFor(currentDay.value)
  }
})

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
  const baseClass = (color === 'primary' || color === 'secondary') ? `bg-${color}` : `bg-${color}-lighten-4`
  // Add highlight class if this reservation was just rescheduled
  if (highlightedReservationId.value === i.id) {
    return `${baseClass} event-highlighted`
  }
  return baseClass
}
function eventStyle(i: ResItem, left: number, width: number): Record<string, string> {
  const color = deviceColorOf(i.deviceId)
  return {
    top: `${topFromDate(new Date(i.start))}px`,
    height: `${heightFromRange(new Date(i.start), new Date(i.end))}px`,
    left: `${left * 100}%`,
    width: `${width * 100}%`,
    borderLeft: `4px solid var(--v-theme-${color})`,
    background: `color-mix(in srgb, var(--v-theme-${color}) 18%, #fff)`
  }
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
/*
const layoutDailyByDevice = computed<Record<string, EventLayout>>(() => {
  const out: Record<string, EventLayout> = {}
  for (const d of devicesToShow.value) out[d.id] = layoutForTrack(itemsForDayDevice(d.id))
  return out
})

 */
const layoutWeeklyByDay = computed<Record<string, EventLayoutImported>>(() => {
  const out: Record<string, EventLayoutImported> = {}
  for (const day of daysForView.value) {
    const key = dateKey(day)
    const list = filterItems(itemsFor(day))
    out[key] = layoutForDeviceEvents(list.map((i) => ({
      id: i.id,
      start: i.start,
      end: i.end
    })))
  }
  return out
})

const itemsByDevice = computed<Map<string, ResItem[]>>(() => {
  const map = new Map<string, ResItem[]>()
  const list = filterItems(itemsFor(currentDay.value))
  for (const i of list) {
    const arr = map.get(i.deviceId)
    if (arr) arr.push(i)
    else map.set(i.deviceId, [i])
  }
  // Seřadit v každém zařízení podle času
  for (const [key, arr] of map.entries()) {
    arr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
    map.set(key, arr)
  }
  return map
})

const layoutForDevice = computed<Record<string, EventLayoutImported>>(() => {
  const result: Record<string, EventLayoutImported> = {}
  for (const d of devicesToShow.value) {
    const list = itemsByDevice.value.get(d.id) || []
    result[d.id] = layoutForDeviceEvents(list.map((i) => ({
      id: i.id,
      start: i.start,
      end: i.end
    })))
  }
  return result
})


/* Drag & Drop */
/* Drag & Drop */
const drag = ref<DragState | null>(null)
let movePending = false
let lastMoveEvent: PointerEvent | null = null
let highlightEl: HTMLElement | null = null
const pointerStart = ref({ x: 0, y: 0 })
const movedBeyondThreshold = ref(false)
const suppressClick = ref(false)
let suppressTimer: number | null = null

let snapGhostEl: HTMLElement | null = null // Visual indicator of drop target

// Force inline styles to bypass scoped CSS and ensure correct layer position
function setupGhost(ghost: HTMLElement, rect: DOMRect) {
  ghost.style.position = 'fixed'
  ghost.style.left = rect.left + 'px'
  ghost.style.top = rect.top + 'px'
  ghost.style.width = rect.width + 'px'
  ghost.style.height = rect.height + 'px'
  ghost.style.zIndex = '9999'
  ghost.style.pointerEvents = 'none'
  ghost.style.opacity = '0.9'
  ghost.style.boxShadow = '0 8px 20px rgba(0,0,0,.20)'
  ghost.style.borderRadius = '10px'
  ghost.style.willChange = 'transform, top, left, width, height'
  ghost.style.margin = '0'
  ghost.style.transform = 'none'
  ghost.style.transition = 'none'
}
function setupSnapGhost(ghost: HTMLElement, rect: DOMRect) {
  setupGhost(ghost, rect)
  ghost.style.zIndex = '9998' // Below drag ghost
  ghost.style.opacity = '0.4' // More transparent
  ghost.style.boxShadow = 'none' // Flat
  ghost.style.border = '2px dashed #888' // Dashed border for placeholder effect
  ghost.classList.add('snap-ghost')
}

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

  // Create Drag Ghost (follows mouse)
  const ghost = target.cloneNode(true) as HTMLElement
  ghost.classList.add('drag-ghost')
  setupGhost(ghost, rect)
  // Ensure we copy background color from inline style if present
  if (target.style.background) ghost.style.background = target.style.background
  if (target.style.backgroundColor) ghost.style.backgroundColor = target.style.backgroundColor
  document.body.appendChild(ghost)

  // Create Snap Ghost (drop placeholder) - initially hidden
  const snap = target.cloneNode(true) as HTMLElement
  snap.classList.add('snap-ghost')
  setupSnapGhost(snap, rect)
  if (target.style.background) snap.style.background = target.style.background
  if (target.style.backgroundColor) snap.style.backgroundColor = target.style.backgroundColor
  snap.style.display = 'none' // Hide until moved
  document.body.appendChild(snap)
  snapGhostEl = snap

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
    ghostEl: ghost, // The one following mouse
    mode: 'move',
    origStart: start,
    origEnd: end,
    origHeight: rect.height,
    copyMode: false
  }

  try { target.setPointerCapture(e.pointerId) } catch {}
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { once: true })
  window.addEventListener('pointercancel', onPointerUp, { once: true })
}
function onResizePointerDown(e: PointerEvent, item: ResItem) {
  if (e.button !== 0) return
  e.stopPropagation()
  const handleEl = e.currentTarget as HTMLElement | null
  const eventEl = handleEl?.closest('.event') as HTMLElement | null
  if (!eventEl) return
  const rect = eventEl.getBoundingClientRect()
  const start = new Date(item.start)
  const end = new Date(item.end)
  pointerStart.value = { x: e.clientX, y: e.clientY }
  movedBeyondThreshold.value = false

  // Drag Ghost
  const ghost = eventEl.cloneNode(true) as HTMLElement
  ghost.classList.add('drag-ghost', 'resize-ghost')
  setupGhost(ghost, rect)
  if (eventEl.style.background) ghost.style.background = eventEl.style.background
  if (eventEl.style.backgroundColor) ghost.style.backgroundColor = eventEl.style.backgroundColor
  document.body.appendChild(ghost)

  // Snap Ghost for resize? Maybe useful to see snap grid.
  const snap = eventEl.cloneNode(true) as HTMLElement
  snap.classList.add('snap-ghost')
  setupSnapGhost(snap, rect)
  if (eventEl.style.background) snap.style.background = eventEl.style.background
  if (eventEl.style.backgroundColor) snap.style.backgroundColor = eventEl.style.backgroundColor
  snap.style.display = 'none'
  document.body.appendChild(snap)
  snapGhostEl = snap

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
    mode: 'resize', // resize mode
    origStart: start,
    origEnd: end,
    origHeight: rect.height
  }
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { once: true })
  window.addEventListener('pointercancel', onPointerUp, { once: true })
}
function onPointerMove(e: PointerEvent) {
  if (!drag.value) return
  if (movePending) { lastMoveEvent = e; return }
  movePending = true

  requestAnimationFrame(() => {
    movePending = false
    const d = drag.value
    if (!d) return
    const dx = Math.abs(e.clientX - pointerStart.value.x)
    const dy = Math.abs(e.clientY - pointerStart.value.y)

    // Optimization: Only update ref if value actually changes
    if ((dx > DRAG_CLICK_THRESHOLD || dy > DRAG_CLICK_THRESHOLD) && !movedBeyondThreshold.value) {
        movedBeyondThreshold.value = true
    }

    if (d.mode === 'resize') {
       const deltaY = e.clientY - pointerStart.value.y
       const newHeight = Math.max(MIN_EVENT_PX, d.origHeight + deltaY)
       d.ghostEl.style.height = newHeight + 'px'

       // Calculate new end time for resize
       const deltaMinutes = Math.round(deltaY / PX_PER_MIN.value / GRID_MINUTES) * GRID_MINUTES
       const newDurationMin = Math.max(GRID_MINUTES, d.durationMin + deltaMinutes)
       const newEndMinutes = Math.min(HOURS_END * 60, (d.origStart.getHours() * 60 + d.origStart.getMinutes()) + newDurationMin)
       const newEndH = Math.floor(newEndMinutes / 60)
       const newEndM = newEndMinutes % 60
       const timeStr = `${pad2(d.origStart.getHours())}:${pad2(d.origStart.getMinutes())} – ${pad2(newEndH)}:${pad2(newEndM)}`

       // Update time display on ghost
       const timeEl = d.ghostEl.querySelector('.event-time')
       if (timeEl) timeEl.textContent = timeStr

       // Update snap ghost height for resize
       if (snapGhostEl) {
          snapGhostEl.style.height = (newDurationMin * PX_PER_MIN.value) + 'px'
          snapGhostEl.style.display = 'block'
          const snapTimeEl = snapGhostEl.querySelector('.event-time')
          if (snapTimeEl) snapTimeEl.textContent = timeStr
       }
       return
    }

    // Move mode logic
    const newLeft = e.clientX - d.offsetX
    const newTop = e.clientY - d.offsetY

    // Copy mode logic
    const wantCopy = e.ctrlKey || e.altKey
    if (d.copyMode !== wantCopy) {
        d.copyMode = wantCopy
        if (wantCopy) {
             d.ghostEl.classList.add('copy-cursor')
             const badge = document.createElement('div'); badge.className = 'copy-badge'; badge.textContent = '+'
             Object.assign(badge.style, { position: 'absolute', right: '-10px', top: '-10px', background: 'green', color: 'white', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '14px', zIndex: '10000' })
             d.ghostEl.appendChild(badge)
        } else {
             d.ghostEl.classList.remove('copy-cursor')
             d.ghostEl.querySelector('.copy-badge')?.remove()
        }
    }

    // Direct transform update
    d.ghostEl.style.transform = `translate(${newLeft - d.originLeft}px, ${newTop - d.originTop}px)`

    // Look for drop target
    const hit = findTrackAt(e.clientX, e.clientY)
    if (hit) {
        attachHighlight(hit.el)
        // Calculate snap position and new time
        const startMinutes = minutesFromTrackY(e.clientY, hit.rect, d.offsetY)
        const snapTop = hit.rect.top + (startMinutes - HOURS_START * 60) * PX_PER_MIN.value
        const endMinutes = Math.min(HOURS_END * 60, startMinutes + d.durationMin)

        // Format time string
        const startH = Math.floor(startMinutes / 60)
        const startM = startMinutes % 60
        const endH = Math.floor(endMinutes / 60)
        const endM = endMinutes % 60
        const timeStr = `${pad2(startH)}:${pad2(startM)} – ${pad2(endH)}:${pad2(endM)}`

        // Update time on drag ghost
        const ghostTimeEl = d.ghostEl.querySelector('.event-time')
        if (ghostTimeEl) ghostTimeEl.textContent = timeStr

        // Position SNAP GHOST
        if (snapGhostEl) {
             snapGhostEl.style.display = 'block'
             snapGhostEl.style.left = hit.rect.left + 'px'
             snapGhostEl.style.width = hit.rect.width + 'px'
             snapGhostEl.style.top = snapTop + 'px'
             // Update time on snap ghost too
             const snapTimeEl = snapGhostEl.querySelector('.event-time')
             if (snapTimeEl) snapTimeEl.textContent = timeStr
        }
    } else {
        clearHighlight()
        if (snapGhostEl) snapGhostEl.style.display = 'none'
    }
  })
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

function getScrollPos() {
  const el = viewportDaily.value || viewportWeek.value
  return el ? el.scrollTop : null
}
function restoreScrollPos(pos: number | null) {
  if (pos === null) return
  const el = viewportDaily.value || viewportWeek.value
  if (el) el.scrollTop = pos
}

async function commitMove(d: DragState, x: number, y: number): Promise<void> {
  const sourceArr = eventsByDay.value[d.origDayKey] || []
  const idx = sourceArr.findIndex((r: ResItem) => r.id === d.id)
  if (idx === -1) return

  const item = sourceArr[idx]

  // Handle resize mode
  if (d.mode === 'resize') {
    const deltaY = y - pointerStart.value.y
    const deltaMinutes = Math.round(deltaY / PX_PER_MIN.value / GRID_MINUTES) * GRID_MINUTES
    const newDurationMin = Math.max(GRID_MINUTES, d.durationMin + deltaMinutes)
    const startDate = d.origStart
    const [Y, M, D] = d.origDayKey.split('-').map((v: string) => Number(v))
    const baseDay = new Date(Y, (M || 1) - 1, D || 1, 0, 0, 0, 0)
    const endMinutes = Math.min(HOURS_END * 60, (startDate.getHours() * 60 + startDate.getMinutes()) + newDurationMin)
    const endDate = new Date(baseDay)
    endDate.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0)
    if (endDate.getTime() <= startDate.getTime()) return
    if (wouldConflict(d.id, d.origDeviceId, startDate, endDate, d.origDayKey)) {
        const req = { start: startDate, end: endDate }
        pendingForcePayload.value = {
           action: 'update_single',
           id: d.id,
           scope: 'single',
           payload: {
               startTime: req.start.getTime(),
               endTime: req.end.getTime(),
               deviceCode: d.origDeviceId
           },
           dragData: {
             actionType: 'resize',
             id: d.id,
             item,
             start: startDate,
             end: endDate,
             deviceId: d.origDeviceId,
             origDayKey: d.origDayKey,
             origDeviceId: d.origDeviceId
           }
        } as any
        openConflictDialog(d.origDeviceId, req, { reservationId: d.id, dayKey: d.origDayKey })
        return
    }

    // CHECK SERIES (RESIZE)
    if (item.seriesId) {
        pendingSaveForSeries.value = {
            actionType: 'resize',
            id: d.id,
            item,
            start: startDate, // same as orig
            end: endDate,
            deviceId: d.origDeviceId,
            origDayKey: d.origDayKey,
            origEnd: d.origEnd
        }
        seriesScopeMode.value = 'edit'
        seriesScopeOpen.value = true
        return
    }

    // OPTIMISTIC UPDATE: Update local state immediately
    item.end = toIsoLocal(endDate)

    // Check for Series (RESIZE) - before calling single update
    if (item.seriesId) {
       pendingSaveForSeries.value = {
          actionType: 'resize',
          id: d.id,
          // Use 'item' from closure (which is the reactive object in eventsByDay)
          item: item,
          start: startDate,
          end: endDate,
          deviceId: d.origDeviceId,
          origDayKey: d.origDayKey,
          origDeviceId: d.origDeviceId
       }
       seriesScopeMode.value = 'edit'
       seriesScopeOpen.value = true
       return
    }

    try {
      await reservations.updateReservation(d.id, {
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        deviceCode: d.origDeviceId
      })
      // Success - local state already updated, no reload needed
      if (isDailyList.value && dailyListRef.value?.updateReservation) {
        dailyListRef.value.updateReservation(d.id, { startTime: startDate.getTime(), endTime: endDate.getTime() })
      }
    } catch (err) {
      // Rollback on error
      item.end = toIsoLocal(d.origEnd)
      console.error('Reservation resize failed.', err)
    }
    return
  }


  // Move mode ...
  const hit = findTrackAt(x, y)
  if (!hit) return
  const { type, id, rect } = hit
  let newDayKey = d.origDayKey
  let newDeviceId = d.origDeviceId
  if (d.view === 'daily-machines' && type === 'device') newDeviceId = id
  else if ((d.view === 'week-work' || d.view === 'week-all') && type === 'day') newDayKey = id
  else return
  const [Y, M, D] = newDayKey.split('-').map((v: string) => Number(v))
  const baseDay = new Date(Y, (M || 1) - 1, D || 1, 0, 0, 0, 0)
  const startMinutes = minutesFromTrackY(y, rect, d.offsetY)
  const endMinutesTarget = Math.min(HOURS_END * 60, startMinutes + d.durationMin)
  const effStart = Math.max(HOURS_START * 60, endMinutesTarget - d.durationMin)
  const startDate = new Date(baseDay.getTime()); startDate.setHours(Math.floor(effStart / 60), effStart % 60, 0, 0)
  const endDate = new Date(startDate.getTime() + d.durationMin * 60000)

  if (d.copyMode === true) {
      if (wouldConflict(-1, newDeviceId, startDate, endDate, newDayKey)) {
           const req = { start: startDate, end: endDate }
           conflictDeviceName.value = deviceNameById(newDeviceId)
           conflictRequested.value = req
           const dayBase = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0)
           const gaps = buildDayGaps(getEventsForDayDevice(dayBase, newDeviceId), dayBase)
           const props = proposeSlotsAround(req, gaps)
           conflictProposals.value = props.map((s, idx) => ({ slot: s, label: idx === 0 ? 'Nejbližší po' : 'Nejbližší před' }))
           conflictFallbackNext.value = firstGapNextDays(getEventsForDayDevice, dayBase, newDeviceId, endDate.getTime() - startDate.getTime(), 30)
           const conflictList = getEventsForDayDevice(dayBase, newDeviceId)
             .filter(e => {
               const eStart = new Date(e.start).getTime()
               const eEnd = new Date(e.end).getTime()
               return eStart < endDate.getTime() && eEnd > startDate.getTime()
             })
             .map(e => ({
               id: e.id,
               title: e.title,
               start: new Date(e.start),
               end: new Date(e.end),
               username: e.username
             }))
           conflictItems.value = conflictList
           conflictCtx.value = null
           conflictOpen.value = true
           pendingForcePayload.value = {
               action: 'create',
               payload: {
                   title: sourceArr[idx].title + ' (kopie)',
                   deviceCode: newDeviceId,
                   startTime: startDate.getTime(),
                   endTime: endDate.getTime(),
                   projectId,
                   username: sourceArr[idx].username ?? auth.getUserInfo()?.preferredUsername ?? '',
                   note: sourceArr[idx].note,
                   recurrence: null
               }
           }
           return
      }
      try {
          const created = await reservations.createReservation({
              title: sourceArr[idx].title,
              deviceCode: newDeviceId,
              startTime: startDate.getTime(),
              endTime: endDate.getTime(),
              projectId,
              username: sourceArr[idx].username ?? auth.getUserInfo()?.preferredUsername ?? '',
              note: sourceArr[idx].note,
              recurrence: null
          })
          // OPTIMISTIC: Add to local state
          const targetArr = ensureDay(baseDay)
          targetArr.push({
            id: created.id,
            title: created.title,
            deviceId: created.deviceCode,
            start: toIsoLocal(startDate),
            end: toIsoLocal(endDate),
            status: 'plan',
            username: created.username ?? null,
            note: created.note ?? null
          })
          targetArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
      } catch (e) { console.error(e) }
      return
  }

  // Move Logic
  if (wouldConflict(d.id, newDeviceId, startDate, endDate, newDayKey)) {
      const req = { start: startDate, end: endDate }
      pendingForcePayload.value = {
          action: 'update_single',
          id: d.id,
          scope: 'single',
          payload: {
              startTime: req.start.getTime(),
              endTime: req.end.getTime(),
              deviceCode: newDeviceId
          },
          dragData: {
            actionType: 'move',
            id: d.id,
            item,
            start: startDate,
            end: endDate,
            deviceId: newDeviceId,
            origDayKey: d.origDayKey,
            origDeviceId: d.origDeviceId
          }
      } as any
      openConflictDialog(newDeviceId, req, { reservationId: d.id, dayKey: d.origDayKey })
      return
  }

  // CHECK SERIES (MOVE)
  if (item.seriesId) {
     pendingSaveForSeries.value = {
        actionType: 'move',
        id: d.id,
        item,
        start: startDate,
        end: endDate,
        deviceId: newDeviceId,
        origDayKey: d.origDayKey,
        origDeviceId: d.origDeviceId
     }
     seriesScopeMode.value = 'edit'
     seriesScopeOpen.value = true
     return
  }

  // OPTIMISTIC UPDATE: Move in local state immediately
  // 1) Remove from source day
  sourceArr.splice(idx, 1)
  // 2) Add to target day
  const targetArr = ensureDay(baseDay)
  const movedItem: ResItem = {
    ...item,
    deviceId: newDeviceId,
    start: toIsoLocal(startDate),
    end: toIsoLocal(endDate)
  }
  targetArr.push(movedItem)
  targetArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))

  try {
     await reservations.updateReservation(d.id, {
         startTime: startDate.getTime(),
         endTime: endDate.getTime(),
         deviceCode: newDeviceId
     })
     // Success - local state already updated
  } catch (err) {
     // Rollback on error: remove from target, add back to source
     const tIdx = targetArr.findIndex(r => r.id === d.id)
     if (tIdx !== -1) targetArr.splice(tIdx, 1)
     sourceArr.push(item)
     sourceArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
     console.error('Move failed, rolled back.', err)
  }
}

function onPointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)

  if (!drag.value) {
    // Cleanup any orphaned ghost elements just in case
    document.querySelectorAll('.drag-ghost').forEach(el => el.remove())
    document.querySelectorAll('.snap-ghost').forEach(el => el.remove())
    snapGhostEl = null
    return
  }

  if (movedBeyondThreshold.value) {
    suppressClick.value = true
    if (suppressTimer) window.clearTimeout(suppressTimer)
    suppressTimer = window.setTimeout(() => { suppressClick.value = false }, 200)
  }

  // Save references before potentially async operations
  const ghostEl = drag.value.ghostEl
  const pointerId = drag.value.pointerId

  drag.value.copyMode = e.ctrlKey === true

  if (movedBeyondThreshold.value) {
    commitMove(drag.value, e.clientX, e.clientY)
  }
  clearHighlight()

  try { (e.target as HTMLElement)?.releasePointerCapture?.(pointerId) } catch {}

  // Always remove ghost element
  if (ghostEl && ghostEl.parentNode) {
    ghostEl.remove()
  }
  if (snapGhostEl && snapGhostEl.parentNode) {
    snapGhostEl.remove()
  }
  snapGhostEl = null

  // Also clean up any orphaned ghost elements (backup cleanup)
  document.querySelectorAll('.drag-ghost').forEach(el => el.remove())
  document.querySelectorAll('.snap-ghost').forEach(el => el.remove())

  drag.value = null
}
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  // Clean up any ghost elements on unmount
  document.querySelectorAll('.drag-ghost').forEach(el => el.remove())
})
function onEventClick(id: number, _e: MouseEvent) {
  if (suppressClick.value || movedBeyondThreshold.value || drag.value) return
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
    // Immediately remove from daily list if active
    if (isDailyList.value && dailyListRef.value?.removeReservation) {
      dailyListRef.value.removeReservation(i.id)
    }
  } catch (e) {
    console.error('Delete failed', e)
  }
}
const confirmDeleteOpen = ref(false)
const deleteTarget = ref<ResItem | null>(null)
const deleteLoading = ref(false)
const deleteMode = ref<'single' | 'following' | 'series'>('single')

// Check if deleteTarget is the first event in its series
const isFirstInSeries = computed<boolean>(() => {
  if (!deleteTarget.value?.seriesId) return false
  // Find all events with same seriesId
  const seriesEvents: ResItem[] = []
  for (const events of Object.values(eventsByDay.value)) {
    for (const ev of events) {
      if (ev.seriesId === deleteTarget.value.seriesId) {
        seriesEvents.push(ev)
      }
    }
  }
  if (seriesEvents.length === 0) return true
  // Sort by start time
  seriesEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  // Check if this is the first one
  return seriesEvents[0]?.id === deleteTarget.value.id
})

function askDelete(i: ResItem) {
  deleteTarget.value = i
  if (i.seriesId) {
    seriesScopeMode.value = 'delete'
    seriesScopeOpen.value = true
  } else {
    deleteMode.value = 'single'
    confirmDeleteOpen.value = true
  }
}

async function handleDeleteSeries(seriesId: string) {
  try {
    await reservations.deleteSeriesReservations(seriesId)
    await loadWeekFor(currentDay.value)
    // Full reload for series delete (multiple items affected)
    if (isDailyList.value && dailyListRef.value?.loadAll) {
      await dailyListRef.value.loadAll()
    }
  } catch (e) {
    console.error('Delete series failed', e)
  }
}
async function handleDeleteFollowing(target: ResItem) {
  if (!target.seriesId) return
  try {
    // Delete this event and all following events in the series
    const targetStart = new Date(target.start).getTime()
    await reservations.deleteSeriesFromDate(target.seriesId, targetStart)
    await loadWeekFor(currentDay.value)
    // Full reload for series delete (multiple items affected)
    if (isDailyList.value && dailyListRef.value?.loadAll) {
      await dailyListRef.value.loadAll()
    }
  } catch (e) {
    console.error('Delete following failed', e)
  }
}

async function confirmDelete() {
  if (!deleteTarget.value) { confirmDeleteOpen.value = false; return }
  deleteLoading.value = true
  try {
    if (deleteMode.value === 'series' && deleteTarget.value.seriesId) {
      await handleDeleteSeries(deleteTarget.value.seriesId)
    } else if (deleteMode.value === 'following' && deleteTarget.value.seriesId) {
      await handleDeleteFollowing(deleteTarget.value)
    } else {
      await handleDelete(deleteTarget.value)
    }
    deleteTarget.value = null
    confirmDeleteOpen.value = false
  } finally {
    deleteLoading.value = false
    deleteMode.value = 'single'
  }
}
function cancelDelete() {
  confirmDeleteOpen.value = false
  deleteTarget.value = null
  deleteMode.value = 'single'
}
const defaultDurationMinutes = ref(60)
onMounted(() => {
  const saved = localStorage.getItem('lims:defaultDuration')
  if (saved) defaultDurationMinutes.value = Number(saved)
})
function setDefaultDuration(m: number) {
  defaultDurationMinutes.value = m
  localStorage.setItem('lims:defaultDuration', String(m))
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
  const end = new Date(start.getTime() + defaultDurationMinutes.value * 60000)
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
  recurrence: RecurrenceRequest | null
  seriesId?: string | null
  seriesIndex?: number
  isException?: boolean
}
const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editorSaving = ref(false)
const resForm = ref<ReservationEditorForm | null>(null)
function openCreateWith(opts: { baseDay: Date; start: Date; end: Date; deviceCode: string }) {
  const me = auth.getUserInfo().preferredUsername
  resForm.value = {
    title: '',
    deviceCode: opts.deviceCode,
    dateYmd: toYmdLocal(opts.baseDay),
    startHM: hmFromDate(opts.start),
    endHM: hmFromDate(opts.end),
    username: me,
    note: '',
    recurrence: null
  }
  editorMode.value = 'create'
  editorOpen.value = true
}
function openEdit(i: ResItem) {
  const s = new Date(i.start)
  const e = new Date(i.end)
  // Explicitly create primitive values to ensure reactivity works
  const formData: ReservationEditorForm = {
    id: i.id,
    title: String(i.title ?? ''),
    deviceCode: String(i.deviceId ?? ''),
    dateYmd: toYmdLocal(new Date(s.getFullYear(), s.getMonth(), s.getDate())),
    startHM: hmFromDate(s),
    endHM: hmFromDate(e),
    username: i.username ? String(i.username) : '',
    note: i.note ? String(i.note) : '',
    recurrence: null,
    seriesId: i.seriesId ?? null
  }
  resForm.value = formData
  editorMode.value = 'edit'
  editorOpen.value = true

  // Fetch recurrence rule if series
  if (i.seriesId) {
     reservations.fetchSeriesRecurrence(i.seriesId).then(rec => {
        if (rec && resForm.value && resForm.value.id === i.id) {
           resForm.value.recurrence = rec
        }
     })
  }
}
// Removed: watch(() => resForm.value?.dateYmd) - date should only sync after save, not during editing
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
/* Editor SAVE */
const seriesScopeOpen = ref(false)
const seriesScopeMode = ref<'edit' | 'delete'>('edit')
const pendingSaveForSeries = ref<any>(null)

async function saveReservation() {
  if (!resForm.value || !isEditorValid.value) return
  const f = resForm.value
  const day = fromYmdLocal(f.dateYmd)
  const start = setHM(day, f.startHM)
  const end = setHM(day, f.endHM)

  // Use same clamp logic as before?
  // Let's rely on doSaveReservation to handle API call details or pass prepared data

  // Check if series
  if (f.seriesId && editorMode.value === 'edit') {
    pendingSaveForSeries.value = { f, start, end }
    seriesScopeMode.value = 'edit'
    seriesScopeOpen.value = true
    return
  }

  await doSaveReservation(f, start, end)
}

async function doSaveReservation(f: any, start: Date, end: Date, scope: 'single' | 'following' | 'series' = 'single') {
  console.log('doSaveReservation called', { f, start, end, scope })
  editorSaving.value = true
  // Re-apply clamp logic if needed
  let s = start
  let e = end
  if (e <= s) e = new Date(s.getTime() + 30 * 60000)
  const day = fromYmdLocal(f.dateYmd)
  const clampStart = new Date(day); clampStart.setHours(HOURS_START, 0, 0, 0)
  const clampEnd = new Date(day); clampEnd.setHours(HOURS_END, 0, 0, 0)
  if (s < clampStart) s = clampStart
  if (e > clampEnd) e = clampEnd

  try {
    const payload = {
      title: f.title?.trim() || 'Rezervace',
      deviceCode: f.deviceCode,
      startTime: s.getTime(),
      endTime: e.getTime(),
      projectId,
      username: f.username || '',
      note: (f.note ?? '').trim(), // Allow empty string to clear note
      recurrence: f.recurrence
    }

    if (editorMode.value === 'create') {
      const created = await reservations.createReservation(payload)
      await loadWeekFor(day)
      if (created.seriesId && isDailyList.value && dailyListRef.value?.highlightSeries) {
         // Reload list to fetch all series items, then highlight
         await dailyListRef.value.loadListRange()
         dailyListRef.value.highlightSeries(created.seriesId)
      } else if (isDailyList.value && dailyListRef.value?.addReservation) {
        // Single item optimisation
        dailyListRef.value.addReservation({ ...created, id: created.id, seriesId: created.seriesId })
      }
    } else {
      const id = f.id
      if (scope === 'single') {
         // Standard update - MUST pass seriesId to preserve series link if only updating one instance
         await reservations.updateReservation(id, { ...payload, seriesId: f.seriesId } as any)
      } else if (scope === 'series') {
         if (f.seriesId) await reservations.updateSeries(id, payload, 'series')
      } else if (scope === 'following') {
         if (f.seriesId) await reservations.updateSeries(id, payload, 'following')
      }
      // Refresh current view logic
      await loadWeekFor(currentDay.value)
      if (isDailyList.value) {
        await dailyListRef.value?.loadListRange()
      }
    }

    editorOpen.value = false
    resForm.value = null
  } catch (errObj: any) {
    console.log('DEBUG: Save failed', errObj)
    const err = errObj as { statusCode?: number; message?: string; response?: any }
    if (err.statusCode === 409 || err.response?.status === 409) {
       // Conflict handling
       const deviceName = deviceNameById(f.deviceCode)
       conflictDeviceName.value = deviceName
       conflictRequested.value = { start: s, end: e }
       const dayBase = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
       const existingEvents = getEventsForDayDevice(dayBase, f.deviceCode)
       const gaps = buildDayGaps(existingEvents, dayBase)
       const proposals = proposeSlotsAround({ start: s, end: e }, gaps)
       conflictProposals.value = proposals.map((slot, idx) => ({
         slot,
         label: idx === 0 ? 'Nejbližší po' : 'Nejbližší před'
       }))
       const durationMs = e.getTime() - s.getTime()
       conflictFallbackNext.value = firstGapNextDays(getEventsForDayDevice, dayBase, f.deviceCode, durationMs, 30)
       conflictItems.value = existingEvents.filter(ev => {
          const evStart = new Date(ev.start).getTime()
          const evEnd = new Date(ev.end).getTime()
          return evEnd > s.getTime() && evStart < e.getTime()
        }).map(ev => ({
          id: ev.id,
          title: ev.title,
          start: new Date(ev.start),
          end: new Date(ev.end),
          username: ev.username
        }))
       // Determine context for potential force action
       let actionType: 'create' | 'update_single' | 'update_series' = 'create'
       if (editorMode.value === 'edit') {
          if (scope === 'single') actionType = 'update_single'
          else actionType = 'update_series'
       }

       pendingForcePayload.value = {
        action: actionType,
        id: f.id,
        scope: scope,
        payload: {
          title: f.title?.trim() || 'Rezervace',
          deviceCode: f.deviceCode,
          startTime: s.getTime(),
          endTime: e.getTime(),
          projectId,
          username: f.username || '',
          note: (f.note ?? '').trim() || null,
          recurrence: f.recurrence
        }
      }
      conflictCtx.value = editorMode.value === 'edit' && f.id
        ? { reservationId: f.id, deviceId: f.deviceCode, dayKey: dateKey(fromYmdLocal(f.dateYmd)) }
        : null
      conflictOpen.value = true
    } else {
      console.error('Save reservation failed', errObj)
    }
  } finally {
    editorSaving.value = false
  }
}

async function onScopeConfirm(scope: 'single' | 'following' | 'series') {
  if (seriesScopeMode.value === 'edit' && pendingSaveForSeries.value) {
    // Check if it is a drag/drop action or form save
    if (pendingSaveForSeries.value.actionType === 'move' || pendingSaveForSeries.value.actionType === 'resize') {
       await executeDragAction(scope, pendingSaveForSeries.value)
    } else {
       // Form save
       const { f, start, end } = pendingSaveForSeries.value
       await doSaveReservation(f, start, end, scope)
    }
    pendingSaveForSeries.value = null
  } else if (seriesScopeMode.value === 'delete' && deleteTarget.value) {
    deleteMode.value = scope
    await confirmDelete()
  }
}

function onScopeCancel() {
  seriesScopeOpen.value = false
  pendingSaveForSeries.value = null
  deleteTarget.value = null
}

async function executeDragAction(scope: 'single' | 'following' | 'series', p: any) {
  const { id, start, end, deviceId, item, origDayKey, origDeviceId, origStart, origEnd } = p

  /* Drag & Drop action execution */
  const payload = {
     startTime: p.start.getTime(),
     endTime: p.end.getTime(),
     deviceCode: p.deviceId,
     force: p.force
  }

  // Optimistic update helper (reuse logic if needed)
  const doOptimistic = () => {
     // ... same as before
     const sourceArr = eventsByDay.value[origDayKey] || []
     const idx = sourceArr.findIndex((r: any) => r.id === id)
     if (idx !== -1) sourceArr.splice(idx, 1)

     const targetArr = ensureDay(start)
     const newItem = {
        ...item,
        deviceId: deviceId,
        start: toIsoLocal(start),
        end: toIsoLocal(end)
     }
     targetArr.push(newItem)
     targetArr.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  }

  if (scope === 'single') {
     doOptimistic()
  }

  try {

     if (scope === 'single') {
        await reservations.updateReservation(id, { ...payload, seriesId: item.seriesId } as any)
     } else if (scope === 'series') {
        if (item.seriesId) await reservations.updateSeries(id, payload, 'series')
     } else if (scope === 'following') {
        if (item.seriesId) await reservations.updateSeries(id, payload, 'following')
     }

     // Refresh view
     if (scope !== 'single') {
        await loadWeekFor(currentDay.value)
        if (isDailyList.value && dailyListRef.value?.loadAll) {
           await dailyListRef.value.loadAll()
        }
     }

     if (isDailyList.value && dailyListRef.value?.updateReservation) {
        dailyListRef.value.updateReservation(id, { startTime: payload.startTime, endTime: payload.endTime })
     }

  } catch(e: any) {
     if (e.statusCode === 409) {
         // Logic to open Conflict Dialog
         const deviceName = deviceNameById(payload.deviceCode)
         conflictDeviceName.value = deviceName

         const s = new Date(payload.startTime)
         const eTime = new Date(payload.endTime)
         conflictRequested.value = { start: s, end: eTime }

         const dayBase = new Date(s)
         dayBase.setHours(0,0,0,0)
         const existingEvents = getEventsForDayDevice(dayBase, payload.deviceCode)
         const gaps = buildDayGaps(existingEvents, dayBase)
         const proposals = proposeSlotsAround({ start: s, end: eTime }, gaps)

         conflictProposals.value = proposals.map((slot, idx) => ({
             slot,
             label: idx === 0 ? 'Nejbližší po' : 'Nejbližší před'
         }))

         const durationMs = eTime.getTime() - s.getTime()
         conflictFallbackNext.value = firstGapNextDays(getEventsForDayDevice, dayBase, payload.deviceCode, durationMs, 30)

         conflictItems.value = existingEvents.filter(ev => {
             const evStart = new Date(ev.start).getTime()
             const evEnd = new Date(ev.end).getTime()
             return evEnd > s.getTime() && evStart < eTime.getTime()
         }).map(ev => ({
             id: ev.id,
             title: ev.title,
             start: new Date(ev.start),
             end: new Date(ev.end),
             username: ev.username
         }))

         conflictCtx.value = { reservationId: id, deviceId: payload.deviceCode, dayKey: dateKey(dayBase) }

         let actionType: 'create' | 'update_single' | 'update_series' = 'update_single'
         if (scope === 'series' || scope === 'following') actionType = 'update_series'

         pendingForcePayload.value = {
             action: actionType,
             id: id,
             scope: scope,
             payload: {
               title: item.title,
               deviceCode: payload.deviceCode,
               startTime: payload.startTime,
               endTime: payload.endTime,
               projectId,
               username: item.username || '',
               note: item.note || '',
               recurrence: null
             }
         }

         conflictOpen.value = true
         return
     }

     console.error('Drag series action failed', e)
     // Rollback logic
     await loadWeekFor(currentDay.value)
  }
}

// Force-create handler: creates reservation despite conflicts
async function onForceCreate() {
  console.log('DEBUG: onForceCreate called', pendingForcePayload.value)
  if (!pendingForcePayload.value) {
    console.warn('DEBUG: No pending payload')
    return
  }

  // Check for series transition from Drag & Drop
  const dd = (pendingForcePayload.value as any).dragData
  if (dd && dd.item && dd.item.seriesId) {
     console.log('DEBUG: Transitioning to Series Scope for Force', dd)
     conflictOpen.value = false
     pendingSaveForSeries.value = {
        ...dd,
        force: true // Pass force flag
     }
     seriesScopeMode.value = 'edit'
     seriesScopeOpen.value = true
     pendingForcePayload.value = null
     return
  }

  const { action, payload, id, scope } = pendingForcePayload.value

  // Add force flag
  const forcePayload = { ...payload, force: true }
  console.log('DEBUG: Sending force payload', forcePayload)

  try {
    if (action === 'create') {
        const created = await reservations.createReservation(forcePayload)
        console.log('DEBUG: Force create success', created)
        // Immediately add to daily list if active (optimistic-ish)
        if (isDailyList.value && dailyListRef.value?.addReservation) {
            dailyListRef.value.addReservation({ ...created, id: created.id })
        }
    } else if (action === 'update_single' && id) {
        await reservations.updateReservation(id, forcePayload)
    } else if (action === 'update_series' && id && scope && scope !== 'single') {
        await reservations.updateSeries(id, forcePayload, scope)
    }

    // Close dialogs
    conflictOpen.value = false
    editorOpen.value = false
    pendingForcePayload.value = null
    resForm.value = null

    // Reload week to show changes
    await loadWeekFor(currentDay.value)
    if (isDailyList.value) await dailyListRef.value?.loadListRange()

  } catch (e: any) {
    console.error('Force-create failed', e)
    const msg = e?.response?.data?.message || e?.message || 'Neznámá chyba'
    alert(`Vytvoření s kolizí selhalo: ${msg}\n(Status: ${e?.statusCode || e?.response?.status})`)
  }
}
// Confirm/Use a Conflict Proposal
async function handleConfirmConflict(slot: { start: Date; end: Date }) {
  // CASE 1: Drag & Drop scenario - resForm is null, use conflictCtx
  if (!resForm.value && conflictCtx.value) {
    onConfirmConflict(slot)
    return
  }

  // CASE 2: Editor dialog scenario - resForm exists
  if (!resForm.value) {
    return
  }

  // Update form with the new slot
  resForm.value.dateYmd = toYmdLocal(slot.start)
  resForm.value.startHM = hmFromDate(slot.start)
  resForm.value.endHM = hmFromDate(slot.end)

  // Close conflict dialog
  conflictOpen.value = false

  // Actually save the reservation with the new time
  await nextTick()
  await saveReservation()
}

function handleSuggestNextDay() {
  if (conflictFallbackNext.value) {
    handleConfirmConflict(conflictFallbackNext.value.slot)
  }
}



function onWeekDayDblClick(day: Date) {
  selectedDate.value = toYmdLocal(day)
  viewMode.value = 'daily-machines'
}

function openCreateFromToolbar() {
  const day = normalizeToDate(selectedDate.value)
  const start = new Date(day); start.setHours(9, 0, 0, 0)
  const end = new Date(start.getTime() + defaultDurationMinutes.value * 60000)
  const deviceCode = devicesToShow.value[0]?.id || allDevices.value[0]?.id || 'M1'
  openCreateWith({ baseDay: day, start, end, deviceCode })
}
const confirmPrimaryBtn = ref<HTMLButtonElement | null>(null)
watch(confirmDeleteOpen, v => {
  if (v) nextTick(() => confirmPrimaryBtn.value?.focus())
})
/* Global hotkeys */
function onHotkeys(e: KeyboardEvent) {
  // Quick new
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openCreateFromToolbar(); return }
  // Datum navigace mimo editor (skip if in daily-list - handled by DailyListView emit)
  if (!editorOpen.value && viewMode.value !== 'daily-list' && e.key === 'ArrowLeft') { e.preventDefault(); addDays(-1); return }
  if (!editorOpen.value && viewMode.value !== 'daily-list' && e.key === 'ArrowRight') { e.preventDefault(); addDays(1); return }
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
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
})
</script>
<template>
  <v-container
    fluid
    class="pa-0"
  >
    <!-- Top Toolbar -->
    <div class="top-toolbar">
      <!-- Primary Action -->
      <button
        class="btn-primary"
        @click="openCreateFromToolbar"
      >
        <i class="mdi mdi-plus" />
        Vytvořit rezervaci
      </button>

      <!-- Duration Selector -->
      <v-menu
        location="bottom center"
        offset="4"
      >
        <template #activator="{ props }">
          <button
            class="weekends-toggle"
            v-bind="props"
            style="margin-right: auto; gap: 8px;"
          >
            <i
              class="mdi mdi-clock-time-four-outline"
              style="font-size: 18px;"
            />
            <span>{{ defaultDurationMinutes }} min</span>
            <i
              class="mdi mdi-chevron-down"
              style="font-size: 14px; opacity: 0.7;"
            />
          </button>
        </template>
        <v-list
          density="compact"
          rounded="lg"
          elevation="3"
          class="pa-1"
        >
          <v-list-subheader style="height: 20px; min-height: 0; font-size: 11px;">
            VÝCHOZÍ DÉLKA
          </v-list-subheader>
          <v-list-item
            v-for="m in [15, 30, 45, 60, 90, 120, 240, 480]"
            :key="m"
            :value="m"
            :active="defaultDurationMinutes === m"
            color="primary"
            rounded
            style="min-height: 36px;"
            @click="setDefaultDuration(m)"
          >
            <template #prepend>
              <v-icon
                size="16"
                :icon="defaultDurationMinutes === m ? 'mdi-check' : 'mdi-circle-small'"
              />
            </template>
            <v-list-item-title style="font-size: 13px;">
              {{ m < 60 ? m + ' min' : (m/60) + ' hod' }}
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <!-- View Selector -->
      <div class="view-selector">
        <button
          :class="['view-option', { active: viewMode === 'daily-machines' }]"
          @click="viewMode = 'daily-machines'"
        >
          Denní – Stroje
        </button>
        <button
          :class="['view-option', { active: viewMode === 'week-work' || viewMode === 'week-all' }]"
          @click="viewMode = viewMode === 'week-work' ? 'week-work' : 'week-all'"
        >
          Týdenní
        </button>
        <button
          :class="['view-option', { active: viewMode === 'daily-list' }]"
          @click="viewMode = 'daily-list'"
        >
          Seznam
        </button>
      </div>
    </div>
    <v-container
      fluid
      class="pa-4"
    >
      <v-row class="flex-nowrap">
        <!-- Sidebar Calendar -->
        <v-col
          v-if="['daily-machines', 'week-work', 'week-all', 'daily-list'].includes(viewMode)"
          cols="auto"
        >
          <div style="width: 320px;">
            <DateFilterPanel
              :model-value="dateFilterModel"
              :hide-presets="viewMode === 'daily-machines'"
              :hide-field-toggle="true"
              :show-date-label="viewMode === 'daily-machines'"
              :show-range-presets="viewMode === 'daily-list'"
              :view-mode="viewMode"
              :header-label="viewMode === 'daily-list' ? 'Všechny rezervace' : undefined"
              :header-icon="viewMode === 'daily-list' ? 'mdi-clipboard-list-outline' : undefined"
              :devices="devicesForFilter"
              :members="membersForFilter"
              :picked-devices="pickedDevices"
              :picked-members="pickedMembers"
              :include-weekends="(viewMode === 'daily-list' ? listIncludeWeekends : viewMode === 'week-all')"
              :show-two-weeks="showTwoWeeks"
              @update:model-value="onDateFilterUpdate"
              @update:picked-devices="v => pickedDevices = v"
              @update:picked-members="v => pickedMembers = v"
              @update:include-weekends="v => {
                if (viewMode === 'daily-list') {
                  listIncludeWeekends = v
                } else {
                  viewMode = v ? 'week-all' : 'week-work'
                }
              }"
              @update:show-two-weeks="v => showTwoWeeks = v"
            />
          </div>
        </v-col>

        <!-- MAIN PANEL - full width now -->
        <v-col
          class="flex-grow-1"
          style="min-width: 0; padding: 0px; margin: 16px;"
        >
          <v-card style="border-radius: 16px;">
            <v-card-text class="pa-0">
              <DailyMachinesView
                v-if="viewMode === 'daily-machines'"
                :devices="devicesToShow"
                :cols="colsDevices"
                :day-hours="24"
                :tick-height="tickHeight"
                :viewport-height="VIEWPORT_HEIGHT"
                :full-track-height="FULL_TRACK_HEIGHT"
                :get-items-for-device="(id: string) => itemsForDayDevice(id)"
                :layout-for-device="layoutForDevice"
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
                :on-resize-pointer-down="onResizePointerDown"
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
                :member-usernames="pickedMembers"
                :on-dblclick-row="onDailyListRowDblClick"
                :open-edit="openEditFromDto"
                :ask-delete="askDeleteFromDto"
                :selected-date="selectedDate"
                :filter-from="dateFilterModel.from ? toYmdLocal(dateFilterModel.from) : null"
                :filter-to="dateFilterModel.to ? toYmdLocal(dateFilterModel.to) : null"
                @navigate-date="addDays"
              />
              <!-- Week 1 -->
              <WeekView
                v-else
                :days="daysForView"
                :cols="colsWeek"
                :tick-height="tickHeight"
                :viewport-height="showTwoWeeks ? VIEWPORT_HEIGHT_TWO_WEEKS : VIEWPORT_HEIGHT"
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
                :device-name-of="deviceNameById"
                :is-menu-open="isMenuOpen"
                :set-menu-open="setMenuOpen"
                :on-track-click="onTrackClick"
                :on-event-pointer-down="onEventPointerDown"
                :on-resize-pointer-down="onResizePointerDown"
                :on-event-click="onEventClick"
                :open-edit="openEdit"
                :ask-delete="askDelete"
                :set-viewport-ref="setWeekViewportRef"
                :on-day-dbl-click="onWeekDayDblClick"
              />
              <!-- Separator between weeks -->
              <div
                v-if="showTwoWeeks && !isDailyList && viewMode !== 'daily-machines'"
                style="height: 24px; border-top: 2px solid #e5e7eb; margin: 16px 0; background: linear-gradient(to bottom, #f9fafb 0%, transparent 100%);"
              />
              <!-- Week 2 (when 2 weeks toggle is enabled) -->
              <WeekView
                v-if="showTwoWeeks && !isDailyList && viewMode !== 'daily-machines'"
                :days="daysForWeek2"
                :cols="daysForWeek2.length"
                :tick-height="tickHeight"
                :viewport-height="VIEWPORT_HEIGHT_TWO_WEEKS"
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
                :device-name-of="deviceNameById"
                :is-menu-open="isMenuOpen"
                :set-menu-open="setMenuOpen"
                :on-track-click="onTrackClick"
                :on-event-pointer-down="onEventPointerDown"
                :on-resize-pointer-down="onResizePointerDown"
                :on-event-click="onEventClick"
                :open-edit="openEdit"
                :ask-delete="askDelete"
                :set-viewport-ref="setWeekViewportRef"
                :on-day-dbl-click="onWeekDayDblClick"
              />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
      <ReservationEditorDialog
        v-if="resForm"
        v-model="editorOpen"
        v-model:title="resForm.title"
        v-model:device-code="resForm.deviceCode"
        v-model:username="resForm.username"
        v-model:date-ymd="resForm.dateYmd"
        v-model:start-h-m="resForm.startHM"
        v-model:end-h-m="resForm.endHM"
        v-model:note="resForm.note"
        v-model:recurrence="resForm.recurrence"
        :mode="editorMode"
        :saving="editorSaving"
        :series-id="resForm.seriesId"
        :series-index="resForm.seriesIndex"
        :is-exception="resForm.isException"
        :devices="allDevices"
        :members="membersList"
        @save="saveReservation"
        @delete="() => { if (resForm?.id) askDelete({ id: resForm.id, title: '', deviceId: resForm.deviceCode, start: '', end: '', status: 'plan', username: resForm.username, note: resForm.note ?? null, seriesId: resForm.seriesId }) }"
        @cancel="() => { resForm = null }"
      />

      <!-- SERIES SCOPE DIALOG -->
      <SeriesScopeDialog
        v-model:is-open="seriesScopeOpen"
        :mode="seriesScopeMode"
        :is-first-in-series="seriesScopeMode === 'delete' && isFirstInSeries"
        @confirm="onScopeConfirm"
        @cancel="onScopeCancel"
      />

      <!-- CONFIRM DELETE  pro ty co nejsou serie -->
      <Dialog
        v-model:is-open="confirmDeleteOpen"
        width="420px"
        :hide-footer="true"
      >
        <template #content>
          <div class="pa-4">
            <div class="text-h6 mb-4">
              Opravdu chcete rezervaci zrušit?
            </div>
            <div
              class="d-flex align-center"
              style="gap:14px"
            >
              <v-btn
                color="error"
                variant="flat"
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
                Zrušit
              </v-btn>
            </div>
          </div>
        </template>
      </Dialog>

      <ConflictDialog
        :open="conflictOpen"
        :device-name="conflictDeviceName"
        :requested="conflictRequested"
        :proposals="conflictProposals"
        :fallback-next-day="conflictFallbackNext"
        :conflicts="conflictItems"
        :all-reservations="allReservationsForDevice"
        :exclude-reservation-id="conflictCtx?.reservationId"
        @update:open="v => conflictOpen = v"
        @confirm="handleConfirmConflict"
        @suggest-next-day="handleSuggestNextDay"
        @cancel="() => { conflictOpen = false; pendingForcePayload = null }"
        @force-create="onForceCreate"
      />
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
  inset-inline: 4px;
  box-sizing: border-box;
}
.event:active { cursor: grabbing; }
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

/* ===== NEW TOOLBAR STYLES ===== */
/* btn-primary and top-toolbar are now global in settings.scss */

.view-selector {
  display: flex;
  background: #f1f5f9;
  border-radius: 10px;
  padding: 4px;
  gap: 2px;
}

.view-option {
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.view-option:hover:not(.active) {
  background: #e2e8f0;
  color: #475569;
}

.view-option.active {
  background: white;
  color: #1e40af;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.weekends-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #475569;
  transition: all 0.2s ease;
}

.weekends-toggle:hover {
  background: #f1f5f9;
}

.weekends-toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #3b82f6;
  cursor: pointer;
}

.weekends-toggle span {
  user-select: none;
}

.filters-group {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 14px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-btn:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.filter-btn i {
  font-size: 18px;
  color: #64748b;
}

.filter-btn .label {
  color: #64748b;
  font-weight: 400;
}

.filter-btn .value {
  color: #1e293b;
  font-weight: 600;
}

.filter-btn .arrow {
  color: #94a3b8;
  margin-left: 2px;
}

/* Highlight animation for rescheduled reservations */
:deep(.event-highlighted) {
  animation: highlight-pulse 2s ease-out;
  z-index: 100 !important;
}

@keyframes highlight-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7), 0 0 20px 4px rgba(59, 130, 246, 0.5);
    transform: scale(1.02);
  }
  20% {
    box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.4), 0 0 30px 8px rgba(59, 130, 246, 0.3);
    transform: scale(1.03);
  }
  40% {
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3), 0 0 20px 4px rgba(59, 130, 246, 0.2);
    transform: scale(1.01);
  }
  60% {
    box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.2), 0 0 15px 2px rgba(59, 130, 246, 0.1);
    transform: scale(1.02);
  }
  80% {
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1), 0 0 10px 1px rgba(59, 130, 246, 0.05);
    transform: scale(1.005);
  }
  100% {
    box-shadow: none;
    transform: scale(1);
  }
}
</style>
