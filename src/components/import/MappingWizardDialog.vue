<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Dialog from '@/components/Dialog.vue'
import type { MappingModel } from '@/utils/import/importMapping'
import { validateMapping, exportMapping } from '@/utils/import/importMapping'
import { isEditableElement } from '@/components/ui/hotkeyGuard'

const props = defineProps<{
  modelValue: boolean
  mappingModel: MappingModel | null
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'applyMapping', payload: ReturnType<typeof exportMapping>): void
  (e: 'deriveTemplate', payload: { newTemplateName: string; extraColumns: Array<{ name: string; headerIndex: number }> }): void
}>()

const open = computed<boolean>({
  get: () => props.modelValue,
  set: v => emits('update:modelValue', v)
})

const activeBlockIndex = ref<number>(1)
const showUnmatchedOnly = ref<boolean>(false)
const validationErrors = ref<string[]>([])
const lastFocusedFieldPos = ref<number>(-1)

// Field selection state - track which fields are enabled for import
const enabledFields = ref<Set<string>>(new Set())
const lastClickedFieldId = ref<string | null>(null)

// Initialize enabled fields when mapping model changes
watch(() => props.mappingModel, () => {
  if (props.mappingModel) {
    // By default, all fields are enabled
    const allIds = new Set<string>()
    for (const b of props.mappingModel.blocks) {
      for (const f of b.fields) {
        allIds.add(f.id)
      }
    }
    enabledFields.value = allIds
  }
}, { immediate: true })

function toggleFieldEnabled(fieldId: string, event?: MouseEvent): void {
  const isShift = event?.shiftKey ?? false
  
  if (isShift && lastClickedFieldId.value && props.mappingModel) {
    // Shift+click: toggle range
    const allFieldIds: string[] = []
    for (const b of props.mappingModel.blocks) {
      for (const f of b.fields) {
        allFieldIds.push(f.id)
      }
    }
    
    const startIdx = allFieldIds.indexOf(lastClickedFieldId.value)
    const endIdx = allFieldIds.indexOf(fieldId)
    if (startIdx >= 0 && endIdx >= 0) {
      const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
      // Determine target state based on the clicked item's NEW state (inverse of current)
      // Actually standard shift-select usually syncs to the clicked item's target state.
      // If we are clicking fieldId, we invert it.
      const targetState = !enabledFields.value.has(fieldId)
      
      for (let i = from; i <= to; i++) {
        const id = allFieldIds[i]
        if (targetState) {
          enabledFields.value.add(id)
        } else {
          enabledFields.value.delete(id)
        }
      }
    }
  } else {
    // Regular click: toggle single field
    if (enabledFields.value.has(fieldId)) {
      enabledFields.value.delete(fieldId)
    } else {
      enabledFields.value.add(fieldId)
    }
  }
  
  lastClickedFieldId.value = fieldId
  // Force reactivity update for Set
  enabledFields.value = new Set(enabledFields.value)
  recomputeValidation()
}

function toggleAllFields(enable: boolean): void {
  if (!props.mappingModel) return
  const newSet = new Set<string>()
  if (enable) {
    for (const b of props.mappingModel.blocks) {
      for (const f of b.fields) {
        newSet.add(f.id)
      }
    }
  }
  enabledFields.value = newSet
  recomputeValidation()
}

const enabledFieldsCount = computed(() => enabledFields.value.size)
const totalFieldsCount = computed(() => {
  if (!props.mappingModel) return 0
  return props.mappingModel.blocks.reduce((sum, b) => sum + b.fields.length, 0)
})

// Detect extra columns in imported data that aren't mapped to any template field or series
const extraColumns = computed<Array<{ blockIndex: number; headerIndex: number; headerName: string }>>(() => {
  if (!props.mappingModel) return []
  const extras: Array<{ blockIndex: number; headerIndex: number; headerName: string }> = []
  
  // Collect all indices used by fields
  const fieldUsedIndices = new Set<number>()
  for (const block of props.mappingModel.blocks) {
    for (const f of block.fields) {
      if (f.mappedSourceIndex != null) {
        fieldUsedIndices.add(f.mappedSourceIndex)
      }
    }
  }
  
  // Collect all indices used by series
  const seriesUsedIndices = new Set<number>()
  if (props.mappingModel.seriesBlocks) {
    for (const series of props.mappingModel.seriesBlocks) {
      for (const col of series.columns) {
        if (col.mappedSourceIndex != null) {
          seriesUsedIndices.add(col.mappedSourceIndex)
        }
      }
    }
  }
  
  // Known series column name patterns to exclude (case-insensitive)
  const seriesPatterns = [
    /^sizes?$/i, /^intensit/i, /^volumes?$/i, /^numbers?$/i,
    /\bsize\b/i, /\bintensity\b/i, /\bvolume\b/i, /\bnumber\b/i,
    /^x$/i, /^y$/i, /^c$/i, /^d$/i, // Common series axis names
    /percent/i, /\%/
  ]
  
  function isSeriesColumn(headerName: string): boolean {
    return seriesPatterns.some(pattern => pattern.test(headerName))
  }
  
  for (const block of props.mappingModel.blocks) {
    for (let i = 0; i < block.headers.length; i++) {
      const headerName = block.headers[i]
      // Skip if used by a field
      if (fieldUsedIndices.has(i)) continue
      // Skip if used by a series
      if (seriesUsedIndices.has(i)) continue
      // Skip if header matches known series patterns
      if (isSeriesColumn(headerName)) continue
      
      extras.push({
        blockIndex: block.blockIndex,
        headerIndex: i,
        headerName
      })
    }
  }
  return extras
})

// Emit derive template request - parent will open TemplateWizardDialog with these extra columns
function emitDeriveTemplate(): void {
  const cols = extraColumns.value.map(c => ({ 
    name: c.headerName, 
    headerIndex: c.headerIndex 
  }))
  
  emits('deriveTemplate', {
    newTemplateName: '', // Parent will generate name using TemplateWizardDialog's generateDerivedName
    extraColumns: cols
  })
}

function currentBlock() {
  return props.mappingModel?.blocks.find(b => b.blockIndex === activeBlockIndex.value) || null
}

function recomputeValidation(): void {
  if (props.mappingModel) {
    validationErrors.value = validateMapping(props.mappingModel, enabledFields.value)
  } else {
    validationErrors.value = []
  }
}

watch(() => props.mappingModel, () => {
  if (props.mappingModel?.blocks.length) {
    activeBlockIndex.value = props.mappingModel.blocks[0]!.blockIndex
  }
  recomputeValidation()
}, { immediate: true })

function setFieldMapping(fieldId: string, sourceIndex: number | null): void {
  if (!props.mappingModel) return
  for (const b of props.mappingModel.blocks) {
    const f = b.fields.find(ff => ff.id === fieldId)
    if (f) {
      f.mappedSourceIndex = sourceIndex
      f.headerMatched = sourceIndex != null &&
        sourceIndex >= 0 &&
        sourceIndex < b.headers.length &&
        b.headers[sourceIndex].trim().toLowerCase() === f.fieldName.trim().toLowerCase()
      break
    }
  }
  recomputeValidation()
}

function setSeriesColumnMapping(seriesIdx: number, columnId: string, sourceIndex: number | null): void {
  if (!props.mappingModel?.seriesBlocks) return
  const series = props.mappingModel.seriesBlocks[seriesIdx]
  if (!series) return
  
  const col = series.columns.find(c => c.id === columnId)
  if (col) {
    col.mappedSourceIndex = sourceIndex
    col.headerMatched = sourceIndex != null &&
      sourceIndex >= 0 &&
      sourceIndex < series.headers.length
  }
  recomputeValidation()
}


function cycleBlock(delta: number): void {
  if (!props.mappingModel) return
  const idxList = props.mappingModel.blocks.map(b => b.blockIndex).sort((a, b) => a - b)
  const pos = idxList.indexOf(activeBlockIndex.value)
  const nextPos = Math.min(idxList.length - 1, Math.max(0, pos + delta))
  activeBlockIndex.value = idxList[nextPos]
  lastFocusedFieldPos.value = -1
  nextTick(() => focusFieldByIndex(0))
}

function focusFieldByIndex(idx: number): void {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-map-field]')
    const el = els[idx]
    if (el) {
      el.focus()
      lastFocusedFieldPos.value = idx
    }
  })
}

function onApply(): void {
  if (!props.mappingModel) return
  recomputeValidation()
  if (validationErrors.value.length) return
  emits('applyMapping', exportMapping(props.mappingModel, enabledFields.value))
  open.value = false
}

function resetMappings(): void {
  if (!props.mappingModel) return
  for (const b of props.mappingModel.blocks) {
    for (const f of b.fields) {
      f.mappedSourceIndex = null
      f.headerMatched = false
    }
  }
  recomputeValidation()
}

function autoFillByName(): void {
  if (!props.mappingModel) return
  const usedIndices = new Set<number>()
  for (const b of props.mappingModel.blocks) {
    b.fields.forEach((f) => {
      // Fuzzy matching: strip units and trailing numbers
      const normField = normalizeForMatch(f.fieldName)
      for (let i = 0; i < b.headers.length; i++) {
        if (usedIndices.has(i)) continue
        const normHeader = normalizeForMatch(b.headers[i])
        if (normField === normHeader || normHeader.startsWith(normField) || normField.startsWith(normHeader)) {
          f.mappedSourceIndex = i
          f.headerMatched = true
          usedIndices.add(i)
          break
        }
      }
    })
  }
  recomputeValidation()
}

function normalizeForMatch(s: string): string {
  return s
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+\d+$/u, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Compute numbered items for dropdown - duplicate headers get numbers
 */
function computeNumberedHeaderItems(headers: string[]): Array<{ title: string; value: number }> {
  const counts = new Map<string, number>()
  const baseCount = new Map<string, number>()
  
  // First pass: count occurrences of each base name
  for (const h of headers) {
    const base = h.trim()
    baseCount.set(base, (baseCount.get(base) ?? 0) + 1)
  }
  
  // Second pass: generate numbered titles
  return headers.map((h, i) => {
    const base = h.trim()
    const hasDupes = (baseCount.get(base) ?? 0) > 1
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    return {
      title: hasDupes ? `${base} [${count}]` : base,
      value: i
    }
  })
}

/* Hotkeys */

/*
function handleKey(e: KeyboardEvent): void {
  if (!open.value) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const shift = e.shiftKey

  if (key === 'escape') { e.preventDefault(); open.value = false; return }
  if (ctrl && key === 's') { e.preventDefault(); onApply(); return }
  if (ctrl && key === 'r') { e.preventDefault(); resetMappings(); return }
  if (alt && key === 'a') { e.preventDefault(); autoFillByName(); return }
  if (alt && key === 'u') { e.preventDefault(); showUnmatchedOnly.value = !showUnmatchedOnly.value; return }
  if (alt && key === 'arrowleft') { e.preventDefault(); cycleBlock(-1); return }
  if (alt && key === 'arrowright') { e.preventDefault(); cycleBlock(1); return }
  if (alt && (key === 'arrowdown' || key === 'arrowup')) {
    e.preventDefault()
    const block = currentBlock()
    if (!block) return
    const visibleFields = block.fields.filter(f => !showUnmatchedOnly.value || !f.headerMatched)
    if (!visibleFields.length) return
    if (lastFocusedFieldPos.value < 0) lastFocusedFieldPos.value = 0
    if (key === 'arrowdown') lastFocusedFieldPos.value = Math.min(visibleFields.length - 1, lastFocusedFieldPos.value + 1)
    else lastFocusedFieldPos.value = Math.max(0, lastFocusedFieldPos.value - 1)
    focusFieldByIndex(lastFocusedFieldPos.value)
    return
  }
}

watch(open, v => {
  if (v) {
    window.addEventListener('keydown', handleKey)
    nextTick(() => focusFieldByIndex(0))
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (open.value) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))


 */
</script>

<template>
  <Dialog
    v-model:is-open="open"
    width="1000px"
    :hide-footer="true"
    class="mapping-wizard-dialog"
  >
    <template #content>
      <div class="pa-4">
        <div class="d-flex align-center mb-3" style="gap:12px;">
          <div class="text-h6">Mapping sloupců</div>
          <v-chip size="small" variant="tonal" color="primary">
            {{ mappingModel?.fileName || 'soubor' }}
          </v-chip>
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            :color="showUnmatchedOnly ? 'primary' : undefined"
            @click="showUnmatchedOnly = !showUnmatchedOnly"
            title="Unmatched toggle (Alt+U)"
          >
            Unmatched
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            @click="autoFillByName"
            title="Auto podle jména (Alt+A)"
          >
            Auto-fill
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            @click="resetMappings"
            title="Reset (Ctrl+R)"
          >
            Reset
          </v-btn>
          <v-btn
            size="small"
            color="primary"
            variant="flat"
            :disabled="validationErrors.length > 0"
            @click="onApply"
            title="Použít mapping (Ctrl+S)"
          >
            Použít
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            icon="mdi-close"
            title="Zavřít"
            @click="open = false"
          />
        </div>

        <v-alert
          v-if="validationErrors.length"
          type="warning"
          variant="tonal"
          class="mb-3"
        >
          <div class="text-caption">
            <strong>Neplatný mapping:</strong>
            <ul style="margin:4px 0 0 16px;">
              <li v-for="(e,i) in validationErrors" :key="i">{{ e }}</li>
            </ul>
          </div>
        </v-alert>

        <div v-if="!mappingModel" class="text-medium-emphasis">
          Žádná data k mapování.
        </div>

        <div v-else>
          <!-- Block tabs -->
          <div
            v-if="mappingModel.blocks.length > 1"
            class="d-flex flex-wrap mb-3"
            style="gap:6px;"
          >
            <v-chip
              v-for="b in mappingModel.blocks"
              :key="b.blockIndex"
              size="small"
              :color="b.blockIndex === activeBlockIndex ? 'primary' : undefined"
              :variant="b.blockIndex === activeBlockIndex ? 'flat' : 'tonal'"
              @click="activeBlockIndex = b.blockIndex"
            >
              Tabulka hodnot {{ b.blockIndex }}
            </v-chip>
          </div>

          <div
            v-for="b in mappingModel.blocks"
            :key="b.blockIndex"
            v-show="b.blockIndex === activeBlockIndex"
            class="block-section"
          >
            <div class="d-flex align-center mb-2" style="gap:8px;">
              <div class="text-subtitle-2">{{ b.title }} ({{ b.headers.length }} sloupců)</div>
              <v-spacer />
              <v-chip size="small" variant="tonal">
                Tabulka hodnot {{ b.blockIndex }}
              </v-chip>
            </div>

            <div class="mapping-grid header-row">
              <div class="cell muted" style="display: flex; align-items: center; gap: 4px;">
                <v-checkbox
                  :model-value="enabledFieldsCount === totalFieldsCount"
                  :indeterminate="enabledFieldsCount > 0 && enabledFieldsCount < totalFieldsCount"
                  density="compact"
                  hide-details
                  @update:model-value="(v: boolean | null) => toggleAllFields(!!v)"
                />
              </div>
              <div class="cell muted">Pole</div>
              <div class="cell muted">Sloupec</div>
              <div class="cell muted">Preview</div>
              <div class="cell muted">Stav</div>
            </div>

            <transition-group name="fade-y" tag="div">
              <div
                v-for="(f,fi) in b.fields.filter(ff => !showUnmatchedOnly || !ff.headerMatched)"
                :key="f.id"
                class="mapping-grid data-row"
                :class="{
                  'row-invalid': f.required && f.mappedSourceIndex === null,
                  'row-disabled': !enabledFields.has(f.id)
                }"
              >
                <div class="cell checkbox-cell">
                  <v-checkbox
                    :model-value="enabledFields.has(f.id)"
                    density="compact"
                    hide-details
                    @click="(e: MouseEvent) => toggleFieldEnabled(f.id, e)"
                  />
                </div>
                <div
                  class="cell field-name"
                  data-map-field
                  tabindex="0"
                >
                  <div class="d-flex align-center" style="gap:6px;">
                    <v-chip
                      size="small"
                      :color="f.required ? 'primary' : 'grey-darken-1'"
                      variant="tonal"
                    >
                      {{ fi + 1 }}
                    </v-chip>
                    <span class="field-label">{{ f.fieldName }}</span>
                    <!-- Match source badge -->
                    <v-chip
                      v-if="f.matchSource === 'LEARNED'"
                      size="small"
                      color="success"
                      variant="flat"
                      prepend-icon="mdi-brain"
                      :title="`Naučeno z předchozích importů (${Math.round((f.confidence || 0) * 100)}%)`"
                    >
                      naučeno
                    </v-chip>
                    <v-chip
                      v-else-if="f.matchSource === 'EXACT_MATCH'"
                      size="small"
                      color="success"
                      variant="flat"
                      :title="`Přesná shoda názvu (${Math.round((f.confidence || 0) * 100)}%)`"
                    >
                      shoda
                    </v-chip>
                    <v-chip
                      v-else-if="f.matchSource === 'PARTIAL_MATCH'"
                      size="small"
                      color="warning"
                      variant="tonal"
                      :title="`Částečná shoda (${Math.round((f.confidence || 0) * 100)}%)`"
                    >
                      ~shoda
                    </v-chip>
                    <v-chip
                      v-else-if="f.headerMatched && !f.matchSource"
                      size="small"
                      color="success"
                      variant="flat"
                    >
                      shoda
                    </v-chip>
                  </div>
                </div>

                <div class="cell select-cell">
                  <v-select
                    :model-value="f.mappedSourceIndex"
                    :items="computeNumberedHeaderItems(b.headers)"
                    item-title="title"
                    item-value="value"
                    variant="outlined"
                    density="compact"
                    hide-details="auto"
                    placeholder="--"
                    :disabled="!b.headers.length"
                    @update:model-value="val => setFieldMapping(f.id, typeof val === 'number' ? val : null)"
                  />
                </div>

                <div class="cell preview-cell">
                  <span class="text-caption">
                    {{
                      f.mappedSourceIndex != null
                        ? b.headers[f.mappedSourceIndex]
                        : '—'
                    }}
                  </span>
                </div>

                <div class="cell status-cell">
                  <v-icon
                    v-if="f.required && f.mappedSourceIndex === null"
                    size="18"
                    color="error"
                  >
                    mdi-alert-circle-outline
                  </v-icon>
                  <v-icon
                    v-else
                    size="18"
                    color="green-darken-2"
                  >
                    mdi-check-circle-outline
                  </v-icon>
                </div>
              </div>
            </transition-group>
          </div>
          
          <!-- Series Mapping Section -->
          <div
            v-if="mappingModel.seriesBlocks && mappingModel.seriesBlocks.length"
            class="series-section mt-4"
          >
            <v-divider class="mb-4" />
            <div class="d-flex align-center mb-2" style="gap:8px;">
              <v-icon color="success" size="20">mdi-chart-line</v-icon>
              <div class="text-subtitle-2">Datové série</div>
            </div>
            
            <div
              v-for="(series, sIdx) in mappingModel.seriesBlocks"
              :key="sIdx"
              class="series-block mb-3"
            >
              <div class="d-flex align-center mb-2" style="gap:8px;">
                <v-text-field
                  v-model="series.seriesName"
                  label="Název série"
                  density="compact"
                  variant="outlined"
                  hide-details
                  style="max-width: 200px;"
                />
                <v-chip size="small" color="success" variant="tonal">
                  {{ series.columns.length }} sloupců
                </v-chip>
              </div>
              
              <div class="mapping-grid header-row">
                <div class="cell muted">#</div>
                <div class="cell muted">Sloupec série</div>
                <div class="cell muted">Mapovaný sloupec</div>
                <div class="cell muted">Preview</div>
              </div>
              
              <div
                v-for="(col, colIdx) in series.columns"
                :key="col.id"
                class="mapping-grid data-row"
                :class="{'row-invalid': col.required && col.mappedSourceIndex === null}"
              >
                <div class="cell">
                  <v-chip size="small" color="success" variant="tonal">
                    {{ colIdx + 1 }}
                  </v-chip>
                </div>
                <div class="cell field-name">
                  <span class="field-label">{{ col.columnName }}</span>
                  <span v-if="col.required" class="text-error">*</span>
                </div>
                <div class="cell select-cell">
                  <v-select
                    :model-value="col.mappedSourceIndex"
                    :items="computeNumberedHeaderItems(series.headers)"
                    item-title="title"
                    item-value="value"
                    variant="outlined"
                    density="compact"
                    hide-details="auto"
                    placeholder="--"
                    :disabled="!series.headers.length"
                    @update:model-value="val => setSeriesColumnMapping(sIdx, col.id, typeof val === 'number' ? val : null)"
                  />
                </div>
                <div class="cell preview-cell">
                  <span class="text-caption">
                    {{
                      col.mappedSourceIndex != null
                        ? series.headers[col.mappedSourceIndex]
                        : '—'
                    }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Extra Columns Section (not mapped to any template field) -->
          <div v-if="extraColumns.length > 0" class="extra-section mt-4">
            <v-divider class="mb-4" />
            <div class="d-flex align-center mb-2" style="gap:8px;">
              <v-icon color="warning" size="20">mdi-table-column-plus-after</v-icon>
              <div class="text-subtitle-2">Extra sloupce v souboru ({{ extraColumns.length }})</div>
              <v-spacer />
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-content-copy"
                @click="emitDeriveTemplate"
              >
                Vytvořit odvozenou šablonu
              </v-btn>
            </div>
            
            <v-alert type="info" variant="tonal" class="mb-2" density="compact">
              Tyto sloupce nejsou v aktuální šabloně. Můžete vytvořit odvozenou šablonu s novými poli.
            </v-alert>
            
            <div class="extra-columns-list">
              <v-chip
                v-for="(col, idx) in extraColumns"
                :key="idx"
                size="small"
                variant="tonal"
                color="warning"
                class="ma-1"
              >
                {{ col.headerName }}
              </v-chip>
            </div>
          </div>
        </div>

      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.mapping-grid {
  display: grid;
  grid-template-columns: 40px 1.4fr 1fr 1fr 64px;
  gap: 8px;
  align-items: center;
}
.header-row {
  padding: 4px 6px 6px;
  font-size: 0.7rem;
  letter-spacing: .03em;
  text-transform: uppercase;
  color: var(--v-theme-grey-darken-2);
}
.data-row {
  padding: 6px;
  border-radius: 6px;
  transition: background-color .15s, opacity .15s;
}
.data-row:hover { background: #f9fafc; }
.row-invalid { background: #fff6f6; }
.row-disabled { 
  opacity: 0.5; 
  background: #f5f5f5;
}
.row-disabled .field-label { 
  text-decoration: line-through; 
}
.checkbox-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}
.field-label {
  font-weight: 500;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted { font-size: .7rem; }
</style>
