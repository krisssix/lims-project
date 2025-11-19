<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import LeftFiltersPanel from '@/components/LeftFiltersPanel.vue'
import Dialog from '@/components/Dialog.vue'
import RepeatSetsControls from '@/components/import/RepeatSetControls.vue'
import MeasurementTable from '@/components/measurement/MeasurementTable.vue'
import TemplatesOverviewDialog from '@/components/measurement/TemplatesOverviewDialog.vue'
/*  import TemplateFormDialog from '@/components/measurement/TemplateFormDialog.vue'*/
/*  import TemplateFromClipboardDialog from '@/components/import/TemplateFromClipboardDialog.vue'*/
import MeasurementCreateDialog from '@/components/measurement/MeasurementCreateDialog.vue'
import MeasurementDetailDialog from '@/components/measurement/MeasurementDetailDialog.vue'

import { useMeasurementStore, type MeasurementRequest, type MeasurementResponse } from '@/stores/measurement'
import { useReservationsStore } from '@/stores/reservations'
import { useMeasurementTemplatesStore, type MeasurementTemplateRequest } from '@/stores/measurement-templates'
import { useImportStore } from '@/stores/import'
import { type DeviceItem, type TemplateItem, type FieldRow, type TableHeader } from '@/types/measurement-ui'
import { useProjectStore } from '@/stores/project/project'
import { auth } from '@/stores/auth'

/* Stores + route */
const route = useRoute()
const projectId = Number((route.params as { projectId: string }).projectId)
const measurementStore = useMeasurementStore()
const reservationsStore = useReservationsStore()
const templatesStore = useMeasurementTemplatesStore()
const importStore = useImportStore()
const projectStore = useProjectStore()

/* Devices */
const devices = computed<DeviceItem[]>(() =>
  reservationsStore.devices.map(d => ({ id: d.code, name: d.code, color: d.color || 'primary' }))
)
const devicesById = computed(() => new Map(devices.value.map(d => [d.id, d])))

/* Templates */
const templates = computed<TemplateItem[]>(() =>
  templatesStore.items.map(t => ({
    id: String(t.id),
    name: t.name,
    deviceId: t.deviceCode,
    deviceColor: t.deviceColor || 'primary',
    fields: (t.fields || [])
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(f => ({ id: String(f.id ?? `tmp-${f.orderIndex}`), type: f.type as FieldRow['type'], required: !!f.required, name: f.name }))
  }))
)
const templateById = computed(() => new Map(templates.value.map(t => [t.id, t])))

/* Members (uživatelé) */
const membersList = computed<string[]>(() => projectStore.projectMembers.map((m: { username: string }) => m.username))
const currentUsername = computed<string>(() => auth.getUserInfo().preferredUsername || '')

/* Toolbar + filters */
const isSideFilterOpen = ref(false)
const selectedDate = ref<string | Date | null>(null)
const headers = ref<TableHeader[]>([
  { title: 'Šablona',      key: 'type' },
  { title: 'Přístroj',     key: 'device' },
  { title: 'Datum měření', key: 'date' },
  { title: 'Počet hodnot', key: 'count' },
  { title: 'Člen',         key: 'user' }, // NEW: visible column
])

const leftSelection = ref<Record<string, string[]>>({ devices: [], templates: [] })
const leftGroups = computed(() => [
  { key: 'devices', title: 'Přístroje', label: 'Přístroje', items: devices.value, itemTitle: 'name', itemValue: 'id', type: 'devices' as const, colorKey: 'color', showField: 'id' },
  { key: 'templates', title: 'Šablona', label: 'Šablona', items: Array.from(new Set(templates.value.map(t => t.name))).map(n => ({ id: n, name: n })), itemTitle: 'name', itemValue: 'id', type: 'plain' as const },
])
const pickedDevices = ref<string[]>([])
const pickedTemplates = ref<string[]>([])
function arraysEqual(a: string[], b: string[]) { if (a.length !== b.length) return false; const as = [...a].sort(), bs = [...b].sort(); return as.every((v, i) => v === bs[i]) }
watch(leftSelection, (sel) => {
  const devs = Array.isArray(sel.devices) ? sel.devices : []
  const tpls = Array.isArray(sel.templates) ? sel.templates : []
  if (!arraysEqual(devs, pickedDevices.value)) pickedDevices.value = [...devs]
  if (!arraysEqual(tpls, pickedTemplates.value)) pickedTemplates.value = [...tpls]
}, { deep: true, immediate: true })
watch(pickedDevices, (v) => { const next = Array.isArray(v) ? v : []; if (!arraysEqual(next, leftSelection.value.devices)) leftSelection.value.devices = [...next] })
watch(pickedTemplates, (v) => { const next = Array.isArray(v) ? v : []; if (!arraysEqual(next, leftSelection.value.templates)) leftSelection.value.templates = [...next] })
function pad2(n: number) { return String(n).padStart(2, '0') }
function toYmdLocal(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function normalizeToDate(v: string | Date | null) { if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 0,0,0,0); if (typeof v === 'string') return new Date(v); return new Date() }
const fmtDateLongFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtDateLong = (d: Date) => fmtDateLongFmt.format(d)
function addDays(n: number) { const base = selectedDate.value ? normalizeToDate(selectedDate.value) : new Date(); base.setDate(base.getDate() + n); selectedDate.value = toYmdLocal(base) }
function goToday() { const today = toYmdLocal(new Date()); selectedDate.value = selectedDate.value === today ? null : today }

/* Data načtení + filtrování */
function toMs(v: unknown): number {
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string') { const ms = Date.parse(v); if (!Number.isNaN(ms)) return ms }
  return NaN
}
function formatLocal(ts: unknown): string {
  const ms = toMs(ts); if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleString(undefined, { year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false })
}
function dayBoundsLocal(val: string | Date) {
  const base = (val instanceof Date) ? val : (/^\d{4}-\d{2}-\d{2}$/.test(val as string) ? new Date((val as string) + 'T00:00:00') : new Date(val as string))
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0,0,0,0).getTime()
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23,59,59,999).getTime()
  return { start, end }
}
const measurementsSorted = computed<MeasurementResponse[]>(() => {
  const list = measurementStore.allMeasurements || []
  return list.slice().sort((a,b) => toMs(b.timestamp) - toMs(a.timestamp))
})
const filteredMeasurements = computed(() => {
  const bounds = selectedDate.value ? dayBoundsLocal(selectedDate.value) : null
  return measurementsSorted.value
    .filter(m => {
      if (pickedDevices.value.length && !pickedDevices.value.includes(m.unit)) return false
      if (pickedTemplates.value.length && !pickedTemplates.value.includes(m.type)) return false
      if (!bounds) return true
      const t = toMs(m.timestamp)
      return !Number.isNaN(t) && t >= bounds.start && t <= bounds.end
    })
    .map(m => {
      const valuesCount = Array.isArray(m.values) ? m.values.length : (m.value != null ? 1 : 0)
      const user = (m as unknown as { measuredByUsername?: string | null }).measuredByUsername ?? '—'
      const note = (m as unknown as { note?: string | null }).note ?? null
      return {
        id: m.id,
        type: m.type,
        device: m.unit ?? '',
        user,                 // NEW
        date: formatLocal(m.timestamp),
        count: valuesCount,
        note,                 // NEW
        _raw: m
      }
    })
})

/* Dialogy – Overview + Form (šablony) */
const overviewOpen = ref(false)
const formOpen = ref(false)
const formMode = ref<'create'|'edit'>('create')
const selectedTemplateId = ref<string | null>(null)
const deleteTemplateConfirmOpen = ref(false)
const deleteTemplateLoading = ref(false)
const formName = ref<string>('')
const formDeviceId = ref<string>('')
const formFields = ref<FieldRow[]>([])

function openOverview() { overviewOpen.value = true }

function openImportTemplate() {
  templateFromClipboardOpen.value = true
}


function startEditTemplate(t: TemplateItem) {
  formMode.value = 'edit'
  selectedTemplateId.value = t.id
  formName.value = t.name
  formDeviceId.value = t.deviceId
  formFields.value = t.fields.map(f => ({ ...f }))
  formOpen.value = true
}


async function saveTemplate(req: MeasurementTemplateRequest) {
  if (formMode.value === 'create') {
    const saved = await templatesStore.create(projectId, req)
    selectedTemplateId.value = String(saved.id)
  } else {
    const idNum = Number(selectedTemplateId.value)
    if (Number.isFinite(idNum)) await templatesStore.update(idNum, req)
  }
  await templatesStore.fetchByProject(projectId)
  formOpen.value = false
  overviewOpen.value = true
}
function askDeleteTemplate() {
  if (formMode.value !== 'edit' || !selectedTemplateId.value) return
  deleteTemplateConfirmOpen.value = true
}
async function confirmDeleteTemplate() {
  const idNum = Number(selectedTemplateId.value)
  if (!Number.isFinite(idNum)) { deleteTemplateConfirmOpen.value = false; return }
  deleteTemplateLoading.value = true
  try {
    await templatesStore.remove(idNum)
    await templatesStore.fetchByProject(projectId)
    deleteTemplateConfirmOpen.value = false
    formOpen.value = false
    overviewOpen.value = true
    selectedTemplateId.value = null
  } finally {
    deleteTemplateLoading.value = false
  }
}

const templateWizardOpen = ref(false)
const wizardMode = ref<'empty' | 'import'>('empty')

function startCreateTemplate() {
  wizardMode.value = 'empty'
  templateWizardOpen.value = true
}

function startCreateTemplateFromFile() {
  wizardMode.value = 'import'
  templateWizardOpen.value = true
}
/* Template ze schránky dialog (rychlé vytvoření) */
const templateFromClipboardOpen = ref(false)
async function createTemplateFromClipboard(payload: {
  deviceCode: string
  templateName: string
  fields: Array<{ orderIndex: number; type: FieldRow['type']; required: boolean; name: string }>
}) {
  const req: MeasurementTemplateRequest = {
    name: payload.templateName.trim() || 'Šablona',
    deviceCode: payload.deviceCode,
    fields: payload.fields
  }
  const saved = await templatesStore.create(projectId, req)
  await templatesStore.fetchByProject(projectId)

  // preselect + rovnou „nové měření“
  metaSelectedDevice.value = payload.deviceCode
  metaSelectedTemplateId.value = String(saved.id)

  templateWizardOpen.value = false
  measurementCreateOpen.value = true
}


/* Vytvoření měření */
const measurementCreateOpen = ref(false)
const metaSelectedDevice = ref<string>('') // jen pro “preset” v childu
const metaSelectedTemplateId = ref<string | null>(null) // jen pro preset (child má vlastní v-model)
const repeatEnabled = ref<boolean>(false)
const repeatCount = ref<number>(1)
const repeatIndex = ref<number>(1)
function gotoPrevSet() { if (repeatEnabled.value) repeatIndex.value = Math.max(1, repeatIndex.value - 1) }
function gotoNextSet() { if (repeatEnabled.value) repeatIndex.value = Math.min(repeatCount.value, repeatIndex.value + 1) }

async function onSaveMeasurement(payload: MeasurementRequest) {
  await measurementStore.saveMeasurement(projectId, payload)
  if (!repeatEnabled.value || repeatIndex.value >= repeatCount.value) {
    await loadMeasurements()
    measurementCreateOpen.value = false
    repeatIndex.value = 1
  } else {
    repeatIndex.value += 1
  }
}

/* Detail měření */
const detailOpen = ref(false)
const detailItem = ref<MeasurementResponse | null>(null)
const snackbar = ref<{ open: boolean; text: string }>({ open: false, text: '' })
function openDetailById(id: number) {
  const raw = (filteredMeasurements.value.find(i => i.id === id)?._raw ?? null) as MeasurementResponse | null
  detailItem.value = raw
  detailOpen.value = !!raw
}

function prevDetail() {
  const items = filteredMeasurements.value
  if (!detailItem.value || !items.length) return
  const idx = items.findIndex(i => i.id === detailItem.value?.id)
  const nextIdx = (idx - 1 + items.length) % items.length
  openDetailById(items[nextIdx].id)
}
function nextDetail() {
  const items = filteredMeasurements.value
  if (!detailItem.value || !items.length) return
  const idx = items.findIndex(i => i.id === detailItem.value?.id)
  const nextIdx = (idx + 1) % items.length
  openDetailById(items[nextIdx].id)
}

async function saveDetail(payload: {
  value: number
  type: string
  unit: string
  timestamp: number
  values: unknown
  boardCardId: number | null
  note: string | null
  measuredByUsername: string | null
}) {
  if (!detailItem.value) return
  await measurementStore.updateMeasurement(
    detailItem.value.id,
    payload as unknown as Partial<MeasurementRequest>
  )
  await loadMeasurements()
  snackbar.value = { open: true, text: 'Měření upraveno' }
  detailOpen.value = false
}

const confirmDeleteOpen = ref(false)
const deleteLoading = ref(false)
function askDelete() { confirmDeleteOpen.value = true }
async function confirmDelete() {
  if (!detailItem.value?.id) { confirmDeleteOpen.value = false; return }
  deleteLoading.value = true
  try {
    await measurementStore.deleteMeasurement(detailItem.value.id)
    confirmDeleteOpen.value = false
    detailOpen.value = false
    await loadMeasurements()
    snackbar.value = { open: true, text: 'Měření smazáno' }
  } finally {
    deleteLoading.value = false
  }
}
function cancelDelete() { confirmDeleteOpen.value = false }

/* Načtení */
async function loadMeasurements() { await measurementStore.fetchAllMeasurements(projectId) }
onMounted(async () => {
  await reservationsStore.fetchDevices()
  await templatesStore.fetchByProject(projectId)
  await projectStore.fetchProjectMembers(projectId)
  await loadMeasurements()
})

/* Hotkeys – sjednoceno */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = (el.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}
function onHotkeys(e: KeyboardEvent) {
  const editable = isEditableTarget(e.target)
  if (!formOpen.value && !measurementCreateOpen.value && !overviewOpen.value && !detailOpen.value && editable) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); isSideFilterOpen.value = !isSideFilterOpen.value; return }
  if (e.key === 'ArrowLeft' && !measurementCreateOpen.value) { e.preventDefault(); addDays(-1); return }
  if (e.key === 'ArrowRight' && !measurementCreateOpen.value) { e.preventDefault(); addDays(1); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') { e.preventDefault(); goToday(); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); measurementCreateOpen.value = true; return }
}
onMounted(() => window.addEventListener('keydown', onHotkeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkeys))
</script>

<template>
  <v-container fluid class="pa-0">
    <v-toolbar color="white" class="border-b-sm pl-3 pr-3" density="comfortable">
      <v-btn color="primary" variant="tonal" @click="isSideFilterOpen = !isSideFilterOpen">Procházet</v-btn>
      <v-btn color="primary" class="ml-2" @click="measurementCreateOpen = true">VYTVOŘIT MĚŘENÍ</v-btn>
      <v-btn elevation="0" variant="tonal" class="ml-2" @click="openOverview">PŘEHLED ŠABLON</v-btn>
      <v-spacer />
      <div class="text-subtitle-1 mx-2" style="text-transform: capitalize; min-width: 180px;">
        {{ selectedDate ? fmtDateLong(normalizeToDate(selectedDate)) : '' }}
      </div>
      <v-btn variant="tonal" @click="goToday" title="Dnes (Ctrl+T)">DNES</v-btn>
      <v-btn icon="mdi-chevron-left" variant="text" @click="addDays(-1)" />
      <v-btn icon="mdi-chevron-right" variant="text" @click="addDays(1)" />
    </v-toolbar>

    <v-container fluid class="pa-4">
      <v-row>
        <v-col v-if="isSideFilterOpen" cols="12" md="3">
          <LeftFiltersPanel v-model:date="selectedDate" v-model:selection="leftSelection" :groups="leftGroups" />
        </v-col>

        <v-col :cols="12" :md="isSideFilterOpen ? 9 : 12">
          <v-sheet elevation="1" class="pa-4 rounded-xl">
            <MeasurementTable
              :headers="headers"
              :items="filteredMeasurements"
              :devices-by-id="devicesById"
              @row-click="openDetailById"
            />
          </v-sheet>
        </v-col>
      </v-row>

      <TemplatesOverviewDialog
        v-model="overviewOpen"
        :templates="templates"
        :selected-template-id="selectedTemplateId"
        @edit="startEditTemplate"
        @createBlank="startCreateTemplate"
        @createFromFile="openImportTemplate"
      />

      <TemplateWizardDialog
        v-model="templateWizardOpen"
        :devices="devices"
        :initial-mode="wizardMode"
        :on-confirm="createTemplateFromClipboard"
      />

      <teleport to="body">
        <Dialog v-model:is-open="deleteTemplateConfirmOpen" width="520px" :hide-footer="true">
          <template #content>
            <form class="pa-4" @submit.prevent="confirmDeleteTemplate" @keydown.enter.prevent="confirmDeleteTemplate">
              <div class="text-h6 mb-2">Smazat šablonu?</div>
              <div class="mb-4">Tato akce je nevratná. Opravdu chcete smazat tuto šablonu?</div>
              <div class="d-flex" style="gap: 12px">
                <v-btn type="submit" color="error" :loading="deleteTemplateLoading" :disabled="deleteTemplateLoading || !selectedTemplateId">Smazat</v-btn>
                <v-spacer />
                <v-btn variant="tonal" :disabled="deleteTemplateLoading" @click="() => deleteTemplateConfirmOpen = false">Zrušit</v-btn>
              </div>
            </form>
          </template>
        </Dialog>
      </teleport>

      <MeasurementCreateDialog
        v-model="measurementCreateOpen"
        :devices="devices"
        :templates="templates"
        :template-by-id="templateById"
        @createTemplate="startCreateTemplate"
        @createTemplateFromClipboard="() => { templateFromClipboardOpen = true }"
        @save="onSaveMeasurement"
      >
        <template #above-values>
          <RepeatSetsControls
            :enabled="repeatEnabled"
            :count="repeatCount"
            :index="repeatIndex"
            @update:enabled="v => repeatEnabled = v"
            @update:count="v => repeatCount = v"
            @update:index="v => repeatIndex = v"
            @prev="gotoPrevSet"
            @next="gotoNextSet"
          />
        </template>
      </MeasurementCreateDialog>


      <MeasurementDetailDialog
        v-model="detailOpen"
        :item="detailItem"
        :devices="devices"
        :members="membersList"
        :templates="templates"
        :current-username="currentUsername"
        @save="saveDetail"
        @delete="askDelete"
        @prev="prevDetail"
        @next="nextDetail"
      />

      <Dialog v-model:is-open="confirmDeleteOpen" width="520px" :hide-footer="true">
        <template #content>
          <form class="pa-4" @submit.prevent="confirmDelete" @keydown.enter.prevent="confirmDelete">
            <div class="text-h6 mb-2">Smazat měření?</div>
            <div class="mb-4">Tato akce je nevratná. Opravdu chcete smazat toto měření?</div>
            <div class="d-flex" style="gap: 12px">
              <v-btn color="primary" size="large" :loading="deleteLoading" :disabled="deleteLoading || !detailItem?.id" @click="confirmDelete">Smazat měření</v-btn>
              <v-spacer />
              <v-btn variant="tonal" color="text" size="large" :disabled="deleteLoading" @click="cancelDelete">Ponechat</v-btn>
            </div>
          </form>
        </template>
      </Dialog>

      <v-snackbar v-model="snackbar.open" :timeout="2200">{{ snackbar.text }}</v-snackbar>
    </v-container>
  </v-container>
</template>

<style scoped>
.pretty-table :deep(.v-data-table__th) { background: #f8f9fb; font-weight: 700; }
.pretty-table :deep(tbody tr:hover) { background: #fbfcff; }
</style>
