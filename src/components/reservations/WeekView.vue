<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, type ComponentPublicInstance } from 'vue'
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

const props = withDefaults(defineProps<{
  days: Date[]
  cols: number
  tickHeight: number
  viewportHeight: number
  fullTrackHeight: number

  // providers
  dateKey: (d: Date) => string
  itemsForDay: (d: Date) => ResItem[]
  filterItems: (arr: ResItem[]) => ResItem[]

  layoutForDay: Record<string, EventLayout>

  // helpers
  eventBgClass: (i: ResItem) => string
  eventStyle: (i: ResItem, left: number, width: number) => Record<string, string>
  fmtTime: (d: Date) => string
  fmtDetailDate: (d: Date) => string
  fmtDetailTime: (d: Date) => string
  initials: (u: string | null) => string
  deviceColorOf: (deviceId: string) => string
  deviceNameOf: (deviceId: string) => string

  // menu state
  isMenuOpen: (id: number) => boolean
  setMenuOpen: (id: number, v: boolean) => void

  // events
  onTrackClick: (evt: MouseEvent, ctx: { type: 'day'; day: Date }) => void
  onEventPointerDown: (e: PointerEvent, item: ResItem) => void
  onResizePointerDown: (e: PointerEvent, item: ResItem) => void
  onEventClick: (id: number, e: MouseEvent) => void
  openEdit: (i: ResItem) => void
  askDelete: (i: ResItem) => void

  // ref callback
  setViewportRef: (el: HTMLElement | null) => void

  // focus behavior (optional)
  focusEnabled?: boolean
  focusedFr?: number
  othersFr?: number
  transitionMs?: number
}>(), {
  focusEnabled: true,
  focusedFr: 2.6,
  othersFr: 1,
  transitionMs: 220
})

function isWeekend(d: Date) { return [0, 6].includes(d.getDay()) }

/* --- Focused day (expands the whole column incl. events) --- */
const focusedDayKey = ref<string | null>(null)
function keyOf(d: Date) { return props.dateKey(d) }
function isFocused(d: Date) { return props.focusEnabled && (focusedDayKey.value === keyOf(d)) }
function focusDay(d: Date) { if (props.focusEnabled) focusedDayKey.value = keyOf(d) }
function clearFocus() { focusedDayKey.value = null }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function onDayHeaderClick(d: Date, _ev?: MouseEvent) {
  focusDay(d)
  if (viewportEl.value) {
    try {
      viewportEl.value.focus({ preventScroll: true } as FocusOptions)
    } catch {
      viewportEl.value.focus()
    }
  }
}

function onTrackClickWithFocus(e: MouseEvent, day: Date) {
  focusDay(day)
  props.onTrackClick(e, { type: 'day', day })
}

function onKeydown(e: KeyboardEvent) {
  if (!props.focusEnabled) return
  const key = e.key.toLowerCase()
  const days = props.days
  if (!days.length) return

  if (key === 'escape') { clearFocus(); return }

  if (key === 'arrowleft' || key === 'arrowright') {
    e.preventDefault()
    const currentIdx = focusedDayKey.value
      ? days.findIndex(d => keyOf(d) === focusedDayKey.value)
      : -1
    const nextIdx = key === 'arrowleft'
      ? (currentIdx <= 0 ? 0 : currentIdx - 1)
      : (currentIdx < 0 ? 0 : Math.min(currentIdx + 1, days.length - 1))
    focusDay(days[nextIdx])
  }
}

/* Grid template that widens the focused day column */
const gridTemplateColumns = computed(() => {
  if (!props.focusEnabled) {
    return `80px repeat(${props.cols}, 1fr)`
  }
  const dayCols = props.days.map(d =>
    isFocused(d)
      ? `minmax(0, ${props.focusedFr}fr)`
      : `minmax(0, ${props.othersFr}fr)`
  ).join(' ')
  return `80px ${dayCols}`
})

/* --- One-time auto-scroll to 07:00 and stable scroll on tick changes --- */
const viewportEl = ref<HTMLElement | null>(null)
const INIT_FLAG_KEY = 'lims:cal:initScroll:WeekView'
const LAST_SCROLL_KEY = 'lims:cal:lastScroll:WeekView'
const initDone = ref<boolean>(false)
let rafSetScroll: number | null = null
let rafPersistScroll: number | null = null

function setScrollTop(px: number) {
  if (rafSetScroll) cancelAnimationFrame(rafSetScroll)
  rafSetScroll = requestAnimationFrame(() => {
    if (viewportEl.value != null) {
      viewportEl.value.scrollTop = px
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
  if (initDone.value) {
    requestAnimationFrame(restoreLastScrollOrDefault)
  } else {
    requestAnimationFrame(() => scrollToHourOnce(7))
  }
})

watch(() => props.tickHeight, (nh, oh) => {
  if (!viewportEl.value || !oh || oh <= 0) return
  const current = viewportEl.value.scrollTop
  const next = current * (nh / oh)
  setScrollTop(next)
})

onBeforeUnmount(() => {
  if (rafSetScroll) cancelAnimationFrame(rafSetScroll)
  if (rafPersistScroll) cancelAnimationFrame(rafPersistScroll)
  if (viewportEl.value) viewportEl.value.removeEventListener('scroll', onViewportScroll)
})

/* Fix TS for function ref: adapt to Vue's VNodeRef signature and wire scroll persistence */
function hasEl(o: unknown): o is { $el: unknown } {
  return typeof o === 'object' && o !== null && '$el' in o
}
function viewportRefHandler(el: Element | ComponentPublicInstance | null) {
  const dom: HTMLElement | null =
    el instanceof HTMLElement
      ? el
      : (hasEl(el) && el.$el instanceof HTMLElement ? (el.$el as HTMLElement) : null)

  // If same element, don't re-attach or re-scroll (prevents glitch on re-render)
  if (dom === viewportEl.value) return

  // detach old
  if (viewportEl.value) viewportEl.value.removeEventListener('scroll', onViewportScroll)

  viewportEl.value = dom
  props.setViewportRef(dom)

  if (dom) {
    dom.addEventListener('scroll', onViewportScroll, { passive: true })
    if (initDone.value) {
      requestAnimationFrame(restoreLastScrollOrDefault)
    } else {
      requestAnimationFrame(() => scrollToHourOnce(7))
    }
  }
}

/* --- Fallback sizing based on height (kept for older browsers) --- */
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

/* --- Consistent device-colored event background + contrast text (same as DailyMachines) --- */
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
  return lum > 0.5 ? 'black' : 'white'
}
function deviceEventStyle(deviceId: string): { backgroundColor: string; color: string } {
  const bg = props.deviceColorOf(deviceId)
  const fg = contrastText(bg)
  return { backgroundColor: bg, color: fg }
}
</script>

<template>
  <div class="schedule">
    <!-- Header -->
    <div
      class="tracks row header"
      :style="{
        gridTemplateColumns: gridTemplateColumns,
        transition: `grid-template-columns ${props.transitionMs}ms ease`
      }"
    >
      <div class="time-col" />
      <div
        v-for="d in props.days"
        :key="d.toISOString()"
        class="track-name"
        :class="{ weekend: isWeekend(d), focused: isFocused(d) }"
        role="button"
        tabindex="0"
        :aria-pressed="isFocused(d)"
        @click="(ev) => onDayHeaderClick(d, ev)"
        @keydown.enter.prevent="onDayHeaderClick(d)"
        @keydown.space.prevent="onDayHeaderClick(d)"
      >
        <div class="weekday">
          {{ new Intl.DateTimeFormat('cs-CZ', { weekday: 'long' }).format(d) }}
        </div>
        <div class="text-caption">
          {{ new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit' }).format(d) }}
        </div>
      </div>
    </div>

    <!-- Scrollable body -->
    <div
      :ref="viewportRefHandler"
      class="scroll-viewport"
      :style="{ height: props.viewportHeight + 'px', overflowAnchor: 'none' }"
      tabindex="0"
      @keydown="onKeydown"
    >
      <div
        class="tracks row body"
        :style="{
          gridTemplateColumns: gridTemplateColumns,
          transition: `grid-template-columns ${props.transitionMs}ms ease`
        }"
      >
        <div class="time-col">
          <div
            v-for="h in 24"
            :key="h"
            class="time-tick"
            :style="{ height: props.tickHeight + 'px' }"
          >
            {{ String(h - 1).padStart(2,'0') }}:00
          </div>
        </div>

        <div
          v-for="day in props.days"
          :key="day.toISOString()"
          class="track"
          :class="{ weekend: isWeekend(day), focused: isFocused(day) }"
          :style="{ height: props.fullTrackHeight + 'px', '--tick-h': props.tickHeight + 'px' }"
          data-track-type="day"
          :data-track-id="props.dateKey(day)"
          @click.self="(e) => onTrackClickWithFocus(e, day)"
        >
          <v-menu
            v-for="i in props.filterItems(props.itemsForDay(day))"
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
                :class="[sizeClass(i)]"
                v-bind="act"
                :style="{
                  ...props.eventStyle(
                    i,
                    (props.layoutForDay[props.dateKey(day)]?.[i.id]?.left ?? 0),
                    (props.layoutForDay[props.dateKey(day)]?.[i.id]?.width ?? 1)
                  ),
                  ...deviceEventStyle(i.deviceId)
                }"
                @pointerdown.stop.prevent="(e: PointerEvent) => props.onEventPointerDown(e, i)"
                @click.stop="(e: MouseEvent) => props.onEventClick(i.id, e)"
              >
                <div class="event-inner" style="position: relative; padding: 6px 30px 6px 8px; height: 100%; display: flex; flex-direction: column; gap: 2px; overflow: hidden;">
                  <!-- Title row with optional series icon -->
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <i 
                      v-if="i.seriesId" 
                      class="mdi-repeat mdi v-icon" 
                      style="font-size: 12px; flex-shrink: 0;"
                      :style="{ color: contrastText(props.deviceColorOf(i.deviceId)) === 'white' ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,0.6)' }"
                    ></i>
                    <div class="event-title" style="font-weight: 600; font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">
                      {{ i.title }}
                    </div>
                  </div>
                  <!-- Device chip -->
                  <div class="event-device" style="overflow: hidden;">
                    <div style="display: flex; flex-wrap: nowrap; gap: 4px; overflow-x: auto; scrollbar-width: none;">
                      <span 
                        style="display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; white-space: nowrap;"
                        :style="{ 
                          background: contrastText(props.deviceColorOf(i.deviceId)) === 'white' ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,0.1)', 
                          border: contrastText(props.deviceColorOf(i.deviceId)) === 'white' ? '1px solid rgba(255,255,255,.3)' : '1px solid rgba(0,0,0,0.15)', 
                          color: contrastText(props.deviceColorOf(i.deviceId)) === 'white' ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,0.75)' 
                        }"
                      >
                        <i class="mdi-flask-outline mdi v-icon" style="font-size: 11px;"></i>
                        {{ props.deviceNameOf(i.deviceId) }}
                      </span>
                    </div>
                  </div>
                  <!-- Time -->
                  <div class="event-time" style="font-size: 10px; opacity: 0.9; white-space: nowrap;">
                    {{ props.fmtTime(new Date(i.start)) }} – {{ props.fmtTime(new Date(i.end)) }}
                  </div>
                  <!-- Avatar at bottom-right -->
                  <div 
                    class="bg-white event-avatar" 
                    style="position: absolute; bottom: 4px; right: 4px; width: 22px; height: 22px; font-size: 10px; font-weight: 600; display: flex; align-items: center; justify-content: center; border-radius: 50%;"
                    :style="{ color: props.deviceColorOf(i.deviceId) }"
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

            <!-- Reusable Event Detail component -->
            <template #default="{ isActive }">
              <EventDetailCard
                :item="i"
                :color="props.deviceColorOf(i.deviceId)"
                :device-name="props.deviceNameOf(i.deviceId)"
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
</template>

<style scoped>
/* schedule + events (lokální pro týdenní view) */
.schedule { border-radius: 12px; overflow: hidden; }

/* Header/body grids */
.tracks.row.header { display: grid; gap: 0; border-bottom: 1px solid #e5e5e5; margin-right: 12px; }
.tracks.row.body   { display: grid; }

/* DŮLEŽITÉ: vypnutí scroll anchoringu, aby se viewport nehýbal při změnách DOM uvnitř */
.scroll-viewport { overflow-y: scroll; scrollbar-gutter: stable; outline: none; overflow-anchor: none; }

.time-col { background: #fafafa; border-right: 1px solid #e5e5e5; }
.time-tick { padding: 4px 8px; font-size: 12px; color: #777; border-bottom: 1px dashed #eee; }
.track-name { padding: 12px 8px; text-align: center; border-left: 1px solid #f1f1f1; cursor: pointer; user-select: none; }
.track-name .weekday { text-transform: uppercase; font-weight: 700; letter-spacing: .02em; }
.track-name.weekend { background: #fafaff; }
.track-name.focused {
  background: color-mix(in srgb, var(--v-theme-primary) 16%, #ffffff);
  box-shadow: inset 0 -3px 0 0 var(--v-theme-primary);
  border-left-color: color-mix(in srgb, var(--v-theme-primary) 30%, #f1f1f1);
}

.track {
  position: relative;
  border-left: 1px solid #f1f1f1;
  overflow: hidden;
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
.track.focused {
  z-index: 2;
  outline: 2px solid color-mix(in srgb, var(--v-theme-primary) 65%, transparent);
  outline-offset: -1px;
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
.event-device { font-size: 13px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; font-weight: 500; }
.event-time { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Avatar always white, text inherits event contrast color */
.event-avatar { position: absolute; right: 4px; top: 4px; background: #ffffff !important; color: inherit; font-size: 16px; line-height: 16px; text-transform: uppercase; border: 2px solid rgba(0,0,0,0.08); }

.event-note-icon { position: absolute; right: 6px; bottom: 6px; color: rgba(0,0,0,.60); pointer-events: none; opacity: .85; }
.event-note-icon:hover { opacity: 1; }
.event-repeat-icon { position: absolute; right: 26px; bottom: 6px; color: rgba(0,0,0,.60); pointer-events: none; opacity: .85; }

/* Fallback height-based classes */
.event.event--xs .event-inner { padding: 0; }
.event.event--xs .event-title,
.event.event--xs .event-time,
.event.event--xs .event-note-icon,
.event.event--xs .event-avatar { display: none !important; }

.event.event--sm .event-inner { padding: 4px 8px; }
.event.event--sm .event-time,
.event.event--sm .event-note-icon,
.event.event--sm .event-avatar { /* kept empty for override */ opacity: 1; }
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

.scroll-viewport { overflow-y: scroll; scrollbar-gutter: stable; outline: none; overflow-anchor: none; }
/* Detail card */
.detail-card { background: #eceff1; border-radius: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }

.text-ellipsis { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Default values for CSS vars to silence analyzers and provide fallbacks */
:root { --tick-h: 80px; }
</style>

<style>
@import '@/styles/event-compact.css';
</style>
