<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, type ComponentPublicInstance} from 'vue'
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
  seriesId?: string | null
}
type EventLayout = Record<number, { left: number; width: number }>
type Device = { id: string; name: string; color: string; active?: boolean }
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
  onResizePointerDown: (e: PointerEvent, item: ResItem) => void
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
//const focusedFr = computed(() => props.focusedFr ?? 2.6)
//const othersFr = computed(() => props.othersFr ?? 1)
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

  // If same element, don't re-attach or re-scroll (prevents glitch on re-render)
  if (dom === viewportEl.value) return

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
function onDeviceHeaderClick(d: Device, _ev?: MouseEvent) {
  focusDevice(d)
  if (viewportEl.value) {
    try {
      viewportEl.value.focus({ preventScroll: true } as FocusOptions)
    } catch {
      viewportEl.value.focus()
    }
  }
}
function onTrackClickWithFocus(e: MouseEvent, d: Device) {
  if (d.active === false) return
  focusDevice(d)
  props.onTrackClick(e, { type: 'device', deviceId: d.id })
}
/* Grid columns - equal width for all devices */
const gridTemplateColumns = computed(() => {
  return `80px repeat(${props.devices?.length ?? 0}, 1fr)`
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
/* Filter logic removed */
/* --------- event coloring based on device color, avatar white ---------- */
// Parse hex/rgb and compute contrast (WCAG-like approximation)
function parseColorToRGB(color: string): { r: number; g: number; b: number } {
  const c = color.trim()
  if (c.startsWith('#')) {
    const hex = c.slice(1)
    const full = hex.length === 3 ? hex.split('').map(h => h + h).join('') : hex
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return { r, g, b }
  }
  const m = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i)
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }
  // fallback primary-ish
  return { r: 30, g: 136, b: 229 }
}
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const srgb = [r, g, b].map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}
function contrastText(color: string): 'black' | 'white' {
  const lum = luminance(parseColorToRGB(color))
  // threshold ~ 0.5 tuned for UI readability
  return lum > 0.5 ? 'black' : 'white'
}
// Build style for event background + text color from device color
function deviceEventStyle(deviceId: string): { backgroundColor: string; color: string } {
  const bg = props.deviceColorOf(deviceId)
  const fg = contrastText(bg)
  return { backgroundColor: bg, color: fg }
}
</script>
<template>
  <div ref="root">
    <!-- Filters removed per user request -->

    <!-- Legend chips -->
    <!--

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
          size="small"
          variant="flat"
          class="mr-2"
          :style="{ color: contrastText(d.color) }"
        >
          {{ d.id }}
        </v-chip>
        <span class="text-caption">{{ d.name }}</span>
      </div>
    </div>

    -->
    <!-- Full calendar schedule -->
    <div
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
          :title="d.active === false ? d.name + ' (Deaktivovaný – provoz dočasně pozastaven)' : d.name"
          @click="(ev) => onDeviceHeaderClick(d, ev)"
          @keydown.enter.prevent="onDeviceHeaderClick(d)"
          @keydown.space.prevent="onDeviceHeaderClick(d)"
        >
          <div :style="{ opacity: d.active === false ? 0.6 : 1, display: 'flex', alignItems: 'center' }">
            <v-chip
              :color="d.color"
              size="small"
              variant="flat"
              :style="{ color: contrastText(d.color) }"
            >
              {{ d.id }}
            </v-chip>
            <v-icon
              v-if="d.active === false"
              size="14"
              color="grey-darken-1"
              class="ml-1"
              title="Deaktivovaný"
            >
              mdi-cancel
            </v-icon>
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
            :class="{ focused: isFocused(d), 'cursor-not-allowed': d.active === false }"
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
                  :style="{
                    ...props.eventStyle(
                      i,
                      (props.layoutForDevice[d.id]?.[i.id]?.left ?? 0),
                      (props.layoutForDevice[d.id]?.[i.id]?.width ?? 1)
                    ),
                    ...deviceEventStyle(d.id)
                  }"
                  @pointerdown.stop.prevent="(e: PointerEvent) => props.onEventPointerDown(e, i)"
                  @click.stop="(e: MouseEvent) => props.onEventClick(i.id, e)"
                >
                  <div
                    class="event-inner"
                    style="position: relative; padding: 6px 30px 6px 8px; height: 100%; display: flex; flex-direction: column; gap: 2px; overflow: hidden;"
                  >
                    <!-- Title row with optional series icon -->
                    <div style="display: flex; align-items: center; gap: 4px;">
                      <i
                        v-if="i.seriesId"
                        class="mdi-repeat mdi v-icon"
                        style="font-size: 12px; flex-shrink: 0;"
                        :style="{ color: contrastText(props.deviceColorOf(d.id)) === 'white' ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,0.6)' }"
                      />
                      <div
                        class="event-title"
                        style="font-weight: 600; font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;"
                      >
                        {{ i.title }}
                      </div>
                    </div>
                    <!-- Device name chip -->
                    <div
                      class="event-device-chip"
                      style="display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; max-width: fit-content;"
                      :style="{
                        background: contrastText(props.deviceColorOf(d.id)) === 'white' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
                        color: contrastText(props.deviceColorOf(d.id)) === 'white' ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.7)'
                      }"
                    >
                      <i
                        class="mdi mdi-flask"
                        style="font-size: 10px;"
                      />
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ d.name }}</span>
                    </div>
                    <!-- Time -->
                    <div
                      class="event-time"
                      style="font-size: 10px; opacity: 0.9; white-space: nowrap;"
                    >
                      {{ props.fmtTime(new Date(i.start)) }} – {{ props.fmtTime(new Date(i.end)) }}
                    </div>
                    <!-- Avatar at bottom-right -->
                    <div
                      class="bg-white event-avatar"
                      style="position: absolute; bottom: 4px; right: 4px; width: 22px; height: 22px; font-size: 10px; font-weight: 600; display: flex; align-items: center; justify-content: center; border-radius: 50%;"
                      :style="{ color: props.deviceColorOf(d.id) }"
                    >
                      <span>{{ props.initials(i.username) }}</span>
                    </div>
                  </div>
                  <!-- Resize handle at bottom of event -->
                  <div
                    class="resize-handle"
                    @pointerdown.stop="(e: PointerEvent) => props.onResizePointerDown(e, i)"
                  />
                </div>
              </template>
              <!-- Default slot to get isActive for reliable close -->
              <template #default="{ isActive }">
                <EventDetailCard
                  :item="i"
                  :color="d.color"
                  :device-name="d.name"
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
.scroll-viewport { overflow-y: auto; outline: none; overflow-anchor: none; }
.time-col { background: #fafafa; border-right: 1px solid #e5e5e5; box-sizing: border-box; }
.time-tick { padding: 4px 8px; font-size: 12px; color: #777; border-bottom: 1px dashed #eee; }
.track-name {
  padding: 12px 8px;
  text-align: center;
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.track-name:not(:first-of-type) {
  border-left: 1px solid #f1f1f1;
}
.track-name .weekday { text-transform: uppercase; font-weight: 700; letter-spacing: .02em; }
/* Focused header styling */
.track-name.focused {
  background: color-mix(in srgb, var(--v-theme-primary) 16%, #ffffff);
  box-shadow: inset 0 -3px 0 0 var(--v-theme-primary);
}
.track {
  position: relative;
  box-sizing: border-box;
  background:
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0.02) 0,
      rgba(0,0,0,0.02) calc(var(--tick-h) / 2),
      transparent calc(var(--tick-h) / 2),
      transparent var(--tick-h)
    );
}
.track:not(:first-of-type) {
  border-left: 1px solid #f1f1f1;
}
.track.focused {
  z-index: 2;
  outline: 2px solid color-mix(in srgb, var(--v-theme-primary) 65%, transparent);
  outline-offset: -1px;
}
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
.event-inner { padding: 8px 10px 20px 10px; position: relative; height: 100%; }
.event-title { font-weight: 600; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; text-overflow: ellipsis; white-space: nowrap; }
.event-time { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.event-avatar { position: absolute; right: 4px; top: 4px; background: #ffffff !important; color: inherit; font-size: 16px; line-height: 16px; text-transform: uppercase; border: 2px solid rgba(0,0,0,0.08); }
.event-note-icon { position: absolute; right: 6px; bottom: 6px; color: rgba(0,0,0,.60); pointer-events: none; opacity: .85; }
.event-note-icon:hover { opacity: 1; }
.event-repeat-icon { position: absolute; right: 26px; bottom: 6px; color: rgba(0,0,0,.60); pointer-events: none; opacity: .85; }
.event.event--xs .event-inner { padding: 0; }
.event.event--xs .event-title,
.event.event--xs .event-time,
.event.event--xs .event-note-icon,
.event.event--xs .event-avatar { display: none !important; }
.event.event--sm .event-inner { padding: 4px 8px; }
.event.event--sm .event-time,
.event.event--sm .event-note-icon,
.event.event--sm .event-avatar { /* kept empty for override inheritance */ opacity: 1; }
.event.event--sm .event-title { font-size: 12px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; -webkit-line-clamp: 1; line-clamp: 1; }
.event.event--md .event-inner { padding: 6px 8px 10px 8px; }
.event.event--md .event-avatar { display: none; }
.event.event--md .event-title { -webkit-line-clamp: 1; line-clamp: 1; }
.event.event--md .event-time { font-size: 12px; }
/* Resize handle */
.resize-handle {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 8px;
  cursor: ns-resize;
  background: transparent;
  z-index: 2;
}
.resize-handle:hover {
  background: rgba(0,0,0,0.1);
}
/* Detail card */
.detail-card { background: #eceff1; border-radius: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
.text-ellipsis { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Compact filters styling */
/* Compact filters styling removed */
.scroll-viewport { overflow-y: auto; outline: none; overflow-anchor: none; }
/* Default values for CSS vars to silence analyzers and provide fallbacks */
:root { --tick-h: 80px; }
</style>
