<script setup lang="ts">
import { ref, computed } from 'vue'
import Dialog from '@/components/Dialog.vue'

/** --- helpers: local YYYY-MM-DD <-> Date (no UTC surprises) --- */
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

/** --- formátování lokálním časem (hoisted formatters) --- */
const fmtDateLongFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtTimeFmt     = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
const fmtDetailDateFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDetailTimeFmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })

const fmtDateLong = (d: Date) => fmtDateLongFmt.format(d)
const fmtTime     = (d: Date) => fmtTimeFmt.format(d)
const fmtDetailDate = (d: Date) => fmtDetailDateFmt.format(d)
const fmtDetailTime = (d: Date) => fmtDetailTimeFmt.format(d)

/** --- filtry (zatím jen design) --- */
const pickedMembers = ref<string[]>([])
const pickedDevices = ref<string[]>([])
const members = ['Jenny Fermin', 'Miloš Novák', 'Anna K.']
const devices = [
  { id: 'M1', name: 'M1', color: 'deep-purple' },
  { id: 'M2', name: 'M2', color: 'blue' },
  { id: 'M3', name: 'M3', color: 'teal' },
  { id: 'Spektro1', name: 'Spektro1', color: 'orange' },
  { id: 'Spektro2', name: 'Spektro2', color: 'amber' },
]
const colsDevices = computed(() => devices.length)

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
  start: string  // ISO bez zóny (bere se jako lokální)
  end: string
  status: 'plan' | 'running' | 'done'
}
const H_START = 4   // 4:00
const H_END   = 13  // 13:00
const TRACK_HEIGHT = 640
const hourTicks = computed(() => H_END - H_START + 1)
const tickHeight = computed(() => TRACK_HEIGHT / hourTicks.value)

const PX_PER_MIN = computed(() => TRACK_HEIGHT / ((H_END - H_START) * 60))
function topFromDate(d: Date) {
  const minutes = (d.getHours() - H_START) * 60 + d.getMinutes()
  return Math.max(0, minutes * PX_PER_MIN.value)
}
function heightFromRange(start: Date, end: Date) {
  const diff = (end.getTime() - start.getTime()) / (1000 * 60)
  return Math.max(24, diff * PX_PER_MIN.value)
}

/** --- helpery data --- */
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}
const currentDay = computed(() => fromYmdLocal(selectedDate.value))

/** ========= FAKE GENERÁTOR REZERVACÍ ========= */
const titles = [
  'Kalibrace A', 'Kontrola', 'Měření enzymatiky', 'Viskozita', 'Mikroskop indexy',
  'Peptidy', 'Test vzorku', 'Spektrum', 'Údržba', 'Záloha dat'
]
function dateKey(d: Date) {
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function makeRng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17; s >>>= 0
    s ^= s << 5;  s >>>= 0
    return (s % 1000) / 1000
  }
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

const cache = new Map<string, ResItem[]>() // podle YYYY-MM-DD
let autoId = 1
function generateForDay(day: Date): ResItem[] {
  const key = dateKey(day)
  if (cache.has(key)) return cache.get(key)!
  const seed = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate()
  const rnd  = makeRng(seed)

  const items: ResItem[] = []
  const total = 4 + Math.floor(rnd() * 6)

  const takenByDevice: Record<string, Array<[number, number]>> = {}
  devices.forEach(d => { takenByDevice[d.id] = [] })

  const startMin = H_START * 60
  const endMin   = H_END * 60

  for (let i = 0; i < total; i++) {
    const dev = devices[Math.floor(rnd() * devices.length)]
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
  cache.set(key, items)
  return items
}
function itemsFor(d: Date) { return generateForDay(d) }

/** --- computed pro aktuální den a tabulku --- */
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
const deviceColorOf = (id: string) => devices.find(d => d.id === id)?.color || 'deep-purple'

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
  // Sort by start asc, then end asc
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

    // If the event starts after the last group end, flush the group.
    if (lastEnd !== undefined && start >= lastEnd) {
      groups.push(columns)
      columns = []
      lastEnd = undefined
    }

    // Place into first column that doesn't collide with its last event
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

  // Pack each group and compute left/width percentages
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

// Precompute layout maps for current views
const layoutDailyByDevice = computed<Record<string, EventLayout>>(() => {
  const out: Record<string, EventLayout> = {}
  for (const d of devices) {
    const evs = itemsForDay.value.filter(x => x.deviceId === d.id)
    out[d.id] = layoutForTrack(evs)
  }
  return out
})

const layoutWeeklyByDay = computed<Record<string, EventLayout>>(() => {
  const days = daysForView.value // reactive (week/all)
  const out: Record<string, EventLayout> = {}
  for (const day of days) {
    const key = dateKey(day)
    out[key] = layoutForTrack(itemsFor(day))
  }
  return out
})

/** --- dialog (placeholder) --- */
const createOpen = ref(false)
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
            <v-btn color="primary" class="mr-2" @click="createOpen = true">VYTVOŘIT REZERVACI </v-btn>

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

                  <div v-for="d in devices" :key="d.id" class="track" :style="{ height: TRACK_HEIGHT + 'px' }">
                    <!-- každá událost má svůj vlastní v-menu s aktivátorem -->
                    <v-menu
                      v-for="i in itemsForDay.filter(x => x.deviceId === d.id)"
                      :key="i.id"
                      v-model="openMenu[i.id]"
                      location="bottom start"
                      offset="10"
                      max-width="520"
                      :close-on-content-click="false"
                      transition="fade-transition"
                    >
                      <template #activator="{ props }">
                        <div
                          class="event"
                          v-bind="props"
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

                      <!-- obsah detailu -->
                      <v-card class="detail-card pa-3">
                        <div class="d-flex align-start">
                          <v-icon :color="deviceColorOf(i.deviceId)" size="16" class="mr-3 mt-1">mdi-checkbox-blank-circle</v-icon>

                          <div class="flex-grow-1">
                            <div class="d-flex align-center justify-space-between mb-1">
                              <div class="text-subtitle-1 font-weight-medium">{{ i.title }}</div>
                              <div class="d-flex align-center">
                                <v-btn icon="mdi-pencil-outline" size="small" variant="text" />
                                <v-btn icon="mdi-delete-outline" size="small" variant="text" />
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
                    >
                      <template #activator="{ props }">
                        <div
                          class="event"
                          v-bind="props"
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
                                <v-btn icon="mdi-delete-outline" size="small" variant="text" />
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

    <!-- Dialog – placeholder -->
    <Dialog v-model:is-open="createOpen" width="600px" :hide-footer="false">
      <template #header>Vytvořit rezervaci</template>
      <template #content>
        <v-select  :items="['Teplota DLS','Tlak','Kalibrace']" label="Přístroj" density="comfortable" class="mt-2" />
        <v-select  :items="['Projekt 1','Projekt 2','Projekt 3']" label="Projekt" density="comfortable" class="mt-2" />
        <v-select v-model="pickedMembers" :items="members" label="Členové" clearable multiple density="comfortable" />
        <v-textarea label="Poznámka" density="comfortable" class="mt-2" />
      </template>
      <template #footer>
        <v-btn color="primary">Uložit</v-btn>
        <v-btn variant="text" @click="createOpen = false">Zrušit</v-btn>
      </template>
    </Dialog>
  </v-container>
</template>

<style scoped>
.event { cursor: pointer; }

/* pop-over */
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
  line-height: 1.1;
}
.event-title {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  text-overflow: ellipsis;
  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
  hyphens: auto;
  line-height: 1.2;
}
.event-time {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@container (max-width: 140px) {
  .event-title {
    -webkit-line-clamp: 1;
  }
}

@container (max-width: 120px) {
  .event-title { display: none; }
  .event { padding: 6px 8px; }
}

@container (max-width: 100px) {
  .event-title { position: relative; }
  .event-title .full { visibility: hidden; }
  .event-title::after {
    content: attr(data-short) '…';
    position: absolute;
    inset: 0 auto 0 0;
    visibility: visible;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
  }
  .event { padding: 6px 8px; }
}

@container (max-width: 90px) {
  .event-time { font-size: 11px; }
}

@container (max-width: 80px) {
  .event-time { font-size: 11px; }
}
</style>
