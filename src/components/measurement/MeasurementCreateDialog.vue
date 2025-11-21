<script setup lang="ts">
/**
 * MeasurementCreateDialog – multi-record session (lint cleaned).
 *
 * Vytvoření jednoho měření s více recordy (opakované sady polí šablony).
 *
 * Kroky:
 *  STEP 1: Meta (výběr přístroje a šablony)
 *  STEP 2: Editace recordů (přidání / duplikace / mazání / hromadné vložení ze schránky)
 *
 * Klávesové zkratky:
 *  Esc                  Zavřít dialog
 *  Ctrl+S               Uložit
 *  Ctrl+V               Vložit ze schránky do aktuálního recordu (tokeny)
 *  Ctrl+Alt+V           Vložit jako více recordů (řádky → každý nový record)
 *  Ctrl+Shift+N         Nový prázdný record
 *  Ctrl+D               Duplikovat aktuální record
 *  Ctrl+Shift+Del       Smazat aktuální record (pokud >1)
 *  Alt+← / Alt+→        Předchozí / další record
 *  Alt+1..9             Skok na record
 *  Alt+Shift+1..9       Přepnout record do subsetu (výběrová množina)
 *  Alt+ArrowUp/Down     Navigace mezi poli v aktuálním recordu
 *  Alt+E / Alt+C        Expand / Collapse všech polí
 *  Alt+F                Cyklus numerických polí pro statistiku
 *
 * Bez deprecated filters, žádné 'any', striktní typy.
 */

import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import Dialog from '@/components/Dialog.vue'
import { type DeviceItem, type TemplateItem, type ValueType } from '@/types/measurement-ui'
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

/* ---------- Props / Emits ---------- */
const props = defineProps<{
  modelValue: boolean
  devices: DeviceItem[]
  templates: TemplateItem[]
  templateById: Map<string, TemplateItem>
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', payload: MeasurementRequest): void
  (e: 'createTemplate'): void
  (e: 'createTemplateFromClipboard'): void
}>()

/* ---------- Dialog state ---------- */
const step = ref<1 | 2>(1)
const saving = ref(false)

/* ---------- Meta ---------- */
const selectedDeviceId = ref<string>('')
const selectedTemplateId = ref<string | null>(null)

/* ---------- Template label mapping ---------- */
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
const expandedFields = ref<Set<string>>(new Set())

/* ---------- Derived ---------- */
const currentRecord = computed<MeasurementRecord | null>(() =>
  records.value.find(r => r.recordIndex === currentRecordIndex.value) ?? null
)

const templateFields = computed<Array<{ name: string; type: ValueType; required: boolean }>>(() => {
  if (!selectedTemplateId.value) return []
  const tpl = props.templateById.get(selectedTemplateId.value)
  return (tpl?.fields ?? []).map(f => ({
    name: f.name,
    type: f.type,
    required: f.required
  }))
})

const numericFieldNames = computed<string[]>(() => {
  const set = new Set<string>()
  records.value.forEach(r =>
    r.fields.forEach(f => {
      if (f.type === 'float' || f.type === 'int') set.add(f.name)
    })
  )
  return Array.from(set)
})

const selectedNumericField = ref<string | null>(null)
watch(numericFieldNames, list => {
  if (!list.length) selectedNumericField.value = null
  else if (!selectedNumericField.value) selectedNumericField.value = list[0]!
})

/* ---------- Validation ---------- */
function fieldError(field: RecordField): string | null {
  return validateField(field)
}
const invalidTotal = computed<number>(() => {
  let count = 0
  records.value.forEach(r => r.fields.forEach(f => { if (fieldError(f)) count++ }))
  return count
})
const canSave = computed<boolean>(() =>
  !!selectedTemplateId.value &&
  !!selectedDeviceId.value &&
  invalidTotal.value === 0
)

/* ---------- Initialization ---------- */
function initDialog(): void {
  step.value = 1
  selectedDeviceId.value = props.devices.length ? props.devices[0]!.id : ''
  selectedTemplateId.value = null
  records.value = []
  currentRecordIndex.value = 1
  selectedRecordIndexes.value = new Set()
  expandedFields.value = new Set()
  selectedNumericField.value = null
}

function close(): void { emits('update:modelValue', false) }

/* ---------- Step transition ---------- */
function goToStep2(): void {
  if (!selectedTemplateId.value) return
  records.value = [newRecordFromTemplateFields(1, templateFields.value)]
  currentRecordIndex.value = 1
  selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  expandedFields.value = new Set(records.value[0]!.fields.map(f => f.name))
  step.value = 2
  nextTick(() => focusFieldByIndex(0))
}

/* ---------- Record operations ---------- */
function addRecord(): void {
  const nextIdx = records.value.length
    ? Math.max(...records.value.map(r => r.recordIndex)) + 1
    : 1
  const rec = newRecordFromTemplateFields(nextIdx, templateFields.value)
  records.value.push(rec)
  currentRecordIndex.value = rec.recordIndex
  selectedRecordIndexes.value.add(rec.recordIndex)
  expandedFields.value = new Set(rec.fields.map(f => f.name))
  nextTick(() => focusFieldByIndex(0))
}
function duplicateCurrentRecord(): void {
  const curr = currentRecord.value
  if (!curr) return
  const nextIdx = Math.max(...records.value.map(r => r.recordIndex)) + 1
  const dup = duplicateRecord(curr, nextIdx)
  records.value.push(dup)
  currentRecordIndex.value = dup.recordIndex
  selectedRecordIndexes.value.add(dup.recordIndex)
  expandedFields.value = new Set(dup.fields.map(f => f.name))
  nextTick(() => focusFieldByIndex(0))
}
function deleteCurrentRecord(): void {
  if (records.value.length <= 1) return
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx === -1) return
  records.value.splice(idx, 1)
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  currentRecordIndex.value = sorted[0]!
  if (!selectedRecordIndexes.value.size) {
    selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  }
  expandedFields.value = new Set(currentRecord.value?.fields.map(f => f.name) ?? [])
  nextTick(() => focusFieldByIndex(0))
}
function toPrevRecord(): void {
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const pos = sorted.indexOf(currentRecordIndex.value)
  if (pos > 0) {
    currentRecordIndex.value = sorted[pos - 1]!
    expandedFields.value = new Set(currentRecord.value?.fields.map(f => f.name) ?? [])
    nextTick(() => focusFieldByIndex(0))
  }
}
function toNextRecord(): void {
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const pos = sorted.indexOf(currentRecordIndex.value)
  if (pos < sorted.length - 1) {
    currentRecordIndex.value = sorted[pos + 1]!
    expandedFields.value = new Set(currentRecord.value?.fields.map(f => f.name) ?? [])
    nextTick(() => focusFieldByIndex(0))
  }
}
function toggleRecordSelection(idx: number, multi: boolean): void {
  if (multi) {
    if (selectedRecordIndexes.value.has(idx)) selectedRecordIndexes.value.delete(idx)
    else selectedRecordIndexes.value.add(idx)
    if (!selectedRecordIndexes.value.size) selectedRecordIndexes.value.add(idx)
  } else {
    currentRecordIndex.value = idx
    expandedFields.value = new Set(currentRecord.value?.fields.map(f => f.name) ?? [])
  }
}

/* ---------- Field expand / collapse ---------- */
function expandAllFields(): void {
  if (!currentRecord.value) return
  expandedFields.value = new Set(currentRecord.value.fields.map(f => f.name))
}
function collapseAllFields(): void {
  expandedFields.value = new Set()
}
function isExpanded(field: RecordField): boolean {
  return expandedFields.value.has(field.name)
}
function toggleField(field: RecordField): void {
  const next = new Set(expandedFields.value)
  if (next.has(field.name)) next.delete(field.name)
  else next.add(field.name)
  expandedFields.value = next
}

/* ---------- Edit field ---------- */
function updateField(field: RecordField, raw: unknown): void {
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

function textModel(field: RecordField): string | number | null | undefined {
  return (field.value ?? null) as string | number | null | undefined
}
function dateModel(field: RecordField): string | null {
  return typeof field.value === 'number'
    ? new Date(field.value).toISOString().slice(0, 10)
    : (field.value as string | null | undefined) ?? null
}
function fileModel(field: RecordField): File | null | undefined {
  return field.value as File | null | undefined
}
function previewValue(field: RecordField): string {
  const v = field.value
  switch (field.type) {
    case 'float':
    case 'int': {
      const num = typeof v === 'number' ? v : toNumber(v, field.type === 'int')
      return (num == null || Number.isNaN(num)) ? '—' : String(num)
    }
    case 'bool':
      return v === true ? 'Ano' : (v === false ? 'Ne' : '—')
    case 'date': {
      const ms = toDateMs(v)
      return ms != null ? new Date(ms).toISOString().slice(0, 10) : '—'
    }
    case 'file':
      return v && typeof v === 'object' && 'name' in (v as Record<string, unknown>)
        ? String((v as { name?: unknown }).name)
        : (typeof v === 'string' ? v : '—')
    case 'text':
    default:
      return (v == null || String(v).trim() === '') ? '—' : String(v).trim()
  }
}

/* ---------- Clipboard paste ---------- */
async function pasteIntoCurrentRecord(): Promise<void> {
  if (!currentRecord.value) return
  try {
    const text = await navigator.clipboard.readText()
    if (!text) return
    const tokens = text.split(/[\s,;]+/u).filter(Boolean)
    let idx = 0
    for (const f of currentRecord.value.fields) {
      if (idx >= tokens.length) break
      updateField(f, tokens[idx++])
    }
  } catch {
    /* ignore */
  }
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
      curr.fields.forEach((f, i) => updateField(f, tokens[i] ?? ''))
    }
    for (let li = 1; li < parsed.length; li++) {
      const nextIdx = Math.max(...records.value.map(r => r.recordIndex)) + 1
      const rec = newRecordFromTemplateFields(nextIdx, templateFields.value)
      rec.fields.forEach((f, i) => updateField(f, parsed[li]![i] ?? ''))
      records.value.push(rec)
      selectedRecordIndexes.value.add(rec.recordIndex)
    }
    currentRecordIndex.value = Math.max(...records.value.map(r => r.recordIndex))
    expandedFields.value = new Set(currentRecord.value?.fields.map(f => f.name) ?? [])
    nextTick(() => focusFieldByIndex(0))
  } catch {
    /* ignore */
  }
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
  if (!canSave.value) return
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

/* ---------- Keyboard shortcuts ---------- */
let lastFocusedFieldIdx = -1
function focusFieldByIndex(idx: number): void {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-field-input]')
    const el = els[idx]
    if (el) {
      el.focus()
      lastFocusedFieldIdx = idx
    }
  })
}

function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  const shift = e.shiftKey

  // Global
  if (key === 'escape') { e.preventDefault(); close(); return }
  if (ctrl && key === 's') { e.preventDefault(); onSave(); return }

  // STEP 1
  if (step.value === 1) {
    if (ctrl && key === 'v') { e.preventDefault(); void pasteIntoCurrentRecord(); return }
    if (key === 'enter' && selectedTemplateId.value) { e.preventDefault(); goToStep2(); return }
    return
  }

  // STEP 2
  if (step.value === 2) {
    if (ctrl && key === 'v') { e.preventDefault(); void pasteIntoCurrentRecord(); return }
    if (ctrl && alt && key === 'v') { e.preventDefault(); void pasteAsMultipleRecords(); return }

    // record nav
    if (alt && key === 'arrowleft') { e.preventDefault(); toPrevRecord(); return }
    if (alt && key === 'arrowright') { e.preventDefault(); toNextRecord(); return }

    // jump 1..9
    if (alt && /^[1-9]$/.test(key)) {
      e.preventDefault()
      const num = parseInt(key, 10)
      const exists = records.value.some(r => r.recordIndex === num)
      if (exists) {
        if (shift) toggleRecordSelection(num, true)
        else {
          currentRecordIndex.value = num
          expandedFields.value = new Set(currentRecord.value?.fields.map(f => f.name) ?? [])
          focusFieldByIndex(0)
        }
      }
      return
    }

    // new / duplicate / delete
    if (ctrl && shift && key === 'n') { e.preventDefault(); addRecord(); return }
    if (ctrl && key === 'd') { e.preventDefault(); duplicateCurrentRecord(); return }
    if (ctrl && shift && key === 'delete') { e.preventDefault(); deleteCurrentRecord(); return }

    // field navigation
    if (alt && (key === 'arrowdown' || key === 'arrowup')) {
      e.preventDefault()
      const total = currentRecord.value?.fields.length ?? 0
      if (total === 0) return
      if (lastFocusedFieldIdx < 0) lastFocusedFieldIdx = 0
      if (key === 'arrowdown') lastFocusedFieldIdx = Math.min(total - 1, lastFocusedFieldIdx + 1)
      else lastFocusedFieldIdx = Math.max(0, lastFocusedFieldIdx - 1)
      focusFieldByIndex(lastFocusedFieldIdx)
      return
    }

    // expand/collapse all
    if (alt && key === 'e') { e.preventDefault(); expandAllFields(); return }
    if (alt && key === 'c') { e.preventDefault(); collapseAllFields(); return }

    // cycle numeric field (Alt+F)
    if (alt && key === 'f') {
      e.preventDefault()
      if (!numericFieldNames.value.length) return
      if (!selectedNumericField.value) { selectedNumericField.value = numericFieldNames.value[0]!; return }
      const pos = numericFieldNames.value.indexOf(selectedNumericField.value)
      selectedNumericField.value = numericFieldNames.value[(pos + 1) % numericFieldNames.value.length]!
      return
    }
  }
}

watch(() => props.modelValue, v => {
  if (v) {
    initDialog()
    window.addEventListener('keydown', handleKey)
    nextTick(() => {
      const firstSelect = document.querySelector<HTMLDivElement>('.measurement-create-dialog select')
      firstSelect?.focus()
    })
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (props.modelValue) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))
</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="1020px"
    :hide-footer="false"
    class="measurement-create-dialog"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div class="text-h6">
        Nové měření (multi-record session)
      </div>
    </template>

    <!-- STEP 1: Meta -->
    <template
      v-if="step === 1"
      #content
    >
      <div class="text-subtitle-2 mb-2">
        Metadata
      </div>
      <v-row class="g-4 mb-1">
        <v-col
          cols="12"
          md="6"
        >
          <v-select
            v-model="selectedDeviceId"
            :items="props.devices"
            item-title="name"
            item-value="id"
            label="Přístroj"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          />
        </v-col>
        <v-col
          cols="12"
          md="6"
        >
          <v-select
            v-model="selectedTemplateId"
            :items="props.templates"
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

      <v-alert
        type="info"
        variant="tonal"
        density="comfortable"
        class="mt-2"
      >
        Chybí potřebná šablona?
        <v-btn
          variant="text"
          color="primary"
          class="ml-1 px-1"
          @click="() => emits('createTemplate')"
        >
          Vytvořit
        </v-btn>
        <v-btn
          variant="text"
          color="primary"
          class="ml-1 px-1"
          title="Vytvořit z hlaviček ve schránce"
          @click="() => emits('createTemplateFromClipboard')"
        >
          Ze schránky
        </v-btn>
      </v-alert>
    </template>

    <!-- STEP 2: Records -->
    <template
      v-else
      #content
    >
      <div
        class="d-flex align-center justify-space-between mb-2 flex-wrap"
        style="gap:12px;"
      >
        <div
          class="d-flex align-center flex-wrap"
          style="gap:6px;"
        >
          <span class="text-subtitle-2 mr-2">Recordy:</span>
          <v-chip
            v-for="r in records"
            :key="r.recordIndex"
            size="small"
            :color="r.recordIndex === currentRecordIndex
              ? 'primary'
              : (selectedRecordIndexes.has(r.recordIndex) ? 'deep-purple' : undefined)"
            variant="tonal"
            :title="`Record ${r.recordIndex} (Alt+${r.recordIndex <= 9 ? r.recordIndex : ''} | Shift+klik = subset)`"
            @click="toggleRecordSelection(r.recordIndex, false)"
            @mousedown.shift.prevent="toggleRecordSelection(r.recordIndex, true)"
          >
            {{ r.recordIndex }}
          </v-chip>

          <v-btn
            size="x-small"
            variant="text"
            icon="mdi-plus"
            title="Nový record (Ctrl+Shift+N)"
            @click="addRecord"
          />
          <v-btn
            size="x-small"
            variant="text"
            icon="mdi-content-copy"
            title="Duplikovat (Ctrl+D)"
            :disabled="!currentRecord"
            @click="duplicateCurrentRecord"
          />
          <v-btn
            size="x-small"
            variant="text"
            icon="mdi-delete-outline"
            title="Smazat (Ctrl+Shift+Del)"
            :disabled="records.length <= 1"
            @click="deleteCurrentRecord"
          />
          <v-btn
            size="x-small"
            variant="text"
            icon="mdi-chevron-left"
            title="Předchozí (Alt+←)"
            @click="toPrevRecord"
          />
          <v-btn
            size="x-small"
            variant="text"
            icon="mdi-chevron-right"
            title="Další (Alt+→)"
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
            title="Vložit jako více recordů (Ctrl+Alt+V)"
            @click="pasteAsMultipleRecords"
          >
            VÍCE RECORDŮ (Ctrl+Alt+V)
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            title="Expand all (Alt+E)"
            @click="expandAllFields"
          >
            EXPAND
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            title="Collapse all (Alt+C)"
            @click="collapseAllFields"
          >
            COLLAPSE
          </v-btn>
        </div>
      </div>

      <!-- Fields grid -->
      <div class="grid header-row">
        <div class="cell muted">
          Poř.
        </div>
        <div class="cell muted">
          Název + Typ
        </div>
        <div class="cell muted">
          Hodnota
        </div>
        <div class="cell muted">
          Stav
        </div>
      </div>

      <transition-group
        name="fade-y"
        tag="div"
      >
        <div
          v-for="(field, idx) in currentRecord?.fields || []"
          :key="field.name"
          class="grid data-row"
          :class="{'has-error': !!fieldError(field)}"
          :aria-expanded="isExpanded(field)"
        >
          <!-- index + expand toggle -->
          <div
            class="cell index d-flex align-center justify-center"
            style="gap:6px"
          >
            <v-btn
              icon
              size="x-small"
              variant="text"
              :title="isExpanded(field) ? 'Sbalit' : 'Rozbalit'"
              @click.stop="toggleField(field)"
            >
              <v-icon
                :icon="isExpanded(field) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                size="18"
              />
            </v-btn>
            <span>{{ idx + 1 }}</span>
          </div>

          <!-- name + type/preview -->
          <div class="cell name name-with-chip">
            <div
              class="d-flex align-center"
              style="gap:8px; min-width:0;"
            >
              <span class="name-text">{{ field.name }}</span>
              <v-chip
                v-if="isExpanded(field)"
                size="x-small"
                color="primary"
                variant="tonal"
                class="type-chip"
              >
                {{ TYPE_LABEL[field.type] }}
              </v-chip>
              <span
                v-else
                class="text-medium-emphasis text-mono preview-cell"
              >
                {{ previewValue(field) }}
              </span>
            </div>
          </div>

          <!-- value input -->
          <div class="cell value">
            <template v-if="isExpanded(field)">
              <v-switch
                v-if="field.type === 'bool'"
                :model-value="textModel(field)"
                color="deep-purple"
                hide-details
                inset
                density="comfortable"
                data-field-input
                @update:model-value="val => updateField(field, val)"
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
                @update:model-value="val => updateField(field, val)"
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
                @update:model-value="val => updateField(field, val)"
              />
              <v-text-field
                v-else-if="field.type === 'date'"
                :model-value="dateModel(field)"
                type="date"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                data-field-input
                @update:model-value="val => updateField(field, val)"
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
                @update:model-value="val => updateField(field, (Array.isArray(val) ? val[0] : val))"
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
                @update:model-value="val => updateField(field, val)"
              />
            </template>
          </div>

          <!-- state -->
          <div class="cell right">
            <v-tooltip
              v-if="fieldError(field)"
              location="top"
            >
              <template #activator="{ props: tp }">
                <v-icon
                  v-bind="tp"
                  size="18"
                  color="error"
                  icon="mdi-alert-circle-outline"
                />
              </template>
              <span>{{ fieldError(field) }}</span>
            </v-tooltip>
            <v-icon
              v-else
              size="18"
              color="green-darken-2"
              icon="mdi-check-circle-outline"
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
            :title="`Vybrat ${n} (Alt+F cyklus)`"
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
        :disabled="!selectedTemplateId"
        @click="goToStep2"
      >
        Pokračovat (Enter)
      </v-btn>
      <v-btn
        v-else
        color="primary"
        :loading="saving"
        :disabled="!canSave"
        @click="onSave"
      >
        Uložit (Ctrl+S)
      </v-btn>
    </template>
  </Dialog>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 72px 1fr minmax(240px, 1.5fr) 72px;
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
  padding: 6px;
  border-radius: 8px;
  transition: background-color .15s;
}
.data-row:hover { background: #f9fafc; }
.data-row.has-error { background: #fff6f6; }
.cell.muted { font-size: .75rem; }
.cell.index { text-align: center; color: rgba(0,0,0,0.6); }
.cell.right { text-align: right; }
.name-with-chip { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.type-chip { font-weight: 600; letter-spacing: .02em; text-transform: none; }
.preview-cell { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .75rem; opacity: .85; }

[data-field-input]:focus-visible {
  outline: 2px solid var(--v-theme-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

@media (max-width: 1040px) {
  .grid {
    grid-template-columns: 56px 1fr minmax(180px, 1.2fr) 56px;
  }
}
</style>
