<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { get, patch } from '@/services/api/api-requests'
import EntityEditorDialog from '@/components/EntityEditorDialog.vue'

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
  headers?: Header[]
  autoLoad?: boolean
  onDblClickRow?: (ev: MouseEvent, payload: { item: DailyListRow }) => void
  openEdit?: (raw: ReservationDto) => void
  askDelete?: (raw: ReservationDto) => void
}>()

const AUTO_REFRESH_MS = 15000
const FOCUS_REFRESH_DEBOUNCE_MS = 350

const DAILY_LIST_HEADERS: Header[] = [
  { title: 'Stav', key: 'status', width: 110 },
  { title: 'Stroj', key: 'device', width: 90 },
  { title: 'Název', key: 'title', minWidth: 220 },
  { title: 'Datum', key: 'date', width: 180 },
  { title: 'Čas', key: 'time', width: 160 },
]
const headersToUse = computed<Header[]>(() => props.headers?.length ? props.headers : DAILY_LIST_HEADERS)

const DEFAULT_DAYS = 60
const listFrom = ref<string>('')
const listTo   = ref<string>('')
const listSearch = ref<string>('')

const listLoading = ref(false)
const listError = ref<string | null>(null)
const listRaw = ref<ReservationDto[]>([])
const devices = ref<DeviceResponse[]>([])

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
const listRangeDays = computed(() => {
  if (rangeFromMs.value == null || rangeToMs.value == null) return 0
  const diff = rangeToMs.value - rangeFromMs.value
  return diff >= 0 ? (diff / 86400000) + 1 : 0
})

const includeNotesInSearch = ref(true)
const listFiltered = computed<ReservationDto[]>(() => {
  const needle = listSearch.value.trim().toLowerCase()
  if (!needle) return listRaw.value
  return listRaw.value.filter(r => {
    const inTitle = (r.title || '').toLowerCase().includes(needle)
    const inNote = includeNotesInSearch.value ? (r.note || '').toLowerCase().includes(needle) : false
    return inTitle || inNote
  })
})

const tableItems = computed<DailyListRow[]>(() =>
  listFiltered.value
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
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

async function loadAll() { await loadWithParams(ALL_FROM_MS, ALL_TO_MS) }
async function loadListRange() {
  if (!rangeFromMs.value || !rangeToMs.value) { await loadAll(); return }
  await loadWithParams(rangeFromMs.value, rangeToMs.value)
}
async function loadWithParams(fromMs: number, toMs: number) {
  if (!props.projectId) return
  const requestId = ++lastRequestId
  listLoading.value = true
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
    listRaw.value = items.map(x => ({
      id: x.id,
      title: x.title,
      deviceCode: x.deviceCode,
      startTime: x.startTime,
      endTime: x.endTime,
      username: x.username ?? null,
      projectId: x.projectId,
      note: x.note ?? null
    }))
    if (!detailOpen.value) {
      selectedIndex.value = tableItems.value.length ? 0 : -1
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
function onKey(e: KeyboardEvent) {
  if (detailOpen.value) return
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  const key = e.key.toLowerCase()

  if (ctrl && key === 'enter') { e.preventDefault(); loadListRange(); return }
 // if (ctrl && key === 'r')     { e.preventDefault(); loadListRange(); return }
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
    note: raw.note ?? ''
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
    await loadListRange()
  }, AUTO_REFRESH_MS)
}
function stopAutoRefresh() { if (refreshTimer != null) { window.clearInterval(refreshTimer); refreshTimer = null } }
let focusDebounce: number | null = null
function onVisibilityOrFocus() {
  if (!props.autoLoad) return
  if (document.visibilityState !== 'visible') return
  if (focusDebounce) window.clearTimeout(focusDebounce)
  focusDebounce = window.setTimeout(() => {
    if (!listLoading.value && !isSaving.value) loadListRange()
  }, FOCUS_REFRESH_DEBOUNCE_MS)
}

onMounted(async () => {
  const to = new Date()
  const from = addDays(new Date(), -(DEFAULT_DAYS - 1))
  listFrom.value = toYmdLocal(from)
  listTo.value = toYmdLocal(to)

  try {
    const resp = await get('reservations/devices', undefined)
    devices.value = resp?.data?.items ?? []
  } catch (e) { console.warn('Nešlo načíst zařízení pro editaci', e) }

  startNowTicker()
  window.addEventListener('keydown', onKey)
  window.addEventListener('focus', onVisibilityOrFocus)
  document.addEventListener('visibilitychange', onVisibilityOrFocus)

  if (props.autoLoad) {
    await loadListRange()
    startAutoRefresh()
  }
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
  async () => { if (props.autoLoad) await loadListRange() }
)

let rangeReloadDebounce: number | null = null
function scheduleRangeReload() {
  if (!props.autoLoad) return
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
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(d.getDate() + n); return x }
function startOfDayMs(ymd: string): number { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime() }
function endOfDayMs(ymd: string): number   { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999).getTime() }
function statusColor(status: StatusType): string { return status === 'done' ? 'green' : status === 'running' ? 'blue' : 'grey' }
function statusLabel(status: StatusType): string { return status === 'plan' ? 'Plánované' : status === 'running' ? 'Probíhá' : 'Dokončeno' }

/* Expose for parent */
defineExpose({ loadListRange, loadAll })
</script>

<template>
  <div class="w-100">
    <!-- Filters -->
    <v-sheet
      elevation="1"
      class="pa-3 mb-4 list-filters"
      color="grey-lighten-5"
    >
      <div class="filters-row">
        <v-text-field
          v-model="listFrom"
          type="date"
          label="Datum od"
          variant="outlined"
          density="comfortable"
          hide-details
        />
        <v-text-field
          v-model="listTo"
          type="date"
          label="Datum do"
          variant="outlined"
          density="comfortable"
          hide-details
        />
        <v-text-field
          ref="searchInput"
          v-model="listSearch"
          clearable
          label="Hledat"
          variant="outlined"
          density="comfortable"
          class="search-input"
          hide-details
        />
        <div class="actions d-flex ga-2">
          <v-btn
            color="primary"
            class="load-btn"
            :loading="listLoading"
            title="Načíst (Ctrl+Enter)"
            @click="loadListRange"
          >
            NAČÍST
          </v-btn>
          <v-btn
            class="load-btn"
            variant="text"
            :disabled="listLoading"
            title="Načíst všechny (Alt+A)"
            @click="loadAll"
          >
            NAČÍST VŠE
          </v-btn>
        </div>
      </div>

      <div class="filters-row-bottom">
        <div class="d-flex align-center ga-4">
          <v-switch
            v-model="includeNotesInSearch"
            color="primary"
            inset
            density="comfortable"
            hide-details
            label="Hledat i v poznámkách"
          />
        </div>
        <div class="text-caption text-medium-emphasis count">
          {{ tableItems.length }} záznamů
          <span v-if="listRangeDays > 0"> ({{ Math.round(listRangeDays) }} dní)</span>
        </div>
      </div>
    </v-sheet>

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
      <v-data-table
        :headers="headersToUse"
        :items="visibleTableItems"
        item-key="id"
        class="elevation-1 improved-table"
        density="comfortable"
        :loading="listLoading"
        :items-per-page="-1"
        hide-default-footer
        hover
        @click:row="onRowClick"
        @dblclick:row="onRowDblClick"
      >
        <template #[`item.title`]="{ item }">
          <span class="d-inline-flex align-center">
            {{ item.title }}
            <v-icon
              v-if="item._raw.note"
              size="14"
              class="ml-1"
              color="grey"
              title="Poznámka je v detailu"
            >mdi-text</v-icon>
          </span>
        </template>

        <template #[`item.status`]="{ item }">
          <v-chip
            size="small"
            :color="statusColor(item.status)"
            text-color="white"
            variant="flat"
          >
            {{ statusLabel(item.status) }}
          </v-chip>
        </template>

        <template #loading>
          <div class="pa-6 text-center text-medium-emphasis">
            Načítám...
          </div>
        </template>
        <template #no-data>
          <div class="pa-6 text-medium-emphasis text-center">
            Žádné rezervace.
          </div>
        </template>
      </v-data-table>

      <div
        v-if="visibleCount < tableItems.length"
        class="table-sentinel"
      >
        <v-progress-circular
          indeterminate
          size="18"
          color="primary"
          class="mr-2"
        />
        <span class="text-medium-emphasis">Načítám další…</span>
      </div>
    </div>

    <!-- Unified editor dialog for reservation -->
    <EntityEditorDialog
      v-model:is-open="detailOpen"
      entity-label="rezervace"
      mode="edit"
      :saving="isSaving"
      :deletable="true"
      @save="saveInlineEdit"
      @delete="deleteFromDetail"
      @cancel="closeDetail"
    >
      <template #header-right>
        <v-btn
          icon="mdi-chevron-up"
          variant="text"
          :title="'Předchozí (↑)'"
          @click="gotoPrev"
        />
        <v-btn
          icon="mdi-chevron-down"
          variant="text"
          :title="'Další (↓)'"
          @click="gotoNext"
        />
      </template>

      <v-row
        v-if="editForm"
        class="g-4 mb-1"
      >
        <v-col
          cols="12"
          md="6"
        >
          <v-text-field
            v-model="editForm.title"
            label="Název"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            autofocus
          />
        </v-col>
        <v-col
          cols="12"
          md="6"
        >
          <v-select
            v-model="editForm.deviceCode"
            :items="devices"
            item-title="code"
            item-value="code"
            label="Přístroj"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            clearable
          >
            <template #selection="{ item }">
              <v-chip
                size="small"
                color="primary"
                text-color="white"
              >
                {{ item.raw.code }}
              </v-chip>
            </template>
            <template #item="{ item, props }">
              <v-list-item
                v-bind="props"
                :title="item.raw.name"
                :subtitle="item.raw.code"
              />
            </template>
          </v-select>
        </v-col>

        <v-col
          cols="12"
          md="6"
        >
          <v-text-field
            v-model="editForm.dateYmd"
            type="date"
            label="Datum"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          />
        </v-col>
        <v-col
          cols="12"
          md="6"
        >
          <div
            class="d-flex"
            style="gap:12px"
          >
            <v-text-field
              v-model="editForm.startHM"
              type="time"
              label="Začátek"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
            <v-text-field
              v-model="editForm.endHM"
              type="time"
              label="Konec"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
          </div>
        </v-col>

        <v-col
          cols="12"
          md="6"
        >
          <v-text-field
            :model-value="editForm.username ?? '—'"
            label="Člen"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            readonly
          />
        </v-col>
        <v-col cols="12">
          <v-textarea
            v-model="editForm.note"
            label="Poznámka"
            variant="outlined"
            density="comfortable"
            auto-grow
            rows="2"
          />
        </v-col>
      </v-row>
    </EntityEditorDialog>
  </div>
</template>

<style scoped>
.list-filters { display: grid; grid-template-rows: auto auto; row-gap: 8px; }
.filters-row { display: grid; grid-template-columns: 170px 170px 1fr auto; column-gap: 12px; align-items: center; }
.actions { display: flex; align-items: end; }
.search-input { width: 100%; }
.load-btn { height: 40px; min-width: 96px; padding-inline: 12px; }
.filters-row-bottom { display: grid; grid-template-columns: 1fr auto; align-items: end; }
/* DŮLEŽITÉ: vypnout anchoring, aby se při změnách DOM/otvírání dialogu tabulka neposunula */
.table-wrap { max-height: 65vh; overflow: auto; position: relative; overflow-anchor: none; }
.table-sentinel { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 0 16px; color: rgba(0,0,0,.55); }
</style>
