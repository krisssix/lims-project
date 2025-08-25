<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from '@/components/Dialog.vue'
import MeasurementForm from "@/components/board/measurement/MeasurementForm.vue";
import { useMeasurementStore } from '@/stores/measurement'

// stores & routing
const route = useRoute()
const measurementStore = useMeasurementStore()
const projectId = Number((route.params as { projectId: string }).projectId)

// raw measurements loaded from API
const measurements = ref<Array<Record<string, any>>>([])

// všechny sloupce, které chceme vidět
const headers = [
  { text: 'ID',              value: 'id' },
  { text: 'Typ měření',      value: 'type' },
  { text: 'Přístroj',         value: 'device' },
  { text: 'Datum měření',     value: 'date' },
  { text: 'Hodnota',          value: 'value' },
  { text: 'Jednotka',         value: 'unit' },
  { text: 'Počet hodnot',     value: 'count' },
  { text: 'BoardCard ID',     value: 'boardCardId' }
]

// filtry
const selectedDate = ref<string|null>(null)
const selectedType = ref<string|null>(null)
const selectedUnit = ref<string|null>(null)

// dialog control
const dialogOpen = ref(false)
const openDialog  = () => { dialogOpen.value = true  }
const closeDialog = () => { dialogOpen.value = false }

// nový záznam
const newMeasurement = ref<{
  value: number|string,
  type:  string,
  unit:  string,
  date:  string
}>({
  value: '',
  type:  '',
  unit:  '',
  date:  new Date().toISOString().slice(0, 10)
})

// načíst všechna měření z API
async function loadMeasurements() {
  measurements.value = await measurementStore.fetchAllMeasurements(projectId)
}
onMounted(loadMeasurements)

// seřadit od nejnovějšího, potom filtrovat a mapovat na tvar pro tabulku
const filteredMeasurements = computed(() => {
  return measurements.value
    .slice() // klon, abychom nepozměňovali původní pole
    // 1) seřadit podle timestamp sestupně
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    // 2) aplikovat filtry
    .filter(m => {
      const dateMatch = !selectedDate.value || m.date === selectedDate.value || m.timestamp.startsWith(selectedDate.value)
      const typeMatch = !selectedType.value || m.type === selectedType.value
      const unitMatch = !selectedUnit.value || m.unit === selectedUnit.value
      return dateMatch && typeMatch && unitMatch
    })
    // 3) mapovat na strukturu, kterou data-table očekává
    .map(m => ({
      id:          m.id,
      type:        m.type,
      device:      m.device  ?? '',
      date:        m.date    || new Date(m.timestamp).toLocaleString(),
      value:       m.value,
      unit:        m.unit,
      count:       m.count   ?? '',
      boardCardId: m.boardCardId
    }))
})

// uložit nové měření a znovu načíst
async function saveMeasurement() {
  const payload = {
    value: newMeasurement.value.value,
    type:  newMeasurement.value.type,
    unit:  newMeasurement.value.unit,
    date:  newMeasurement.value.date
  }
  await measurementStore.saveMeasurement(projectId, payload)
  await loadMeasurements()
  newMeasurement.value = {
    value: '',
    type:  '',
    unit:  '',
    date:  new Date().toISOString().slice(0, 10)
  }
  closeDialog()
}
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

    <!-- filtry + tabulka -->
    <v-row>
      <v-col cols="3">
        <v-sheet elevation="1" class="pa-4">
          <v-date-picker v-model="selectedDate" color="primary" />
        </v-sheet>
        <v-sheet elevation="1" class="pa-4 mt-4">
          <v-select
            v-model="selectedType"
            :items="['Teplota DLS','Tlak','Kalibrace']"
            label="Typ měření"
            clearable
            dense
          />
          <v-select
            v-model="selectedUnit"
            :items="['C','K','Pa','%']"
            label="Jednotka"
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

    <!-- Dialog pro vytvoření měření -->
    <Dialog
      v-model:is-open="dialogOpen"
      width="500px"
      :hide-footer="false"
    >
      <template #header>Nové měření</template>
      <template #content>
        <MeasurementForm v-model="newMeasurement.value" />
        <v-select
          v-model="newMeasurement.type"
          :items="['Teplota DLS','Tlak','Kalibrace']"
          label="Typ měření"
          dense
          class="mt-2"
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
