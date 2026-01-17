<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import SeriesDataPicker, { type PickerResult } from './SeriesDataPicker.vue'
import { parseImportedMeasurementFile } from '@/utils/import/importCompatibility'
import { Chart, registerables } from 'chart.js'

// Register Chart.js components
Chart.register(...registerables)

// Column definition from template
export interface SeriesColumn {
  name: string
  type: 'float' | 'int' | 'text'
  required: boolean
}

export interface SeriesData {
  seriesType: string
  seriesName?: string
  seriesScope?: 'record' | 'summary'  // 'record' = linked to record, 'summary' = measurement-level average
  linkedRecordIndex?: number | null
  linkedRecordDescription?: string
  // Dynamic columns from template - if empty, defaults to X/Y
  columns?: SeriesColumn[]
  // Data rows - each row is a map of column name to value
  data: Record<string, number | string | null>[]
}

const props = defineProps<{
  series: SeriesData[]
  editable?: boolean
  recordOptions?: Array<{ title: string; value: number }>
  currentRecordIndex?: number | null
  // Template field definitions for series blocks
  seriesFieldDefinitions?: SeriesColumn[]
  // Raw imported data for manual value picking
  rawImportedData?: string[][]
  // Show validation errors on empty required fields
  showValidation?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:series', val: SeriesData[]): void
  (e: 'add-series'): void
  (e: 'duplicate-series'): void
  (e: 'remove-series', index: number): void
  (e: 'add-row', seriesIndex: number): void
  (e: 'remove-row', seriesIndex: number, rowIndex: number): void
}>()

const expandedPanels = ref<number[]>([0])

// Data picker dialog state
const pickerOpen = ref(false)
const pickerSeriesIndex = ref<number>(0)

// External file import state
const seriesFileInputRef = ref<HTMLInputElement | null>(null)
const externalFileData = ref<string[][] | null>(null)
const fileImportBusy = ref(false)

// Drag-and-drop state
const dragState = ref<{ seriesIdx: number; fromIdx: number } | null>(null)
const dragOverIdx = ref<number | null>(null)

// Check if any series has at least one non-null value entered
const hasAnyDataInSeries = computed<boolean>(() => {
  return props.series.some(s => 
    s.data.some(row => 
      Object.values(row).some(val => val !== null && val !== '')
    )
  )
})

const seriesTypeOptions = [
  { title: 'X Intensity', value: 'X_INTENSITY' },
  { title: 'Size Distribution', value: 'SIZE_DISTRIBUTION' },
  { title: 'Volume Distribution', value: 'VOLUME_DISTRIBUTION' },
  { title: 'Datová série', value: 'DATA_SERIES' },
  { title: 'Other', value: 'OTHER' }
]

// Get columns for a series - either from series.columns, props.seriesFieldDefinitions, or default X/Y
function getColumnsForSeries(s: SeriesData): SeriesColumn[] {
  // Priority: 1. series own columns, 2. prop definitions, 3. default X/Y
  if (s.columns && s.columns.length > 0) {
    return s.columns
  }
  if (props.seriesFieldDefinitions && props.seriesFieldDefinitions.length > 0) {
    return props.seriesFieldDefinitions
  }
  // Default fallback - classic X/Y
  return [
    { name: 'X', type: 'float', required: true },
    { name: 'Y', type: 'float', required: true }
  ]
}

function getSeriesTypeLabel(type: string): string {
  return seriesTypeOptions.find(o => o.value === type)?.title || type
}

function updateSeriesField(seriesIdx: number, field: keyof SeriesData, value: unknown): void {
  const updated = [...props.series]
  updated[seriesIdx] = { ...updated[seriesIdx], [field]: value } as SeriesData
  emits('update:series', updated)
}

function updateDataPoint(seriesIdx: number, rowIdx: number, colName: string, value: string): void {
  const columns = getColumnsForSeries(props.series[seriesIdx])
  const col = columns.find(c => c.name === colName)
  
  let parsedValue: number | string | null
  
  // Handle empty input - set to null
  if (value.trim() === '') {
    parsedValue = null
  } else if (col && (col.type === 'float' || col.type === 'int')) {
    // Try to parse as number
    const num = parseFloat(value.replace(',', '.'))
    // If valid number, use it; otherwise keep as string (will show validation error)
    parsedValue = isNaN(num) ? value : num
  } else {
    parsedValue = value
  }

  const updated = [...props.series]
  const newData = [...updated[seriesIdx].data]
  newData[rowIdx] = { ...newData[rowIdx], [colName]: parsedValue }
  updated[seriesIdx] = { ...updated[seriesIdx], data: newData }
  emits('update:series', updated)
}

function addRow(seriesIdx: number): void {
  const updated = [...props.series]
  const columns = getColumnsForSeries(updated[seriesIdx])
  
  // Create empty row with null values - user will fill in data
  const newRow: Record<string, number | string | null> = {}
  columns.forEach(col => {
    newRow[col.name] = null  // Empty placeholder, not 0
  })
  
  updated[seriesIdx] = {
    ...updated[seriesIdx],
    data: [...updated[seriesIdx].data, newRow]
  }
  emits('update:series', updated)
}

function removeRow(seriesIdx: number, rowIdx: number): void {
  const updated = [...props.series]
  const newData = updated[seriesIdx].data.filter((_, i) => i !== rowIdx)
  updated[seriesIdx] = { ...updated[seriesIdx], data: newData }
  emits('update:series', updated)
}

// Remove column confirmation state
const removeColumnConfirmOpen = ref(false)
const removeColumnSeriesIdx = ref(0)
const removeColumnName = ref('')

function askRemoveColumn(seriesIdx: number, columnName: string): void {
  removeColumnSeriesIdx.value = seriesIdx
  removeColumnName.value = columnName
  removeColumnConfirmOpen.value = true
}

function confirmRemoveColumn(): void {
  const seriesIdx = removeColumnSeriesIdx.value
  const columnName = removeColumnName.value
  
  const updated = [...props.series]
  const series = updated[seriesIdx]
  
  // Remove from columns array
  const newColumns = (series.columns || getColumnsForSeries(series))
    .filter(col => col.name !== columnName)
  
  // Remove column data from all rows
  const newData = series.data.map(row => {
    const newRow = { ...row }
    delete newRow[columnName]
    return newRow
  })
  
  updated[seriesIdx] = { 
    ...series, 
    columns: newColumns,
    data: newData 
  }
  emits('update:series', updated)
  removeColumnConfirmOpen.value = false
}

// Add column dialog state
const addColumnDialogOpen = ref(false)
const addColumnSeriesIdx = ref(0)
const newColumnName = ref('')
const newColumnType = ref<'float' | 'int' | 'text'>('float')
const newColumnRequired = ref(false)

function openAddColumnDialog(seriesIdx: number): void {
  addColumnSeriesIdx.value = seriesIdx
  newColumnName.value = ''
  newColumnType.value = 'float'
  newColumnRequired.value = false
  addColumnDialogOpen.value = true
}

function confirmAddColumn(): void {
  if (!newColumnName.value.trim()) return
  
  const sIdx = addColumnSeriesIdx.value
  const updated = [...props.series]
  const series = updated[sIdx]
  
  // Get current columns
  const currentColumns = series.columns || getColumnsForSeries(series)
  
  // Add new column
  const newColumn: SeriesColumn = {
    name: newColumnName.value.trim(),
    type: newColumnType.value,
    required: newColumnRequired.value
  }
  
  // Add null values to all existing rows
  const newData = series.data.map(row => ({
    ...row,
    [newColumn.name]: null
  }))
  
  updated[sIdx] = {
    ...series,
    columns: [...currentColumns, newColumn],
    data: newData
  }
  
  emits('update:series', updated)
  addColumnDialogOpen.value = false
}

// Native HTML5 Drag-and-drop handlers
function onDragStart(seriesIdx: number, rowIdx: number, e: DragEvent): void {
  dragState.value = { seriesIdx, fromIdx: rowIdx }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(rowIdx))
  }
  // Add ghost class to dragged element
  const target = e.target as HTMLElement
  setTimeout(() => target.classList.add('dragging'), 0)
}

function onDragEnd(e: DragEvent): void {
  dragState.value = null
  dragOverIdx.value = null
  const target = e.target as HTMLElement
  target.classList.remove('dragging')
}

function onDragOver(rowIdx: number, e: DragEvent): void {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  dragOverIdx.value = rowIdx
}

function onDragLeave(): void {
  dragOverIdx.value = null
}

function onDrop(seriesIdx: number, toIdx: number, e: DragEvent): void {
  e.preventDefault()
  if (!dragState.value || dragState.value.seriesIdx !== seriesIdx) return

  const fromIdx = dragState.value.fromIdx
  if (fromIdx === toIdx) return

  const updated = [...props.series]
  const newData = [...updated[seriesIdx].data]
  const [moved] = newData.splice(fromIdx, 1)
  newData.splice(toIdx, 0, moved)
  updated[seriesIdx] = { ...updated[seriesIdx], data: newData }
  emits('update:series', updated)

  dragState.value = null
  dragOverIdx.value = null
}

// --- Data Picker ---
function openDataPicker(seriesIndex: number): void {
  pickerSeriesIndex.value = seriesIndex
  externalFileData.value = null  // Use rawImportedData from props
  pickerOpen.value = true
}

// --- External File Import ---
function openFileImport(seriesIndex: number): void {
  pickerSeriesIndex.value = seriesIndex
  seriesFileInputRef.value?.click()
}

async function onSeriesFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  
  fileImportBusy.value = true
  try {
    const structure = await parseImportedMeasurementFile(file)
    
    // If file contains series blocks, apply first one directly
    if (structure.series.length > 0) {
      const imported = structure.series[0]
      const sIdx = pickerSeriesIndex.value
      const updated = [...props.series]
      const series = updated[sIdx]
      const columns = getColumnsForSeries(series)
      
      // Get imported column names from the imported series
      const importedColumns = imported.columns || [
        { name: 'X Intensity', type: 'float' as const, required: true },
        { name: 'Intensity', type: 'float' as const, required: true }
      ]
      
      // Convert imported series data to our format
      // IMPORTANT: Preserve existing row data for non-imported columns
      const existingData = series.data || []
      const newData: Record<string, number | string | null>[] = []
      
      for (let i = 0; i < imported.data.length; i++) {
        const point = imported.data[i]
        // Start with existing row data (if exists) to preserve other columns
        const baseRow = existingData[i] ? { ...existingData[i] } : {}
        
        // Initialize all columns with existing values or null
        for (const col of columns) {
          if (!(col.name in baseRow)) {
            baseRow[col.name] = null
          }
        }
        
        if ('x' in point && 'y' in point) {
          // XY format - map to first two imported columns
          const xColName = importedColumns[0]?.name || columns[0]?.name || 'X'
          const yColName = importedColumns[1]?.name || columns[1]?.name || 'Y'
          baseRow[xColName] = point.x
          baseRow[yColName] = point.y
        } else {
          // Record format - merge imported values
          Object.assign(baseRow, point)
        }
        
        newData.push(baseRow)
      }
      
      updated[sIdx] = {
        ...series,
        data: newData,
        seriesScope: 'summary',  // Mark as measurement-level since from external file
        linkedRecordDescription: imported.linkedRecordDescription || `Imported from ${file.name}`
      }
      emits('update:series', updated)
    } else if (structure.blocks.length > 0) {
      // Use first block data for manual picking
      const block = structure.blocks[0]
      externalFileData.value = [block.headers, ...block.rows]
      pickerOpen.value = true
    }
  } finally {
    fileImportBusy.value = false
    // Reset input for future use
    if (input) input.value = ''
  }
}

function applyPickerResult(result: PickerResult): void {
  const sIdx = pickerSeriesIndex.value
  const updated = [...props.series]
  const series = updated[sIdx]
  const columns = getColumnsForSeries(series)

  // Use new columnValues if available, otherwise fallback to xValues/yValues
  if (result.columnValues && Object.keys(result.columnValues).length > 0) {
    // Find max length across all columns
    let maxLen = 0
    for (const vals of Object.values(result.columnValues)) {
      maxLen = Math.max(maxLen, vals.length)
    }
    
    // Build data rows from all column values
    const newData: Record<string, number | string | null>[] = []
    for (let i = 0; i < maxLen; i++) {
      const row: Record<string, number | string | null> = {}
      for (const col of columns) {
        row[col.name] = result.columnValues[col.name]?.[i] ?? null
      }
      newData.push(row)
    }
    
    updated[sIdx] = { 
      ...series, 
      data: newData,
      columns
    }
  } else {
    // Legacy fallback for X/Y
    const maxLen = Math.max(result.xValues?.length || 0, result.yValues?.length || 0)
    const newData: Record<string, number | string | null>[] = []
    
    for (let i = 0; i < maxLen; i++) {
      newData.push({
        [columns[0]?.name || 'X']: result.xValues?.[i] ?? null,
        [columns[1]?.name || 'Y']: result.yValues?.[i] ?? null
      })
    }
    
    updated[sIdx] = { 
      ...series, 
      data: newData,
      columns
    }
  }
  
  emits('update:series', updated)
}

// --- Chart State ---
const chartRefs = ref<Map<number, HTMLCanvasElement>>(new Map())
const chartInstances = ref<Map<number, Chart>>(new Map())
const chartXAxis = ref<Map<number, string>>(new Map())  // seriesIdx -> selected X column
const chartYAxes = ref<Map<number, Set<string>>>(new Map())  // seriesIdx -> selected Y columns
const showChart = ref<Map<number, boolean>>(new Map())

// Chart colors for multiple Y series
const CHART_COLORS = [
  'rgb(75, 192, 192)',
  'rgb(255, 99, 132)',
  'rgb(54, 162, 235)',
  'rgb(255, 205, 86)',
  'rgb(153, 102, 255)',
  'rgb(255, 159, 64)'
]

function toggleChart(sIdx: number): void {
  const current = showChart.value.get(sIdx) ?? false
  showChart.value.set(sIdx, !current)
  if (!current) {
    // Initialize chart axes with first column as X, rest as Y
    const columns = getColumnsForSeries(props.series[sIdx])
    if (!chartXAxis.value.has(sIdx) && columns.length > 0) {
      chartXAxis.value.set(sIdx, columns[0].name)
    }
    if (!chartYAxes.value.has(sIdx) && columns.length > 1) {
      chartYAxes.value.set(sIdx, new Set([columns[1].name]))
    }
    nextTick(() => updateChart(sIdx))
  }
}

function setChartXAxis(sIdx: number, columnName: string): void {
  const oldX = chartXAxis.value.get(sIdx)
  chartXAxis.value.set(sIdx, columnName)
  
  // Remove new X from Y axes if it was there
  const ySet = chartYAxes.value.get(sIdx)
  if (ySet) {
    ySet.delete(columnName)
    
    // If Y set is now empty, add the old X as Y (swap)
    if (ySet.size === 0 && oldX && oldX !== columnName) {
      ySet.add(oldX)
    }
    
    // If still empty, add first available column that's not X
    if (ySet.size === 0) {
      const columns = getColumnsForSeries(props.series[sIdx])
      const firstAvailable = columns.find(c => c.name !== columnName)
      if (firstAvailable) {
        ySet.add(firstAvailable.name)
      }
    }
  }
  
  updateChart(sIdx)
}

function toggleChartYAxis(sIdx: number, columnName: string): void {
  let ySet = chartYAxes.value.get(sIdx)
  if (!ySet) {
    ySet = new Set()
    chartYAxes.value.set(sIdx, ySet)
  }
  if (ySet.has(columnName)) {
    ySet.delete(columnName)
  } else {
    ySet.add(columnName)
  }
  updateChart(sIdx)
}

function setChartRef(sIdx: number, el: HTMLCanvasElement | null): void {
  if (el) {
    chartRefs.value.set(sIdx, el)
    // Auto-update chart when canvas is mounted
    nextTick(() => updateChart(sIdx))
  } else {
    // Cleanup when unmounted
    const existing = chartInstances.value.get(sIdx)
    if (existing) {
      existing.destroy()
      chartInstances.value.delete(sIdx)
    }
    chartRefs.value.delete(sIdx)
  }
}

function updateChart(sIdx: number): void {
  const canvas = chartRefs.value.get(sIdx)
  if (!canvas) return
  
  const series = props.series[sIdx]
  if (!series) return
  
  const xCol = chartXAxis.value.get(sIdx)
  const yColsSet = chartYAxes.value.get(sIdx)
  if (!xCol || !yColsSet || yColsSet.size === 0) return
  
  // Get data
  const xData = series.data.map(row => {
    const val = row[xCol]
    return typeof val === 'number' ? val : parseFloat(String(val) || '0')
  }).filter(v => !isNaN(v))
  
  const datasets = Array.from(yColsSet).map((yCol, i) => {
    const yData = series.data.map(row => {
      const val = row[yCol]
      return typeof val === 'number' ? val : parseFloat(String(val) || '0')
    })
    return {
      label: yCol,
      data: yData,
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '33',
      tension: 0.3,
      pointRadius: 2
    }
  })
  
  // Destroy existing chart
  const existing = chartInstances.value.get(sIdx)
  if (existing) existing.destroy()
  
  // Create new chart
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: xData,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          title: { display: true, text: xCol },
          ticks: {
            autoSkip: false, // Show all labels
            maxRotation: 45,
            minRotation: 0
          },
          grid: {
            display: false
          }
        },
        y: {
          title: { display: true, text: 'Hodnota' },
          grid: {
            color: '#f0f0f0'
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            usePointStyle: true,
            boxWidth: 8
          }
        },
        tooltip: {
          usePointStyle: true,
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                label += context.parsed.y;
              }
              return label;
            }
          }
        }
      },
      elements: {
        point: {
          radius: 3,
          hoverRadius: 6
        },
        line: {
          tension: 0.2,
          borderWidth: 2
        }
      }
    }
  })
  
  chartInstances.value.set(sIdx, chart)
}

function getChartInnerStyle(sIdx: number): Record<string, string> {
  const series = props.series[sIdx]
  if (!series || !series.data.length) return { height: '350px', width: '100%', position: 'relative' }
  
  const count = series.data.length
  // If we have many points, force a larger width to enable scrolling
  if (count > 20) {
    // 35px per point
    return { height: '350px', width: `${Math.max(100, count * 35)}px`, position: 'relative' }
  }
  return { height: '350px', width: '100%', position: 'relative' }
}

// Reactively update visible charts when data changes
watch(() => props.series, () => {
  showChart.value.forEach((visible, sIdx) => {
    if (visible && chartInstances.value.has(sIdx)) {
      updateChart(sIdx)
    }
  })
}, { deep: true })

// Cleanup charts on unmount
onUnmounted(() => {
  chartInstances.value.forEach(chart => chart.destroy())
})
</script>

<template>
  <div class="series-section">
    <!-- Series Section Header -->
    <div class="series-header">
      <div class="series-title">
        <div class="series-icon">
          <v-icon size="15" color="white">mdi-chart-bell-curve-cumulative</v-icon>
        </div>
        <span>Datové série</span>
      </div>
      
      <div class="series-spacer"></div>
      
      <div class="series-actions" v-if="editable">
        <button type="button" class="series-btn tonal-purple" @click="emits('duplicate-series')"
          v-if="series.length > 0">
          <v-icon size="16">mdi-content-duplicate</v-icon>
          Duplikovat
        </button>
        <button type="button" class="series-btn tonal-error" @click="emits('remove-series', series.length - 1)"
          v-if="series.length > 0">
          <v-icon size="16">mdi-delete-outline</v-icon>
          Smazat
        </button>
        <div class="series-divider" v-if="series.length > 0"></div>
        <button type="button" class="series-btn primary-purple" @click="emits('add-series')">
          <v-icon size="16">mdi-plus</v-icon>
          Přidat sérii
        </button>
      </div>
    </div>

    <v-expansion-panels
      v-if="series.length"
      v-model="expandedPanels"
      multiple
      variant="accordion"
    >
      <v-expansion-panel
        v-for="(s, sIdx) in series"
        :key="sIdx"
        :value="sIdx"
      >
        <v-expansion-panel-title>
          <div
            class="d-flex align-center"
            style="gap: 12px;"
          >
            <v-icon
              size="20"
              color="primary"
            >
              mdi-chart-line
            </v-icon>
            <span class="font-weight-medium">{{ s.seriesName || getSeriesTypeLabel(s.seriesType) }}</span>
            <v-chip
              v-if="s.linkedRecordIndex"
              size="small"
              variant="outlined"
            >
              Record {{ s.linkedRecordIndex }}
            </v-chip>
            <span class="text-caption text-medium-emphasis">
              {{ s.data.length }} polí
            </span>
          </div>
        </v-expansion-panel-title>

        <v-expansion-panel-text>
          <!-- Metadata -->
          <div
            class="d-flex flex-wrap mb-3"
            style="gap: 12px;"
          >
            <v-select
              v-if="editable"
              :model-value="s.seriesType"
              :items="seriesTypeOptions"
              item-title="title"
              item-value="value"
              label="Typ"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 180px;"
              @update:model-value="v => updateSeriesField(sIdx, 'seriesType', v)"
            />
            <v-text-field
              v-if="editable"
              :model-value="s.seriesName || ''"
              label="Název"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 200px;"
              @update:model-value="v => updateSeriesField(sIdx, 'seriesName', v)"
            />
            <v-select
              v-if="editable"
              :model-value="s.linkedRecordIndex"
              :items="[{ title: 'Nepřiřazeno', value: null }, ...(recordOptions || [])]"
              item-title="title"
              item-value="value"
              label="Propojený záznam"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 180px;"
              @update:model-value="v => updateSeriesField(sIdx, 'linkedRecordIndex', v)"
            />
            <v-text-field
              v-if="editable"
              :model-value="s.linkedRecordDescription || ''"
              label="Popis"
              density="compact"
              variant="outlined"
              hide-details
              style="flex: 1; min-width: 200px;"
              @update:model-value="v => updateSeriesField(sIdx, 'linkedRecordDescription', v)"
            />
            <!-- Data picker button -->
            <v-btn
              v-if="editable && rawImportedData && rawImportedData.length > 0"
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-table-arrow-left"
              @click="openDataPicker(sIdx)"
            >
              Vybrat hodnoty
            </v-btn>
            <!-- External file import button -->
            <v-btn
              v-if="editable"
              size="small"
              variant="outlined"
              color="secondary"
              prepend-icon="mdi-file-upload"
              :loading="fileImportBusy"
              @click="openFileImport(sIdx)"
            >
              Import ze souboru
            </v-btn>
          </div>

          <!-- Data table -->
          <div class="series-table-wrapper">
            <v-table
              density="compact"
              class="series-table"
            >
              <thead>
                <tr>
                  <th
                    class="text-left"
                    style="width: 60px;"
                  >
                    #
                  </th>
                  <th 
                    v-for="col in getColumnsForSeries(s)" 
                    :key="col.name"
                    class="text-left"
                  >
                    <div class="d-flex align-center" style="gap: 4px;">
                      {{ col.name }}
                      <span v-if="col.required" class="text-error">*</span>
                      <v-btn
                        v-if="editable && getColumnsForSeries(s).length > 1"
                        size="x-small"
                        variant="text"
                        icon="mdi-close"
                        density="compact"
                        color="grey"
                        class="column-remove-btn"
                        @click.stop="askRemoveColumn(sIdx, col.name)"
                      />
                    </div>
                  </th>
                  <!-- Add column button -->
                  <th v-if="editable" style="width: 40px;">
                    <v-btn
                      size="x-small"
                      variant="text"
                      icon="mdi-plus"
                      density="compact"
                      color="primary"
                      title="Přidat sloupec"
                      @click="openAddColumnDialog(sIdx)"
                    />
                  </th>
                  <th
                    v-if="editable"
                    style="width: 50px;"
                  />
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(point, pIdx) in s.data"
                  :key="`row-${sIdx}-${pIdx}`"
                  class="draggable-row"
                  :class="{
                    'drag-over': dragOverIdx === pIdx && dragState?.seriesIdx === sIdx,
                    'is-dragging': dragState?.fromIdx === pIdx && dragState?.seriesIdx === sIdx
                  }"
                  :draggable="editable"
                  @dragstart="e => onDragStart(sIdx, pIdx, e)"
                  @dragend="onDragEnd"
                  @dragover="e => onDragOver(pIdx, e)"
                  @dragleave="onDragLeave"
                  @drop="e => onDrop(sIdx, pIdx, e)"
                >
                  <td
                    class="text-caption text-medium-emphasis drag-handle"
                    style="cursor: grab;"
                  >
                    <v-icon size="14" class="mr-1">mdi-drag</v-icon>
                    {{ pIdx + 1 }}
                  </td>
                  <td v-for="col in getColumnsForSeries(s)" :key="`cell-${pIdx}-${col.name}`">
                    <input
                      v-if="editable"
                      type="text"
                      :value="point[col.name] === null ? '' : point[col.name]"
                      :class="['inline-edit', { 'empty-required': point[col.name] === null && col.required && props.showValidation }]"
                      :placeholder="col.type === 'float' ? '0.00' : col.type === 'int' ? '0' : ''"
                      @blur="e => updateDataPoint(sIdx, pIdx, col.name, (e.target as HTMLInputElement).value)"
                      @keydown.enter="e => (e.target as HTMLInputElement).blur()"
                    >
                    <span v-else>{{ point[col.name] ?? '—' }}</span>
                  </td>
                  <td v-if="editable">
                    <v-btn
                      size="small"
                      variant="text"
                      icon="mdi-close"
                      color="error"
                      @click="removeRow(sIdx, pIdx)"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <!-- Chart Section -->
          <div class="chart-section mt-4">
            <div class="d-flex align-center mb-2" style="gap: 8px;">
              <v-btn
                size="small"
                :variant="showChart.get(sIdx) ? 'flat' : 'outlined'"
                :color="showChart.get(sIdx) ? 'primary' : undefined"
                prepend-icon="mdi-chart-line"
                @click="toggleChart(sIdx)"
              >
                {{ showChart.get(sIdx) ? 'Skrýt graf' : 'Zobrazit graf' }}
              </v-btn>
            </div>
            
            <div v-if="showChart.get(sIdx)" class="chart-controls mb-3">
              <div class="d-flex flex-wrap align-center" style="gap: 12px;">
                <!-- X Axis selector -->
                <div class="d-flex align-center" style="gap: 6px;">
                  <span class="text-caption font-weight-medium">X osa:</span>
                  <v-chip-group
                    :model-value="chartXAxis.get(sIdx)"
                    mandatory
                    @update:model-value="(val: string) => setChartXAxis(sIdx, val)"
                  >
                    <v-chip
                      v-for="col in getColumnsForSeries(s)"
                      :key="'x-' + col.name"
                      :value="col.name"
                      size="small"
                      :color="chartXAxis.get(sIdx) === col.name ? 'primary' : undefined"
                      variant="outlined"
                    >
                      {{ col.name }}
                    </v-chip>
                  </v-chip-group>
                </div>
                
                <!-- Y Axes toggles -->
                <div class="d-flex align-center" style="gap: 6px;">
                  <span class="text-caption font-weight-medium">Y série:</span>
                  <template v-for="(col, ci) in getColumnsForSeries(s)" :key="'y-' + col.name">
                    <v-checkbox
                      v-if="chartXAxis.get(sIdx) !== col.name"
                      :model-value="chartYAxes.get(sIdx)?.has(col.name) ?? false"
                      :label="col.name"
                      :color="CHART_COLORS[ci % CHART_COLORS.length]"
                      density="compact"
                      hide-details
                      @update:model-value="toggleChartYAxis(sIdx, col.name)"
                    />
                  </template>
                </div>
              </div>
              
              <!-- Chart Canvas -->
              <div class="chart-container mt-3" style="height: 350px; overflow-x: auto; border: 1px solid #f0f0f0; border-radius: 8px;">
                <div :style="getChartInnerStyle(sIdx)">
                  <canvas :ref="(el) => setChartRef(sIdx, el as HTMLCanvasElement)"></canvas>
                </div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div
            v-if="editable"
            class="d-flex justify-space-between mt-3"
          >
            <v-btn
              size="small"
              variant="flat"
              color="primary"
              prepend-icon="mdi-plus"
              @click="addRow(sIdx)"
            >
              Přidat pole
            </v-btn>
            <v-btn
              size="small"
              variant="flat"
              color="error"
              prepend-icon="mdi-delete"
              @click="emits('remove-series', sIdx)"
            >
              Smazat sérii
            </v-btn>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <div
      v-else
      class="text-center text-medium-emphasis py-4"
    >
      <v-icon
        size="40"
        color="grey-lighten-1"
      >
        mdi-chart-line-variant
      </v-icon>
      <div class="mt-2">
        Žádné datové série
      </div>
    </div>
    
    <!-- Hidden file input for series import -->
    <input
      ref="seriesFileInputRef"
      type="file"
      accept=".csv,.tsv,.txt,.xlsx,.xls"
      style="display: none"
      @change="onSeriesFileChange"
    >
    
    <!-- Series Data Picker Dialog -->
    <SeriesDataPicker
      v-model="pickerOpen"
      :raw-data="externalFileData || rawImportedData || []"
      :series-name="series[pickerSeriesIndex]?.seriesName"
      :columns="getColumnsForSeries(series[pickerSeriesIndex] || {})"
      @apply="applyPickerResult"
    />
    
    <!-- Add Column Dialog -->
    <v-dialog v-model="addColumnDialogOpen" max-width="400">
      <v-card>
        <v-card-title>Přidat sloupec</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="newColumnName"
            label="Název sloupce"
            variant="outlined"
            density="compact"
            autofocus
            @keydown.enter="confirmAddColumn"
          />
          <v-select
            v-model="newColumnType"
            :items="[
              { title: 'Číslo (float)', value: 'float' },
              { title: 'Celé číslo (int)', value: 'int' },
              { title: 'Text', value: 'text' }
            ]"
            item-title="title"
            item-value="value"
            label="Typ"
            variant="outlined"
            density="compact"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="addColumnDialogOpen = false">Zrušit</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!newColumnName.trim()" @click="confirmAddColumn">
            Přidat
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Remove Column Confirmation Dialog -->
    <v-dialog v-model="removeColumnConfirmOpen" max-width="400">
      <v-card>
        <v-card-title>Odstranit sloupec</v-card-title>
        <v-card-text>
          Opravdu chcete odstranit sloupec <strong>{{ removeColumnName }}</strong>?
          <br><br>
          <span class="text-medium-emphasis">Tato akce odstraní sloupec a všechna jeho data ze všech řádků.</span>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="removeColumnConfirmOpen = false">Zrušit</v-btn>
          <v-btn color="error" variant="flat" @click="confirmRemoveColumn">
            Odstranit
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.series-section {
  margin-top: 0;
  padding-top: 0;
}

.series-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}

.series-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

.series-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #7c3aed;
  border-radius: 6px;
}

.series-spacer {
  flex: 1;
}

.series-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.series-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.series-btn.tonal-purple {
  background: #f5f3ff;
  color: #7c3aed;
}

.series-btn.tonal-error {
  background: #fef2f2;
  color: #ef4444;
}

.series-btn.primary-purple {
  background: #7c3aed;
  color: white;
}

.series-btn:hover {
  filter: brightness(0.95);
}

.series-divider {
  width: 1px;
  height: 24px;
  background: #e2e8f0;
}

.series-table-wrapper {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}

.series-table {
  font-size: 0.875rem;
}

.series-table th,
.series-table td {
  border-right: 1px solid rgba(var(--v-border-color), 0.3);
}

.series-table th:last-child,
.series-table td:last-child {
  border-right: none;
}

.inline-edit {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  font-size: 0.875rem;
  outline: none;
  transition: all 0.15s;
}

.inline-edit:hover {
  background: rgba(var(--v-theme-primary), 0.05);
}

.inline-edit:focus {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.inline-edit.empty-required {
  border-color: rgba(var(--v-theme-error), 0.5);
  background: rgba(var(--v-theme-error), 0.05);
}

.inline-edit.empty-required::placeholder {
  color: rgba(var(--v-theme-error), 0.6);
  font-style: italic;
  font-size: 0.75rem;
}

/* Drag-and-drop styles */
.ghost-row {
  opacity: 0.4;
  background: rgba(var(--v-theme-primary), 0.15);
}

.draggable-row {
  transition: background-color 0.15s, opacity 0.2s, transform 0.2s;
  cursor: grab;
}

.draggable-row:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}

.draggable-row.is-dragging {
  opacity: 0.4;
  background: rgba(var(--v-theme-primary), 0.15);
}

.draggable-row.drag-over {
  background: rgba(var(--v-theme-primary), 0.2);
  box-shadow: inset 0 2px 0 0 rgb(var(--v-theme-primary));
}

.draggable-row:active {
  cursor: grabbing;
}

.drag-handle {
  user-select: none;
}

.drag-handle:hover {
  color: rgb(var(--v-theme-primary));
}
</style>
