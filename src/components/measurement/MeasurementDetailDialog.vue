<script setup lang="ts">
/* eslint-disable vue/no-deprecated-filter */
import { ref, watch, computed } from 'vue'
import EntityEditorDialog from '@/components/EntityEditorDialog.vue'
import { type DeviceItem, type ValueRow, type ValueType, type TemplateItem } from '@/types/measurement-ui'
import { type MeasurementResponse, type MeasuredValue } from '@/stores/measurement'

const props = defineProps<{
  modelValue: boolean
  item: MeasurementResponse | null
  devices: DeviceItem[]
  members: string[]            // NEW: uživatelé (členové projektu)
  templates: TemplateItem[]    // NEW: šablony pro výběr
  currentUsername?: string     // NEW: výchozí “já” (Keycloak username)
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

const TYPE_LABEL: Record<ValueType, string> = {
  float: 'Float',
  int: 'Integer',
  text: 'Text',
  file: 'Image',
  bool: 'Boolean',
  date: 'Date'
}

const rows = ref<ValueRow[]>([])
const expandedRows = ref<Set<string>>(new Set())
const dateYmd = ref<string>('')
const timeHM = ref<string>('')

const selectedTemplateName = ref<string>('')        // NEW: editable šablona podle jména
const selectedDeviceId = ref<string>('')            // NEW: editable zařízení (unit = device code)
const selectedUsername = ref<string | null>(null)   // NEW: editable člen
const noteText = ref<string>('')                    // NEW: Poznámka

function pad2(n: number) { return String(n).padStart(2, '0') }
function toYmdLocal(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function hmFromMs(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function normalizeToDate(v: string) {
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
}
function setHM(base: Date, hm: string) {
  const [h, m] = hm.split(':').map(v => parseInt(v, 10) || 0)
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

function buildFrom(item: MeasurementResponse | null) {
  rows.value = []
  if (!item) return

  // init meta (template/device/user/note)
  selectedTemplateName.value = item.type || ''
  selectedDeviceId.value = item.unit || ''
  selectedUsername.value = (item.measuredByUsername ?? props.currentUsername ?? null)
  noteText.value = (item.note ?? '')

  // values
  const now = Date.now()
  if (Array.isArray(item.values) && item.values.length > 0) {
    rows.value = item.values.map((v, i) => ({
      id: `dv-${v.orderIndex}-${now}-${i}`,
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
      id: `dv-single-${now}`,
      order: 1,
      name: 'Hodnota',
      type: 'float',
      required: true,
      value: item?.value ?? null
    }]
  }
  // default expand all
  expandedRows.value = new Set(rows.value.map(r => r.id))

  // timestamp
  const ts = (typeof item?.timestamp === 'number')
    ? item!.timestamp
    : Date.parse(String(item?.timestamp ?? Date.now()))
  const ms = Number.isFinite(ts) ? ts : Date.now()
  const dt = new Date(ms)
  dateYmd.value = toYmdLocal(dt)
  timeHM.value = hmFromMs(ms)
}
watch(() => props.item, (v) => { buildFrom(v) }, { immediate: true })

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
          const y = +m[1], mo = +m[2], d = +m[3]
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
    default:      row.value = raw ?? ''
  }
}
function valueError(row: ValueRow): string | null {
  if (!row.required) return null
  switch (row.type) {
    case 'bool': return (row.value === true || row.value === false) ? null : 'Vyžadováno'
    case 'float': return parseNumber(row.value, false) !== null ? null : 'Neplatné číslo'
    case 'int': return parseNumber(row.value, true) !== null ? null : 'Neplatné celé číslo'
    case 'date': {
      const val = row.value
      const ms = typeof val === 'number'
        ? val
        : (typeof val === 'string' ? Date.parse(val) : NaN)
      return Number.isFinite(ms) ? null : 'Neplatné datum'
    }
    case 'file': return row.value != null ? null : 'Vyžadován soubor'
    default:
      return row.value != null && String(row.value).trim().length > 0 ? null : 'Vyžadováno'
  }
}
function buildMeasuredValues(rowsIn: ValueRow[]): MeasuredValue[] {
  return rowsIn.map((r, idx) => {
    const base: MeasuredValue = { orderIndex: r.order ?? (idx + 1), name: r.name, type: r.type }
    switch (r.type) {
      case 'float':
      case 'int': {
        const n = parseNumber(r.value, r.type === 'int')
        return { ...base, numberValue: n }
      }
      case 'text':
        return { ...base, textValue: r.value != null ? String(r.value) : '' }
      case 'bool':
        return { ...base, boolValue: normalizeBool(r.value) }
      case 'date': {
        const v = r.value
        const ts = typeof v === 'number'
          ? v
          : (typeof v === 'string' ? Date.parse(v) : NaN)
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

const isSaving = ref(false)
const canSaveMeta = computed(() =>
  !!selectedTemplateName.value.trim() &&
  !!selectedDeviceId.value
)

// Visualization & statistics (per current measurement)
const numericFieldNames = computed<string[]>(() =>
  rows.value
    .filter(r => r.type === 'float' || r.type === 'int')
    .map(r => r.name)
)
const selectedField = ref<string | null>(null)

// Collapsible sections (meta / values / stats)
const metaCollapsed = ref<boolean>(false)
const valuesCollapsed = ref<boolean>(false)
const statsCollapsed = ref<boolean>(false)

function toggleMeta() { metaCollapsed.value = !metaCollapsed.value }
function toggleValues() { valuesCollapsed.value = !valuesCollapsed.value }
function toggleStats() { statsCollapsed.value = !statsCollapsed.value }

function toNumber(val: unknown, integer = false): number | null {
  if (val === '' || val == null) return null
  const s = String(val).replace(',', '.').trim()
  if (!s.length) return null
  const n = integer ? parseInt(s, 10) : parseFloat(s)
  return Number.isFinite(n) ? n : null
}

const chartPoints = computed<number[]>(() => {
  const nums: number[] = []
  for (const r of rows.value) {
    if (r.type !== 'float' && r.type !== 'int') continue
    if (selectedField.value && r.name !== selectedField.value) continue
    const n = toNumber(r.value, r.type === 'int')
    if (n != null) nums.push(n)
  }
  return nums
})

function mean(xs: number[]): number { return xs.length ? xs.reduce((a,b) => a+b, 0) / xs.length : NaN }
function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a,b)=>a-b)
  const n = s.length
  return n % 2 === 1 ? s[(n-1)/2] : (s[n/2-1] + s[n/2]) / 2
}
function stdDev(xs: number[]): number {
  if (xs.length <= 1) return 0
  const m = mean(xs)
  const v = xs.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (xs.length - 1)
  return Math.sqrt(v)
}
const statsObj = computed(() => {
  const xs = chartPoints.value
  if (!xs.length) return null as null | { mean:number; median:number; stdDev:number; min:number; max:number; count:number }
  return {
    mean: mean(xs),
    median: median(xs),
    stdDev: stdDev(xs),
    min: Math.min(...xs),
    max: Math.max(...xs),
    count: xs.length,
  }
})

function onSelectField(field: string) {
  selectedField.value = field
}

function exportSelectedCsv() {
  const rowsOut: string[] = ['name;value']
  for (const r of rows.value) {
    if (r.type !== 'float' && r.type !== 'int') continue
    if (selectedField.value && r.name !== selectedField.value) continue
    const n = toNumber(r.value, r.type === 'int')
    if (n != null) {
      const safeName = String(r.name).replace(/;/g, ',')
      rowsOut.push(`${safeName};${n}`)
    }
  }
  const blob = new Blob([rowsOut.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = selectedField.value ? `measurement-field-${selectedField.value}.csv` : 'measurement-numeric.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function isExpanded(row: ValueRow): boolean { return expandedRows.value.has(row.id) }
function toggleRow(row: ValueRow) {
  const set = new Set(expandedRows.value)
  if (set.has(row.id)) set.delete(row.id)
  else set.add(row.id)
  expandedRows.value = set
}
function previewValue(row: ValueRow): string {
  const v = row.value as unknown
  switch (row.type) {
    case 'float':
    case 'int': {
      const n = typeof v === 'number' ? v : (v == null ? null : parseFloat(String(v).replace(',', '.')))
      return n == null || Number.isNaN(n) ? '—' : String(n)
    }
    case 'bool': return v === true ? 'Ano' : (v === false ? 'Ne' : '—')
    case 'date': {
      const ms = typeof v === 'number' ? v : (typeof v === 'string' ? Date.parse(v) : NaN)
      return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0,10) : '—'
    }
    case 'file': return (v && (v as { name?: string }).name) ? String((v as { name?: string }).name) : '—'
    case 'text':
    default: {
      const s = v == null ? '' : String(v)
      return s.trim().length ? s : '—'
    }
  }
}

async function onSave() {
  if (!props.item) return
  if (!canSaveMeta.value) return
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
      type: selectedTemplateName.value,            // editable šablona (string)
      unit: selectedDeviceId.value,               // editable přístroj (device code)
      timestamp: tsMs,
      values: buildMeasuredValues(rows.value),
      boardCardId: props.item.boardCardId ?? null,
      note: noteText.value.trim() ? noteText.value.trim() : null,
      measuredByUsername: selectedUsername.value && selectedUsername.value.trim().length
        ? selectedUsername.value.trim()
        : null
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <EntityEditorDialog
    :is-open="modelValue"
    entity-label="měření"
    mode="edit"
    :saving="isSaving"
    :deletable="true"
    :width="'920px'"
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
        title="Předchozí (←/K)"
        @click="() => emits('prev')"
      />
      <v-btn
        icon="mdi-chevron-down"
        variant="text"
        title="Další (→/J)"
        @click="() => emits('next')"
      />
    </template>

    <div class="section-toggle-bar mb-3 d-flex align-center ga-2">
      <v-btn
        size="x-small"
        variant="tonal"
        :color="metaCollapsed ? '' : 'primary'"
        @click="toggleMeta"
      >
        Meta
      </v-btn>
      <v-btn
        size="x-small"
        variant="tonal"
        :color="valuesCollapsed ? '' : 'primary'"
        @click="toggleValues"
      >
        Hodnoty
      </v-btn>
      <v-btn
        size="x-small"
        variant="tonal"
        :color="statsCollapsed ? '' : 'primary'"
        @click="toggleStats"
      >
        Statistika
      </v-btn>
    </div>

    <div
      class="detail-scroll"
      style="height:720px; overflow:auto; padding-right:4px;"
    >
      <div
        v-if="item"
        class="mb-3"
      >
        <div
          class="d-flex align-center mb-2"
          style="gap:4px"
        >
          <v-icon
            size="16"
            color="grey-darken-2"
          >
            mdi-information-outline
          </v-icon>
          <span class="text-caption text-medium-emphasis">Metadata měření</span>
          <v-spacer />
          <v-btn
            size="x-small"
            variant="text"
            :icon="metaCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
            @click="toggleMeta"
          />
        </div>
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
      </div>

      <div
        class="text-subtitle-2 mb-2 d-flex align-center"
        style="gap:6px;"
      >
        <span>Upravit hodnoty</span>
        <v-spacer />
        <v-btn
          size="x-small"
          variant="text"
          :icon="valuesCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
          @click="toggleValues"
        />
      </div>
      <div v-show="!valuesCollapsed">
        <div class="grid header-row">
          <div class="cell muted">
            Poř.č.
          </div>
          <div class="cell muted">
            Název pole
          </div>
          <div class="cell muted">
            Vstupní prvek
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
          >
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

            <div class="cell name name-with-chip">
              <span class="name-text">{{ row.name }}</span>
              <div class="cell value">
                <div
                  v-if="!isExpanded(row)"
                  class="text-medium-emphasis"
                  style="padding: 6px 0;"
                >
                  {{ previewValue(row) }}
                </div>
                <v-chip
                  v-show="isExpanded(row)"
                  color="primary"
                  variant="tonal"
                  class="type-chip"
                >
                  {{ TYPE_LABEL[row.type] }}
                </v-chip>
              </div>
            </div>

            <div class="cell value">
              <template v-if="isExpanded(row)">
                <v-switch
                  v-if="row.type === 'bool'"
                  :model-value="row.value === true"
                  color="deep-purple"
                  hide-details
                  inset
                  density="comfortable"
                  @update:model-value="val => updateRowValue(row, val)"
                />
                <v-text-field
                  v-else-if="row.type === 'int'"
                  v-show="isExpanded(row)"
                  :model-value="row.value as string | number | null | undefined"
                  type="text"
                  inputmode="numeric"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  placeholder="123"
                  @update:model-value="val => updateRowValue(row, val)"
                />
                <v-text-field
                  v-else-if="row.type === 'float'"
                  v-show="isExpanded(row)"
                  :model-value="row.value as string | number | null | undefined"
                  type="text"
                  inputmode="decimal"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  placeholder="123,45"
                  @update:model-value="val => updateRowValue(row, val)"
                />
                <v-text-field
                  v-else-if="row.type === 'date'"
                  v-show="isExpanded(row)"
                  :model-value="false ? new Date(row.value as number).toISOString().slice(0,10) : (row.value as string | null | undefined)"
                  type="date"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  @update:model-value="val => updateRowValue(row, val)"
                />
                <v-file-input
                  v-else-if="row.type === 'file'"
                  v-show="isExpanded(row)"
                  :model-value="row.value as File | null | undefined"
                  density="comfortable"
                  hide-details="auto"
                  variant="outlined"
                  accept="image/*,.csv,.txt,.pdf"
                  show-size
                  @update:model-value="val => updateRowValue(row, (Array.isArray(val) ? val[0] : val))"
                />
                <v-text-field
                  v-else
                  :model-value="row.value as string | number | null | undefined"
                  type="text"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  placeholder="Text…"
                  @update:model-value="val => updateRowValue(row, val)"
                />
              </template>
            </div>

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

      <div
        class="text-subtitle-2 mt-6 mb-2 d-flex align-center"
        style="gap:6px;"
      >
        <span>Vizualizace / Statistika</span>
        <v-spacer />
        <v-btn
          size="x-small"
          variant="text"
          :icon="statsCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
          @click="toggleStats"
        />
      </div>
      <v-sheet
        v-show="!statsCollapsed"
        elevation="1"
        class="pa-4 rounded-lg"
      >
        <div
          class="d-flex align-center mb-3"
          style="gap: 8px; flex-wrap: wrap;"
        >
          <div class="text-caption mr-2">
            Numerická pole:
          </div>
          <div
            class="d-flex align-center"
            style="gap: 6px; flex-wrap: wrap;"
          >
            <v-chip
              v-for="(f, i) in numericFieldNames"
              :key="`${f}-${i}`"
              :color="selectedField === f ? 'primary' : undefined"
              variant="tonal"
              size="small"
              @click="onSelectField(f)"
            >
              {{ f }}
            </v-chip>
            <v-chip
              v-if="numericFieldNames.length > 1"
              :color="!selectedField ? 'primary' : undefined"
              variant="tonal"
              size="small"
              @click="selectedField = null"
            >
              Vše
            </v-chip>
          </div>

          <v-spacer />
          <v-btn
            size="small"
            variant="text"
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
    </div>
  </EntityEditorDialog>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 56px 1fr minmax(220px, 1.5fr) 80px;
  gap: 8px;
  align-items: center;
}
.header-row { padding: 6px 6px 8px 6px; }
.data-row { padding: 6px; border-radius: 8px; }
.cell.muted { color: rgba(0,0,0,0.54); font-size: 0.9rem; }
.cell.index { text-align: center; color: rgba(0,0,0,0.54); }
.cell.right { text-align: right; }
.name-with-chip { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type-chip { font-weight: 600; letter-spacing: .02em; text-transform: none; }
.detail-scroll { box-sizing: border-box; }
</style>
