<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import EntityEditorDialog from '@/components/EntityEditorDialog.vue'
import ChartPanel from '@/components/measurement/ChartPanel.vue'
import { type DeviceItem, type ValueRow, type ValueType, type TemplateItem } from '@/types/measurement-ui'
import { type MeasurementResponse, type MeasuredValue } from '@/stores/measurement'

/**
 * Measurement detail dialog – profesionální LIMS UX.
 * - Klávesové zkratky:
 *   Esc                Zavřít dialog
 *   Ctrl+S             Uložit
 *   Ctrl+ArrowLeft     Předchozí měření
 *   Ctrl+ArrowRight    Další měření
 *   Alt+M / Alt+V / Alt+S  Přepnout sekci Meta / Values / Stats
 *   Alt+E              Expand all hodnoty
 *   Alt+C              Collapse all hodnoty
 *   Alt+ArrowUp/Down   Navigace mezi řádky hodnot
 *   Ctrl+E             Export aktuální numerické hodnoty do CSV
 *   Enter              (v poli) potvrzuje editaci – zůstává fokus
 */

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

/* ---------- Stav ---------- */
const rows = ref<ValueRow[]>([])
const expandedRows = ref<Set<string>>(new Set())

const selectedTemplateName = ref<string>('')
const selectedDeviceId = ref<string>('')
const selectedUsername = ref<string | null>(null)
const noteText = ref<string>('')

const dateYmd = ref<string>('')    // YYYY-MM-DD
const timeHM = ref<string>('')     // HH:MM

/* ---------- Pomocné funkce pro datum ---------- */
function pad2(n: number): string { return String(n).padStart(2, '0') }
function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
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

// Helpers to avoid TS unions in <template>
const textModel = (row: ValueRow): string | number | null | undefined =>
  (row.value ?? null) as string | number | null | undefined

const dateModel = (row: ValueRow): string | null =>
  typeof row.value === 'number'
    ? new Date(row.value).toISOString().slice(0, 10)
    : (row.value as string | null | undefined) ?? null

const fileModel = (row: ValueRow): File | null | undefined =>
  (row.value as File | null | undefined)


/* ---------- Inicializace z MeasurementResponse ---------- */
function buildFrom(item: MeasurementResponse | null): void {
  rows.value = []
  if (!item) return

  selectedTemplateName.value = item.type || ''
  selectedDeviceId.value = item.unit || ''
  selectedUsername.value = item.measuredByUsername ?? props.currentUsername ?? null
  noteText.value = item.note ?? ''

  const now = Date.now()
  if (Array.isArray(item.values) && item.values.length > 0) {
    rows.value = item.values.map((v, i) => ({
      id: `val-${v.orderIndex}-${now}-${i}`,
      order: v.orderIndex ?? (i + 1),
      name: v.name,
      type: v.type as ValueType,
      required: true,
      value:
        v.type === 'float' || v.type === 'int' ? v.numberValue ?? null :
          v.type === 'text' ? v.textValue ?? '' :
            v.type === 'bool' ? (typeof v.boolValue === 'boolean' ? v.boolValue : null) :
              v.type === 'date' ? v.dateValue ?? null :
                v.fileUrl ?? null
    }))
  } else {
    rows.value = [{
      id: `val-single-${now}`,
      order: 1,
      name: 'Hodnota',
      type: 'float',
      required: true,
      value: item?.value ?? null
    }]
  }
  expandedRows.value = new Set(rows.value.map(r => r.id))

  const tsRaw = typeof item.timestamp === 'number'
    ? item.timestamp
    : Date.parse(String(item.timestamp))
  const ts = Number.isFinite(tsRaw) ? tsRaw : Date.now()
  const dt = new Date(ts)
  dateYmd.value = toYmdLocal(dt)
  timeHM.value = hmFromMs(ts)
}
watch(() => props.item, v => buildFrom(v), { immediate: true })

/* ---------- Parsování hodnot ---------- */
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
  if (['1','true','ano','a','yes','y','t'].includes(s)) return true
  if (['0','false','ne','n','no','f'].includes(s)) return false
  return null
}
function updateRowValue(row: ValueRow, raw: unknown): void {
  switch (row.type) {
    case 'float': row.value = parseNumber(raw, false); break
    case 'int': row.value = parseNumber(raw, true); break
    case 'bool': row.value = normalizeBool(raw); break
    case 'date': {
      if (raw === null || raw === '') { row.value = null; break }
      if (typeof raw === 'number') { row.value = raw; break }
      if (typeof raw === 'string') {
        const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (m) {
          const y = +m[1]; const mo = +m[2]; const d = +m[3]
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
    case 'file': row.value = raw; break
    default: row.value = raw ?? ''
  }
}

/* ---------- Validace ---------- */
function valueError(row: ValueRow): string | null {
  if (!row.required) return null
  switch (row.type) {
    case 'bool': return (row.value === true || row.value === false) ? null : 'Vyžadováno'
    case 'float': return parseNumber(row.value, false) !== null ? null : 'Neplatné číslo'
    case 'int': return parseNumber(row.value, true) !== null ? null : 'Neplatné celé číslo'
    case 'date': {
      const v = row.value
      const ms = typeof v === 'number' ? v : (typeof v === 'string' ? Date.parse(v) : NaN)
      return Number.isFinite(ms) ? null : 'Neplatné datum'
    }
    case 'file': return row.value != null ? null : 'Vyžadován soubor'
    default: return row.value != null && String(row.value).trim().length > 0 ? null : 'Vyžadováno'
  }
}
const invalidByRow = computed<number>(() =>
  rows.value.reduce((acc, r) => acc + (valueError(r) ? 1 : 0), 0)
)
const canSaveMeta = computed<boolean>(() =>
  !!selectedTemplateName.value.trim() &&
  !!selectedDeviceId.value &&
  invalidByRow.value === 0
)

/* ---------- Výstavba payloadu ---------- */
function buildMeasuredValues(list: ValueRow[]): MeasuredValue[] {
  return list.map((r, idx) => {
    const base: MeasuredValue = { orderIndex: r.order ?? (idx + 1), name: r.name, type: r.type }
    switch (r.type) {
      case 'float':
      case 'int': return { ...base, numberValue: parseNumber(r.value, r.type === 'int') }
      case 'text': return { ...base, textValue: r.value != null ? String(r.value) : '' }
      case 'bool': return { ...base, boolValue: normalizeBool(r.value) }
      case 'date': {
        const raw = r.value
        const ts = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Date.parse(raw) : NaN)
        return { ...base, dateValue: Number.isFinite(ts) ? ts : null }
      }
      case 'file': {
        const name = (r as unknown as { value?: { name?: string } })?.value?.name ?? null
        return { ...base, fileUrl: name }
      }
      default: return base
    }
  })
}

/* ---------- Sekce + souhrny ---------- */
const valuesCount = computed<number>(() => rows.value.length)
const numericCount = computed<number>(() =>
  rows.value.filter(r => r.type === 'float' || r.type === 'int').length
)

const metaSummary = computed<string[]>(() => {
  const dev = props.devices.find(d => d.id === selectedDeviceId.value)
  const devTxt = dev ? (dev.name ?? dev.id) : (selectedDeviceId.value || '—')
  const userTxt = selectedUsername.value ?? '—'
  const tplTxt = selectedTemplateName.value || '—'
  return [`Uživatel: ${userTxt}`, `Přístroj: ${devTxt}`, `Šablona: ${tplTxt}`]
})
const valuesSummary = computed<string[]>(() => {
  const invalid = invalidByRow.value
  const total = valuesCount.value
  return [
    `Položky: ${total}`,
    `Neplatných: ${invalid}`
  ]
})

/* ---------- Statistiky ---------- */
const numericFieldNames = computed<string[]>(() =>
  rows.value.filter(r => r.type === 'float' || r.type === 'int').map(r => r.name)
)
const selectedField = ref<string | null>(null)

function toNumber(raw: unknown, integer = false): number | null {
  return parseNumber(raw, integer)
}
const chartPoints = computed<number[]>(() => {
  const out: number[] = []
  for (const r of rows.value) {
    if (r.type !== 'float' && r.type !== 'int') continue
    if (selectedField.value && r.name !== selectedField.value) continue
    const n = toNumber(r.value, r.type === 'int')
    if (n != null) out.push(n)
  }
  return out
})

function mean(arr: number[]): number { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN }
function median(arr: number[]): number {
  if (!arr.length) return NaN
  const s = [...arr].sort((a,b)=>a-b)
  const n = s.length
  return n % 2 ? s[(n-1)/2] : (s[n/2-1] + s[n/2]) / 2
}
function std(arr: number[]): number {
  if (arr.length <= 1) return 0
  const m = mean(arr)
  const v = arr.reduce((a,b)=>a+(b-m)*(b-m),0)/(arr.length-1)
  return Math.sqrt(v)
}

const statsObj = computed<{
  mean: number; median: number; stdDev: number; min: number; max: number; count: number
} | null>(() => {
  const xs = chartPoints.value
  if (!xs.length) return null
  return {
    mean: mean(xs),
    median: median(xs),
    stdDev: std(xs),
    min: Math.min(...xs),
    max: Math.max(...xs),
    count: xs.length
  }
})

const statsSummary = computed<string[]>(() => {
  if (!numericCount.value) return ['Bez numerických dat']
  const s = statsObj.value
  return s
    ? [`N=${s.count}`, `μ=${s.mean.toFixed(2)}`, `σ=${s.stdDev.toFixed(2)}`]
    : [`Numerických polí: ${numericCount.value}`]
})

/* ---------- Collapsible sekce ---------- */
const metaCollapsed = ref<boolean>(false)
const valuesCollapsed = ref<boolean>(false)
const statsCollapsed = ref<boolean>(false)
function toggleMeta(): void { metaCollapsed.value = !metaCollapsed.value }
function toggleValues(): void { valuesCollapsed.value = !valuesCollapsed.value }
function toggleStats(): void { statsCollapsed.value = !statsCollapsed.value }
function expandAllValues(): void {
  expandedRows.value = new Set(rows.value.map(r => r.id))
  valuesCollapsed.value = false
}
function collapseAllValues(): void {
  expandedRows.value = new Set()
}

/* ---------- Řádkové rozbalení ---------- */
function isExpanded(row: ValueRow): boolean { return expandedRows.value.has(row.id) }
function toggleRow(row: ValueRow): void {
  const s = new Set(expandedRows.value)
  if (s.has(row.id)) s.delete(row.id)
  else s.add(row.id)
  expandedRows.value = s
}

/* ---------- Preview hodnoty pro sbalený řádek ---------- */
function previewValue(row: ValueRow): string {
  const v = row.value
  switch (row.type) {
    case 'float':
    case 'int': {
      const num = typeof v === 'number' ? v : (v == null ? null : parseFloat(String(v).replace(',', '.')))
      return num == null || Number.isNaN(num) ? '—' : String(num)
    }
    case 'bool': return v === true ? 'Ano' : (v === false ? 'Ne' : '—')
    case 'date': {
      const ms = typeof v === 'number' ? v : (typeof v === 'string' ? Date.parse(v) : NaN)
      return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0,10) : '—'
    }
    case 'file':
      return (v && (v as { name?: string }).name) ? String((v as { name?: string }).name) : '—'
    case 'text':
    default:
      return (v == null || String(v).trim() === '') ? '—' : String(v).trim()
  }
}

/* ---------- Export ---------- */
function exportSelectedCsv(): void {
  const lines: string[] = ['name;value']
  for (const r of rows.value) {
    if (r.type !== 'float' && r.type !== 'int') continue
    if (selectedField.value && r.name !== selectedField.value) continue
    const n = toNumber(r.value, r.type === 'int')
    if (n != null) {
      lines.push(`${String(r.name).replace(/;/g, ',')};${n}`)
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = selectedField.value ? `measurement-${selectedField.value}.csv` : 'measurement-numeric.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/* ---------- Uložení ---------- */
const isSaving = ref(false)
async function onSave(): Promise<void> {
  if (!props.item || !canSaveMeta.value) return
  isSaving.value = true
  try {
    const firstNumeric = rows.value
      .filter(v => v.type === 'float' || v.type === 'int')
      .map(v => parseNumber(v.value, v.type === 'int'))
      .find(n => Number.isFinite(n as number))

    const baseDay = dateYmd.value ? normalizeToDate(dateYmd.value) : new Date()
    const tsMs = setHM(baseDay, timeHM.value || '00:00').getTime()

    emits('save', {
      value: Number.isFinite(firstNumeric as number) ? (firstNumeric as number) : (props.item.value ?? 0),
      type: selectedTemplateName.value,
      unit: selectedDeviceId.value,
      timestamp: tsMs,
      values: buildMeasuredValues(rows.value),
      boardCardId: props.item.boardCardId ?? null,
      note: noteText.value.trim() ? noteText.value.trim() : null,
      measuredByUsername: selectedUsername.value?.trim() || null
    })
  } finally {
    isSaving.value = false
  }
}

/* ---------- Klávesové zkratky ---------- */
let lastFocusedIndex = -1
function focusRowInput(idx: number): void {
  nextTick(() => {
    const el = document.querySelectorAll<HTMLElement>('[data-value-input]')[idx]
    if (el) {
      el.focus()
      lastFocusedIndex = idx
    }
  })
}
function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey

  // Dialog level
  if (key === 'escape') {
    e.preventDefault()
    emits('update:modelValue', false)
    return
  }
  if (ctrl && key === 's') {
    e.preventDefault()
    void onSave()
    return
  }
  if (ctrl && key === 'arrowleft') {
    e.preventDefault(); emits('prev'); return
  }
  if (ctrl && key === 'arrowright') {
    e.preventDefault(); emits('next'); return
  }

  // Section toggles
  if (alt && key === 'm') { e.preventDefault(); toggleMeta(); return }
  if (alt && key === 'v') { e.preventDefault(); toggleValues(); return }
  if (alt && key === 's') { e.preventDefault(); toggleStats(); return }
  if (alt && key === 'e') { e.preventDefault(); expandAllValues(); return }
  if (alt && key === 'c') { e.preventDefault(); collapseAllValues(); return }

  // Export
  if (ctrl && key === 'e') {
    e.preventDefault()
    exportSelectedCsv()
    return
  }

  // Row navigation (Alt+ArrowUp/Down nebo prosté Arrow když ve vstupu)
  if (alt && (key === 'arrowdown' || key === 'arrowup')) {
    e.preventDefault()
    const max = rows.value.length - 1
    if (lastFocusedIndex < 0) lastFocusedIndex = 0
    if (key === 'arrowdown') lastFocusedIndex = Math.min(max, lastFocusedIndex + 1)
    else lastFocusedIndex = Math.max(0, lastFocusedIndex - 1)
    focusRowInput(lastFocusedIndex)
    return
  }
}

watch(() => props.modelValue, v => {
  if (v) {
    window.addEventListener('keydown', handleKey)
    nextTick(() => {
      // první fokusovatelný prvek
      const first = document.querySelector<HTMLElement>('[data-meta-first]')
      first?.focus()
    })
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (props.modelValue) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))

/* ---------- Výběr pole pro statistiku ---------- */
function onSelectField(field: string): void {
  selectedField.value = field
}


/* ---------- Stavové hlášení pro screenreadery ---------- */
const liveStatus = computed<string>(() => {
  const errs = invalidByRow.value
  if (errs > 0) return `Formulář obsahuje ${errs} neplatných polí. Nelze uložit.`
  return 'Formulář je validní. Můžete uložit.'
})
</script>

<template>
  <EntityEditorDialog
    :is-open="modelValue"
    entity-label="měření"
    mode="edit"
    :saving="isSaving"
    :deletable="true"
    :width="'960px'"
    :title-extra="dateYmd ? `${dateYmd}${timeHM ? ' ' + timeHM : ''}` : ''"
    @update:is-open="v => emits('update:modelValue', v)"
    @save="onSave"
    @delete="() => emits('delete')"
    @cancel="() => emits('update:modelValue', false)"
  >
    <template #header-right>
      <v-btn
        icon="mdi-chevron-up"
        variant="text"
        title="Předchozí (Ctrl+←)"
        @click="() => emits('prev')"
      />
      <v-btn
        icon="mdi-chevron-down"
        variant="text"
        title="Další (Ctrl+→)"
        @click="() => emits('next')"
      />
    </template>

    <!-- STICKY sekční lišta -->
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
        :aria-expanded="!metaCollapsed"
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
        :aria-expanded="!valuesCollapsed"
        aria-controls="section-values"
        title="Hodnoty (Alt+V)"
        @click="toggleValues"
      >
        Hodnoty
        <v-badge
          v-if="invalidByRow > 0"
          :content="invalidByRow"
          color="error"
          inline
          class="ml-2"
          :title="`${invalidByRow} neplatných`"
        />
      </v-btn>

      <v-btn
        size="small"
        :variant="statsCollapsed ? 'tonal' : 'flat'"
        :color="statsCollapsed ? undefined : 'primary'"
        :aria-expanded="!statsCollapsed"
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
      <!-- Meta sekce -->
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
              v-for="(t,i) in metaSummary"
              :key="i"
              size="x-small"
              variant="tonal"
            >
              {{ t }}
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
            <v-icon :class="{'rot-180': !metaCollapsed}">
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
                :hint="!selectedUsername ? 'Vyplňte autora měření' : undefined"
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

      <!-- Hodnoty sekce -->
      <section
        id="section-values"
        class="mb-4"
        :aria-hidden="valuesCollapsed"
      >
        <div
          class="d-flex align-center mb-2"
          style="gap:6px;"
        >
          <span class="text-subtitle-2">Hodnoty</span>

          <div
            v-if="valuesCollapsed"
            class="d-flex align-center flex-wrap"
            style="gap:4px; margin-left:8px;"
          >
            <v-chip
              v-for="(t,i) in valuesSummary"
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
              v-for="(row, idx) in rows"
              :key="row.id"
              class="grid data-row"
              :class="{'has-error': !!valueError(row)}"
              :aria-expanded="isExpanded(row)"
              :aria-label="`Řádek ${idx+1}: ${row.name} (${TYPE_LABEL[row.type]})`"
            >
              <!-- Index + expand toggle -->
              <div
                class="cell index d-flex align-center justify-center"
                style="gap:6px"
              >
                <v-btn
                  icon
                  size="x-small"
                  variant="text"
                  :title="isExpanded(row) ? 'Sbalit' : 'Rozbalit'"
                  @click.stop="toggleRow(row)"
                >
                  <v-icon
                    :icon="isExpanded(row) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                    size="18"
                  />
                </v-btn>
                <span>{{ idx + 1 }}</span>
              </div>

              <!-- Název + typ + preview -->
              <div class="cell name name-with-chip">
                <div
                  class="d-flex align-center"
                  style="gap:8px; min-width:0;"
                >
                  <span class="name-text">{{ row.name }}</span>
                  <v-chip
                    v-if="isExpanded(row)"
                    size="x-small"
                    color="primary"
                    variant="tonal"
                    class="type-chip"
                  >
                    {{ TYPE_LABEL[row.type] }}
                  </v-chip>
                  <span
                    v-else
                    class="text-medium-emphasis text-mono preview-cell"
                  >
                    {{ previewValue(row) }}
                  </span>
                </div>
              </div>

              <!-- Hodnota (input nebo preview) -->
              <div class="cell value">
                <template v-if="isExpanded(row)">
                  <v-switch
                    v-if="row.type === 'bool'"
                    :model-value="textModel(row)"
                    color="deep-purple"
                    hide-details
                    inset
                    density="comfortable"
                    data-value-input
                    @update:model-value="val => updateRowValue(row, val)"
                  />

                  <v-text-field
                    v-else-if="row.type === 'int'"
                    :model-value="textModel(row)"
                    type="text"
                    inputmode="numeric"
                    variant="outlined"
                    density="comfortable"
                    hide-details="auto"
                    placeholder="123"
                    data-value-input
                    @update:model-value="val => updateRowValue(row, val)"
                  />

                  <v-text-field
                    v-else-if="row.type === 'float'"
                    :model-value="textModel(row)"
                    type="text"
                    inputmode="decimal"
                    variant="outlined"
                    density="comfortable"
                    hide-details="auto"
                    placeholder="123,45"
                    data-value-input
                    @update:model-value="val => updateRowValue(row, val)"
                  />

                  <v-text-field
                    v-else-if="row.type === 'date'"
                    :model-value="dateModel(row)"
                    type="date"
                    variant="outlined"
                    density="comfortable"
                    hide-details="auto"
                    data-value-input
                    @update:model-value="val => updateRowValue(row, val)"
                  />

                  <v-file-input
                    v-else-if="row.type === 'file'"
                    :model-value="fileModel(row)"
                    density="comfortable"
                    hide-details="auto"
                    variant="outlined"
                    accept="image/*,.csv,.txt,.pdf"
                    show-size
                    data-value-input
                    @update:model-value="val => updateRowValue(row, (Array.isArray(val) ? val[0] : val))"
                  />

                  <v-text-field
                    v-else
                    :model-value="textModel(row)"
                    type="text"
                    variant="outlined"
                    density="comfortable"
                    hide-details="auto"
                    placeholder="Text…"
                    data-value-input
                    @update:model-value="val => updateRowValue(row, val)"
                  />
                </template>
                <template v-else>
                  <!-- Už zobrazeno v název+preview -->
                </template>
              </div>

              <!-- Stav -->
              <div class="cell right">
                <v-tooltip
                  v-if="valueError(row)"
                  location="top"
                >
                  <template #activator="{ props }">
                    <v-icon
                      v-bind="props"
                      size="18"
                      color="error"
                      icon="mdi-alert-circle-outline"
                    />
                  </template>
                  <span>{{ valueError(row) }}</span>
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

      <!-- Statistika sekce -->
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
              v-for="(t,i) in statsSummary"
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
          v-show="!statsCollapsed"
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
                :title="`Filtrovat na ${f}`"
                @click="onSelectField(f)"
              >
                {{ f }}
              </v-chip>
              <v-chip
                v-if="numericFieldNames.length > 1"
                :color="!selectedField ? 'primary' : undefined"
                variant="tonal"
                size="small"
                title="Zobrazit všechna numerická pole"
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
            @select-field="onSelectField"
          />
        </v-sheet>
      </section>
    </div>

    <template #footer>
      <div class="d-flex align-center justify-space-between w-100">
        <div class="text-caption text-medium-emphasis">
          <span v-if="invalidByRow > 0">
            {{ invalidByRow }} neplatných hodnot – opravte před uložením.
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
/* Layout grid pro řádky */
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
  transition: background-color .15s, box-shadow .15s;
}
.data-row:hover {
  background: #f9fafc;
}
.data-row.has-error {
  background: #fff6f6;
}
.cell.muted { font-size: .75rem; }
.cell.index { text-align: center; color: rgba(0,0,0,0.54); }
.cell.right { text-align: right; }
.name-with-chip { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.type-chip { font-weight: 600; letter-spacing: .02em; text-transform: none; }
.preview-cell { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .75rem; opacity: .85; }

.rot-180 { transform: rotate(180deg); }

.detail-scroll { box-sizing: border-box; }

.sticky-toolbar {
  position: sticky;
  top: 0;
  z-index: 30;
  backdrop-filter: blur(6px);
  background-color: rgba(255,255,255,0.78);
}

/* Focus states pro a11y */
[data-value-input]:focus-visible {
  outline: 2px solid var(--v-theme-primary);
  outline-offset: 2px;
  border-radius: 6px;
}

/* Sekční heading */
.section-heading {
  font-weight: 600;
  letter-spacing: .02em;
}

/* Small utility */
.text-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* Responsive – při velmi úzké šířce zmenšit 3. sloupec */
@media (max-width: 1040px) {
  .grid {
    grid-template-columns: 56px 1fr minmax(180px, 1.2fr) 56px;
  }
}
</style>
