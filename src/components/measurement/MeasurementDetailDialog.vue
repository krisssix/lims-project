<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import EntityEditorDialog from '@/components/EntityEditorDialog.vue'
import ChartPanel from '@/components/chart/ChartPanel.vue'
import { isEditableElement } from '@/components/ui/hotkeyGuard'
import { type DeviceItem, type ValueType, type TemplateItem, type TemplateBlockRow } from '@/types/measurement-ui'
import { type MeasurementResponse, type MeasuredValue } from '@/stores/measurement'
import {
  groupValuesToRecords,
  flattenRecords,
  newRecordFromTemplateFields,
  duplicateRecord,
  extractSeries,
  computeBasicStats,
  detectOutliersIqr,
  validateField,
  type MeasurementRecord,
  type RecordField
} from '@/utils/measurement-record-helpers'

/* ---------- Props / Emits ---------- */
const props = defineProps<{
  modelValue: boolean
  item: MeasurementResponse | null
  devices: DeviceItem[]
  members: string[]
  templates: TemplateItem[]
  currentUsername?: string
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', payload: {
    value: number
    type: string
    unit: string
    timestamp: number
    values: MeasuredValue[]
    boardCardId: number | null
    note: string | null
    measuredByUsername: string | null
  }): void
  (e: 'delete'): void
  (e: 'prev'): void
  (e: 'next'): void
}>()

/* ---------- Typové štítky ---------- */
const TYPE_LABEL: Record<ValueType, string> = {
  float: 'Float',
  int: 'Integer',
  text: 'Text',
  file: 'Soubor',
  bool: 'Boolean',
  date: 'Datum'
}

/* ---------- Meta stav ---------- */
const selectedTemplateName = ref<string>('')
const selectedDeviceId = ref<string>('')
const selectedUsername = ref<string | null>(null)
const noteText = ref<string>('')

/* ---------- Timestamp ---------- */
const dateYmd = ref<string>('')
const timeHM = ref<string>('')

function pad2(n: number): string { return String(n).padStart(2, '0') }
function toYmdLocal(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function hmFromMs(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function normalizeToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
}
function setHM(base: Date, hm: string): Date {
  const [h, m] = hm.split(':').map(v => parseInt(v, 10) || 0)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

/* ---------- Records ---------- */
const records = ref<MeasurementRecord[]>([])
const currentRecordIndex = ref<number>(1)
const selectedRecordIndexes = ref<Set<number>>(new Set())

/* ---------- Block navigation ---------- */
const currentBlockIndex = ref<number>(0)

function ensureCurrentRecordExists(): void {
  if (! records.value.length) return
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx === -1) currentRecordIndex.value = records.value[0]!.recordIndex
}

/* ---------- Selected template ---------- */
const selectedTemplate = computed<TemplateItem | null>(() => {
  return props.templates.find(t => t.name === selectedTemplateName.value) ??  null
})

/* ---------- Template blocks ---------- */
/* ---------- Template blocks ---------- */
const templateBlocks = computed<TemplateBlockRow[]>(() => {
  const tpl = selectedTemplate.value

  // 1. Pokud máme šablonu s bloky, použijeme je
  if (tpl && tpl.blocks && tpl.blocks. length > 0) {
    return tpl.blocks
  }

  // 2.  Pokud máme record s různými blockIndex, vytvoříme bloky z něj
  const rec = currentRecord.value
  if (rec && rec.fields. length > 0) {
    // Zjistit unikátní blockIndexy z načtených hodnot
    const blockMap = new Map<number, { title: string | null; fields: RecordField[] }>()

    for (const field of rec.fields) {
      const blockIdx = field.blockIndex ??  1
      if (!blockMap.has(blockIdx)) {
        blockMap. set(blockIdx, {
          title: field.blockTitle ??  null,
          fields: []
        })
      }
      blockMap.get(blockIdx)!.fields.push(field)
    }

    // Pokud máme více než 1 blok, vrátíme je
    if (blockMap.size > 1) {
      return Array.from(blockMap.entries())
          .sort(([a], [b]) => a - b)
          . map(([blockIndex, data]) => ({
            id: blockIndex,
            blockIndex,
            title: data.title || `Blok ${blockIndex}`,
            fields: data. fields.map((f, i) => ({
              orderIndex: i + 1,
              type: f.type,
              required: f.required,
              name: f.name
            }))
          }))
    }
  }

  // 3. Fallback: jeden blok ze všech polí šablony
  if (tpl && tpl.fields && tpl.fields.length > 0) {
    return [{
      id: 0,
      blockIndex: 1,
      title: 'Hodnoty',
      fields: tpl.fields
    }]
  }

  // 4. Fallback: jeden blok z aktuálního recordu
  if (rec) {
    return [{
      id: 0,
      blockIndex: 1,
      title: 'Hodnoty',
      fields: rec.fields. map((f, i) => ({
        orderIndex: i + 1,
        type: f.type,
        required: f.required,
        name: f. name
      }))
    }]
  }

  return []
})
const currentBlock = computed<TemplateBlockRow | null>(() => {
  return templateBlocks.value[currentBlockIndex.value] ??  null
})

/* ---------- Fields for current block ---------- */
const currentBlockFields = computed<RecordField[]>(() => {
  if (!currentRecord.value) return []

  // Pokud nemáme bloky nebo máme jen 1 blok, zobrazit všechna pole
  if (templateBlocks.value. length <= 1) {
    return currentRecord. value.fields
  }

  // Získat aktuální blok
  const block = currentBlock.value
  if (!block) {
    return currentRecord.value.fields
  }

  // Filtrovat pole podle blockIndex
  const blockIdx = block.blockIndex
  return currentRecord.value.fields. filter(f => (f.blockIndex ??  1) === blockIdx)
})

/** Helper type for template fields - matches newRecordFromTemplateFields signature */
type TemplateFieldInput = {
  name: string
  type: ValueType
  required: boolean
  blockIndex?: number
  blockTitle?: string
}

function templateFieldsForCurrent(): TemplateFieldInput[] {
  if (records.value.length) {
    return records.value[0]!.fields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      blockIndex: f.blockIndex ??  1,
      blockTitle: f.blockTitle ??  undefined
    }))
  }
  const tpl = props.templates.find(t => t.name === selectedTemplateName.value)
  if (! tpl) return []

  // Pokud má šablona bloky, flatten je
  if (tpl.blocks && tpl.blocks.length > 0) {
    const fields: TemplateFieldInput[] = []
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

  return (tpl.fields ??  []).map(f => ({
    name: f.name,
    type: f.type as ValueType,
    required: f.required,
    blockIndex: 1,
    blockTitle: 'Hodnoty'
  }))
}

/* ---------- Block navigation functions ---------- */
function prevBlock(): void {
  if (currentBlockIndex.value > 0) {
    currentBlockIndex.value--
  }
}

function nextBlock(): void {
  if (currentBlockIndex.value < templateBlocks.value.length - 1) {
    currentBlockIndex.value++
  }
}

/* ---------- Build z MeasurementResponse ---------- */
function buildFrom(item: MeasurementResponse | null): void {
  records.value = []
  currentBlockIndex.value = 0

  if (!item) return

  selectedTemplateName.value = item.type || ''
  selectedDeviceId.value = item.unit || ''
  selectedUsername.value = item.measuredByUsername ??  props.currentUsername ??  null
  noteText.value = item.note ?? ''

  const tsRaw = typeof item.timestamp === 'number'
      ? item.timestamp
      : Date.parse(String(item.timestamp))
  const ts = Number.isFinite(tsRaw) ? tsRaw : Date.now()
  const dt = new Date(ts)
  dateYmd.value = toYmdLocal(dt)
  timeHM.value = hmFromMs(ts)

  const vals = item.values ??  []
  if (vals.length) {
    records.value = groupValuesToRecords(vals)
  } else {
    const tplFields = templateFieldsForCurrent()
    if (tplFields.length) {
      records.value = [newRecordFromTemplateFields(1, tplFields)]
    } else {
      records.value = [{
        recordIndex: 1,
        fields: [{
          name: 'Hodnota',
          type: 'float',
          required: true,
          value: item.value ?? null,
          blockIndex: 1
        }]
      }]
    }
  }

  currentRecordIndex.value = records.value[0]?.recordIndex ?? 1
  selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  rebuildDerived()
}
watch(() => props.item, v => buildFrom(v), { immediate: true })

/* ---------- Derived ---------- */
const currentRecord = computed<MeasurementRecord | null>(() =>
    records.value.find(r => r.recordIndex === currentRecordIndex.value) ??  null
)

const numericFieldNames = computed<string[]>(() =>
    Array.from(new Set(
        records.value.flatMap(r =>
            r.fields.filter(f => f.type === 'float' || f.type === 'int').map(f => f.name)
        )
    ))
)

const selectedField = ref<string | null>(null)

/* ---------- Validace ---------- */
function validateAll(): number {
  let invalid = 0
  records.value.forEach(r =>
      r.fields.forEach(f => { if (validateField(f)) invalid++ })
  )
  return invalid
}
const invalidCount = ref<number>(0)

function rebuildDerived(): void {
  invalidCount.value = validateAll()
  if (! selectedField.value && numericFieldNames.value.length) {
    selectedField.value = numericFieldNames.value[0]!
  }
}

/* ---------- Record operations ---------- */
function addNewRecord(): void {
  const nextIndex = (records.value.length
      ? Math.max(...records.value.map(r => r.recordIndex)) + 1
      : 1)
  const tplFields = templateFieldsForCurrent()
  const rec = newRecordFromTemplateFields(nextIndex, tplFields)
  records.value.push(rec)
  currentRecordIndex.value = rec.recordIndex
  currentBlockIndex.value = 0
  selectedRecordIndexes.value.add(rec.recordIndex)
  rebuildDerived()
  focusFirstFieldSoon()
}

function duplicateCurrentRecord(): void {
  if (! currentRecord.value) return
  const nextIndex = Math.max(...records.value.map(r => r.recordIndex)) + 1
  const dup = duplicateRecord(currentRecord.value, nextIndex)
  records.value.push(dup)
  currentRecordIndex.value = dup.recordIndex
  currentBlockIndex.value = 0
  selectedRecordIndexes.value.add(dup.recordIndex)
  rebuildDerived()
  focusFirstFieldSoon()
}

function deleteCurrentRecord(): void {
  if (records.value.length <= 1) return
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx === -1) return
  records.value.splice(idx, 1)
  ensureCurrentRecordExists()
  currentBlockIndex.value = 0
  selectedRecordIndexes.value.delete(currentRecordIndex.value)
  if (! selectedRecordIndexes.value.size) {
    records.value.forEach(r => selectedRecordIndexes.value.add(r.recordIndex))
  }
  rebuildDerived()
}


/*
function toPrevRecord(): void {
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const pos = sorted.indexOf(currentRecordIndex.value)
  if (pos > 0) {
    currentRecordIndex.value = sorted[pos - 1]!
    currentBlockIndex.value = 0
    focusFirstFieldSoon()
  }
}
function toNextRecord(): void {
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const pos = sorted.indexOf(currentRecordIndex.value)
  if (pos < sorted.length - 1) {
    currentRecordIndex.value = sorted[pos + 1]!
    currentBlockIndex.value = 0
    focusFirstFieldSoon()
  }
}


 */


function toggleRecordSelection(rIndex: number, multi: boolean): void {
  if (multi) {
    if (selectedRecordIndexes.value.has(rIndex)) selectedRecordIndexes.value.delete(rIndex)
    else selectedRecordIndexes.value.add(rIndex)
    if (! selectedRecordIndexes.value.size) selectedRecordIndexes.value.add(rIndex)
  } else {
    currentRecordIndex.value = rIndex
    currentBlockIndex.value = 0
  }
  rebuildDerived()
}

/* ---------- Field value editing ---------- */
function parseNumber(raw: unknown, integer = false): number | null {
  if (raw == null || raw === '') return null
  const s = String(raw).replace(',', '.').trim()
  if (! s.length) return null
  const n = integer ? parseInt(s, 10) : parseFloat(s)
  return Number.isFinite(n) ? n : null
}
function normalizeBool(raw: unknown): boolean | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'boolean') return raw
  const s = String(raw).trim().toLowerCase()
  if (['1', 'true', 'ano', 'a', 'yes', 'y', 't'].includes(s)) return true
  if (['0', 'false', 'ne', 'n', 'no', 'f'].includes(s)) return false
  return null
}
function updateField(field: RecordField, raw: unknown): void {
  switch (field.type) {
    case 'float': field.value = parseNumber(raw, false); break
    case 'int': field.value = parseNumber(raw, true); break
    case 'bool': field.value = normalizeBool(raw); break
    case 'date': {
      if (raw === null || raw === '') { field.value = null; break }
      if (typeof raw === 'number') { field.value = raw; break }
      if (typeof raw === 'string') {
        const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (m) {
          const y = +m[1]; const mo = +m[2]; const d = +m[3]
          field.value = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime()
        } else {
          const ms = Date.parse(raw)
          field.value = Number.isNaN(ms) ?  null : ms
        }
        break
      }
      if (raw instanceof Date) {
        field.value = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 0, 0, 0, 0).getTime()
        break
      }
      field.value = null
      break
    }
    case 'file': field.value = raw; break
    case 'text':
    default: field.value = raw ??  ''
  }
  invalidCount.value = validateAll()
}

/* ---------- Helpers pro template (bez unionů) ---------- */
function textModel(field: RecordField): string | number | null | undefined {
  return (field.value ??  null) as string | number | null | undefined
}
function dateModel(field: RecordField): string | null {
  return typeof field.value === 'number'
      ? new Date(field.value).toISOString().slice(0, 10)
      : (field.value as string | null | undefined) ?? null
}
function fileModel(field: RecordField): File | null | undefined {
  return field.value as File | null | undefined
}
function fieldError(field: RecordField): string | null {
  return validateField(field)
}
function previewValue(field: RecordField): string {
  const v = field.value
  switch (field.type) {
    case 'float':
    case 'int': {
      const num = typeof v === 'number'
          ? v
          : (v == null ?  null : parseNumber(v, field.type === 'int'))
      return num == null || Number.isNaN(num) ? '—' : String(num)
    }
    case 'bool': return v === true ? 'Ano' : (v === false ? 'Ne' : '—')
    case 'date': {
      const ms = typeof v === 'number' ? v : (typeof v === 'string' ? Date.parse(v) : NaN)
      return Number.isFinite(ms) ?  new Date(ms).toISOString().slice(0, 10) : '—'
    }
    case 'file':
      return (v && (v as { name?: string }).name) ?  String((v as { name?: string }).name) : '—'
    case 'text':
    default: {
      const s = v == null ? '' : String(v).trim()
      return s.length ? s : '—'
    }
  }
}

/* ---------- Sekce collapsible ---------- */
const metaCollapsed = ref(false)
const valuesCollapsed = ref(false)
const statsCollapsed = ref(false)
function toggleMeta(): void { metaCollapsed.value = !metaCollapsed.value }
function toggleValues(): void { valuesCollapsed.value = ! valuesCollapsed.value }
function toggleStats(): void { statsCollapsed.value = !statsCollapsed.value }

/* ---------- Expand/Collapse všech fieldů ---------- */
const expandedFields = ref<Set<string>>(new Set())
function expandAllValues(): void {
  if (!currentRecord.value) return
  expandedFields.value = new Set(currentRecord.value.fields.map(f => f.name))
  valuesCollapsed.value = false
}
function collapseAllValues(): void {
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

/* ---------- Statistiky & graf ---------- */
const chartPoints = computed<number[]>(() => {
  if (! selectedField.value) return []
  const subset = selectedRecordIndexes.value.size
      ? Array.from(selectedRecordIndexes.value)
      : records.value.map(r => r.recordIndex)
  const subsetRecords = records.value.filter(r => subset.includes(r.recordIndex))
  return extractSeries(subsetRecords, selectedField.value)
})
const statsObj = computed(() => computeBasicStats(chartPoints.value))
const outliers = computed(() => detectOutliersIqr(chartPoints.value))
const statsSummary = computed<string[]>(() => {
  if (!numericFieldNames.value.length) return ['Bez numerických dat']
  if (!statsObj.value) return ['Numerická pole: ' + numericFieldNames.value.length]
  const s = statsObj.value
  return [`N=${s.count}`, `μ=${s.mean.toFixed(2)}`, `σ=${s.stdDev.toFixed(2)}`]
})

/* ---------- Uložení ---------- */
const isSaving = ref(false)
const canSaveMeta = computed(() =>
    !!selectedTemplateName.value.trim() &&
    !!selectedDeviceId.value &&
    invalidCount.value === 0
)

async function onSave(): Promise<void> {
  if (! props.item || ! canSaveMeta.value) return
  isSaving.value = true
  try {
    const firstNumeric = records.value
        .flatMap(r => r.fields)
        .filter(f => f.type === 'float' || f.type === 'int')
        .map(f => parseNumber(f.value, f.type === 'int'))
        .find(n => Number.isFinite(n as number))

    const baseDay = dateYmd.value ?  normalizeToDate(dateYmd.value) : new Date()
    const tsMs = setHM(baseDay, timeHM.value || '00:00').getTime()

    emits('save', {
      value: Number.isFinite(firstNumeric as number)
          ? (firstNumeric as number)
          : (props.item.value ??  0),
      type: selectedTemplateName.value,
      unit: selectedDeviceId.value,
      timestamp: tsMs,
      values: flattenRecords(records.value),
      boardCardId: props.item.boardCardId ??  null,
      note: noteText.value.trim() ?  noteText.value.trim() : null,
      measuredByUsername: selectedUsername.value?.trim() || null
    })
  } finally {
    isSaving.value = false
  }
}

/* ---------- Export CSV ---------- */
function exportSelectedCsv(): void {
  if (!selectedField.value) return
  const subset = selectedRecordIndexes.value.size
      ? Array.from(selectedRecordIndexes.value).sort((a, b) => a - b)
      : records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const rows: string[] = ['recordIndex;value']
  subset.forEach(ri => {
    const rec = records.value.find(r => r.recordIndex === ri)
    if (! rec) return
    const f = rec.fields.find(ff => ff.name === selectedField.value)
    if (! f) return
    if (f.type === 'float' || f.type === 'int') {
      const num = parseNumber(f.value, f.type === 'int')
      if (num != null) rows.push(`${ri};${num}`)
    } else if (f.type === 'text') {
      const num = parseNumber(f.value, false)
      if (num != null) rows.push(`${ri};${num}`)
    }
  })
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `measurement-${selectedField.value}-records.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/* ---------- Keyboard shortcuts ---------- */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let lastFocusedFieldIndex = -1
function focusFirstFieldSoon(): void {
  nextTick(() => {
    const el = document.querySelector<HTMLElement>('[data-field-input]')
    el?.focus()
    lastFocusedFieldIndex = 0
  })
}

function focusFieldByIndex(idx: number): void {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-field-input]')
    const el = els[idx]
    if (el) {
      el.focus()
      lastFocusedFieldIndex = idx
    }
  })
}

function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey

  // Bezpečné: Esc, Ctrl+S, Ctrl+←/→
  if (key === 'escape') { e.preventDefault(); emits('update:modelValue', false); return }
  if (ctrl && key === 's') { e.preventDefault(); void onSave(); return }
  if (ctrl && key === 'arrowleft') { e.preventDefault(); emits('prev'); return }
  if (ctrl && key === 'arrowright') { e.preventDefault(); emits('next'); return }

  // Pokud píšu do pole, nic dalšího neřešit
  if (isEditableElement(e.target)) return

  // PageUp/PageDown pro bloky je bezpečné (nejsou to písmena)
  if (key === 'pageup') { e.preventDefault(); prevBlock(); return }
  if (key === 'pagedown') { e.preventDefault(); nextBlock(); return }

  // Všechny Alt-only zkratky a Alt navigace jsou vypnuté, aby neblokovaly písmena.
}

watch(() => props.modelValue, v => {
  if (v) {
    window.addEventListener('keydown', handleKey)
    nextTick(() => {
      const firstMeta = document.querySelector<HTMLElement>('[data-meta-first]')
      firstMeta?.focus()
    })
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (props.modelValue) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))

/* ---------- Live status ---------- */
const liveStatus = computed<string>(() => {
  const errs = invalidCount.value
  if (errs > 0) return `Formulář obsahuje ${errs} neplatných hodnot.  Nelze uložit.`
  return 'Formulář je validní.  Můžete uložit.'
})
</script>

<template>
  <EntityEditorDialog
      :is-open="modelValue"
      entity-label="měření"
      mode="edit"
      :saving="isSaving"
      :deletable="true"
      :width="'980px'"
      :title-extra="dateYmd ? `${dateYmd}${timeHM ?  ' ' + timeHM : ''}` : ''"
      @update:is-open="v => emits('update:modelValue', v)"
      @save="onSave"
      @delete="() => emits('delete')"
      @cancel="() => emits('update:modelValue', false)"
  >
    <template #header-right>
      <v-btn
          icon="mdi-chevron-up"
          variant="text"
          title="Předchozí měření (Ctrl+←)"
          @click="() => emits('prev')"
      />
      <v-btn
          icon="mdi-chevron-down"
          variant="text"
          title="Další měření (Ctrl+→)"
          @click="() => emits('next')"
      />
    </template>

    <v-toolbar
        density="compact"
        class="sticky-toolbar mb-3 elevation-1"
        flat
        role="toolbar"
        aria-label="Sekce detailu měření"
    >
      <v-toolbar-title class="text-body-2 font-weight-medium">
        Detail měření
      </v-toolbar-title>
      <v-spacer />
      <v-btn
          size="small"
          :variant="metaCollapsed ? 'tonal' : 'flat'"
          :color="metaCollapsed ? undefined : 'primary'"
          class="mr-1"
          :aria-expanded="! metaCollapsed"
          aria-controls="section-meta"
          title="Meta (Alt+M)"
          @click="toggleMeta"
      >
        Meta
      </v-btn>
      <v-btn
          size="small"
          :variant="valuesCollapsed ? 'tonal' : 'flat'"
          :color="valuesCollapsed ? undefined : 'primary'"
          class="mr-1"
          :aria-expanded="! valuesCollapsed"
          aria-controls="section-values"
          title="Hodnoty (Alt+V)"
          @click="toggleValues"
      >
        Hodnoty
        <v-badge
            v-if="invalidCount > 0"
            :content="invalidCount"
            color="error"
            inline
            class="ml-2"
            :title="`${invalidCount} neplatných`"
        />
      </v-btn>
      <v-btn
          size="small"
          :variant="statsCollapsed ? 'tonal' : 'flat'"
          :color="statsCollapsed ? undefined : 'primary'"
          :aria-expanded="! statsCollapsed"
          aria-controls="section-stats"
          title="Statistika (Alt+S)"
          @click="toggleStats"
      >
        Statistika
      </v-btn>
    </v-toolbar>

    <div
        class="detail-scroll"
        style="height:720px; overflow:auto; padding-right:4px;"
        aria-live="polite"
        :aria-label="liveStatus"
    >
      <!-- Meta -->
      <section
          id="section-meta"
          class="mb-4"
          :aria-hidden="metaCollapsed"
      >
        <div
            class="d-flex align-center mb-2 section-heading"
            style="gap:6px"
        >
          <v-icon
              size="18"
              color="grey-darken-2"
          >
            mdi-information-outline
          </v-icon>
          <span class="text-caption text-medium-emphasis">Metadata měření</span>
          <div
              v-if="metaCollapsed"
              class="d-flex align-center flex-wrap"
              style="gap:4px; margin-left:8px;"
          >
            <v-chip
                size="x-small"
                variant="tonal"
            >
              {{ selectedUsername || '—' }}
            </v-chip>
            <v-chip
                size="x-small"
                variant="tonal"
            >
              {{ selectedDeviceId || '—' }}
            </v-chip>
            <v-chip
                size="x-small"
                variant="tonal"
            >
              {{ selectedTemplateName || '—' }}
            </v-chip>
          </div>
          <v-spacer />
          <v-btn
              icon
              variant="text"
              :aria-label="metaCollapsed ? 'Rozbalit meta' : 'Sbalit meta'"
              :title="metaCollapsed ? 'Rozbalit (Alt+M)' : 'Sbalit (Alt+M)'"
              @click="toggleMeta"
          >
            <v-icon :class="{'rot-180': ! metaCollapsed}">
              mdi-chevron-down
            </v-icon>
          </v-btn>
        </div>
        <v-divider class="mb-2" />
        <div v-show="!metaCollapsed">
          <v-row class="g-4">
            <v-col
                cols="12"
                md="4"
            >
              <v-select
                  v-model="selectedUsername"
                  :items="members"
                  label="Člen"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  clearable
                  data-meta-first
                  :hint="! selectedUsername ? 'Vyplňte autora měření' : undefined"
                  persistent-hint
              />
            </v-col>
            <v-col
                cols="12"
                md="4"
            >
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
                  <v-chip
                      size="small"
                      :color="item.raw?.color"
                      text-color="white"
                  >
                    {{ item.raw?.id }}
                  </v-chip>
                </template>
              </v-select>
            </v-col>
            <v-col
                cols="12"
                md="4"
            >
              <v-select
                  v-model="selectedTemplateName"
                  :items="templates"
                  item-title="name"
                  item-value="name"
                  label="Šablona"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  clearable
              />
            </v-col>
            <v-col
                cols="12"
                md="6"
            >
              <v-text-field
                  v-model="dateYmd"
                  type="date"
                  label="Datum měření"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
              />
            </v-col>
            <v-col
                cols="12"
                md="6"
            >
              <v-text-field
                  v-model="timeHM"
                  type="time"
                  label="Čas měření"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                  v-model="noteText"
                  label="Poznámka"
                  variant="outlined"
                  density="comfortable"
                  auto-grow
                  rows="2"
                  hide-details="auto"
              />
            </v-col>
          </v-row>
        </div>
      </section>

      <!-- Hodnoty -->
      <section
          id="section-values"
          class="mb-4"
          :aria-hidden="valuesCollapsed"
      >
        <div
            class="d-flex align-center mb-2"
            style="gap:8px;"
        >
          <span class="text-subtitle-2">Hodnoty (Recordy)</span>
          <div
              class="d-flex flex-wrap"
              style="gap:6px; margin-left:12px;"
          >
            <v-chip
                v-for="r in records"
                :key="r.recordIndex"
                size="small"
                :color="r.recordIndex === currentRecordIndex ? 'primary' : (selectedRecordIndexes.has(r.recordIndex) ? 'deep-purple' : undefined)"
                variant="tonal"
                :title="`Record ${r.recordIndex} (Alt+${r.recordIndex <=9 ? r.recordIndex : ''} | Shift+klik pro subset)`"
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
                @click="addNewRecord"
            />
            <v-btn
                size="x-small"
                variant="text"
                icon="mdi-content-copy"
                title="Duplikovat record (Ctrl+D)"
                :disabled="! currentRecord"
                @click="duplicateCurrentRecord"
            />
            <v-btn
                size="x-small"
                variant="text"
                icon="mdi-delete-outline"
                title="Smazat record (Ctrl+Shift+Del)"
                :disabled="records.length <= 1"
                @click="deleteCurrentRecord"
            />
          </div>

          <v-spacer />
          <v-btn
              size="x-small"
              variant="text"
              :icon="valuesCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
              :title="valuesCollapsed ? 'Rozbalit (Alt+V)' : 'Sbalit (Alt+V)'"
              @click="toggleValues"
          />
          <v-btn
              size="x-small"
              variant="text"
              icon="mdi-unfold-more-horizontal"
              title="Expand all (Alt+E)"
              @click="expandAllValues"
          />
          <v-btn
              size="x-small"
              variant="text"
              icon="mdi-unfold-less-horizontal"
              title="Collapse all (Alt+C)"
              @click="collapseAllValues"
          />
        </div>

        <div v-show="!valuesCollapsed">
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
                    title="Předchozí blok (PageUp)"
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
                    title="Další blok (PageDown)"
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

            <!-- Block tabs -->
            <div class="block-tabs mt-2">
              <v-chip
                  v-for="(block, idx) in templateBlocks"
                  :key="block.id"
                  size="small"
                  :color="idx === currentBlockIndex ?  'primary' : undefined"
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

          <!-- Single block header (when only 1 block) -->
          <div
              v-else-if="currentBlock && templateBlocks.length === 1"
              class="block-header mb-3"
          >
            <div class="text-subtitle-1 font-weight-medium">
              {{ currentBlock.title }}
            </div>
          </div>

          <!-- Fields grid for current block -->
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
                v-for="(field, idx) in currentBlockFields"
                :key="field.name"
                class="grid data-row"
                :class="{'has-error': !!fieldError(field)}"
                :aria-expanded="isExpanded(field)"
                :aria-label="`Field ${idx+1}: ${field.name} (${TYPE_LABEL[field.type]})`"
            >
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
        </div>
      </section>

      <!-- Statistika -->
      <section
          id="section-stats"
          :aria-hidden="statsCollapsed"
      >
        <div
            class="d-flex align-center mb-2"
            style="gap:6px;"
        >
          <span class="text-subtitle-2">Vizualizace / Statistika</span>
          <div
              v-if="statsCollapsed"
              class="d-flex align-center flex-wrap"
              style="gap:4px; margin-left:8px;"
          >
            <v-chip
                v-for="(t, i) in statsSummary"
                :key="i"
                size="x-small"
                variant="tonal"
            >
              {{ t }}
            </v-chip>
          </div>
          <v-spacer />
          <v-btn
              size="x-small"
              variant="text"
              :icon="statsCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
              :title="statsCollapsed ? 'Rozbalit (Alt+S)' : 'Sbalit (Alt+S)'"
              @click="toggleStats"
          />
        </div>

        <v-sheet
            v-show="! statsCollapsed"
            elevation="1"
            class="pa-4 rounded-lg"
            aria-label="Panel statistik"
        >
          <div
              class="d-flex align-center mb-3 flex-wrap"
              style="gap:8px;"
          >
            <div class="text-caption font-weight-medium">
              Numerická pole:
            </div>
            <div
                class="d-flex align-center flex-wrap"
                style="gap:6px;"
            >
              <v-chip
                  v-for="(f, i) in numericFieldNames"
                  :key="`${f}-${i}`"
                  :color="selectedField === f ? 'primary' : undefined"
                  variant="tonal"
                  size="small"
                  :title="`Vybrat ${f} (Alt+F cyklus)`"
                  @click="selectedField = f"
              >
                {{ f }}
              </v-chip>
              <v-chip
                  v-if="numericFieldNames.length > 1"
                  :color="! selectedField ?  'primary' : undefined"
                  variant="tonal"
                  size="small"
                  title="Vše"
                  @click="selectedField = null"
              >
                Vše
              </v-chip>
            </div>

            <v-spacer />
            <v-btn
                size="small"
                variant="text"
                title="Export numerických hodnot (Ctrl+E)"
                @click="exportSelectedCsv"
            >
              Export CSV
            </v-btn>
          </div>

          <ChartPanel
              :chart-points="chartPoints"
              :stats="statsObj"
              :fields="numericFieldNames"
              :selected-field="selectedField"
              @select-field="f => (selectedField = f)"
          />
          <div
              v-if="outliers.outlierIndexes.length"
              class="text-caption mt-2"
          >
            Outliers: {{ outliers.outlierIndexes.join(', ') }}
            (fence {{ outliers.lowerFence.toFixed(2) }} – {{ outliers.upperFence.toFixed(2) }})
          </div>
        </v-sheet>
      </section>
    </div>

    <template #footer>
      <div class="d-flex align-center justify-space-between w-100">
        <div class="text-caption text-medium-emphasis">
          <span v-if="invalidCount > 0">
            {{ invalidCount }} neplatných hodnot – opravte před uložením.
          </span>
          <span v-else>
            Formulář je validní.Ctrl+S pro uložení.
          </span>
        </div>
        <div
            class="d-flex"
            style="gap:12px;"
        >
          <v-btn
              variant="text"
              title="Zavřít (Esc)"
              @click="emits('update:modelValue', false)"
          >
            Zavřít
          </v-btn>
          <v-btn
              color="primary"
              variant="flat"
              :disabled="!canSaveMeta || isSaving"
              :loading="isSaving"
              title="Uložit (Ctrl+S)"
              @click="onSave"
          >
            Uložit
          </v-btn>
        </div>
      </div>
    </template>
  </EntityEditorDialog>
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
  letter-spacing:.03em;
  text-transform: uppercase;
  color: var(--v-theme-grey-darken-2);
}
.data-row {
  padding: 6px;
  border-radius: 8px;
  transition: background-color.15s, box-shadow.15s;
}
.data-row:hover { background: #f9fafc; }
.data-row.has-error { background: #fff6f6; }
.cell.muted { font-size:.75rem; }
.cell.index { text-align: center; color: rgba(0,0,0,0.54); }
.cell.right { text-align: right; }
.name-with-chip { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.type-chip { font-weight: 600; letter-spacing:.02em; text-transform: none; }
.preview-cell { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:.75rem; opacity:.85; }

.rot-180 { transform: rotate(180deg); }

.detail-scroll { box-sizing: border-box; }

.sticky-toolbar {
  position: sticky;
  top: 0;
  z-index: 30;
  backdrop-filter: blur(6px);
  background-color: rgba(255,255,255,0.78);
}

[data-field-input]:focus-visible {
  outline: 2px solid var(--v-theme-primary);
  outline-offset: 2px;
  border-radius: 6px;
}

.section-heading { font-weight: 600; letter-spacing:.02em; }

.text-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* Block navigation */
.block-navigation {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 12px 16px;
}

.block-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.block-header {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 12px 16px;
}

@media (max-width: 1040px) {
  .grid {
    grid-template-columns: 56px 1fr minmax(180px, 1.2fr) 56px;
  }
}
</style>
