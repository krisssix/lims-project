<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog from '@/components/Dialog.vue'
import { isVectorCell, parseVectorCell } from '@/utils/import/vectorDetection'

// Column definition
export interface SeriesColumn {
  name: string
  type: 'float' | 'int' | 'text'
  required: boolean
}

// Result with dynamic column values
export interface PickerResult {
  columnValues: Record<string, (number | string | null)[]>
  seriesName?: string
  // Legacy support
  xValues?: number[]
  yValues?: number[]
}

const props = defineProps<{
  modelValue: boolean
  rawData: string[][]
  seriesName?: string
  // Dynamic columns from template - if not provided, defaults to X/Y
  columns?: SeriesColumn[]
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'apply', result: PickerResult): void
}>()

// Get columns to use - from props or default X/Y
const effectiveColumns = computed<SeriesColumn[]>(() => {
  if (props.columns && props.columns.length > 0) {
    return props.columns
  }
  // Default fallback
  return [
    { name: 'X', type: 'float', required: true },
    { name: 'Y', type: 'float', required: true }
  ]
})

// Selection state
const selectionMode = ref<string | null>(null)
const columnSelections = ref<Map<string, Set<string>>>(new Map())

// Header detection
const hasHeaderRow = ref(true)
const hasHeaderCol = ref(true)

// Advanced settings
const showAdvanced = ref(false)
const skipRowsTop = ref(0)
const skipRowsBottom = ref(0)
const skipColumnsLeft = ref(0)
const skipColumnsRight = ref(0)

// Drag selection state
const isDragging = ref(false)
const dragStartCell = ref<{ row: number; col: number } | null>(null)

// Column colors for visual distinction
const columnColors = ['primary', 'secondary', 'success', 'warning', 'info', 'error']
function getColumnColor(idx: number): string {
  return columnColors[idx % columnColors.length]
}

// Get data considering headers
const dataRows = computed(() => {
  const startRow = hasHeaderRow.value ? 1 : 0
  return props.rawData.slice(startRow)
})

const headerRow = computed(() => {
  if (!hasHeaderRow.value || props.rawData.length === 0) return []
  return props.rawData[0]
})

// Initialize selections for each column
watch(effectiveColumns, (cols) => {
  cols.forEach(col => {
    if (!columnSelections.value.has(col.name)) {
      columnSelections.value.set(col.name, new Set())
    }
  })
}, { immediate: true })

// Cell key helper
function cellKey(row: number, col: number): string {
  return `${row},${col}`
}

function parseKey(key: string): { row: number; col: number } {
  const [row, col] = key.split(',').map(Number)
  return { row, col }
}

// Check if cell should be skipped
function isCellSkipped(row: number, col: number): boolean {
  if (row < skipRowsTop.value) return true
  if (row >= props.rawData.length - skipRowsBottom.value) return true
  if (col < skipColumnsLeft.value) return true
  if (col >= (props.rawData[0]?.length || 0) - skipColumnsRight.value) return true
  return false
}

// Check if cell is a header
function isCellHeader(row: number, col: number): boolean {
  return (hasHeaderRow.value && row === 0) || (hasHeaderCol.value && col === 0)
}

// Get selection for current mode
function getCurrentSelection(): Set<string> {
  if (!selectionMode.value) return new Set()
  return columnSelections.value.get(selectionMode.value) || new Set()
}

function setCurrentSelection(selection: Set<string>): void {
  if (!selectionMode.value) return
  columnSelections.value.set(selectionMode.value, selection)
  columnSelections.value = new Map(columnSelections.value)
}

// Selection handlers
function getCellClass(rowIdx: number, colIdx: number): string {
  const key = cellKey(rowIdx, colIdx)
  const classes: string[] = ['picker-cell']
  
  // Check skip status
  if (isCellSkipped(rowIdx, colIdx)) {
    classes.push('skipped')
    return classes.join(' ')
  }
  
  // Check each column's selection
  let colorIdx = 0
  for (const [colName, selection] of columnSelections.value.entries()) {
    if (selection.has(key)) {
      classes.push(`selected-col-${colorIdx % 6}`)
    }
    colorIdx++
  }
  
  if (hasHeaderRow.value && rowIdx === 0) classes.push('header-row')
  if (hasHeaderCol.value && colIdx === 0) classes.push('header-col')
  
  return classes.join(' ')
}

function handleCellMouseDown(event: MouseEvent, rowIdx: number, colIdx: number) {
  if (!selectionMode.value) return
  if (isCellSkipped(rowIdx, colIdx)) return
  if (isCellHeader(rowIdx, colIdx)) return
  
  isDragging.value = true
  dragStartCell.value = { row: rowIdx, col: colIdx }
  
  if (event.shiftKey && dragStartCell.value) {
    selectRange(dragStartCell.value, { row: rowIdx, col: colIdx })
  } else {
    toggleCell(rowIdx, colIdx)
  }
}

function handleCellMouseEnter(rowIdx: number, colIdx: number) {
  if (!isDragging.value || !dragStartCell.value || !selectionMode.value) return
  if (isCellSkipped(rowIdx, colIdx)) return
  selectRange(dragStartCell.value, { row: rowIdx, col: colIdx })
}

function handleMouseUp() {
  isDragging.value = false
}

function handleCellDoubleClick(colIdx: number) {
  selectEntireColumn(colIdx)
}

function toggleCell(row: number, col: number) {
  const key = cellKey(row, col)
  const current = getCurrentSelection()
  const newSelection = new Set(current)
  
  if (newSelection.has(key)) {
    newSelection.delete(key)
  } else {
    newSelection.add(key)
  }
  setCurrentSelection(newSelection)
}

function selectRange(start: { row: number; col: number }, end: { row: number; col: number }) {
  const minRow = Math.min(start.row, end.row)
  const maxRow = Math.max(start.row, end.row)
  const minCol = Math.min(start.col, end.col)
  const maxCol = Math.max(start.col, end.col)
  
  const newSelection = new Set(getCurrentSelection())
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (!isCellSkipped(r, c) && !isCellHeader(r, c)) {
        newSelection.add(cellKey(r, c))
      }
    }
  }
  setCurrentSelection(newSelection)
}

function selectEntireColumn(colIdx: number) {
  if (!selectionMode.value) return
  const newSelection = new Set(getCurrentSelection())
  const startRow = hasHeaderRow.value ? 1 : 0
  
  for (let r = startRow; r < props.rawData.length; r++) {
    if (!isCellSkipped(r, colIdx)) {
      newSelection.add(cellKey(r, colIdx))
    }
  }
  setCurrentSelection(newSelection)
}

function getSelectionCount(colName: string): number {
  return columnSelections.value.get(colName)?.size || 0
}

// Extract values for a column
function extractValuesForColumn(colName: string): (number | string | null)[] {
  const selection = columnSelections.value.get(colName)
  if (!selection || selection.size === 0) return []
  
  const colDef = effectiveColumns.value.find(c => c.name === colName)
  const isNumeric = colDef?.type === 'float' || colDef?.type === 'int'
  
  const values: (number | string | null)[] = []
  const sortedKeys = Array.from(selection).sort((a, b) => {
    const [rowA] = a.split(',').map(Number)
    const [rowB] = b.split(',').map(Number)
    return rowA - rowB
  })
  
  for (const key of sortedKeys) {
    const { row, col } = parseKey(key)
    const cellValue = props.rawData[row]?.[col]
    
    if (cellValue === undefined || cellValue === null || cellValue === '') {
      values.push(null)
    } else if (isVectorCell(cellValue)) {
      const vectorValues = parseVectorCell(cellValue)
      values.push(...vectorValues)
    } else if (isNumeric) {
      const num = parseFloat(String(cellValue).replace(',', '.'))
      values.push(isNaN(num) ? null : num)
    } else {
      values.push(cellValue)
    }
  }
  
  return values
}

function clearSelection() {
  // Create fresh Map with empty Sets for each column
  const newSelections = new Map<string, Set<string>>()
  for (const col of effectiveColumns.value) {
    newSelections.set(col.name, new Set())
  }
  columnSelections.value = newSelections
  // Also reset selection mode to force UI update
  selectionMode.value = selectionMode.value
}

// Total selected cells count
const totalSelectedCount = computed(() => {
  let count = 0
  for (const selection of columnSelections.value.values()) {
    count += selection.size
  }
  return count
})

// Current step in workflow
const currentStep = computed(() => {
  if (!selectionMode.value) return 1
  if (totalSelectedCount.value === 0) return 2
  return 3
})

// Check if can apply
const canApply = computed(() => {
  for (const selection of columnSelections.value.values()) {
    if (selection.size > 0) return true
  }
  return false
})

// Apply selection
function applySelection() {
  const columnValues: Record<string, (number | string | null)[]> = {}
  
  for (const col of effectiveColumns.value) {
    columnValues[col.name] = extractValuesForColumn(col.name)
  }
  
  // Legacy support for X/Y
  const xVals = columnValues['X'] || columnValues[effectiveColumns.value[0]?.name || ''] || []
  const yVals = columnValues['Y'] || columnValues[effectiveColumns.value[1]?.name || ''] || []
  
  emits('apply', {
    columnValues,
    xValues: xVals.filter((v): v is number => typeof v === 'number'),
    yValues: yVals.filter((v): v is number => typeof v === 'number'),
    seriesName: props.seriesName
  })
  emits('update:modelValue', false)
}

function close() {
  emits('update:modelValue', false)
}

// Reset on open
watch(() => props.modelValue, (open) => {
  if (open) {
    clearSelection()
    selectionMode.value = null
    showAdvanced.value = false
    skipRowsTop.value = 0
    skipRowsBottom.value = 0
    skipColumnsLeft.value = 0
    skipColumnsRight.value = 0
  }
})
</script>

<template>
  <Dialog
    :is-open="modelValue"
    title="Výběr dat pro sérii"
    width="1000px"
    :hide-footer="false"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div class="dialog-header">
        <div class="header-left">
          <div class="header-icon">
            <v-icon color="white">
              mdi-table-arrow-left
            </v-icon>
          </div>
          <div>
            <h2 class="header-title">
              Výběr dat pro sérii
            </h2>
            <p class="header-subtitle">
              Vyberte sloupce a data z tabulky
            </p>
          </div>
        </div>
        <v-chip
          v-if="seriesName"
          variant="flat"
          color="white"
          class="series-chip"
        >
          <v-icon
            start
            size="small"
          >
            mdi-chart-line
          </v-icon>
          {{ seriesName }}
        </v-chip>
      </div>
    </template>
    
    <template #content>
      <div
        class="picker-container"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseUp"
      >
        <!-- Empty state -->
        <div
          v-if="!rawData || rawData.length === 0"
          class="empty-state"
        >
          <v-icon
            size="64"
            color="grey-lighten-1"
          >
            mdi-table-off
          </v-icon>
          <p class="text-h6 text-medium-emphasis mt-4">
            Žádná data k dispozici
          </p>
          <p class="text-body-2 text-medium-emphasis">
            Nejprve importujte data ze souboru
          </p>
        </div>
        
        <template v-else>
          <!-- Step indicator -->
          <div class="step-indicator">
            <div
              class="step"
              :class="{ active: currentStep >= 1, done: currentStep > 1 }"
            >
              <div class="step-number">
                1
              </div>
              <span class="step-label">Vyberte sloupec</span>
            </div>
            <v-icon
              size="16"
              color="grey-lighten-1"
            >
              mdi-chevron-right
            </v-icon>
            <div
              class="step"
              :class="{ active: currentStep >= 2, done: currentStep > 2 }"
            >
              <div class="step-number">
                2
              </div>
              <span class="step-label">Označte buňky</span>
            </div>
            <v-icon
              size="16"
              color="grey-lighten-1"
            >
              mdi-chevron-right
            </v-icon>
            <div
              class="step"
              :class="{ active: currentStep >= 3, done: currentStep === 3 }"
            >
              <div class="step-number">
                3
              </div>
              <span class="step-label">Potvrďte výběr</span>
            </div>
          </div>

          <!-- Info tip -->
          <v-alert
            type="info"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            <template #prepend>
              <v-icon>mdi-lightbulb-outline</v-icon>
            </template>
            <strong>Tip:</strong> Dvojklik na hlavičku sloupce vybere celý sloupec. 
            Shift+klik pro výběr rozsahu. Podržte myš a táhněte pro výběr více buněk.
          </v-alert>

          <!-- Column selection cards -->
          <div class="column-cards">
            <div
              v-for="(col, idx) in effectiveColumns"
              :key="col.name"
              class="column-card"
              :class="{ 
                active: selectionMode === col.name,
                [`color-${getColumnColor(idx)}`]: true
              }"
              @click="selectionMode = col.name"
            >
              <div
                class="card-icon"
                :class="{ active: selectionMode === col.name }"
              >
                <v-icon :color="selectionMode === col.name ? 'white' : getColumnColor(idx)">
                  mdi-table-column
                </v-icon>
              </div>
              <div class="card-content">
                <span class="card-name">{{ col.name }}</span>
                <span class="card-count">
                  {{ getSelectionCount(col.name) > 0 ? `${getSelectionCount(col.name)} vybráno` : 'Žádná data' }}
                </span>
                <span class="card-type">{{ col.type }}</span>
              </div>
              <v-chip
                v-if="getSelectionCount(col.name) > 0"
                size="x-small"
                :color="getColumnColor(idx)"
                variant="flat"
                class="card-badge"
              >
                {{ getSelectionCount(col.name) }}
              </v-chip>
              <v-icon
                v-if="selectionMode === col.name"
                class="card-check"
                color="white"
              >
                mdi-check-circle
              </v-icon>
            </div>
          </div>

          <!-- Options bar -->
          <div class="options-bar">
            <div class="options-left">
              <v-switch
                v-model="hasHeaderRow"
                label="První řádek = hlavičky"
                density="compact"
                hide-details
                color="primary"
              />
              <v-switch
                v-model="hasHeaderCol"
                label="První sloupec = popisky"
                density="compact"
                hide-details
                color="primary"
              />
            </div>
            <div class="options-right">
              <v-btn
                :variant="showAdvanced ? 'flat' : 'tonal'"
                :color="showAdvanced ? 'secondary' : undefined"
                size="small"
                prepend-icon="mdi-cog"
                @click="showAdvanced = !showAdvanced"
              >
                Pokročilé
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                color="error"
                prepend-icon="mdi-eraser"
                @click="clearSelection"
              >
                Vymazat vše
              </v-btn>
            </div>
          </div>

          <!-- Advanced settings panel -->
          <v-expand-transition>
            <div
              v-if="showAdvanced"
              class="advanced-panel"
            >
              <div class="advanced-header">
                <v-icon
                  color="secondary"
                  class="mr-2"
                >
                  mdi-cog
                </v-icon>
                <span>Pokročilé nastavení importu</span>
              </div>
              <div class="advanced-grid">
                <div class="advanced-section">
                  <h4>
                    <v-icon
                      size="16"
                      color="secondary"
                      class="mr-1"
                    >
                      mdi-arrow-collapse-vertical
                    </v-icon>
                    Přeskočit řádky/sloupce
                  </h4>
                  <div class="skip-inputs">
                    <div class="skip-input">
                      <label>Řádky shora</label>
                      <v-text-field
                        v-model.number="skipRowsTop"
                        type="number"
                        min="0"
                        density="compact"
                        variant="outlined"
                        hide-details
                      />
                    </div>
                    <div class="skip-input">
                      <label>Řádky zdola</label>
                      <v-text-field
                        v-model.number="skipRowsBottom"
                        type="number"
                        min="0"
                        density="compact"
                        variant="outlined"
                        hide-details
                      />
                    </div>
                    <div class="skip-input">
                      <label>Sloupce zleva</label>
                      <v-text-field
                        v-model.number="skipColumnsLeft"
                        type="number"
                        min="0"
                        density="compact"
                        variant="outlined"
                        hide-details
                      />
                    </div>
                    <div class="skip-input">
                      <label>Sloupce zprava</label>
                      <v-text-field
                        v-model.number="skipColumnsRight"
                        type="number"
                        min="0"
                        density="compact"
                        variant="outlined"
                        hide-details
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </v-expand-transition>

          <!-- Data table -->
          <v-card
            variant="outlined"
            class="table-card"
          >
            <div class="picker-grid-wrapper">
              <table class="picker-grid">
                <tbody>
                  <tr
                    v-for="(row, rowIdx) in rawData"
                    :key="rowIdx"
                  >
                    <td
                      v-for="(cell, colIdx) in row"
                      :key="colIdx"
                      :class="getCellClass(rowIdx, colIdx)"
                      :title="isCellSkipped(rowIdx, colIdx) ? 'Přeskočeno nastavením' : isCellHeader(rowIdx, colIdx) ? 'Dvojklik = celý sloupec' : 'Klikni pro výběr'"
                      @mousedown="handleCellMouseDown($event, rowIdx, colIdx)"
                      @mouseenter="handleCellMouseEnter(rowIdx, colIdx)"
                      @dblclick="handleCellDoubleClick(colIdx)"
                    >
                      <span class="cell-content">{{ cell }}</span>
                      <span
                        v-if="isCellSkipped(rowIdx, colIdx)"
                        class="skip-indicator"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="table-footer">
              <div class="footer-left">
                <v-icon
                  size="16"
                  class="mr-1"
                >
                  mdi-cursor-default-click
                </v-icon>
                Vybráno: <strong>{{ totalSelectedCount }}</strong> buněk
              </div>
              <span class="footer-hint">Dvojklik na hlavičku = celý sloupec</span>
            </div>
          </v-card>

          <!-- Preview -->
          <v-card
            variant="tonal"
            class="preview-card"
          >
            <div class="preview-header">
              <v-icon
                size="18"
                class="mr-2"
              >
                mdi-eye-outline
              </v-icon>
              Náhled vybraných dat
            </div>
            <div class="preview-grid">
              <div 
                v-for="(col, idx) in effectiveColumns" 
                :key="col.name" 
                class="preview-column"
              >
                <div
                  class="preview-column-header"
                  :class="`border-${getColumnColor(idx)}`"
                >
                  <v-icon
                    size="14"
                    :color="getColumnColor(idx)"
                    class="mr-1"
                  >
                    mdi-table-column
                  </v-icon>
                  {{ col.name }}
                </div>
                <div class="preview-column-values">
                  <template v-if="getSelectionCount(col.name) > 0">
                    <code>{{ extractValuesForColumn(col.name).slice(0, 5).join(', ') }}</code>
                    <span
                      v-if="getSelectionCount(col.name) > 5"
                      class="text-medium-emphasis"
                    >
                      ... (+{{ getSelectionCount(col.name) - 5 }} dalších)
                    </span>
                  </template>
                  <span
                    v-else
                    class="text-medium-emphasis text-body-2 font-italic"
                  >
                    Žádná data
                  </span>
                </div>
              </div>
            </div>
          </v-card>
        </template>
      </div>
    </template>
    
    <template #footer>
      <div class="dialog-footer">
        <div class="footer-status">
          <template v-if="canApply">
            <span class="status-dot active" />
            Připraveno k aplikaci
          </template>
          <template v-else>
            <span class="text-medium-emphasis">Vyberte data pro pokračování</span>
          </template>
        </div>
        <div class="footer-actions">
          <v-btn
            variant="text"
            @click="close"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!canApply"
            prepend-icon="mdi-check"
            @click="applySelection"
          >
            Použít hodnoty ({{ totalSelectedCount }})
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.picker-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  user-select: none;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  text-align: center;
}

/* Dialog header */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: linear-gradient(135deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-primary-darken-1)));
  color: white;
  margin: -16px -24px 0;
  border-radius: 12px 12px 0 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  padding: 10px;
  background: rgba(255,255,255,0.2);
  border-radius: 12px;
}

.header-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.header-subtitle {
  font-size: 13px;
  opacity: 0.8;
  margin: 2px 0 0;
}

.series-chip {
  font-weight: 600;
}

/* Step indicator */
.step-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
}

.step {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  background: #e5e7eb;
  color: #6b7280;
  transition: all 0.2s ease;
}

.step.active .step-number {
  background: rgb(var(--v-theme-primary));
  color: white;
  box-shadow: 0 4px 12px rgba(var(--v-theme-primary), 0.3);
}

.step.done .step-number {
  background: rgb(var(--v-theme-success));
  color: white;
}

.step-label {
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
}

.step.active .step-label,
.step.done .step-label {
  color: #111827;
}

/* Column cards */
.column-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.column-card {
  position: relative;
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: white;
}

.column-card:hover:not(.active) {
  border-color: #d1d5db;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.column-card.active {
  border-color: transparent;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(var(--v-theme-primary), 0.25);
}

.column-card.active.color-primary {
  background: linear-gradient(135deg, rgba(var(--v-theme-primary), 0.1), rgba(var(--v-theme-primary), 0.2));
}
.column-card.active.color-secondary {
  background: linear-gradient(135deg, rgba(var(--v-theme-secondary), 0.1), rgba(var(--v-theme-secondary), 0.2));
}
.column-card.active.color-success {
  background: linear-gradient(135deg, rgba(var(--v-theme-success), 0.1), rgba(var(--v-theme-success), 0.2));
}

.card-icon {
  display: inline-flex;
  padding: 8px;
  border-radius: 8px;
  background: #f3f4f6;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}

.card-icon.active {
  background: rgb(var(--v-theme-primary));
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-name {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.card-count {
  font-size: 13px;
  color: #6b7280;
}

.card-type {
  font-size: 11px;
  color: #9ca3af;
  text-transform: uppercase;
  margin-top: 4px;
}

.card-badge {
  position: absolute;
  top: 12px;
  right: 12px;
}

.card-check {
  position: absolute;
  top: 12px;
  right: 12px;
}

/* Options bar */
.options-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 12px;
  gap: 16px;
}

.options-left {
  display: flex;
  gap: 24px;
}

.options-right {
  display: flex;
  gap: 8px;
}

/* Advanced panel */
.advanced-panel {
  background: linear-gradient(135deg, #ede9fe, #fce7f3);
  border: 2px solid #c4b5fd;
  border-radius: 12px;
  padding: 20px;
}

.advanced-header {
  display: flex;
  align-items: center;
  font-weight: 600;
  margin-bottom: 16px;
}

.advanced-section h4 {
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 12px;
}

.skip-inputs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.skip-input {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skip-input label {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
}

/* Table card */
.table-card {
  border-radius: 12px !important;
  overflow: hidden;
}

.picker-grid-wrapper {
  max-height: 300px;
  overflow: auto;
}

.picker-grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.picker-cell {
  position: relative;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.15s ease;
}

.picker-cell:hover:not(.skipped):not(.header-row):not(.header-col) {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

.picker-cell.skipped {
  background: #f3f4f6;
  color: #9ca3af;
  cursor: not-allowed;
}

.skip-indicator {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 4px,
    rgba(239, 68, 68, 0.1) 4px,
    rgba(239, 68, 68, 0.1) 8px
  );
}

.cell-content {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Selection colors */
.picker-cell.selected-col-0 {
  background: linear-gradient(135deg, rgba(var(--v-theme-primary), 0.15), rgba(var(--v-theme-primary), 0.25));
  border-color: rgba(var(--v-theme-primary), 0.4);
  font-weight: 500;
}
.picker-cell.selected-col-1 {
  background: linear-gradient(135deg, rgba(var(--v-theme-secondary), 0.15), rgba(var(--v-theme-secondary), 0.25));
  border-color: rgba(var(--v-theme-secondary), 0.4);
  font-weight: 500;
}
.picker-cell.selected-col-2 {
  background: linear-gradient(135deg, rgba(var(--v-theme-success), 0.15), rgba(var(--v-theme-success), 0.25));
  border-color: rgba(var(--v-theme-success), 0.4);
  font-weight: 500;
}
.picker-cell.selected-col-3 {
  background: linear-gradient(135deg, rgba(var(--v-theme-warning), 0.15), rgba(var(--v-theme-warning), 0.25));
  border-color: rgba(var(--v-theme-warning), 0.4);
  font-weight: 500;
}
.picker-cell.selected-col-4 {
  background: linear-gradient(135deg, rgba(var(--v-theme-info), 0.15), rgba(var(--v-theme-info), 0.25));
  border-color: rgba(var(--v-theme-info), 0.4);
  font-weight: 500;
}
.picker-cell.selected-col-5 {
  background: linear-gradient(135deg, rgba(var(--v-theme-error), 0.15), rgba(var(--v-theme-error), 0.25));
  border-color: rgba(var(--v-theme-error), 0.4);
  font-weight: 500;
}

.picker-cell.header-row,
.picker-cell.header-col {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
}

.table-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  font-size: 13px;
  color: #6b7280;
}

.footer-hint {
  font-size: 12px;
  color: #9ca3af;
}

/* Preview card */
.preview-card {
  border-radius: 12px !important;
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  background: rgba(0,0,0,0.03);
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  padding: 16px;
}

.preview-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-column-header {
  display: flex;
  align-items: center;
  font-weight: 600;
  font-size: 13px;
  padding-bottom: 6px;
  border-bottom: 2px solid;
}

.preview-column-header.border-primary { border-color: rgb(var(--v-theme-primary)); }
.preview-column-header.border-secondary { border-color: rgb(var(--v-theme-secondary)); }
.preview-column-header.border-success { border-color: rgb(var(--v-theme-success)); }
.preview-column-header.border-warning { border-color: rgb(var(--v-theme-warning)); }
.preview-column-header.border-info { border-color: rgb(var(--v-theme-info)); }
.preview-column-header.border-error { border-color: rgb(var(--v-theme-error)); }

.preview-column-values {
  font-size: 13px;
  line-height: 1.5;
}

.preview-column-values code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  background: rgba(0,0,0,0.05);
  padding: 2px 6px;
  border-radius: 4px;
}

/* Dialog footer */
.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.footer-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #6b7280;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
}

.status-dot.active {
  background: rgb(var(--v-theme-success));
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.footer-actions {
  display: flex;
  gap: 8px;
}
</style>
