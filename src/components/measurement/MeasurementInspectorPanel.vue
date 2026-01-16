<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import ChartPanel from '@/components/chart/ChartPanel.vue'
import TemplateSelect from '@/components/measurement/TemplateSelect.vue'
import { isEditableElement } from '@/components/ui/hotkeyGuard'
import { type DeviceItem, type ValueType, type TemplateItem, type TemplateBlockRow } from '@/types/measurement-ui'
import { type MeasurementResponse, type MeasuredValue, type MeasurementSeriesResponse } from '@/stores/measurement'
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
import { uploadFile, extractFilesFromRecords } from '@/services/api/file-upload'
import { config } from '@/config'
import { contrastText } from '@/utils/colorContrast'


type PanelMode = 'docked' | 'wide' | 'fullscreen'


const props = defineProps<{
  modelValue: boolean
  mode?: PanelMode
  item: MeasurementResponse | null
  devices: DeviceItem[]
  members: string[]
  templates: TemplateItem[]
  currentUsername?: string
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'update:mode', v: PanelMode): void
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
  (e: 'duplicate'): void
  (e: 'prev'): void
  (e: 'next'): void
}>()


/*
const linkCopied = ref(false)
async function copyLink(): Promise<void> {
  if (!props.item?.id) return
  const url = `${window.location.origin}${window.location.pathname}?measurementId=${props.item.id}`
  try {
    await navigator.clipboard.writeText(url)
    linkCopied.value = true
    setTimeout(() => { linkCopied.value = false }, 2000)
  } catch (err) {
    console.error('Failed to copy link:', err)
  }
}
*/

function duplicateMeasurement(): void {
  emits('duplicate')
}


const panelMode = ref<PanelMode>(props.mode || 'docked')
watch(() => props.mode, v => { if (v) panelMode.value = v })


const customWidth = ref<number | null>(null)
const isResizing = ref(false)
const MIN_WIDTH = 320
const MAX_WIDTH = 800

const panelWidth = computed(() => {
  if (panelMode.value === 'fullscreen') return '100vw'
  if (customWidth.value !== null) return `${customWidth.value}px`
  switch (panelMode.value) {
    case 'wide': return '600px'
    default: return '420px'
  }
})

function startResize(e: MouseEvent): void {
  e.preventDefault()
  isResizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  
  const startX = e.clientX
  const startWidth = customWidth.value ?? (panelMode.value === 'wide' ? 600 : 420)
  
  function onMouseMove(moveEvent: MouseEvent): void {
    const delta = startX - moveEvent.clientX
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
    customWidth.value = newWidth
  }
  
  function onMouseUp(): void {
    isResizing.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// Reset custom width when mode changes
watch(panelMode, () => {
  customWidth.value = null
})

function toggleWide(): void {
  panelMode.value = panelMode.value === 'wide' ? 'docked' : 'wide'
  emits('update:mode', panelMode.value)
}

function toggleFullscreen(): void {
  panelMode.value = panelMode.value === 'fullscreen' ? 'wide' : 'fullscreen'
  emits('update:mode', panelMode.value)
}


const activeTab = ref<'meta' | 'values' | 'stats'>('meta')


const TYPE_LABEL: Record<ValueType, string> = {
  float: 'Float',
  int: 'Integer',
  text: 'Text',
  file: 'Soubor',
  bool: 'Boolean',
  date: 'Datum'
}


const selectedTemplateName = ref<string>('')
const selectedDeviceId = ref<string>('')
const selectedUsername = ref<string | null>(null)
const noteText = ref<string>('')


const originalData = ref<{
  templateName: string
  deviceId: string
  username: string | null
  note: string
  dateYmd: string
  timeHM: string
  records: string // JSON stringified
} | null>(null)

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

/* ---------- CreatedAt (read-only) ---------- */
const createdAtFormatted = computed(() => {
  const raw = (props.item as unknown as { createdAt?: number | null })?.createdAt
  if (!raw || typeof raw !== 'number') return { date: '', time: '' }
  const d = new Date(raw)
  if (isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
})

/* ---------- Measurement date formatted ---------- */
const measurementDateFormatted = computed(() => {
  if (!dateYmd.value) return ''
  const d = normalizeToDate(dateYmd.value)
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${timeHM.value || ''}`
})

/* ---------- Records ---------- */
const records = ref<MeasurementRecord[]>([])
const currentRecordIndex = ref<number>(1)
const selectedRecordIndexes = ref<Set<number>>(new Set())

/* ---------- Block navigation ---------- */
const currentBlockIndex = ref<number>(0)

function ensureCurrentRecordExists(): void {
  if (!records.value.length) return
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx === -1) currentRecordIndex.value = records.value[0]!.recordIndex
}

/* ---------- Selected template ---------- */
const selectedTemplate = computed<TemplateItem | null>(() =>
    props.templates.find(t => t.name === selectedTemplateName.value) ?? null
)

/* ---------- Template blocks ---------- */
const templateBlocks = computed<TemplateBlockRow[]>(() => {
  const tpl = selectedTemplate.value

  if (tpl && tpl.blocks && tpl.blocks.length > 0) {
    return tpl.blocks
  }

  const rec = currentRecord.value
  if (rec && rec.fields.length > 0) {
    const blockMap = new Map<number, { title: string | null; fields: RecordField[] }>()
    for (const field of rec.fields) {
      const blockIdx = field.blockIndex ?? 1
      if (!blockMap.has(blockIdx)) {
        blockMap.set(blockIdx, { title: field.blockTitle ?? null, fields: [] })
      }
      blockMap.get(blockIdx)!.fields.push(field)
    }
    if (blockMap.size > 1) {
      return Array.from(blockMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([blockIndex, data]) => ({
            id: blockIndex,
            blockIndex,
            title: data.title || `Tabulka hodnot ${blockIndex}`,
            fields: data.fields.map((f, i) => ({
              orderIndex: i + 1,
              type: f.type,
              required: f.required,
              name: f.name
            }))
          }))
    }
  }

  if (tpl && tpl.fields && tpl.fields.length > 0) {
    return [{
      id: 0,
      blockIndex: 1,
      title: 'Hodnoty',
      fields: tpl.fields
    }]
  }

  if (rec) {
    return [{
      id: 0,
      blockIndex: 1,
      title: 'Hodnoty',
      fields: rec.fields.map((f, i) => ({
        orderIndex: i + 1,
        type: f.type,
        required: f.required,
        name: f.name
      }))
    }]
  }

  return []
})
const currentBlock = computed<TemplateBlockRow | null>(() =>
    templateBlocks.value[currentBlockIndex.value] ?? null
)

/* ---------- Fields for current block ---------- */
const currentBlockFields = computed<RecordField[]>(() => {
  if (!currentRecord.value) return []
  if (templateBlocks.value.length <= 1) return currentRecord.value.fields
  const block = currentBlock.value
  if (!block) return currentRecord.value.fields
  const blockIdx = block.blockIndex
  return currentRecord.value.fields.filter(f => (f.blockIndex ?? 1) === blockIdx)
})

/** Helper type for template fields */
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
      blockIndex: f.blockIndex ?? 1,
      blockTitle: f.blockTitle ?? undefined
    }))
  }
  const tpl = props.templates.find(t => t.name === selectedTemplateName.value)
  if (!tpl) return []

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

  return (tpl.fields ?? []).map(f => ({
    name: f.name,
    type: f.type as ValueType,
    required: f.required,
    blockIndex: 1,
    blockTitle: 'Hodnoty'
  }))
}

/* ---------- Block navigation ---------- */
function prevBlock(): void {
  if (currentBlockIndex.value > 0) currentBlockIndex.value--
}
function nextBlock(): void {
  if (currentBlockIndex.value < templateBlocks.value.length - 1) currentBlockIndex.value++
}

/* ---------- Build z MeasurementResponse ---------- */
function buildFrom(item: MeasurementResponse | null): void {
  records.value = []
  currentBlockIndex.value = 0

  if (!item) return

  selectedTemplateName.value = item.type || ''
  selectedDeviceId.value = item.unit || ''
  selectedUsername.value = item.measuredByUsername ?? props.currentUsername ?? null
  noteText.value = item.note ?? ''

  const tsRaw = typeof item.timestamp === 'number'
      ? item.timestamp
      : Date.parse(String(item.timestamp))
  const ts = Number.isFinite(tsRaw) ? tsRaw : Date.now()
  const dt = new Date(ts)
  dateYmd.value = toYmdLocal(dt)
  timeHM.value = hmFromMs(ts)

  const vals = item.values ?? []
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
  
  // Store original for dirty detection
  originalData.value = {
    templateName: selectedTemplateName.value,
    deviceId: selectedDeviceId.value,
    username: selectedUsername.value,
    note: noteText.value,
    dateYmd: dateYmd.value,
    timeHM: timeHM.value,
    // json stringified: originalData.value.records
    records: JSON.stringify(records.value)
  }
}
watch(() => props.item, v => buildFrom(v), { immediate: true })

const isDirty = computed(() => {
  if (!originalData.value) return false
  return (
    selectedTemplateName.value !== originalData.value.templateName ||
    selectedDeviceId.value !== originalData.value.deviceId ||
    selectedUsername.value !== originalData.value.username ||
    noteText.value !== originalData.value.note ||
    dateYmd.value !== originalData.value.dateYmd ||
    timeHM.value !== originalData.value.timeHM ||
    JSON.stringify(records.value) !== originalData.value.records
  )
})

/* potvrzovací dialog */
const showConfirmDialog = ref(false)
const confirmAction = ref<'close' | 'switch' | null>(null)

function requestClose(): void {
  if (isDirty.value) {
    confirmAction.value = 'close'
    showConfirmDialog.value = true
  } else {
    closePanel()
  }
}

function confirmSave(): void {
  showConfirmDialog.value = false
  void onSave().then(() => {
    if (confirmAction.value === 'close') closePanel()
  })
}

function confirmDiscard(): void {
  showConfirmDialog.value = false
  closePanel()
}

function confirmCancel(): void {
  showConfirmDialog.value = false
  confirmAction.value = null
}


const currentRecord = computed<MeasurementRecord | null>(() =>
    records.value.find(r => r.recordIndex === currentRecordIndex.value) ?? null
)


const recordItems = computed(() =>
  records.value.map(r => ({
    title: `Záznam ${r.recordIndex}`,
    value: r.recordIndex
  }))
)

const currentPosition = computed(() => {
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  return idx + 1
})

function onSelectRecord(val: number): void {
  currentRecordIndex.value = val
  currentBlockIndex.value = 0
  rebuildDerived()
}

function prevRecord(): void {
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx > 0) {
    currentRecordIndex.value = records.value[idx - 1]!.recordIndex
    currentBlockIndex.value = 0
    rebuildDerived()
  }
}

function nextRecord(): void {
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx < records.value.length - 1) {
    currentRecordIndex.value = records.value[idx + 1]!.recordIndex
    currentBlockIndex.value = 0
    rebuildDerived()
  }
}

const numericFieldNames = computed<string[]>(() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of records.value) {
    for (const f of r.fields) {
      let isNumeric = f.type === 'float' || f.type === 'int'
      if (!isNumeric && f.type === 'text') {
        const raw = f.value
        const s = raw == null ? '' : String(raw).trim().replace(',', '.')
        const n = Number(s)
        isNumeric = Number.isFinite(n)
      }
      if (isNumeric && !seen.has(f.name)) {
        seen.add(f.name)
        out.push(f.name)
      }
    }
  }
  return out
})

const selectedField = ref<string | null>(null)


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
  if (!selectedField.value && numericFieldNames.value.length) {
    selectedField.value = numericFieldNames.value[0]!
  }
}


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
  if (!currentRecord.value) return
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
  if (!selectedRecordIndexes.value.size) {
    records.value.forEach(r => selectedRecordIndexes.value.add(r.recordIndex))
  }
  rebuildDerived()
}


function parseNumber(raw: unknown, integer = false): number | null {
  if (raw == null || raw === '') return null
  const s = String(raw).replace(',', '.').trim()
  if (!s.length) return null
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
          field.value = Number.isNaN(ms) ? null : ms
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
    default: field.value = raw ?? ''
  }
  invalidCount.value = validateAll()
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
  if (field.value instanceof File) return field.value
  return null
}

function hasExistingFileUrl(field: RecordField): boolean {
  return typeof field.value === 'string' && field.value.length > 0
}

function getFileDisplayUrl(field: RecordField): string {
  if (typeof field.value !== 'string') return ''
  if (field.value.startsWith('http://') || field.value.startsWith('https://')) {
    return field.value
  }
  const baseUrl = config.serverUrl.endsWith('/') 
    ? config.serverUrl.slice(0, -1) 
    : config.serverUrl
  const filePath = field.value.startsWith('/') ? field.value : `/${field.value}`
  return `${baseUrl}${filePath}`
}

function getFileNameFromUrl(field: RecordField): string {
  if (typeof field.value !== 'string') return ''
  const parts = field.value.split('/')
  return parts[parts.length - 1] || field.value
}

function isImageFile(field: RecordField): boolean {
  if (typeof field.value !== 'string') return false
  const ext = field.value.split('.').pop()?.toLowerCase() || ''
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
}

function clearExistingFile(field: RecordField): void {
  field.value = null
}

function fieldError(field: RecordField): string | null {
  return validateField(field)
}


const measurementSeries = computed<MeasurementSeriesResponse[]>(() => {
  return props.item?.series ?? []
})
const hasSeries = computed(() => measurementSeries.value.length > 0)
const selectedSeriesIndex = ref(0)
const currentSeries = computed<MeasurementSeriesResponse | null>(() =>
  measurementSeries.value[selectedSeriesIndex.value] ?? null
)


const chartPoints = computed<number[]>(() => {
  if (!selectedField.value) return []
  const subset = selectedRecordIndexes.value.size
      ? Array.from(selectedRecordIndexes.value)
      : records.value.map(r => r.recordIndex)
  const subsetRecords = records.value.filter(r => subset.includes(r.recordIndex))
  return extractSeries(subsetRecords, selectedField.value)
})
const statsObj = computed(() => computeBasicStats(chartPoints.value))
const outliers = computed(() => detectOutliersIqr(chartPoints.value))


const isSaving = ref(false)
const canSaveMeta = computed(() =>
    !!selectedTemplateName.value.trim() &&
    !!selectedDeviceId.value &&
    invalidCount.value === 0
)

async function onSave(): Promise<void> {
  if (!props.item || !canSaveMeta.value) return
  isSaving.value = true
  try {
    // Step 1: Upload all file fields first
    const filesToUpload = extractFilesFromRecords(records.value)
    if (filesToUpload.length > 0) {
      for (const fileInfo of filesToUpload) {
        const result = await uploadFile(fileInfo.file)
        if (result.success) {
          const record = records.value.find(r => r.recordIndex === fileInfo.recordIndex)
          if (record) {
            const field = record.fields.find(
              f => f.name === fileInfo.fieldName && (f.blockIndex ?? 1) === fileInfo.blockIndex
            )
            if (field) {
              field.value = result.fileUrl
            }
          }
        }
      }
    }

    const firstNumeric = records.value
        .flatMap(r => r.fields)
        .filter(f => f.type === 'float' || f.type === 'int')
        .map(f => parseNumber(f.value, f.type === 'int'))
        .find(n => Number.isFinite(n as number))

    const baseDay = dateYmd.value ? normalizeToDate(dateYmd.value) : new Date()
    const tsMs = setHM(baseDay, timeHM.value || '00:00').getTime()

    emits('save', {
      value: Number.isFinite(firstNumeric as number)
          ? (firstNumeric as number)
          : (props.item.value ?? 0),
      type: selectedTemplateName.value,
      unit: selectedDeviceId.value,
      timestamp: tsMs,
      values: flattenRecords(records.value),
      boardCardId: props.item.boardCardId ?? null,
      note: noteText.value.trim() ? noteText.value.trim() : null,
      measuredByUsername: selectedUsername.value?.trim() || null
    })
    
    // Update original data after save
    originalData.value = {
      templateName: selectedTemplateName.value,
      deviceId: selectedDeviceId.value,
      username: selectedUsername.value,
      note: noteText.value,
      dateYmd: dateYmd.value,
      timeHM: timeHM.value,
      records: JSON.stringify(records.value)
    }
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
    if (!rec) return
    const f = rec.fields.find(ff => ff.name === selectedField.value)
    if (!f) return
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
function focusFirstFieldSoon(): void {
  nextTick(() => {
    const el = document.querySelector<HTMLElement>('[data-field-input]')
    el?.focus()
  })
}

function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey

  // esc ve fullscreenu se vrací do wide režimu
  if (key === 'escape') {
    e.preventDefault()
    if (panelMode.value === 'fullscreen') {
      panelMode.value = 'wide'
      emits('update:mode', panelMode.value)
    } else {
      requestClose()
    }
    return
  }
  if (ctrl && key === 's') { e.preventDefault(); void onSave(); return }
  if (ctrl && key === 'arrowleft') { e.preventDefault(); emits('prev'); return }
  if (ctrl && key === 'arrowright') { e.preventDefault(); emits('next'); return }

  if (isEditableElement(e.target)) return

  if (key === 'pageup') { e.preventDefault(); prevBlock(); return }
  if (key === 'pagedown') { e.preventDefault(); nextBlock(); return }
}

watch(() => props.modelValue, v => {
  if (v) {
    window.addEventListener('keydown', handleKey)
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (props.modelValue) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))


function closePanel(): void {
  emits('update:modelValue', false)
}


const panelTitle = computed(() => {
  if (!props.item) return 'Detail měření'
  const template = selectedTemplateName.value || 'Měření'
  return template
})


const selectedDevice = computed(() => 
  props.devices.find(d => d.id === selectedDeviceId.value)
)
</script>

<template>
  <Teleport v-if="panelMode === 'fullscreen'" to="body">
    <div class="inspector-overlay" @click.self="requestClose">
      <!-- obsah panelu -->
    </div>
  </Teleport>
  
  <aside
    v-if="modelValue"
    class="inspector-panel"
    :class="{ 
      'mode-docked': panelMode === 'docked',
      'mode-wide': panelMode === 'wide',
      'mode-fullscreen': panelMode === 'fullscreen',
      'is-resizing': isResizing
    }"
    :style="{ width: panelWidth }"
  >

    <div 
      v-if="panelMode !== 'fullscreen'"
      class="resize-handle" 
      @mousedown="startResize"
      title="Přetáhněte pro změnu šířky"
    >
      <div class="resize-handle-icon">
        <v-icon size="16">mdi-drag-vertical</v-icon>
      </div>
    </div>
    

    <header class="inspector-header">
      <div class="header-main">
        <div class="header-title">
          <h3 class="panel-title">
            {{ panelTitle }}
            <span v-if="isDirty" class="dirty-indicator" title="Neuložené změny">•</span>
          </h3>
          <div class="header-chips">
            <v-chip
              v-if="selectedDevice"
              size="small"
              :color="selectedDevice.color || 'primary'"
              variant="flat"
              :style="{ color: selectedDevice.color ? contrastText(selectedDevice.color) : 'white' }"
            >
              {{ selectedDevice.id }}
            </v-chip>
            <v-chip v-if="selectedTemplateName" size="small" variant="tonal">
              {{ selectedTemplateName }}
            </v-chip>
          </div>
        </div>
        
        <div class="header-actions">

          <v-btn
            icon="mdi-chevron-left"
            variant="text"
            size="small"
            density="compact"
            title="Předchozí měření (Ctrl+←)"
            @click="() => emits('prev')"
          />
          <v-btn
            icon="mdi-chevron-right"
            variant="text"
            size="small"
            density="compact"
            title="Další měření (Ctrl+→)"
            @click="() => emits('next')"
          />
          
          <v-divider vertical class="mx-1" style="height: 20px;" />
          

          <v-btn
            :icon="panelMode === 'wide' ? 'mdi-arrow-collapse-horizontal' : 'mdi-arrow-expand-horizontal'"
            variant="text"
            size="small"
            density="compact"
            :title="panelMode === 'wide' ? 'Zúžit panel' : 'Rozšířit panel'"
            @click="toggleWide"
          />
          <v-btn
            :icon="panelMode === 'fullscreen' ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'"
            variant="text"
            size="small"
            density="compact"
            :title="panelMode === 'fullscreen' ? 'Exit fullscreen' : 'Fullscreen'"
            @click="toggleFullscreen"
          />
          

          <v-menu>
            <template #activator="{ props: menuProps }">
              <v-btn
                icon="mdi-dots-vertical"
                variant="text"
                size="small"
                density="compact"
                v-bind="menuProps"
              />
            </template>
            <v-list density="compact">
              <!--
              <v-list-item prepend-icon="mdi-content-copy" @click="copyLink">
                <v-list-item-title>Kopírovat odkaz</v-list-item-title>
              </v-list-item>
              -->
              <v-list-item prepend-icon="mdi-content-duplicate" @click="duplicateMeasurement">
                <v-list-item-title>Duplikovat</v-list-item-title>
              </v-list-item>
              <v-list-item prepend-icon="mdi-download" @click="exportSelectedCsv">
                <v-list-item-title>Export CSV</v-list-item-title>
              </v-list-item>
              <v-divider />
              <v-list-item prepend-icon="mdi-delete-outline" class="text-error" @click="() => emits('delete')">
                <v-list-item-title>Smazat měření</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
          

          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            density="compact"
            @click="requestClose"
          />
        </div>
      </div>
    </header>


    <nav class="inspector-tabs">
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'meta' }"
        @click="activeTab = 'meta'"
      >
        <v-icon size="18">mdi-information-outline</v-icon>
        Meta
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'values' }"
        @click="activeTab = 'values'"
      >
        <v-icon size="18">mdi-table</v-icon>
        Hodnoty
        <span v-if="invalidCount > 0" class="error-badge">{{ invalidCount }}</span>
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'stats' }"
        @click="activeTab = 'stats'"
      >
        <v-icon size="18">mdi-chart-line</v-icon>
        Statistiky
      </button>
    </nav>


    <div class="inspector-content">

      <div v-if="activeTab === 'meta'" class="tab-content pa-4">
        <v-row dense>
          <v-col cols="12">
            <v-select
              v-model="selectedUsername"
              :items="members"
              label="Člen"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              clearable
            />
          </v-col>
          <v-col cols="12">
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
                  :color="item.raw?.color || 'primary'"
                  variant="flat"
                  :style="{ color: item.raw?.color ? contrastText(item.raw.color) : 'white' }"
                >
                  {{ item.raw?.id }}
                </v-chip>
              </template>
            </v-select>
          </v-col>
          <v-col cols="12">
            <TemplateSelect
              v-model="selectedTemplateName"
              :items="templates"
              :device-id="selectedDeviceId"
              value-key="name"
              label="Šablona"
            />
          </v-col>
          

          <v-col cols="12">
            <div class="date-section">
              <div class="date-row">
                <span class="date-label">Datum měření:</span>
                <div class="date-inputs">
                  <v-text-field
                    v-model="dateYmd"
                    type="date"
                    variant="outlined"
                    density="compact"
                    hide-details
                    style="max-width: 160px;"
                  />
                  <v-text-field
                    v-model="timeHM"
                    type="time"
                    variant="outlined"
                    density="compact"
                    hide-details
                    style="max-width: 100px;"
                  />
                </div>
              </div>
              <div v-if="createdAtFormatted.date" class="date-row readonly">
                <span class="date-label">Datum vložení:</span>
                <span class="date-value">{{ createdAtFormatted.date }} {{ createdAtFormatted.time }}</span>
              </div>
            </div>
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


      <div v-else-if="activeTab === 'values'" class="tab-content pa-4">

        <div class="records-toolbar d-flex align-center justify-space-between mb-3 flex-wrap" style="gap: 8px;">
          <div class="d-flex align-center" style="gap: 6px;">
            <v-btn
              size="small"
              color="primary"
              variant="flat"
              prepend-icon="mdi-plus"
              @click="addNewRecord"
            >
              Přidat
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              icon="mdi-content-duplicate"
              :disabled="!currentRecord"
              @click="duplicateCurrentRecord"
            />
            <v-btn
              size="small"
              variant="tonal"
              icon="mdi-delete-outline"
              color="error"
              :disabled="records.length <= 1"
              @click="deleteCurrentRecord"
            />
          </div>

          <div class="record-nav d-flex align-center" style="gap: 6px;">
            <v-btn
              size="small"
              variant="tonal"
              icon="mdi-chevron-left"
              :disabled="currentPosition <= 1"
              @click="prevRecord"
            />
            <v-chip size="small" variant="tonal" color="primary">
              {{ currentPosition }} / {{ records.length }}
            </v-chip>
            <v-btn
              size="small"
              variant="tonal"
              icon="mdi-chevron-right"
              :disabled="currentPosition >= records.length"
              @click="nextRecord"
            />
          </div>
        </div>


        <div v-if="templateBlocks.length > 1" class="block-tabs mb-3">
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
          </v-chip>
        </div>


        <div class="fields-list">
          <div
            v-for="field in currentBlockFields"
            :key="field.name"
            class="field-row"
            :class="{ 'has-error': !!fieldError(field) }"
          >
            <div class="field-label">
              <span class="field-name">{{ field.name }}</span>
              <v-chip size="small" variant="tonal" color="primary">
                {{ TYPE_LABEL[field.type] }}
              </v-chip>
            </div>
            <div class="field-input">
              <v-switch
                v-if="field.type === 'bool'"
                :model-value="textModel(field)"
                color="primary"
                hide-details
                inset
                density="compact"
                data-field-input
                @update:model-value="val => updateField(field, val)"
              />
              <v-text-field
                v-else-if="field.type === 'int'"
                :model-value="textModel(field)"
                type="text"
                inputmode="numeric"
                variant="outlined"
                density="compact"
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
                density="compact"
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
                density="compact"
                hide-details="auto"
                data-field-input
                @update:model-value="val => updateField(field, val)"
              />
              <div v-else-if="field.type === 'file'" class="file-field">
                <div v-if="hasExistingFileUrl(field)" class="existing-file d-flex align-center ga-2">
                  <v-img
                    v-if="isImageFile(field)"
                    :src="getFileDisplayUrl(field)"
                    max-width="40"
                    max-height="40"
                    class="rounded"
                    cover
                  />
                  <a :href="getFileDisplayUrl(field)" target="_blank" class="text-primary">
                    {{ getFileNameFromUrl(field) }}
                  </a>
                  <v-btn
                    icon="mdi-close"
                    size="small"
                    variant="text"
                    color="error"
                    @click="clearExistingFile(field)"
                  />
                </div>
                <v-file-input
                  v-else
                  :model-value="fileModel(field)"
                  density="compact"
                  hide-details="auto"
                  variant="outlined"
                  accept="image/*,.csv,.txt,.pdf"
                  data-field-input
                  @update:model-value="val => updateField(field, (Array.isArray(val) ? val[0] : val))"
                />
              </div>
              <v-text-field
                v-else
                :model-value="textModel(field)"
                type="text"
                variant="outlined"
                density="compact"
                hide-details="auto"
                placeholder="Text…"
                data-field-input
                @update:model-value="val => updateField(field, val)"
              />
            </div>
          </div>
        </div>

        <!-- Datové série sekce -->
        <section
          v-if="hasSeries"
          class="series-section mt-6"
        >
          <div class="d-flex align-center mb-3" style="gap: 8px;">
            <v-icon size="20" color="deep-purple">mdi-chart-line</v-icon>
            <span class="text-subtitle-1 font-weight-medium">Datové série</span>
            <v-chip size="small" color="deep-purple" variant="tonal">
              {{ measurementSeries.length }} {{ measurementSeries.length === 1 ? 'série' : 'sérií' }}
            </v-chip>
          </div>

          <!-- Series selector -->
          <div
            v-if="measurementSeries.length > 1"
            class="mb-3"
          >
            <div class="d-flex align-center flex-wrap" style="gap: 6px;">
              <v-chip
                v-for="(s, idx) in measurementSeries"
                :key="s.id || idx"
                :color="selectedSeriesIndex === idx ? 'deep-purple' : undefined"
                :variant="selectedSeriesIndex === idx ? 'flat' : 'tonal'"
                size="small"
                @click="selectedSeriesIndex = idx"
              >
                {{ s.seriesName || s.seriesType || `Série ${idx + 1}` }}
              </v-chip>
            </div>
          </div>

          <!-- Current series info -->
          <v-sheet
            v-if="currentSeries"
            class="pa-4"
            rounded="lg"
            color="grey-lighten-5"
          >
            <div class="d-flex align-center justify-space-between mb-2">
              <div>
                <span class="text-subtitle-2">{{ currentSeries.seriesName || currentSeries.seriesType }}</span>
                <v-chip size="small" variant="outlined" class="ml-2">
                  {{ currentSeries.seriesType }}
                </v-chip>
              </div>
              <v-chip size="small" color="primary" variant="tonal">
                {{ (currentSeries.xValues ?? []).length }} bodů
              </v-chip>
            </div>

            <!-- Units -->
            <div
              v-if="currentSeries.xUnit || currentSeries.yUnit"
              class="text-caption text-medium-emphasis mb-2"
            >
              X: {{ currentSeries.xUnit || '—' }} | Y: {{ currentSeries.yUnit || '—' }}
            </div>

            <!-- Data preview -->
            <div
              class="series-data-preview"
              style="max-height: 300px; overflow-y: auto;"
            >
              <v-table density="compact" class="series-table">
                <thead>
                  <tr>
                    <th style="width: 60px;">#</th>
                    <th>X</th>
                    <th>Y</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(x, i) in (currentSeries.xValues ?? [])"
                    :key="i"
                  >
                    <td class="text-caption text-medium-emphasis">{{ i + 1 }}</td>
                    <td>{{ x }}</td>
                    <td>{{ (currentSeries.yValues ?? [])[i] ?? '—' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-sheet>
        </section>
      </div>

      <!-- Stats Tab -->
      <div v-else-if="activeTab === 'stats'" class="tab-content pa-4">
        <!-- Chart with integrated field selector, stats, and controls -->
        <ChartPanel
          v-if="chartPoints.length || hasSeries"
          :chart-points="chartPoints"
          :stats="statsObj"
          :fields="numericFieldNames"
          :selected-field="selectedField"
          :multi-series="hasSeries ? measurementSeries.map(s => ({ label: s.seriesName || 'Serie', points: s.yValues || [] })) : undefined"
          @select-field="f => selectedField = f"
        />

        <!-- Fallback when no chart data -->
        <v-alert
          v-if="!chartPoints.length && !hasSeries"
          type="info"
          variant="tonal"
          density="compact"
        >
          Vyberte numerickou veličinu pro zobrazení statistik a grafu.
        </v-alert>
      </div>
    </div>


    <footer class="inspector-footer">
      <v-btn
        variant="text"
        @click="requestClose"
      >
        Zavřít
      </v-btn>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        :disabled="!canSaveMeta || isSaving || !isDirty"
        :loading="isSaving"
        @click="onSave"
      >
        Uložit
      </v-btn>
    </footer>
    

    <v-dialog v-model="showConfirmDialog" max-width="400" persistent>
      <v-card>
        <v-card-title>Neuložené změny</v-card-title>
        <v-card-text>
          Máte neuložené změny. Co chcete udělat?
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="confirmDiscard">Zahodit</v-btn>
          <v-spacer />
          <v-btn variant="text" @click="confirmCancel">Zrušit</v-btn>
          <v-btn color="primary" variant="flat" @click="confirmSave">Uložit</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </aside>
</template>

<style scoped>
.inspector-panel {
  position: relative;  /* Needed for resize handle positioning */
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
  border-left: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.inspector-panel.mode-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 200;
  border-left: none;
}

.inspector-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 199;
}

/* Resize Handle */
.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s;
}

.resize-handle:hover {
  background: rgba(var(--v-theme-primary), 0.1);
}

.resize-handle:hover .resize-handle-icon {
  opacity: 1;
}

.resize-handle-icon {
  position: absolute;
  left: -8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 48px;
  background: white;
  border-radius: 4px;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.08);
  color: #999;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.resize-handle:hover .resize-handle-icon,
.is-resizing .resize-handle-icon {
  opacity: 1;
  color: rgb(var(--v-theme-primary));
}

.is-resizing .resize-handle {
  background: rgba(var(--v-theme-primary), 0.15);
}

/* Sticky Header */
.inspector-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #f8f9fb;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  padding: 12px 16px;
}

.header-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.header-title {
  flex: 1;
  min-width: 0;
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dirty-indicator {
  color: #f59e0b;
  font-size: 1.5rem;
  line-height: 1;
}

.header-chips {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Tabs with better visual selection */
.inspector-tabs {
  display: flex;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: #fafafa;
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  color: #666;
  transition: all 0.2s;
  position: relative;
}

.tab-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

.tab-btn.active {
  color: #1867c0;
  background: white;
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #1867c0;
  border-radius: 3px 3px 0 0;
}

.error-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #ef4444;
  color: white;
  border-radius: 9px;
  font-size: 0.75rem;
  font-weight: 600;
}

/* Scrollable Content */
.inspector-content {
  flex: 1;
  overflow-y: auto;
}

.tab-content {
  min-height: 100%;
}

/* Sticky Footer */
.inspector-footer {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  background: #f8f9fb;
}

/* Date section */
.date-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.date-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.date-row.readonly {
  color: #666;
  font-size: 0.875rem;
}

.date-label {
  font-weight: 500;
  min-width: 120px;
}

.date-inputs {
  display: flex;
  gap: 8px;
}

.date-value {
  color: #333;
}

/* Records toolbar */
.records-toolbar {
  background: rgba(var(--v-theme-primary), 0.03);
  border-radius: 8px;
  padding: 8px 12px;
}

.block-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* Fields */
.fields-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 12px;
  align-items: center;
  padding: 8px;
  border-radius: 8px;
  background: #f8f9fb;
}

.field-row.has-error {
  background: #fff6f6;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-name {
  font-weight: 500;
  font-size: 0.875rem;
}

.field-input {
  min-width: 0;
}

.existing-file {
  padding: 6px 10px;
  background: white;
  border-radius: 6px;
  border: 1px solid #e0e3e8;
  font-size: 0.8rem;
}

.existing-file a {
  text-decoration: none;
  word-break: break-all;
}

.existing-file a:hover {
  text-decoration: underline;
}

.series-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.series-data-preview {
  max-height: 300px;
  overflow-y: auto;
  border-radius: 8px;
  background: white;
}

.series-table {
  font-size: 0.85rem;
}

.series-table th {
  font-weight: 600;
  background: #f5f5f5;
}

.series-table td {
  font-family: 'Roboto Mono', monospace;
  font-size: 0.8rem;
}
</style>
