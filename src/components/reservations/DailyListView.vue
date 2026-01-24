<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { get, patch, del } from '@/services/api/api-requests'
import ReservationEditorDialog from '@/components/reservations/ReservationEditorDialog.vue'
import ModernSwitch from '@/components/ui/ModernSwitch.vue'

type StatusType = 'plan' | 'running' | 'done'

type ReservationDto = {
  id: number
  title: string
  deviceCode: string
  startTime: number
  endTime: number
  username: string | null
  projectId: number
  note: string | null
  seriesId?: string | null
  createdAt?: number | null
}

type DailyListRow = {
  id: number
  date: string
  time: string
  device: string
  title: string
  user: string
  status: StatusType
  _raw: ReservationDto
}

type Header = { title: string; key: string; width?: number; minWidth?: number; sortable?: boolean }
type DeviceResponse = { id: number; code: string; name: string; color?: string | null }

const props = defineProps<{
  projectId: number
  deviceCodes?: string[] | null
  memberUsernames?: string[] | null
  headers?: Header[]
  autoLoad?: boolean
  onDblClickRow?: (ev: MouseEvent, payload: { item: DailyListRow }) => void
  openEdit?: (raw: ReservationDto) => void
  askDelete?: (raw: ReservationDto) => void
  filterFrom?: string | null
  filterTo?: string | null
}>()

const AUTO_REFRESH_MS = 15000
const FOCUS_REFRESH_DEBOUNCE_MS = 350

const DAILY_LIST_HEADERS: Header[] = [
  { title: 'Stroj', key: 'device', width: 120, sortable: true },
  { title: 'Datum', key: 'date', width: 180, sortable: true },
  { title: 'Čas', key: 'time', width: 160, sortable: false }, // Time is logically tied to date sort usually
  { title: 'Název', key: 'title', minWidth: 220, sortable: true },
  { title: 'Uživatel', key: 'username', width: 140, sortable: true },
  { title: 'Vytvořeno', key: 'createdAt', width: 140, sortable: true },
  { title: 'Stav', key: 'status', width: 110, sortable: true },
]
const headersToUse = computed<Header[]>(() => props.headers?.length ? props.headers : DAILY_LIST_HEADERS)

//const DEFAULT_DAYS = 60
const listFrom = ref<string>(props.filterFrom || '')
const listTo   = ref<string>(props.filterTo || '')
const listSearch = ref<string>('')
const sortBy = ref<string>('createdAt')
const sortDesc = ref<boolean>(true)

// Watch props
watch(() => [props.filterFrom, props.filterTo], ([f, t]) => {
  listFrom.value = f || ''
  listTo.value = t || ''
  resetVisibleCount()
  loadListRange()
})

const listLoading = ref(false)
const listError = ref<string | null>(null)
const listRaw = ref<ReservationDto[]>([])
const devices = ref<DeviceResponse[]>([])
const members = ref<string[]>([])

// Local filters for devices and members
const localFilterDevices = ref<string[]>([])
const localFilterMembers = ref<string[]>([])


// map device code -> color for chip rendering
const deviceColorByCode = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const d of devices.value) {
    const c = (d.color ?? '').trim()
    map.set(d.code, c || '#9E9E9E')
  }
  return map
})

const devicesForDialog = computed(() => {
  return devices.value.map(d => ({
    id: d.code,
    name: d.name,
    color: d.color ?? '#9E9E9E'
  }))
})

const nowMs = ref<number>(Date.now())
let nowTimer: number | null = null
function startNowTicker() { stopNowTicker(); nowTimer = window.setInterval(() => { nowMs.value = Date.now() }, 30_000) }
function stopNowTicker() { if (nowTimer != null) { window.clearInterval(nowTimer); nowTimer = null } }
function getStatus(start: number, end: number, now: number): StatusType {
  if (now < start) return 'plan'
  if (now < end) return 'running'
  return 'done'
}

const fmtDateLongFmt  = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtTimeFmt      = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
const fmtDateLong  = (d: Date) => fmtDateLongFmt.format(d)
const fmtTime      = (d: Date) => fmtTimeFmt.format(d)

const rangeFromMs = computed<number | null>(() => listFrom.value ? startOfDayMs(listFrom.value) : null)
const rangeToMs   = computed<number | null>(() => listTo.value ? endOfDayMs(listTo.value) : null)
//const listRangeDays = computed(() => {
//  if (rangeFromMs.value == null || rangeToMs.value == null) return 0
//  const diff = rangeToMs.value - rangeFromMs.value
//  return diff >= 0 ? (diff / 86400000) + 1 : 0
//})

const includeNotesInSearch = ref(true)
const listFiltered = computed<ReservationDto[]>(() => {
  // Clear selection when filters change (optional, but safer)
  // We can't easily detect filter change here without watch, but this computed re-runs.
  // We'll keep selection across filter for now unless it causes issues, or we can clear it in watchers.
  
  let result = listRaw.value
  
  // Filter by devices (from props or local filter)
  const deviceFilter = localFilterDevices.value.length > 0 
    ? localFilterDevices.value 
    : (props.deviceCodes?.length ? props.deviceCodes : [])
  if (deviceFilter.length > 0) {
    result = result.filter(r => deviceFilter.includes(r.deviceCode))
  }
  
  // Filter by members (from props or local filter)
  const memberFilter = localFilterMembers.value.length > 0
    ? localFilterMembers.value
    : (props.memberUsernames?.length ? props.memberUsernames : [])
  if (memberFilter.length > 0) {
    result = result.filter(r => r.username && memberFilter.includes(r.username))
  }
  
  // Filter by search text
  const needle = listSearch.value.trim().toLowerCase()
  if (needle) {
    result = result.filter(r => {
      const inTitle = (r.title || '').toLowerCase().includes(needle)
      const inNote = includeNotesInSearch.value ? (r.note || '').toLowerCase().includes(needle) : false
      const inUser = (r.username || '').toLowerCase().includes(needle)
      const inDevice = (r.deviceCode || '').toLowerCase().includes(needle)
      return inTitle || inNote || inUser || inDevice
    })
  }
  
  return result
})

/* Decoupled filters for dropdown options */
const listFilteredBase = computed<ReservationDto[]>(() => {
  let result = listRaw.value
  const needle = listSearch.value.trim().toLowerCase()
  if (needle) {
    result = result.filter(r => {
      const inTitle = (r.title || '').toLowerCase().includes(needle)
      const inNote = includeNotesInSearch.value ? (r.note || '').toLowerCase().includes(needle) : false
      const inUser = (r.username || '').toLowerCase().includes(needle)
      const inDevice = (r.deviceCode || '').toLowerCase().includes(needle)
      return inTitle || inNote || inUser || inDevice
    })
  }
  return result
})

// List filtered by Members only (to determine available Devices)
const listForDevices = computed<ReservationDto[]>(() => {
  let result = listFilteredBase.value
  const memberFilter = localFilterMembers.value.length > 0
    ? localFilterMembers.value
    : (props.memberUsernames?.length ? props.memberUsernames : [])
  if (memberFilter.length > 0) {
    result = result.filter(r => r.username && memberFilter.includes(r.username))
  }
  return result
})

// List filtered by Devices only (to determine available Members)
const listForMembers = computed<ReservationDto[]>(() => {
  let result = listFilteredBase.value
  const deviceFilter = localFilterDevices.value.length > 0
    ? localFilterDevices.value
    : (props.deviceCodes?.length ? props.deviceCodes : [])
  if (deviceFilter.length > 0) {
    result = result.filter(r => deviceFilter.includes(r.deviceCode))
  }
  return result
})

// For series reservations, use the earliest createdAt from the series
// so all reservations in a series sort and display with the same creation date
const seriesCreatedAtMap = computed<Map<string, number>>(() => {
  const map = new Map<string, number>()
  for (const r of listFiltered.value) {
    if (r.seriesId) {
      const current = map.get(r.seriesId)
      const createdAt = r.createdAt ?? r.startTime
      if (current === undefined || createdAt < current) {
        map.set(r.seriesId, createdAt)
      }
    }
  }
  return map
})

function getEffectiveCreatedAt(r: ReservationDto): number {
  // For series reservations, use the earliest createdAt from the series
  if (r.seriesId) {
    return seriesCreatedAtMap.value.get(r.seriesId) ?? r.createdAt ?? r.startTime
  }
  return r.createdAt ?? r.startTime
}

const tableItems = computed<DailyListRow[]>(() =>
  listFiltered.value
    .slice()
    .sort((a, b) => {
      const field = sortBy.value
      const desc = sortDesc.value ? -1 : 1
      
      let valA: string | number | null | undefined = a[field as keyof ReservationDto] as (string | number | null | undefined)
      let valB: string | number | null | undefined = b[field as keyof ReservationDto] as (string | number | null | undefined)

      // Special handling for computed/alias fields if needed, but for now strict DTO fields
      if (field === 'device') valA = a.deviceCode; valB = b.deviceCode
      if (field === 'date' || field === 'time') { valA = a.startTime; valB = b.startTime }
      if (field === 'status') valA = getStatus(a.startTime, a.endTime, nowMs.value); valB = getStatus(b.startTime, b.endTime, nowMs.value)
      if (field === 'createdAt') {
         // Use effective createdAt (series use earliest createdAt from series)
         valA = getEffectiveCreatedAt(a)
         valB = getEffectiveCreatedAt(b)
      }

      if (valA == null) return 1 * desc
      if (valB == null) return -1 * desc
      
      if (valA > valB) return 1 * desc
      if (valA < valB) return -1 * desc
      return 0
    })
    .map(i => {
      const s = new Date(i.startTime)
      const e = new Date(i.endTime)
      return {
        id: i.id,
        date: fmtDateLong(s),
        time: `${fmtTime(s)} – ${fmtTime(e)}`,
        device: i.deviceCode,
        title: i.title,
        user: i.username ?? '—',
        status: getStatus(i.startTime, i.endTime, nowMs.value),
        _raw: i
      }
    })
)

const TABLE_BATCH = 50
const visibleCount = ref<number>(TABLE_BATCH)
const tableWrap = ref<HTMLElement | null>(null)
const visibleTableItems = computed<DailyListRow[]>(() => tableItems.value.slice(0, visibleCount.value))

/* Multi-select state */
const selectedIds = ref<Set<number>>(new Set())




/* Helper to update date filter from native inputs if needed */
// If user changes native input, we might want to update calendar selection.
// But for now, let's keep it simple: Calendar drives the view primarily.

function toggleSelection(id: number, event?: Event) {
  if (event) event.stopPropagation()
  const newSet = new Set(selectedIds.value)
  if (newSet.has(id)) newSet.delete(id)
  else newSet.add(id)
  selectedIds.value = newSet
}

function toggleAll(event?: Event) {
  if (event) event.stopPropagation()
  if (selectedIds.value.size === visibleTableItems.value.length && visibleTableItems.value.length > 0) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(visibleTableItems.value.map(i => i.id))
  }
}

const isAllSelected = computed(() => 
  visibleTableItems.value.length > 0 && selectedIds.value.size === visibleTableItems.value.length
)

/* Bulk Delete */
const bulkDeleteConfirmOpen = ref(false)
const bulkDeleting = ref(false)

function clearSelection() {
  selectedIds.value = new Set()
}

function askBulkDelete() {
  if (selectedIds.value.size === 0) return
  bulkDeleteConfirmOpen.value = true
}

async function confirmBulkDelete() {
  if (selectedIds.value.size === 0) return
  bulkDeleting.value = true
  try {
    const idsToDelete = Array.from(selectedIds.value)
    // Delete all selected reservations in parallel for faster performance
    await Promise.all(idsToDelete.map(id => del(`reservations/${id}`)))
    // Remove all deleted items from local list at once
    listRaw.value = listRaw.value.filter(r => !selectedIds.value.has(r.id))
    // Clear selection after successful delete
    selectedIds.value = new Set()
    bulkDeleteConfirmOpen.value = false
  } catch (e) {
    console.error('Bulk delete failed', e)
    // Reload to get consistent state
    await loadListRange()
  } finally {
    bulkDeleting.value = false
  }
}

function editSelected() {
  if (selectedIds.value.size !== 1) return
  const id = Array.from(selectedIds.value)[0]
  const row = listRaw.value.find(r => r.id === id)
  if (row && props.openEdit) {
    props.openEdit(row)
  }
}

function resetVisibleCount() { visibleCount.value = TABLE_BATCH }
function onTableScroll() {
  const el = tableWrap.value
  if (!el) return
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60
  if (nearBottom && visibleCount.value < tableItems.value.length) {
    visibleCount.value = Math.min(visibleCount.value + TABLE_BATCH, tableItems.value.length)
  }
}

/* Anti-jump: keep/restore scrollTop around data swaps and dialog opens */
const savedScrollTop = ref(0)
function captureScroll() { savedScrollTop.value = tableWrap.value?.scrollTop ?? 0 }
async function restoreScroll() { await nextTick(); if (tableWrap.value) tableWrap.value.scrollTop = savedScrollTop.value }

const ALL_FROM_MS = 0
const ALL_TO_MS = new Date('2100-01-01T00:00:00').getTime()
let lastRequestId = 0

async function loadAll(silent = false) { await loadWithParams(ALL_FROM_MS, ALL_TO_MS, silent) }
async function loadListRange(silent = false) {
  if (!rangeFromMs.value || !rangeToMs.value) { await loadAll(silent); return }
  await loadWithParams(rangeFromMs.value, rangeToMs.value, silent)
}
async function loadWithParams(fromMs: number, toMs: number, silent = false) {
  if (!props.projectId) return
  const requestId = ++lastRequestId
  // Only show loading indicator for non-silent (user-initiated) loads
  if (!silent) {
    listLoading.value = true
  }
  listError.value = null
  try {
    captureScroll()

    const params = new URLSearchParams()
    params.set('from', String(fromMs))
    params.set('to', String(toMs))
    const codes = (props.deviceCodes ?? []).filter((c): c is string => c.trim().length > 0)
    if (codes.length) params.set('deviceCodes', codes.join(','))

    const url = `reservations/by-project/${props.projectId}?${params.toString()}`
    const resp = await get(url, undefined)
    if (requestId !== lastRequestId) return

    const items = (resp?.data?.items ?? []) as ReservationDto[]
    const newItems = items.map(x => ({
      id: x.id,
      title: x.title,
      deviceCode: x.deviceCode,
      startTime: x.startTime,
      endTime: x.endTime,
      username: x.username ?? null,
      projectId: x.projectId,
      note: x.note ?? null,
      seriesId: x.seriesId ?? null,
      createdAt: x.createdAt ?? null
    }))
    
    // Only update if data actually changed (prevents unnecessary re-renders)
    const hasChanged = listRaw.value.length !== newItems.length ||
      newItems.some((item, idx) => {
        const old = listRaw.value[idx]
        return !old || 
          old.id !== item.id ||
          old.title !== item.title ||
          old.deviceCode !== item.deviceCode ||
          old.startTime !== item.startTime ||
          old.endTime !== item.endTime ||
          old.username !== item.username ||
          old.note !== item.note
      })
    
    if (hasChanged) {
      listRaw.value = newItems
      if (!detailOpen.value) {
        selectedIndex.value = tableItems.value.length ? 0 : -1
      }
    }

    await restoreScroll()
  } catch (e: unknown) {
    if (requestId !== lastRequestId) return
    listError.value = (e as { message?: string })?.message || 'Nepodařilo se načíst rezervace.'
  } finally {
    if (requestId === lastRequestId) listLoading.value = false
  }
}

/* Detail editor (uses EntityEditorDialog) */
const detailOpen = ref(false)
const detailIndex = ref<number>(-1)
const detailItem = ref<ReservationDto | null>(null)
const detailItemId = ref<number | null>(null)
const visibleItems = computed<DailyListRow[]>(() => tableItems.value)



function openDetailAtIndex(idx: number) {
  if (idx < 0 || idx >= visibleItems.value.length) return
  captureScroll()
  detailIndex.value = idx
  const raw = visibleItems.value[idx]?._raw ?? null
  detailItem.value = raw
  detailItemId.value = raw?.id ?? null
  buildEditFormFrom(raw)
  detailOpen.value = !!detailItem.value
  restoreScroll()
}
function closeDetail() {
  detailOpen.value = false
  detailItem.value = null
  detailItemId.value = null
  detailIndex.value = -1
}
function gotoPrev() {
  if (!visibleItems.value.length) return
  const n = (detailIndex.value - 1 + visibleItems.value.length) % visibleItems.value.length
  openDetailAtIndex(n)
}
function gotoNext() {
  if (!visibleItems.value.length) return
  const n = (detailIndex.value + 1) % visibleItems.value.length
  openDetailAtIndex(n)
}
function onRowClick(ev: MouseEvent, payload: { item: DailyListRow }) {
  if (!payload?.item) return
  ev.preventDefault()
  ev.stopPropagation()
  const idx = visibleItems.value.findIndex(r => r.id === payload.item.id)
  if (idx >= 0) {
    selectedIndex.value = idx
    openDetailAtIndex(idx)
  }
}
function onRowDblClick(ev: MouseEvent, payload: { item: DailyListRow }) {
  ev.preventDefault()
  ev.stopPropagation()
  captureScroll()
  props.onDblClickRow?.(ev, payload)
  restoreScroll()
}

watch(tableItems, (rows) => {
  resetVisibleCount()
  if (!detailOpen.value || detailItemId.value == null) return
  const idx = rows.findIndex(r => r.id === detailItemId.value)
  if (idx >= 0) {
    detailIndex.value = idx
    detailItem.value = rows[idx]!._raw
    buildEditFormFrom(rows[idx]!._raw)
  } else {
    closeDetail()
  }
})

const searchInput = ref<HTMLInputElement | null>(null)
const selectedIndex = ref<number>(-1)
const emit = defineEmits<{
  (e: 'navigate-date', delta: number): void
}>()

function onKey(e: KeyboardEvent) {
  if (detailOpen.value) return
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  const key = e.key.toLowerCase()

  // Navigation emits (stop propagation to prevent global Reservations handler from firing too)
  if (key === 'arrowleft') { 
    e.preventDefault(); 
    e.stopImmediatePropagation(); 
    emit('navigate-date', -1); 
    return 
  }
  if (key === 'arrowright') { 
    e.preventDefault(); 
    e.stopImmediatePropagation(); 
    emit('navigate-date', 1); 
    return 
  }

  if (ctrl && key === 'enter') { e.preventDefault(); loadListRange(); return }
  if (key === '/' || (ctrl && key === 'l')) { e.preventDefault(); nextTick(() => searchInput.value?.focus()); return }
  if (key === 'arrowdown') { e.preventDefault(); moveSelection(1); return }
  if (key === 'arrowup') { e.preventDefault(); moveSelection(-1); return }
  if (key === 'enter') {
    if (selectedIndex.value >= 0) { e.preventDefault(); openDetailAtIndex(selectedIndex.value) }
    return
  }
  if (alt && key === 'a') { e.preventDefault(); loadAll() }
}
function moveSelection(delta: number) {
  const len = visibleItems.value.length
  if (!len) { selectedIndex.value = -1; return }
  if (selectedIndex.value === -1) { selectedIndex.value = 0; return }
  selectedIndex.value = (selectedIndex.value + delta + len) % len
}

/* ------- Editing inside dialog (form stays here, wrapper is reusable) ------- */
const editForm = ref<{
  title: string
  deviceCode: string
  dateYmd: string
  startHM: string
  endHM: string
  username: string | null
  note: string
  recurrence?: any // eslint-disable-line @typescript-eslint/no-explicit-any
} | null>(null)

function buildEditFormFrom(raw: ReservationDto | null) {
  if (!raw) { editForm.value = null; return }
  const s = new Date(raw.startTime)
  const e = new Date(raw.endTime)
  editForm.value = {
    title: raw.title ?? '',
    deviceCode: raw.deviceCode ?? '',
    dateYmd: toYmdLocal(s),
    startHM: hmFromDate(s),
    endHM: hmFromDate(e),
    username: raw.username ?? null,
    note: raw.note ?? '',
    recurrence: null
  }
}

const isSaving = ref(false)
const isEditValid = computed(() => {
  if (!editForm.value) return false
  const titleOk = !!editForm.value.title.trim()
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(editForm.value.dateYmd)
  const startOk = /^\d{2}:\d{2}$/.test(editForm.value.startHM)
  const endOk   = /^\d{2}:\d{2}$/.test(editForm.value.endHM)
  if (!(titleOk && dateOk && startOk && endOk)) return false
  const day = fromYmdLocal(editForm.value.dateYmd)
  const s = setHM(day, editForm.value.startHM)
  const e = setHM(day, editForm.value.endHM)
  return e.getTime() > s.getTime()
})

type ReservationPatchPayload = Partial<{
  title: string
  startTime: number
  endTime: number
  deviceCode: string
  username: string | null
  note: string | null
  createdAt: number
}>

async function saveInlineEdit() {
  if (!detailItem.value || !editForm.value || !isEditValid.value) return
  isSaving.value = true
  const id = detailItem.value.id
  const orig = detailItem.value
  const f = editForm.value
  const day = fromYmdLocal(f.dateYmd)
  const start = setHM(day, f.startHM)
  const end = setHM(day, f.endHM)

  const payload: ReservationPatchPayload = {}
  if (f.title.trim() !== (orig.title ?? '')) payload.title = f.title.trim()
  if (f.deviceCode && f.deviceCode !== orig.deviceCode) payload.deviceCode = f.deviceCode
  if (start.getTime() !== orig.startTime) payload.startTime = start.getTime()
  if (end.getTime() !== orig.endTime) payload.endTime = end.getTime()
  if ((f.username ?? null) !== (orig.username ?? null)) payload.username = (f.username ?? null)
  if ((f.note.trim() || null) !== (orig.note ?? null)) payload.note = (f.note.trim() || null)

  try {
    if (Object.keys(payload).length === 0) {
      isSaving.value = false
      return
    }
    await patch(`reservations/${id}`, payload, undefined)

    // Optimistic update
    const idx = listRaw.value.findIndex(r => r.id === id)
    if (idx >= 0) {
      const updated: ReservationDto = { ...listRaw.value[idx] }
      if (payload.title !== undefined)      updated.title = payload.title
      if (payload.deviceCode !== undefined) updated.deviceCode = payload.deviceCode
      if (payload.startTime !== undefined)  updated.startTime = payload.startTime
      if (payload.endTime !== undefined)    updated.endTime = payload.endTime
      if (payload.username !== undefined)   updated.username = payload.username
      if (payload.note !== undefined)       updated.note = payload.note
      if (payload.createdAt !== undefined)  updated.createdAt = payload.createdAt
      listRaw.value.splice(idx, 1, updated)
      detailItem.value = updated
      buildEditFormFrom(updated)
    }
    await loadListRange()
    detailOpen.value = false
  } catch (e) {
    console.error('Save failed', e)
  } finally {
    isSaving.value = false
  }
}

function deleteFromDetail() {
  if (detailItem.value) {
    props.askDelete?.(detailItem.value)
    setTimeout(() => { loadListRange() }, 800)
    detailOpen.value = false
  }
}

/* Detail hotkeys – managed by EntityEditorDialog (Ctrl+S, Del, Esc) + local prev/next by buttons */
function onDetailKey(e: KeyboardEvent) {
  if (!detailOpen.value) return
  const key = e.key.toLowerCase()
  if (key === 'arrowup') { e.preventDefault(); gotoPrev(); return }
  if (key === 'arrowdown') { e.preventDefault(); gotoNext(); return }
}
watch(detailOpen, async v => {
  if (v) {
    window.addEventListener('keydown', onDetailKey)
    await nextTick()
  } else {
    window.removeEventListener('keydown', onDetailKey)
  }
})

let refreshTimer: number | null = null
function startAutoRefresh() {
  stopAutoRefresh()
  if (!props.autoLoad) return
  refreshTimer = window.setInterval(async () => {
    if (listLoading.value) return
    if (isSaving.value) return
    // Use silent mode for auto-refresh to prevent loading indicator flash
    await loadListRange(true)
  }, AUTO_REFRESH_MS)
}
function stopAutoRefresh() { if (refreshTimer != null) { window.clearInterval(refreshTimer); refreshTimer = null } }
let focusDebounce: number | null = null
function onVisibilityOrFocus() {
  if (!props.autoLoad) return
  if (document.visibilityState !== 'visible') return
  if (focusDebounce) window.clearTimeout(focusDebounce)
  focusDebounce = window.setTimeout(() => {
    // Use silent mode for focus-refresh to prevent loading indicator flash
    if (!listLoading.value && !isSaving.value) loadListRange(true)
  }, FOCUS_REFRESH_DEBOUNCE_MS)
}

onMounted(async () => {
  // Don't set default date range - load ALL reservations by default
  // User can optionally filter by date later using the inputs
  listFrom.value = ''
  listTo.value = ''

  // Load devices immediately (used for chips and editing) – not gated by NAČÍST
  try {
    const resp = await get('reservations/devices', undefined)
    devices.value = resp?.data?.items ?? []
    
    // Fetch members for edit dialog
    const mResp = await get(`projectMember/${props.projectId}`)
    if (mResp?.data?.content?.members) {
      members.value = mResp.data.content.members.map((m: any) => m.username).filter(Boolean) // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  } catch (e) { console.warn('Nešlo načíst data pro editaci', e) }

  startNowTicker()
  window.addEventListener('keydown', onKey)
  window.addEventListener('focus', onVisibilityOrFocus)
  document.addEventListener('visibilitychange', onVisibilityOrFocus)

  // Auto-load ALL reservations on start
  await loadAll()
  startAutoRefresh()
})
onBeforeUnmount(() => {
  stopAutoRefresh()
  stopNowTicker()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('focus', onVisibilityOrFocus)
  document.removeEventListener('visibilitychange', onVisibilityOrFocus)
  window.removeEventListener('keydown', onDetailKey)
})

watch(
  () => [props.projectId, JSON.stringify(props.deviceCodes ?? [])],
  async () => { await loadListRange() }
)

let rangeReloadDebounce: number | null = null
function scheduleRangeReload() {
  if (rangeReloadDebounce) window.clearTimeout(rangeReloadDebounce)
  rangeReloadDebounce = window.setTimeout(() => { loadListRange() }, 350)
}
watch(listFrom, scheduleRangeReload)
watch(listTo, scheduleRangeReload)

/* Helpers */
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
function pad2(n: number) { return String(n).padStart(2, '0') }
function hmFromDate(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
function setHM(base: Date, hm: string) {
  const [h, m] = hm.split(':').map(v => parseInt(v, 10) || 0)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}
//function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(d.getDate() + n); return x }
function startOfDayMs(ymd: string): number { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime() }
function endOfDayMs(ymd: string): number   { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999).getTime() }
//function statusColor(status: StatusType): string { return status === 'done' ? 'green' : status === 'running' ? 'blue' : 'grey' }
function statusLabel(status: StatusType): string { return status === 'plan' ? 'Čeká' : status === 'running' ? 'Probíhá' : 'Hotovo' }

// Helper functions for new table design
function getDeviceInitials(deviceCode: string): string {
  const device = devices.value.find(d => d.code === deviceCode)
  if (device?.name) {
    const words = device.name.split(' ')
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return device.name.substring(0, 2).toUpperCase()
  }
  return deviceCode.substring(0, 2).toUpperCase()
}

function getDeviceName(deviceCode: string): string {
  const device = devices.value.find(d => d.code === deviceCode)
  return device?.name || deviceCode
}

function getUserInitials(username: string): string {
  if (!username || username === '—') return '?'
  const parts = username.split(/[.\s]+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return username.substring(0, 2).toUpperCase()
}

function formatUserName(username: string): string {
  if (!username || username === '—') return '—'
  const parts = username.split(/[.\s]+/)
  if (parts.length >= 2) return `${parts[0][0].toUpperCase()}. ${parts[1].charAt(0).toUpperCase()}${parts[1].slice(1).toLowerCase()}`
  return username
}

function formatDateShort(timestamp: number): string {
  const d = new Date(timestamp)
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`
}

function getStatusClass(status: StatusType): string {
  if (status === 'done') return 'status-confirmed'
  if (status === 'running') return 'status-running'
  return 'status-pending'
}

function getStatusIcon(status: StatusType): string {
  if (status === 'done') return 'mdi-check-circle'
  if (status === 'running') return 'mdi-play-circle'
  return 'mdi-clock-outline'
}

/* Direct list manipulation methods for immediate updates */
const highlightedIds = ref<Set<number>>(new Set())

function addReservation(item: { id: number; title: string; deviceCode: string; startTime: number; endTime: number; username: string | null; projectId: number; note: string | null }) {
  // Check if already exists
  const existingIdx = listRaw.value.findIndex(r => r.id === item.id)
  if (existingIdx >= 0) {
    // Update existing
    listRaw.value[existingIdx] = { ...item }
  } else {
    // Add new - tableItems computed will handle sorting
    listRaw.value.push({ ...item })
  }

  // Highlight new item
  highlightedIds.value.add(item.id)
  setTimeout(() => {
    highlightedIds.value.delete(item.id)
  }, 4000)
  
  // Scroll to the new item after next tick (so it renders first)
  nextTick(() => {
    scrollToReservation(item.id)
  })
}

const highlightedSeriesId = ref<string | null>(null)
function highlightSeries(seriesId: string) {
  highlightedSeriesId.value = seriesId
  setTimeout(() => { highlightedSeriesId.value = null }, 3500)
  
  // Scroll to first item in series
  nextTick(() => {
    const firstSeriesItem = tableItems.value.find(i => i._raw.seriesId === seriesId)
    if (firstSeriesItem) {
      scrollToReservation(firstSeriesItem.id)
    }
  })
}

// Scroll to a specific reservation row
function scrollToReservation(id: number) {
  const row = tableWrap.value?.querySelector(`[data-reservation-id="${id}"]`) as HTMLElement | null
  if (row && tableWrap.value) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function updateReservation(id: number, updates: Partial<{ title: string; deviceCode: string; startTime: number; endTime: number; username: string | null; note: string | null }>) {
  const idx = listRaw.value.findIndex(r => r.id === id)
  if (idx >= 0) {
    listRaw.value[idx] = { ...listRaw.value[idx], ...updates }
  }
}

function removeReservation(id: number) {
  const idx = listRaw.value.findIndex(r => r.id === id)
  if (idx >= 0) {
    listRaw.value.splice(idx, 1)
  }
}

/* Expose for parent */
/* Expose for parent */
const usedDeviceCodes = computed<string[]>(() => {
  const s = new Set<string>()
  // Use listForDevices (filtered by search + members, but NOT by devices)
  for (const r of listForDevices.value) {
    if (r.deviceCode) s.add(r.deviceCode)
  }
  return Array.from(s)
})

const usedUsernames = computed<string[]>(() => {
  const s = new Set<string>()
  // Use listForMembers (filtered by search + devices, but NOT by members)
  for (const r of listForMembers.value) {
    if (r.username) s.add(r.username)
  }
  return Array.from(s)
})

defineExpose({ loadListRange, loadAll, addReservation, updateReservation, removeReservation, selectedIds, usedDeviceCodes, usedUsernames, highlightSeries })
</script>

<template>
  <div
    class="flex-grow-1"
    style="min-width: 0; display: flex; flex-direction: column; gap: 0;"
  >
    <!-- Compact Filter Row -->
    <div class="compact-filter-bar">
      <!-- Date From -->
      <div class="filter-field">
        <label>Od:</label>
        <input
          v-model="listFrom"
          type="date"
          class="native-date-input"
        >
      </div>
      
      <!-- Date To -->
      <div class="filter-field">
        <label>Do:</label>
        <input
          v-model="listTo"
          type="date"
          class="native-date-input"
        >
      </div>
      
      <!-- Search -->
      <div class="search-field">
        <label>Hledat</label>
        <v-icon
          size="18"
          class="search-icon"
        >
          mdi-magnify
        </v-icon>
        <input
          ref="searchInput"
          v-model="listSearch"
          type="text"
          placeholder="Hledat rezervaci..."
          class="native-search-input"
        >
      </div>

      <!-- Notes Switch -->
      <ModernSwitch
        v-model="includeNotesInSearch"
        label="Hledat i v poznámkách"
        class="ml-3"
      />
      
      <!-- Count -->
      <div class="count-badge ml-auto">
        <strong>{{ tableItems.length }}</strong> rezervací
      </div>
    </div>

    <v-alert
      v-if="listError"
      type="error"
      density="comfortable"
      class="mb-4"
      border="start"
    >
      {{ listError }}
      <v-btn
        size="small"
        variant="text"
        class="ml-2"
        @click="loadListRange"
      >
        Zkusit znovu
      </v-btn>
    </v-alert>

    <div
      ref="tableWrap"
      class="table-wrap"
      :style="{ overflowAnchor: 'none' }"
      @scroll.passive="onTableScroll"
    >
      <!-- Modern Table -->
      <table class="reservations-table">
        <thead>
          <tr>
            <th style="width: 48px; padding-right: 0; text-align: center;">
              <div 
                class="checkbox-wrapper" 
                style="cursor: pointer; display: inline-flex;"
                title="Vybrat vše"
                @click="toggleAll"
              >
                <v-icon
                  v-if="isAllSelected"
                  size="20"
                  color="primary"
                >
                  mdi-checkbox-marked
                </v-icon>
                <v-icon
                  v-else-if="selectedIds.size > 0 && !isAllSelected"
                  size="20"
                  color="primary"
                >
                  mdi-minus-box
                </v-icon>
                <v-icon
                  v-else
                  size="20"
                  color="grey-lighten-1"
                >
                  mdi-checkbox-blank-outline
                </v-icon>
              </div>
            </th>
            
            <th 
              v-for="h in headersToUse" 
              :key="h.key"
              :style="{ width: h.width ? h.width + 'px' : 'auto', minWidth: h.minWidth ? h.minWidth + 'px' : undefined, cursor: h.sortable ? 'pointer' : 'default' }"
              class="header-cell"
              @click="h.sortable ? (sortBy === h.key ? sortDesc = !sortDesc : (sortBy = h.key, sortDesc = true)) : null"
            >
              <div class="d-flex align-center">
                {{ h.title }}
                <v-icon 
                  v-if="sortBy === h.key" 
                  size="14" 
                  class="ml-1"
                >
                  {{ sortDesc ? 'mdi-arrow-down' : 'mdi-arrow-up' }}
                </v-icon>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, index) in visibleTableItems"
            :key="item.id"
            :data-reservation-id="item.id"
            class="reservation-row"
            :class="{ 'row-selected': selectedIds.has(item.id), 'row-highlight': highlightedIds.has(item.id) || (highlightedSeriesId && item._raw.seriesId === highlightedSeriesId) }"
            @click="(e) => onRowClick(e, { item })"
            @dblclick="(e) => onRowDblClick(e, { item })"
          >
            <!-- Checkbox -->
            <td
              style="padding-right: 0; text-align: center;"
              @click.stop
            >
              <div 
                class="checkbox-wrapper"
                style="cursor: pointer; display: inline-flex;"
                @click="(e) => toggleSelection(item.id, e)"
              >
                <v-icon
                  v-if="selectedIds.has(item.id)"
                  size="20"
                  color="primary"
                >
                  mdi-checkbox-marked
                </v-icon>
                <v-icon
                  v-else
                  size="20"
                  color="grey-lighten-1"
                >
                  mdi-checkbox-blank-outline
                </v-icon>
              </div>
            </td>

            <!-- Device with avatar -->
            <td>
              <div class="device-cell">
                <span
                  class="device-avatar"
                  :style="{ backgroundColor: deviceColorByCode.get(item.device) || '#9E9E9E' }"
                >
                  {{ getDeviceInitials(item.device) }}
                </span>
                <span class="device-name">{{ getDeviceName(item.device) }}</span>
              </div>
            </td>
            
            <!-- Date -->
            <td class="date-cell">
              {{ formatDateShort(item._raw.startTime) }}
            </td>
            
            <!-- Time -->
            <td class="time-cell">
              {{ item.time }}
            </td>
            
            <!-- Title -->
            <td class="title-cell">
              <span>{{ item.title }}</span>
              <v-icon
                v-if="item._raw.note"
                size="14"
                class="ml-1"
                color="grey"
                title="Poznámka je v detailu"
              >
                mdi-text
              </v-icon>
            </td>
            
            <!-- User with avatar -->
            <td>
              <div
                v-if="item.user !== '—'"
                class="user-cell"
              >
                <span
                  class="user-avatar"
                  :style="{ backgroundColor: deviceColorByCode.get(item.device) || '#9E9E9E' }"
                >
                  {{ getUserInitials(item.user) }}
                </span>
                <span class="user-name">{{ formatUserName(item.user) }}</span>
              </div>
              <span
                v-else
                class="text-medium-emphasis"
              >—</span>
            </td>

            <!-- CreatedAt (new col) -->
            <td class="time-cell">
              <span
                v-if="item._raw.createdAt || item._raw.seriesId"
                :title="new Date(getEffectiveCreatedAt(item._raw)).toLocaleString('cs-CZ')"
              >
                {{ formatDateShort(getEffectiveCreatedAt(item._raw)) }} {{ new Date(getEffectiveCreatedAt(item._raw)).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'}) }}
              </span>
              <span
                v-else
                class="text-medium-emphasis"
              >—</span>
            </td>
            
            <!-- Status -->
            <td style="text-align: center;">
              <span
                class="status-chip"
                :class="getStatusClass(item.status)"
              >
                <v-icon size="14">{{ getStatusIcon(item.status) }}</v-icon>
                {{ statusLabel(item.status) }}
              </span>
            </td>
            
            <!-- Actions -->
            <!-- Actions removed -->
          </tr>
          
          <tr v-if="visibleTableItems.length === 0 && !listLoading">
            <td
              colspan="7"
              class="empty-state"
            >
              Žádné rezervace.
            </td>
          </tr>
          
          <tr v-if="listLoading">
            <td
              colspan="7"
              class="loading-state"
            >
              <div class="loading-content">
                <v-progress-circular
                  indeterminate
                  size="24"
                  color="primary"
                  class="mr-2"
                />
                Načítám...
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div
        v-if="visibleCount < tableItems.length"
        class="table-sentinel"
      >
        <v-progress-circular
          indeterminate
          size="18"
          color="primary"
        />
        <span class="text-medium-emphasis ml-2">Načítám další…</span>
      </div>
    </div>

    <!-- Pagination -->
    <div
      v-if="tableItems.length > 0"
      class="pagination-bar"
    >
      <div class="pagination-info">
        Zobrazeno <strong>1–{{ Math.min(visibleCount, tableItems.length) }}</strong> z <strong>{{ tableItems.length }}</strong> rezervací
      </div>
      
      <div class="pagination-controls">
        <button
          class="page-btn"
          :disabled="visibleCount >= tableItems.length"
          @click="visibleCount = Math.min(visibleCount + TABLE_BATCH, tableItems.length)"
        >
          Načíst další
        </button>
      </div>
      
      <div class="pagination-per-page">
        <span>Na stránku:</span>
        <select
          v-model="visibleCount"
          class="page-select"
        >
          <option :value="50">
            50
          </option>
          <option :value="100">
            100
          </option>
          <option :value="250">
            250
          </option>
          <option :value="tableItems.length">
            Vše
          </option>
        </select>
      </div>
    </div>

    <!-- Unified editor dialog for reservation -->
    <!-- Unified editor dialog for reservation -->
    <ReservationEditorDialog
      v-if="editForm"
      v-model="detailOpen"
      v-model:title="editForm.title"
      v-model:device-code="editForm.deviceCode"
      v-model:date-ymd="editForm.dateYmd"
      v-model:start-h-m="editForm.startHM"
      v-model:end-h-m="editForm.endHM"
      v-model:username="editForm.username"
      v-model:note="editForm.note"
      v-model:recurrence="editForm.recurrence"
      mode="edit"
      :saving="isSaving"
      :devices="devicesForDialog"
      :members="members"
      @save="saveInlineEdit"
      @delete="deleteFromDetail"
      @cancel="closeDetail"
    >
      <template #header-actions>
        <v-btn
          icon="mdi-chevron-up"
          variant="text"
          :title="'Předchozí (↑)'"
          size="small"
          class="mr-1"
          style="color: rgba(255,255,255,0.85);"
          @click="gotoPrev"
        />
        <v-btn
          icon="mdi-chevron-down"
          variant="text"
          :title="'Další (↓)'"
          size="small"
          style="color: rgba(255,255,255,0.85);"
          @click="gotoNext"
        />
      </template>
    </ReservationEditorDialog>

    <!-- Selection Action Bar (floating) -->
    <Transition name="slide-up">
      <div
        v-if="selectedIds.size > 0"
        class="selection-action-bar"
      >
        <div class="selection-info">
          <v-icon
            size="20"
            class="mr-2"
          >
            mdi-checkbox-marked
          </v-icon>
          <span><strong>{{ selectedIds.size }}</strong> {{ selectedIds.size === 1 ? 'rezervace vybrána' : 'rezervací vybráno' }}</span>
        </div>
        <div class="selection-actions">
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-close"
            @click="clearSelection"
          >
            Zrušit výběr
          </v-btn>
          <v-btn
            v-if="selectedIds.size === 1"
            size="small"
            variant="text"
            prepend-icon="mdi-pencil"
            @click="editSelected"
          >
            Upravit
          </v-btn>
          <v-btn
            size="small"
            color="error"
            variant="flat"
            prepend-icon="mdi-delete"
            @click="askBulkDelete"
          >
            Smazat vybrané
          </v-btn>
        </div>
      </div>
    </Transition>

    <!-- Bulk Delete Confirmation Dialog -->
    <v-dialog
      v-model="bulkDeleteConfirmOpen"
      max-width="480"
      persistent
    >
      <v-card>
        <v-card-title
          class="text-h6 d-flex align-center"
          style="gap: 8px;"
        >
          <v-icon color="error">
            mdi-alert-circle
          </v-icon>
          Potvrdit hromadné smazání
        </v-card-title>
        <v-card-text>
          <p>Opravdu chcete smazat <strong>{{ selectedIds.size }}</strong> {{ selectedIds.size === 1 ? 'rezervaci' : 'rezervací' }}?</p>
          <p class="text-medium-emphasis mt-2">
            Tato akce je nevratná.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="bulkDeleting"
            @click="bulkDeleteConfirmOpen = false"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="bulkDeleting"
            prepend-icon="mdi-delete"
            @click="confirmBulkDelete"
          >
            Smazat
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Compact Filter Bar */
.compact-filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 24px 40px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  margin-bottom: 0;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-field label {
  font-size: 13px;
  font-weight: 600;
  color: #495057;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.native-date-input {
  height: 36px;
  padding: 10px 14px;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  font-size: 14px;
  background: white;
  color: #212529;
  transition: all 0.3s;
}

.native-date-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.search-field {
  flex: 1;
  min-width: 200px;
  max-width: 400px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-icon {
  position: absolute;
  left: 14px;
  bottom: 11px;
  color: #6c757d;
  pointer-events: none;
}

.native-search-input {
  width: 100%;
  height: 36px;
  padding: 10px 14px 10px 40px;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  font-size: 14px;
  background: white;
  color: #212529;
  transition: all 0.3s;
}

.native-search-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.count-badge {
  background:linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  padding: 10px 20px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  margin-left: auto;
}

.count-badge strong {
  color: white;
}

/* Table */
.table-wrap {
  max-height: 65vh;
  min-height: 400px;
  overflow: auto;
  position: relative;
  padding: 0 0 40px;
}

.reservations-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 8px;
  background: transparent;
}

.reservations-table thead tr {
  background: #f8f9fa;
}

.reservations-table th {
  padding: 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 700;
  color: #495057;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: #f8f9fa;
  position: sticky;
  top: 0;
  z-index: 10;
}

.reservations-table th:first-child {
  border-radius: 12px 0 0 12px;
}

.reservations-table th:last-child {
  border-radius: 0 12px 12px 0;
}

.reservation-row {
  background: white;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.reservation-row:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.15);
}

.reservation-row.row-selected {
  background: #e3f2fd;
  box-shadow: 0 4px 16px rgba(33, 150, 243, 0.2);
}

.reservation-row.row-highlight {
  animation: highlight-list-row 3s ease-out forwards;
}

@keyframes highlight-list-row {
  0% { 
    background-color: #E3F2FD;
    box-shadow: 0 8px 24px rgba(33, 150, 243, 0.3);
  } 
  100% { 
    background-color: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  }
}

.reservations-table td {
  padding: 20px 16px;
  border-top: 1px solid #f1f3f5;
  border-bottom: 1px solid #f1f3f5;
}

.reservations-table td:first-child {
  border-left: 1px solid #f1f3f5;
  border-radius: 12px 0 0 12px;
}

.reservations-table td:last-child {
  border-right: 1px solid #f1f3f5;
  border-radius: 0 12px 12px 0;
}

/* Device Cell */
.device-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.device-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.device-name {
  font-size: 14px;
  font-weight: 600;
  color: #212529;
}

/* User Cell */
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 500;
  color: #495057;
}

/* Table Cells */
.date-cell {
  font-size: 14px;
  font-weight: 500;
  color: #495057;
}

.time-cell {
  font-size: 13px;
  font-weight: 500;
  color: #6c757d;
}

.title-cell {
  font-size: 14px;
  font-weight: 500;
  color: #212529;
}

.title-cell i {
  color: #adb5bd;
  margin-left: 8px;
}

/* Status Chip */
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.status-confirmed {
  background: #d4edda;
  color: #155724;
}

.status-running {
  background: #cce5ff;
  color: #004085;
}

.status-pending {
  background: #fff3cd;
  color: #856404;
}

/* Checkbox */
.checkbox-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Empty/Loading States */
.empty-state,
.loading-state {
  padding: 48px 32px;
  text-align: center;
  color: #6c757d;
  font-size: 14px;
}

.loading-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

/* Sentinel */
.table-sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 0 24px;
  color: #6c757d;
  font-size: 14px;
}

/* Pagination Bar */
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 40px;
  border-top: 1px solid #e9ecef;
  background: #f8f9fa;
}

.pagination-info {
  font-size: 14px;
  color: #495057;
}

.pagination-info strong {
  color: #212529;
  font-weight: 700;
}

.pagination-controls {
  display: flex;
  gap: 8px;
}

.page-btn {
  min-width: 120px;
  height: 40px;
  padding: 10px 24px;
  border: none;
  background:linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.3s ease;
}

.page-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.pagination-per-page {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #495057;
}

.page-select {
  height: 36px;
  padding: 8px 12px;
  border: 2px solid #e9ecef;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  color: #212529;
  cursor: pointer;
  transition: all 0.2s;
}

.page-select:focus {
  outline: none;
  border-color: #667eea;
}

/* Selection Action Bar */
.selection-action-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(102, 126, 234, 0.4);
  z-index: 1000;
  min-width: 400px;
}

.selection-info {
  display: flex;
  align-items: center;
  font-size: 15px;
  font-weight: 600;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Slide up transition */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}

.slide-up-enter-to,
.slide-up-leave-from {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* Responsive */
@media (max-width: 1200px) {
  .compact-filter-bar {
    padding: 20px 24px;
  }
  
  .table-wrap {
    padding: 0 24px 24px;
  }
  
  .pagination-bar {
    padding: 20px 24px;
  }
}

@media (max-width: 768px) {
  .compact-filter-bar {
    padding: 16px 20px;
    gap: 12px;
  }
  
  .table-wrap {
    padding: 0 20px 20px;
  }
  
  .pagination-bar {
    padding: 16px 20px;
    flex-direction: column;
    gap: 12px;
  }
  
  .selection-action-bar {
    min-width: 90%;
    flex-direction: column;
    gap: 12px;
  }
}
</style>
