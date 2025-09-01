<script setup lang="ts">
import { computed, ref, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from '@/components/Dialog.vue'
import MeasurementForm from '@/components/board/measurement/MeasurementForm.vue'
import { useMeasurementStore } from '@/stores/measurement'
import type { MeasurementRequest } from '@/stores/measurement'

const route = useRoute()
const measurementStore = useMeasurementStore()
const projectId = Number((route.params as { projectId: string }).projectId)

/* ---------- Tabulka měření ---------- */
const measurements = ref<Array<Record<string, any>>>([])
const headers = [
  { title: 'ID',           key: 'id' },
  { title: 'Typ měření',   key: 'type' },
  { title: 'Přístroj',     key: 'device' },
  { title: 'Datum měření', key: 'date' },
  { title: 'Hodnota',      key: 'value' },
  // { title: 'Jednotka',  key: 'unit' },
 // { title: 'Počet hodnot', key: 'count' },
 // { title: 'BoardCard ID', key: 'boardCardId' },
]

/* ---------- Filtry ---------- */
const selectedDate = ref<string|null>(null)
const selectedType = ref<string|null>(null)
/** „Jednotka“ je od teď „Přístroj“ */
const selectedDevice = ref<string|null>(null)
const deviceOptions = ['M1', 'M2', 'M3']

/* ---------- Dialog: nové měření ---------- */
const dialogOpen = ref(false)
const openDialog  = () => (dialogOpen.value = true)
const closeDialog = () => (dialogOpen.value = false)

/** Pozn.: `unit` dál posíláme do BE, ale v UI je to „Přístroj“ */
const newMeasurement = ref<{ value: number|string; type: string; unit: string; date: string }>({
  value: '',
  type: '',
  unit: '', // sem přijde M1/M2/M3
  date: new Date().toISOString().slice(0, 10),
})

/* ---------- Dialog: Přehled šablon (2 kroky) ---------- */
const templatesOpen = ref(false)
const templatesStep = ref<1 | 2>(1)
const openTemplates = () => { templatesStep.value = 1; templatesOpen.value = true }
const closeTemplates = () => { templatesOpen.value = false }
const fields = ref<any[]>([])
const draftId = ref<string | null>(null)

/* Krok 1: název šablony + přístroj (design) */
const templateNames = ref<string[]>(['DLS – Zetasizer'])
const selectedTemplateName = ref<string | null>(templateNames.value[0])
function onTemplateChange(val: string | null) {
  if (val && !templateNames.value.includes(val)) templateNames.value.push(val)
}
type DeviceOption = { id: string; name: string; color: string }
const devices = ref<DeviceOption[]>([
  { id: 'M1', name: 'M1', color: 'deep-purple' },
  { id: 'M2', name: 'M2', color: 'teal' },
  { id: 'M3', name: 'M3', color: 'indigo' },
])
const selectedDeviceId = ref<string>(devices.value[0].id)
const selectedDeviceObj = computed<DeviceOption | undefined>(() =>
  devices.value.find(d => d.id === selectedDeviceId.value)
)
function continueFromTemplates() {
  if (!selectedTemplateName.value) return
  templatesStep.value = 2
}

/* --- pomocné funkce pro datum --- */
function toMs(v: unknown): number {
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    if (!Number.isNaN(ms)) return ms
  }
  return NaN
}
function formatLocal(ts: unknown): string {
  const ms = toMs(ts)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
function dayBoundsLocal(val: string | Date) {
  const base = (val instanceof Date)
    ? val
    : (/^\d{4}-\d{2}-\d{2}$/.test(val) ? new Date(val + 'T00:00:00') : new Date(val))

  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0).getTime()
  const end   = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999).getTime()
  return { start, end }
}

/* Krok 2: definice polí šablony (design) */
type FieldRow = { id: string; type: string; required: boolean; name: string }
const fieldTypeOptions = [
  { label: 'Float',   value: 'float' },
  { label: 'Integer', value: 'int' },
  { label: 'Text',    value: 'text' },
  { label: 'Image',   value: 'image' },
  { label: 'Boolean', value: 'bool' },
  { label: 'Date',    value: 'date' },
]
function addField() {
  const id = `draft-${Date.now()}`
  const draft: FieldRow & { _draft: boolean } = { id, type: fieldTypeOptions[0].value, required: false, name: '', _draft: true }
  fields.value.unshift(draft)
  draftId.value = id
  nextTick(() => {
    const input = document.querySelector(`[data-draft="${id}"] input`) as HTMLInputElement | null
    input?.focus()
  })
}
function saveDraft(item: any) { item._draft = false; draftId.value = null }
function cancelDraft(id: string) {
  const idx = fields.value.findIndex((f: any) => f.id === id)
  if (idx !== -1) fields.value.splice(idx, 1)
  draftId.value = null
}
function saveTemplate() {
  const payload = {
    name: selectedTemplateName.value,
    deviceId: selectedDeviceId.value,
    fields: fields.value.map((f: any) => ({ type: f.type, required: f.required, name: f.name })),
  }
  console.log('Template payload:', payload)
  templatesOpen.value = false
}

/* ---------- Načítání měření ---------- */
async function loadMeasurements() {
  measurements.value = await measurementStore.fetchAllMeasurements(projectId)
}
onMounted(loadMeasurements)

/* --- computed: seřadit + filtrovat + mapovat --- */
const filteredMeasurements = computed(() => {
  const bounds = selectedDate.value ? dayBoundsLocal(selectedDate.value) : null

  return measurements.value
    .slice()
    .sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))
    .filter(m => {
      if (selectedType.value && m.type !== selectedType.value) return false
      if (selectedDevice.value && m.unit !== selectedDevice.value) return false // unit = device (v BE)
      if (!bounds) return true
      const t = toMs(m.timestamp)
      if (Number.isNaN(t)) return false
      return t >= bounds.start && t <= bounds.end
    })
    .map(m => ({
      id:          m.id,
      type:        m.type,
      /** ZOBRAZUJEME „Přístroj“ – bereme ho z m.unit */
      device:      m.unit ?? m.device ?? '',
      date:        m.date || formatLocal(m.timestamp),
      value:       m.value,
      count:       m.count ?? '',
      boardCardId: m.boardCardId,
    }))
})

/* ---------- Uložení nového měření ---------- */
async function saveMeasurement() {
  const d = newMeasurement.value.date
  const ts = new Date(`${d}T00:00:00`).getTime()

  const payload: MeasurementRequest = {
    value: Number(newMeasurement.value.value),
    type: newMeasurement.value.type.trim(),
    unit: newMeasurement.value.unit.trim(), // tady bude „M1/M2/M3“
    timestamp: ts,
  }

  try {
    await measurementStore.saveMeasurement(projectId, payload)
    await loadMeasurements()
    newMeasurement.value = { value: '', type: '', unit: '', date: new Date().toISOString().slice(0, 10) }
    closeDialog()
  } catch (e: any) {
    console.error('Save failed:', e.response?.data ?? e)
  }
}
</script>

<template>
  <v-container fluid>
    <!-- Akční tlačítka -->
    <v-row class="mb-4">
      <v-col>
        <v-btn color="primary" class="mr-2" @click="openDialog">VYTVOŘENÍ MĚŘENÍ</v-btn>
        <v-btn elevation="0" color="grey-lighten-2" @click="openTemplates">PŘEHLED ŠABLON</v-btn>
      </v-col>
    </v-row>

    <!-- Filtry + tabulka -->
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
            density="comfortable"
          />
          <!-- „Jednotka“ => „Přístroj“ -->
          <v-select
            v-model="selectedDevice"
            :items="deviceOptions"
            label="Přístroj"
            clearable
            density="comfortable"
            class="mt-4"
          />
        </v-sheet>
      </v-col>

      <v-col cols="9">
        <v-sheet elevation="1" class="pa-4">
          <v-data-table
            :headers="headers"
            :items="filteredMeasurements"
            :items-per-page="5"
            class="elevation-1"
          />
        </v-sheet>
      </v-col>
    </v-row>

    <!-- Dialog: nové měření -->
    <Dialog v-model:is-open="dialogOpen" width="500px" :hide-footer="false">
      <template #header>Nové měření</template>
      <template #content>
        <MeasurementForm v-model="newMeasurement.value" />
        <v-select
          v-model="newMeasurement.type"
          :items="['Teplota DLS','Tlak','Kalibrace']"
          label="Typ měření"
          density="comfortable"
          class="mt-2"
        />
        <!-- „unit“ v BE = „Přístroj“ v UI -->
        <v-select
          v-model="newMeasurement.unit"
          :items="deviceOptions"
          label="Přístroj"
          density="comfortable"
          class="mt-2"
        />
        <v-text-field
          v-model="newMeasurement.date"
          label="Datum měření"
          type="date"
          density="comfortable"
          class="mt-2"
        />
      </template>
      <template #footer>
        <v-btn color="primary" @click="saveMeasurement">Uložit</v-btn>
        <v-btn variant="text" @click="closeDialog">Zrušit</v-btn>
      </template>
    </Dialog>

    <!-- Dialog: Přehled šablon (2 kroky) – beze změny funkce -->
    <Dialog v-model:is-open="templatesOpen" width="1000px" :hide-footer="false">
      <template #header>Vytvoření nové šablony</template>

      <template v-if="templatesStep === 1" #content>
        <v-row>
          <v-col cols="12" md="6">
            <v-combobox
              v-model="selectedTemplateName"
              :items="templateNames"
              label="Název šablony"
              placeholder="Vyber ze seznamu nebo napiš nový"
              variant="outlined"
              density="comfortable"
              clearable
              hide-details="auto"
              @update:modelValue="onTemplateChange"
            />
          </v-col>

          <v-col cols="12" md="6">
            <v-select
              v-model="selectedDeviceId"
              :items="devices"
              item-title="name"
              item-value="id"
              label="Přístroj"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            >
              <template #selection="{ item }">
                <v-chip size="small" :color="item.raw.color" text-color="white" class="ma-0">
                  {{ item.raw.name }}
                </v-chip>
              </template>
              <template #item="{ props, item }">
                <v-list-item v-bind="props">
                  <template #prepend>
                    <v-chip size="x-small" :color="item.raw.color" class="mr-2" />
                  </template>
                  <v-list-item-title>{{ item.raw.name }}</v-list-item-title>
                </v-list-item>
              </template>
            </v-select>
          </v-col>
        </v-row>
      </template>

      <template v-else #content>
        <v-btn size="small" color="primary" class="mb-3" @click="addField">PŘIDAT NOVÉ POLE</v-btn>
        <div class="text-subtitle-2 mb-2">Primární data</div>

        <v-data-table
          :items="fields"
          :headers="[
            { title: 'Typ', key: 'type', sortable: false },
            { title: 'Povinné', key: 'required', sortable: false },
            { title: 'Název pole', key: 'name', sortable: false },
            { title: '', key: 'actions', sortable: false },
          ]"
          :items-per-page="5"
          class="elevation-1"
          density="comfortable"
        >
          <template #item.type="{ item }">
            <v-select
              v-model="item.type"
              :items="fieldTypeOptions"
              item-title="label"
              item-value="value"
              hide-details
              density="compact"
              variant="plain"
            />
          </template>

          <template #item.required="{ item }">
            <v-checkbox v-model="item.required" hide-details density="compact" />
          </template>

          <template #item.name="{ item }">
            <v-text-field
              v-model="item.name"
              :data-draft="item._draft ? item.id : null"
              hide-details
              density="compact"
              variant="plain"
            />
          </template>

          <template #item.actions="{ item }">
            <div v-if="item._draft">
              <v-btn size="x-small" color="primary" @click="saveDraft(item)">Uložit</v-btn>
              <v-btn size="x-small" variant="text" @click="cancelDraft(item.id)">Zrušit</v-btn>
            </div>
          </template>
        </v-data-table>
      </template>

      <template #footer>
        <div class="w-100 d-flex align-center">
          <div>
            <v-btn variant="text" class="mr-2" :disabled="templatesStep === 1" @click="templatesStep = 1">ZPĚT</v-btn>
            <v-btn color="primary" variant="tonal" disabled>EXPORTOVAT</v-btn>
          </div>
          <v-spacer />
          <div>
            <v-btn variant="text" class="mr-2" @click="closeTemplates">ZRUŠIT</v-btn>
            <v-btn color="primary" v-if="templatesStep === 1" @click="continueFromTemplates">POKRAČOVAT</v-btn>
            <v-btn color="primary" v-else @click="saveTemplate">ULOŽIT</v-btn>
          </div>
        </div>
      </template>
    </Dialog>
  </v-container>
</template>

<style scoped>
</style>
