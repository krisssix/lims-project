<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount, toRaw } from 'vue'
import ChartPanel from '@/components/chart/ChartPanel.vue'
import TemplateSelect from '@/components/measurement/TemplateSelect.vue'
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue'
import FileUploader from '@/components/measurement/FileUploader.vue'
import AttachmentList from '@/components/measurement/AttachmentList.vue'
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
import { type FileAttachment } from '@/composables/useAttachments'


const props = withDefaults(defineProps<{
  modelValue?: boolean
  item: MeasurementResponse | null
  devices: DeviceItem[]
  members: string[]
  templates: TemplateItem[]
  currentUsername?: string
}>(), {
  modelValue: true
})

const emits = defineEmits(['update:modelValue', 'save', 'delete', 'prev', 'next'])


const TYPE_LABEL: Record<ValueType, string> = {
  float: 'Float',
  int: 'Integer',
  text: 'Text',
  file: 'Soubor',
  bool: 'Boolean',
  date: 'Datum',
  time: 'Čas',
  datetime: 'Datum a čas'
}

// pomocná funkce: získání správné zenodo url (sandbox vs produkce)
function getZenodoUrl(doi: string): string {
  if (doi.startsWith('10.5072/')) {
    const recordId = doi.replace('10.5072/zenodo.', '')
    return `https://sandbox.zenodo.org/records/${recordId}`
  }
  return `https://doi.org/${doi}`
}


const selectedTemplateName = ref<string>('')
const selectedDeviceId = ref<string>('')
const selectedUsername = ref<string | null>(null)
const noteText = ref<string>('')


const dateYmd = ref<string>('')
const timeHM = ref<string>('')

function pad2(n: number): string { return String(n).padStart(2, '0') }
function fmt2(n: unknown): string { return typeof n === 'number' ? n.toFixed(2) : String(n ?? '') }
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


const createdAtFormatted = computed(() => {
  const raw = props.item?.createdAt
  if (!raw || typeof raw !== 'number') return { date: '', time: '' }
  const d = new Date(raw)
  if (isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
})


const updatedAtFormatted = computed(() => {
  const raw = props.item?.updatedAt
  if (!raw || typeof raw !== 'number') return { date: '', time: '' }
  const d = new Date(raw)
  if (isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
})


const records = ref<MeasurementRecord[]>([])
const currentRecordIndex = ref<number>(1)
const selectedRecordIndexes = ref<Set<number>>(new Set())


const currentBlockIndex = ref<number>(0)


const selectedSeriesIdx = ref<number>(0)
const selectedSeries = computed(() => {
  if (!props.item?.series?.length) return null
  return props.item.series[selectedSeriesIdx.value] ?? props.item.series[0]
})

function ensureCurrentRecordExists(): void {
  if (!records.value.length) return
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx === -1) currentRecordIndex.value = records.value[0]!.recordIndex
}


const selectedTemplate = computed<TemplateItem | null>(() =>
    props.templates.find(t => t.name === selectedTemplateName.value) ?? null
)


const filteredTemplates = computed<TemplateItem[]>(() => {
  if (!selectedDeviceId.value) return []
  return props.templates.filter(t => t.deviceId === selectedDeviceId.value)
})


const templateBlocks = computed<TemplateBlockRow[]>(() => {
  const tpl = selectedTemplate.value

  if (tpl && tpl.blocks && tpl.blocks.length > 0) {
    // odfiltrovat bloky sérií - ty jsou zobrazeny v samostatné sekci
    return tpl.blocks.filter(b => {
      const isSeries = b.kind === 'series' ||
        (b.title?.toLowerCase().includes('série')) ||
        (b.title?.toLowerCase().includes('series'))
      return !isSeries
    })
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


const currentBlockFields = computed<RecordField[]>(() => {
  if (!currentRecord.value) return []
  if (templateBlocks.value.length <= 1) return currentRecord.value.fields
  const block = currentBlock.value
  if (!block) return currentRecord.value.fields
  const blockIdx = block.blockIndex
  return currentRecord.value.fields.filter(f => (f.blockIndex ?? 1) === blockIdx)
})


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


function prevBlock(): void {
  if (currentBlockIndex.value > 0) currentBlockIndex.value--
}
function nextBlock(): void {
  if (currentBlockIndex.value < templateBlocks.value.length - 1) currentBlockIndex.value++
}


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
  console.log('[MeasurementDetailDialog] Loading values:', vals)

  vals.filter(v => v.type === 'file').forEach(v => {
    console.log('[MeasurementDetailDialog] File field:', v.name, 'fileUrl:', v.fileUrl, 'raw value:', v)
  })
  if (vals.length) {
    records.value = groupValuesToRecords(vals)
    // Apply schema from template to set correct required/optional status
    const tplFields = templateFieldsForCurrent()
    if (tplFields.length > 0) {
      const requiredMap = new Map<string, boolean>()
      tplFields.forEach(f => requiredMap.set(f.name, !!f.required))
      
      records.value.forEach(r => {
        r.fields.forEach(f => {
          if (requiredMap.has(f.name)) {
            f.required = requiredMap.get(f.name)!
          } else {
             // If field exists in data but not in template, default to false (optional)? 
             // Or keep true? Usually false is safer to avoid red fields for extra data.
             f.required = false 
          }
        })
      })
    }
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

function toggleRecordSelection(rIndex: number, multi: boolean): void {
  if (multi) {
    if (selectedRecordIndexes.value.has(rIndex)) selectedRecordIndexes.value.delete(rIndex)
    else selectedRecordIndexes.value.add(rIndex)
    if (!selectedRecordIndexes.value.size) selectedRecordIndexes.value.add(rIndex)
  } else {
    currentRecordIndex.value = rIndex
    currentBlockIndex.value = 0
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
  // vracet pouze file objekty, ne url řetězce
  // obsluha vue reaktivity pro file objekty
  const val = toRaw(field.value)
  if (val instanceof File) return val
  return null
}

function hasExistingFileUrl(field: RecordField): boolean {
  return typeof field.value === 'string' && field.value.length > 0
}


function getFileDisplayUrl(field: RecordField): string {
  if (typeof field.value !== 'string') return ''
  // pokud je to absolutní url, vrátit ji
  if (field.value.startsWith('http://') || field.value.startsWith('https://')) {
    return field.value
  }
  // jinak přidat url serveru (odstranit koncové lomítko, pokud existuje)
  const baseUrl = config.serverUrl.endsWith('/')
    ? config.serverUrl.slice(0, -1)
    : config.serverUrl
  // ošetření lomítka na začátku cesty k souboru
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


const metaCollapsed = ref(false)
const valuesCollapsed = ref(false)
const statsCollapsed = ref(false)
const seriesCollapsed = ref(false)
const attachmentsCollapsed = ref(false)
function toggleMeta(): void { metaCollapsed.value = !metaCollapsed.value }
function toggleValues(): void { valuesCollapsed.value = !valuesCollapsed.value }
function toggleStats(): void { statsCollapsed.value = !statsCollapsed.value }
function toggleAttachments(): void { attachmentsCollapsed.value = !attachmentsCollapsed.value }


const attachmentListRef = ref<InstanceType<typeof AttachmentList> | null>(null)
function onAttachmentUploaded(file: FileAttachment): void {
  // obnovit seznam příloh po nahrání
  attachmentListRef.value?.refresh()
}
function toggleSeries(): void { seriesCollapsed.value = !seriesCollapsed.value }


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
const statsObj = computed(() => {
  const pts = chartPoints.value
  const outs = outliers.value
  // Pokud existují outliery, vyřadíme je ze základních statistik, abychom měli "očistěná" data (např. průměr bez extrémů)
  if (outs && outs.outlierIndexes.length > 0) {
    const outSet = new Set(outs.outlierIndexes)
    const filtered = pts.filter((_, i) => !outSet.has(i))
    if (filtered.length > 0) return computeBasicStats(filtered)
  }
  return computeBasicStats(pts)
})
const outliers = computed(() => detectOutliersIqr(chartPoints.value))
const statsSummary = computed<string[]>(() => {
  if (!numericFieldNames.value.length) return ['Bez numerických dat']
  if (!statsObj.value) return ['Numerická pole: ' + numericFieldNames.value.length]
  const s = statsObj.value
  return [`N=${s.count}`, `μ=${s.mean.toFixed(2)}`, `σ=${s.stdDev.toFixed(2)}`]
})


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
    const rawRecords = records.value.map(r => toRaw(r))
    const filesToUpload = extractFilesFromRecords(rawRecords)
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
        } else {
          console.error(`Failed to upload file ${fileInfo.file.name}:`, result.error)
          const record = records.value.find(r => r.recordIndex === fileInfo.recordIndex)
          if (record) {
            const field = record.fields.find(
              f => f.name === fileInfo.fieldName && (f.blockIndex ?? 1) === fileInfo.blockIndex
            )
            if (field) {
              field.value = fileInfo.file.name
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
  } finally {
    isSaving.value = false
  }
}


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

  if (key === 'escape') { e.preventDefault(); emits('update:modelValue', false); return }
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

const outlierPopover = ref({
  show: false,
  x: 0,
  y: 0,
  recordIndex: 0,
  value: 0,
  fieldName: ''
})

function onPointClick(payload: { event: MouseEvent; idx: number; val: number }): void {
  const { event, idx, val } = payload
  
  // Mapování indexu bodu v grafu zpět na záznam
  const subset = selectedRecordIndexes.value.size
      ? Array.from(selectedRecordIndexes.value)
      : records.value.map(r => r.recordIndex)
  
  const subsetRecords = records.value.filter(r => subset.includes(r.recordIndex))
  const target = subsetRecords[idx]
  
  if (target) {
    outlierPopover.value = {
      show: true,
      x: Math.min(event.clientX, window.innerWidth - 220), // Prevent overflow right
      y: Math.min(event.clientY, window.innerHeight - 150), // Prevent overflow bottom
      recordIndex: target.recordIndex,
      value: val,
      fieldName: selectedField.value || 'Hodnota'
    }
  }
}

const highlightedField = ref<string | null>(null)

function navigateToOutlier(): void {
  onSelectRecord(outlierPopover.value.recordIndex)
  valuesCollapsed.value = false
  
  // Nastavíme highlight
  highlightedField.value = outlierPopover.value.fieldName
  setTimeout(() => { highlightedField.value = null }, 3000)
  
  outlierPopover.value.show = false
  // Pokus o scroll na hodnoty
  nextTick(() => {
    const el = document.getElementById('section-values')
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  })
}


const liveStatus = computed<string>(() => {
  const errs = invalidCount.value
  if (errs > 0) return `Formulář obsahuje ${errs} neplatných hodnot. Nelze uložit.`
  return 'Formulář je validní. Můžete uložit.'
})
</script>

<template>
  <div class="measurement-detail-view d-flex flex-column h-100">
    <!-- Top Navigation / Actions -->
    <div class="d-flex align-center justify-end px-4 py-2 bg-grey-lighten-5 border-b">
      <v-btn
        icon="mdi-chevron-up"
        variant="text"
        density="comfortable"
        title="Předchozí měření (Ctrl+←)"
        @click="() => emits('prev')"
      />
      <v-btn
        icon="mdi-chevron-down"
        variant="text"
        density="comfortable"
        title="Další měření (Ctrl+→)"
        @click="() => emits('next')"
      />
    </div>

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
      <div class="d-flex align-center gap-3">
        <v-btn
          size="small"
          :variant="metaCollapsed ? 'tonal' : 'flat'"
          :color="metaCollapsed ? undefined : 'primary'"
          :aria-expanded="!metaCollapsed"
          aria-controls="section-meta"
          title="Meta"
          @click="toggleMeta"
        >
          Meta
        </v-btn>
        <v-btn
          size="small"
          :variant="valuesCollapsed ? 'tonal' : 'flat'"
          :color="valuesCollapsed ? undefined : 'primary'"
          :aria-expanded="!valuesCollapsed"
          aria-controls="section-values"
          title="Hodnoty"
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
          :aria-expanded="!statsCollapsed"
          aria-controls="section-stats"
          title="Statistika"
          @click="toggleStats"
        >
          Statistika
        </v-btn>
        <v-btn
          size="small"
          :variant="attachmentsCollapsed ? 'tonal' : 'flat'"
          :color="attachmentsCollapsed ? undefined : 'primary'"
          :aria-expanded="!attachmentsCollapsed"
          aria-controls="section-attachments"
          title="Přílohy"
          @click="toggleAttachments"
        >
          Přílohy
        </v-btn>
      </div>
    </v-toolbar>

    <div
      class="detail-scroll flex-grow-1"
      style="overflow-y:auto; padding-right:4px;"
      aria-live="polite"
      :aria-label="liveStatus"
    >
      <section
        id="section-meta"
        class="meta-section mb-4"
        :aria-hidden="metaCollapsed"
      >
        <div class="section-header-row">
          <v-icon
            size="18"
            color="primary"
          >
            mdi-card-account-details-outline
          </v-icon>
          <span class="section-title">Metadata</span>
          <div
            v-if="metaCollapsed"
            class="d-flex align-center flex-wrap"
            style="gap:4px; margin-left:8px;"
          >
            <v-chip
              size="small"
              variant="tonal"
            >
              {{ selectedUsername || '—' }}
            </v-chip>
            <v-chip
              size="small"
              variant="tonal"
            >
              {{ selectedDeviceId || '—' }}
            </v-chip>
            <v-chip
              size="small"
              variant="tonal"
            >
              {{ selectedTemplateName || '—' }}
            </v-chip>
            <v-chip
              v-if="dateYmd || timeHM"
              size="small"
              variant="tonal"
              color="primary"
            >
              {{ dateYmd || '—' }} {{ timeHM || '' }}
            </v-chip>
          </div>
          <v-spacer />
          <v-btn
            icon
            size="small"
            variant="text"
            :title="metaCollapsed ? 'Rozbalit' : 'Sbalit'"
            @click="toggleMeta"
          >
            <v-icon :class="{'rot-180': !metaCollapsed}">
              mdi-chevron-down
            </v-icon>
          </v-btn>
        </div>
        <div
          v-show="!metaCollapsed"
          class="meta-content"
        >
          <!-- Základní informace -->
          <div class="info-card">
            <div class="info-card-header">
              <v-icon
                size="18"
                color="primary"
              >
                mdi-account-details
              </v-icon>
              <span class="info-card-title">Základní informace</span>
            </div>
            <v-row class="mt-2">
              <v-col
                cols="12"
                md="4"
              >
                <div class="field-label">
                  Člen
                </div>
                <v-select
                  v-model="selectedUsername"
                  :items="members"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  clearable
                  data-meta-first
                  placeholder="Vyberte člena..."
                />
              </v-col>
              <v-col
                cols="12"
                md="4"
              >
                <div class="field-label">
                  Přístroj
                </div>
                <v-select
                  v-model="selectedDeviceId"
                  :items="devices"
                  item-title="name"
                  item-value="id"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  readonly
                  disabled
                  bg-color="grey-lighten-4"
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
              <v-col
                cols="12"
                md="4"
              >
                <div class="field-label">
                  Šablona
                </div>
                <TemplateSelect
                  v-model="selectedTemplateName"
                  :items="templates"
                  :device-id="selectedDeviceId"
                  value-key="name"
                  readonly
                  disabled
                />
              </v-col>
            </v-row>
          </div>

          <!-- Datum a čas měření -->
          <div class="info-card">
            <div class="info-card-header">
              <v-icon
                size="18"
                color="primary"
              >
                mdi-calendar-clock
              </v-icon>
              <span class="info-card-title">Datum a čas měření</span>
            </div>
            <v-row class="mt-2">
              <v-col
                cols="12"
                md="6"
              >
                <div class="field-label">
                  Datum měření
                </div>
                <v-text-field
                  v-model="dateYmd"
                  type="date"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                />
              </v-col>
              <v-col
                cols="12"
                md="6"
              >
                <div class="field-label">
                  Čas měření
                </div>
                <v-text-field
                  v-model="timeHM"
                  type="time"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                />
              </v-col>
            </v-row>
          </div>

          <!-- Datum a čas vložení -->
          <div
            v-if="createdAtFormatted.date"
            class="info-card"
          >
            <div class="info-card-header">
              <v-icon
                size="18"
                color="success"
              >
                mdi-clock-plus-outline
              </v-icon>
              <span class="info-card-title">Datum a čas vložení</span>
            </div>
            <v-row class="mt-2">
              <v-col
                cols="12"
                md="6"
              >
                <div class="field-label">
                  Datum vložení
                </div>
                <v-text-field
                  :model-value="createdAtFormatted.date"
                  type="text"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  readonly
                  bg-color="grey-lighten-4"
                />
              </v-col>
              <v-col
                cols="12"
                md="6"
              >
                <div class="field-label">
                  Čas vložení
                </div>
                <v-text-field
                  :model-value="createdAtFormatted.time"
                  type="text"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  readonly
                  bg-color="grey-lighten-4"
                />
              </v-col>
            </v-row>
          </div>

          <!-- Datum a čas změny -->
          <div
            v-if="updatedAtFormatted.date"
            class="info-card"
          >
            <div class="info-card-header">
              <v-icon
                size="18"
                color="warning"
              >
                mdi-clock-edit-outline
              </v-icon>
              <span class="info-card-title">Datum a čas změny</span>
            </div>
            <v-row class="mt-2">
              <v-col
                cols="12"
                md="6"
              >
                <div class="field-label">
                  Datum změny
                </div>
                <v-text-field
                  :model-value="updatedAtFormatted.date"
                  type="text"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  readonly
                  bg-color="grey-lighten-4"
                />
              </v-col>
              <v-col
                cols="12"
                md="6"
              >
                <div class="field-label">
                  Čas změny
                </div>
                <v-text-field
                  :model-value="updatedAtFormatted.time"
                  type="text"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  readonly
                  bg-color="grey-lighten-4"
                />
              </v-col>
            </v-row>
          </div>

          <!-- Poznámky -->
          <div class="info-card">
            <div class="info-card-header">
              <v-icon
                size="18"
                color="primary"
              >
                mdi-notebook-outline
              </v-icon>
              <span class="info-card-title">Poznámky</span>
            </div>
            <div class="mt-2">
              <MarkdownEditor
                v-model="noteText"
                :min-height="'150px'"
                placeholder="Pište poznámky v markdown formátu..."
              />
            </div>
          </div>

          <!-- Zenodo publikace -->
          <div
            v-if="item?.zenodoDoi"
            class="info-card"
          >
            <div class="info-card-header">
              <v-icon
                size="18"
                color="deep-purple"
              >
                mdi-cloud-check
              </v-icon>
              <span class="info-card-title">Zenodo publikace</span>
            </div>
            <v-alert
              type="info"
              variant="tonal"
              color="deep-purple"
              class="mt-2"
              density="compact"
            >
              <div
                class="d-flex align-center justify-space-between flex-wrap"
                style="gap: 8px;"
              >
                <div>
                  <strong>DOI:</strong>
                  <a
                    :href="getZenodoUrl(item.zenodoDoi)"
                    target="_blank"
                    class="text-decoration-none ml-2"
                    style="font-family: monospace;"
                  >
                    {{ item.zenodoDoi }}
                  </a>
                </div>
                <v-btn
                  :href="getZenodoUrl(item.zenodoDoi)"
                  target="_blank"
                  size="small"
                  variant="tonal"
                  color="deep-purple"
                  prepend-icon="mdi-open-in-new"
                >
                  Otevřít v Zenodo
                </v-btn>
              </div>
            </v-alert>
          </div>
        </div>
      </section>

      <section
        id="section-values"
        class="values-section mb-4"
        :aria-hidden="valuesCollapsed"
      >
        <!-- Section header -->
        <div class="section-header-row">
          <v-icon
            size="18"
            color="primary"
          >
            mdi-table
          </v-icon>
          <span class="section-title">Hodnoty</span>
          <v-spacer />
          <v-btn
            icon
            size="small"
            variant="text"
            :title="valuesCollapsed ? 'Rozbalit' : 'Sbalit'"
            @click="toggleValues"
          >
            <v-icon :class="{'rot-180': !valuesCollapsed}">
              mdi-chevron-down
            </v-icon>
          </v-btn>
        </div>

        <div v-show="!valuesCollapsed">
          <div
            class="records-toolbar d-flex align-center mb-3 flex-wrap mt-3"
            style="gap: 12px;"
          >
            <div
              class="d-flex align-center"
              style="gap: 6px;"
            >
              <v-btn
                size="small"
                color="primary"
                variant="flat"
                prepend-icon="mdi-plus"
                title="Přidat další záznam"
                class="control-btn"
                @click="addNewRecord"
              >
                Přidat záznam
              </v-btn>
              <v-btn
                size="small"
                variant="tonal"
                color="secondary"
                icon="mdi-content-duplicate"
                title="Duplikovat záznam"
                :disabled="!currentRecord"
                @click="duplicateCurrentRecord"
              />
              <v-btn
                size="small"
                variant="tonal"
                icon="mdi-delete-outline"
                color="error"
                title="Smazat záznam"
                :disabled="records.length <= 1"
                @click="deleteCurrentRecord"
              />
            </div>

            <v-spacer />

            <div
              class="record-nav d-flex align-center"
              style="gap: 8px;"
            >
              <v-select
                :model-value="currentRecordIndex"
                :items="recordItems"
                item-title="title"
                item-value="value"
                density="compact"
                variant="outlined"
                hide-details
                class="record-select"
                @update:model-value="onSelectRecord"
              >
                <template #selection="{ item }">
                  <div
                    class="d-flex align-center"
                    style="gap: 8px;"
                  >
                    <v-icon
                      size="16"
                      color="primary"
                    >
                      mdi-file-document-outline
                    </v-icon>
                    <span>{{ item.title }}</span>
                  </div>
                </template>
                <template #append-inner>
                  <v-chip
                    size="small"
                    color="primary"
                    variant="tonal"
                    class="record-count-chip"
                  >
                    {{ currentPosition }} / {{ records.length }}
                  </v-chip>
                </template>
              </v-select>

              <div
                class="nav-buttons d-flex"
                style="gap: 2px;"
              >
                <v-btn
                  size="small"
                  variant="tonal"
                  icon="mdi-chevron-left"
                  title="Předchozí (←)"
                  :disabled="currentPosition <= 1"
                  @click="prevRecord"
                />
                <v-btn
                  size="small"
                  variant="tonal"
                  icon="mdi-chevron-right"
                  title="Další (→)"
                  :disabled="currentPosition >= records.length"
                  @click="nextRecord"
                />
              </div>
            </div>

            <v-btn
              size="small"
              variant="text"
              :icon="valuesCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
              :title="valuesCollapsed ? 'Rozbalit' : 'Sbalit'"
              @click="toggleValues"
            />
          </div>

          <div v-show="!valuesCollapsed">
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
                    title="Předchozí Tabulka hodnot"
                    @click="prevBlock"
                  />
                  <div class="text-subtitle-1 font-weight-medium">
                    {{ currentBlock?.title || `Tabulka hodnot ${currentBlockIndex + 1}` }}
                  </div>
                  <v-btn
                    icon="mdi-chevron-right"
                    size="small"
                    variant="text"
                    :disabled="currentBlockIndex === templateBlocks.length - 1"
                    title="Další Tabulka hodnot"
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
              v-else-if="currentBlock && templateBlocks.length === 1"
              class="block-header mb-3"
            >
              <div class="text-subtitle-1 font-weight-medium">
                {{ currentBlock.title }}
              </div>
            </div>

            <div class="grid header-row">
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
                :class="{'has-error': !!fieldError(field), 'row-highlight-pulse': highlightedField === field.name}"
                :aria-label="`Field ${idx+1}: ${field.name} (${TYPE_LABEL[field.type]})`"
              >
                <div class="cell name name-with-chip">
                  <div
                    class="d-flex align-center"
                    style="gap:8px; min-width:0;"
                  >
                    <span class="name-text">{{ field.name }}</span>
                    <v-chip
                      size="small"
                      color="primary"
                      variant="tonal"
                      class="type-chip"
                    >
                      {{ TYPE_LABEL[field.type] }}
                    </v-chip>
                  </div>
                </div>

                <div class="cell value">
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
                  <v-text-field
                    v-else-if="field.type === 'time'"
                    :model-value="textModel(field)"
                    type="time"
                    variant="outlined"
                    density="comfortable"
                    hide-details="auto"
                    data-field-input
                    @update:model-value="val => updateField(field, val)"
                  />
                  <v-text-field
                    v-else-if="field.type === 'datetime'"
                    :model-value="textModel(field)"
                    type="datetime-local"
                    variant="outlined"
                    density="comfortable"
                    hide-details="auto"
                    data-field-input
                    @update:model-value="val => updateField(field, val)"
                  />
                  <div
                    v-else-if="field.type === 'file'"
                    class="file-field-container"
                  >
                    <!-- Show existing uploaded file -->
                    <div
                      v-if="hasExistingFileUrl(field)"
                      class="existing-file d-flex align-center ga-2"
                    >
                      <v-img
                        v-if="isImageFile(field)"
                        :src="getFileDisplayUrl(field)"
                        max-width="60"
                        max-height="60"
                        class="rounded border"
                        cover
                      />
                      <v-icon
                        v-else
                        size="24"
                        color="grey"
                      >
                        mdi-file-document-outline
                      </v-icon>
                      <a
                        :href="getFileDisplayUrl(field)"
                        target="_blank"
                        class="text-primary text-decoration-none"
                      >
                        {{ getFileNameFromUrl(field) }}
                      </a>
                      <v-btn
                        icon="mdi-close"
                        size="small"
                        variant="text"
                        color="error"
                        title="Odstranit soubor a nahrát nový"
                        @click="clearExistingFile(field)"
                      />
                    </div>
                    <v-file-input
                      v-else
                      :model-value="fileModel(field)"
                      density="comfortable"
                      hide-details="auto"
                      variant="outlined"
                      accept="image/*,.csv,.txt,.pdf"
                      show-size
                      data-field-input
                      @update:model-value="val => updateField(field, (Array.isArray(val) ? val[0] : val))"
                    />
                  </div>
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
        </div>
      </section>

      <section
        id="section-stats"
        class="stats-section"
        :aria-hidden="statsCollapsed"
      >
        <div class="section-header-row">
          <v-icon
            size="18"
            color="primary"
          >
            mdi-chart-bar
          </v-icon>
          <span class="section-title">Statistika</span>
          <div
            v-if="statsCollapsed"
            class="d-flex align-center flex-wrap"
            style="gap:4px; margin-left:8px;"
          >
            <v-chip
              v-for="(t, i) in statsSummary"
              :key="i"
              size="small"
              variant="tonal"
            >
              {{ t }}
            </v-chip>
          </div>
          <v-spacer />
          <v-btn
            icon
            size="small"
            variant="text"
            :title="statsCollapsed ? 'Rozbalit' : 'Sbalit'"
            @click="toggleStats"
          >
            <v-icon :class="{'rot-180': !statsCollapsed}">
              mdi-chevron-down
            </v-icon>
          </v-btn>
        </div>

        <v-sheet
          v-show="!statsCollapsed"
          elevation="1"
          class="pa-4 rounded-lg"
          aria-label="Panel statistik"
        >
          <ChartPanel
            :chart-points="chartPoints"
            :stats="statsObj"
            :fields="numericFieldNames"
            :selected-field="selectedField"
            :outliers="outliers"
            @select-field="f => (selectedField = f)"
            @point-click="onPointClick"
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

      <section
        v-if="hasSeries"
        id="section-series"
        :aria-hidden="seriesCollapsed"
        class="mt-4"
      >
        <div
          class="d-flex align-center mb-2"
          style="gap:8px;"
        >
          <span class="text-subtitle-2">Datové série</span>
          <v-chip
            size="small"
            color="deep-purple"
            variant="tonal"
          >
            {{ measurementSeries.length }} {{ measurementSeries.length === 1 ? 'série' : 'sérií' }}
          </v-chip>
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            :icon="seriesCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
            :title="seriesCollapsed ? 'Rozbalit' : 'Sbalit'"
            @click="toggleSeries"
          />
        </div>

        <v-sheet
          v-show="!seriesCollapsed"
          class="pa-4"
          rounded="lg"
          color="grey-lighten-5"
        >
          <div
            v-if="measurementSeries.length > 1"
            class="mb-3"
          >
            <div
              class="d-flex align-center flex-wrap"
              style="gap: 6px;"
            >
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

          <div
            v-if="currentSeries"
            class="series-info"
          >
            <div class="d-flex align-center justify-space-between mb-2">
              <div>
                <span class="text-subtitle-2">{{ currentSeries.seriesName || currentSeries.seriesType }}</span>
                <v-chip
                  size="small"
                  variant="outlined"
                  class="ml-2"
                >
                  {{ currentSeries.seriesType }}
                </v-chip>
              </div>
              <v-chip
                size="small"
                color="primary"
                variant="tonal"
              >
                {{ (currentSeries.xValues ?? []).length }} bodů
              </v-chip>
            </div>

            <div
              v-if="currentSeries.xUnit || currentSeries.yUnit"
              class="text-caption text-medium-emphasis mb-2"
            >
              X: {{ currentSeries.xUnit || '—' }} | Y: {{ currentSeries.yUnit || '—' }}
            </div>

            <div
              class="series-data-preview"
              style="max-height: 400px; overflow-y: auto;"
            >
              <v-table
                density="compact"
                class="series-table"
              >
                <thead>
                  <tr>
                    <th style="width: 60px;">
                      #
                    </th>
                    <th>X</th>
                    <th>Y</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(x, i) in (currentSeries.xValues ?? [])"
                    :key="i"
                  >
                    <td class="text-caption text-medium-emphasis">
                      {{ i + 1 }}
                    </td>
                    <td>{{ x }}</td>
                    <td>{{ (currentSeries.yValues ?? [])[i] ?? '—' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </div>
        </v-sheet>
      </section>



      <section
        id="section-attachments"
        class="attachments-section mt-4"
        :aria-hidden="attachmentsCollapsed"
      >
        <div class="section-header-row">
          <v-icon
            size="18"
            color="primary"
          >
            mdi-paperclip
          </v-icon>
          <span class="section-title">Přílohy</span>
          <v-spacer />
          <v-btn
            icon
            size="small"
            variant="text"
            :title="attachmentsCollapsed ? 'Rozbalit' : 'Sbalit'"
            @click="toggleAttachments"
          >
            <v-icon :class="{'rot-180': !attachmentsCollapsed}">
              mdi-chevron-down
            </v-icon>
          </v-btn>
        </div>
        <div
          v-show="!attachmentsCollapsed"
          class="attachments-content"
        >
          <div class="info-card">
            <div class="info-card-header">
              <v-icon
                size="18"
                color="primary"
              >
                mdi-cloud-upload
              </v-icon>
              <span class="info-card-title">Nahrát přílohy</span>
            </div>
            <div class="mt-2">
              <FileUploader
                v-if="item?.id"
                :measurement-id="item.id"
                @uploaded="onAttachmentUploaded"
              />
              <v-alert
                v-else
                type="info"
                variant="tonal"
                density="compact"
              >
                Uložte měření pro možnost přidávat přílohy.
              </v-alert>
            </div>
          </div>

          <div
            v-if="item?.id"
            class="info-card"
          >
            <div class="info-card-header">
              <v-icon
                size="18"
                color="primary"
              >
                mdi-file-multiple
              </v-icon>
              <span class="info-card-title">Seznam příloh</span>
            </div>
            <div class="mt-2">
              <AttachmentList
                ref="attachmentListRef"
                :measurement-id="item.id"
              />
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Footer -->
    <div class="view-footer pa-3 border-t bg-white">
      <div class="d-flex align-center justify-space-between w-100">
        <div class="text-caption text-medium-emphasis">
          <span v-if="invalidCount > 0">
            {{ invalidCount }} neplatných hodnot – opravte před uložením.
          </span>
          <span v-else>
            Formulář je validní. Ctrl+S pro uložení.
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
    </div>

    <!-- Outlier Detail Popover -->
    <v-card
      v-if="outlierPopover.show"
      v-click-outside="() => outlierPopover.show = false"
      class="outlier-popover"
      elevation="4"
      :style="{
        top: outlierPopover.y + 'px',
        left: outlierPopover.x + 'px'
      }"
    >
      <div class="d-flex align-center justify-space-between mb-2">
        <span class="text-subtitle-2 font-weight-bold">Detail outlieru</span>
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          density="comfortable"
          @click="outlierPopover.show = false"
        />
      </div>
      
      <div class="text-caption text-medium-emphasis mb-1">
        {{ outlierPopover.fieldName }}
      </div>
      <div class="text-h6 font-weight-bold text-primary mb-2">
        {{ fmt2(outlierPopover.value) }}
      </div>
      
      <div class="d-flex align-center justify-space-between mt-3 gap-2">
        <div class="text-caption">
          Záznam #{{ outlierPopover.recordIndex }}
        </div>
        <v-btn
          size="small"
          color="primary"
          variant="flat"
          prepend-icon="mdi-target"
          @click="navigateToOutlier"
        >
          Ukázat hodnotu
        </v-btn>
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.outlier-popover {
  position: fixed;
  z-index: 9999; /* Above dialogs */
  width: 240px;
  background: white;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.1);
}

.row-highlight-pulse {
  animation: bg-pulse 3s ease-out;
}
@keyframes bg-pulse {
  0% { background-color: rgba(var(--v-theme-primary), 0.25); }
  100% { background-color: transparent; }
}
</style>

<style scoped>
.section-card {
  background: #fafbfc;
  border: 1px solid #e8eaed;
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8eaed;
}

.section-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: #1f2937;
}

.section-icon {
  color: #6366f1;
}

.section-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.section-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: #1f2937;
}

.grid {
  display: grid;
  grid-template-columns: 1fr minmax(240px, 1.5fr) 72px;
  gap: 8px;
  align-items: center;
}

.header-row {
  padding: 6px 6px 8px 6px;
  font-size: 0.75rem;
  letter-spacing: .03em;
  text-transform: uppercase;
  color: #6b7280;
  font-weight: 600;
}

.data-row {
  padding: 8px 10px;
  border-radius: 8px;
  transition: background-color .15s, box-shadow .15s;
  border: 1px solid transparent;
}

.data-row:hover {
  background: #f3f4f6;
  border-color: #e5e7eb;
}

.data-row.has-error {
  background: #fef2f2;
  border-color: #fecaca;
}

.cell.muted { font-size: .75rem; color: #6b7280; }
.cell.right { text-align: right; }

.name-with-chip { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: #1f2937; }
.type-chip { font-weight: 600; letter-spacing: .02em; text-transform: none; }

.rot-180 { transform: rotate(180deg); }
.detail-scroll { box-sizing: border-box; }

.sticky-toolbar {
  position: sticky;
  top: 0;
  z-index: 30;
  backdrop-filter: blur(8px);
  background: linear-gradient(to bottom, rgba(255,255,255,0.95), rgba(255,255,255,0.90));
  border-bottom: 1px solid #e5e7eb;
}

[data-field-input]:focus-visible {
  outline: 2px solid var(--v-theme-primary);
  outline-offset: 2px;
  border-radius: 6px;
}

.section-heading { font-weight: 600; letter-spacing: .02em; }

.block-navigation {
  background: #f1f5f9;
  border-radius: 10px;
  padding: 14px 18px;
  border: 1px solid #e2e8f0;
}

.block-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.block-header {
  background: #f1f5f9;
  border-radius: 10px;
  padding: 14px 18px;
  border: 1px solid #e2e8f0;
}

.record-select {
  min-width: 180px;
  max-width: 220px;
}

.record-count-chip {
  font-weight: 600;
  font-size: 0.7rem;
}

.record-nav {
  padding: 8px 12px;
  border-radius: 10px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
}

.nav-buttons {
  border-radius: 6px;
  overflow: hidden;
}

.records-toolbar {
  background: linear-gradient(135deg, #f0f9ff 0%, #faf5ff 100%);
  border-radius: 10px;
  padding: 10px 14px;
  border: 1px solid #e0e7ff;
}

@media (max-width: 1040px) {
  .grid {
    grid-template-columns: 1fr minmax(180px, 1.2fr) 56px;
  }
}

.series-section {
  background: linear-gradient(135deg, #faf5ff 0%, #f0f9ff 100%);
  border: 1px solid #e9d5ff;
  border-radius: 12px;
  padding: 16px 20px;
}

.series-data-preview {
  max-height: 300px;
  overflow-y: auto;
  border-radius: 8px;
  background: white;
}

.series-data-table {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

.series-table {
  width: 100%;
  font-size: 0.85rem;
  border-collapse: collapse;
}

.series-table th {
  font-weight: 600;
  background: #f8fafc;
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
}

.series-table td {
  font-family: 'Roboto Mono', monospace;
  font-size: 0.8rem;
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
}

.series-table tr:last-child td {
  border-bottom: none;
}

.file-field-container {
  min-height: 40px;
}

.existing-file {
  padding: 10px 14px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.existing-file a {
  font-weight: 500;
  word-break: break-all;
  color: #6366f1;
}

.existing-file a:hover {
  text-decoration: underline !important;
}

.stats-section {
  background: linear-gradient(135deg, #f0fdf4 0%, #f0f9ff 100%);
  border: 1px solid #bbf7d0;
  border-radius: 12px;
  padding: 16px 20px;
}

.meta-section {
  background: #fafbfc;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px 20px;
}

.values-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px 20px;
}

.meta-content {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  transition: all 0.2s ease;
}

.info-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.info-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}

.info-card-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
  letter-spacing: 0.01em;
}

.subsection-label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
  margin-bottom: 12px;
  margin-top: 8px;
}

.field-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

/* Toolbar spacing fix */
.sticky-toolbar {
  gap: 6px !important;
}

.sticky-toolbar .v-btn {
  margin: 0 !important;
}

.attachments-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px 16px;
}

.attachments-content {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meta-section {
  background: #fafbfc;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px 16px;
}

.values-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px 16px;
}

.stats-section {
  background: linear-gradient(135deg, #f0fdf4 0%, #f0f9ff 100%);
  border: 1px solid #bbf7d0;
  border-radius: 12px;
  padding: 12px 16px;
}
</style>
