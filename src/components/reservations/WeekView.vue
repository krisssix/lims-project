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

  // menu state
  isMenuOpen: (id: number) => boolean
  setMenuOpen: (id: number, v: boolean) => void

  // events
  onTrackClick: (evt: MouseEvent, ctx: { type: 'day'; day: Date }) => void
  onEventPointerDown: (e: PointerEvent, item: ResItem) => void
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

function onDayHeaderClick(d: Date, ev?: MouseEvent) {
  focusDay(d)
  ;(ev?.currentTarget as HTMLElement | null)?.closest('.schedule')?.querySelector<HTMLElement>('.scroll-viewport')?.focus()
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
                :class="[props.eventBgClass(i), sizeClass(i)]"
                v-bind="act"
                :style="props.eventStyle(
                  i,
                  (props.layoutForDay[props.dateKey(day)]?.[i.id]?.left ?? 0),
                  (props.layoutForDay[props.dateKey(day)]?.[i.id]?.width ?? 1)
                )"
                @pointerdown.stop.prevent="(e: PointerEvent) => props.onEventPointerDown(e, i)"
                @click.stop="(e: MouseEvent) => props.onEventClick(i.id, e)"
              >
                <div class="event-inner">
                  <v-icon
                    v-if="i.note && i.note.trim().length"
                    size="16"
                    class="event-note-icon"
                  >
                    mdi-text
                  </v-icon>
                  <div class="event-title">
                    {{ i.title }}
                  </div>
                  <div class="event-time">
                    {{ props.fmtTime(new Date(i.start)) }} – {{ props.fmtTime(new Date(i.end)) }}
                  </div>
                  <v-avatar
                    size="28"
                    class="event-avatar"
                    :color="props.deviceColorOf(i.deviceId)"
                    :style="{ borderColor: `var(--v-theme-${props.deviceColorOf(i.deviceId)})` }"
                  >
                    <span>{{ props.initials(i.username) }}</span>
                  </v-avatar>
                </div>
              </div>
            </template>

            <!-- Reusable Event Detail component -->
            <template #default="{ isActive }">
              <EventDetailCard
                :item="i"
                :color="props.deviceColorOf(i.deviceId)"
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
.tracks.row.header { display: grid; gap: 0; border-bottom: 1px solid #e5e5e5; }
.tracks.row.body   { display: grid; }

/* DŮLEŽITÉ: vypnutí scroll anchoringu, aby se viewport nehýbal při změnách DOM uvnitř */
.scroll-viewport { overflow-y: auto; outline: none; overflow-anchor: none; }

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

/* Default values for CSS vars to silence analyzers and provide fallbacks */
:root { --tick-h: 80px; }
</style>

<style>
@import '@/styles/event-compact.css';
</style>
