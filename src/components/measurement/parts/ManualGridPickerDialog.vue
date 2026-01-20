<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import Dialog from '@/components/Dialog.vue'

const props = defineProps<{
  modelValue: boolean
  gridData: { headers: string[], rows: (string | number)[][] } | null
  targetFieldName: string
  recordCount: number
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'apply', values: (string | number)[]): void
}>()

// Selected cells: Set of "row-col" keys
const selectedCells = ref<Set<string>>(new Set())
const selectionOrder = ref<string[]>([]) // Track order of selection

// Ref to grid container for scrolling
const gridContainerRef = ref<HTMLElement | null>(null)

// Find column index that matches target field name
const highlightedColumnIndex = computed(() => {
  if (!props.gridData) return -1
  const lowerTarget = props.targetFieldName.toLowerCase().trim()
  return props.gridData.headers.findIndex(h =>
    h.toLowerCase().trim() === lowerTarget ||
    h.toLowerCase().includes(lowerTarget) ||
    lowerTarget.includes(h.toLowerCase())
  )
})

// Reset selection when dialog opens and scroll to highlighted column
watch(() => props.modelValue, async (open) => {
  if (open) {
    selectedCells.value = new Set()
    selectionOrder.value = []

    // Wait for DOM to update, then scroll to highlighted column
    await nextTick()
    scrollToHighlightedColumn()
  }
})

function cellKey(row: number, col: number): string {
  return `${row}-${col}`
}

function isSelected(row: number, col: number): boolean {
  return selectedCells.value.has(cellKey(row, col))
}

function getSelectionIndex(row: number, col: number): number {
  const key = cellKey(row, col)
  return selectionOrder.value.indexOf(key) + 1
}

function toggleCell(row: number, col: number, event: MouseEvent): void {
  const key = cellKey(row, col)

  if (event.shiftKey && selectionOrder.value.length > 0) {
    // Range selection: from last selected to current
    const lastKey = selectionOrder.value[selectionOrder.value.length - 1]
    const [lastRow, lastCol] = lastKey?.split('-').map(Number)

    const minRow = Math.min(lastRow!, row)
    const maxRow = Math.max(lastRow!, row)
    const minCol = Math.min(lastCol!, col)
    const maxCol = Math.max(lastCol!, col)

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const k = cellKey(r, c)
        if (!selectedCells.value.has(k)) {
          selectedCells.value.add(k)
          selectionOrder.value.push(k)
        }
      }
    }
  } else {
    // Single toggle
    if (selectedCells.value.has(key)) {
      selectedCells.value.delete(key)
      selectionOrder.value = selectionOrder.value.filter(k => k !== key)
    } else {
      selectedCells.value.add(key)
      selectionOrder.value.push(key)
    }
  }
}

function selectColumn(colIndex: number): void {
  if (!props.gridData) return

  // Clear current selection
  selectedCells.value = new Set()
  selectionOrder.value = []

  // Select all cells in this column
  props.gridData.rows.forEach((_, rowIndex) => {
    const key = cellKey(rowIndex, colIndex)
    selectedCells.value.add(key)
    selectionOrder.value.push(key)
  })
}

function clearSelection(): void {
  selectedCells.value = new Set()
  selectionOrder.value = []
}

function applySelection(): void {
  if (!props.gridData) return

  const values: (string | number)[] = []
  for (const key of selectionOrder.value) {
    const [row, col] = key.split('-').map(Number)
    const cellValue = props.gridData.rows[row!]?.[col!]
    if (cellValue !== undefined) {
      values.push(cellValue)
    }
  }

  emits('apply', values)
  emits('update:modelValue', false)
}

const selectionStatus = computed(() => {
  const selected = selectionOrder.value.length
  const needed = props.recordCount
  if (selected === 0) return 'Vyberte buňky kliknutím'
  if (selected < needed) return `Vybráno ${selected} z ${needed} potřebných`
  if (selected === needed) return `Vybráno ${selected} ✓`
  return `Vybráno ${selected} (přebytek ${selected - needed})`
})

const canApply = computed(() => selectionOrder.value.length > 0)

/**
 * Scroll the grid container to show the highlighted column
 * Handles edge cases:
 * - No highlighted column found (-1)
 * - Grid container ref not available
 * - Column already visible (first few columns)
 * - Smooth scroll for better UX
 */
function scrollToHighlightedColumn(): void {
  const colIdx = highlightedColumnIndex.value

  // Edge case: No matching column found, skip scrolling
  if (colIdx < 0) return

  // Edge case: First few columns are already visible, no need to scroll horizontally
  if (colIdx <= 1) return

  const container = gridContainerRef.value
  if (!container) return

  // Find the header cell to scroll to
  const headerCells = container.querySelectorAll<HTMLElement>('thead th')
  // +1 because first column is row number (#)
  const targetCell = headerCells[colIdx + 1]

  if (!targetCell) return

  // Calculate scroll position to center the column (if possible)
  const containerRect = container.getBoundingClientRect()
  const cellRect = targetCell.getBoundingClientRect()

  // Calculate target scroll position - center the column in the visible area
  const targetScrollLeft = container.scrollLeft + (cellRect.left - containerRect.left)
    - (containerRect.width / 2) + (cellRect.width / 2)

  // Clamp to valid scroll range
  const maxScrollLeft = container.scrollWidth - containerRect.width
  const clampedScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft))

  // Smooth scroll to the target position
  container.scrollTo({
    left: clampedScrollLeft,
    behavior: 'smooth'
  })
}
</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="900px"
    :hide-footer="false"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div
        class="d-flex align-center"
        style="gap: 12px;"
      >
        <v-icon color="primary">
          mdi-table-edit
        </v-icon>
        <div>
          <div class="text-h6">
            Ruční výběr dat
          </div>
          <div class="text-caption text-medium-emphasis">
            Pole: <strong>{{ targetFieldName }}</strong>
          </div>
        </div>
      </div>
    </template>

    <template #content>
      <div
        v-if="!gridData || gridData.rows.length === 0"
        class="text-center py-8 text-medium-emphasis"
      >
        <v-icon
          size="48"
          class="mb-2"
        >
          mdi-table-off
        </v-icon>
        <div>Žádná importovaná data</div>
      </div>

      <div
        v-else
        class="grid-picker"
      >
        <!-- Instructions -->
        <div class="picker-instructions mb-3">
          <v-icon
            size="16"
            class="mr-1"
          >
            mdi-information-outline
          </v-icon>
          Klikněte na buňky pro výběr. Shift+klik pro rozsah. Vybrané hodnoty se přiřadí postupně k záznamům.
        </div>

        <!-- Selection status -->
        <div
          class="selection-status mb-3"
          :class="{ 'has-enough': selectionOrder.length >= recordCount }"
        >
          {{ selectionStatus }}
          <v-btn
            v-if="selectionOrder.length > 0"
            size="small"
            variant="text"
            @click="clearSelection"
          >
            Zrušit výběr
          </v-btn>
        </div>

        <!-- Grid table -->
        <div
          ref="gridContainerRef"
          class="grid-container"
        >
          <table class="picker-table">
            <thead>
              <tr>
                <th class="row-num">
                  #
                </th>
                <th
                  v-for="(header, colIdx) in gridData.headers"
                  :key="colIdx"
                  :class="{ 'highlighted-col': colIdx === highlightedColumnIndex }"
                  title="Klikni pro výběr celého sloupce"
                  @click="selectColumn(colIdx)"
                >
                  {{ header }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIdx) in gridData.rows"
                :key="rowIdx"
              >
                <td class="row-num">
                  {{ rowIdx + 1 }}
                </td>
                <td
                  v-for="(cell, colIdx) in row"
                  :key="colIdx"
                  :class="{
                    'highlighted-col': colIdx === highlightedColumnIndex,
                    'is-selected': isSelected(rowIdx, colIdx)
                  }"
                  @click="toggleCell(rowIdx, colIdx, $event)"
                >
                  <span class="cell-value">{{ cell }}</span>
                  <span
                    v-if="isSelected(rowIdx, colIdx)"
                    class="selection-badge"
                  >
                    {{ getSelectionIndex(rowIdx, colIdx) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <template #footer>
      <v-btn
        variant="text"
        @click="emits('update:modelValue', false)"
      >
        Zrušit
      </v-btn>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        :disabled="!canApply"
        @click="applySelection"
      >
        Použít ({{ selectionOrder.length }})
      </v-btn>
    </template>
  </Dialog>
</template>

<style scoped>
.grid-picker {
  max-height: 60vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.picker-instructions {
  font-size: 13px;
  color: #666;
  background: #f5f5f5;
  padding: 8px 12px;
  border-radius: 6px;
}

.selection-status {
  font-size: 14px;
  font-weight: 500;
  color: #666;
  display: flex;
  align-items: center;
  gap: 12px;
}

.selection-status.has-enough {
  color: #2e7d32;
}

.grid-container {
  flex: 1;
  overflow: auto;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.picker-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.picker-table th,
.picker-table td {
  padding: 6px 10px;
  border: 1px solid #e8e8e8;
  text-align: left;
  white-space: nowrap;
  position: relative;
  cursor: pointer;
  user-select: none;
}

.picker-table th {
  background: #f5f5f5;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 2;
}

.picker-table th:hover {
  background: #e3f2fd;
}

.picker-table td:hover {
  background: #e8f5e9;
}

.row-num {
  width: 40px;
  text-align: center;
  color: #999;
  font-size: 11px;
  background: #fafafa !important;
  cursor: default !important;
}

.highlighted-col {
  background: rgba(25, 118, 210, 0.08) !important;
}

.highlighted-col.is-selected {
  background: rgba(25, 118, 210, 0.25) !important;
}

.is-selected {
  background: #c8e6c9 !important;
  font-weight: 500;
}

.cell-value {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  vertical-align: middle;
}

.selection-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  background: #1976d2;
  color: white;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
