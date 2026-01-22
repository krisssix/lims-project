<script setup lang="ts" name=src/pages/Measurements.vue>
/* eslint-disable @typescript-eslint/no-unused-vars */

import { computed, ref, onMounted, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from '@/components/Dialog.vue'
import DateFilterPanel, { type DateFilter } from '@/components/ui/DateFilterPanel.vue'
import RepeatSetsControls from '@/components/import/RepeatSetControls.vue'

import MeasurementTable from '@/components/measurement/MeasurementTable.vue'
import TemplatesOverviewDialog from '@/components/measurement/TemplatesOverviewDialog.vue'
import TemplateWizardDialog from '@/components/import/TemplateWizardDialog.vue'
import MeasurementCreateDialog from '@/components/measurement/MeasurementCreateDialog.vue'
import MeasurementDetailDialog from '@/components/measurement/MeasurementDetailDialog.vue'
import MeasurementCompareDialog from '@/components/measurement/MeasurementCompareDialog.vue'
import ZenodoDialog from '@/components/measurement/ZenodoDialog.vue'
import ExportDialog from '@/components/measurement/ExportDialog.vue'
import VersionConflictDialog from '@/components/measurement/VersionConflictDialog.vue'
import { type ExportFormat } from '@/composables/useExport'

import {
  useMeasurementStore,
  type MeasurementRequest,
  type MeasurementResponse,
} from '@/stores/measurement'
import type { ValueType } from '@/types/measurement-ui'
import { useDeviceStore } from '@/stores/devices'
import {
  useMeasurementTemplatesStore,
  type WizardTemplatePayload
} from '@/stores/measurement-templates'
import { useImportStore } from '@/stores/import'
import { useAttachments } from '@/composables/useAttachments'
import {type DeviceItem, type TemplateItem, type TableHeader, type TemplateBlockRow} from '@/types/measurement-ui'
import { useProjectStore } from '@/stores/project/project'
import { auth } from '@/stores/auth'

const route = useRoute()
const projectId = Number((route.params as { projectId: string }).projectId)
const measurementStore = useMeasurementStore()
const deviceStore = useDeviceStore()
const importStore = useImportStore()
const projectStore = useProjectStore()
const { uploadFile } = useAttachments()

/* Devices */
const devices = computed<DeviceItem[]>(() =>
  deviceStore.devices.map(d => ({ id: d.code, code: d.code, name: d.name, color: d.color || 'primary' }))
)
const devicesById = computed(() => new Map(devices.value.map(d => [d.id, d])))

/* Devices with measurements - for DateFilterPanel */
const devicesWithMeasurements = computed<DeviceItem[]>(() => {
  const measurementDeviceCodes = new Set(
    (measurementStore.allMeasurements || []).map(m => m.unit).filter(Boolean)
  )
  return devices.value.filter(d => measurementDeviceCodes.has(d.id))
})

/* Templates */
const templatesStore = useMeasurementTemplatesStore()

// FieldType removed - use ValueType everywhere
// type FieldRow = ... removed, using direct structure or TemplateFieldRow

/* Templates - s bloky */
const templates = computed<TemplateItem[]>(() =>
  templatesStore.items.map(t => {
    // Pokud má šablona bloky, použij je
    const blocks: TemplateBlockRow[] = (t.blocks && t.blocks.length > 0)
      ? t.blocks.map(b => ({
        id: b.id,
        blockIndex: b.blockIndex,
        kind: b.kind,
        title: b.title || `Blok ${b.blockIndex}`,
        fields: (b.fields || []).map(f => ({
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
        fields: (t.fields || []).map(f => ({
          orderIndex: f.orderIndex,
          type: f.type as ValueType,
          required: !!f.required,
          name: f.name
        }))
      }]

    return {
      id: String(t.id),
      name: t.name || '',
      deviceId: t.deviceCode || '',
      deviceColor: t.deviceColor || 'primary',
      fields: (t.fields || [])
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(f => ({
          orderIndex: f.orderIndex,
          type: f.type as ValueType,
          required: !!f.required,
          name: f.name
        })),
      blocks,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      status: t.status || 'ACTIVE',
      version: t.version || '1.0'
    }
  })
)

const templateById = computed(() => new Map(templates.value.map(t => [t.id, t])))

const snackbar = ref<{ open: boolean; text: string }>({ open: false, text: '' })
const createdTemplateId = ref<number | null>(null)

async function handleTemplateConfirm(payload: WizardTemplatePayload): Promise<void> {
  try {
    if (payload.templateId) {
      const idNum = Number(payload.templateId)
      if (Number.isFinite(idNum)) {
        if (payload.createVersionType) {
          // 1. Create new version from current
          const newVersion = await templatesStore.createVersion(idNum, payload.createVersionType)

          // 2. Update the NEW version with the editor content
          // We must update the payload to point to the new ID
          const newId = newVersion.id
          await templatesStore.updateFromWizard(projectId, newId, { ...payload, templateId: String(newId) })

          // 3. Mark as ACTIVE if requested
          if (payload.status === 'ACTIVE') {
            await templatesStore.publish(newId)
          }
        } else {
          // Standard update of existing ID
          await templatesStore.updateFromWizard(projectId, idNum, payload)
          // If explicitly requested to be active (e.g. editing a draft and saving as active)
          if (payload.status === 'ACTIVE') {
            await templatesStore.publish(idNum)
          }
        }
      }
    } else {
      const tpl = await templatesStore.createFromWizard(projectId, payload)
      createdTemplateId.value = tpl.id
      selectedTemplateId.value = String(tpl.id)
      if (payload.status !== 'DRAFT') {
        try {
          await templatesStore.publish(tpl.id)
        } catch (pubErr) {
          console.warn('Publish new template failed (ignoring)', pubErr)
        }
      }
    }
    await templatesStore.fetchByProject(projectId)
    templateWizardOpen.value = false
    initialWizardTemplate.value = null

    if (isCreatingFromMeasurementDialog.value) {
      // Do not open overview, return to measurement create dialog
    } else {
      overviewOpen.value = true
    }
    isCreatingFromMeasurementDialog.value = false
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

/* Toolbar + filters */
const isSideFilterOpen = ref(false)
const includeWeekends = ref(true)

/* Date Filter Logic */
const dateFilterModel = ref<DateFilter>({
  field: 'date',
  preset: null,
  from: null,
  to: null
})

const selectedDateLabel = computed(() => {
  const f = dateFilterModel.value
  if (!f.from || !f.to) return 'Všechna měření'

  if (f.preset === 'today') return 'Dnes'
  if (f.preset === 'thisWeek') return 'Tento týden'
  if (f.preset === 'thisMonth') return 'Tento měsíc'

  const d1 = f.from.toLocaleDateString('cs-CZ')
  const d2 = f.to.toLocaleDateString('cs-CZ')
  return d1 === d2 ? d1 : `${d1} – ${d2}`
})

const headers = ref<TableHeader[]>([
  { title: 'Šablona',        key: 'type' },
  { title: 'Přístroj',       key: 'device' },
  { title: 'Datum měření',   key: 'date' },
  { title: 'Datum vložení',  key: 'createdAt' },
  { title: 'Datum změny',    key: 'updatedAt' },
  { title: 'Počet hodnot',   key: 'count' },
  { title: 'Člen',           key: 'user' },
])

const leftSelection = ref<Record<string, string[]>>({ devices: [], templates: [] })
const leftGroups = computed(() => [
  { key: 'devices', title: 'Přístroje', label: 'Přístroje', items: devices.value, itemTitle: 'name', itemValue: 'id', type: 'devices' as const, colorKey: 'color', showField: 'id' },
  { key: 'templates', title: 'Šablona', label: 'Šablona', items: Array.from(new Set(templates.value.map(t => t.name))).map(n => ({ id: n, name: n })), itemTitle: 'name', itemValue: 'id', type: 'plain' as const },
])
const pickedDevices = ref<string[]>([])
const pickedTemplates = ref<string[]>([])
const pickedMembers = ref<string[]>([])

const templateFilterItems = computed<{ id: string; name: string }[]>(() => {
  let filteredTemplates = templates.value

  // Filter templates based on selected devices
  if (pickedDevices.value.length > 0) {
    filteredTemplates = filteredTemplates.filter(t =>
      pickedDevices.value.includes(t.deviceId)
    )
  }

  const uniqueNames = new Set(filteredTemplates.map(t => t.name))
  return Array.from(uniqueNames).map(n => ({ id: n, name: n }))
})
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
const fmtDateLongFmt = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtDateLong = (d: Date): string => fmtDateLongFmt.format(d)

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

const measurementsSorted = computed<MeasurementResponse[]>(() => {
  const list = measurementStore.allMeasurements || []
  return list.slice().sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))
})
const filteredMeasurements = computed(() => {
  const f = dateFilterModel.value
  const hasDateFilter = f.from && f.to
  const start = f.from ? f.from.getTime() : 0
  const end = f.to ? f.to.getTime() : Infinity

  return measurementsSorted.value
    .filter(m => {
      if (pickedDevices.value.length && !pickedDevices.value.includes(m.unit)) return false
      if (pickedTemplates.value.length && !pickedTemplates.value.includes(m.type)) return false

      const username = (m as unknown as { measuredByUsername?: string | null }).measuredByUsername
      if (pickedMembers.value.length && (!username || !pickedMembers.value.includes(username))) return false

      if (hasDateFilter) {
        // Vybereme pole podle filtru
        let t = NaN
        if (f.field === 'date') t = toMs(m.timestamp)
        else if (f.field === 'createdAt') t = m.createdAt ? toMs(m.createdAt) : 0
        else if (f.field === 'updatedAt') t = m.updatedAt ? toMs(m.updatedAt) : 0

        if (Number.isNaN(t)) return false // Nemá datum -> skrýt (nebo zobrazit?) - bez data asi skrýt
        if (t < start || t > end) return false
      }
      return true
    })
    .map(m => {
      const valuesCount = Array.isArray(m.values) ? m.values.length : (m.value != null ? 1 : 0)
      const user = (m as unknown as { measuredByUsername?: string | null }).measuredByUsername ?? '—'
      const note = (m as unknown as { note?: string | null }).note ?? null
      const createdAt = (m as unknown as { createdAt?: string | number | null }).createdAt
      const updatedAt = (m as unknown as { updatedAt?: string | number | null }).updatedAt
      return {
        id: m.id,
        type: m.type,
        device: m.unit ?? '',
        user,
        date: toMs(m.timestamp), // Datum měření
        createdAt: createdAt ? toMs(createdAt) : undefined, // Datum vložení
        updatedAt: updatedAt ? toMs(updatedAt) : undefined, // Datum změny
        count: valuesCount,
        note,
        zenodoDoi: m.zenodoDoi ?? null,
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

/* CHANGE: open import goes directly to Wizard on 'import' tab */
function openImportTemplate(): void {
  wizardMode.value = 'import'
  initialWizardTemplate.value = null
  templateWizardOpen.value = true
}

function startEditTemplate(t: TemplateItem): void {
  selectedTemplateId.value = t.id
  wizardMode.value = 'empty'
  const fullTemplate = templatesStore.items.find(tpl => String(tpl.id) === t.id)

  initialWizardTemplate.value = {
    templateId: t.id,
    name: t.name,
    deviceCode: t.deviceId,
    fields: t.fields.map((f, i) => ({
      orderIndex: i + 1,
      type: f.type,
      required: f.required,
      name: f.name,
    })),
    blocks: fullTemplate?.blocks?.map(b => ({
      blockIndex: b.blockIndex,
      title: b.title ?? `Blok ${b.blockIndex}`,
      kind: b.kind,
      fields: (b.fields ?? []).map((f, i) => ({
        orderIndex: i + 1,
        type: f.type as ValueType,
        required: !!f.required,
        name: f.name,
      })),
    })) ?? [],
    version: t.version,
    updatedAt: t.updatedAt,
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
  fields: Array<{ orderIndex: number; type: ValueType; required: boolean; name: string }>
  blocks?: Array<{
    blockIndex: number
    title: string
    kind?: 'table' | 'stats' | 'series' | 'kv'
    fields: Array<{ orderIndex: number; type: ValueType; required: boolean; name: string }>
  }>
  version?: string
  updatedAt?: string
} | null>(null)
/** Device to pre-select in TemplateWizardDialog */
const preselectedDeviceForWizard = ref<string | null>(null)

const isCreatingFromMeasurementDialog = ref(false)

function startCreateTemplate(deviceCode?: string): void {
  isCreatingFromMeasurementDialog.value = measurementCreateOpen.value
  wizardMode.value = 'empty'
  initialWizardTemplate.value = null
  preselectedDeviceForWizard.value = deviceCode || null
  templateWizardOpen.value = true
}
function startCreateTemplateFromFile(deviceCode?: string): void {
  isCreatingFromMeasurementDialog.value = measurementCreateOpen.value
  wizardMode.value = 'import'
  initialWizardTemplate.value = null
  preselectedDeviceForWizard.value = deviceCode || null
  templateWizardOpen.value = true
}

function startDeriveTemplate(templateId: string): void {
  const tpl = templates.value.find(t => t.id === templateId)
  if (!tpl) return

  const fullTemplate = templatesStore.items.find(t => String(t.id) === templateId)

  wizardMode.value = 'empty'
  initialWizardTemplate.value = {
    templateId: '', // null ID = nová šablona
    name: tpl.name + ' (kopie)',
    deviceCode: tpl.deviceId,
    fields: tpl.fields.map((f, i) => ({
      orderIndex: i + 1,
      type: f.type,
      required: f.required,
      name: f.name,
    })),
    blocks: fullTemplate?.blocks?.map(b => ({
      blockIndex: b.blockIndex,
      title: b.title ?? `Blok ${b.blockIndex}`,
      fields: (b.fields ?? []).map((f, i) => ({
        orderIndex: i + 1,
        type: f.type as ValueType,
        required: !!f.required,
        name: f.name,
      })),
    })) ?? [],
  }
  overviewOpen.value = false
  templateWizardOpen.value = true
}

async function handlePublishTemplate(templateId: string): Promise<void> {
  try {
    await templatesStore.publish(Number(templateId))
    snackbar.value = { open: true, text: 'Šablona byla úspěšně publikována' }
  } catch (err) {
    console.error('Failed to publish template:', err)
    snackbar.value = { open: true, text: 'Chyba při publikování šablony' }
  }
}

async function handleDeprecateTemplate(templateId: string): Promise<void> {
  try {
    await templatesStore.deprecate(Number(templateId))
    snackbar.value = { open: true, text: 'Šablona byla označena jako zastaralá' }
  } catch (err) {
    console.error('Failed to deprecate template:', err)
    snackbar.value = { open: true, text: 'Chyba při označování šablony' }
  }
}

async function handleTemplateDelete(id: string): Promise<void> {
  const idNum = Number(id)
  if (!Number.isFinite(idNum)) return
  try {
    await templatesStore.remove(idNum)
    await templatesStore.fetchByProject(projectId)
    // Child dialog shows notification
  } catch (err) {
    console.error('Failed to delete template:', err)
    snackbar.value = { open: true, text: 'Chyba při mazání šablony' }
  }
}

async function handleBulkDeleteTemplates(ids: string[]): Promise<void> {
  const numericIds = ids.map(Number).filter(Number.isFinite)
  if (numericIds.length === 0) return

  try {
    for (const id of numericIds) {
       await templatesStore.remove(id)
    }
    await templatesStore.fetchByProject(projectId)
    // Child dialog shows notification
  } catch (err) {
     console.error('Failed to bulk delete templates:', err)
     snackbar.value = { open: true, text: 'Chyba při hromadném mazání šablon' }
  }
}

const loadingTemplates = ref(false)

async function handleBulkStatusUpdate(ids: string[], status: 'ACTIVE' | 'DRAFT' | 'DEPRECATED'): Promise<void> {
  const numericIds = ids.map(Number).filter(Number.isFinite)
  if (!numericIds.length) return

  loadingTemplates.value = true
  try {
    const res = await templatesStore.bulkUpdateStatus(numericIds, status)

    await templatesStore.fetchByProject(projectId)

    let msg = `Stav změněn u ${res.updated} z ${res.requested} vybraných šablon.`
    if (res.skipped > 0) {
       msg += ` (${res.skipped} již bylo v požadovaném stavu).`
    }
    snackbar.value = { open: true, text: msg }
  } catch (err) {
    console.error('Bulk status update failed:', err)
    snackbar.value = { open: true, text: 'Chyba při aktualizaci stavu' }
  } finally {
    loadingTemplates.value = false
  }
}

// Version conflict dialog state
const versionConflictOpen = ref(false)
const versionDialogData = ref<{
  templateId: string
  templateName: string
  sourceVersion: string
  sourceStatus: string
  targetVersion: string
  higherVersion: string
  type: 'minor' | 'major'
  existingDrafts: Array<{ id: string; version: string; createdAt?: string }>
}>({
  templateId: '',
  templateName: '',
  sourceVersion: '1.0',
  sourceStatus: 'ACTIVE',
  targetVersion: '1.1',
  higherVersion: '1.2',
  type: 'minor',
  existingDrafts: []
})

function incrementVersion(version: string, isMajor: boolean): string {
  const [major, minor] = version.split('.').map(Number)
  if (isMajor) return `${major + 1}.0`
  return `${major}.${(minor || 0) + 1}`
}

async function handleCreateVersion(templateId: string, type: 'minor' | 'major'): Promise<void> {
  try {
    // Find current template info
    const tpl = templates.value.find(t => t.id === templateId)
    if (!tpl) return

    // Check for existing drafts
    const drafts = await templatesStore.checkDrafts(Number(templateId))
    const highestVersion = templates.value
      .filter(t => t.name === tpl.name && t.deviceId === tpl.deviceId)
      .map(t => t.version || '1.0')
      .sort((a, b) => {
        const [ma, mi] = a.split('.').map(Number)
        const [mb, mj] = b.split('.').map(Number)
        return mb - ma || mj - mi
      })[0] || '1.0'

    const targetVersion = incrementVersion(highestVersion, type === 'major')
    const higherVersion = incrementVersion(targetVersion, false)

    versionDialogData.value = {
      templateId,
      templateName: tpl.name,
      sourceVersion: tpl.version || '1.0',
      sourceStatus: tpl.status || 'ACTIVE',
      targetVersion,
      higherVersion,
      type,
      existingDrafts: drafts.map(d => ({ id: String(d.id), version: d.version || '1.0', createdAt: d.createdAt }))
    }
    versionConflictOpen.value = true
  } catch (err) {
    console.error('Failed to check drafts:', err)
    snackbar.value = { open: true, text: 'Chyba při kontrole existujících verzí' }
  }
}

async function onVersionCreate(_description: string): Promise<void> {
  try {
    const { templateId, type } = versionDialogData.value
    const newVersion = await templatesStore.createVersion(Number(templateId), type)
    snackbar.value = { open: true, text: `Vytvořena nová verze v${newVersion.version} (DRAFT)` }
  } catch (err) {
    console.error('Failed to create version:', err)
    snackbar.value = { open: true, text: 'Chyba při vytváření nové verze' }
  }
}

function onVersionContinue(draftId: string): void {
  // Open the draft for editing
  const draft = templates.value.find(t => t.id === draftId)
  if (draft) {
    selectedTemplateId.value = draftId
    initialWizardTemplate.value = {
      templateId: draftId,
      name: draft.name,
      deviceCode: draft.deviceId,
      blocks: draft.blocks || [],
      fields: []
    }
    templateWizardOpen.value = true
  }
}

async function onVersionDiscardAndCreate(draftIds: string[]): Promise<void> {
  try {
    // Delete existing drafts first
    for (const id of draftIds) {
      await templatesStore.remove(Number(id))
    }
    // Then create new version
    await onVersionCreate('')
  } catch (err) {
    console.error('Failed to discard and create:', err)
    snackbar.value = { open: true, text: 'Chyba při vytváření nové verze' }
  }
}

async function onVersionCreateHigher(): Promise<void> {
  try {
    // Create with the higher version number
    const { templateId, type } = versionDialogData.value
    const newVersion = await templatesStore.createVersion(Number(templateId), type)
    snackbar.value = { open: true, text: `Vytvořena nová verze v${newVersion.version} (DRAFT)` }
  } catch (err) {
    console.error('Failed to create higher version:', err)
    snackbar.value = { open: true, text: 'Chyba při vytváření nové verze' }
  }
}

/* Template ze schránky – zachováno (není součástí této změny) */
const templateFromClipboardOpen = ref(false)
async function createTemplateFromClipboard(payload: {
  deviceCode: string
  templateName: string
  fields: Array<{ orderIndex: number; type: ValueType; required: boolean; name: string }>
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

const highlightedMeasurementIds = ref<number[]>([])
const tableRefreshKey = ref(0)

async function onSaveMeasurement(payload: MeasurementRequest, attachments: File[] = []): Promise<void> {
  const result = await measurementStore.saveMeasurement(projectId, payload)

  if (result && result.id) {
    if (attachments && attachments.length > 0) {
      for (const file of attachments) {
        try {
          await uploadFile(result.id, file, () => {})
        } catch (e) {
          console.error(`Failed to upload attachment ${file.name}`, e)
        }
      }
    }

    if (repeatIndex.value === 1) {
      highlightedMeasurementIds.value = [result.id]
    } else {
      highlightedMeasurementIds.value = [...highlightedMeasurementIds.value, result.id]
    }
  }

  if (!repeatEnabled.value || repeatIndex.value >= repeatCount.value) {
    await loadMeasurements()
    tableRefreshKey.value++
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

/* Zenodo publishing */
const zenodoDialogOpen = ref(false)
const measurementsForZenodo = ref<MeasurementResponse[]>([])

function onPublishZenodo(ids: number[]): void {
  const list = measurementStore.allMeasurements || []
  measurementsForZenodo.value = list.filter(m => ids.includes(m.id))
  zenodoDialogOpen.value = true
}

async function onZenodoPublished(payload: { doi: string; recordId: number; measurementIds: number[] }): Promise<void> {
  // Save DOI and recordId to database for each measurement
  for (const measurementId of payload.measurementIds) {
    await measurementStore.updateMeasurement(measurementId, {
      zenodoDoi: payload.doi,
      zenodoRecordId: payload.recordId
    })
  }
  
  await loadMeasurements()
  snackbar.value = { open: true, text: 'Měření byla publikována v Zenodo' }
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
  const result = await measurementStore.updateMeasurement(
    detailItem.value.id,
    payload as unknown as Partial<MeasurementRequest>
  )
  // Ensure visual feedback - force updatedAt to now
  if (result) {
      result.updatedAt = Date.now()
  }
  // await loadMeasurements() - skip to keep patched result and avoid stale cache
  tableRefreshKey.value++
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

/* Bulk operations */
const bulkDeleteConfirmOpen = ref(false)
const bulkDeleteLoading = ref(false)
const bulkDeleteIds = ref<number[]>([])
const selectedMeasurements = ref<Array<{ id: number; type: string; device: string; user?: string; date: string | number; count: number; note?: string | null }>>([])

function onBulkDelete(ids: number[]): void {
  bulkDeleteIds.value = ids
  bulkDeleteConfirmOpen.value = true
}

async function confirmBulkDelete(): Promise<void> {
  if (!bulkDeleteIds.value.length) return

  bulkDeleteLoading.value = true
  try {
    await measurementStore.deleteMeasurementsBulk(bulkDeleteIds.value)
    await loadMeasurements()
    snackbar.value = { open: true, text: `Úspěšně smazáno ${bulkDeleteIds.value.length} měření` }
    bulkDeleteConfirmOpen.value = false
    bulkDeleteIds.value = []
    selectedMeasurements.value = []
  } catch (e) {
    console.error('Failed to delete measurements:', e)
    snackbar.value = { open: true, text: 'Nepodařilo se smazat vybraná měření' }
  } finally {
    bulkDeleteLoading.value = false
  }
}

/* Export dialog */
const exportDialogOpen = ref(false)
const measurementsForExport = ref<MeasurementResponse[]>([])

function onOpenExport(ids: number[]): void {
  const measurements = measurementStore.allMeasurements?.filter(m => ids.includes(m.id)) || []
  if (!measurements.length) return
  measurementsForExport.value = measurements
  exportDialogOpen.value = true
}



function onExported(format: ExportFormat, count: number): void {
  snackbar.value = { open: true, text: `Exportováno ${count} měření do ${format.toUpperCase()}` }
  selectedMeasurements.value = []
}

/* Compare dialog */
const compareDialogOpen = ref(false)
const measurementsForCompare = ref<MeasurementResponse[]>([])

function onCompareSelected(ids: number[]): void {
  const items = measurementStore.allMeasurements?.filter(m => ids.includes(m.id)) || []
  if (items.length < 2) return

  // Sort by ID or other criteria if needed, for better UX
  measurementsForCompare.value = items.sort((a, b) => a.id - b.id)
  compareDialogOpen.value = true
}

/* Načtení */
async function loadMeasurements(): Promise<void> {
  await measurementStore.fetchAllMeasurements(projectId)
}
onMounted(async () => {
  await deviceStore.fetchDevices()
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); measurementCreateOpen.value = true; return }
}

onMounted(() => window.addEventListener('keydown', onHotkeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkeys))
</script>

<template>
  <v-container
    fluid
    class="pa-0"
  >
    <!-- Top Toolbar -->
    <div class="top-toolbar">
      <!-- Primary Action -->
      <button
        class="btn-primary"
        @click="measurementCreateOpen = true"
      >
        <i class="mdi mdi-plus" />
        Vytvořit měření
      </button>

      <!-- Secondary Action -->
      <button
        class="btn-secondary"
        @click="openOverview"
      >
        <i class="mdi mdi-view-list-outline" />
        Přehled šablon
      </button>
    </div>

    <v-container
      fluid
      class="pa-4"
    >
      <v-row class="flex-nowrap">
        <!-- Sidebar -->
        <v-col cols="auto">
          <div style="width: 320px;">
            <DateFilterPanel
              v-model="dateFilterModel"
              v-model:picked-devices="pickedDevices"
              v-model:picked-members="pickedMembers"
              v-model:picked-templates="pickedTemplates"
              v-model:include-weekends="includeWeekends"
              :devices="devicesWithMeasurements"
              :members="membersList"
              :templates="templateFilterItems"
            />
          </div>
        </v-col>

        <v-col
          class="flex-grow-1"
          style="min-width: 0;"
        >
          <v-sheet
            elevation="1"
            class="pa-4 rounded-xl"
          >
            <MeasurementTable
              :key="tableRefreshKey"
              v-model:selected="selectedMeasurements"
              :headers="headers"
              :items="filteredMeasurements"
              :devices-by-id="devicesById"
              :active-date-field="dateFilterModel.from && dateFilterModel.to ? dateFilterModel.field : undefined"
              :highlighted-row-ids="highlightedMeasurementIds"
              @row-click="openDetailById"
              @create-measurement="measurementCreateOpen = true"
              @publish-zenodo="onPublishZenodo"
              @delete-selected="onBulkDelete"
              @export-selected="onOpenExport"
              @compare-selected="onCompareSelected"
            />
          </v-sheet>
        </v-col>
      </v-row>

      <TemplatesOverviewDialog
        v-model="overviewOpen"
        :templates="templates"
        :selected-template-id="selectedTemplateId"
        :loading="loadingTemplates"
        @edit="startEditTemplate"
        @create-blank="startCreateTemplate"
        @create-from-file="openImportTemplate"
        @derive-template="startDeriveTemplate"
        @publish="handlePublishTemplate"
        @deprecate="handleDeprecateTemplate"
        @create-version="handleCreateVersion"
        @delete="handleTemplateDelete"
        @bulk-delete="handleBulkDeleteTemplates"
        @bulk-status-update="handleBulkStatusUpdate"
      />

      <VersionConflictDialog
        v-model="versionConflictOpen"
        :template-name="versionDialogData.templateName"
        :source-version="versionDialogData.sourceVersion"
        :source-status="versionDialogData.sourceStatus"
        :target-version="versionDialogData.targetVersion"
        :higher-version="versionDialogData.higherVersion"
        :existing-drafts="versionDialogData.existingDrafts"
        @create="onVersionCreate"
        @continue="onVersionContinue"
        @discard-and-create="onVersionDiscardAndCreate"
        @create-higher="onVersionCreateHigher"
      />

      <TemplateWizardDialog
        v-model="templateWizardOpen"
        :devices="devices"
        :on-confirm="handleTemplateConfirm"
        :operation="initialWizardTemplate ? 'edit' : 'create'"
        :initial-template="initialWizardTemplate"
        :delete-loading="deleteTemplateLoading"
        :start-mode="wizardMode"
        :preselected-device="preselectedDeviceForWizard"
        :lock-device="!!preselectedDeviceForWizard"
        @delete="askDeleteTemplate"
      />

      <teleport to="body">
        <Dialog
          :is-open="deleteTemplateConfirmOpen"
          width="520px"
          :hide-footer="true"
          @update:is-open="v => deleteTemplateConfirmOpen = v"
        >
          <template #content>
            <form
              class="pa-4"
              @submit.prevent="confirmDeleteTemplate"
              @keydown.enter.prevent="confirmDeleteTemplate"
            >
              <div class="text-h6 mb-2">
                Smazat šablonu?
              </div>
              <div class="mb-4">
                Tato akce je nevratná. Opravdu chcete smazat tuto šablonu?
              </div>
              <div
                class="d-flex"
                style="gap: 12px"
              >
                <v-btn
                  type="submit"
                  color="error"
                  :loading="deleteTemplateLoading"
                  :disabled="deleteTemplateLoading || !selectedTemplateId"
                >
                  Smazat
                </v-btn>
                <v-spacer />
                <v-btn
                  variant="tonal"
                  :disabled="deleteTemplateLoading"
                  @click="() => deleteTemplateConfirmOpen = false"
                >
                  Zrušit
                </v-btn>
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
        :initial-template-id="createdTemplateId"
        @create-template="startCreateTemplate"
        @create-template-from-clipboard="startCreateTemplateFromFile"
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

      <MeasurementCompareDialog
        v-model="compareDialogOpen"
        :items="measurementsForCompare"
        :devices="devices"
        :members="membersList"
        :templates="templates"
      />

      <ZenodoDialog
        v-model="zenodoDialogOpen"
        :measurements="measurementsForZenodo"
        @published="onZenodoPublished"
      />

      <Dialog
        :is-open="confirmDeleteOpen"
        width="520px"
        :hide-footer="true"
        @update:is-open="v => confirmDeleteOpen = v"
      >
        <template #content>
          <form
            class="pa-4"
            @submit.prevent="confirmDelete"
            @keydown.enter.prevent="confirmDelete"
          >
            <div class="text-h6 mb-2">
              Smazat měření?
            </div>
            <div class="mb-4">
              Tato akce je nevratná. Opravdu chcete smazat toto měření?
            </div>
            <div
              class="d-flex"
              style="gap: 12px"
            >
              <v-btn
                color="primary"
                variant="flat"
                size="large"
                :loading="deleteLoading"
                :disabled="deleteLoading || !detailItem?.id"
                @click="confirmDelete"
              >
                Smazat měření
              </v-btn>
              <v-spacer />
              <v-btn
                variant="tonal"
                color="text"
                size="large"
                :disabled="deleteLoading"
                @click="cancelDelete"
              >
                Ponechat
              </v-btn>
            </div>
          </form>
        </template>
      </Dialog>

      <!-- Bulk Delete Confirmation -->
      <Dialog
        :is-open="bulkDeleteConfirmOpen"
        width="520px"
        :hide-footer="true"
        @update:is-open="v => bulkDeleteConfirmOpen = v"
      >
        <template #content>
          <form
            class="pa-4"
            @submit.prevent="confirmBulkDelete"
            @keydown.enter.prevent="confirmBulkDelete"
          >
            <div class="text-h6 mb-2">
              Smazat {{ bulkDeleteIds.length }} měření?
            </div>
            <div class="mb-4">
              Tato akce je nevratná. Opravdu chcete smazat vybraná měření?
            </div>
            <div
              class="d-flex"
              style="gap: 12px"
            >
              <v-btn
                type="submit"
                color="error"
                :loading="bulkDeleteLoading"
                :disabled="bulkDeleteLoading"
              >
                Smazat vše
              </v-btn>
              <v-spacer />
              <v-btn
                variant="tonal"
                :disabled="bulkDeleteLoading"
                @click="() => bulkDeleteConfirmOpen = false"
              >
                Zrušit
              </v-btn>
            </div>
          </form>
        </template>
      </Dialog>

      <!-- Export Dialog -->
      <ExportDialog
        v-model="exportDialogOpen"
        :measurements="measurementsForExport"
        @exported="onExported"
      />

      <v-snackbar
        v-model="snackbar.open"
        :timeout="2200"
      >
        {{ snackbar.text }}
      </v-snackbar>
    </v-container>
  </v-container>
</template>

<style scoped>
/* Styles moved to global settings.scss */
</style>
