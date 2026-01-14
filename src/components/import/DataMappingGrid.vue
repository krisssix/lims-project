<script setup lang="ts">
/**
 * DataMappingGrid - Interactive grid for mapping imported data columns to template fields
 * 
 * Usage:
 * - Click on cells to select headers (yellow)
 * - Click + arrow keys to select data ranges (blue/green)
 * - Shift+Click for range selection
 * - Ctrl+Click to add to selection
 * - Keyboard: Shift+Ctrl+Arrow to extend selection
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

export interface FieldMapping {
  fieldName: string
  headerCell: { row: number; col: number } | null
  dataCells: Array<{ row: number; col: number }>
}

const props = defineProps<{
  modelValue: boolean
  rawGrid: (string | number)[][]
  templateFields: Array<{ name: string; type: string; required: boolean }>
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'apply', mappings: FieldMapping[]): void
}>()

// Current mode: 'header' (selecting header cells) or 'data' (selecting data cells)
type SelectMode = 'header' | 'data'
const selectMode = ref<SelectMode>('header')

// Currently selected field for mapping
const activeFieldIndex = ref<number>(0)

// Mappings for each field
const fieldMappings = ref<FieldMapping[]>([])

// Selection state
const selectedCells = ref<Set<string>>(new Set())
const cursorCell = ref<{ row: number; col: number } | null>(null)
const anchorCell = ref<{ row: number; col: number } | null>(null)

// Grid container ref for keyboard events
const gridRef = ref<HTMLElement | null>(null)

// Initialize mappings when dialog opens
watch(() => props.modelValue, (open) => {
  if (open) {
    fieldMappings.value = props.templateFields.map(f => ({
      fieldName: f.name,
      headerCell: null,
      dataCells: []
    }))
    selectedCells.value = new Set()
    cursorCell.value = null
    anchorCell.value = null
    activeFieldIndex.value = 0
    selectMode.value = 'header'
  }
}, { immediate: true })

// Max columns
const maxCols = computed(() => {
  if (!props.rawGrid.length) return 0
  return Math.max(...props.rawGrid.map(r => r.length))
})

// Get cell value
function getCellValue(row: number, col: number): string {
  const cell = props.rawGrid[row]?.[col]
  if (cell === undefined || cell === null) return ''
  return String(cell)
}

// Cell key helper
function cellKey(row: number, col: number): string {
  return `${row},${col}`
}

function parseKey(key: string): { row: number; col: number } {
  const [r, c] = key.split(',').map(Number)
  return { row: r, col: c }
}

// Check cell status for current field
function getCellStatus(row: number, col: number): 'header' | 'data' | 'other-header' | 'other-data' | null {
  const key = cellKey(row, col)
  const activeMapping = fieldMappings.value[activeFieldIndex.value]
  
  // Check if it's the header for active field
  if (activeMapping?.headerCell && 
      activeMapping.headerCell.row === row && 
      activeMapping.headerCell.col === col) {
    return 'header'
  }
  
  // Check if it's data for active field
  if (activeMapping?.dataCells.some(c => c.row === row && c.col === col)) {
    return 'data'
  }
  
  // Check if it's mapped to another field
  for (let i = 0; i < fieldMappings.value.length; i++) {
    if (i === activeFieldIndex.value) continue
    const m = fieldMappings.value[i]
    if (m.headerCell && m.headerCell.row === row && m.headerCell.col === col) {
      return 'other-header'
    }
    if (m.dataCells.some(c => c.row === row && c.col === col)) {
      return 'other-data'
    }
  }
  
  return null
}

// Handle cell click
function handleCellClick(row: number, col: number, event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  console.log('[DataMappingGrid] Cell clicked:', { row, col, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey })
  
  const key = cellKey(row, col)
  
  if (event.shiftKey && anchorCell.value) {
    // Range selection from anchor to current
    selectRange(anchorCell.value.row, anchorCell.value.col, row, col)
  } else if (event.ctrlKey || event.metaKey) {
    // Toggle cell in selection
    if (selectedCells.value.has(key)) {
      selectedCells.value.delete(key)
    } else {
      selectedCells.value.add(key)
    }
    selectedCells.value = new Set(selectedCells.value)
  } else {
    // Single selection
    selectedCells.value = new Set([key])
    anchorCell.value = { row, col }
  }
  
  cursorCell.value = { row, col }
  gridRef.value?.focus()
  console.log('[DataMappingGrid] Selection updated:', { selectedCount: selectedCells.value.size, cursor: cursorCell.value })
}


// Select range helper
function selectRange(r1: number, c1: number, r2: number, c2: number): void {
  const startRow = Math.min(r1, r2)
  const endRow = Math.max(r1, r2)
  const startCol = Math.min(c1, c2)
  const endCol = Math.max(c1, c2)
  
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      selectedCells.value.add(cellKey(r, c))
    }
  }
  selectedCells.value = new Set(selectedCells.value)
}

// Keyboard handler
function handleKeydown(event: KeyboardEvent): void {
  if (!cursorCell.value) return
  
  const { row, col } = cursorCell.value
  let newRow = row
  let newCol = col
  
  switch (event.key) {
    case 'ArrowUp':
      newRow = Math.max(0, row - 1)
      break
    case 'ArrowDown':
      newRow = Math.min(props.rawGrid.length - 1, row + 1)
      break
    case 'ArrowLeft':
      newCol = Math.max(0, col - 1)
      break
    case 'ArrowRight':
      newCol = Math.min(maxCols.value - 1, col + 1)
      break
    case 'Enter':
      // Apply selection to current field
      applySelectionToField()
      return
    case 'Tab':
      event.preventDefault()
      // Move to next field
      if (event.shiftKey) {
        activeFieldIndex.value = Math.max(0, activeFieldIndex.value - 1)
      } else {
        activeFieldIndex.value = Math.min(fieldMappings.value.length - 1, activeFieldIndex.value + 1)
      }
      return
    default:
      return
  }
  
  event.preventDefault()
  
  if (event.shiftKey && event.ctrlKey) {
    // Extend selection to edge
    if (event.key === 'ArrowRight') {
      newCol = maxCols.value - 1
    } else if (event.key === 'ArrowLeft') {
      newCol = 0
    } else if (event.key === 'ArrowDown') {
      newRow = props.rawGrid.length - 1
    } else if (event.key === 'ArrowUp') {
      newRow = 0
    }
    selectRange(anchorCell.value?.row ?? row, anchorCell.value?.col ?? col, newRow, newCol)
  } else if (event.shiftKey) {
    // Extend selection
    selectRange(anchorCell.value?.row ?? row, anchorCell.value?.col ?? col, newRow, newCol)
  } else if (event.ctrlKey) {
    // Move cursor without changing selection
  } else {
    // Move cursor and reset selection
    selectedCells.value = new Set([cellKey(newRow, newCol)])
    anchorCell.value = { row: newRow, col: newCol }
  }
  
  cursorCell.value = { row: newRow, col: newCol }
}

// Apply current selection to active field
function applySelectionToField(): void {
  if (selectedCells.value.size === 0) return
  
  const mapping = fieldMappings.value[activeFieldIndex.value]
  if (!mapping) return
  
  if (selectMode.value === 'header') {
    // Use first selected cell as header
    const firstKey = Array.from(selectedCells.value)[0]
    const { row, col } = parseKey(firstKey)
    mapping.headerCell = { row, col }
    // Auto-switch to data mode
    selectMode.value = 'data'
    selectedCells.value = new Set()
  } else {
    // Add all selected cells as data
    mapping.dataCells = []
    selectedCells.value.forEach(key => {
      const { row, col } = parseKey(key)
      mapping.dataCells.push({ row, col })
    })
    // Move to next field
    if (activeFieldIndex.value < fieldMappings.value.length - 1) {
      activeFieldIndex.value++
      selectMode.value = 'header'
      selectedCells.value = new Set()
    }
  }
}

// Clear mapping for active field
function clearActiveMapping(): void {
  const mapping = fieldMappings.value[activeFieldIndex.value]
  if (mapping) {
    mapping.headerCell = null
    mapping.dataCells = []
  }
  selectMode.value = 'header'
}

// Auto-map columns (detect header row and map sequentially)
function autoMapColumns(): void {
  // Find first row with text (likely headers)
  let headerRow = 0
  for (let r = 0; r < props.rawGrid.length; r++) {
    const row = props.rawGrid[r]
    if (row && row.some(cell => typeof cell === 'string' && cell.trim())) {
      headerRow = r
      break
    }
  }
  
  // Map each field to a column
  for (let i = 0; i < fieldMappings.value.length && i < maxCols.value; i++) {
    const mapping = fieldMappings.value[i]
    mapping.headerCell = { row: headerRow, col: i }
    mapping.dataCells = []
    for (let r = headerRow + 1; r < props.rawGrid.length; r++) {
      if (props.rawGrid[r]?.[i] !== undefined) {
        mapping.dataCells.push({ row: r, col: i })
      }
    }
  }
}

// Check if can apply
const canApply = computed(() => {
  return fieldMappings.value.some(m => m.headerCell || m.dataCells.length > 0)
})

// Apply all mappings
function applyMappings(): void {
  emits('apply', fieldMappings.value)
  emits('update:modelValue', false)
}

// Column letter
function colLetter(idx: number): string {
  let result = ''
  let n = idx
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}

// Active field
const activeField = computed(() => props.templateFields[activeFieldIndex.value])

// Selected cells info
const selectionInfo = computed(() => {
  if (selectedCells.value.size === 0) return ''
  if (selectedCells.value.size === 1) {
    const key = Array.from(selectedCells.value)[0]
    const { row, col } = parseKey(key)
    return `${colLetter(col)}${row + 1}: "${getCellValue(row, col)}"`
  }
  return `${selectedCells.value.size} buněk`
})

// Keyboard event listeners
onMounted(() => {
  // Focus grid when mounted
})

onBeforeUnmount(() => {
  // Cleanup if needed
})
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    width="95vw"
    max-width="1400px"
    persistent
    @update:model-value="v => emits('update:modelValue', v)"
  >
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <div class="d-flex align-center" style="gap: 12px;">
          <v-icon color="primary">mdi-table-arrow-right</v-icon>
          <div>
            <div>Mapování dat na pole</div>
            <div class="text-caption text-medium-emphasis">
              Vyberte hlavičky (žluté) a data (modré) pro každé pole
            </div>
          </div>
        </div>
        <v-btn icon="mdi-close" variant="text" @click="emits('update:modelValue', false)" />
      </v-card-title>

      <v-card-text class="pa-0">
        <div class="mapping-layout">
          <!-- Left: Fields list -->
          <div class="fields-panel">
            <div class="panel-header">
              <v-icon size="18" class="mr-1">mdi-format-list-bulleted</v-icon>
              Pole šablony
            </div>
            <div class="fields-list">
              <div
                v-for="(field, idx) in templateFields"
                :key="idx"
                :class="['field-item', { 'is-active': idx === activeFieldIndex, 'has-mapping': fieldMappings[idx]?.headerCell }]"
                @click="activeFieldIndex = idx"
              >
                <div class="field-name">
                  {{ field.name }}
                  <v-chip v-if="field.required" size="small" color="error" variant="tonal" class="ml-1">*</v-chip>
                </div>
                <div v-if="fieldMappings[idx]?.headerCell" class="field-mapping-info">
                  {{ colLetter(fieldMappings[idx].headerCell!.col) }}{{ fieldMappings[idx].headerCell!.row + 1 }}
                  <span v-if="fieldMappings[idx]?.dataCells.length"> → {{ fieldMappings[idx].dataCells.length }} hodnot</span>
                </div>
              </div>
            </div>
            
            <div class="panel-actions">
              <v-btn size="small" variant="outlined" block @click="autoMapColumns">
                <v-icon start>mdi-auto-fix</v-icon>
                Auto-mapovat
              </v-btn>
            </div>
          </div>

          <!-- Center: Grid -->
          <div class="grid-panel">
            <!-- Toolbar -->
            <div class="grid-toolbar">
              <div class="d-flex align-center" style="gap: 8px;">
                <v-chip :color="selectMode === 'header' ? 'warning' : 'default'" variant="flat" size="small">
                  {{ selectMode === 'header' ? '📍 Vybírám hlavičku' : '📊 Vybírám data' }}
                </v-chip>
                <span v-if="activeField" class="text-body-2">
                  pro pole: <strong>{{ activeField.name }}</strong>
                </span>
              </div>
              
              <div class="d-flex align-center" style="gap: 8px;">
                <span v-if="selectionInfo" class="text-caption">{{ selectionInfo }}</span>
                <v-btn-group variant="outlined" density="compact">
                  <v-btn
                    size="small"
                    :color="selectMode === 'header' ? 'warning' : undefined"
                    @click="selectMode = 'header'"
                  >
                    Hlavička
                  </v-btn>
                  <v-btn
                    size="small"
                    :color="selectMode === 'data' ? 'primary' : undefined"
                    @click="selectMode = 'data'"
                  >
                    Data
                  </v-btn>
                </v-btn-group>
                <v-btn
                  size="small"
                  color="success"
                  variant="flat"
                  :disabled="selectedCells.size === 0"
                  @click="applySelectionToField"
                >
                  Přiřadit (Enter)
                </v-btn>
                <v-btn
                  size="small"
                  variant="text"
                  @click="clearActiveMapping"
                >
                  Vymazat
                </v-btn>
              </div>
            </div>

            <!-- Grid -->
            <div
              ref="gridRef"
              class="grid-container"
              tabindex="0"
              @keydown="handleKeydown"
            >
              <table class="data-grid">
                <thead>
                  <tr>
                    <th class="corner-cell"></th>
                    <th v-for="c in maxCols" :key="c - 1" class="col-header">
                      {{ colLetter(c - 1) }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIdx) in rawGrid" :key="rowIdx">
                    <td class="row-header">{{ rowIdx + 1 }}</td>
                    <td
                      v-for="colIdx in maxCols"
                      :key="colIdx - 1"
                      :class="{
                        'is-selected': selectedCells.has(cellKey(rowIdx, colIdx - 1)),
                        'is-cursor': cursorCell?.row === rowIdx && cursorCell?.col === colIdx - 1,
                        'is-header': getCellStatus(rowIdx, colIdx - 1) === 'header',
                        'is-data': getCellStatus(rowIdx, colIdx - 1) === 'data',
                        'is-other-header': getCellStatus(rowIdx, colIdx - 1) === 'other-header',
                        'is-other-data': getCellStatus(rowIdx, colIdx - 1) === 'other-data',
                        'is-empty': !getCellValue(rowIdx, colIdx - 1)
                      }"
                      @click="handleCellClick(rowIdx, colIdx - 1, $event)"
                    >
                      {{ getCellValue(rowIdx, colIdx - 1) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="grid-help">
              <v-icon size="14">mdi-keyboard</v-icon>
              <span>Klik = výběr | Shift+Klik = rozsah | Ctrl+Klik = přidat | Shift+Ctrl+Šipky = rozšířit do kraje | Enter = přiřadit | Tab = další pole</span>
            </div>
          </div>
        </div>
      </v-card-text>

      <v-card-actions class="pa-4">
        <v-btn variant="text" @click="emits('update:modelValue', false)">Zrušit</v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!canApply"
          @click="applyMappings"
        >
          Použít mapování
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.mapping-layout {
  display: grid;
  grid-template-columns: 250px 1fr;
  height: 65vh;
}

.fields-panel {
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 12px 16px;
  background: #fafafa;
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #e0e0e0;
}

.fields-list {
  flex: 1;
  overflow-y: auto;
}

.field-item {
  padding: 10px 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background 0.1s;
}

.field-item:hover {
  background: #f5f5f5;
}

.field-item.is-active {
  background: #e3f2fd;
  border-left: 3px solid #1976d2;
}

.field-item.has-mapping .field-name {
  color: #2e7d32;
}

.field-name {
  font-weight: 500;
  font-size: 13px;
}

.field-mapping-info {
  font-size: 11px;
  color: #666;
  margin-top: 2px;
}

.panel-actions {
  padding: 12px;
  border-top: 1px solid #e0e0e0;
}

.grid-panel {
  display: flex;
  flex-direction: column;
}

.grid-toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fafafa;
}

.grid-container {
  flex: 1;
  overflow: auto;
  outline: none;
}

.grid-container:focus {
  outline: 2px solid #1976d2;
  outline-offset: -2px;
}

.data-grid {
  border-collapse: collapse;
  font-size: 11px;
  min-width: 100%;
}

.data-grid th,
.data-grid td {
  border: 1px solid #e0e0e0;
  padding: 3px 5px;
  white-space: nowrap;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}

.corner-cell {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 3;
  background: #f0f0f0;
  min-width: 35px;
}

.col-header {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f0f0f0;
  font-weight: 600;
  text-align: center;
  min-width: 40px;
}

.row-header {
  position: sticky;
  left: 0;
  z-index: 1;
  background: #f0f0f0;
  font-weight: 600;
  text-align: center;
  min-width: 35px;
  color: #666;
}

.data-grid td:not(.row-header) {
  cursor: cell;
}

.data-grid td.is-selected {
  background: #bbdefb !important;
  outline: 2px solid #1976d2;
  outline-offset: -2px;
}

.data-grid td.is-cursor {
  outline: 2px solid #1565c0 !important;
  outline-offset: -2px;
}

.data-grid td.is-header {
  background: #fff59d !important;
  font-weight: 600;
}

.data-grid td.is-data {
  background: #c8e6c9 !important;
}

.data-grid td.is-other-header {
  background: #ffe082 !important;
  opacity: 0.6;
}

.data-grid td.is-other-data {
  background: #a5d6a7 !important;
  opacity: 0.6;
}

.data-grid td.is-empty {
  color: #ccc;
}

.grid-help {
  padding: 6px 12px;
  background: #f5f5f5;
  font-size: 11px;
  color: #666;
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid #e0e0e0;
}
</style>
