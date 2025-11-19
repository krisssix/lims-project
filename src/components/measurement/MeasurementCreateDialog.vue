<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Dialog from '@/components/Dialog.vue'
import { type DeviceItem, type TemplateItem, type ValueRow, type ValueType } from '@/types/measurement-ui'
import { type MeasurementRequest, type MeasuredValue } from '@/stores/measurement'

function onKeydownInt(e: KeyboardEvent) {
  allowNumberKeypress(e, true)
}
function onKeydownFloat(e: KeyboardEvent) {
  allowNumberKeypress(e, false)
}

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

// dialog internal state
const step = ref<1|2>(1)
const saving = ref(false)

function fileModel(row: ValueRow): File | null {
  const v = row.value
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : (v as File)
}


const selectedDevice = ref<string>('')
const selectedTemplateId = ref<string | null>(null)
const TYPE_LABEL: Record<ValueType, string> = { float:'Float', int:'Integer', text:'Text', file:'Image', bool:'Boolean', date:'Date' }


const valuesRows = ref<ValueRow[]>([])
const focusedIndex = ref<number | null>(null)
const inputEls = ref<(HTMLInputElement | HTMLTextAreaElement | null)[]>([])
const expandedRows = ref<Set<string>>(new Set())
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
    if ('selectionStart' in el) {
      const inp = el as HTMLInputElement | HTMLTextAreaElement
      const len = inp.value.length
      inp.setSelectionRange(len, len)
    }
    focusedIndex.value = idx
  }
}

/* ---------- Helpers for initialization ---------- */
function initDialog() {
  // Always show metadata step on open (consistent behavior)
  step.value = 1
  // Choose first device by default if available
  selectedDevice.value = props.devices.length ? props.devices[0].id : ''
  // clear selected template and value rows -> user must choose template to proceed
  selectedTemplateId.value = null
  valuesRows.value = []
  focusedIndex.value = null
  inputEls.value = []
  expandedRows.value = new Set()
}

function close() { emits('update:modelValue', false) }

function goToStep2() {
  const id = selectedTemplateId.value
  if (!id) return
  const tpl = props.templateById.get(id)
  const now = Date.now()
  valuesRows.value = (tpl?.fields ?? []).map((f, i) => ({
    id: `${f.id || 'f'}-${i}-${now}`,
    order: i + 1,
    name: f.name,
    type: f.type,
    required: f.required,
    value: f.type === 'file' ? null : (f.type === 'bool' ? null : '')
  }))
  // expand all by default to keep current UX
  expandedRows.value = new Set(valuesRows.value.map(r => r.id))
  step.value = 2
  nextTick(() => focusInput(0))
}

/* ---------- Value parsing & helpers (unchanged) ---------- */
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
  const allowedControl = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab']
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
    case 'int': return parseNumber(row.value, true) !== null ? null : 'Neplaté celé číslo'
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
const canSave = computed(() => valuesRows.value.every(v => !valueError(v)))

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
      const n = parseNumber(v, row.type === 'int')
      return n == null ? '—' : String(n)
    }
    case 'bool': {
      const b = normalizeBool(v)
      return b == null ? '—' : (b ? 'Ano' : 'Ne')
    }
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

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text) return
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
  } catch (e) { console.warn('Clipboard read failed', e) }
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
      case 'bool':
        return { ...base, boolValue: normalizeBool(r.value) }
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

async function onSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    const firstNumeric = valuesRows.value
      .filter(v => v.type === 'float' || v.type === 'int')
      .map(v => parseNumber(v.value, v.type === 'int'))
      .find(n => Number.isFinite(n as number))

    const id = selectedTemplateId.value
    if (!id) return
    const tpl = props.templateById.get(id)
    if (!tpl) return

    const payload: MeasurementRequest = {
      value: Number.isFinite(firstNumeric as number) ? (firstNumeric as number) : 0,
      type: tpl.name,
      unit: selectedDevice.value,
      timestamp: Date.now(),
      values: buildMeasuredValues(valuesRows.value),
    }
    emits('save', payload)
  } finally {
    saving.value = false
  }
}

/* ---------- Watch for prop open/close and initialize ---------- */
watch(() => props.modelValue, (v) => {
  if (v) {
    // parent opened dialog -> initialize to metadata step
    initDialog()
    // focus first control after nextTick
    nextTick(() => {
      // no direct focus target at metadata step, but we can focus first select (if exists)
      if (inputEls.value[0]) inputEls.value[0].focus()
    })
  } else {
    // closed -> keep internal state but we already reset on next open
  }
})
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
      <div class="text-h6">
        Vytvoření nového měření
      </div>
    </template>

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
            v-model="selectedDevice"
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

      <div class="mt-2">
        <v-alert
          type="info"
          variant="tonal"
          density="comfortable"
        >
          Nemáte k dispozici potřebnou šablonu?
          <v-btn
            variant="text"
            color="primary"
            class="ml-1 px-1"
            @click="() => emits('createTemplate')"
          >
            Vytvořte si ji.
          </v-btn>
        </v-alert>
      </div>
    </template>

    <template
      v-else
      #content
    >
      <div class="text-subtitle-2 mb-3">
        Primární data
      </div>

      <slot name="above-values" />

      <div class="d-flex ga-2 mb-3">
        <v-btn
          size="small"
          color="primary"
          variant="tonal"
          @click="pasteFromClipboard"
        >
          VLOŽIT ZE SCHRÁNKY (Ctrl+V)
        </v-btn>
      </div>

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
          v-for="(row, idx) in valuesRows"
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
            <div
              v-if="!isExpanded(row)"
              class="text-medium-emphasis"
              style="padding: 6px 0;"
            >
              {{ previewValue(row) }}
            </div>
            <v-switch
              v-if="row.type === 'bool'"
              v-show="isExpanded(row)"
              :model-value="row.value === true"
              color="deep-purple"
              hide-details
              inset
              density="comfortable"
              @focus="focusedIndex = idx"
              @blur="focusedIndex = (focusedIndex === idx ? null : focusedIndex)"
              @update:model-value="val => updateRowValue(row, val)"
            />

            <v-text-field
              v-else-if="row.type === 'int'"
              v-show="isExpanded(row)"
              :ref="(el) => setInputRef(idx, el)"
              :model-value="row.value"
              :color="focusedIndex === idx ? 'deep-purple' : undefined"
              type="text"
              inputmode="numeric"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              placeholder="123"
              :autofocus="idx === 0"
              @focus="focusedIndex = idx"
              @keydown="onKeydownInt"
              @update:model-value="val => updateRowValue(row, val)"
            />

            <v-text-field
              v-else-if="row.type === 'float'"
              v-show="isExpanded(row)"
              :ref="(el) => setInputRef(idx, el)"
              :model-value="row.value"
              :color="focusedIndex === idx ? 'deep-purple' : undefined"
              type="text"
              inputmode="decimal"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              placeholder="123,45"
              :autofocus="idx === 0"
              @focus="focusedIndex = idx"
              @keydown="onKeydownFloat"
              @update:model-value="val => updateRowValue(row, val)"
            />

            <v-text-field
              v-else-if="row.type === 'date'"
              v-show="isExpanded(row)"
              :ref="(el) => setInputRef(idx, el)"
              :model-value="typeof row.value === 'number'
                ? new Date(row.value).toISOString().slice(0, 10)
                : row.value"
              :color="focusedIndex === idx ? 'deep-purple' : undefined"
              type="date"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              @focus="focusedIndex = idx"
              @update:model-value="val => updateRowValue(row, val)"
            />

            <v-file-input
              v-else-if="row.type === 'file'"
              v-show="isExpanded(row)"
              :ref="(el) => setInputRef(idx, el)"
              :model-value="fileModel(row)"
              :color="focusedIndex === idx ? 'deep-purple' : undefined"
              density="comfortable"
              hide-details="auto"
              variant="outlined"
              accept="image/*,.csv,.txt,.pdf"
              show-size
              @focus="focusedIndex = idx"
              @update:model-value="val => updateRowValue(row, Array.isArray(val) ? val[0] : val)"
            />

            <v-text-field
              v-else
              v-show="isExpanded(row)"
              :ref="(el) => setInputRef(idx, el)"
              :model-value="row.value"
              :color="focusedIndex === idx ? 'deep-purple' : undefined"
              type="text"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              placeholder="Text…"
              :autofocus="idx === 0"
              @focus="focusedIndex = idx"
              @update:model-value="val => updateRowValue(row, val)"
            />
          </div>
        </div>
      </transition-group>
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
.grid { display: grid; grid-template-columns: 56px 1fr minmax(220px, 1.5fr); gap: 8px; align-items: center; }
.header-row { padding: 6px 6px 8px 6px; }
.data-row { padding: 6px; border-radius: 8px; }
.data-row:hover { background: #fbfcff; }
.cell.muted { color: rgba(0,0,0,0.54); font-size: 0.9rem; }
.cell.index { text-align: center; color: rgba(0,0,0,0.54); }
.name-with-chip { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type-chip { font-weight: 600; letter-spacing: .02em; text-transform: none; }
</style>
