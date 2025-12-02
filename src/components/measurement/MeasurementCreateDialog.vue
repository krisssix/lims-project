<script setup lang="ts">
/**
 * MeasurementCreateDialog – úprava podle požadavku:
 *  - NIC se neodstraňuje z logiky ani funkcionalit (records, bloky, import, mapping, statistika, hotkeys).
 *  - V UI se odstraní sloupec „Stav“ (žádné valid ikony, žádné tooltippy).
 *  - Při Uložit (Ctrl+S) se:
 *      - označí všechna pole jako touched,
 *      - zobrazí chybové pozadí (has-error) na nevalidních polích,
 *      - automaticky se navede fokus na první nevalidní pole v aktuálním bloku.
 *  - Mimo akci Uložit se stavové indikátory neukazují (žádný „Stav“ sloupec).
 *  - Nadále jemné zvýraznění required-empty v pristine stavu (is-required-empty) zůstává.
 *  - Bez použití 'any'. Žádné deprecated filters. Pomocné helpery v <script setup>.
 */

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Dialog from '@/components/Dialog.vue'
import DeviceInlineCreate from '@/components/device/DeviceInlineCreate.vue'
import { useDeviceStore } from '@/stores/devices'
import { type DeviceItem, type TemplateItem, type ValueType, type TemplateBlockRow } from '@/types/measurement-ui'
import { type MeasurementRequest, type MeasuredValue } from '@/stores/measurement'
import {
  newRecordFromTemplateFields,
  duplicateRecord,
  flattenRecords,
  extractSeries,
  computeBasicStats,
  type MeasurementRecord,
  type RecordField,
  toNumber,
  normalizeBool,
  toDateMs,
  validateField
} from '@/utils/measurement-record-helpers'

import {
  parseImportedMeasurementFile,
  checkTemplateCompatibility,
  buildRecordsFromImported,
  type ImportedFileStructure,
  type TemplateLike
} from '@/utils/import/importCompatibility'
import { buildMappingModel, exportMapping, type MappingModel } from '@/utils/import/importMapping'
import MappingWizardDialog from '@/components/import/MappingWizardDialog.vue'
import { isEditableElement } from '@/components/ui/hotkeyGuard'

/* ---------- Props / Emits ---------- */
const props = defineProps<{
  modelValue: boolean
  devices: DeviceItem[]
  templates: TemplateItem[]
  templateById: Map<string, TemplateItem>
  initialTemplateId?: string | null
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', payload: MeasurementRequest): void
  (e: 'createTemplate'): void
  (e: 'createTemplateFromClipboard'): void
}>()

/* ---------- Device store ---------- */
const deviceStore = useDeviceStore()
const storeDevices = computed(() => deviceStore.devices)
async function ensureDeviceStoreLoaded(): Promise<void> {
  if (!deviceStore.devices.length) {
    await deviceStore.fetchDevices().catch(() => {})
  }
}
void ensureDeviceStoreLoaded()

/* ---------- Dialog state ---------- */
const step = ref<1 | 2>(1)
const saving = ref(false)
const showHelp = ref(true)

/* ---------- Meta ---------- */
const selectedDeviceId = ref<string>('')
const selectedTemplateId = ref<string | null>(null)

/* ---------- Inline device create ---------- */
const showDeviceCreate = ref(false)
function toggleDeviceCreate(): void { showDeviceCreate.value = !showDeviceCreate.value }
function onDeviceCreated(dev: { id: number; code: string; name: string; color?: string | null; active: boolean }): void {
  selectedDeviceId.value = dev.code
  showDeviceCreate.value = false
}

/* ---------- Labely typů ---------- */
const TYPE_LABEL: Record<ValueType, string> = {
  float: 'Float',
  int: 'Integer',
  text: 'Text',
  file: 'Image',
  bool: 'Boolean',
  date: 'Date'
}

/* ---------- Records ---------- */
const records = ref<MeasurementRecord[]>([])
const currentRecordIndex = ref<number>(1)
const selectedRecordIndexes = ref<Set<number>>(new Set())
const expandedFields = ref<Set<string>>(new Set()) // (ponecháno kvůli importu / mappingu)

/* ---------- Block navigation ---------- */
const currentBlockIndex = ref<number>(0)

/* ---------- Derived ---------- */
const currentRecord = computed<MeasurementRecord | null>(() =>
    records.value.find(r => r.recordIndex === currentRecordIndex.value) ?? null
)

const selectedTemplate = computed<TemplateItem | null>(() => {
  if (!selectedTemplateId.value) return null
  return props.templateById.get(selectedTemplateId.value) ?? null
})

const templateBlocks = computed<TemplateBlockRow[]>(() => {
  const tpl = selectedTemplate.value
  if (!tpl) return []
  if (tpl.blocks && tpl.blocks.length > 0) return tpl.blocks
  return [{
    id: 0,
    blockIndex: 1,
    title: 'Hodnoty',
    fields: tpl.fields || []
  }]
})

const currentBlock = computed<TemplateBlockRow | null>(() =>
    templateBlocks.value[currentBlockIndex.value] ?? null
)

const templateFields = computed<Array<{
  name: string
  type: ValueType
  required: boolean
  blockIndex?: number
  blockTitle?: string
}>>(() => {
  if (!selectedTemplateId.value) return []
  const tpl = props.templateById.get(selectedTemplateId.value)
  if (!tpl) return []
  if (tpl.blocks && tpl.blocks.length > 0) {
    const fields: Array<{ name: string; type: ValueType; required: boolean; blockIndex: number; blockTitle: string }> = []
    for (const block of tpl.blocks) {
      for (const field of block.fields) {
        fields.push({
          name: field.name,
          type: field.type,
          required: field.required,
          blockIndex: block.blockIndex,
          blockTitle: block.title
        })
      }
    }
    return fields
  }
  return (tpl.fields ?? []).map(f => ({
    name: f.name,
    type: f.type,
    required: f.required,
    blockIndex: 1,
    blockTitle: 'Hodnoty'
  }))
})

/* ---------- Fields for current block ---------- */
const currentBlockFields = computed<RecordField[]>(() => {
  if (!currentRecord.value || !currentBlock.value) return []
  const blockIdx = currentBlock.value.blockIndex
  return currentRecord.value.fields.filter(f => (f.blockIndex ?? 1) === blockIdx)
})

/* ---------- Helpers (no unions in template) ---------- */
function textModel(field: RecordField): string | number | null {
  const val = field.value
  return (val === undefined ? null : (val as string | number | null))
}
function dateModel(field: RecordField): string | null {
  return typeof field.value === 'number'
      ? new Date(field.value).toISOString().slice(0, 10)
      : ((field.value as string | null | undefined) ?? null)
}
function fileModel(field: RecordField): File | null {
  const v = field.value
  return v && typeof v === 'object' && 'name' in (v as Record<string, unknown>) ? (v as File) : null
}

/* ---------- Numeric fields (float/int + numeric-like text) ---------- */
const numericFieldNames = computed<string[]>(() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of records.value) {
    for (const f of r.fields) {
      let isNumeric = f.type === 'float' || f.type === 'int'
      if (!isNumeric && f.type === 'text') {
        const n = toNumber(f.value, false)
        isNumeric = n != null && Number.isFinite(n)
      }
      if (isNumeric && !seen.has(f.name)) {
        seen.add(f.name)
        out.push(f.name)
      }
    }
  }
  return out
})

const selectedNumericField = ref<string | null>(null)
watch(numericFieldNames, list => {
  if (!list.length) selectedNumericField.value = null
  else if (!selectedNumericField.value) selectedNumericField.value = list[0]!
})

/* ---------- Validation state (visited vs touched) ---------- */
const visitedFields = ref<Set<string>>(new Set())
const touchedFields = ref<Set<string>>(new Set())

function fieldKey(field: RecordField): string {
  return `${currentRecordIndex.value}-${field.name}`
}
function markFieldVisited(field: RecordField): void {
  visitedFields.value.add(fieldKey(field))
}
function markFieldTouched(field: RecordField): void {
  touchedFields.value.add(fieldKey(field))
}
function isFieldVisited(field: RecordField): boolean {
  return visitedFields.value.has(fieldKey(field))
}
function isFieldTouched(field: RecordField): boolean {
  return touchedFields.value.has(fieldKey(field))
}
function requiredEmptyPristine(field: RecordField): boolean {
  const empty = field.value == null || String(field.value).trim() === ''
  return field.required && empty && !isFieldVisited(field)
}

function fieldError(field: RecordField): string | null {
  // Chyba jen pokud pole už bylo "touched"
  if (!isFieldTouched(field)) return null
  return validateField(field)
}

/* Celková invalidita (bez ohledu na interakci) */
const invalidTotal = computed<number>(() => {
  let count = 0
  records.value.forEach(r =>
      r.fields.forEach(f => {
        if (validateField(f)) count++
      })
  )
  return count
})

const canSave = computed<boolean>(() =>
    !!selectedTemplateId.value &&
    !!selectedDeviceId.value &&
    invalidTotal.value === 0
)

/* ---------- Focus helpers ---------- */
function focusFieldByIndex(idx: number): void {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-field-input]')
    els[idx]?.focus()
  })
}
function focusFirstInvalidInCurrentBlock(): void {
  nextTick(() => {
    const fields = currentBlockFields.value
    const firstBad = fields.findIndex(f => validateField(f))
    if (firstBad >= 0) focusFieldByIndex(firstBad)
  })
}

/* ---------- Block navigation ---------- */
function prevBlock(): void { if (currentBlockIndex.value > 0) currentBlockIndex.value-- }
function nextBlock(): void { if (currentBlockIndex.value < templateBlocks.value.length - 1) currentBlockIndex.value++ }

/* ---------- Initialization ---------- */
function initDialog(): void {
  step.value = 1
  selectedDeviceId.value = storeDevices.value.length
      ? (storeDevices.value[0]!.code ?? String(storeDevices.value[0]!.id))
      : (props.devices.length ? String(props.devices[0]!.id) : '')
  selectedTemplateId.value = props.initialTemplateId ?? null
  records.value = []
  currentRecordIndex.value = 1
  currentBlockIndex.value = 0
  selectedRecordIndexes.value = new Set()
  selectedNumericField.value = null
  showDeviceCreate.value = false
  visitedFields.value.clear()
  touchedFields.value.clear()
  resetImport()
}

/* ---------- Step transition ---------- */
function goToStep2(): void {
  if (!selectedTemplateId.value) return
  records.value = [newRecordFromTemplateFields(1, templateFields.value)]
  currentRecordIndex.value = 1
  currentBlockIndex.value = 0
  selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  visitedFields.value.clear()
  touchedFields.value.clear()
  step.value = 2
  nextTick(() => {
    // Focus první input (pokud existuje)
    const el = document.querySelector<HTMLElement>('[data-field-input]')
    el?.focus()
  })
}

function close(): void { emits('update:modelValue', false) }

/* ---------- Record operations ---------- */
function addRecord(): void {
  const nextIdx = records.value.length
      ? Math.max(...records.value.map(r => r.recordIndex)) + 1
      : 1
  const rec = newRecordFromTemplateFields(nextIdx, templateFields.value)
  records.value.push(rec)
  currentRecordIndex.value = rec.recordIndex
  currentBlockIndex.value = 0
  selectedRecordIndexes.value.add(rec.recordIndex)
  visitedFields.value.clear()
  touchedFields.value.clear()
  nextTick(() => {
    const el = document.querySelector<HTMLElement>('[data-field-input]')
    el?.focus()
  })
}

function duplicateCurrentRecord(): void {
  const curr = currentRecord.value
  if (!curr) return
  const nextIdx = Math.max(...records.value.map(r => r.recordIndex)) + 1
  const dup = duplicateRecord(curr, nextIdx)
  records.value.push(dup)
  currentRecordIndex.value = dup.recordIndex
  currentBlockIndex.value = 0
  selectedRecordIndexes.value.add(dup.recordIndex)
  visitedFields.value.clear()
  touchedFields.value.clear()
  nextTick(() => {
    const el = document.querySelector<HTMLElement>('[data-field-input]')
    el?.focus()
  })
}

function deleteCurrentRecord(): void {
  if (records.value.length <= 1) return
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx === -1) return
  records.value.splice(idx, 1)
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  currentRecordIndex.value = sorted[0]!
  currentBlockIndex.value = 0
  if (!selectedRecordIndexes.value.size) {
    selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  }
  visitedFields.value.clear()
  touchedFields.value.clear()
}

function toPrevRecord(): void {
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const pos = sorted.indexOf(currentRecordIndex.value)
  if (pos > 0) {
    currentRecordIndex.value = sorted[pos - 1]!
    currentBlockIndex.value = 0
    visitedFields.value.clear()
    touchedFields.value.clear()
  }
}

function toNextRecord(): void {
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const pos = sorted.indexOf(currentRecordIndex.value)
  if (pos < sorted.length - 1) {
    currentRecordIndex.value = sorted[pos + 1]!
    currentBlockIndex.value = 0
    visitedFields.value.clear()
    touchedFields.value.clear()
  }
}

function toggleRecordSelection(idx: number, multi: boolean): void {
  if (multi) {
    if (selectedRecordIndexes.value.has(idx)) selectedRecordIndexes.value.delete(idx)
    else selectedRecordIndexes.value.add(idx)
    if (!selectedRecordIndexes.value.size) selectedRecordIndexes.value.add(idx)
  } else {
    currentRecordIndex.value = idx
    currentBlockIndex.value = 0
  }
}

/* ---------- Edit field ---------- */
function updateField(field: RecordField, raw: unknown): void {
  // Označit touched při změně
  markFieldTouched(field)
  switch (field.type) {
    case 'float': field.value = toNumber(raw, false); break
    case 'int': field.value = toNumber(raw, true); break
    case 'bool': field.value = normalizeBool(raw); break
    case 'date': field.value = toDateMs(raw); break
    case 'file': field.value = raw; break
    case 'text':
    default: field.value = raw ?? ''
  }
}

/* ---------- Clipboard ---------- */
async function pasteIntoCurrentRecord(): Promise<void> {
  if (!currentRecord.value) return
  try {
    const text = await navigator.clipboard.readText()
    if (!text) return
    const tokens = text.split(/[\s,;]+/u).filter(Boolean)
    let idx = 0
    for (const f of currentRecord.value.fields) {
      if (idx >= tokens.length) break
      // Mark visited + touched pro hromadné vložení
      markFieldVisited(f)
      updateField(f, tokens[idx++])
    }
  } catch { /* ignore */ }
}

async function pasteAsMultipleRecords(): Promise<void> {
  if (!templateFields.value.length) return
  try {
    const text = await navigator.clipboard.readText()
    if (!text) return
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length)
    if (!lines.length) return
    const parsed: string[][] = lines.map(l => l.split(/[\t,; ]+/u).filter(Boolean))
    const curr = currentRecord.value
    if (curr) {
      const tokens = parsed[0]!
      curr.fields.forEach((f, i) => {
        markFieldVisited(f)
        updateField(f, tokens[i] ?? '')
      })
    }
    for (let li = 1; li < parsed.length; li++) {
      const nextIdx = Math.max(...records.value.map(r => r.recordIndex)) + 1
      const rec = newRecordFromTemplateFields(nextIdx, templateFields.value)
      rec.fields.forEach((f, i) => {
        markFieldVisited(f)
        updateField(f, parsed[li]![i] ?? '')
      })
      records.value.push(rec)
      selectedRecordIndexes.value.add(rec.recordIndex)
    }
    currentRecordIndex.value = Math.max(...records.value.map(r => r.recordIndex))
    currentBlockIndex.value = 0
  } catch { /* ignore */ }
}

/* ---------- Stats ---------- */
const chartPoints = computed<number[]>(() => {
  if (!selectedNumericField.value) return []
  const subset = selectedRecordIndexes.value.size
      ? Array.from(selectedRecordIndexes.value)
      : records.value.map(r => r.recordIndex)
  const subsetRecords = records.value.filter(r => subset.includes(r.recordIndex))
  return extractSeries(subsetRecords, selectedNumericField.value)
})
const statsObj = computed(() => computeBasicStats(chartPoints.value))

/* ---------- Build payload ---------- */
function buildMeasuredValues(): MeasuredValue[] {
  const flat = flattenRecords(records.value)
  return flat.map(v => ({
    orderIndex: v.orderIndex,
    recordIndex: v.recordIndex ?? 1,
    blockIndex: v.blockIndex ?? 1,
    name: v.name,
    type: v.type,
    numberValue: v.numberValue ?? null,
    textValue: v.textValue ?? null,
    boolValue: v.boolValue ?? null,
    dateValue: v.dateValue ?? null,
    fileUrl: v.fileUrl ?? null
  }))
}

/* ---------- Save ---------- */
async function onSave(): Promise<void> {
  // 1) Označit všechna pole jako touched, aby se zobrazily chyby
  records.value.forEach(r => r.fields.forEach(f => markFieldTouched(f)))
  await nextTick()

  // 2) Pokud existují nevyplněné/invalidní hodnoty, navést na první nevalidní v aktuálním bloku a NEukládat
  if (!canSave.value) { focusFirstInvalidInCurrentBlock(); return }

  // 3) Uložit
  saving.value = true
  try {
    const firstNumeric = records.value
        .flatMap(r => r.fields)
        .filter(f => f.type === 'float' || f.type === 'int')
        .map(f => toNumber(f.value, f.type === 'int'))
        .find(n => n != null && Number.isFinite(n))

    const tpl = selectedTemplateId.value ? props.templateById.get(selectedTemplateId.value) : null
    if (!tpl) return
    const payload: MeasurementRequest = {
      value: Number.isFinite(firstNumeric as number) ? (firstNumeric as number) : 0,
      type: tpl.name,
      unit: selectedDeviceId.value,
      timestamp: Date.now(),
      values: buildMeasuredValues()
    }
    emits('save', payload)
  } finally {
    saving.value = false
  }
}

/* ---------- IMPORT PANEL ---------- */
const importPanelOpen = ref(false)
const importedFile = ref<File | null>(null)
const importedStructure = ref<ImportedFileStructure | null>(null)
const importCompatibility = ref<{ compatible: boolean; reasons: string[] } | null>(null)
const importBusy = ref(false)
const importError = ref<string | null>(null)
const isImportCompatible = computed<boolean>(() => importCompatibility.value?.compatible === true)

/* Mapping wizard */
const mappingOpen = ref(false)
const mappingModel = ref<MappingModel | null>(null)

function toggleImportPanel(): void {
  if (!selectedTemplate.value) return
  importPanelOpen.value = !importPanelOpen.value
}
function resetImport(): void {
  importedFile.value = null
  importedStructure.value = null
  importCompatibility.value = null
  importError.value = null
}
function onImportFilePicked(f: File | null): void {
  importedFile.value = f
  importedStructure.value = null
  importCompatibility.value = null
  importError.value = null
}
function buildTemplateLike(): TemplateLike | null {
  const tpl = selectedTemplate.value
  if (!tpl) return null
  const blocks = templateBlocks.value.map(b => ({
    blockIndex: b.blockIndex,
    title: b.title,
    fields: b.fields.map((f, i) => ({
      name: f.name,
      type: f.type,
      required: f.required,
      sourceIndex: i,
      orderIndex: f.orderIndex
    }))
  }))
  return { name: tpl.name, deviceId: tpl.deviceId || selectedDeviceId.value, blocks }
}
async function analyzeImport(): Promise<void> {
  if (!importedFile.value) return
  if (!selectedTemplate.value) {
    importError.value = 'Nejprve vyberte šablonu.'
    return
  }
  importBusy.value = true
  importError.value = null
  try {
    const structure = await parseImportedMeasurementFile(importedFile.value)
    importedStructure.value = structure
    const tmpl = buildTemplateLike()
    if (!tmpl) {
      importError.value = 'Šablona není dostupná.'
      return
    }
    const compat = checkTemplateCompatibility(tmpl, structure)
    importCompatibility.value = { compatible: compat.compatible, reasons: compat.reasons }
    if (!compat.compatible) {
      importPanelOpen.value = true
    }
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Neznámá chyba při parsování souboru.'
  } finally {
    importBusy.value = false
  }
}
function applyImportedRecords(): void {
  if (!importedStructure.value || !isImportCompatible.value) return
  const tmpl = buildTemplateLike()
  if (!tmpl) return

  const recs = buildRecordsFromImported(tmpl, importedStructure.value)
  const ui = recs.map(r => ({
    recordIndex: r.recordIndex,
    fields: r.fields.map((f, order) => ({
      name: f.name,
      type: f.type as ValueType,
      required: f.required,
      value: f.value,
      blockIndex: f.blockIndex,
      blockTitle: f.blockTitle,
      orderIndex: order + 1
    }))
  }))

  const cleaned = normalizeImportedRecords(ui)
  if (!cleaned.length) return

  records.value = cleaned
  currentRecordIndex.value = records.value[0]!.recordIndex
  selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  expandedFields.value = new Set(records.value[0]!.fields.map(f => f.name))

  visitedFields.value.clear()
  touchedFields.value.clear()

  step.value = 2
}
function openImportFileChooser(): void {
  const el = document.querySelector<HTMLInputElement>('[data-import-file-input]')
  el?.click()
}
function openMappingWizard(): void {
  if (!importedStructure.value || !selectedTemplate.value) return
  const tmpl = buildTemplateLike()
  if (!tmpl) return
  mappingModel.value = buildMappingModel(tmpl, {
    fileName: importedStructure.value.fileName,
    delimiter: importedStructure.value.delimiter,
    blocks: importedStructure.value.blocks.map(b => ({
      blockIndex: b.blockIndex,
      headers: b.headers
    }))
  })
  mappingOpen.value = true
}
function onApplyMapping(payload: ReturnType<typeof exportMapping>): void {
  if (!importedStructure.value || !selectedTemplate.value || !mappingModel.value) return
  const base = buildTemplateLike()
  if (!base) return

  for (const blockMapping of payload) {
    const blk = base.blocks.find(b => b.blockIndex === blockMapping.blockIndex)
    if (!blk) continue
    for (const m of blockMapping.mappings) {
      const fld = blk.fields.find(f => f.name === m.fieldName)
      if (fld) fld.sourceIndex = m.sourceIndex
    }
  }

  const recs = buildRecordsFromImported(base, importedStructure.value)
  const ui = recs.map(r => ({
    recordIndex: r.recordIndex,
    fields: r.fields.map((f, order) => ({
      name: f.name,
      type: f.type as ValueType,
      required: f.required,
      value: f.value,
      blockIndex: f.blockIndex,
      blockTitle: f.blockTitle,
      orderIndex: order + 1
    }))
  }))

  const cleaned = normalizeImportedRecords(ui)
  if (!cleaned.length) return

  records.value = cleaned
  currentRecordIndex.value = records.value[0]!.recordIndex
  selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  expandedFields.value = new Set(records.value[0]!.fields.map(f => f.name))

  visitedFields.value.clear()
  touchedFields.value.clear()

  step.value = 2
  mappingOpen.value = false
}

/* ---------- Keyboard shortcuts ---------- */
function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey

  if (key === 'escape') { e.preventDefault(); emits('update:modelValue', false); return }
  if (ctrl && key === 's') { e.preventDefault(); void onSave(); return }

  if (isEditableElement(e.target)) return

  if (ctrl && key === 'enter' && importPanelOpen.value) { e.preventDefault(); void analyzeImport(); return }
  if (ctrl && key === 'o') { e.preventDefault(); openImportFileChooser(); return }
}

watch(() => props.modelValue, v => {
  if (v) {
    initDialog()
    window.addEventListener('keydown', handleKey)
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (props.modelValue) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))

/* ---------- Helper: normalizeImportedRecords (bez 'any') ---------- */
function normalizeImportedRecords(ui: Array<{
  recordIndex: number
  fields: Array<{
    name: string
    type: ValueType
    required: boolean
    value: unknown
    blockIndex?: number
    blockTitle?: string
    orderIndex: number
  }>
}>): MeasurementRecord[] {
  return ui.map(r => ({
    recordIndex: r.recordIndex,
    fields: r.fields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      value: f.value ?? null,
      blockIndex: f.blockIndex ?? 1,
      blockTitle: f.blockTitle,
      orderIndex: f.orderIndex
    }))
  }))
}
</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="920px"
    :hide-footer="false"
    class="measurement-create-dialog"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div
        class="text-h6 d-flex align-center"
        style="gap:12px;"
      >
        Vytvoření nového měření
        <v-btn
          v-if="selectedTemplateId"
          size="small"
          variant="tonal"
          :color="importPanelOpen ? 'primary' : undefined"
          prepend-icon="mdi-file-upload-outline"
          title="Panel importu"
          @click="toggleImportPanel"
        >
          Import
        </v-btn>
      </div>
    </template>

    <template #content>
      <!-- IMPORT PANEL -->
      <v-expand-transition>
        <div
          v-if="importPanelOpen && selectedTemplateId"
          class="import-panel mb-4 pa-3 rounded-lg elevation-1"
        >
          <div
            class="d-flex align-center mb-2"
            style="gap:8px;"
          >
            <v-icon
              size="20"
              color="primary"
            >
              mdi-file-table-box
            </v-icon>
            <span class="text-subtitle-2">Import dat do měření</span>
            <v-spacer />
            <v-btn
              size="x-small"
              variant="text"
              icon="mdi-close"
              title="Zavřít"
              @click="toggleImportPanel"
            />
          </div>

          <div
            class="d-flex align-center flex-wrap mb-3"
            style="gap:12px;"
          >
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              data-import-file-input
              style="display:none"
              @change="e => onImportFilePicked((e.target as HTMLInputElement).files?.[0] || null)"
            >
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-upload"
              title="Vybrat soubor"
              @click="openImportFileChooser"
            >
              Vybrat soubor
            </v-btn>
            <span
              v-if="importedFile"
              class="text-caption"
            >{{ importedFile.name }}</span>
            <v-btn
              size="small"
              variant="flat"
              :disabled="!importedFile || !selectedTemplate"
              :loading="importBusy"
              title="Analyzovat"
              @click="analyzeImport"
            >
              Analyzovat
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              :disabled="!importedStructure || importBusy || !isImportCompatible"
              color="success"
              title="Použít data"
              @click="applyImportedRecords"
            >
              Použít data
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              :disabled="!importedStructure"
              color="error"
              title="Reset"
              @click="resetImport"
            >
              Reset
            </v-btn>
          </div>

          <v-alert
            v-if="importError"
            type="error"
            variant="tonal"
            class="mb-3"
          >
            {{ importError }}
          </v-alert>

          <v-alert
            v-else-if="importCompatibility && !importCompatibility.compatible"
            type="warning"
            variant="tonal"
            class="mb-3 import-error-alert"
          >
            <div class="import-error-content">
              <div class="import-error-title">
                <strong>Soubor není kompatibilní se šablonou</strong>
              </div>

              <div class="import-error-reasons">
                <div
                  v-for="(r, i) in importCompatibility.reasons"
                  :key="i"
                  class="import-error-item"
                >
                  <v-icon
                    size="16"
                    color="error"
                    class="mr-2"
                  >
                    mdi-close-circle
                  </v-icon>
                  <span>{{ r }}</span>
                </div>
              </div>

              <v-divider class="my-3" />

              <div class="import-error-actions">
                <div class="text-caption text-medium-emphasis mb-2">
                  <v-icon
                    size="14"
                    class="mr-1"
                  >
                    mdi-lightbulb-outline
                  </v-icon>
                  <strong>Možnosti řešení:</strong>
                </div>
                <div class="d-flex flex-wrap ga-2">
                  <v-btn
                    size="small"
                    variant="flat"
                    color="primary"
                    prepend-icon="mdi-file-document-plus"
                    @click="$emit('createTemplateFromClipboard')"
                  >
                    Vytvořit novou šablonu
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="flat"
                    color="deep-purple"
                    prepend-icon="mdi-table-sync"
                    :disabled="! importedStructure"
                    @click="openMappingWizard"
                  >
                    Namapovat sloupce
                  </v-btn>
                </div>
              </div>
            </div>
          </v-alert>

          <div
            v-if="importCompatibility && importCompatibility.compatible"
            class="mb-3"
          >
            <v-chip
              size="small"
              color="success"
              variant="tonal"
            >
              Kompatibilní
            </v-chip>
            <span class="text-caption ml-2">
              Hlavičky odpovídají šabloně. Můžete použít data.
            </span>
          </div>

          <div
            v-if="importedStructure"
            class="import-preview"
          >
            <div class="text-caption mb-1">
              Náhled prvního bloku
            </div>
            <v-table density="compact">
              <thead>
                <tr>
                  <th
                    v-for="(h,i) in importedStructure.blocks[0]?.headers"
                    :key="i"
                    class="text-caption"
                  >
                    {{ h }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row,ri) in importedStructure.blocks[0]?.rows.slice(0,5)"
                  :key="ri"
                >
                  <td
                    v-for="(cell,ci) in row"
                    :key="ci"
                    class="text-caption"
                  >
                    {{ cell }}
                  </td>
                </tr>
              </tbody>
            </v-table>
            <div
              v-if="importedStructure.blocks[0]?.rows.length > 5"
              class="text-caption text-medium-emphasis mt-1"
            >
              + {{ importedStructure.blocks[0].rows.length - 5 }} dalších řádků…
            </div>
          </div>
        </div>
      </v-expand-transition>

      <!-- STEP 1 -->
      <div v-if="step === 1">
        <div
          class="d-flex align-center mb-4"
          style="gap: 12px;"
        >
          <v-icon
            color="primary"
            size="20"
          >
            mdi-information-outline
          </v-icon>
          <div class="text-subtitle-1 font-weight-medium">
            Metadata měření
          </div>
        </div>

        <v-row class="g-4">
          <!-- Device -->
          <v-col
            cols="12"
            md="6"
          >
            <v-card
              variant="outlined"
              class="pa-4 device-card"
              elevation="0"
            >
              <div
                class="d-flex align-center mb-3"
                style="gap: 8px;"
              >
                <v-icon
                  size="18"
                  color="primary"
                >
                  mdi-devices
                </v-icon>
                <span class="text-body-2 font-weight-medium">Měřicí přístroj</span>
                <v-chip
                  v-if="!selectedDeviceId"
                  size="x-small"
                  color="error"
                  variant="flat"
                >
                  Povinné
                </v-chip>
              </div>
              <v-select
                v-model="selectedDeviceId"
                :items="storeDevices"
                item-title="name"
                item-value="code"
                placeholder="Vyberte přístroj..."
                variant="outlined"
                density="comfortable"
                hide-details="auto"
              >
                <template #selection="{ item }">
                  <div
                    class="d-flex align-center"
                    style="gap: 8px;"
                  >
                    <v-chip
                      size="small"
                      :color="item.raw?.color || 'primary'"
                      variant="flat"
                    >
                      {{ item.raw?.code }}
                    </v-chip>
                    <span class="text-body-2">{{ item.raw?.name }}</span>
                  </div>
                </template>
                <template #item="{ item, props: liProps }">
                  <v-list-item v-bind="liProps">
                    <template #prepend>
                      <v-chip
                        size="small"
                        :color="item.raw?.color || 'primary'"
                        variant="flat"
                        class="mr-2"
                      >
                        {{ item.raw?.code }}
                      </v-chip>
                    </template>
                  </v-list-item>
                </template>
              </v-select>

              <DeviceInlineCreate
                :open="showDeviceCreate"
                autofocus
                @close="showDeviceCreate = false"
                @created="onDeviceCreated"
              />

              <v-divider class="my-3" />
              <div
                class="d-flex align-center justify-space-between flex-wrap"
                style="gap: 8px;"
              >
                <v-btn
                  size="small"
                  variant="tonal"
                  color="primary"
                  prepend-icon="mdi-plus-circle-outline"
                  @click.stop="toggleDeviceCreate"
                >
                  Nový přístroj
                </v-btn>
                <v-tooltip location="top">
                  <template #activator="{ props: tp }">
                    <v-icon
                      v-bind="tp"
                      size="16"
                      color="grey"
                    >
                      mdi-keyboard
                    </v-icon>
                  </template>
                  <span class="text-caption">Alt+Shift+D</span>
                </v-tooltip>
              </div>
            </v-card>
          </v-col>

          <!-- Template -->
          <v-col
            cols="12"
            md="6"
          >
            <v-card
              variant="outlined"
              class="pa-4"
              elevation="0"
            >
              <div
                class="d-flex align-center mb-3"
                style="gap: 8px;"
              >
                <v-icon
                  size="18"
                  color="primary"
                >
                  mdi-file-document-outline
                </v-icon>
                <span class="text-body-2 font-weight-medium">Šablona měření</span>
                <v-chip
                  size="x-small"
                  color="grey"
                  variant="flat"
                >
                  Volitelné
                </v-chip>
              </div>
              <v-select
                v-model="selectedTemplateId"
                :items="templates"
                item-title="name"
                item-value="id"
                placeholder="Vyberte šablonu nebo vytvořte novou..."
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                clearable
              >
                <template #item="{ props: liProps }">
                  <v-list-item v-bind="liProps">
                    <template #prepend>
                      <v-icon
                        size="20"
                        color="primary"
                      >
                        mdi-file-document-outline
                      </v-icon>
                    </template>
                  </v-list-item>
                </template>
                <template #no-data>
                  <v-list-item>
                    <v-list-item-title class="text-caption text-medium-emphasis">
                      Žádné šablony
                    </v-list-item-title>
                  </v-list-item>
                </template>
              </v-select>
              <v-divider class="my-3" />
              <div
                class="d-flex align-center flex-wrap"
                style="gap: 8px;"
              >
                <v-btn
                  size="small"
                  variant="tonal"
                  color="primary"
                  prepend-icon="mdi-plus-circle-outline"
                  @click="$emit('createTemplate')"
                >
                  Nová šablona
                </v-btn>
                <v-btn
                  size="small"
                  variant="tonal"
                  color="secondary"
                  prepend-icon="mdi-content-paste"
                  @click="$emit('createTemplateFromClipboard')"
                >
                  Ze souboru / schránky
                </v-btn>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <v-expand-transition>
          <v-alert
            v-if="showHelp"
            type="info"
            variant="tonal"
            density="compact"
            class="mt-4"
            closable
            @click:close="showHelp = false"
          >
            <template #prepend>
              <v-icon>mdi-lightbulb-outline</v-icon>
            </template>
            <div class="text-caption">
              <strong>Tip:</strong> Šablony standardizují strukturu dat. Můžete je vytvořit ručně nebo importovat z hlaviček.
            </div>
          </v-alert>
        </v-expand-transition>
      </div>

      <!-- STEP 2 -->
      <div v-else>
        <!-- Records toolbar -->
        <div
          class="d-flex align-center justify-space-between mb-2 flex-wrap"
          style="gap:12px;"
        >
          <v-btn
            size="small"
            color="primary"
            variant="flat"
            prepend-icon="mdi-plus"
            block
            title="Přidat další záznam"
            class="control-btn"
            @click="addRecord"
          >
            Přidat záznam
          </v-btn>

          <div
            class="d-flex align-center flex-wrap"
            style="gap:6px;"
          >
            <span class="text-subtitle-2 mr-2">Záznamy:</span>
            <v-chip
              v-for="r in records"
              :key="r.recordIndex"
              size="small"
              :variant="r.recordIndex === currentRecordIndex ? 'flat' : 'tonal'"
              :color="r.recordIndex === currentRecordIndex ? 'primary' : (selectedRecordIndexes.has(r.recordIndex) ? 'deep-purple' : undefined)"
              :title="`Record ${r.recordIndex} (Shift+klik subset)`"
              @click="toggleRecordSelection(r.recordIndex, false)"
              @mousedown.shift.prevent="toggleRecordSelection(r.recordIndex, true)"
            >
              {{ r.recordIndex }}
            </v-chip>

            <v-btn
              size="x-small"
              variant="text"
              icon="mdi-content-copy"
              title="Duplikovat"
              :disabled="!currentRecord"
              @click="duplicateCurrentRecord"
            />
            <v-btn
              size="x-small"
              variant="text"
              icon="mdi-delete-outline"
              title="Smazat"
              :disabled="records.length <= 1"
              @click="deleteCurrentRecord"
            />
            <v-btn
              size="x-small"
              variant="text"
              icon="mdi-chevron-left"
              title="Předchozí"
              @click="toPrevRecord"
            />
            <v-btn
              size="x-small"
              variant="text"
              icon="mdi-chevron-right"
              title="Další"
              @click="toNextRecord"
            />
          </div>

          <div
            class="d-flex align-center flex-wrap"
            style="gap:6px;"
          >
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              title="Vložit do current record (Ctrl+V)"
              @click="pasteIntoCurrentRecord"
            >
              VLOŽIT (Ctrl+V)
            </v-btn>
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              title="Vložit jako více záznamy (Ctrl+Alt+V)"
              @click="pasteAsMultipleRecords"
            >
              VÍCE RECORDŮ (Ctrl+Alt+V)
            </v-btn>
          </div>
        </div>

        <!-- Block navigation -->
        <div
          v-if="templateBlocks.length > 1"
          class="block-navigation mb-3"
        >
          <div class="d-flex align-center justify-space-between">
            <div
              class="d-flex align-center"
              style="gap: 8px;"
            >
              <v-btn
                icon="mdi-chevron-left"
                size="small"
                variant="text"
                :disabled="currentBlockIndex === 0"
                title="Předchozí blok"
                @click="prevBlock"
              />
              <div class="text-subtitle-1 font-weight-medium">
                {{ currentBlock?.title || `Blok ${currentBlockIndex + 1}` }}
              </div>
              <v-btn
                icon="mdi-chevron-right"
                size="small"
                variant="text"
                :disabled="currentBlockIndex === templateBlocks.length - 1"
                title="Další blok"
                @click="nextBlock"
              />
            </div>
            <v-chip
              size="small"
              variant="tonal"
            >
              {{ currentBlockIndex + 1 }} / {{ templateBlocks.length }}
            </v-chip>
          </div>

          <div class="block-tabs mt-2">
            <v-chip
              v-for="(block, idx) in templateBlocks"
              :key="block.id"
              size="small"
              :color="idx === currentBlockIndex ? 'primary' : undefined"
              :variant="idx === currentBlockIndex ? 'flat' : 'tonal'"
              class="mr-1"
              @click="currentBlockIndex = idx"
            >
              {{ block.title }}
              <v-badge
                v-if="block.fields.length"
                :content="block.fields.length"
                color="grey"
                inline
                class="ml-1"
              />
            </v-chip>
          </div>
        </div>

        <div
          v-else-if="currentBlock"
          class="block-header mb-3"
        >
          <div class="text-subtitle-1 font-weight-medium">
            {{ currentBlock.title }}
          </div>
        </div>

        <!-- Fields grid simplified (BEZ sloupce Stav) -->
        <div class="grid header-row">
          <div class="cell muted">
            Název + Typ
          </div>
          <div class="cell muted">
            Hodnota
          </div>
        </div>

        <transition-group
          name="fade-y"
          tag="div"
        >
          <div
            v-for="(field, idx) in currentBlockFields"
            :key="field.name"
            class="grid data-row"
            :class="{
              'has-error': !!fieldError(field),
              'is-required-empty': requiredEmptyPristine(field)
            }"
            :aria-label="`Field ${idx+1}: ${field.name} (${TYPE_LABEL[field.type]})`"
          >
            <!-- name + type -->
            <div class="cell name name-with-chip">
              <div
                class="d-flex align-center"
                style="gap:8px; min-width:0;"
              >
                <span class="name-text">{{ field.name }}</span>
                <v-chip
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  class="type-chip"
                >
                  {{ TYPE_LABEL[field.type] }}
                </v-chip>
              </div>
            </div>

            <!-- value input (mark visited on focus) -->
            <div class="cell value">
              <v-switch
                v-if="field.type === 'bool'"
                :model-value="textModel(field)"
                color="deep-purple"
                hide-details
                inset
                density="comfortable"
                data-field-input
                @focus="markFieldVisited(field)"
                @update:model-value="val => updateField(field, val)"
                @blur="markFieldTouched(field)"
              />

              <v-text-field
                v-else-if="field.type === 'int'"
                :model-value="textModel(field)"
                type="text"
                inputmode="numeric"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                placeholder="123"
                data-field-input
                @focus="markFieldVisited(field)"
                @update:model-value="val => updateField(field, val)"
                @blur="markFieldTouched(field)"
              />

              <v-text-field
                v-else-if="field.type === 'float'"
                :model-value="textModel(field)"
                type="text"
                inputmode="decimal"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                placeholder="123,45"
                data-field-input
                @focus="markFieldVisited(field)"
                @update:model-value="val => updateField(field, val)"
                @blur="markFieldTouched(field)"
              />

              <v-text-field
                v-else-if="field.type === 'date'"
                :model-value="dateModel(field)"
                type="date"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                data-field-input
                @focus="markFieldVisited(field)"
                @update:model-value="val => updateField(field, val)"
                @blur="markFieldTouched(field)"
              />

              <v-file-input
                v-else-if="field.type === 'file'"
                :model-value="fileModel(field)"
                density="comfortable"
                hide-details="auto"
                variant="outlined"
                accept="image/*,.csv,.txt,.pdf"
                show-size
                data-field-input
                @focus="markFieldVisited(field)"
                @update:model-value="val => updateField(field, (Array.isArray(val) ? val[0] : val))"
                @blur="markFieldTouched(field)"
              />

              <v-text-field
                v-else
                :model-value="textModel(field)"
                type="text"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                placeholder="Text…"
                data-field-input
                @focus="markFieldVisited(field)"
                @update:model-value="val => updateField(field, val)"
                @blur="markFieldTouched(field)"
              />
            </div>
          </div>
        </transition-group>

        <!-- Simple stats preview -->
        <div class="mt-5">
          <div class="text-subtitle-2 mb-2">
            Rychlá statistika
          </div>
          <div
            class="d-flex align-center flex-wrap mb-3"
            style="gap:6px;"
          >
            <v-chip
              v-for="(n,i) in numericFieldNames"
              :key="n + i"
              size="small"
              :color="selectedNumericField === n ? 'primary' : undefined"
              variant="tonal"
              @click="selectedNumericField = n"
            >
              {{ n }}
            </v-chip>
            <v-chip
              v-if="numericFieldNames.length > 1"
              size="small"
              :color="!selectedNumericField ? 'primary' : undefined"
              variant="tonal"
              @click="selectedNumericField = null"
            >
              Vše
            </v-chip>
          </div>
          <v-sheet
            elevation="1"
            class="pa-3 rounded-lg"
          >
            <div v-if="statsObj && selectedNumericField">
              <div class="d-flex justify-space-between">
                <div>Count</div><div>{{ statsObj.count }}</div>
              </div>
              <div class="d-flex justify-space-between">
                <div>Mean</div><div>{{ statsObj.mean.toFixed(2) }}</div>
              </div>
              <div class="d-flex justify-space-between">
                <div>Median</div><div>{{ statsObj.median.toFixed(2) }}</div>
              </div>
              <div class="d-flex justify-space-between">
                <div>StdDev</div><div>{{ statsObj.stdDev.toFixed(2) }}</div>
              </div>
              <div class="d-flex justify-space-between">
                <div>Min</div><div>{{ statsObj.min }}</div>
              </div>
              <div class="d-flex justify-space-between">
                <div>Max</div><div>{{ statsObj.max }}</div>
              </div>
            </div>
            <div
              v-else
              class="text-medium-emphasis"
            >
              {{ numericFieldNames.length ? 'Vyber numerické pole pro statistiku' : 'Žádná numerická pole' }}
            </div>
          </v-sheet>
        </div>

        <!-- Mapping Wizard -->
        <MappingWizardDialog
          v-model="mappingOpen"
          :mapping-model="mappingModel"
          @apply-mapping="onApplyMapping"
        />
      </div>
    </template>

    <template #footer>
      <v-btn
        variant="text"
        @click="close"
      >
        Zrušit (Esc)
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="step === 1"
        color="primary"
        variant="flat"
        :disabled="!selectedTemplateId"
        @click="goToStep2"
      >
        Pokračovat (Enter)
      </v-btn>
      <v-btn
        v-else
        color="primary"
        variant="flat"
        :title="`Uložit (Ctrl+S)`"
        :loading="saving"
        :disabled="!canSave"
        @click="onSave"
      >
        Uložit
      </v-btn>
    </template>
  </Dialog>
</template>

<style scoped>
.v-card {
  transition: all 0.2s ease;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.v-card:hover {
  border-color: rgb(var(--v-theme-primary));
}
.text-medium-emphasis { opacity: 0.7; }
.v-chip { transition: transform 0.2s ease; }
.v-chip:hover { transform: scale(1.05); }

/* Grid: BEZ sloupce Stav → 2 sloupce */
.grid {
  display: grid;
  grid-template-columns: 1fr minmax(240px, 1.5fr);
  gap: 8px;
  align-items: center;
}
.header-row {
  padding: 6px 6px 8px 6px;
  font-size: 0.75rem;
  letter-spacing: .03em;
  text-transform: uppercase;
  color: var(--v-theme-grey-darken-2);
}
.data-row {
  padding: 3px;
  border-radius: 8px;
  transition: background-color .15s;
}

/* Jemné zvýraznění required empty v pristine stavu (první interakce až po Save se zvýší touched a has-error) */
.data-row.is-required-empty {
  background: #fffdf8;
  box-shadow: inset 0 0 0 0.8px rgba(255, 193, 7, 0.35);
}

/* Chybové pozadí (zobrazuje se po Save, kdy jsou pole touched) */
.data-row.has-error {
  background: #fff6f6;
  box-shadow: inset 0 0 0 0.8px rgba(244, 67, 54, 0.25);
}

.cell.muted { font-size: .75rem; }
.name-with-chip { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.type-chip { font-weight: 600; letter-spacing: .02em; text-transform: none; }

[data-field-input]:focus-visible {
  outline: 2px solid var(--v-theme-primary);
  outline-offset: 4px;
  border-radius: 4px;
}

.block-navigation {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 12px 16px;
}
.block-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.block-header {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 12px 16px;
}

/* Import error alert styling */
.import-error-alert {
  border-left: 4px solid rgb(var(--v-theme-warning)) !important;
}

.import-error-content {
  font-size: 0.875rem;
  line-height: 1.6;
}

.import-error-title {
  display: flex;
  align-items: center;
  font-size: 1rem;
  margin-bottom: 12px;
  color: rgba(0, 0, 0, 0.87);
}

.import-error-reasons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-warning), 0.2);
}

.import-error-item {
  display: flex;
  align-items: flex-start;
  padding: 6px 8px;
  background: white;
  border-radius: 6px;
  font-size: 0.875rem;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.87);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.import-panel {
  background: #f7f9fc;
  border: 1px solid #e1e5eb;
}
.import-preview { margin-top: 12px; }

.import-preview :deep(td) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

@media (max-width: 1040px) {
  .grid {
    grid-template-columns: 1fr minmax(240px, 1.5fr);
    gap: 8px;
    align-items: center;
  }
}
</style>
