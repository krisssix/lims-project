<template>
  <Dialog v-model:is-open="open" width="1000px" :hide-footer="true">
    <template #content>
      <div class="pa-4" @keydown="onKeydown">
        <div class="text-h6 mb-3">Vložení šablony ze schránky</div>

        <!-- Header row: name + device + actions -->
        <div class="d-flex align-center ga-3 mb-3">
          <v-text-field
            v-model="templateName"
            label="Název šablony"
            density="comfortable"
            variant="outlined"
            hide-details
            class="flex-grow-1"
          />
          <v-select
            v-model="deviceCode"
            :items="devices"
            item-title="name"
            item-value="id"
            label="Přístroj"
            density="comfortable"
            variant="outlined"
            hide-details
            style="max-width: 220px"
          >
            <template #selection="{ item }">
              <v-chip size="small" :color="item.raw?.color" text-color="white">
                {{ item.raw?.id }}
              </v-chip>
            </template>
          </v-select>

          <v-btn variant="tonal" color="primary" title="Vložit ze schránky (Ctrl+V)" @click="pasteFromClipboard">
            VLOŽIT ZE SCHRÁNKY
          </v-btn>
          <v-btn variant="tonal" color="primary" title="Vybrat soubor (Ctrl+O)" @click="triggerFilePick">
            VYBRAT SOUBOR
          </v-btn>
          <input
            ref="fileInput"
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            style="display:none"
            @change="onFilePicked"
          />
          <v-btn variant="text" class="ml-2" title="Analyzovat (Ctrl+Enter)" @click="runAnalysis">
            ANALYZOVAT
          </v-btn>
        </div>

        <!-- Raw input -->
        <v-textarea
          v-model="rawText"
          data-clipboard-input
          label="Schránka (tab/CSV; první řádek hlavička)"
          :rows="6"
          :auto-grow="false"
          variant="outlined"
          density="comfortable"
          hide-details
          class="mb-3 clipboard-textarea"
        />

        <!-- Info -->
        <v-alert v-if="!blocks.length" type="info" density="comfortable" variant="tonal" class="mb-3">
          Vlož hlavičky (případně i s daty) a klikni “ANALYZOVAT” nebo stiskni Ctrl+Enter.
        </v-alert>

        <!-- Block select and options -->
        <div v-else class="d-flex align-center ga-3 mb-3">
          <v-select
            v-model="selectedBlockIndex"
            :items="blockItems"
            item-title="label"
            item-value="value"
            label="Vybrat blok vstupu"
            density="comfortable"
            variant="outlined"
            hide-details
            style="min-width: 220px"
          />
          <v-switch
            v-if="selectedBlock?.kind === 'table'"
            v-model="includeRepeatSets"
            label="Rozbalit opakované sady"
            density="comfortable"
          />
          <v-spacer />
          <v-btn variant="text" title="Znovu analyzovat (Ctrl+Enter)" @click="runAnalysis">ANALYZOVAT</v-btn>
        </div>

        <!-- Preview: table -->
        <div v-if="selectedBlock?.kind === 'table'" class="mb-3">
          <div class="d-flex align-center ga-3 mb-2">
            <v-switch
              v-model="headerOverrideEnabled"
              label="Vybrat jinou hlavičku (Alt+H)"
              density="comfortable"
            />
            <v-select
              v-if="headerOverrideEnabled"
              v-model="headerOverrideIndex"
              :items="headerOverrideOptions"
              item-title="label"
              item-value="value"
              label="Řádek pro hlavičku"
              density="comfortable"
              variant="outlined"
              hide-details
              style="min-width: 260px"
            />
          </div>

          <div class="preview-sample" style="max-height:220px; overflow:auto; border:1px solid #ececec; padding:8px; border-radius:6px; background:#fff">
            <div style="font-weight:700; margin-bottom:6px;">Hlavičky</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap">
              <v-chip
                v-for="(h, idx) in effectiveHeaders"
                :key="`hdr-${idx}`"
                size="small"
              >{{ h }}</v-chip>
            </div>
            <div style="margin-top:8px;">
              <div
                v-for="(r, ri) in (selectedBlock.rows.slice(0, 6))"
                :key="`row-${ri}`"
                style="font-family: monospace; white-space:pre;"
              >
                {{ r.join(' | ') }}
              </div>
            </div>
          </div>
        </div>

        <!-- Preview: metadata (kv) -->
        <div v-else-if="selectedBlock?.kind === 'kv'" class="mb-3">
          <div class="preview-header mb-2">Metadata (key:value)</div>
          <v-list density="compact">
            <v-list-item v-for="(p, i) in (selectedBlock.pairs)" :key="`kv-${i}`">
              <v-list-item-title>
                <strong>{{ p.key }}</strong>: {{ p.value }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
          <div class="d-flex ga-2">
            <v-btn color="primary" variant="tonal" @click="addMetadataAsFields">PŘIDAT METADATA JAKO POLE</v-btn>
          </div>
        </div>

        <!-- Preview: stats/series -->
        <div v-else-if="selectedBlock?.kind === 'stats'" class="mb-3">
          <div class="preview-header mb-2">Statistické řádky</div>
          <div class="mono-block">
            <div v-for="(l, i) in selectedBlock.lines" :key="`st-${i}`" class="mono-line">{{ l }}</div>
          </div>
        </div>
        <div v-else-if="selectedBlock?.kind === 'series'" class="mb-3">
          <div class="preview-header mb-2">Řada hodnot</div>
          <div class="mono-block">
            <div>{{ selectedBlock.header }}</div>
            <div class="mono-line">{{ selectedBlock.values.slice(0, 40).join(', ') }}{{ selectedBlock.values.length > 40 ? ' …' : '' }}</div>
          </div>
        </div>

        <!-- Editable template fields -->
        <div class="d-flex align-center ga-2 mb-2" v-if="selectedBlock">
          <v-btn size="small" color="primary" variant="tonal" @click="addField">PŘIDAT POLE (Alt+N)</v-btn>
          <v-spacer />
        </div>

        <div v-if="fieldRows.length" class="mb-3">
          <v-data-table
            :items="fieldRows"
            :headers="tableHeaders"
            class="elevation-1"
            density="comfortable"
            hide-default-footer
            item-key="orderIndex"
          >
            <template #item.orderIndex="{ item }">
              <span class="text-body-2">{{ item.orderIndex }}</span>
            </template>

            <template #item.type="{ item }">
              <v-select
                v-model="item.type"
                :items="typeOptions"
                item-title="label"
                item-value="value"
                density="compact"
                hide-details
                variant="plain"
              />
            </template>

            <template #item.required="{ item }">
              <v-checkbox v-model="item.required" density="compact" hide-details />
            </template>

            <template #item.name="{ item }">
              <v-text-field
                v-model="item.name"
                density="compact"
                hide-details
                variant="plain"
                :placeholder="`Pole ${item.orderIndex}`"
              />
            </template>

            <template #item.actions="{ index }">
              <div class="d-flex ga-1">
                <v-btn icon="mdi-chevron-up" size="x-small" variant="text" @click="moveField(index, -1)" />
                <v-btn icon="mdi-chevron-down" size="x-small" variant="text" @click="moveField(index, 1)" />
                <v-btn icon="mdi-delete-outline" size="x-small" variant="text" color="error" @click="removeField(index)" />
              </div>
            </template>
          </v-data-table>
        </div>

        <!-- Footer actions -->
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="cancel">Zrušit (Esc)</v-btn>
          <v-btn color="primary" :disabled="!deviceCode || !fieldRows.length" :loading="loading" @click="confirm">
            Vytvořit šablonu (Ctrl+Enter)
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import {
  analyzeClipboard,
  type ColumnType,
  type AnalyzeResult,
  type TableBlock,
  type StatsBlock,
  type SeriesBlock,
  type KvBlock,
  buildRepeatMetaFromHeaders,
  inferFieldType as inferFieldTypeFromParser
} from '@/utils/importParsing'

type DeviceItem = { id: string; name: string; color?: string }
type FieldType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
type FieldRow = { orderIndex: number; type: FieldType; required: boolean; name: string }

const props = defineProps<{
  modelValue: boolean
  devices: DeviceItem[]
  onConfirm?: (payload: {
    deviceCode: string
    templateName: string
    fields: FieldRow[]
  }) => Promise<void> | void
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', payload: {
    deviceCode: string
    templateName: string
    fields: FieldRow[]
  }): void
}>()

/* --------------------- state --------------------- */
const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const deviceCode = ref<string>('')
const templateName = ref<string>('Nová šablona')
const rawText = ref<string>('')

const blocks = ref<Array<TableBlock | StatsBlock | SeriesBlock | KvBlock>>([])
const selectedBlockIndex = ref<number | null>(null)
const includeRepeatSets = ref<boolean>(false)

const headerOverrideEnabled = ref<boolean>(false)
const headerOverrideIndex = ref<number | null>(null)

const fileInput = ref<HTMLInputElement | null>(null)
const loading = ref(false)

/* --------------------- editable fields --------------------- */
const fieldRows = ref<FieldRow[]>([])

const typeOptions: Array<{ label: string; value: FieldType }> = [
  { label: 'Float', value: 'float' },
  { label: 'Integer', value: 'int' },
  { label: 'Text', value: 'text' },
  { label: 'Soubor', value: 'file' },
  { label: 'Boolean', value: 'bool' },
  { label: 'Date', value: 'date' },
]

const tableHeaders = [
  { title: 'Poř.', key: 'orderIndex', sortable: false, width: 70 },
  { title: 'Typ', key: 'type', sortable: false, width: 160 },
  { title: 'Povinné', key: 'required', sortable: false, width: 120 },
  { title: 'Název pole', key: 'name', sortable: false },
  { title: '', key: 'actions', sortable: false, width: 112 }
]

/* --------------------- lifecycle --------------------- */
watch(open, async (v) => {
  if (v) {
    deviceCode.value = props.devices[0]?.id ?? ''
    templateName.value = 'Nová šablona'
    rawText.value = ''
    blocks.value = []
    selectedBlockIndex.value = null
    includeRepeatSets.value = false
    fieldRows.value = []
    headerOverrideEnabled.value = false
    headerOverrideIndex.value = null
    await nextTick()
    const el = document.querySelector<HTMLTextAreaElement>('[data-clipboard-input]')
    el?.focus()
  }
})

/* --------------------- actions --------------------- */
async function pasteFromClipboard(): Promise<void> {
  try {
    const txt = await navigator.clipboard.readText()
    rawText.value = txt
    runAnalysis()
  } catch {
    /* ignore */
  }
}

function triggerFilePick(): void { fileInput.value?.click() }
function onFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = reader.result
    if (typeof result === 'string') {
      rawText.value = result
      runAnalysis()
    }
    input.value = ''
  }
  reader.readAsText(f)
}

function toFieldType(t: ColumnType): FieldType {
  if (t === 'float' || t === 'int' || t === 'text' || t === 'file' || t === 'bool' || t === 'date') return t
  return 'text'
}

/* Build editable field rows from the currently selected block or overrides */
function rebuildFieldRows(): void {
  const blk = selectedBlock.value
  if (!blk) { fieldRows.value = []; return }

  // Determine effective header names
  let headerNames: string[] = []

  if (blk.kind === 'table') {
    const tbl = blk as TableBlock
    const baseHeaders = headerOverrideEnabled.value && headerOverrideIndex.value != null
      ? (tbl.rows[headerOverrideIndex.value] ?? [])
      : tbl.headersRaw

    const headers = baseHeaders.slice()
    if (!headers.length) { fieldRows.value = []; return }

    if (!includeRepeatSets.value) {
      // collapse repeated bases → keep first occurrence
      const seen = new Set<string>()
      const baseOf = (h: string) => h.trim().replace(/\s+\d+$/u, '')
      const out: string[] = []
      for (const h of headers) {
        const base = baseOf(h) || h
        if (seen.has(base)) continue
        seen.add(base)
        out.push(base || h)
      }
      headerNames = out
    } else {
      const rep = buildRepeatMetaFromHeaders(headers)
      if (!rep.repeatDetected) headerNames = headers
      else {
        const counters: Record<string, number> = {}
        const baseOf = (h: string) => h.trim().replace(/\s+\d+$/u, '')
        headerNames = headers.map((h) => {
          const base = baseOf(h) || h
          counters[base] = (counters[base] ?? 0) + 1
          const idx = counters[base]
          return `${base} ${idx}`
        })
      }
    }
  } else if (blk.kind === 'series') {
    headerNames = [blk.header?.trim() || 'Value']
  } else if (blk.kind === 'kv') {
    // do not auto-push; handled via "PŘIDAT METADATA JAKO POLE"
    headerNames = []
  } else {
    headerNames = ['Value']
  }

  const newRows: FieldRow[] = headerNames.map((h, i) => ({
    orderIndex: i + 1,
    name: h || `Col ${i + 1}`,
    required: i === 0 ? false : false,
    type: toFieldType(inferFieldTypeFromHeader(h)),
  }))
  fieldRows.value = newRows
}

function runAnalysis(): void {
  const a: AnalyzeResult = analyzeClipboard(rawText.value)
  blocks.value = a.blocks as Array<TableBlock | StatsBlock | SeriesBlock | KvBlock>
  if (a.headersRaw && a.headersRaw.length && templateName.value === 'Nová šablona') {
    templateName.value = a.headersRaw[0] ?? templateName.value
  }
  // Prefer first TABLE block; fallback to first block
  let idx = blocks.value.findIndex(b => b.kind === 'table')
  if (idx < 0) idx = blocks.value.length ? 0 : -1
  selectedBlockIndex.value = idx >= 0 ? idx : null
  headerOverrideEnabled.value = false
  headerOverrideIndex.value = null
  rebuildFieldRows()
}

/* --------------------- computed --------------------- */
const selectedBlock = computed<TableBlock | StatsBlock | SeriesBlock | KvBlock | null>(() => {
  if (selectedBlockIndex.value == null) return null
  return blocks.value[selectedBlockIndex.value] ?? null
})
const blockItems = computed(() =>
  blocks.value.map((b, i) => ({
    label: `${i + 1}. ${b.kind === 'table' ? 'tabulka' : (b.kind === 'stats' ? 'statistika' : (b.kind === 'kv' ? 'metadata' : 'řada'))}`,
    value: i
  }))
)

const headerOverrideOptions = computed(() => {
  const blk = selectedBlock.value
  if (!blk || blk.kind !== 'table') return []
  const rows = blk.rows
  const items: Array<{ label: string; value: number | null }> = [
    { label: 'Rozpoznaná hlavička', value: null }
  ]
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const sample = (rows[i] ?? []).slice(0, 6).join(' | ')
    items.push({ label: `Řádek ${i + 1}: ${sample}`, value: i })
  }
  return items
})
const effectiveHeaders = computed<string[]>(() => {
  const blk = selectedBlock.value
  if (!blk || blk.kind !== 'table') return []
  if (headerOverrideEnabled.value && headerOverrideIndex.value != null) {
    return (blk.rows[headerOverrideIndex.value] ?? []).map(s => (s ?? '').trim())
  }
  return blk.headersRaw
})

watch([selectedBlockIndex, includeRepeatSets, headerOverrideEnabled, headerOverrideIndex], () => { rebuildFieldRows() })

/* --------------------- confirm/cancel --------------------- */
async function confirm(): Promise<void> {
  if (!deviceCode.value || !fieldRows.value.length) return
  loading.value = true
  try {
    const payload = {
      deviceCode: deviceCode.value,
      templateName: (templateName.value || '').trim() || 'Šablona',
      fields: fieldRows.value.map((f, i) => ({
        orderIndex: i + 1,
        name: f.name.trim() || `Pole ${i + 1}`,
        required: Boolean(f.required),
        type: f.type
      }))
    }
    if (typeof props.onConfirm === 'function') {
      await Promise.resolve(props.onConfirm(payload))
    } else {
      emit('confirm', payload)
    }
    open.value = false
  } finally {
    loading.value = false
  }
}
function cancel(): void { open.value = false }

/* --------------------- hotkeys --------------------- */
function onKeydown(e: KeyboardEvent): void {
  const key = e.key.toLowerCase()
  if (key === 'escape') { e.preventDefault(); cancel(); return }
  if ((e.ctrlKey || e.metaKey) && key === 'v') { e.preventDefault(); void pasteFromClipboard(); return }
  if ((e.ctrlKey || e.metaKey) && key === 'enter') { e.preventDefault(); runAnalysis(); return }
  if ((e.ctrlKey || e.metaKey) && key === 'o') { e.preventDefault(); triggerFilePick(); return }
  if (e.altKey && key === 'h') { e.preventDefault(); headerOverrideEnabled.value = !headerOverrideEnabled.value; return }
  if (e.altKey && key === 'n') { e.preventDefault(); addField(); return }
  if (e.altKey && (key === 'backspace' || key === 'delete')) { e.preventDefault(); removeField(fieldRows.value.length - 1); return }
  if (e.altKey && key === 'arrowup') { e.preventDefault(); moveField(fieldRows.value.length - 1, -1); return }
  if (e.altKey && key === 'arrowdown') { e.preventDefault(); moveField(fieldRows.value.length - 1, 1); return }
}

/* --------------------- helpers --------------------- */
function inferFieldTypeFromHeader(header: string): ColumnType {
  // consistent heuristic with parser
  return inferFieldTypeFromParser(header, header)
}

/* metadata → fields */
function addMetadataAsFields(): void {
  const blk = selectedBlock.value
  if (!blk || blk.kind !== 'kv') return
  const baseIndex = fieldRows.value.length
  const rowsToAdd: FieldRow[] = blk.pairs.map((p, i) => ({
    orderIndex: baseIndex + i + 1,
    name: p.key,
    required: false,
    type: inferTypeFromSample(p.value)
  }))
  fieldRows.value = [...fieldRows.value, ...rowsToAdd]
}

/* ad-hoc value-based inference for metadata values */
function inferTypeFromSample(sample: string): FieldType {
  const s = (sample ?? '').trim()
  if (!s) return 'text'
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(s) || /^\d{1,2}\.\d{1,2}\.\s*\d{4}(?:\s+\d{1,2}:\d{2}:\d{2})?$/.test(s)) return 'date'
  if (/^(true|false|1|0|yes|no|y|n|ano|ne|t|f)$/i.test(s)) return 'bool'
  if (/\.(png|jpg|jpeg|tif|tiff|gif|csv|tsv|txt|pdf|xlsx)$/i.test(s) || /^(https?|s3|file):\/\//i.test(s)) return 'file'
  const num = Number(s.replace(',', '.'))
  if (Number.isFinite(num)) {
    return Number.isInteger(num) ? 'int' : 'float'
  }
  return 'text'
}

/* field row ops */
function addField(): void {
  fieldRows.value = [
    ...fieldRows.value,
    {
      orderIndex: fieldRows.value.length + 1,
      name: '',
      required: false,
      type: 'text'
    }
  ]
}
function removeField(index: number): void {
  if (index < 0 || index >= fieldRows.value.length) return
  fieldRows.value.splice(index, 1)
  // reindex
  fieldRows.value = fieldRows.value.map((f, i) => ({ ...f, orderIndex: i + 1 }))
}
function moveField(index: number, delta: number): void {
  const target = index + delta
  if (index < 0 || index >= fieldRows.value.length) return
  if (target < 0 || target >= fieldRows.value.length) return
  const arr = fieldRows.value.slice()
  const [row] = arr.splice(index, 1)
  arr.splice(target, 0, row)
  fieldRows.value = arr.map((f, i) => ({ ...f, orderIndex: i + 1 }))
}
</script>

<style scoped>
.clipboard-textarea :deep(textarea) {
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
}
.preview-header { font-weight: 600; }
.mono-block { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; background:#fff; padding:8px; border:1px solid #e3e3e3; border-radius:6px; max-height:160px; overflow:auto; }
.mono-line { font-family: inherit; white-space: nowrap; font-size: 12px; }
</style>
