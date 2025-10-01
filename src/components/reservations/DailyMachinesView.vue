<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, type ComponentPublicInstance, type Ref } from 'vue'
import EventDetailCard from '@/components/reservations/EventDetailCard.vue'

type ResItem = {
  id: number
  title: string
  deviceId: string
  start: string
  end: string
  status: 'plan' | 'running' | 'done'
  username: string | null
  note: string | null
}
type EventLayout = Record<number, { left: number; width: number }>
type Device = { id: string; name: string; color: string }

const props = defineProps<{
  devices: Device[]
  cols: number
  dayHours: number
  tickHeight: number
  viewportHeight: number
  fullTrackHeight: number

  // data providers
  getItemsForDevice: (deviceId: string) => ResItem[]
  layoutForDevice: Record<string, EventLayout>

  // helpers from parent
  deviceHeaderStyle: (d: Device) => Record<string, string>
  eventBgClass: (i: ResItem) => string
  eventStyle: (i: ResItem, left: number, width: number) => Record<string, string>
  fmtTime: (d: Date) => string
  fmtDetailDate: (d: Date) => string
  fmtDetailTime: (d: Date) => string
  initials: (u: string | null) => string
  deviceColorOf: (deviceId: string) => string

  // menu open mapping
  isMenuOpen: (id: number) => boolean
  setMenuOpen: (id: number, v: boolean) => void

  // interactions (delegated to parent)
  onTrackClick: (evt: MouseEvent, ctx: { type: 'device'; deviceId: string }) => void
  onEventPointerDown: (e: PointerEvent, item: ResItem) => void
  onEventClick: (id: number, e: MouseEvent) => void
  openEdit: (i: ResItem) => void
  askDelete: (i: ResItem) => void

  // ref callback – parent si uloží vnitřní scroll element
  setViewportRef: (el: HTMLElement | null) => void

  // optional responsive cutoff for calendar visibility in this view
  minCalendarWidth?: number

  // Focus/expand behavior (optional – same API as WeekView)
  focusEnabled?: boolean
  focusedFr?: number
  othersFr?: number
  transitionMs?: number
}>()

/* --------- Focused device column (M1, M2…) --------- */
const focusEnabled = computed(() => props.focusEnabled ?? true)
const focusedFr = computed(() => props.focusedFr ?? 2.6)
const othersFr = computed(() => props.othersFr ?? 1)
const transitionMs = computed(() => props.transitionMs ?? 220)

const focusedDeviceKey = ref<string | null>(null)
function keyOf(d: Device) { return d.id }
function isFocused(d: Device) { return focusEnabled.value && focusedDeviceKey.value === keyOf(d) }
function focusDevice(d: Device) { if (focusEnabled.value) focusedDeviceKey.value = keyOf(d) }
function clearFocus() { focusedDeviceKey.value = null }

/* --------- One-time auto-scroll to 07:00 and stable scroll on tick changes --------- */
const viewportEl = ref<HTMLElement | null>(null)
const INIT_FLAG_KEY = 'lims:cal:initScroll:DailyMachinesView'
const LAST_SCROLL_KEY = 'lims:cal:lastScroll:DailyMachinesView'
const initDone = ref<boolean>(false)
let rafSetScroll: number | null = null
let rafPersistScroll: number | null = null

function setScrollTop(px: number) {
  if (rafSetScroll) cancelAnimationFrame(rafSetScroll)
  rafSetScroll = requestAnimationFrame(() => {
    if (viewportEl.value != null) {
      viewportEl.value.scrollTop = px
      // persist last scroll to keep position across re-mounts in the same session
      sessionStorage.setItem(LAST_SCROLL_KEY, String(Math.max(0, Math.floor(px))))
    }
  })
}

function restoreLastScrollOrDefault() {
  const saved = sessionStorage.getItem(LAST_SCROLL_KEY)
  if (saved != null && !Number.isNaN(Number(saved))) {
    setScrollTop(Number(saved))
  }
}

function scrollToHourOnce(h = 7) {
  if (initDone.value || !viewportEl.value) return
  const target = h * props.tickHeight
  setScrollTop(target)
  initDone.value = true
  sessionStorage.setItem(INIT_FLAG_KEY, '1')
}

function onViewportScroll() {
  if (rafPersistScroll) cancelAnimationFrame(rafPersistScroll)
  rafPersistScroll = requestAnimationFrame(() => {
    if (!viewportEl.value) return
    sessionStorage.setItem(LAST_SCROLL_KEY, String(Math.max(0, Math.floor(viewportEl.value.scrollTop))))
  })
}

onMounted(() => {
  initDone.value = sessionStorage.getItem(INIT_FLAG_KEY) === '1'
  // If we already did the initial scroll in this session, restore last position (no jump to 7)
  if (initDone.value) {
    requestAnimationFrame(restoreLastScrollOrDefault)
  } else {
    requestAnimationFrame(() => scrollToHourOnce(7))
  }
})

watch(() => props.tickHeight, (nh, oh) => {
  if (!viewportEl.value || !oh || oh <= 0) return
  // preserve relative position (simple ratio)
  const current = viewportEl.value.scrollTop
  const next = current * (nh / oh)
  setScrollTop(next)
})

onBeforeUnmount(() => {
  if (rafSetScroll) cancelAnimationFrame(rafSetScroll)
  if (rafPersistScroll) cancelAnimationFrame(rafPersistScroll)
  if (viewportEl.value) viewportEl.value.removeEventListener('scroll', onViewportScroll)
})

/* --------- Viewport ref handling (component/element safe) --------- */
// Type guard to avoid `any` when checking for $el
function hasEl(o: unknown): o is { $el: unknown } {
  return typeof o === 'object' && o !== null && '$el' in o
}

// Robustly resolve DOM element for viewport ref (handles component refs too)
function viewportRefHandler(el: Element | ComponentPublicInstance | null) {
  const dom: HTMLElement | null =
    el instanceof HTMLElement
      ? el
      : (hasEl(el) && el.$el instanceof HTMLElement ? (el.$el as HTMLElement) : null)

  // detach old listener
  if (viewportEl.value) viewportEl.value.removeEventListener('scroll', onViewportScroll)

  viewportEl.value = dom
  props.setViewportRef(dom)

  if (dom) {
    dom.addEventListener('scroll', onViewportScroll, { passive: true })
    if (initDone.value) {
      // Already initialized in this session → restore last scroll, do not jump to 7
      requestAnimationFrame(restoreLastScrollOrDefault)
    } else {
      // First time in this session → one-time scroll to 7:00
      requestAnimationFrame(() => scrollToHourOnce(7))
    }
  }
}

/* Keyboard nav between device columns (Left/Right, Esc) */
function onKeydown(e: KeyboardEvent) {
  if (!focusEnabled.value || !props.devices?.length) return
  const key = e.key.toLowerCase()
  if (key === 'escape') { clearFocus(); return }
  if (key !== 'arrowleft' && key !== 'arrowright') return

  e.preventDefault()
  const list = props.devices
  const currentIdx = focusedDeviceKey.value
    ? list.findIndex(d => keyOf(d) === focusedDeviceKey.value)
    : -1
  const nextIdx = key === 'arrowleft'
    ? (currentIdx <= 0 ? 0 : currentIdx - 1)
    : (currentIdx < 0 ? 0 : Math.min(currentIdx + 1, list.length - 1))
  if (list[nextIdx]) focusDevice(list[nextIdx])
}

function onDeviceHeaderClick(d: Device, ev?: MouseEvent) {
  focusDevice(d)
  ;(ev?.currentTarget as HTMLElement | null)
    ?.closest('.schedule')
    ?.querySelector<HTMLElement>('.scroll-viewport')
    ?.focus()
}

function onTrackClickWithFocus(e: MouseEvent, d: Device) {
  focusDevice(d)
  props.onTrackClick(e, { type: 'device', deviceId: d.id })
}

/* Grid columns with focused expansion */
const gridTemplateColumns = computed(() => {
  if (!focusEnabled.value) {
    return `80px repeat(${props.devices?.length ?? 0}, 1fr)`
  }
  const devCols = (props.devices ?? []).map((d: Device) =>
    isFocused(d)
      ? `minmax(0, ${focusedFr.value}fr)`
      : `minmax(0, ${othersFr.value}fr)`
  ).join(' ')
  return `80px ${devCols}`
})

/* -------- Event height aware rendering (fallback, for tiny heights) -------- */
const MIN_EVENT_PX = 24
const pxPerMin = computed(() => props.tickHeight / 60)
function eventHeightPx(i: ResItem): number {
  const s = new Date(i.start).getTime()
  const e = new Date(i.end).getTime()
  const diffMin = Math.max(0, (e - s) / 60000)
  return Math.max(MIN_EVENT_PX, diffMin * pxPerMin.value)
}
function sizeClass(i: ResItem): string {
  const h = eventHeightPx(i)
  if (h < 36) return 'event--xs'
  if (h < 100) return 'event--sm'
  if (h < 140) return 'event--md'
  return 'event--lg'
}

/* -------- Responsive: hide calendar and show compact filters under width -------- */
const root = ref<HTMLElement | null>(null)
const containerWidth = ref(0)
let ro: ResizeObserver | null = null

onMounted(() => {
  if (root.value) {
    ro = new ResizeObserver((entries) => {
      for (const e of entries) containerWidth.value = e.contentRect.width
    })
    ro.observe(root.value)
  }
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null })

const minWidth = computed(() => props.minCalendarWidth ?? 900)
const showCompactFilters = computed(() => containerWidth.value > 0 && containerWidth.value < minWidth.value)

/* Compact filter state (visual-only) */
const listFrom = ref<string>('')
const listTo = ref<string>('')
const listSearch = ref<string>('')
const includeNotesInSearch = ref(true)

function startOfDayMs(ymd: string): number { const [y,m,d] = ymd.split('-').map(Number); return new Date(y||1970,(m||1)-1,d||1,0,0,0,0).getTime() }
function endOfDayMs(ymd: string): number { const [y,m,d] = ymd.split('-').map(Number); return new Date(y||1970,(m||1)-1,d||1,23,59,59,999).getTime() }
const listRangeDays = computed(() => {
  if (!listFrom.value || !listTo.value) return 0
  const diff = endOfDayMs(listTo.value) - startOfDayMs(listFrom.value)
  return diff >= 0 ? (diff / 86400000) + 1 : 0
})

watch(showCompactFilters, (v) => {
  if (v && !listFrom.value && !listTo.value) {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2,'0')
    const d = String(now.getDate()).padStart(2,'0')
    const ymd = `${y}-${m}-${d}`
    listFrom.value = ymd
    listTo.value = ymd
  }
})

/* Helpers: reliable programmatic close of the detail menu */
function closeDetailMenu(id: number, isActive?: Ref<boolean>) {
  if (isActive) isActive.value = false
  props.setMenuOpen(id, false)
}
function onCloseMouseDown(id: number, isActive?: Ref<boolean>, ev?: MouseEvent) {
  ev?.stopPropagation()
  ev?.preventDefault()
  closeDetailMenu(id, isActive)
}
</script>

<template>
  <div ref="root">
    <!-- Compact filters (narrow widths) -->
    <v-sheet
      v-if="showCompactFilters"
      elevation="1"
      class="pa-3 mb-4 dmv-list-filters"
      color="grey-lighten-5"
    >
      <div class="dmv-filters-row">
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
          v-model="listSearch"
          clearable
          label="Hledat"
          variant="outlined"
          density="comfortable"
          class="dmv-search-input"
          hide-details
        />
        <div class="dmv-actions d-flex ga-2">
          <v-btn
            color="primary"
            class="dmv-load-btn"
            title="Načíst"
            disabled
          >
            NAČÍST
          </v-btn>
          <v-btn
            class="dmv-load-btn"
            variant="text"
            title="Načíst všechny"
            disabled
          >
            NAČÍST VŠE
          </v-btn>
        </div>
      </div>

      <div class="dmv-filters-row-bottom">
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
          <span v-if="listRangeDays > 0">Rozsah: {{ Math.round(listRangeDays) }} dní</span>
        </div>
      </div>

      <v-alert
        type="info"
        density="comfortable"
        class="mt-3"
        border="start"
      >
        Pro detailní práci se seznamem rezervací přepněte zobrazení na "Rezervace (seznam)".
      </v-alert>
    </v-sheet>

    <!-- Legend chips -->
    <div
      v-if="!showCompactFilters"
      class="d-flex flex-wrap mb-3"
    >
      <div
        v-for="d in props.devices"
        :key="d.id"
        class="d-flex align-center mr-4 mb-1"
      >
        <v-chip
          :color="d.color"
          size="x-small"
          class="mr-2"
        />
        <span class="text-caption">{{ d.name }}</span>
      </div>
    </div>

    <!-- Full calendar schedule -->
    <div
      v-if="!showCompactFilters"
      class="schedule"
    >
      <div
        class="tracks row header"
        :style="{ gridTemplateColumns: gridTemplateColumns, transition: `grid-template-columns ${transitionMs}ms ease` }"
      >
        <div class="time-col" />
        <div
          v-for="d in props.devices"
          :key="d.id"
          class="track-name"
          :class="{ focused: isFocused(d) }"
          :style="props.deviceHeaderStyle(d)"
          role="button"
          tabindex="0"
          :aria-pressed="isFocused(d)"
          @click="(ev) => onDeviceHeaderClick(d, ev)"
          @keydown.enter.prevent="onDeviceHeaderClick(d)"
          @keydown.space.prevent="onDeviceHeaderClick(d)"
        >
          <div class="weekday">
            {{ d.name }}
          </div>
        </div>
      </div>

      <div
        :ref="viewportRefHandler"
        class="scroll-viewport"
        :style="{ height: props.viewportHeight + 'px', overflowAnchor: 'none' }"
        tabindex="0"
        @keydown="onKeydown"
      >
        <div
          class="tracks row body"
          :style="{ gridTemplateColumns: gridTemplateColumns, transition: `grid-template-columns ${transitionMs}ms ease` }"
        >
          <div class="time-col">
            <div
              v-for="h in props.dayHours"
              :key="h"
              class="time-tick"
              :style="{ height: props.tickHeight + 'px' }"
            >
              {{ String(h - 1).padStart(2,'0') }}:00
            </div>
          </div>

          <div
            v-for="d in props.devices"
            :key="d.id"
            class="track"
            :class="{ focused: isFocused(d) }"
            :style="{ height: props.fullTrackHeight + 'px', '--tick-h': props.tickHeight + 'px' }"
            data-track-type="device"
            :data-track-id="d.id"
            @click.self="(e) => onTrackClickWithFocus(e, d)"
          >
            <v-menu
              v-for="i in props.getItemsForDevice(d.id)"
              :key="i.id"
              :model-value="props.isMenuOpen(i.id)"
              location="bottom start"
              offset="10"
              max-width="520"
              :close-on-content-click="false"
              transition="fade-transition"
              :open-on-click="false"
              @update:model-value="val => props.setMenuOpen(i.id, val)"
            >
              <template #activator="{ props: act }">
                <div
                  class="event"
                  :class="[props.eventBgClass(i), sizeClass(i)]"
                  v-bind="act"
                  :style="props.eventStyle(
                    i,
                    (props.layoutForDevice[d.id]?.[i.id]?.left ?? 0),
                    (props.layoutForDevice[d.id]?.[i.id]?.width ?? 1)
                  )"
                  @pointerdown.stop.prevent="(e: PointerEvent) => props.onEventPointerDown(e, i)"
                  @click.stop="(e: MouseEvent) => props.onEventClick(i.id, e)"
                >
                  <div class="event-inner">
                    <v-icon
                      v-if="i.note && i.note.trim().length"
                      size="16"
                      class="event-note-icon"
                      icon="mdi-text"
                    />
                    <div class="event-title">
                      {{ i.title }}
                    </div>
                    <div class="event-time">
                      {{ props.fmtTime(new Date(i.start)) }} – {{ props.fmtTime(new Date(i.end)) }}
                    </div>
                    <v-avatar
                      :color="d.color"
                      size="28"
                      class="event-avatar"
                    >
                      <span>{{ props.initials(i.username) }}</span>
                    </v-avatar>
                  </div>
                </div>
              </template>

              <!-- Default slot to get isActive for reliable close -->
              <template #default="{ isActive }">
                <EventDetailCard
                  :item="i"
                  :color="d.color"
                  :fmt-detail-date="props.fmtDetailDate"
                  :fmt-detail-time="props.fmtDetailTime"
                  :on-edit="props.openEdit"
                  :on-delete="props.askDelete"
                  :on-close="() => { isActive.value = false; props.setMenuOpen(i.id, false) }"
                />
              </template>
            </v-menu>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* schedule + events (lokální pro tento view) */
.schedule { border-radius: 12px; overflow: hidden; }

/* grid without unresolved CSS custom properties; columns set inline from template */
.tracks.row.header { display: grid; gap: 0; border-bottom: 1px solid #e5e5e5; }
.tracks.row.body   { display: grid; }

/* DŮLEŽITÉ: vypnutí scroll anchoringu, aby se viewport nehýbal při změnách DOM uvnitř */
.scroll-viewport { overflow-y: auto; outline: none; overflow-anchor: none; }

.time-col { background: #fafafa; border-right: 1px solid #e5e5e5; }
.time-tick { padding: 4px 8px; font-size: 12px; color: #777; border-bottom: 1px dashed #eee; }
.track-name { padding: 12px 8px; text-align: center; border-left: 1px solid #f1f1f1; cursor: pointer; user-select: none; }
.track-name .weekday { text-transform: uppercase; font-weight: 700; letter-spacing: .02em; }
/* Focused header styling */
.track-name.focused {
  background: color-mix(in srgb, var(--v-theme-primary) 16%, #ffffff);
  box-shadow: inset 0 -3px 0 0 var(--v-theme-primary);
  border-left-color: color-mix(in srgb, var(--v-theme-primary) 30%, #f1f1f1);
}

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
/* Focused column outline and subtle background */
.track.focused {
  z-index: 2;
  outline: 2px solid color-mix(in srgb, var(--v-theme-primary) 65%, transparent);
  outline-offset: -1px;
  background:
    linear-gradient(to bottom, color-mix(in srgb, var(--v-theme-primary) 10%, #ffffff), transparent),
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0.02) 0,
      rgba(0,0,0,0.02) calc(var(--tick-h) / 2),
      transparent calc(var(--tick-h) / 2),
      transparent var(--tick-h)
    );
}

/* Event container uses inline-size container queries */
.event {
  position: absolute;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  cursor: grab;
  user-select: none;
  overflow: hidden;
  container-type: inline-size;
}
.event:active { cursor: grabbing; }

/* Wrapper for padding (CQ adjusts this) */
.event-inner { padding: 8px 10px 20px 10px; position: relative; height: 100%; }

/* base typography with truncation */
.event-title { font-weight: 600; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; text-overflow: ellipsis; white-space: nowrap; }
.event-time { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.event-avatar { position: absolute; right: 4px; top: 4px; background: #f2f2f2; font-size: 16px; line-height: 16px; text-transform: uppercase; border: 2px solid var(--v-theme-primary); }
.event-note-icon { position: absolute; right: 6px; bottom: 6px; color: rgba(0,0,0,.60); pointer-events: none; opacity: .85; }
.event-note-icon:hover { opacity: 1; }

/* Fallback height-based classes */
.event.event--xs .event-inner { padding: 0; }
.event.event--xs .event-title,
.event.event--xs .event-time,
.event.event--xs .event-note-icon,
.event.event--xs .event-avatar { display: none !important; }

.event.event--sm .event-inner { padding: 4px 8px; }
.event.event--sm .event-time,
.event.event--sm .event-note-icon,
.event.event--sm .event-avatar {}
.event.event--sm .event-title { font-size: 12px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; -webkit-line-clamp: 1; }

.event.event--md .event-inner { padding: 6px 8px 10px 8px; }
.event.event--md .event-avatar { display: none; }
.event.event--md .event-title { -webkit-line-clamp: 1; }
.event.event--md .event-time { font-size: 12px; }

/* Detail card */
.detail-card { background: #eceff1; border-radius: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }

.text-ellipsis { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Compact filters styling */
.dmv-list-filters { display: grid; grid-template-rows: auto auto; row-gap: 8px; }
.dmv-filters-row { display: grid; grid-template-columns: 170px 170px 1fr auto; column-gap: 12px; align-items: center; }
.dmv-actions { display: flex; align-items: end; }
.dmv-search-input { width: 100%; }
.dmv-load-btn { height: 40px; min-width: 96px; padding-inline: 12px; }
.dmv-filters-row-bottom { display: grid; grid-template-columns: 1fr auto; align-items: end; }

/* Default values for CSS vars to silence analyzers and provide fallbacks */
:root { --tick-h: 80px; }
</style>

<style>
@import '@/styles/event-compact.css';
</style>
