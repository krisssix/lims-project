<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'

import { useMeasurementStore, type MeasurementRequest, type MeasuredValue } from '@/stores/measurement'
import { useReservationsStore } from '@/stores/reservations'
import { useMeasurementTemplatesStore, type MeasurementTemplateRequest } from '@/stores/measurement-templates'

import MeasurementsFilters from '@/components/measurement/MeasurementsFilters.vue'
import TemplatesOverviewDialog from "@/components/measurement/TemplatesOverviewDialog.vue"
import  MeasurementCreateDialog  from '@/components/measurement/MeasurementCreateDialog.vue'
import  MeasurementDetailDialog from '@/components/measurement/MeasurementDetailDialog.vue'
import ConfirmDeleteDialog  from '@/components/measurement/ConfirmDeleteDialog.vue'

import type { DeviceItem, TemplateItem } from '@/stores/measurement'
import { toYmdLocal, normalizeToDate, formatLocal, dayBoundsLocal } from '@/composables/date'

const route = useRoute()
const projectId = Number((route.params as { projectId: string }).projectId)

const measurementStore = useMeasurementStore()
const reservationsStore = useReservationsStore()
const templatesStore = useMeasurementTemplatesStore()

/* ---------- Devices ---------- */
const devices = computed<DeviceItem[]>(() =>
  reservationsStore.devices.map(d => ({
    id: d.code,
    name: d.code,
    color: d.color || 'primary'
  }))
)
const devicesById = computed(() => new Map(devices.value.map(d => [d.id, d])))

/* ---------- Templates ---------- */
const templates = computed<TemplateItem[]>(() =>
  templatesStore.items.map(t => ({
    id: String(t.id),
    name: t.name,
    deviceId: t.deviceCode,
    deviceColor: t.deviceColor || 'primary',
    fields: (t.fields || [])
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(f => ({
        id: String(f.id ?? `tmp-${f.orderIndex}`),
        type: f.type as any,
        required: !!f.required,
        name: f.name
      }))
  }))
)
const templateById = computed(() => new Map(templates.value.map(t => [t.id, t])))

/* ---------- Data table ---------- */
const measurements = ref<Array<Record<string, any>>>([])
const headers = [
  { title: 'Šablona',      key: 'type' },
  { title: 'Přístroj',     key: 'device' },
  { title: 'Datum měření', key: 'date' },
  { title: 'Počet hodnot', key: 'count' },
]

/* ---------- Filters ---------- */
const pickedDevices = ref<string[]>([])
const pickedTemplates = ref<string[]>([])
const selectedDate = ref<string | Date | null>(null)

watch(pickedDevices, v => { if (!Array.isArray(v)) pickedDevices.value = [] })
watch(pickedTemplates, v => { if (!Array.isArray(v)) pickedTemplates.value = [] })

function selectAllDevices() { pickedDevices.value = devices.value.map(d => d.id) }
function clearDevices() { pickedDevices.value = [] }
function selectAllTemplates() { pickedTemplates.value = Array.from(new Set(templates.value.map(t => t.name))) }
function clearTemplates() { pickedTemplates.value = [] }

/* ---------- Toolbar ---------- */
const fmtDateLongFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtDateLong = (d: Date) => fmtDateLongFmt.format(d)

function addDays(n: number) {
  const base = selectedDate.value ? normalizeToDate(selectedDate.value) : new Date()
  base.setDate(base.getDate() + n)
  selectedDate.value = toYmdLocal(base)
}
function goToday() {
  const today = toYmdLocal(new Date())
  selectedDate.value = selectedDate.value === today ? null : today
}

/* ---------- Overview dialog ---------- */
const overviewOpen = ref(false)
const searchTemplates = ref('')
const selectedTemplateId = ref<string | null>(null)
const sortedTemplates = computed(() => {
  const q = searchTemplates.value.trim().toLowerCase()
  return [...templates.value]
    .filter(t => !q || t.name.toLowerCase().includes(q) || t.deviceId.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
})
function openOverview() {
  overviewOpen.value = true
  selectedTemplateId.value = null
  nextTick(() => {
    const el = document.querySelector('[data-templates-search] input') as HTMLInputElement | null
    el?.focus()
  })
}
function closeOverview() { overviewOpen.value = false }

/* ---------- Template form dialog ---------- */
const templateFormOpen = ref(false)
const templateFormMode = ref<'create'|'edit'>('create')
const templateFormInitial = ref<TemplateItem | null>(null)

function startCreateTemplate(context: 'overview' | 'measurement' = 'overview') {
  templateFormMode.value = 'create'
  templateFormInitial.value = null
  templateFormOpen.value = true
  templateCreateContext.value = context
}
function startEditTemplate(item: TemplateItem) {
  templateFormMode.value = 'edit'
  templateFormInitial.value = item
  selectedTemplateId.value = item.id
  templateFormOpen.value = true
}

/* Save handler delegating to store */
async function saveTemplate(req: MeasurementTemplateRequest, editingId?: string | number | null) {
  if (templateFormMode.value === 'create') {
    const saved = await templatesStore.create(projectId, req)
    selectedTemplateId.value = String(saved.id)
  } else {
    const idNum = Number(editingId ?? selectedTemplateId.value)
    if (!Number.isFinite(idNum)) return
    const saved = await templatesStore.update(idNum, req)
    selectedTemplateId.value = String(saved.id)
  }
  await templatesStore.fetchByProject(projectId)
  templateFormOpen.value = false

  if (templateCreateContext.value === 'overview') {
    overviewOpen.value = true
  } else {
    // reopen measurement dialog with preselected template
    measurementDialogOpen.value = true
    measurementStep.value = 1
    const tpl = templates.value.find(t => t.id === selectedTemplateId.value)
    if (tpl) {
      metaSelectedDevice.value = tpl.deviceId
      metaSelectedTemplateId.value = tpl.id
    }
  }
}
const templateCreateContext = ref<'overview'|'measurement'>('overview')

/* ---------- Create measurement dialog ---------- */
const measurementDialogOpen = ref(false)
const measurementStep = ref<1|2>(1)
const metaSelectedDevice = ref<string>('')
const metaSelectedTemplateId = ref<string | null>(null)

watch(devices, list => { if (!metaSelectedDevice.value && list.length) metaSelectedDevice.value = list[0].id }, { immediate: true })

const availableTemplatesForDevice = computed(() =>
  templates.value.filter(t => !metaSelectedDevice.value || t.deviceId === metaSelectedDevice.value)
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
)

function openCreateMeasurement() {
  measurementDialogOpen.value = true
  measurementStep.value = 1
  if (devices.value.length) metaSelectedDevice.value = devices.value[0].id
  metaSelectedTemplateId.value = null
}

/* Build values from step-2 rows */
function buildMeasuredValues(valuesRows: Array<{ order: number; name: string; type: any; required: boolean; value: any }>): MeasuredValue[] {
  return valuesRows.map((r, idx) => {
    const base = { orderIndex: r.order ?? (idx + 1), name: r.name, type: r.type } as MeasuredValue
    switch (r.type) {
      case 'float':
      case 'int': {
        const n = Number(r.value)
        return { ...base, numberValue: Number.isFinite(n) ? n : null }
      }
      case 'text': return { ...base, textValue: r.value != null ? String(r.value) : '' }
      case 'bool': return { ...base, boolValue: !!r.value }
      case 'date': {
        const ts = r.value instanceof Date ? r.value.getTime() : Number(r.value)
        return { ...base, dateValue: Number.isFinite(ts) ? ts : null }
      }
      case 'file': return { ...base, fileUrl: r?.value?.name ?? null }
      default: return base
    }
  })
}

async function handleCreateMeasurementSave(payload: {
  templateId: string
  valuesRows: Array<{ order: number; name: string; type: any; required: boolean; value: any }>
}) {
  const tpl = templateById.value.get(payload.templateId)
  if (!tpl) return
  const firstNumeric = payload.valuesRows
    .filter(v => v.type === 'float' || v.type === 'int')
    .map(v => Number(v.value))
    .find(n => Number.isFinite(n))

  const req: MeasurementRequest = {
    value: Number.isFinite(firstNumeric as number) ? (firstNumeric as number) : 0,
    type: tpl.name,
    unit: tpl.deviceId,
    timestamp: Date.now(),
    values: buildMeasuredValues(payload.valuesRows),
  }
  await measurementStore.saveMeasurement(projectId, req)
  await loadMeasurements()
  measurementDialogOpen.value = false
}

/* ---------- Load data ---------- */
async function loadMeasurements() {
  measurements.value = await measurementStore.fetchAllMeasurements(projectId)
}
onMounted(async () => {
  await reservationsStore.fetchDevices()
  await templatesStore.fetchByProject(projectId)
  await loadMeasurements()
})

/* ---------- Filtered items for table ---------- */
const filteredMeasurements = computed(() => {
  const bounds = selectedDate.value ? dayBoundsLocal(selectedDate.value) : null
  return measurements.value
    .slice()
    .sort((a, b) => Number(new Date(b.timestamp)) - Number(new Date(a.timestamp)))
    .filter(m => {
      if (pickedDevices.value.length && !pickedDevices.value.includes(m.unit)) return false
      if (pickedTemplates.value.length && !pickedTemplates.value.includes(m.type)) return false
      if (!bounds) return true
      const t = Number(new Date(m.timestamp))
      return !Number.isNaN(t) && t >= bounds.start && t <= bounds.end
    })
    .map(m => {
      const valuesCount = Array.isArray(m.values) ? m.values.length : (m.value != null ? 1 : 0)
      return {
        id: m.id,
        type: m.type,
        device: m.unit ?? '',
        date: (m as any).date || formatLocal(m.timestamp),
        count: valuesCount,
        _raw: m,
      }
    })
})

/* ---------- Detail + delete ---------- */
const detailOpen = ref(false)
const detailItem = ref<any | null>(null)
const detailIndex = ref<number>(-1)

function openDetailAtIndex(idx: number) {
  const items = filteredMeasurements.value
  if (idx < 0 || idx >= items.length) return
  detailIndex.value = idx
  detailItem.value = items[idx]?._raw ?? null
  detailOpen.value = !!detailItem.value
}
function onRowClick(_e: MouseEvent, row: any) {
  const items = filteredMeasurements.value
  const id = row?.item?.raw?.id ?? row?.item?.id ?? row?.raw?.id ?? null
  const idx = id != null ? items.findIndex(i => i.id === id) : -1
  if (idx >= 0) openDetailAtIndex(idx)
}
function prevDetail() {
  const N = filteredMeasurements.value.length
  if (N) openDetailAtIndex((detailIndex.value - 1 + N) % N)
}
function nextDetail() {
  const N = filteredMeasurements.value.length
  if (N) openDetailAtIndex((detailIndex.value + 1) % N)
}

/* Delete flow */
const confirmDeleteOpen = ref(false)
const deleteLoading = ref(false)
function askDelete() { if (detailItem.value?.id) confirmDeleteOpen.value = true }
async function confirmDelete() {
  if (!detailItem.value?.id) { confirmDeleteOpen.value = false; return }
  deleteLoading.value = true
  try {
    await measurementStore.deleteMeasurement(detailItem.value.id as number)
    confirmDeleteOpen.value = false
    detailOpen.value = false
    await loadMeasurements()
  } finally {
    deleteLoading.value = false
  }
}

/* ---------- Global hotkeys ---------- */
function onHotkeys(e: KeyboardEvent) {
  // Filters
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); selectAllDevices() }
  if (e.ctrlKey && e.altKey   && e.key.toLowerCase() === 'd') { e.preventDefault(); clearDevices() }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); selectAllTemplates() }
  if (e.ctrlKey && e.altKey   && e.key.toLowerCase() === 's') { e.preventDefault(); clearTemplates() }

  // Overview
  if (overviewOpen.value && e.key === 'Escape') { e.preventDefault(); overviewOpen.value = false }

  // Detail
  if (detailOpen.value) {
    if (e.key === 'Escape') { e.preventDefault(); detailOpen.value = false }
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'k') { e.preventDefault(); prevDetail() }
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'j') { e.preventDefault(); nextDetail() }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); askDelete() }
  }
}
onMounted(() => window.addEventListener('keydown', onHotkeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkeys))
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <!-- LEFT PANEL -->
      <v-col cols="12" md="3" class="left-panel">
        <MeasurementsFilters
          v-model:selectedDate="selectedDate"
          v-model:pickedDevices="pickedDevices"
          v-model:pickedTemplates="pickedTemplates"
          :devices="devices"
          :templates="templates"
          @select-all-devices="selectAllDevices"
          @clear-devices="clearDevices"
          @select-all-templates="selectAllTemplates"
          @clear-templates="clearTemplates"
        />
      </v-col>

      <!-- RIGHT PANEL -->
      <v-col cols="12" md="9">
        <v-card class="mb-3">
          <v-card-text class="d-flex flex-wrap align-center">
            <v-btn color="primary" class="mr-2" @click="openCreateMeasurement">VYTVOŘIT MĚŘENÍ</v-btn>
            <v-btn elevation="0" variant="tonal" @click="openOverview">PŘEHLED ŠABLON</v-btn>

            <v-spacer />

            <v-btn variant="tonal" @click="goToday">DNES</v-btn>
            <v-btn icon="mdi-chevron-left" variant="text" @click="addDays(-1)" />
            <div class="text-subtitle-1 mx-2" style="text-transform: capitalize">
              {{ selectedDate ? fmtDateLong(normalizeToDate(selectedDate)) : '' }}
            </div>
            <v-btn icon="mdi-chevron-right" variant="text" @click="addDays(1)" />
          </v-card-text>
        </v-card>

        <v-sheet elevation="1" class="pa-4 rounded-xl">
          <v-data-table
            :headers="headers"
            :items="filteredMeasurements"
            :items-per-page="10"
            class="v-data-table elevation-1 pretty-table"
            density="comfortable"
            hover
            @click:row="onRowClick"
          >
            <template #item.device="{ item }">
              <v-chip
                :color="devicesById.get(item.device)?.color || 'primary'"
                text-color="white"
                size="small"
                variant="flat"
                class="font-weight-bold"
              >
                {{ item.device || '—' }}
              </v-chip>
            </template>

            <template #no-data>
              <div class="pa-6 text-medium-emphasis text-center">
                Žádná měření pro zadané filtry.
              </div>
            </template>
          </v-data-table>
        </v-sheet>
      </v-col>
    </v-row>

    <!-- Overview -->
    <TemplatesOverviewDialog
      v-model:is-open="overviewOpen"
      v-model:selected-id="selectedTemplateId"
      v-model:search="searchTemplates"
      :templates="sortedTemplates"
      @close="closeOverview"
      @create="startCreateTemplate('overview')"
      @edit="startEditTemplate"
    />

    <!-- Template Form -->
    <TemplateFormDialog
      v-model:is-open="templateFormOpen"
      :mode="templateFormMode"
      :devices="devices"
      :initial="templateFormInitial"
      @cancel="templateFormOpen = false"
      @save="(req, id) => saveTemplate(req, id)"
    />

    <!-- Create measurement -->
    <MeasurementCreateDialog
      v-model:is-open="measurementDialogOpen"
      v-model:step="measurementStep"
      v-model:selected-device="metaSelectedDevice"
      v-model:selected-template-id="metaSelectedTemplateId"
      :devices="devices"
      :templates="availableTemplatesForDevice"
      @create-template="startCreateTemplate('measurement')"
      @save="handleCreateMeasurementSave"
    />

    <!-- Detail -->
    <MeasurementDetailDialog
      v-model:is-open="detailOpen"
      :item="detailItem"
      :devices="devices"
      @prev="prevDetail"
      @next="nextDetail"
      @delete="askDelete"
      @close="detailOpen = false"
    />

    <!-- Confirm delete -->
    <ConfirmDeleteDialog
      v-model:is-open="confirmDeleteOpen"
      :loading="deleteLoading"
      title="Smazat měření?"
      message="Tato akce je nevratná. Opravdu chcete smazat toto měření?"
      confirm-text="SMAZAT"
      cancel-text="Zrušit"
      @confirm="confirmDelete"
      @cancel="confirmDeleteOpen = false"
    />
  </v-container>
</template>

<style scoped>
/* ---------- Filter headers ---------- */
.filter-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 2px 2px 6px 2px;
}
.filter-title .title {
  font-weight: 700;
}
.filter-title .actions {
  display: inline-flex;
  gap: 14px;
}
.link-action {
  background: none;
  border: 0;
  color: #1976d2;
  font-size: 0.86rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
}
.link-action:hover {
  text-decoration: underline;
}

/* ---------- Chip selects ---------- */
.chip-select :deep(.v-field) {
  border-radius: 10px;
}
.device-chip {
  font-weight: 700;
  border-radius: 999px;
  color: #fff;
}

/* ---------- Templates overview layout ---------- */
.templates-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.templates-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 60%;
}
/* Zúžení vyhledávacího pole: menší basis + horní limit šířky */
.search {
  min-width: 240px;
  flex: 1 1 280px;
  max-width: 360px;
}
.table-header {
  display: grid;
  grid-template-columns: 120px 1fr;
  padding: 4px 10px 6px 10px;
}
.table-body {
  max-height: 420px;
  overflow-y: auto;
}
.row.template-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  padding: 8px 10px;
  border-radius: 10px;
  border: 2px solid transparent;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}
.row.template-row:hover {
  background: #f7f7fb;
}
.row.template-row.is-selected,
.row.template-row:focus-visible {
  border-color: var(--v-theme-deep-purple);
  background-color: transparent !important;
  outline: none;
}
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- Table cosmetics ---------- */
.pretty-table :deep(.v-data-table__th) {
  background: #f8f9fb;
  font-weight: 700;
}
.pretty-table :deep(tbody tr:hover) {
  background: #fbfcff;
}

.left-panel {
  flex: 0 0 360px;
  max-width: 360px;
}

.left-panel :deep(.v-date-picker) {
  width: 100%;
}
</style>
