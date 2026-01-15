<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog from '@/components/Dialog.vue'

const props = defineProps<{
  modelValue: boolean
  rawGrid: (string | number)[][]
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'apply', result: { tableHeaders: string[], seriesHeaders: string[], headerRowIndex: number | null }): void
}>()

// Selection mode: 'cell' | 'row' | 'column'
type SelectionMode = 'cell' | 'row' | 'column'
const selectionMode = ref<SelectionMode>('cell')

// Selected cells as Set of "row,col" strings
const selectedCells = ref<Set<string>>(new Set())

// Last clicked cell for shift-click range selection
const lastClickedCell = ref<{ row: number; col: number } | null>(null)

// Assignment: which cells go to table headers, which to series
const tableCells = ref<Set<string>>(new Set())
const seriesCells = ref<Set<string>>(new Set())

// Scroll container ref
const gridContainerRef = ref<HTMLElement | null>(null)

// Reset on dialog open
watch(() => props.modelValue, (open) => {
  if (open) {
    selectedCells.value = new Set()
    tableCells.value = new Set()
    seriesCells.value = new Set()
    lastClickedCell.value = null
    selectionMode.value = 'cell'
    noHeaderMode.value = false
    renamedHeaders.value = new Map()
  }
})

// No Header Mode state
const noHeaderMode = ref(false)
const renamedHeaders = ref<Map<number, string>>(new Map())
const showRenameDialog = ref(false)
const columnToRename = ref<number | null>(null)
const tempRenameValue = ref('')

function openRenameDialog(colIdx: number) {
  columnToRename.value = colIdx
  tempRenameValue.value = renamedHeaders.value.get(colIdx) || colLetter(colIdx)
  showRenameDialog.value = true
}

function saveColumnName() {
  if (columnToRename.value !== null && tempRenameValue.value.trim()) {
    renamedHeaders.value.set(columnToRename.value, tempRenameValue.value.trim())
    // Trigger reactivity
    renamedHeaders.value = new Map(renamedHeaders.value)
  }
  showRenameDialog.value = false
}

// Get max columns
const maxCols = computed(() => {
  if (!props.rawGrid.length) return 0
  return Math.max(...props.rawGrid.map(r => r.length))
})

// Handle cell click with shift support
function handleCellClick(rowIdx: number, colIdx: number, event: MouseEvent): void {
  const cellKey = `${rowIdx},${colIdx}`
  
  if (event.shiftKey && lastClickedCell.value) {
    // Range selection
    const startRow = Math.min(lastClickedCell.value.row, rowIdx)
    const endRow = Math.max(lastClickedCell.value.row, rowIdx)
    const startCol = Math.min(lastClickedCell.value.col, colIdx)
    const endCol = Math.max(lastClickedCell.value.col, colIdx)
    
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        selectedCells.value.add(`${r},${c}`)
      }
    }
    selectedCells.value = new Set(selectedCells.value)
  } else if (event.ctrlKey || event.metaKey) {
    // Toggle single cell (add to selection)
    if (selectedCells.value.has(cellKey)) {
      selectedCells.value.delete(cellKey)
    } else {
      selectedCells.value.add(cellKey)
    }
    selectedCells.value = new Set(selectedCells.value)
  } else {
    // Replace selection with single cell
    selectedCells.value = new Set([cellKey])
  }
  
  lastClickedCell.value = { row: rowIdx, col: colIdx }
}

// Handle row header click - select entire row
function handleRowClick(rowIdx: number, event: MouseEvent): void {
  const row = props.rawGrid[rowIdx]
  if (!row) return
  
  if (event.shiftKey && lastClickedCell.value) {
    const startRow = Math.min(lastClickedCell.value.row, rowIdx)
    const endRow = Math.max(lastClickedCell.value.row, rowIdx)
    for (let r = startRow; r <= endRow; r++) {
      const currentRow = props.rawGrid[r]
      if (currentRow) {
        for (let c = 0; c < currentRow.length; c++) {
          selectedCells.value.add(`${r},${c}`)
        }
      }
    }
  } else if (event.ctrlKey || event.metaKey) {
    // Add row to selection
    for (let c = 0; c < row.length; c++) {
      selectedCells.value.add(`${rowIdx},${c}`)
    }
  } else {
    // Replace selection with row
    selectedCells.value = new Set()
    for (let c = 0; c < row.length; c++) {
      selectedCells.value.add(`${rowIdx},${c}`)
    }
  }
  
  selectedCells.value = new Set(selectedCells.value)
  lastClickedCell.value = { row: rowIdx, col: 0 }
}

// Handle column header click - select entire column
function handleColClick(colIdx: number, event: MouseEvent): void {
  if (event.shiftKey && lastClickedCell.value) {
    const startCol = Math.min(lastClickedCell.value.col, colIdx)
    const endCol = Math.max(lastClickedCell.value.col, colIdx)
    for (let r = 0; r < props.rawGrid.length; r++) {
      for (let c = startCol; c <= endCol; c++) {
        if (props.rawGrid[r] && c < props.rawGrid[r].length) {
          selectedCells.value.add(`${r},${c}`)
        }
      }
    }
  } else if (event.ctrlKey || event.metaKey) {
    // Add column to selection
    for (let r = 0; r < props.rawGrid.length; r++) {
      if (props.rawGrid[r] && colIdx < props.rawGrid[r].length) {
        selectedCells.value.add(`${r},${colIdx}`)
      }
    }
  } else {
    // Replace selection with column
    selectedCells.value = new Set()
    for (let r = 0; r < props.rawGrid.length; r++) {
      if (props.rawGrid[r] && colIdx < props.rawGrid[r].length) {
        selectedCells.value.add(`${r},${colIdx}`)
      }
    }
  }
  
  selectedCells.value = new Set(selectedCells.value)
  selectedCells.value = new Set(selectedCells.value)
  lastClickedCell.value = { row: 0, col: colIdx }

  // In No Header mode, clicking a column header allows renaming ONLY IF it's a simple click (no shift/ctrl)
  // and we want to offer rename functionality immediately or via double click?
  // Let's stick to a specific action or maybe double click.
  // Actually, let's just use the click to select, and provide a Rename button in toolbar?
  // User said: "v teto komponente prosim dej funkcionalitu... Navic budu moct pojmenovat... tak se mi objevi moznost"
  // Let's open rename dialog if No Header Mode is active and user clicks the header of an already selected column?
  // Or just always open on click?
  // Better: Add an edit icon or simple dialog trigger.
}

function handleHeaderCellClick(colIdx: number, event: MouseEvent) {
  if (noHeaderMode.value) {
    // If no header mode, we are selecting the column conceptually. 
    // Let's select it first.
    handleColClick(colIdx, event)
    
    // Check if we should open rename dialog: only if single column selected?
    // Let's use a explicit "Rename" button or icon in the header cell.
    return
  }
  // Normal mode
  handleColClick(colIdx, event)
}

// Get cell value
function getCellValue(rowIdx: number, colIdx: number): string {
  const cell = props.rawGrid[rowIdx]?.[colIdx]
  if (cell === undefined || cell === null) return ''
  return String(cell)
}

// Get selected values as array of strings
const selectedValues = computed(() => {
  const values: string[] = []
  selectedCells.value.forEach(key => {
    const [r, c] = key.split(',').map(Number)
    const val = getCellValue(r, c)
    if (val.trim()) values.push(val.trim())
  })
  return [...new Set(values)] // Deduplicate
})

// Assign selected to table
function assignSelectedToTable(): void {
  selectedCells.value.forEach(key => {
    seriesCells.value.delete(key)
    tableCells.value.add(key)
  })
  tableCells.value = new Set(tableCells.value)
  seriesCells.value = new Set(seriesCells.value)
}

// Assign selected to series
function assignSelectedToSeries(): void {
  selectedCells.value.forEach(key => {
    tableCells.value.delete(key)
    seriesCells.value.add(key)
  })
  tableCells.value = new Set(tableCells.value)
  seriesCells.value = new Set(seriesCells.value)
}

// Clear selection
function clearSelection(): void {
  selectedCells.value = new Set()
  lastClickedCell.value = null
}

// Remove from table
function removeFromTable(key: string): void {
  tableCells.value.delete(key)
  tableCells.value = new Set(tableCells.value)
}

// Remove from series
function removeFromSeries(key: string): void {
  seriesCells.value.delete(key)
  seriesCells.value = new Set(seriesCells.value)
}

// Get assigned headers
const tableHeaders = computed(() => {
  if (noHeaderMode.value) {
    const cols = new Set<number>()
    tableCells.value.forEach(key => cols.add(Number(key.split(',')[1])))
    return Array.from(cols).sort((a, b) => a - b).map(c => renamedHeaders.value.get(c) || colLetter(c))
  }

  const headers: string[] = []
  tableCells.value.forEach(key => {
    const [r, c] = key.split(',').map(Number)
    const val = getCellValue(r, c)
    if (val.trim()) headers.push(val.trim())
  })
  return [...new Set(headers)]
})

const seriesHeaders = computed(() => {
  if (noHeaderMode.value) {
    const cols = new Set<number>()
    seriesCells.value.forEach(key => cols.add(Number(key.split(',')[1])))
    return Array.from(cols).sort((a, b) => a - b).map(c => renamedHeaders.value.get(c) || colLetter(c))
  }

  const headers: string[] = []
  seriesCells.value.forEach(key => {
    const [r, c] = key.split(',').map(Number)
    const val = getCellValue(r, c)
    if (val.trim()) headers.push(val.trim())
  })
  return [...new Set(headers)]
})

// Can apply?
const canApply = computed(() => tableHeaders.value.length > 0 || seriesHeaders.value.length > 0)

// Apply selection
function applySelection(): void {
  emits('apply', {
    tableHeaders: tableHeaders.value,
    seriesHeaders: seriesHeaders.value,
    headerRowIndex: null // In No Header mode (and current mixed mode), we don't pick a specific header row idx to return
  })
  emits('update:modelValue', false)
}

// Check if cell is selected/assigned
function isCellSelected(r: number, c: number): boolean {
  return selectedCells.value.has(`${r},${c}`)
}

function isCellTable(r: number, c: number): boolean {
  return tableCells.value.has(`${r},${c}`)
}

function isCellSeries(r: number, c: number): boolean {
  return seriesCells.value.has(`${r},${c}`)
}

// Column letters A, B, C...
function colLetter(idx: number): string {
  let result = ''
  let n = idx
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}
</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="95vw"
    :hide-footer="false"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div class="d-flex align-center justify-space-between" style="width: 100%;">
        <div class="d-flex align-center" style="gap: 12px;">
          <v-icon color="primary">mdi-table-headers-eye</v-icon>
          <div>
            <div class="text-h6">Ruční výběr hlaviček</div>
            <div class="text-caption text-medium-emphasis">
              Klikni na buňky, řádky nebo sloupce. Shift+klik pro rozsah. Ctrl+klik pro přidání.
            </div>
          </div>
        </div>
        <div class="d-flex align-center" style="gap: 8px;">
          <v-chip size="small" variant="outlined">
            {{ rawGrid.length }} řádků × {{ maxCols }} sloupců
          </v-chip>
          <v-chip v-if="selectedCells.size > 0" size="small" color="primary" variant="flat">
            {{ selectedCells.size }} vybráno
          </v-chip>
        </div>
      </div>
    </template>

    <template #content>
      <div class="picker-layout">
        <!-- Toolbar -->
        <div class="selection-toolbar">
          <div class="d-flex align-center" style="gap: 8px;">
            <v-btn
              size="small"
              color="primary"
              variant="flat"
              :disabled="selectedCells.size === 0"
              prepend-icon="mdi-table"
              @click="assignSelectedToTable"
            >
              → Tabulka hodnot
            </v-btn>
            <v-btn
              size="small"
              color="success"
              variant="flat"
              :disabled="selectedCells.size === 0"
              prepend-icon="mdi-chart-line"
              @click="assignSelectedToSeries"
            >
              → Datová série
            </v-btn>
            
             <!-- Rename button for No Header mode -->
             <v-btn
              v-if="noHeaderMode && selectedCells.size > 0"
              size="small"
              variant="tonal"
              color="secondary"
              prepend-icon="mdi-pencil"
              @click="() => {
                 // Find the first selected column to rename
                 const firstKey = selectedCells.values().next().value
                 if(firstKey) {
                   const c = Number(firstKey.split(',')[1])
                   openRenameDialog(c)
                 }
              }"
            >
              Přejmenovat sloupec
            </v-btn>

            <v-divider vertical class="mx-2" style="height: 24px;" />
             <v-checkbox
              v-model="noHeaderMode"
              label="Bez hlavičky (No Header)"
              density="compact"
              hide-details
              color="warning"
              class="mr-2"
            />
            <v-divider vertical class="mx-2" style="height: 24px;" />
            <v-btn
              size="small"
              variant="text"
              :disabled="selectedCells.size === 0"
              @click="clearSelection"
            >
              Zrušit výběr
            </v-btn>
          </div>
        </div>

        <!-- Alert for No Header Mode -->
        <v-alert
          v-if="noHeaderMode"
          type="warning"
          variant="tonal"
          density="compact"
          icon="mdi-alert-circle-outline"
          class="flex-grow-0"
        >
          <strong>Režim bez hlavičky:</strong> V tomto režimu nejsou data brána jako hlavičky. 
          Vyberte sloupce a přiřaďte je k Tabulce nebo Térii (sloupce budou použity jako pole). 
          Názvy sloupců (A, B...) můžete přejmenovat.
        </v-alert>

        <!-- Grid container -->
        <div ref="gridContainerRef" class="grid-container">
          <table class="data-grid">
            <thead>
              <tr>
                <th class="corner-cell"></th>
                <th
                  v-for="c in maxCols"
                  :key="c - 1"
                  class="col-header"
                  @click="handleHeaderCellClick(c - 1, $event)"
                >
                  {{ noHeaderMode && renamedHeaders.has(c - 1) ? renamedHeaders.get(c - 1) : colLetter(c - 1) }}
                  <v-icon
                    v-if="noHeaderMode"
                    size="x-small"
                    class="ml-1"
                    color="grey"
                    @click.stop="openRenameDialog(c - 1)"
                  >
                    mdi-pencil
                  </v-icon>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIdx) in rawGrid" :key="rowIdx">
                <td class="row-header" @click="handleRowClick(rowIdx, $event)">
                  {{ rowIdx + 1 }}
                </td>
                <td
                  v-for="colIdx in maxCols"
                  :key="colIdx - 1"
                  :class="{
                    'is-selected': isCellSelected(rowIdx, colIdx - 1),
                    'is-table': isCellTable(rowIdx, colIdx - 1),
                    'is-series': isCellSeries(rowIdx, colIdx - 1),
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

        <!-- Assignment panels -->
        <div class="assignment-panels">
          <!-- Table headers -->
          <div class="assignment-panel table-panel">
            <div class="panel-header">
              <v-icon size="18" color="primary" class="mr-1">mdi-table</v-icon>
              <span>Tabulka hodnot ({{ tableHeaders.length }})</span>
            </div>
            <div class="panel-content">
              <v-chip
                v-for="(header, idx) in tableHeaders"
                :key="idx"
                size="small"
                color="primary"
                variant="flat"
                closable
                class="ma-1"
                @click:close="() => {
                  tableCells.forEach(key => {
                    const [r, c] = key.split(',').map(Number)
                    if (getCellValue(r, c) === header) removeFromTable(key)
                  })
                }"
              >
                {{ header }}
              </v-chip>
              <div v-if="tableHeaders.length === 0" class="empty-panel">
                Vyberte buňky a klikněte "→ Tabulka hodnot"
              </div>
            </div>
          </div>


        <!-- Rename Dialog -->
        <v-dialog v-model="showRenameDialog" max-width="400">
          <v-card>
            <v-card-title class="text-h6">Přejmenovat sloupec</v-card-title>
            <v-card-text>
              <v-text-field
                v-model="tempRenameValue"
                label="Název sloupce"
                variant="outlined"
                autofocus
                @keydown.enter="saveColumnName"
              />
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showRenameDialog = false">Zrušit</v-btn>
              <v-btn color="primary" @click="saveColumnName">Uložit</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

          <!-- Series headers -->
          <div class="assignment-panel series-panel">
            <div class="panel-header">
              <v-icon size="18" color="success" class="mr-1">mdi-chart-line</v-icon>
              <span>Datová série ({{ seriesHeaders.length }})</span>
              <v-tooltip location="top">
                <template #activator="{ props }">
                  <v-icon v-bind="props" size="small" class="ml-2" color="success">mdi-information</v-icon>
                </template>
                Datové série jsou obvykle číselné (float). Systém se pokusí typ detekovat.
              </v-tooltip>
            </div>
            <div class="panel-content">
              <v-chip
                v-for="(header, idx) in seriesHeaders"
                :key="idx"
                size="small"
                color="success"
                variant="flat"
                closable
                class="ma-1"
                @click:close="() => {
                  seriesCells.forEach(key => {
                    const [r, c] = key.split(',').map(Number)
                    if (getCellValue(r, c) === header) removeFromSeries(key)
                  })
                }"
              >
                {{ header }}
              </v-chip>
              <div v-if="seriesHeaders.length === 0" class="empty-panel">
                Vyberte buňky a klikněte "→ Datová série"
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <v-btn variant="text" @click="emits('update:modelValue', false)">Zrušit</v-btn>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        :disabled="!canApply"
        @click="applySelection"
      >
        Použít výběr ({{ tableHeaders.length + seriesHeaders.length }} hlaviček)
      </v-btn>
    </template>
  </Dialog>
</template>

<style scoped>
.picker-layout {
  display: flex;
  flex-direction: column;
  height: 70vh;
  gap: 12px;
}

.selection-toolbar {
  flex-shrink: 0;
  padding: 8px 0;
  border-bottom: 1px solid #e0e0e0;
}

.grid-container {
  flex: 1;
  overflow: auto;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fff;
}

.data-grid {
  border-collapse: collapse;
  font-size: 11px;
  min-width: 100%;
}

.data-grid th,
.data-grid td {
  border: 1px solid #e8e8e8;
  padding: 4px 6px;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}

.corner-cell {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 3;
  background: #f5f5f5;
  min-width: 40px;
}

.col-header {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f5f5f5;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  min-width: 50px;
}

.col-header:hover {
  background: #e3f2fd;
}

.row-header {
  position: sticky;
  left: 0;
  z-index: 1;
  background: #f5f5f5;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  min-width: 40px;
  color: #666;
}

.row-header:hover {
  background: #e3f2fd;
}

.data-grid td:not(.row-header) {
  cursor: cell;
  transition: background 0.1s;
}

.data-grid td:not(.row-header):hover {
  background: #f0f7ff;
}

.data-grid td.is-selected {
  background: #bbdefb !important;
  outline: 2px solid #1976d2;
  outline-offset: -2px;
}

.data-grid td.is-table {
  background: #e3f2fd !important;
  border-color: #1976d2;
}

.data-grid td.is-series {
  background: #e8f5e9 !important;
  border-color: #4caf50;
}

.data-grid td.is-empty {
  color: #ccc;
}

.assignment-panels {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.assignment-panel {
  flex: 1;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #fafafa;
  font-size: 13px;
  font-weight: 500;
}

.table-panel {
  border-color: rgb(var(--v-theme-primary));
}

.table-panel .panel-header {
  background: rgba(var(--v-theme-primary), 0.08);
}

.series-panel {
  border-color: rgb(var(--v-theme-success));
}

.series-panel .panel-header {
  background: rgba(var(--v-theme-success), 0.08);
}

.panel-content {
  padding: 8px;
  min-height: 60px;
  max-height: 100px;
  overflow-y: auto;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
}

.empty-panel {
  color: #999;
  font-size: 12px;
  padding: 12px;
  text-align: center;
  width: 100%;
}
</style>
