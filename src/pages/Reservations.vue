<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Dialog from '@/components/Dialog.vue'

/** --- routing --- */
const route = useRoute()
const router = useRouter()
const projectId = Number((route.params as { projectId: string }).projectId)

/** --- datum / navigace --- */
const selectedDate = ref<string>(new Date().toISOString().slice(0, 10)) // YYYY-MM-DD
function addDays(n: number) {
  const d = new Date(selectedDate.value)
  d.setDate(d.getDate() + n)
  selectedDate.value = d.toISOString().slice(0, 10)
}
function goToday() {
  selectedDate.value = new Date().toISOString().slice(0, 10)
}

/** --- formátování lokálním časem --- */
const fmtDateLong = (d: Date) =>
  new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(d)

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
const currentDay = computed(() => new Date(selectedDate.value))

/** ========= FAKE GENERÁTOR REZERVACÍ =========
 *  Stabilní (seed podle data), bez překryvů v rámci stejného stroje.
 *  Použijeme pro všechny pohledy.
 */
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
    // xorshift32 – jednoduchý deterministický RNG
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17; s >>>= 0
    s ^= s << 5;  s >>>= 0
    return (s % 1000) / 1000
  }
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}
function toIsoLocal(d: Date) {
  // YYYY-MM-DDTHH:mm:SS — bez Z, bere se jako lokální čas
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
  // kolik na den – 4 až 9
  const total = 4 + Math.floor(rnd() * 6)

  // pro každý device budeme zkoušet náhodná okna bez kolizí
  const takenByDevice: Record<string, Array<[number, number]>> = {}
  devices.forEach(d => { takenByDevice[d.id] = [] })

  const startMin = H_START * 60
  const endMin   = H_END * 60

  for (let i = 0; i < total; i++) {
    const dev = devices[Math.floor(rnd() * devices.length)]
    const dur = [45, 60, 75, 90, 105, 120][Math.floor(rnd() * 6)] // 45–120 min
    const startCandidate = startMin + Math.floor(rnd() * (endMin - startMin - dur))
    // zarovnání na půlhodiny
    const start = Math.floor(startCandidate / 30) * 30
    const end   = start + dur

    // kolize v daném stroji?
    const overlaps = takenByDevice[dev.id].some(([a, b]) => !(end <= a || start >= b))
    if (overlaps) { i--; continue } // zkus znovu

    takenByDevice[dev.id].push([start, end])

    const s = new Date(day); s.setHours(Math.floor(start / 60), start % 60, 0, 0)
    const e = new Date(day); e.setHours(Math.floor(end / 60),   end % 60,   0, 0)

    const title = titles[Math.floor(rnd() * titles.length)]
    // status náhodně, ale trochu „smysluplně“ podle času
    let status: ResItem['status'] = 'plan'
    const now = new Date()
    if (sameDay(now, day)) {
      if (now.getTime() > e.getTime()) status = 'done'
      else if (now.getTime() >= s.getTime() && now.getTime() <= e.getTime()) status = 'running'
      else status = rnd() > 0.5 ? 'plan' : 'done'
    } else if (now.getTime() > day.getTime()) status = 'done'
    else status = 'plan'

    items.push({
      id: autoId++,
      title,
      deviceId: dev.id,
      start: toIsoLocal(s),
      end:   toIsoLocal(e),
      status
    })
  }

  // pro jistotu seřadit
  items.sort((a, b) => +new Date(a.start) - +new Date(b.start))
  cache.set(key, items)
  return items
}

function itemsFor(d: Date) {
  return generateForDay(d)
}

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

/** --- dialog (placeholder) --- */
const createOpen = ref(false)
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <!-- LEVÝ PANEL -->
      <v-col cols="12" md="3">
        <v-card>
          <v-card-text class="pa-0">
            <v-date-picker v-model="selectedDate" color="primary" />
          </v-card-text>
        </v-card>

        <v-card class="mt-4">
          <v-card-text>
            <div class="text-subtitle-2 mb-2">Členové</div>
            <v-combobox v-model="pickedMembers" :items="members" chips multiple clearable variant="outlined" density="comfortable" hide-details />
            <v-divider class="my-4" />
            <div class="text-subtitle-2 mb-2">Přístroje</div>
            <v-combobox v-model="pickedDevices" :items="devices.map(d => d.name)" chips multiple clearable variant="outlined" density="comfortable" hide-details />
          </v-card-text>
        </v-card>
      </v-col>

      <!-- PRAVÝ PANEL -->
      <v-col cols="12" md="9">
        <v-card class="mb-3">
          <v-card-text class="d-flex flex-wrap align-center gap-2">
            <v-btn color="primary" @click="createOpen = true">VYTVOŘIT REZERVACI</v-btn>

            <v-menu>
              <template #activator="{ props }">
                <v-btn v-bind="props" append-icon="mdi-menu-down" variant="tonal">
                  {{ viewLabel }}
                </v-btn>
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
            <div class="text-subtitle-1 mx-2">{{ fmtDateLong(new Date(selectedDate)) }}</div>
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
                    <div
                      v-for="i in itemsForDay.filter(x => x.deviceId === d.id)"
                      :key="i.id"
                      class="event"
                      :style="{
                        top: topFromDate(new Date(i.start)) + 'px',
                        height: heightFromRange(new Date(i.start), new Date(i.end)) + 'px',
                        borderLeft: `4px solid var(--v-theme-${d.color})`
                      }"
                    >
                      <div class="event-title">{{ i.title }}</div>
                      <div class="event-time">{{ fmtTime(new Date(i.start)) }} – {{ fmtTime(new Date(i.end)) }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Denní – seznam -->
            <div v-else-if="viewMode === 'daily-list'">
              <v-data-table :headers="tableHeaders" :items="tableItems" items-per-page="10" class="elevation-1">
                <template #item.status="{ item }">
                  <v-chip size="small" :color="item._raw.status === 'done' ? 'green' : (item._raw.status === 'running' ? 'blue' : 'grey')"
                          text-color="white" variant="flat" class="text-capitalize">
                    {{ item._raw.status === 'plan' ? 'Plánované' :
                    item._raw.status === 'running' ? 'Probíhá'    : 'Dokončeno' }}
                  </v-chip>
                </template>
              </v-data-table>
            </div>

            <!-- Týdenní (pracovní / s víkendy) -->
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
                    <div
                      v-for="i in itemsFor(day)"
                      :key="i.id"
                      class="event"
                      :style="{
                        top: topFromDate(new Date(i.start)) + 'px',
                        height: heightFromRange(new Date(i.start), new Date(i.end)) + 'px',
                        borderLeft: `4px solid var(--v-theme-${(devices.find(d => d.id === i.deviceId)?.color) || 'primary'})`
                      }"
                    >
                      <div class="event-title">{{ i.title }}</div>
                      <div class="event-time">{{ fmtTime(new Date(i.start)) }} – {{ fmtTime(new Date(i.end)) }}</div>
                      <div class="text-caption mt-1">{{ i.deviceId }}</div>
                    </div>
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
        <div class="text-body-2">TODO DIALOG</div>
      </template>
    </Dialog>
  </v-container>
</template>

<style scoped>
/* rozvrh */
.schedule {
  border-radius: 12px;
  overflow: hidden;
}

/* grid čas × sloupce */
.tracks.row.header {
  display: grid;
  grid-template-columns: 80px repeat(var(--cols, 5), 1fr);
  gap: 0;
  border-bottom: 1px solid #e5e5e5;
}
.tracks.row.body {
  display: grid;
  grid-template-columns: 80px repeat(var(--cols, 5), 1fr);
}

/* levý časový sloupec */
.time-col {
  background: #fafafa;
  border-right: 1px solid #e5e5e5;
}
.time-tick {
  padding: 4px 8px;
  font-size: 12px;
  color: #777;
  border-bottom: 1px dashed #eee;
}

/* hlavičky sloupců */
.track-name {
  padding: 12px 8px;
  text-align: center;
  border-left: 1px solid #f1f1f1;
}
.track-name .weekday {
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: .02em;
}
.track-name.weekend {
  background: #fafaff;
}

/* tělo sloupců */
.track {
  position: relative;
  border-left: 1px solid #f1f1f1;
  background:
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0.02) 0,
      rgba(0,0,0,0.02) 40px,
      transparent 40px,
      transparent 80px
    );
}
.track.weekend {
  background:
    linear-gradient(to bottom, rgba(70,120,255,0.04), rgba(70,120,255,0.04)),
    repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0.02) 0,
      rgba(0,0,0,0.02) 40px,
      transparent 40px,
      transparent 80px
    );
}

/* události */
.event {
  position: absolute;
  left: 8px;
  right: 8px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  padding: 8px 10px 8px 10px;
}
.event-title {
  font-weight: 600;
  line-height: 1.1;
}
.event-time {
  font-size: 12px;
  color: #666;
}
</style>
