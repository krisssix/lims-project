<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from '@/components/Dialog.vue'
import Reservations from '@/components/reservation/Reservations.vue';
import { useReservationStore } from '@/stores/reservation'

// routing & store
const route = useRoute()
const reservationStore = useReservationStore()
const projectId = Number((route.params as { projectId: string }).projectId)

// data
const currentDate = ref<string>(new Date().toISOString().slice(0, 10))
const viewOptions = ['Denní - stroje','Týdenní (pracovní)','Týdenní (s víkendy)','Rezervace']
const viewType = ref<string>(viewOptions[0])

// filtrovací hodnoty
const selectedMembers = ref<Array<string>>([])
const selectedDevices = ref<Array<string>>([])
const selectedDate = ref<string | null>(null)

// data a eventy
const reservations = ref<Array<any>>([])
const events = ref<Array<any>>([])

// načtení rezervací i eventů
async function loadReservations() {
  const res = await reservationStore.fetchReservations(projectId, currentDate.value)
  reservations.value = res.table
  events.value = res.calendar
}
onMounted(loadReservations)

// dialog
const dialogOpen = ref(false)
const dialogMode = ref<'Nová'|'Editace'>('Nová')
const formData = ref<any>({})
function openNew(dateObj?: { date: string, time: string }) {
  dialogMode.value = 'Nová'
  formData.value = dateObj
  dialogOpen.value = true
}
function openEdit(evt: any) {
  dialogMode.value = 'Editace'
  formData.value = { ...evt }
  dialogOpen.value = true
}
function closeDialog() {
  dialogOpen.value = false
}
async function save() {
  await reservationStore.saveReservation(projectId, formData.value)
  await loadReservations()
  closeDialog()
}

// calendar settings
const calendarType = computed(() => viewType.value === 'Rezervace' ? 'category' : viewType.value.startsWith('Denní') ? 'day' : 'week')
const weekdays = computed(() => {
  if (viewType.value === 'Týdenní (pracovní)') return [1,2,3,4,5]
  if (viewType.value === 'Týdenní (s víkendy)') return [1,2,3,4,5,6,0]
  return [1]
})

// tabulka
const tableHeaders = [
  { text: 'Datum', value: 'date' },
  { text: 'Stroj', value: 'device' },
  { text: 'Člen', value: 'member' },
  { text: 'Stav', value: 'status' }
]
const filteredReservations = computed(() => reservations.value
  .filter(r => !selectedDate.value || r.date === selectedDate.value)
  .filter(r => !selectedMembers.value.length || selectedMembers.value.includes(r.member))
  .filter(r => !selectedDevices.value.length || selectedDevices.value.includes(r.device))
)

// handlers
function onTimeClick({ time }: any) {
  openNew(time)
}
function onEventClick({ event }: any) {
  openEdit(event)
}
</script>

<template>
  <v-container fluid>
    <!-- akce + filtr -->
    <v-row class="mb-4">
      <v-col cols="auto">
        <v-btn color="primary" @click="openNew()">VYTVOŘIT REZERVACI</v-btn>
      </v-col>
      <v-col cols="auto">
        <v-select v-model="viewType" :items="viewOptions" label="Režim" dense hide-details/>
      </v-col>
      <v-col>
        <v-btn @click="loadReservations">Načíst</v-btn>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="3">
        <v-sheet elevation="1" class="pa-4">
          <v-date-picker v-model="currentDate" locale="cs" scrollable @change="loadReservations"/>
        </v-sheet>
        <v-sheet elevation="1" class="pa-4 mt-4">
          <v-select v-model="selectedDate" :items="[]" label="Datum" clearable dense/>
          <v-select v-model="selectedMembers" :items="reservationStore.members" label="Členové" multiple clearable dense class="mt-2"/>
          <v-select v-model="selectedDevices" :items="reservationStore.devices" label="Přístroje" multiple clearable dense class="mt-2"/>
        </v-sheet>
      </v-col>

      <v-col cols="9">
        <div v-if="viewType === 'Rezervace'">
          <v-data-table :headers="tableHeaders" :items="filteredReservations" class="elevation-1"/>
        </div>
        <div v-else>
          <v-sheet height="600">
            <v-calendar
              :type="calendarType"
              v-model="currentDate"
              :weekdays="weekdays"
              :events="events"
              @click:time="onTimeClick"
              @click:event="onEventClick"
            />
          </v-sheet>
        </div>
      </v-col>
    </v-row>

    <Dialog v-model:is-open="dialogOpen" width="400px">
      <template #header>{{ dialogMode }} rezervaci</template>
      <template #content>
        <Reservations v-model="formData.value" />
      </template>
      <template #footer>
        <v-btn text @click="closeDialog">Zrušit</v-btn>
        <v-btn color="primary" @click="save">Uložit</v-btn>
      </template>
    </Dialog>
  </v-container>
</template>
