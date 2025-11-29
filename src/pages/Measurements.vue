<script setup lang="ts" name=src/pages/Measurements.vue>
import { computed, ref, onMounted, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import LeftFiltersPanel from '@/components/LeftFiltersPanel.vue'
import Dialog from '@/components/Dialog.vue'
import TemplateFromClipboardDialog from '@/components/import/TemplateFromClipboardDialog.vue'
import RepeatSetsControls from '@/components/import/RepeatSetControls.vue'

import MeasurementTable from '@/components/measurement/MeasurementTable.vue'
import TemplatesOverviewDialog from '@/components/measurement/TemplatesOverviewDialog.vue'
import TemplateWizardDialog from '@/components/import/TemplateWizardDialog.vue'
import MeasurementCreateDialog from '@/components/measurement/MeasurementCreateDialog.vue'
import MeasurementDetailDialog from '@/components/measurement/MeasurementDetailDialog.vue'

import {
  useMeasurementStore,
  type MeasurementRequest,
  type MeasurementResponse,
  type ValueType
} from '@/stores/measurement'
import { useReservationsStore } from '@/stores/reservations'
import {
  useMeasurementTemplatesStore,
  type WizardTemplatePayload
} from '@/stores/measurement-templates'
import { useImportStore } from '@/stores/import'
import {type DeviceItem, type TemplateItem, type TableHeader, type TemplateBlockRow} from '@/types/measurement-ui'
import { useProjectStore } from '@/stores/project/project'
import { auth } from '@/stores/auth'

const route = useRoute()
const projectId = Number((route.params as { projectId: string }).projectId)
const measurementStore = useMeasurementStore()
const reservationsStore = useReservationsStore()
const importStore = useImportStore()
const projectStore = useProjectStore()

/* Devices */
const devices = computed<DeviceItem[]>(() =>
  reservationsStore.devices.map(d => ({ id: d.code, name: d.code, color: d.color || 'primary' }))
)
const devicesById = computed(() => new Map(devices.value.map(d => [d.id, d])))

/* Templates */
const templatesStore = useMeasurementTemplatesStore()

type FieldType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
type FieldRow = { orderIndex: number; type: FieldType; required: boolean; name: string }

/* Templates - s bloky */
const templates = computed<TemplateItem[]>(() =>
  templatesStore.items.map(t => {
    // Pokud má šablona bloky, použij je
    const blocks: TemplateBlockRow[] = (t.blocks && t.blocks.length > 0)
      ? t. blocks. map(b => ({
        id: b.id,
        blockIndex: b.blockIndex,
        kind: b.kind,
        title: b.title || `Blok ${b.blockIndex}`,
        fields: (b. fields || []).map(f => ({
          orderIndex: f.orderIndex,
          type: f.type as ValueType,
          required: !!f.required,
          name: f.name
        }))
      }))
      : [{
        id: 0,
        blockIndex: 1,
        title: 'Hodnoty',
        fields: (t.fields || []). map(f => ({
          orderIndex: f.orderIndex,
          type: f.type as ValueType,
          required: !!f.required,
          name: f.name
        }))
      }]

    return {
      id: String(t.id),
      name: t.name,
      deviceId: t.deviceCode,
      deviceColor: t.deviceColor || 'primary',
      fields: (t.fields || [])
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(f => ({
          orderIndex: f.orderIndex,
          type: f.type as ValueType,
          required: !!f.required,
          name: f.name
        })),
      blocks  // <-- PŘIDAT TOTO
    }
  })
)

const templateById = computed(() => new Map(templates.value.map(t => [t.id, t])))

/* Wizard confirm – TADY se volá create/update šablony */
const snackbar = ref<{ open: boolean; text: string }>({ open: false, text: '' })

async function handleTemplateConfirm(payload: WizardTemplatePayload): Promise<void> {
  try {
    if (payload.templateId) {
      const idNum = Number(payload.templateId)
      if (Number.isFinite(idNum)) {
        await templatesStore.updateFromWizard(projectId, idNum, payload)
      }
    } else {
      await templatesStore.createFromWizard(projectId, payload)
    }
    await templatesStore.fetchByProject(projectId)
    templateWizardOpen.value = false
    initialWizardTemplate.value = null
    overviewOpen.value = true
  } catch (error) {
    let msg = 'Nepodařilo se uložit data.'
    const maybeApi = error as { statusCode?: number; message?: string; response?: { data?: unknown } }
    if (maybeApi?.statusCode === 400) {
      msg = 'Šablona je neplatná. Zkontroluj bloky a pole.'
    } else if (maybeApi?.statusCode === 404) {
      msg = 'Šablona nebyla nalezena (404).'
    } else if (maybeApi?.message) {
      msg = maybeApi.message
    }
    console.error('Template operation failed:', error)
    snackbar.value = { open: true, text: msg }
  }
}

/* Members */
const membersList = computed<string[]>(() => projectStore.projectMembers.map((m: { username: string }) => m.username))
const currentUsername = computed<string>(() => auth.getUserInfo().preferredUsername || '')

/* Toolbar + filters – nechávám beze změn (už ti fungují) */
const isSideFilterOpen = ref(false)
const selectedDate = ref<string | Date | null>(null)
const headers = ref<TableHeader[]>([
  { title: 'Šablona',      key: 'type' },
  { title: 'Přístroj',     key: 'device' },
  { title: 'Datum měření', key: 'date' },
  { title: 'Počet hodnot', key: 'count' },
  { title: 'Člen',         key: 'user' },
])

const leftSelection = ref<Record<string, string[]>>({ devices: [], templates: [] })
const leftGroups = computed(() => [
  { key: 'devices', title: 'Přístroje', label: 'Přístroje', items: devices.value, itemTitle: 'name', itemValue: 'id', type: 'devices' as const, colorKey: 'color', showField: 'id' },
  { key: 'templates', title: 'Šablona', label: 'Šablona', items: Array.from(new Set(templates.value.map(t => t.name))).map(n => ({ id: n, name: n })), itemTitle: 'name', itemValue: 'id', type: 'plain' as const },
])
const pickedDevices = ref<string[]>([])
const pickedTemplates = ref<string[]>([])
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const as = [...a].sort()
  const bs = [...b].sort()
  return as.every((v, i) => v === bs[i])
}
watch(leftSelection, (sel) => {
  const devs = Array.isArray(sel.devices) ? sel.devices : []
  const tpls = Array.isArray(sel.templates) ? sel.templates : []
  if (!arraysEqual(devs, pickedDevices.value)) pickedDevices.value = [...devs]
  if (!arraysEqual(tpls, pickedTemplates.value)) pickedTemplates.value = [...tpls]
}, { deep: true, immediate: true })
watch(pickedDevices, (v) => {
  const next = Array.isArray(v) ? v : []
  if (!arraysEqual(next, leftSelection.value.devices)) leftSelection.value.devices = [...next]
})
watch(pickedTemplates, (v) => {
  const next = Array.isArray(v) ? v : []
  if (!arraysEqual(next, leftSelection.value.templates)) leftSelection.value.templates = [...next]
})
function pad2(n: number): string { return String(n).padStart(2, '0') }
function toYmdLocal(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function normalizeToDate(v: string | Date | null): Date {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 0, 0, 0, 0)
  if (typeof v === 'string') return new Date(v)
  return new Date()
}
const fmtDateLongFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtDateLong = (d: Date): string => fmtDateLongFmt.format(d)
function addDays(n: number): void {
  const base = selectedDate.value ? normalizeToDate(selectedDate.value) : new Date()
  base.setDate(base.getDate() + n)
  selectedDate.value = toYmdLocal(base)
}
function goToday(): void {
  const today = toYmdLocal(new Date())
  selectedDate.value = selectedDate.value === today ? null : today
}

/* Filtrování měření – nechávám, funguje */
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
    hour12: false
  })
}
function dayBoundsLocal(val: string | Date) {
  const base = val instanceof Date
    ? val
    : (/^\d{4}-\d{2}-\d{2}$/.test(val as string)
      ? new Date((val as string) + 'T00:00:00')
      : new Date(val as string))
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0).getTime()
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999).getTime()
  return { start, end }
}
const measurementsSorted = computed<MeasurementResponse[]>(() => {
  const list = measurementStore.allMeasurements || []
  return list.slice().sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))
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
        user,
        date: formatLocal(m.timestamp),
        count: valuesCount,
        note,
        _raw: m
      }
    })
})

/* Dialogy – Overview + šablony */
const overviewOpen = ref(false)
const selectedTemplateId = ref<string | null>(null)
const deleteTemplateConfirmOpen = ref(false)
const deleteTemplateLoading = ref(false)

function openOverview(): void { overviewOpen.value = true }
function openImportTemplate(): void { templateFromClipboardOpen.value = true }

function startEditTemplate(t: TemplateItem): void {
  selectedTemplateId. value = t.id
  wizardMode.value = 'empty'
  const fullTemplate = templatesStore.items.find(tpl => String(tpl.id) === t.id)

  initialWizardTemplate.value = {
    templateId: t.id,
    name: t.name,
    deviceCode: t. deviceId,
    fields: t.fields.map((f, i) => ({
      orderIndex: i + 1,
      type: f.type,
      required: f. required,
      name: f.name,
    })),
    blocks: fullTemplate?.blocks?. map(b => ({
      blockIndex: b. blockIndex,
      title: b.title ??  `Blok ${b.blockIndex}`,
      fields: (b.fields ?? []).map((f, i) => ({
        orderIndex: i + 1,
        type: f.type as FieldType,
        required: !!f.required,
        name: f.name,
      })),
    })) ?? [],
  }
  templateWizardOpen.value = true
}

function askDeleteTemplate(): void {
  if (!selectedTemplateId.value) return
  deleteTemplateConfirmOpen.value = true
}
async function confirmDeleteTemplate(): Promise<void> {
  const idNum = Number(selectedTemplateId.value)
  if (!Number.isFinite(idNum)) {
    deleteTemplateConfirmOpen.value = false
    return
  }
  deleteTemplateLoading.value = true
  try {
    await templatesStore.remove(idNum)
    await templatesStore.fetchByProject(projectId)
    deleteTemplateConfirmOpen.value = false
    templateWizardOpen.value = false
    overviewOpen.value = true
    selectedTemplateId.value = null
    initialWizardTemplate.value = null
  } finally {
    deleteTemplateLoading.value = false
  }
}
const templateWizardOpen = ref(false)
const wizardMode = ref<'empty' | 'import'>('empty')
const initialWizardTemplate = ref<{
  templateId: string
  name: string
  deviceCode: string
  fields: Array<{ orderIndex: number; type: FieldType; required: boolean; name: string }>
  blocks?: Array<{
    blockIndex: number
    title: string
    fields: Array<{ orderIndex: number; type: FieldType; required: boolean; name: string }>
  }>
} | null>(null)

function startCreateTemplate(): void {
  wizardMode.value = 'empty'
  initialWizardTemplate.value = null
  templateWizardOpen.value = true
}
function startCreateTemplateFromFile(): void {
  wizardMode.value = 'import'
  initialWizardTemplate.value = null
  templateWizardOpen.value = true
}

/* Template ze schránky – nechávám, můžeš ho případně refaktorovat na blocks */
const templateFromClipboardOpen = ref(false)
async function createTemplateFromClipboard(payload: {
  deviceCode: string
  templateName: string
  fields: Array<{ orderIndex: number; type: FieldType; required: boolean; name: string }>
  templateId?: string
}): Promise<void> {
  // pro jednoduchost: 1 blok z fields
  const wizard: WizardTemplatePayload = {
    deviceCode: payload.deviceCode,
    templateName: payload.templateName,
    blocks: [{
      blockIndex: 1,
      title: 'Blok 1',
      fields: payload.fields
    }],
    templateId: payload.templateId
  }
  await handleTemplateConfirm(wizard)
}

/* Vytvoření měření */
const measurementCreateOpen = ref(false)
const metaSelectedDevice = ref<string>('')
const metaSelectedTemplateId = ref<string | null>(null)
const repeatEnabled = ref<boolean>(false)
const repeatCount = ref<number>(1)
const repeatIndex = ref<number>(1)
function gotoPrevSet(): void { if (repeatEnabled.value) repeatIndex.value = Math.max(1, repeatIndex.value - 1) }
function gotoNextSet(): void { if (repeatEnabled.value) repeatIndex.value = Math.min(repeatCount.value, repeatIndex.value + 1) }

async function onSaveMeasurement(payload: MeasurementRequest): Promise<void> {
  await measurementStore.saveMeasurement(projectId, payload)
  if (!repeatEnabled.value || repeatIndex.value >= repeatCount.value) {
    await loadMeasurements()
    measurementCreateOpen.value = false
    repeatIndex.value = 1
  } else {
    repeatIndex.value += 1
  }
}

/* Detail měření – beze změn */
const detailOpen = ref(false)
const detailItem = ref<MeasurementResponse | null>(null)
function openDetailById(id: number): void {
  const raw = (filteredMeasurements.value.find(i => i.id === id)?._raw ?? null) as MeasurementResponse | null
  detailItem.value = raw
  detailOpen.value = !!raw
}

function prevDetail(): void {
  const items = filteredMeasurements.value
  if (!detailItem.value || !items.length) return
  const idx = items.findIndex(i => i.id === detailItem.value?.id)
  const nextIdx = (idx - 1 + items.length) % items.length
  openDetailById(items[nextIdx].id)
}
function nextDetail(): void {
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
}): Promise<void> {
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
function askDelete(): void { confirmDeleteOpen.value = true }
async function confirmDelete(): Promise<void> {
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
function cancelDelete(): void { confirmDeleteOpen.value = false }

/* Načtení */
async function loadMeasurements(): Promise<void> {
  await measurementStore.fetchAllMeasurements(projectId)
}
onMounted(async () => {
  await reservationsStore.fetchDevices()
  await templatesStore.fetchByProject(projectId)
  await projectStore.fetchProjectMembers(projectId)
  await loadMeasurements()
})

/* Hotkeys – zůstávají */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = (el.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}
function onHotkeys(e: KeyboardEvent): void {
  const editable = isEditableTarget(e.target)
  if (!measurementCreateOpen.value && !overviewOpen.value && !detailOpen.value && editable) return
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
      <v-btn color="primary"  variant="flat" class="ml-3"@click="measurementCreateOpen = true">VYTVOŘIT MĚŘENÍ</v-btn>
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
              @create-measurement="measurementCreateOpen = true"
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
        :on-confirm="handleTemplateConfirm"
        :operation="initialWizardTemplate ? 'edit' : 'create'"
        :initial-template="initialWizardTemplate"
        :delete-loading="deleteTemplateLoading"
        @delete="askDeleteTemplate"
      />

      <teleport to="body">
        <Dialog
          :is-open="deleteTemplateConfirmOpen"
          @update:is-open="v => deleteTemplateConfirmOpen = v"
          width="520px"
          :hide-footer="true"
        >
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

      <Dialog
        :is-open="confirmDeleteOpen"
        @update:is-open="v => confirmDeleteOpen = v"
        width="520px"
        :hide-footer="true"
      >
        <template #content>
          <form class="pa-4" @submit.prevent="confirmDelete" @keydown.enter.prevent="confirmDelete">
            <div class="text-h6 mb-2">Smazat měření?</div>
            <div class="mb-4">Tato akce je nevratná. Opravdu chcete smazat toto měření?</div>
            <div class="d-flex" style="gap: 12px">
              <v-btn color="primary" variant="flat" size="large" :loading="deleteLoading" :disabled="deleteLoading || !detailItem?.id" @click="confirmDelete">Smazat měření</v-btn>
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
