<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from '@/components/Dialog.vue'
import LeftFiltersPanel from '@/components/LeftFiltersPanel.vue'
import EntityEditorDialog from '@/components/EntityEditorDialog.vue'

import { useMeasurementStore, type MeasurementRequest, type MeasuredValue, type MeasurementResponse } from '@/stores/measurement'
import { useReservationsStore } from '@/stores/reservations'
import { useMeasurementTemplatesStore, type MeasurementTemplateRequest } from '@/stores/measurement-templates'

const route = useRoute()
const measurementStore = useMeasurementStore()
const reservationsStore = useReservationsStore()
const templatesStore = useMeasurementTemplatesStore()

const projectId = Number((route.params as { projectId: string }).projectId)

/* ----------  horní lišta + postranní panel ---------- */
const isSideFilterOpen = ref(false)

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
    deviceId: t.deviceCode,
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
const headers = [
  { title: 'Šablona',      key: 'type' },
  { title: 'Přístroj',     key: 'device' },
  { title: 'Datum měření', key: 'date' },
  { title: 'Počet hodnot', key: 'count' },
]

/* ---------- Filtry (LeftFiltersPanel) ---------- */
const selectedDate = ref<string | Date | null>(null)

const leftSelection = ref<Record<string, string[]>>({ devices: [], templates: [] })
const leftGroups = computed(() => [
  {
    key: 'devices',
    title: 'Přístroje',
    label: 'Přístroje',
    items: devices.value,
    itemTitle: 'name',
    itemValue: 'id',
    type: 'devices' as const,
    colorKey: 'color',
    showField: 'id'
  },
  {
    key: 'templates',
    title: 'Šablona',
    label: 'Šablona',
    items: Array.from(new Set(templates.value.map(t => t.name))).map(n => ({ id: n, name: n })),
    itemTitle: 'name',
    itemValue: 'id',
    type: 'plain' as const
  },
])

const pickedDevices = ref<string[]>([])
const pickedTemplates = ref<string[]>([])

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const as = [...a].sort(), bs = [...b].sort()
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

function selectAllDevices() { pickedDevices.value = devices.value.map(d => d.id) }
function clearDevices() { pickedDevices.value = [] }
function selectAllTemplates() { pickedTemplates.value = Array.from(new Set(templates.value.map(t => t.name))) }
function clearTemplates() { pickedTemplates.value = [] }

/* ---------- Toolbar helpers ---------- */
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

/* ---------- Přehled šablon (dialog) ---------- */
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

/* ---------- Editor šablony ---------- */
const templateFormOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formName = ref<string>('')
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
const templateCreateContext = ref<'overview'|'measurement'>('overview')

// map ref pro focus/scroll v přehledu
const itemRefs = new Map<string, HTMLElement>()
function setItemRef(id: string, el: Element | { $el?: Element } | null) {
  const dom: HTMLElement | null =
    el && typeof el === 'object' && '$el' in el && el.$el instanceof HTMLElement
      ? (el.$el as HTMLElement)
      : (el instanceof HTMLElement ? el : null)
  if (dom) itemRefs.set(id, dom)
  else itemRefs.delete(id)
}
function scrollToSelected() {
  if (!selectedTemplateId.value) return
  const el = itemRefs.get(selectedTemplateId.value)
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  el?.focus()
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
const saving = ref(false)
const snackbar = ref<{ open: boolean; text: string }>({ open: false, text: '' })

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
}

// Krokování
function goToStep2() {
  const id = metaSelectedTemplateId.value
  if (!id) return
  const tpl = templateById.value.get(id)
  const now = Date.now()
  valuesRows.value = (tpl?.fields ?? []).map((f, i) => ({
    id: `${f.id || 'f'}-${i}-${now}`, // stable unique key per render session
    order: i + 1,
    name: f.name,
    type: f.type,
    required: f.required,
    value: f.type === 'file' ? null : (f.type === 'bool' ? null : '')
  }))
  measurementStep.value = 2
  nextTick(() => focusInput(0))
}

/* Primární data (krok 2) */
type ValueRow = {
  id: string
  order: number
  name: string
  type: 'float'|'int'|'text'|'file'|'bool'|'date'
  required: boolean
  value: unknown
}

const TYPE_LABEL: Record<ValueRow['type'], string> = {
  float: 'Float',
  int: 'Integer',
  text: 'Text',
  file: 'Image',
  bool: 'Boolean',
  date: 'Date',
}
const valuesRows = ref<ValueRow[]>([])

const focusedIndex = ref<number | null>(null)
const inputEls = ref<(HTMLInputElement | HTMLTextAreaElement | null)[]>([])
function setInputRef(idx: number, el: Element | { $el?: Element } | null) {
  const root: Element | null =
    el && typeof el === 'object' && '$el' in el && el.$el instanceof HTMLElement
      ? (el.$el as HTMLElement)
      : (el instanceof HTMLElement ? el : null)
  const found = root?.querySelector('input, textarea') as (HTMLInputElement | HTMLTextAreaElement | null) | undefined
  inputEls.value[idx] = found ?? null
}
function focusInput(idx: number) {
  const el = inputEls.value[idx]
  if (el) {
    el.focus()
    if ('selectionStart' in el && typeof (el as HTMLInputElement | HTMLTextAreaElement).value === 'string') {
      const inp = el as HTMLInputElement | HTMLTextAreaElement
      const len = inp.value.length
      inp.setSelectionRange(len, len)
    }
    focusedIndex.value = idx
  }
}

/* převody + validace vstupů dle typu */
function parseNumber(raw: unknown, integer = false): number | null {
  if (raw === '' || raw == null) return null
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
function updateRowValue(row: ValueRow, raw: unknown) {
  switch (row.type) {
    case 'float': row.value = parseNumber(raw, false); break
    case 'int':   row.value = parseNumber(raw, true);  break
    case 'bool':  row.value = normalizeBool(raw);      break
    case 'date': {
      if (raw === null || raw === '') { row.value = null; break }
      if (typeof raw === 'number') { row.value = raw; break }
      if (typeof raw === 'string') {
        const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (m) {
          const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
          row.value = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime()
        } else {
          const ms = Date.parse(raw)
          row.value = Number.isNaN(ms) ? null : ms
        }
        break
      }
      if (raw instanceof Date) {
        row.value = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 0, 0, 0, 0).getTime()
        break
      }
      row.value = null
      break
    }
    case 'file':  row.value = raw; break
    case 'text':
    default:      row.value = raw ?? ''
  }
}
function allowNumberKeypress(e: KeyboardEvent, integer: boolean) {
  const allowedControl = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab']
  if (allowedControl.includes(e.key) || e.ctrlKey || e.metaKey) return
  const ch = e.key
  if (ch === '-') {
    const el = e.target as HTMLInputElement
    if (el.selectionStart !== 0 || (el.value || '').includes('-')) e.preventDefault()
    return
  }
  if (!integer && (ch === '.' || ch === ',')) {
    const el = e.target as HTMLInputElement
    if ((el.value || '').includes('.') || (el.value || '').includes(',')) e.preventDefault()
    return
  }
  if (!/[0-9]/.test(ch)) e.preventDefault()
}
function valueError(row: ValueRow): string | null {
  if (!row.required) return null
  switch (row.type) {
    case 'bool': return (row.value === true || row.value === false) ? null : 'Vyžadováno'
    case 'float': return parseNumber(row.value, false) !== null ? null : 'Neplatné číslo'
    case 'int': return parseNumber(row.value, true) !== null ? null : 'Neplatné celé číslo'
    case 'date': {
      const val = row.value
      const ms = typeof val === 'number' ? val : (typeof val === 'string' ? Date.parse(val) : NaN)
      return Number.isFinite(ms) ? null : 'Neplatné datum'
    }
    case 'file': return row.value != null ? null : 'Vyžadován soubor'
    default:
      return row.value != null && String(row.value).trim().length > 0 ? null : 'Vyžadováno'
  }
}
const canSaveMeasurement = computed(() => valuesRows.value.every(v => !valueError(v)))

function onCellKeydown(e: KeyboardEvent, idx: number) {
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    const delta = e.shiftKey ? -1 : 1
    const next = Math.min(Math.max(idx + delta, 0), valuesRows.value.length - 1)
    nextTick(() => focusInput(next))
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    const parts = text.split(/[\s,;]+/).filter(Boolean)
    let idx = 0
    for (let i = 0; i < valuesRows.value.length && idx < parts.length; i++) {
      if (valuesRows.value[i].type === 'file') continue
      const token = parts[idx++]
      const r = valuesRows.value[i]
      if (r.type === 'float') r.value = parseNumber(token, false)
      else if (r.type === 'int') r.value = parseNumber(token, true)
      else if (r.type === 'bool') r.value = normalizeBool(token)
      else if (r.type === 'date') {
        const ms = Date.parse(token); r.value = Number.isNaN(ms) ? null : ms
      } else r.value = token
    }
  } catch (e) {
    console.warn('Clipboard read failed', e)
  }
}

async function submitNewMeasurement() {
  if (!canSaveMeasurement.value) return
  saving.value = true
  try {
    const firstNumeric = valuesRows.value
      .filter(v => v.type === 'float' || v.type === 'int')
      .map(v => parseNumber(v.value, v.type === 'int'))
      .find(n => Number.isFinite(n as number))

    const id = metaSelectedTemplateId.value
    if (!id) return
    const tpl = templateById.value.get(id)
    if (!tpl) return

    const payload: MeasurementRequest = {
      value: Number.isFinite(firstNumeric as number) ? (firstNumeric as number) : 0,
      type: tpl.name,
      unit: tpl.deviceId,      // device code (M1…)
      timestamp: Date.now(),
      values: buildMeasuredValues(valuesRows.value),
    }
    await measurementStore.saveMeasurement(projectId, payload)
    await loadMeasurements()
    measurementDialogOpen.value = false
    snackbar.value = { open: true, text: 'Měření uloženo' }
  } catch (e) {
    console.error(e)
    snackbar.value = { open: true, text: 'Chyba při ukládání' }
  } finally {
    saving.value = false
  }
}

function buildMeasuredValues(rows: ValueRow[]): MeasuredValue[] {
  return rows.map((r, idx) => {
    const base: MeasuredValue = { orderIndex: r.order ?? (idx + 1), name: r.name, type: r.type }
    switch (r.type) {
      case 'float':
      case 'int': {
        const n = parseNumber(r.value, r.type === 'int')
        return { ...base, numberValue: n }
      }
      case 'text':
        return { ...base, textValue: r.value != null ? String(r.value) : '' }
      case 'bool': {
        const b = normalizeBool(r.value)
        return { ...base, boolValue: b }
      }
      case 'date': {
        const val = r.value
        const ts = typeof val === 'number' ? val : (typeof val === 'string' ? Date.parse(val) : NaN)
        return { ...base, dateValue: Number.isFinite(ts) ? ts : null }
      }
      case 'file': {
        const name = (r as unknown as { value?: { name?: string } })?.value?.name ?? null
        return { ...base, fileUrl: name }
      }
      default:
        return base
    }
  })
}

/* ---------- Načtení měření ---------- */
const measurementsSorted = computed<MeasurementResponse[]>(() => {
  const src = measurementStore.allMeasurements
  const list = Array.isArray(src) ? src : []
  return list.slice().sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))
})
async function loadMeasurements() {
  await measurementStore.fetchAllMeasurements(projectId)
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
      return {
        id: m.id,
        type: m.type,
        device: m.unit ?? '',
        date: (m as unknown as { date?: string }).date || formatLocal(m.timestamp),
        count: valuesCount,
        _raw: m,
      }
    })
})

/* ---------- Detail měření + edit ---------- */
const detailOpen = ref(false)
const detailItem = ref<MeasurementResponse | null>(null)
const detailIndex = ref<number>(-1)
const detailSaving = ref(false)
const detailRows = ref<ValueRow[]>([])
const detailDateYmd = ref<string>('')   // YYYY-MM-DD
const detailTimeHM = ref<string>('')    // HH:MM

function hmFromMs(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function setHM(base: Date, hm: string): Date {
  const [h, m] = hm.split(':').map(v => parseInt(v, 10) || 0)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

function buildDetailRowsFrom(item: MeasurementResponse | null) {
  const now = Date.now()
  const rows: ValueRow[] = []
  if (item && Array.isArray(item.values) && item.values.length > 0) {
    for (let i = 0; i < item.values.length; i++) {
      const v = item.values[i]!
      const id = `dv-${v.orderIndex}-${now}-${i}`
      const type = v.type as ValueRow['type']
      let value: unknown = ''
      if (type === 'float' || type === 'int') value = v.numberValue ?? null
      else if (type === 'text') value = v.textValue ?? ''
      else if (type === 'bool') value = typeof v.boolValue === 'boolean' ? v.boolValue : null
      else if (type === 'date') value = v.dateValue ?? null
      else if (type === 'file') value = v.fileUrl ?? null
      rows.push({
        id,
        order: v.orderIndex ?? (i + 1),
        name: v.name,
        type,
        required: true,
        value
      })
    }
  } else if (item) {
    rows.push({
      id: `dv-single-${now}`,
      order: 1,
      name: 'Hodnota',
      type: 'float',
      required: true,
      value: item.value
    })
  }
  detailRows.value = rows
  const ts = toMs(item?.timestamp ?? Date.now())
  if (!Number.isNaN(ts)) {
    const dt = new Date(ts)
    detailDateYmd.value = toYmdLocal(dt)
    detailTimeHM.value = hmFromMs(ts)
  } else {
    detailDateYmd.value = toYmdLocal(new Date())
    detailTimeHM.value = '00:00'
  }
}



function openDetailAtIndex(idx: number) {
  const items = filteredMeasurements.value
  if (idx < 0 || idx >= items.length) return
  detailIndex.value = idx
  const raw = items[idx]?._raw as MeasurementResponse | undefined
  detailItem.value = raw ?? null
  if (detailItem.value) buildDetailRowsFrom(detailItem.value)
  detailOpen.value = !!detailItem.value
}

function onRowClick(_ev: MouseEvent, row: unknown) {
  const items = filteredMeasurements.value
  const id = (row as { item?: { raw?: { id?: number }; id?: number }; raw?: { id?: number } })?.item?.raw?.id
    ?? (row as { item?: { id?: number } }).item?.id
    ?? (row as { raw?: { id?: number } }).raw?.id
    ?? null
  const idx = id != null ? items.findIndex(i => i.id === id) : -1
  if (idx >= 0) openDetailAtIndex(idx)
}

/* Navigace v detailu (wrap) */
function prevDetail() { if (filteredMeasurements.value.length) openDetailAtIndex((detailIndex.value - 1 + filteredMeasurements.value.length) % filteredMeasurements.value.length) }
function nextDetail() { if (filteredMeasurements.value.length) openDetailAtIndex((detailIndex.value + 1) % filteredMeasurements.value.length) }

async function saveDetail() {
  if (!detailItem.value) return
  detailSaving.value = true
  try {
    const firstNumeric = detailRows.value
      .filter(v => v.type === 'float' || v.type === 'int')
      .map(v => parseNumber(v.value, v.type === 'int'))
      .find(n => Number.isFinite(n as number))

    const baseDay = detailDateYmd.value ? normalizeToDate(detailDateYmd.value) : new Date()
    const tsMs = setHM(baseDay, detailTimeHM.value || '00:00').getTime()

    const payload = {
      value: Number.isFinite(firstNumeric as number) ? (firstNumeric as number) : detailItem.value.value,
      type: detailItem.value.type,
      unit: detailItem.value.unit,
      timestamp: tsMs,
      values: buildMeasuredValues(detailRows.value),
      boardCardId: detailItem.value.boardCardId ?? null
    }
    await measurementStore.updateMeasurement(detailItem.value.id, payload)
    await loadMeasurements()
    snackbar.value = { open: true, text: 'Měření upraveno' }
    detailOpen.value = false
  } catch (e) {
    console.error(e)
    snackbar.value = { open: true, text: 'Chyba při ukládání' }
  } finally {
    detailSaving.value = false
  }
}

/* Mazání */
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
    snackbar.value = { open: true, text: 'Měření smazáno' }
  } catch (e) {
    console.error(e)
    snackbar.value = { open: true, text: 'Chyba při mazání' }
  } finally {
    deleteLoading.value = false
  }
}
function cancelDelete() {
  confirmDeleteOpen.value = false
}


// Potvrzení smazání šablony
const confirmTemplateDeleteOpen = ref(false)
const deleteTemplateLoading = ref(false)


function askDeleteTemplate(): void {
  if (!selectedTemplateId.value || formMode.value !== 'edit') return
  confirmTemplateDeleteOpen.value = true
}

async function confirmDeleteTemplate(): Promise<void> {
  const idNum = Number(selectedTemplateId.value)
  if (!Number.isFinite(idNum)) { confirmTemplateDeleteOpen.value = false; return }
  deleteTemplateLoading.value = true
  try {
    await templatesStore.remove(idNum)
    await templatesStore.fetchByProject(projectId)
    confirmTemplateDeleteOpen.value = false
    templateFormOpen.value = false
    // po smazání vrať přehled a refreshni výběr
    overviewOpen.value = true
    selectedTemplateId.value = null
    snackbar.value = { open: true, text: 'Šablona smazána' }
  } catch (e) {
    console.error('Chyba při mazání šablony', e)
    snackbar.value = { open: true, text: 'Chyba při mazání šablony' }
  } finally {
    deleteTemplateLoading.value = false
  }
}

function cancelDeleteTemplate(): void {
  confirmTemplateDeleteOpen.value = false
}


/* ---------- Klávesové zkratky (globálně) ---------- */
function onHotkeys(e: KeyboardEvent) {
  // Toggle postranní panel (sjednocení s Board.vue)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); isSideFilterOpen.value = !isSideFilterOpen.value; return }

  // Filtry (Left panel)
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); selectAllDevices() }
  if (e.ctrlKey && e.altKey   && e.key.toLowerCase() === 'd') { e.preventDefault(); clearDevices() }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); selectAllTemplates() }
  if (e.ctrlKey && e.altKey   && e.key.toLowerCase() === 's') { e.preventDefault(); clearTemplates() }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openCreateMeasurement(); return }

  // Datum – rychlé kroky
  if (e.key === 'ArrowLeft' && !measurementDialogOpen.value) { e.preventDefault(); addDays(-1); return }
  if (e.key === 'ArrowRight' && !measurementDialogOpen.value) { e.preventDefault(); addDays(1); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') { e.preventDefault(); goToday(); return }

  if (confirmTemplateDeleteOpen.value) {
    if (e.key === 'Enter') { e.preventDefault(); if (!deleteTemplateLoading.value) void confirmDeleteTemplate(); return }
    if (e.key === 'Escape') { e.preventDefault(); if (!deleteTemplateLoading.value) cancelDeleteTemplate(); return }
    e.preventDefault()
    return
  }

  if (templateFormOpen.value) {
    if (e.key === 'Escape') { e.preventDefault(); templateFormOpen.value = false; overviewOpen.value = (templateCreateContext.value === 'overview'); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (isTemplateValid.value) void saveTemplate(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addField(); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && formMode.value === 'edit') {
      e.preventDefault()
      askDeleteTemplate()
      return
    }
  }

  // Dialog Měření
  if (measurementDialogOpen.value) {
    if (e.key === 'Escape') { e.preventDefault(); measurementDialogOpen.value = false; return }
    if (measurementStep.value === 1) {
      if (e.key === 'Enter') { e.preventDefault(); goToStep2(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); startCreateTemplate('measurement'); return }
    } else {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (canSaveMeasurement.value) submitNewMeasurement(); return }
    }
  }

  // Dialog Šablony
  if (templateFormOpen.value) {
    if (e.key === 'Escape') { e.preventDefault(); templateFormOpen.value = false; overviewOpen.value = (templateCreateContext.value === 'overview'); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (isTemplateValid.value) saveTemplate(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addField(); return }
  }

  if (confirmDeleteOpen.value) {
    // Enter = potvrdit smazání, Esc = zrušit, nic nepropustit dál
    if (e.key === 'Enter') { e.preventDefault(); if (!deleteLoading.value) void confirmDelete(); return }
    if (e.key === 'Escape') { e.preventDefault(); if (!deleteLoading.value) cancelDelete(); return }
    e.preventDefault()
    return
  }

  // Detail – navigace a mazání
  if (detailOpen.value) {
    if (e.key === 'Escape') { e.preventDefault(); detailOpen.value = false; return }
    if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'k') { e.preventDefault(); prevDetail(); return }
    if (e.key === 'ArrowDown' || e.key.toLowerCase() === 'j') { e.preventDefault(); nextDetail(); return }
    if (e.key === 'Delete'
      //  || e.key === 'Backspace'
    ) { e.preventDefault(); askDelete(); return }
  }
}
onMounted(() => window.addEventListener('keydown', onHotkeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkeys))
</script>

<template>
  <v-container fluid class="pa-0">
    <!-- Sjednocená horní lišta jako v Board.vue -->
    <v-toolbar color="white" class="border-b-sm pl-3 pr-3" density="comfortable">
      <v-btn color="primary" variant="tonal" @click="isSideFilterOpen = !isSideFilterOpen">
        Procházet
      </v-btn>

      <v-btn color="primary" class="ml-2" @click="openCreateMeasurement">
        VYTVOŘIT MĚŘENÍ
      </v-btn>
      <v-btn elevation="0" variant="tonal" class="ml-2" @click="openOverview">
        PŘEHLED ŠABLON
      </v-btn>

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
        <!-- LEFT PANEL (toggling like Board.vue) -->
        <v-col v-if="isSideFilterOpen" cols="12" md="3">
          <LeftFiltersPanel
            v-model:date="selectedDate"
            v-model:selection="leftSelection"
            :groups="leftGroups"
          />
        </v-col>

        <!-- RIGHT PANEL -->
        <v-col :cols="12" :md="isSideFilterOpen ? 9 : 12">
          <v-slide-y-transition group>
            <v-sheet key="table" elevation="1" class="pa-4 rounded-xl">
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
          </v-slide-y-transition>
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
              <v-btn color="primary" class="ml-3" @click="startCreateTemplate('overview')">
                VYTVOŘIT ŠABLONU
              </v-btn>
            </div>
          </div>
          <div class="table-header mt-3">
            <div class="col-device text-caption text-medium-emphasis">Přístroj</div>
            <div class="col-name text-caption text-medium-emphasis">Název šablony</div>
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
                  <v-chip size="small" :color="tpl.deviceColor" text-color="white" class="device-chip">
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
                  <v-chip size="small" :color="item.raw.color" text-color="white" class="ma-0">
                    {{ item.raw.name }}
                  </v-chip>
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
              <v-checkbox v-model="item.required" hide-details density="compact" />
            </template>
            <template #item.name="{ item }">
              <v-text-field v-model="item.name" hide-details density="compact" variant="plain" />
            </template>
            <template #item.actions="{ index }">
              <v-btn icon="mdi-delete-outline" color="error" size="x-small" variant="text" @click="removeField(index)" />
            </template>
          </v-data-table>

          <div class="mt-3">
            <v-btn size="small" color="primary" variant="tonal" @click="addField">
              PŘIDAT NOVÉ POLE (Ctrl+Enter)
            </v-btn>
          </div>
        </template>
        <template #footer>
          <v-btn
            v-if="formMode === 'edit'"
            color="error"
            variant="outlined"
            :disabled="deleteTemplateLoading"
            @click="askDeleteTemplate"
          >
            Smazat šablonu (Del)
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="() => { templateFormOpen = false; overviewOpen = templateCreateContext === 'overview' }">
            Zrušit
          </v-btn>
          <v-btn color="primary" :disabled="!isTemplateValid" @click="saveTemplate">
            Uložit (Ctrl+S)
          </v-btn>
        </template>

        <Dialog v-model:is-open="confirmTemplateDeleteOpen" width="520px" :hide-footer="true">
          <template #content>
            <form class="pa-4" @submit.prevent="confirmDeleteTemplate" @keydown.enter.prevent="confirmDeleteTemplate">
              <div class="text-h6 mb-2">Smazat šablonu?</div>
              <div class="mb-4">Tato akce je nevratná. Opravdu chcete smazat tuto šablonu?</div>
              <div class="d-flex" style="gap: 12px">
                <v-btn
                  type="submit"
                  color="error"
                  :loading="deleteTemplateLoading"
                  :disabled="deleteTemplateLoading || !selectedTemplateId"
                >
                  Smazat
                </v-btn>
                <v-spacer />
                <v-btn variant="tonal" :disabled="deleteTemplateLoading" @click="cancelDeleteTemplate">
                  Zrušit
                </v-btn>
              </div>
            </form>
          </template>
        </Dialog>
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
                  <v-chip size="small" :color="item.raw.color" text-color="white">
                    {{ item.raw.id }}
                  </v-chip>
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

          <div class="mt-2">
            <v-alert type="info" variant="tonal" density="comfortable">
              Nemáte k dispozici potřebnou šablonu?
              <v-btn variant="text" color="primary" class="ml-1 px-1" @click="startCreateTemplate('measurement')">
                Vytvořte si ji.
              </v-btn>
            </v-alert>
          </div>
        </template>

        <template v-else #content>
          <div class="text-subtitle-2 mb-3">Primární data</div>

          <div class="d-flex ga-2 mb-3">
            <v-btn size="small" color="primary" variant="tonal" @click="pasteFromClipboard">
              VLOŽIT ZE SCHRÁNKY (Ctrl+V)
            </v-btn>
          </div>

          <!-- HLAVIČKA TABULKY  -->
          <div class="grid header-row">
            <div class="cell muted">Poř.č.</div>
            <div class="cell muted">Název pole</div>
            <div class="cell muted">Vstupní prvek</div>
          </div>

          <transition-group name="fade-y" tag="div">
            <div
              class="grid data-row"
              v-for="(row, idx) in valuesRows"
              :key="row.id"
            >
              <div class="cell index">{{ idx + 1 }}</div>

              <!-- NÁZEV + TYP JAKO CHIP -->
              <div class="cell name name-with-chip">
                <span class="name-text">{{ row.name }}</span>
                <v-chip
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  class="type-chip"
                >
                  {{ TYPE_LABEL[row.type] }}
                </v-chip>
              </div>

              <div class="cell value">
                <!-- Bool -->
                <v-switch
                  v-if="row.type === 'bool'"
                  :model-value="row.value === true"
                  color="deep-purple"
                  hide-details
                  inset
                  density="comfortable"
                  @focus="focusedIndex = idx"
                  @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                  @keydown="onCellKeydown($event, idx)"
                  @update:model-value="val => updateRowValue(row, val)"
                />

                <!-- Int -->
                <v-text-field
                  v-else-if="row.type === 'int'"
                  :model-value="row.value as string | number | null | undefined"
                  :color="focusedIndex === idx ? 'deep-purple' : undefined"
                  type="text"
                  inputmode="numeric"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  placeholder="123"
                  :autofocus="idx === 0"
                  :ref="(el) => setInputRef(idx, el)"
                  @focus="focusedIndex = idx"
                  @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                  @keydown="(e: KeyboardEvent) => { allowNumberKeypress(e, true); onCellKeydown(e, idx) }"
                  @update:model-value="val => updateRowValue(row, val)"
                />

                <!-- Float -->
                <v-text-field
                  v-else-if="row.type === 'float'"
                  :model-value="row.value as string | number | null | undefined"
                  :color="focusedIndex === idx ? 'deep-purple' : undefined"
                  type="text"
                  inputmode="decimal"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  placeholder="123,45"
                  :autofocus="idx === 0"
                  :ref="(el) => setInputRef(idx, el)"
                  @focus="focusedIndex = idx"
                  @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                  @keydown="(e: KeyboardEvent) => { allowNumberKeypress(e, false); onCellKeydown(e, idx) }"
                  @update:model-value="val => updateRowValue(row, val)"
                />

                <!-- Date -->
                <v-text-field
                  v-else-if="row.type === 'date'"
                  :model-value="typeof row.value === 'number'
                    ? new Date(row.value as number).toISOString().slice(0,10)
                    : (row.value as string | null | undefined)"
                  :color="focusedIndex === idx ? 'deep-purple' : undefined"
                  type="date"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  :ref="(el) => setInputRef(idx, el)"
                  @focus="focusedIndex = idx"
                  @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                  @keydown="onCellKeydown($event, idx)"
                  @update:model-value="val => updateRowValue(row, val)"
                />

                <!-- File -->
                <v-file-input
                  v-else-if="row.type === 'file'"
                  :model-value="row.value as File | null | undefined"
                  :color="focusedIndex === idx ? 'deep-purple' : undefined"
                  density="comfortable"
                  hide-details="auto"
                  variant="outlined"
                  accept="image/*,.csv,.txt,.pdf"
                  show-size
                  :ref="(el) => setInputRef(idx, el)"
                  @focus="focusedIndex = idx"
                  @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                  @keydown="onCellKeydown($event, idx)"
                  @update:model-value="val => updateRowValue(row, (Array.isArray(val) ? val[0] : val))"
                />

                <!-- Text -->
                <v-text-field
                  v-else
                  :model-value="row.value as string | number | null | undefined"
                  :color="focusedIndex === idx ? 'deep-purple' : undefined"
                  type="text"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  placeholder="Text…"
                  :autofocus="idx === 0"
                  :ref="(el) => setInputRef(idx, el)"
                  @focus="focusedIndex = idx"
                  @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                  @keydown="onCellKeydown($event, idx)"
                  @update:model-value="val => updateRowValue(row, val)"
                />
              </div>


            </div>
          </transition-group>
        </template>

        <template #footer>
          <v-btn variant="text" @click="measurementDialogOpen = false">Zrušit (Esc)</v-btn>
          <v-spacer />
          <v-btn
            v-if="measurementStep === 1"
            color="primary"
            :disabled="!metaSelectedTemplateId"
            @click="goToStep2"
          >
            Pokračovat (Enter)
          </v-btn>
          <v-btn
            v-else
            color="primary"
            :loading="saving"
            :disabled="!canSaveMeasurement"
            @click="submitNewMeasurement"
          >
            Uložit (Ctrl+S)
          </v-btn>
        </template>
      </Dialog>

      <!-- Detail měření – editor s EntityEditorDialog -->
      <EntityEditorDialog
        v-model:is-open="detailOpen"
        :entity-label="'měření'"
        mode="edit"
        :saving="detailSaving"
        :deletable="true"
        :width="'920px'"
        :title-extra="detailDateYmd ? `${detailDateYmd}${detailTimeHM ? ' ' + detailTimeHM : ''}` : ''"
        @save="saveDetail"
        @delete="askDelete"
        @cancel="() => {}"
      >
        <template #header-right>
          <v-btn icon="mdi-chevron-up" variant="text" title="Předchozí (←/K)" @click="prevDetail" />
          <v-btn icon="mdi-chevron-down" variant="text" title="Další (→/J)" @click="nextDetail" />
        </template>

        <transition name="detail-swap" mode="out-in" appear> <div v-if="detailItem" class="mb-3">
          <v-row class="g-4">
            <v-col cols="12" md="6">
              <v-text-field :model-value="detailItem?.type" label="Šablona" variant="outlined" density="comfortable" readonly />
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
                  <v-chip size="small" :color="item.raw.color" text-color="white">{{ item.raw.id }}</v-chip>
                </template>
              </v-select>
            </v-col>
          </v-row>
        </div>
        </transition>

        <div class="text-subtitle-2 mb-2">Upravit hodnoty</div>

        <!-- HLAVIČKA EDITORU -->
        <div class="grid header-row">
          <div class="cell muted">Poř.č.</div>
          <div class="cell muted">Název pole</div>
          <div class="cell muted">Vstupní prvek</div>
        </div>

        <transition-group name="fade-y" tag="div">
          <div
            class="grid data-row"
            v-for="(row, idx) in detailRows"
            :key="row.id"
          >
            <div class="cell index">{{ idx + 1 }}</div>

            <!-- NÁZEV + TYP JAKO CHIP -->
            <div class="cell name name-with-chip">
              <span class="name-text">{{ row.name }}</span>
              <v-chip
                size="x-small"
                color="primary"
                variant="tonal"
                class="type-chip"
              >
                {{ TYPE_LABEL[row.type] }}
              </v-chip>
            </div>

            <div class="cell value">
              <!-- Bool -->
              <v-switch
                v-if="row.type === 'bool'"
                :model-value="row.value === true"
                color="deep-purple"
                hide-details
                inset
                density="comfortable"
                @focus="focusedIndex = idx"
                @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                @keydown="onCellKeydown($event, idx)"
                @update:model-value="val => updateRowValue(row, val)"
              />

              <!-- Int -->
              <v-text-field
                v-else-if="row.type === 'int'"
                :model-value="row.value as string | number | null | undefined"
                :color="focusedIndex === idx ? 'deep-purple' : undefined"
                type="text"
                inputmode="numeric"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                placeholder="123"
                :autofocus="idx === 0"
                :ref="(el) => setInputRef(idx, el)"
                @focus="focusedIndex = idx"
                @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                @keydown="(e: KeyboardEvent) => { allowNumberKeypress(e, true); onCellKeydown(e, idx) }"
                @update:model-value="val => updateRowValue(row, val)"
              />

              <!-- Float -->
              <v-text-field
                v-else-if="row.type === 'float'"
                :model-value="row.value as string | number | null | undefined"
                :color="focusedIndex === idx ? 'deep-purple' : undefined"
                type="text"
                inputmode="decimal"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                placeholder="123,45"
                :autofocus="idx === 0"
                :ref="(el) => setInputRef(idx, el)"
                @focus="focusedIndex = idx"
                @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                @keydown="(e: KeyboardEvent) => { allowNumberKeypress(e, false); onCellKeydown(e, idx) }"
                @update:model-value="val => updateRowValue(row, val)"
              />

              <!-- Date -->
              <v-text-field
                v-else-if="row.type === 'date'"
                :model-value="typeof row.value === 'number'
                  ? new Date(row.value as number).toISOString().slice(0,10)
                  : (row.value as string | null | undefined)"
                :color="focusedIndex === idx ? 'deep-purple' : undefined"
                type="date"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                :ref="(el) => setInputRef(idx, el)"
                @focus="focusedIndex = idx"
                @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                @keydown="onCellKeydown($event, idx)"
                @update:model-value="val => updateRowValue(row, val)"
              />

              <!-- File -->
              <v-file-input
                v-else-if="row.type === 'file'"
                :model-value="row.value as File | null | undefined"
                :color="focusedIndex === idx ? 'deep-purple' : undefined"
                density="comfortable"
                hide-details="auto"
                variant="outlined"
                accept="image/*,.csv,.txt,.pdf"
                show-size
                :ref="(el) => setInputRef(idx, el)"
                @focus="focusedIndex = idx"
                @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                @keydown="onCellKeydown($event, idx)"
                @update:model-value="val => updateRowValue(row, (Array.isArray(val) ? val[0] : val))"
              />

              <!-- Text -->
              <v-text-field
                v-else
                :model-value="row.value as string | number | null | undefined"
                :color="focusedIndex === idx ? 'deep-purple' : undefined"
                type="text"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                placeholder="Text…"
                :autofocus="idx === 0"
                :ref="(el) => setInputRef(idx, el)"
                @focus="focusedIndex = idx"
                @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
                @keydown="onCellKeydown($event, idx)"
                @update:model-value="val => updateRowValue(row, val)"
              />
            </div>

            <div class="cell status right">
              <v-tooltip v-if="valueError(row)" location="top">
                <template #activator="{ props }">
                  <v-icon v-bind="props" size="18" color="error" icon="mdi-alert-circle-outline" />
                </template>
                <span>{{ valueError(row) }}</span>
              </v-tooltip>
            </div>
          </div>
        </transition-group>
      </EntityEditorDialog>

      <!-- Potvrzení smazání -->
      <Dialog v-model:is-open="confirmDeleteOpen" width="520px" :hide-footer="true">
        <template #content>
          <form class="pa-4" @submit.prevent="confirmDelete" @keydown.enter.prevent="confirmDelete">
            <div class="text-h6 mb-2">Smazat měření?</div>
            <div class="mb-4">Tato akce je nevratná. Opravdu chcete smazat toto měření?</div>
            <div class="d-flex" style="gap: 12px">
              <v-btn
                color="primary"
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

      <!-- Snackbar feedback -->
      <v-snackbar v-model="snackbar.open" :timeout="2200">
        {{ snackbar.text }}
      </v-snackbar>
    </v-container>
  </v-container>
</template>

<style scoped>
/* ---------- Templates overview layout ---------- */
.templates-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.templates-header-right { display: flex; align-items: center; gap: 12px; width: 60%; }
.search { min-width: 240px; flex: 1 1 280px; max-width: 360px; }
.table-header { display: grid; grid-template-columns: 120px 1fr; padding: 4px 10px 6px 10px; }
.table-body { max-height: 420px; overflow-y: auto; }
.row.template-row { display: grid; grid-template-columns: 120px 1fr; align-items: center; padding: 8px 10px; border-radius: 10px; border: 2px solid transparent; transition: border-color 0.15s ease, background-color 0.15s ease; }
.row.template-row:hover { background: #f7f7fb; }
.row.template-row.is-selected, .row.template-row:focus-visible { border-color: var(--v-theme-deep-purple); background-color: transparent !important; outline: none; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- Table cosmetics ---------- */
.pretty-table :deep(.v-data-table__th) { background: #f8f9fb; font-weight: 700; }
.pretty-table :deep(tbody tr:hover) { background: #fbfcff; }

/* ---------- Step 2 editor grid ---------- */
.grid {
  display: grid;
  /* dříve: 56px 1fr 120px minmax(220px, 1.5fr) 80px */
  grid-template-columns: 56px 1fr minmax(220px, 1.5fr) 80px;
  gap: 8px;
  align-items: center;
}
.header-row { padding: 6px 6px 8px 6px; }
.data-row { padding: 6px; border-radius: 8px; }
.data-row:hover { background: #fbfcff; }
.cell.muted { color: rgba(0,0,0,0.54); font-size: 0.9rem; }
.cell.index { text-align: center; color: rgba(0,0,0,0.54); }
.cell.right { text-align: right; }

/* název pole + chip vedle sebe */
.name-with-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type-chip {
  font-weight: 600;
  letter-spacing: .02em;
  text-transform: none;
}

/* tiny transition (ponecháno) */
.fade-y-enter-active, .fade-y-leave-active { transition: all .15s ease; }
.fade-y-enter-from, .fade-y-leave-to { opacity: 0; transform: translateY(-4px); }

.detail-swap-enter-active, .detail-swap-leave-active { transition: opacity 180ms cubic-bezier(.2,.6,.2,1), transform 180ms cubic-bezier(.2,.6,.2,1); will-change: opacity, transform; backface-visibility: hidden; }

.detail-swap-enter-from, .detail-swap-leave-to { opacity: 0; transform: translateX(var(--dir, 16px)) scale(.98); }

.detail-swap-enter-to, .detail-swap-leave-from { opacity: 1; transform: translateX(0) scale(1); }
</style>
