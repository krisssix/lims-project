<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from '@/components/Dialog.vue'
import { useMeasurementStore, type MeasurementRequest, type MeasuredValue } from '@/stores/measurement'
import { useReservationsStore } from '@/stores/reservations'
import { useMeasurementTemplatesStore, type MeasurementTemplateRequest } from '@/stores/measurement-templates'

const route = useRoute()
const measurementStore = useMeasurementStore()
const reservationsStore = useReservationsStore()
const templatesStore = useMeasurementTemplatesStore()

const projectId = Number((route.params as { projectId: string }).projectId)

/* ---------- Typy ---------- */
type FieldRow = { id: string; type: 'float'|'int'|'text'|'file'|'bool'|'date'; required: boolean; name: string }
type TemplateItem = { id: string; name: string; deviceId: string; deviceColor: string; fields: FieldRow[] }
type DeviceItem = { id: string; name: string; color: string }

/* ---------- Zařízení ---------- */
const devices = computed<DeviceItem[]>(() =>
  reservationsStore.devices.map(d => ({
    id: d.code,
    name: d.code,
    color: d.color || 'primary'
  }))
)
const devicesById = computed(() => new Map(devices.value.map(d => [d.id, d])))

/* ---------- Šablony ---------- */
const templates = computed<TemplateItem[]>(() =>
  templatesStore.items.map(t => ({
    id: String(t.id),
    name: t.name,
    deviceId: t.deviceCode,                         // kód zařízení (M1…)
    deviceColor: t.deviceColor || 'primary',
    fields: (t.fields || [])
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(f => ({
        id: String(f.id ?? `tmp-${f.orderIndex}`),
        type: f.type as FieldRow['type'],
        required: !!f.required,
        name: f.name
      }))
  }))
)
const templateById = computed(() => new Map(templates.value.map(t => [t.id, t])))

/* ---------- Tabulka měření ---------- */
const measurements = ref<Array<Record<string, any>>>([])
const headers = [
  { title: 'Šablona',      key: 'type' },
  { title: 'Přístroj',     key: 'device' },
  { title: 'Datum měření', key: 'date' },
  { title: 'Počet hodnot', key: 'count' },
]

/* ---------- Filtry ---------- */
const pickedDevices = ref<string[]>([])
const pickedTemplates = ref<string[]>([])
const selectedDate = ref<string | Date | null>(null)

// normalize – když uživatel vykřížkuje poslední chip, Vuetify občas vrátí null
watch(pickedDevices, (v) => { if (!Array.isArray(v)) pickedDevices.value = [] })
watch(pickedTemplates, (v) => { if (!Array.isArray(v)) pickedTemplates.value = [] })

function selectAllDevices() { pickedDevices.value = devices.value.map(d => d.id) }
function clearDevices() { pickedDevices.value = [] }
function selectAllTemplates() { pickedTemplates.value = Array.from(new Set(templates.value.map(t => t.name))) }
function clearTemplates() { pickedTemplates.value = [] }

/* ---------- Toolbar ---------- */
function pad2(n: number) { return String(n).padStart(2, '0') }
function toYmdLocal(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function normalizeToDate(v: string | Date | null) {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 0, 0, 0, 0)
  if (typeof v === 'string') return new Date(v)
  return new Date()
}
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

/* ---------- Dialog: Přehled šablon ---------- */
const overviewOpen = ref(false)
const searchTemplates = ref('')
const selectedTemplateId = ref<string | null>(null)
const sortedTemplates = computed(() =>
  [...templates.value]
    .filter(t => {
      const q = searchTemplates.value.trim().toLowerCase()
      if (!q) return true
      return t.name.toLowerCase().includes(q) || t.deviceId.toLowerCase().includes(q)
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
)

function openOverview() {
  overviewOpen.value = true
  selectedTemplateId.value = null
  nextTick(() => {
    const el = document.querySelector('[data-templates-search] input') as HTMLInputElement | null
    el?.focus()
  })
}
function closeOverview() { overviewOpen.value = false }

/* ---------- Dialog: Formulář šablony ---------- */
const templateFormOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formName = ref<string>('')

// defaulty se nastaví po načtení zařízení
const selectedDeviceIdForForm = ref<string>('')

const fields = ref<FieldRow[]>([])
const fieldTypeOptions = [
  { label: 'Float', value: 'float' },
  { label: 'Integer', value: 'int' },
  { label: 'Text', value: 'text' },
  { label: 'Soubor', value: 'file' },
  { label: 'Boolean', value: 'bool' },
  { label: 'Date', value: 'date' },
]
const isTemplateValid = computed(() =>
  !!formName.value.trim() &&
  fields.value.length > 0 &&
  fields.value.every(f => !!f.name.trim())
)

function ensureDefaultDevice() {
  if (!selectedDeviceIdForForm.value && devices.value.length) {
    selectedDeviceIdForForm.value = devices.value[0].id
  }
}

/* nastav default jakmile dorazí zařízení */
watch(devices, ensureDefaultDevice, { immediate: true })

function startCreateTemplate(context: 'overview' | 'measurement' = 'overview') {
  formMode.value = 'create'
  formName.value = ''
  ensureDefaultDevice()
  fields.value = [{ id: `f-${Date.now()}`, type: 'float', required: true, name: 'Replika_1' }]
  templateFormOpen.value = true
  templateCreateContext.value = context
}
function startEditTemplate(item: TemplateItem) {
  formMode.value = 'edit'
  formName.value = item.name
  selectedDeviceIdForForm.value = item.deviceId
  fields.value = item.fields.map(f => ({ ...f }))
  selectedTemplateId.value = item.id
  templateFormOpen.value = true
}
function addField() {
  fields.value.push({ id: `f-${Date.now()}-${Math.floor(Math.random()*1000)}`, type: 'float', required: false, name: '' })
}
function removeField(idx: number) {
  fields.value.splice(idx, 1)
}

/* Kontext uložení šablony */
const templateCreateContext = ref<'overview'|'measurement'>('overview')

// map ref pro focus/scroll
const itemRefs = new Map<string, HTMLElement>()
function setItemRef(id: string, el: any) {
  const dom: HTMLElement | null =
    el && typeof el === 'object' && '$el' in el ? (el.$el as HTMLElement) :
      (el as HTMLElement | null)
  if (dom) itemRefs.set(id, dom)
  else itemRefs.delete(id)
}
function scrollToSelected() {
  if (!selectedTemplateId.value) return
  const el = itemRefs.get(selectedTemplateId.value)
  if (el) {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    el.focus()
  }
}

async function saveTemplate() {
  const req: MeasurementTemplateRequest = {
    name: formName.value.trim(),
    deviceCode: selectedDeviceIdForForm.value,
    fields: fields.value.map((f, i) => ({
      orderIndex: i + 1,
      type: f.type,
      required: !!f.required,
      name: f.name.trim()
    }))
  }

  if (formMode.value === 'create') {
    const saved = await templatesStore.create(projectId, req)
    selectedTemplateId.value = String(saved.id)
  } else {
    const idNum = Number(selectedTemplateId.value)
    if (!Number.isFinite(idNum)) return
    const saved = await templatesStore.update(idNum, req)
    selectedTemplateId.value = String(saved.id)
  }

  await templatesStore.fetchByProject(projectId)
  templateFormOpen.value = false

  if (templateCreateContext.value === 'overview') {
    overviewOpen.value = true
    await nextTick()
    scrollToSelected()
  } else {
    measurementDialogOpen.value = true
    measurementStep.value = 1
    const tpl = templates.value.find(t => t.id === selectedTemplateId.value)
    if (tpl) {
      metaSelectedDevice.value = tpl.deviceId
      metaSelectedTemplateId.value = tpl.id
    }
  }
}

/* ---------- Dialog: nové měření (krok 1 + krok 2) ---------- */
const measurementDialogOpen = ref(false)
const measurementStep = ref<1|2>(1)

// Meta (krok 1)
const metaSelectedDevice = ref<string>('')   // nastaví se po načtení zařízení
const metaSelectedTemplateId = ref<string | null>(null)

watch(devices, (list) => {
  if (!metaSelectedDevice.value && list.length) {
    metaSelectedDevice.value = list[0].id
  }
}, { immediate: true })

const availableTemplatesForDevice = computed(() =>
  templates.value
    .filter(t => !metaSelectedDevice.value || t.deviceId === metaSelectedDevice.value)
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
)

function openCreateMeasurement() {
  measurementDialogOpen.value = true
  measurementStep.value = 1
  if (devices.value.length) metaSelectedDevice.value = devices.value[0].id
  metaSelectedTemplateId.value = null
  valuesRows.value = []
  createdMeasurementTitle.value = ''
}
function goToStep2() {
  const id = metaSelectedTemplateId.value
  if (!id) return
  const tpl = templateById.value.get(id)
  valuesRows.value = (tpl?.fields ?? []).map((f, i) => ({
    order: i + 1,
    name: f.name,
    type: f.type,
    required: f.required,
    value: f.type === 'file' ? null : ''
  }))
  measurementStep.value = 2
}

// Primární data (krok 2)
type ValueRow = { order: number; name: string; type: 'float'|'int'|'text'|'file'|'bool'|'date'; required: boolean; value: any }
const valuesRows = ref<ValueRow[]>([])
const createdMeasurementTitle = ref<string>('')

function buildMeasuredValues(): MeasuredValue[] {
  return valuesRows.value.map((r, idx) => {
    const base = { orderIndex: r.order ?? (idx + 1), name: r.name, type: r.type } as MeasuredValue
    switch (r.type) {
      case 'float':
      case 'int': {
        const n = Number(r.value)
        return { ...base, numberValue: Number.isFinite(n) ? n : null }
      }
      case 'text':
        return { ...base, textValue: r.value != null ? String(r.value) : '' }
      case 'bool':
        return { ...base, boolValue: !!r.value }
      case 'date': {
        const ts =
          r.value instanceof Date
            ? r.value.getTime()
            : typeof r.value === 'string'
              ? Date.parse(r.value)
              : Number(r.value)
        return { ...base, dateValue: Number.isFinite(ts) ? ts : null }
      }
      case 'file':
        return { ...base, fileUrl: r?.value?.name ?? null }
      default:
        return base
    }
  })
}

const canSaveMeasurement = computed(() => {
  return valuesRows.value.every(v => !v.required || (v.value !== null && String(v.value).trim().length > 0))
})

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    const parts = text.split(/[\s,;]+/).filter(Boolean)
    let idx = 0
    for (let i = 0; i < valuesRows.value.length && idx < parts.length; i++) {
      if (valuesRows.value[i].type === 'file') continue
      const raw = parts[idx++]
      const num = Number(raw)
      valuesRows.value[i].value = Number.isFinite(num) ? num : raw
    }
  } catch (e) {
    console.warn('Clipboard read failed', e)
  }
}

async function submitNewMeasurement() {
  const firstNumeric = valuesRows.value
    .filter(v => v.type === 'float' || v.type === 'int')
    .map(v => Number(v.value))
    .find(n => Number.isFinite(n))

  const id = metaSelectedTemplateId.value
  if (!id) return
  const tpl = templateById.value.get(id)
  if (!tpl) return

  const payload: MeasurementRequest = {
    value: Number.isFinite(firstNumeric as number) ? (firstNumeric as number) : 0,
    type: tpl.name,
    unit: tpl.deviceId,      // device code (M1…)
    timestamp: Date.now(),
    values: buildMeasuredValues(),
  }
  try {
    await measurementStore.saveMeasurement(projectId, payload)
    await loadMeasurements()
    measurementDialogOpen.value = false
  } catch (e) {
    console.error(e)
  }
}

/* Vytvořit šablonu z dialogu měření */
function openCreateTemplateFromMeasurement() {
  templateCreateContext.value = 'measurement'
  startCreateTemplate('measurement')
}

/* ---------- Načtení měření + init zařízení/šablon ---------- */
async function loadMeasurements() {
  measurements.value = await measurementStore.fetchAllMeasurements(projectId)
}
onMounted(async () => {
  await reservationsStore.fetchDevices()
  await templatesStore.fetchByProject(projectId)
  await loadMeasurements()
})

/* ---------- Helpers datum ---------- */
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
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
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

/* ---------- Filtrovaná data pro tabulku ---------- */
const filteredMeasurements = computed(() => {
  const bounds = selectedDate.value ? dayBoundsLocal(selectedDate.value) : null
  return measurements.value
    .slice()
    .sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))
    .filter(m => {
      if (pickedDevices.value.length && !pickedDevices.value.includes(m.unit)) return false
      if (pickedTemplates.value.length && !pickedTemplates.value.includes(m.type)) return false
      if (!bounds) return true
      const t = toMs(m.timestamp)
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

/* ---------- Detail měření (po kliknutí na řádek) + mazání ---------- */
const detailOpen = ref(false)
const detailItem = ref<any | null>(null)
const detailIndex = ref<number>(-1)

function openDetailAtIndex(idx: number) {
  const items = filteredMeasurements.value
  if (idx < 0 || idx >= items.length) return
  detailIndex.value = idx
  const raw = items[idx]?._raw
  detailItem.value = raw || null
  detailOpen.value = !!detailItem.value
}

function onRowClick(_ev: MouseEvent, row: any) {
  const items = filteredMeasurements.value
  const id = row?.item?.raw?.id ?? row?.item?.id ?? row?.raw?.id ?? null
  const idx = id != null ? items.findIndex(i => i.id === id) : -1
  if (idx >= 0) openDetailAtIndex(idx)
}

/* Navigace v detailu (wrap) */
function prevDetail() { if (filteredMeasurements.value.length) openDetailAtIndex((detailIndex.value - 1 + filteredMeasurements.value.length) % filteredMeasurements.value.length) }
function nextDetail() { if (filteredMeasurements.value.length) openDetailAtIndex((detailIndex.value + 1) % filteredMeasurements.value.length) }

/* Stav potvrzení smazání */
const confirmDeleteOpen = ref(false)
const deleteLoading = ref(false)
function askDelete() {
  if (!detailItem.value?.id) return
  confirmDeleteOpen.value = true
}

async function confirmDelete() {
  if (!detailItem.value?.id) { confirmDeleteOpen.value = false; return }
  deleteLoading.value = true
  try {
    await measurementStore.deleteMeasurement(detailItem.value.id as number)
    confirmDeleteOpen.value = false
    detailOpen.value = false
    await loadMeasurements()
  } catch (e) {
    console.error(e)
  } finally {
    deleteLoading.value = false
  }
}
function cancelDelete() { confirmDeleteOpen.value = false }

/* ---------- Klávesové zkratky (globálně) ---------- */
function onHotkeys(e: KeyboardEvent) {
  // Filtry
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); selectAllDevices() }
  if (e.ctrlKey && e.altKey   && e.key.toLowerCase() === 'd') { e.preventDefault(); clearDevices() }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); selectAllTemplates() }
  if (e.ctrlKey && e.altKey   && e.key.toLowerCase() === 's') { e.preventDefault(); clearTemplates() }

  // Měření – dialog
  if (measurementDialogOpen.value) {
    if (e.key === 'Escape') { e.preventDefault(); measurementDialogOpen.value = false; return }
    if (measurementStep.value === 1) {
      if (e.key === 'Enter') { e.preventDefault(); goToStep2(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openCreateTemplateFromMeasurement(); return }
    } else {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (canSaveMeasurement.value) submitNewMeasurement(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        valuesRows.value.push({ order: valuesRows.value.length + 1, name: `Pole_${valuesRows.value.length + 1}`, type: 'float', required: false, value: '' })
        return
      }
    }
  }

  // Šablona – dialog
  if (templateFormOpen.value) {
    if (e.key === 'Escape') { e.preventDefault(); templateFormOpen.value = false; overviewOpen.value = (templateCreateContext.value === 'overview'); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (isTemplateValid.value) saveTemplate(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addField(); return }
  }

  // Detail – navigace a mazání
  if (!detailOpen.value) return
  if (e.key === 'Escape') { e.preventDefault(); detailOpen.value = false; return }
  if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'k') { e.preventDefault(); prevDetail(); return }
  if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'j') { e.preventDefault(); nextDetail(); return }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); askDelete(); return }
}
onMounted(() => window.addEventListener('keydown', onHotkeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkeys))
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <!-- LEFT PANEL -->
      <v-col cols="12" md="3" class="left-panel">
        <v-sheet elevation="1" class="pa-4">
          <v-date-picker
            v-model="selectedDate"
            color="primary"
            show-adjacent-months
            first-day-of-week="1"
          />
        </v-sheet>

        <v-sheet elevation="1" class="pa-4 mt-4">
          <div class="filter-title">
            <div class="title">Přístroje</div>
            <div class="actions">
              <button class="link-action" @click="selectAllDevices">
                Vybrat vše
              </button>
              <button class="link-action" @click="clearDevices">
                Zrušit výběr
              </button>
            </div>
          </div>
          <v-select
            v-model="pickedDevices"
            :items="devices"
            item-title="name"
            item-value="id"
            label="Přístroje"
            multiple
            chips
            closable-chips
            clearable
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="mb-4 chip-select"
          >
            <template #selection="{ item }">
              <v-chip
                size="large"
                rounded="lg"
                closable
                :color="item.raw.color"
                class="device-chip"
                text-color="white"
                @click:close="pickedDevices = pickedDevices.filter(id => id !== item.raw.id)"
              >
                {{ item.raw.id }}
              </v-chip>
            </template>
          </v-select>

          <div class="filter-title">
            <div class="title">Šablona</div>
            <div class="actions">
              <button class="link-action" @click="selectAllTemplates">
                Vybrat vše
              </button>
              <button class="link-action" @click="clearTemplates">
                Zrušit výběr
              </button>
            </div>
          </div>
          <v-select
            v-model="pickedTemplates"
            :items="[...new Set(templates.map(t => t.name))]"
            label="Šablona"
            multiple
            chips
            closable-chips
            clearable
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="chip-select"
          />
        </v-sheet>
      </v-col>

      <!-- RIGHT PANEL -->
      <v-col cols="12" md="9">
        <!-- Toolbar -->
        <v-card class="mb-3">
          <v-card-text class="d-flex flex-wrap align-center">
            <v-btn color="primary" class="mr-2" @click="openCreateMeasurement"
            >VYTVOŘIT MĚŘENÍ</v-btn
            >
            <v-btn
              elevation="0"
              variant="tonal"
              @click="openOverview"
            >PŘEHLED ŠABLON</v-btn
            >

            <v-spacer />

            <v-btn variant="tonal" @click="goToday">DNES</v-btn>
            <v-btn
              icon="mdi-chevron-left"
              variant="text"
              @click="addDays(-1)"
            />
            <div
              class="text-subtitle-1 mx-2"
              style="text-transform: capitalize"
            >
              {{ selectedDate ? fmtDateLong(normalizeToDate(selectedDate)) : '' }}
            </div>
            <v-btn
              icon="mdi-chevron-right"
              variant="text"
              @click="addDays(1)"
            />
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

    <!-- Dialog: Přehled šablon -->
    <Dialog
      v-model:is-open="overviewOpen"
      width="920px"
      height="808px"
      :hide-footer="false"
      class="templates-overview-dialog"
    >
      <template #header>
        <div class="templates-header">
          <div class="text-h6">Přehled šablon</div>
          <div class="templates-header-right">
            <v-text-field
              data-templates-search
              v-model="searchTemplates"
              type="search"
              prepend-inner-icon="mdi-magnify"
              placeholder="Vyhledávání..."
              variant="outlined"
              density="comfortable"
              hide-details
              class="search flex-grow-1"
              clearable
            />
            <v-btn
              color="primary"
              class="ml-3"
              @click="startCreateTemplate('overview')"
            >VYTVOŘIT ŠABLONU</v-btn
            >
          </div>
        </div>
        <div class="table-header mt-3">
          <div class="col-device text-caption text-medium-emphasis">
            Přístroj
          </div>
          <div class="col-name text-caption text-medium-emphasis">
            Název šablony
          </div>
        </div>
      </template>
      <template #content>
        <div class="table-body">
          <template v-for="tpl in sortedTemplates" :key="tpl.id">
            <div
              class="row template-row"
              :ref="el => setItemRef(tpl.id, el)"
              :tabindex="0"
              :class="{ 'is-selected': tpl.id === selectedTemplateId }"
              @click="startEditTemplate(tpl)"
            >
              <div class="col-device d-flex align-center">
                <v-chip
                  size="small"
                  :color="tpl.deviceColor"
                  text-color="white"
                  class="device-chip"
                >
                  {{ tpl.deviceId }}
                </v-chip>
              </div>
              <div class="col-name truncate">{{ tpl.name }}</div>
            </div>
            <v-divider />
          </template>
        </div>
      </template>
      <template #footer>
        <v-spacer />
        <v-btn variant="text" @click="closeOverview">Zavřít</v-btn>
      </template>
    </Dialog>

    <!-- Dialog: Formulář šablony -->
    <Dialog
      v-model:is-open="templateFormOpen"
      width="920px"
      height="808px"
      :hide-footer="false"
      class="template-form-dialog"
    >
      <template #header>
        <div class="text-h6">
          {{ formMode === 'create' ? 'Vytvoření šablony' : 'Editace šablony' }}
        </div>
      </template>
      <template #content>
        <v-row class="g-4 mb-1">
          <v-col cols="12" md="6">
            <v-text-field
              v-model="formName"
              label="Název šablony"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="selectedDeviceIdForForm"
              :items="devices"
              item-title="name"
              item-value="id"
              label="Přístroj"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            >
              <template #selection="{ item }">
                <v-chip
                  size="small"
                  :color="item.raw.color"
                  text-color="white"
                  class="ma-0"
                >{{ item.raw.name }}</v-chip
                >
              </template>
            </v-select>
          </v-col>
        </v-row>

        <div class="section-title">Zaznamenávané hodnoty</div>

        <v-data-table
          :items="fields"
          :headers="[
            { title: 'Typ', key: 'type', sortable: false },
            { title: 'Povinné', key: 'required', sortable: false, width: 120 },
            { title: 'Název pole', key: 'name', sortable: false },
            { title: '', key: 'actions', sortable: false, width: 60 },
          ]"
          class="elevation-1"
          density="comfortable"
          hide-default-footer
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
            <v-checkbox
              v-model="item.required"
              hide-details
              density="compact"
            />
          </template>
          <template #item.name="{ item }">
            <v-text-field
              v-model="item.name"
              hide-details
              density="compact"
              variant="plain"
            />
          </template>
          <template #item.actions="{ index }">
            <v-btn
              icon="mdi-delete-outline"
              color="error"
              size="x-small"
              variant="text"
              @click="removeField(index)"
            />
          </template>
        </v-data-table>

        <div class="mt-3">
          <v-btn size="small" color="primary" variant="tonal" @click="addField"
          >PŘIDAT NOVÉ POLE (Ctrl+Enter)</v-btn
          >
        </div>
      </template>
      <template #footer>
        <v-spacer />
        <v-btn
          variant="text"
          @click="() => { templateFormOpen = false; overviewOpen = templateCreateContext === 'overview' }"
        >Zrušit</v-btn
        >
        <v-btn
          color="primary"
          :disabled="!isTemplateValid"
          @click="saveTemplate"
        >Uložit (Ctrl+S)</v-btn
        >
      </template>
    </Dialog>

    <!-- Dialog: vytvoření nového měření (2 kroky) -->
    <Dialog
      v-model:is-open="measurementDialogOpen"
      width="920px"
      :hide-footer="false"
      class="measurement-create-dialog"
    >
      <template #header>
        <div class="text-h6">Vytvoření nového měření</div>
      </template>

      <template v-if="measurementStep === 1" #content>
        <div class="text-subtitle-2 mb-2">Metadata</div>
        <v-row class="g-4 mb-1">
          <v-col cols="12" md="6">
            <v-select
              v-model="metaSelectedDevice"
              :items="devices"
              item-title="name"
              item-value="id"
              label="Přístroj"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            >
              <template #selection="{ item }">
                <v-chip
                  size="small"
                  :color="item.raw.color"
                  text-color="white"
                >{{ item.raw.id }}</v-chip
                >
              </template>
            </v-select>
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="metaSelectedTemplateId"
              :items="availableTemplatesForDevice"
              item-title="name"
              item-value="id"
              label="Šablona měření"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              clearable
            />
          </v-col>
        </v-row>

        <v-spacer />

        <div class="mt-2">
          <v-alert type="info" variant="tonal" density="comfortable">
            Nemáte k dispozici potřebnou šablonu?
            <v-btn
              variant="text"
              color="primary"
              class="ml-1 px-1"
              @click="openCreateTemplateFromMeasurement"
            >
              Vytvořte si ji.
            </v-btn>
          </v-alert>
        </div>
      </template>

      <template v-else #content>
        <div class="text-subtitle-2 mb-3">Primární data</div>
        <div class="d-flex ga-2 mb-3">
          <v-btn
            size="small"
            color="primary"
            variant="tonal"
            @click="pasteFromClipboard"
          >VLOŽIT ZE SCHRÁNKY (Ctrl+V)</v-btn
          >
          <v-btn
            size="small"
            variant="tonal"
            @click="valuesRows.push({ order: valuesRows.length + 1, name: '', type: 'float', required: false, value: '' })"
          >PŘIDAT POLE (Ctrl+Enter)</v-btn
          >
        </div>
        <v-data-table
          :items="valuesRows"
          :headers="[
            { title: 'Poř.č.', key: 'order', width: 80 },
            { title: 'Název pole', key: 'name' },
            { title: 'Vstupní prvek', key: 'value', sortable: false },
          ]"
          item-key="order"
          hide-default-footer
          class="elevation-1"
          density="comfortable"
        >
          <template #item.name="{ item }">
            <div class="d-inline-flex align-center" style="gap: 8px">
              <span>{{ item.name }}</span>
              <v-chip
                size="x-small"
                color="blue-lighten-4"
                text-color="primary"
                class="text-caption"
              >{{ item.type }}</v-chip
              >
            </div>
          </template>
          <template #item.value="{ item }">
            <div
              v-if="item.type === 'file'"
              class="d-flex align-center"
              style="gap: 8px"
            >
              <v-file-input
                density="comfortable"
                hide-details
                variant="outlined"
                accept="image/*,.csv,.txt"
                v-model="item.value"
              />
            </div>
            <v-text-field
              v-else
              :model-value="item.value"
              @update:model-value="val => item.value = val"
              :placeholder="item.required ? 'Zadejte hodnotu...' : 'Volitelné...'"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </template>
        </v-data-table>
      </template>

      <template #footer>
        <v-btn variant="text" @click="measurementDialogOpen = false"
        >Zrušit (Esc)</v-btn
        >
        <v-spacer />
        <v-btn
          v-if="measurementStep === 1"
          color="primary"
          :disabled="!metaSelectedTemplateId"
          @click="goToStep2"
        >Pokračovat (Enter)</v-btn
        >
        <v-btn
          v-else
          color="primary"
          :disabled="!canSaveMeasurement"
          @click="submitNewMeasurement"
        >Uložit (Ctrl+S)</v-btn
        >
      </template>
    </Dialog>

    <!-- Dialog: detail měření -->
    <Dialog
      v-model:is-open="detailOpen"
      width="920px"
      height="808px"
      :hide-footer="false"
    >
      <template #header>
        <div class="d-flex align-center justify-space-between">
          <div class="text-h6">Detail měření</div>
          <div class="d-flex align-center" style="gap: 8px"></div>
        </div>
      </template>
      <template #content>
        <v-row class="g-4 mb-1">
          <v-col cols="12" md="6">
            <v-text-field
              :model-value="detailItem?.type"
              label="Šablona"
              variant="outlined"
              density="comfortable"
              readonly
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              :model-value="detailItem?.unit"
              :items="devices"
              item-title="name"
              item-value="id"
              label="Přístroj"
              variant="outlined"
              density="comfortable"
              readonly
            >
              <template #selection="{ item }">
                <v-chip
                  size="small"
                  :color="item.raw.color"
                  text-color="white"
                >{{ item.raw.id }}</v-chip
                >
              </template>
            </v-select>
          </v-col>
        </v-row>

        <div class="text-subtitle-2">Naměřené hodnoty</div>
        <v-data-table
          :items="(detailItem?.values && detailItem.values.length ? detailItem.values : [{
          orderIndex: 1,
          name: 'Hodnota',
          type: 'float',
          numberValue: detailItem?.value
        }]).map((v: any) => {
          let displayValue = ''
          if (v.numberValue !== undefined && v.numberValue !== null) displayValue = String(v.numberValue)
          else if (v.textValue) displayValue = v.textValue
          else if (typeof v.boolValue === 'boolean') displayValue = v.boolValue ? 'true' : 'false'
          else if (v.dateValue) displayValue = new Date(v.dateValue).toLocaleString()
          else if (v.fileUrl) displayValue = v.fileUrl
          return {
            order: v.orderIndex,
            name: v.name,
            type: v.type,
            value: displayValue
          }
        })"
          :headers="[
          { title: 'Poř.č.', key: 'order', width: 80 },
          { title: 'Název pole', key: 'name' },
          { title: 'Typ', key: 'type', width: 140 },
          { title: 'Hodnota', key: 'value' },
        ]"
          density="comfortable"
          hide-default-footer
          class="elevation-1 mt-2"
        />
      </template>
      <template #footer>
        <v-btn
          color="error"
          variant="outlined"
          prepend-icon="mdi-delete-outline"
          @click="askDelete"
        >Smazat</v-btn
        >
        <v-spacer />
        <v-btn variant="text" @click="detailOpen = false">Zavřít (Esc)</v-btn>
      </template>
    </Dialog>

    <!-- Potvrzení smazání -->
    <Dialog
      v-model:is-open="confirmDeleteOpen"
      width="520px"
      :hide-footer="true"
    >
      <template #content>
        <div class="pa-4">
          <div class="text-h6 mb-2">Smazat měření?</div>
          <div class="mb-4">
            Tato akce je nevratná. Opravdu chcete smazat toto měření?
          </div>
          <div class="d-flex" style="gap: 12px">
            <v-btn color="error" :loading="deleteLoading" @click="confirmDelete"
            >SMAZAT</v-btn
            >
            <v-spacer />
            <v-btn variant="tonal" @click="cancelDelete">Zrušit</v-btn>
          </div>
        </div>
      </template>
    </Dialog>
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
