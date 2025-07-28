<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from '@/components/Dialog.vue'
import MeasurementForm from '@/components/measurement/MeasurementForm.vue'
import { useMeasurementStore } from '@/stores/measurement'

// stores & routing
const route = useRoute()
const measurementStore = useMeasurementStore()

// data
const measurements = ref<Array<Record<string, any>>>([])
const headers = [
  { text: 'Typ měření', value: 'type' },
  { text: 'Přístroj', value: 'device' },
  { text: 'Datum měření', value: 'date' },
  { text: 'Počet naměřených hodnot', value: 'count' }
]

// filtry
const selectedDate   = ref<string|null>(null)
const selectedMember = ref<string|null>(null)
const selectedDevice = ref<string|null>(null)

// dialog control
const dialogOpen = ref(false)

// nový záznam
const newMeasurement = ref<{
  value: number|string,
  type: string,
  unit: string,
  date: string
}>({
  value: '',
  type: '',
  unit: '',
  date: new Date().toISOString().slice(0, 10)
})

// id projektu z URL
const projectId = computed(() =>
  Number((route.params as { projectId: string }).projectId)
)

// otevřít / zavřít
function openDialog() { dialogOpen.value = true }
function closeDialog(){ dialogOpen.value = false }

// uložit a zavřít
async function saveMeasurement() {
  const payload = {
    value: newMeasurement.value.value,
    type:  newMeasurement.value.type,
    unit:  newMeasurement.value.unit,
    date:  newMeasurement.value.date
  }

  await measurementStore.saveMeasurement(projectId.value, payload)
  await loadMeasurements()

  // reset formuláře
  newMeasurement.value = {
    value: '',
    type: '',
    unit: '',
    date: new Date().toISOString().slice(0, 10)
  }
  closeDialog()
}

// načíst všechna měření
async function loadMeasurements() {
  measurements.value = await measurementStore.fetchAllMeasurements(projectId.value)
}

// filtrovaná data do tabulky
const filteredMeasurements = computed(() =>
  measurements.value.filter(m => {
    return (!selectedDate.value   || m.date   === selectedDate.value)
      && (!selectedMember.value || m.type   === selectedMember.value)
      && (!selectedDevice.value || m.device === selectedDevice.value)
  })
)

// initial load
onMounted(loadMeasurements)
</script>

<template>
  <v-container fluid>
    <!-- akční tlačítka -->
    <v-row class="mb-4">
      <v-col>
        <v-btn color="primary" class="mr-2" @click="openDialog">
          VYTVOŘENÍ MĚŘENÍ
        </v-btn>
        <v-btn elevation="0" color="grey lighten-2">
          PŘEHLED ŠABLON
        </v-btn>
      </v-col>
    </v-row>

    <!-- rozložení: filtry + tabulka -->
    <v-row>
      <v-col cols="3">
        <v-sheet elevation="1" class="pa-4">
          <v-date-picker v-model="selectedDate" color="primary" />
        </v-sheet>

        <v-sheet elevation="1" class="pa-4 mt-4">
          <v-select
            v-model="selectedMember"
            :items="['Teplota DLS','Tlak','Kalibrace']"
            label="Typ měření"
            clearable
            dense
          />
          <v-select
            v-model="selectedDevice"
            :items="['M1','M2','M3']"
            label="Přístroj"
            clearable
            dense
            class="mt-4"
          />
        </v-sheet>
      </v-col>

      <v-col cols="9">
        <v-sheet elevation="1" class="pa-4">
          <v-data-table
            :headers="headers"
            :items="filteredMeasurements"
            items-per-page="5"
            class="elevation-1"
          />
        </v-sheet>
      </v-col>
    </v-row>

    <!-- Dialog pro nové měření -->
    <Dialog
      :is-open="dialogOpen"
      :width="'500px'"
      :hide-footer="false"
    >
      <template #header>Nové měření</template>
      <template #content>
        <!-- vstupní část: vlastní komponenta + další pole -->
        <MeasurementForm v-model="newMeasurement.value" />

        <v-select
          v-model="newMeasurement.type"
          :items="['Teplota DLS','Tlak','Kalibrace']"
          label="Typ měření"
          dense
        />
        <v-select
          v-model="newMeasurement.unit"
          :items="['C','K','Pa','%']"
          label="Jednotka"
          dense
          class="mt-2"
        />
        <v-text-field
          v-model="newMeasurement.date"
          label="Datum měření"
          type="date"
          dense
          class="mt-2"
        />
      </template>
      <template #footer>
        <v-btn color="primary" @click="saveMeasurement">Uložit</v-btn>
        <v-btn text @click="closeDialog">Zrušit</v-btn>
      </template>
    </Dialog>
  </v-container>
</template>

<style scoped>
.filter-group {
  margin-top: 24px;
}
</style>
