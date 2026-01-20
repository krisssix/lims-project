<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import ChartPanel from '@/components/chart/ChartPanel.vue'

import { type DeviceItem, type ValueType, type TemplateItem, type TemplateBlockRow } from '@/types/measurement-ui'
import { type MeasurementResponse } from '@/stores/measurement'
import {
  groupValuesToRecords,
  extractSeries,
  computeBasicStats,
  detectOutliersIqr,
  type MeasurementRecord,
  type RecordField
} from '@/utils/measurement-record-helpers'
import { config } from '@/config'
import { contrastText } from '@/utils/colorContrast'

const props = defineProps<{
  modelValue: boolean
  items: MeasurementResponse[]
  devices: DeviceItem[]
  members: string[]
  templates: TemplateItem[]
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

// Synced scrolling state
const syncScrollEnabled = ref(true)
const scrollContainers = ref<HTMLElement[]>([])
let isScrolling = false

// Synced tabs state
const syncTabsEnabled = ref(true)

function handleTabChange(panelIndex: number, newTab: 'meta' | 'values' | 'stats'): void {
  if (syncTabsEnabled.value) {
    // Change all panels
    panelStates.value.forEach(state => {
      state.activeTab = newTab
    })
  } else {
    // Change only the specific panel
    panelStates.value[panelIndex]!.activeTab = newTab
  }
}

// Synced zoom state
const syncZoomEnabled = ref(true)
const sharedZoomLevel = ref<number | null>(null)
let isUpdatingZoom = false

function handleZoomChange(panelIndex: number, zoomLevel: number): void {
  if (!syncZoomEnabled.value || isUpdatingZoom) return
  
  isUpdatingZoom = true
  sharedZoomLevel.value = zoomLevel
  
  nextTick(() => {
    isUpdatingZoom = false
  })
}

function onScroll(sourceIndex: number, event: Event): void {
  if (!syncScrollEnabled.value || isScrolling) return
  
  isScrolling = true
  const source = event.target as HTMLElement
  const scrollTop = source.scrollTop
  const scrollLeft = source.scrollLeft
  
  scrollContainers.value.forEach((container, idx) => {
    if (idx !== sourceIndex && container) {
      container.scrollTop = scrollTop
      container.scrollLeft = scrollLeft
    }
  })
  
  requestAnimationFrame(() => {
    isScrolling = false
  })
}

function registerScrollContainer(index: number, el: HTMLElement | null): void {
  if (el) {
    scrollContainers.value[index] = el
  }
}

// Helper functions
const TYPE_LABEL: Record<ValueType, string> = {
  float: 'Float',
  int: 'Integer',
  text: 'Text',
  file: 'Soubor',
  bool: 'Boolean',
  date: 'Datum',
  time: 'Čas',
  datetime: 'Datum a čas'
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

function formatDateTime(ts: number | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}



// Build records from item values
function buildRecordsFromItem(item: MeasurementResponse | null): MeasurementRecord[] {
  if (!item) return []
  const vals = item.values ?? []
  if (vals.length) {
    return groupValuesToRecords(vals)
  }
  return [{
    recordIndex: 1,
    fields: [{
      name: 'Hodnota',
      type: 'float',
      required: true,
      value: item.value ?? null,
      blockIndex: 1
    }]
  }]
}

// Get template blocks for an item
function getTemplateBlocks(item: MeasurementResponse | null, templates: TemplateItem[]): TemplateBlockRow[] {
  if (!item) return []
  const tpl = templates.find(t => t.name === item.type)
  
  if (tpl && tpl.blocks && tpl.blocks.length > 0) {
    return tpl.blocks.filter(b => {
      const isSeries = b.kind === 'series' ||
        (b.title?.toLowerCase().includes('série')) ||
        (b.title?.toLowerCase().includes('series'))
      return !isSeries
    })
  }
  
  const records = buildRecordsFromItem(item)
  if (records.length && records[0].fields.length > 0) {
    const rec = records[0]
    const blockMap = new Map<number, { title: string | null; fields: RecordField[] }>()
    for (const field of rec.fields) {
      const blockIdx = field.blockIndex ?? 1
      if (!blockMap.has(blockIdx)) {
        blockMap.set(blockIdx, { title: field.blockTitle ?? null, fields: [] })
      }
      blockMap.get(blockIdx)!.fields.push(field)
    }
    if (blockMap.size > 1) {
      return Array.from(blockMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([blockIndex, data]) => ({
          id: blockIndex,
          blockIndex,
          title: data.title || `Tabulka hodnot ${blockIndex}`,
          fields: data.fields.map((f, i) => ({
            orderIndex: i + 1,
            type: f.type,
            required: f.required,
            name: f.name
          }))
        }))
    }
  }
  
  if (tpl && tpl.fields && tpl.fields.length > 0) {
    return [{
      id: 0,
      blockIndex: 1,
      title: 'Hodnoty',
      fields: tpl.fields
    }]
  }
  
  return [{
    id: 0,
    blockIndex: 1,
    title: 'Hodnoty',
    fields: []
  }]
}

// File display helpers
function getFileDisplayUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }
  const baseUrl = config.serverUrl.endsWith('/')
    ? config.serverUrl.slice(0, -1)
    : config.serverUrl
  const filePath = value.startsWith('/') ? value : `/${value}`
  return `${baseUrl}${filePath}`
}

function getFileNameFromUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const parts = value.split('/')
  return parts[parts.length - 1] || value
}

function isImageFile(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const ext = value.split('.').pop()?.toLowerCase() || ''
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
}

function hasExistingFileUrl(field: RecordField): boolean {
  return typeof field.value === 'string' && field.value.length > 0
}

// Get numeric field names from records
function getNumericFieldNames(records: MeasurementRecord[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of records) {
    for (const f of r.fields) {
      let isNumeric = f.type === 'float' || f.type === 'int'
      if (!isNumeric && f.type === 'text') {
        const raw = f.value
        const s = raw == null ? '' : String(raw).trim().replace(',', '.')
        const n = Number(s)
        isNumeric = Number.isFinite(n)
      }
      if (isNumeric && !seen.has(f.name)) {
        seen.add(f.name)
        out.push(f.name)
      }
    }
  }
  return out
}

// Compute chart stats for a field
function getChartStats(records: MeasurementRecord[], fieldName: string | null) {
  if (!fieldName) return { points: [], stats: null, outliers: null }
  const points = extractSeries(records, fieldName)
  const stats = computeBasicStats(points)
  const outliers = detectOutliersIqr(points)
  return { points, stats, outliers }
}

// Per-panel state management
interface PanelState {
  item: MeasurementResponse
  records: MeasurementRecord[]
  currentRecordIndex: number
  currentBlockIndex: number
  selectedField: string | null
  metaCollapsed: boolean
  valuesCollapsed: boolean
  statsCollapsed: boolean
  activeTab: 'meta' | 'values' | 'stats'
}

const panelStates = ref<PanelState[]>([])

watch(() => props.items, (items) => {
  panelStates.value = items.map(item => ({
    item,
    records: buildRecordsFromItem(item),
    currentRecordIndex: 1,
    currentBlockIndex: 0,
    selectedField: null,
    metaCollapsed: false,
    valuesCollapsed: false,
    statsCollapsed: false,
    activeTab: 'values' as const
  }))
  
  // Set default selected field
  panelStates.value.forEach(state => {
    const numericFields = getNumericFieldNames(state.records)
    if (numericFields.length > 0) {
      state.selectedField = numericFields[0]
    }
  })
}, { immediate: true })

// Panel navigation functions
function getCurrentRecord(state: PanelState): MeasurementRecord | null {
  return state.records.find(r => r.recordIndex === state.currentRecordIndex) ?? null
}

function getCurrentBlockFields(state: PanelState): RecordField[] {
  const record = getCurrentRecord(state)
  if (!record) return []
  
  const blocks = getTemplateBlocks(state.item, props.templates)
  if (blocks.length <= 1) return record.fields
  
  const block = blocks[state.currentBlockIndex]
  if (!block) return record.fields
  
  return record.fields.filter(f => (f.blockIndex ?? 1) === block.blockIndex)
}

function prevRecord(state: PanelState): void {
  const idx = state.records.findIndex(r => r.recordIndex === state.currentRecordIndex)
  if (idx > 0) {
    state.currentRecordIndex = state.records[idx - 1]!.recordIndex
    state.currentBlockIndex = 0
  }
}

function nextRecord(state: PanelState): void {
  const idx = state.records.findIndex(r => r.recordIndex === state.currentRecordIndex)
  if (idx < state.records.length - 1) {
    state.currentRecordIndex = state.records[idx + 1]!.recordIndex
    state.currentBlockIndex = 0
  }
}





function getCurrentPosition(state: PanelState): number {
  return state.records.findIndex(r => r.recordIndex === state.currentRecordIndex) + 1
}

// Format field value for display
function formatFieldValue(field: RecordField): string {
  if (field.value === null || field.value === undefined) return '—'
  
  if (field.type === 'bool') {
    return field.value ? 'Ano' : 'Ne'
  }
  
  if (field.type === 'date' && typeof field.value === 'number') {
    const d = new Date(field.value)
    return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`
  }
  
  if (field.type === 'float' && typeof field.value === 'number') {
    return field.value.toFixed(2)
  }
  
  return String(field.value)
}

// Get device info
function getDevice(deviceId: string) {
  return props.devices.find(d => d.id === deviceId)
}

// Keyboard handlers
function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emits('update:modelValue', false)
  }
}

watch(() => props.modelValue, v => {
  if (v) {
    window.addEventListener('keydown', handleKey)
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})

onMounted(() => {
  if (props.modelValue) window.addEventListener('keydown', handleKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKey)
})
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    transition="dialog-bottom-transition"
    @update:model-value="v => emits('update:modelValue', v)"
  >
    <v-card class="d-flex flex-column h-100 compare-dialog">
      <!-- Toolbar with gradient -->
      <div class="compare-toolbar">
        <v-btn
          icon="mdi-close"
          variant="text"
          color="white"
          @click="emits('update:modelValue', false)"
        />
        <div class="toolbar-title">
          <v-icon
            class="mr-2"
            color="white"
          >
            mdi-compare
          </v-icon>
          <span>Porovnání měření ({{ items.length }})</span>
        </div>
        
        <v-spacer />
        
        <!-- Sync scroll toggle -->
        <div class="sync-toggle">
          <v-icon
            size="20"
            :color="syncScrollEnabled ? 'white' : 'rgba(255,255,255,0.6)'"
          >
            {{ syncScrollEnabled ? 'mdi-link-variant' : 'mdi-link-variant-off' }}
          </v-icon>
          <span :class="syncScrollEnabled ? 'text-white' : 'text-white-60'">
            Scroll
          </span>
          <v-switch
            v-model="syncScrollEnabled"
            hide-details
            density="compact"
            color="white"
            class="sync-switch ml-2"
          />
        </div>

        <!-- Sync tabs toggle -->
        <div class="sync-toggle">
          <v-icon
            size="20"
            :color="syncTabsEnabled ? 'white' : 'rgba(255,255,255,0.6)'"
          >
            {{ syncTabsEnabled ? 'mdi-tab' : 'mdi-tab-remove' }}
          </v-icon>
          <span :class="syncTabsEnabled ? 'text-white' : 'text-white-60'">
            Tabs
          </span>
          <v-switch
            v-model="syncTabsEnabled"
            hide-details
            density="compact"
            color="white"
            class="sync-switch ml-2"
          />
        </div>

        <!-- Sync zoom toggle -->
        <div class="sync-toggle">
          <v-icon
            size="20"
            :color="syncZoomEnabled ? 'white' : 'rgba(255,255,255,0.6)'"
          >
            {{ syncZoomEnabled ? 'mdi-magnify-plus-outline' : 'mdi-magnify-minus-outline' }}
          </v-icon>
          <span :class="syncZoomEnabled ? 'text-white' : 'text-white-60'">
            Zoom
          </span>
          <v-switch
            v-model="syncZoomEnabled"
            hide-details
            density="compact"
            color="white"
            class="sync-switch ml-2"
          />
        </div>
      </div>

      <!-- Comparison panels -->
      <div class="compare-panels flex-grow-1 d-flex">
        <div
          v-for="(state, panelIndex) in panelStates"
          :key="state.item.id"
          class="compare-panel"
          :class="[
            `panel-${panelIndex % 4}`,
            { 'border-end': panelIndex < panelStates.length - 1 }
          ]"
        >
          <!-- Panel header with accent -->
          <div class="panel-header">
            <div class="panel-header-content">
              <div
                class="d-flex align-center"
                style="gap: 10px;"
              >
                <div class="panel-number">
                  {{ panelIndex + 1 }}
                </div>
                <div class="flex-grow-1">
                  <div
                    class="d-flex align-center flex-wrap"
                    style="gap: 6px;"
                  >
                    <v-chip
                      :color="getDevice(state.item.unit)?.color || 'primary'"
                      variant="elevated"
                      size="small"
                      class="elevation-2"
                      :style="{ color: getDevice(state.item.unit)?.color ? contrastText(getDevice(state.item.unit)!.color) : 'white' }"
                    >
                      <v-icon
                        start
                        size="14"
                      >
                        mdi-chip
                      </v-icon>
                      {{ state.item.unit }}
                    </v-chip>
                    <span class="measurement-id">Měření #{{ state.item.id }}</span>
                  </div>
                  <div class="panel-meta">
                    <v-icon
                      size="12"
                      class="mr-1"
                    >
                      mdi-calendar-clock
                    </v-icon>
                    {{ formatDateTime(state.item.timestamp as number) }}
                    <span
                      v-if="state.item.measuredByUsername"
                      class="ml-2"
                    >
                      <v-icon
                        size="12"
                        class="mr-1"
                      >mdi-account</v-icon>
                      {{ state.item.measuredByUsername }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sticky section tabs -->
          <div class="tabs-container-modern">
            <div class="inspector-tabs-modern">
              <button 
                class="tab-btn-modern" 
                :class="{ active: state.activeTab === 'meta' }"
                @click="handleTabChange(panelIndex, 'meta')"
              >
                <v-icon size="18">
                  mdi-information-outline
                </v-icon>
                <span>Meta</span>
              </button>
              <button 
                class="tab-btn-modern" 
                :class="{ active: state.activeTab === 'values' }"
                @click="handleTabChange(panelIndex, 'values')"
              >
                <v-icon size="18">
                  mdi-table
                </v-icon>
                <span>Hodnoty</span>
                <span
                  v-if="state.records.length > 1"
                  class="tab-badge-modern"
                >{{ state.records.length }}</span>
              </button>
              <button 
                class="tab-btn-modern" 
                :class="{ active: state.activeTab === 'stats' }"
                @click="handleTabChange(panelIndex, 'stats')"
              >
                <v-icon size="18">
                  mdi-chart-line
                </v-icon>
                <span>Statistika</span>
              </button>
            </div>
          </div>

          <!-- Scrollable content -->
          <div
            :ref="(el) => registerScrollContainer(panelIndex, el as HTMLElement)"
            class="panel-scroll"
            @scroll="(e) => onScroll(panelIndex, e)"
          >
            <!-- Meta section -->
            <div
              v-show="state.activeTab === 'meta'"
              class="content-card mb-3"
            >
              <div class="card-content">
                <div class="info-grid">
                  <div class="info-item">
                    <div class="info-label">
                      Šablona
                    </div>
                    <div class="info-value">
                      {{ state.item.type }}
                    </div>
                  </div>
                  <div
                    v-if="state.item.createdAt"
                    class="info-item"
                  >
                    <div class="info-label">
                      Vytvořeno
                    </div>
                    <div class="info-value">
                      {{ formatDateTime(state.item.createdAt as number) }}
                    </div>
                  </div>
                  <div
                    v-if="state.item.updatedAt"
                    class="info-item"
                  >
                    <div class="info-label">
                      Upraveno
                    </div>
                    <div class="info-value">
                      {{ formatDateTime(state.item.updatedAt as number) }}
                    </div>
                  </div>
                </div>

                <div
                  v-if="state.item.note"
                  class="note-section"
                >
                  <div class="note-label">
                    <v-icon
                      size="14"
                      class="mr-1"
                    >
                      mdi-note-text
                    </v-icon>
                    Poznámka
                  </div>
                  <div class="note-content">
                    {{ state.item.note }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Values section -->
            <div
              v-show="state.activeTab === 'values'"
              class="content-card mb-3"
            >
              <div class="card-header">
                <div
                  class="d-flex align-center"
                  style="gap: 8px;"
                >
                  <div class="header-icon">
                    <v-icon size="16">
                      mdi-table-large
                    </v-icon>
                  </div>
                  <span class="header-title">Hodnoty</span>
                  <v-chip
                    size="x-small"
                    variant="elevated"
                    class="ml-1"
                    style="height: 18px;"
                  >
                    {{ state.records.length }}
                  </v-chip>
                </div>
                
                <div
                  class="d-flex align-center"
                  style="gap: 4px;"
                >
                  <div
                    v-if="state.records.length > 1"
                    class="record-nav"
                  >
                    <v-btn
                      icon="mdi-chevron-left"
                      size="x-small"
                      variant="text"
                      :disabled="getCurrentPosition(state) <= 1"
                      @click.stop="prevRecord(state)"
                    />
                    <span class="nav-indicator">{{ getCurrentPosition(state) }}/{{ state.records.length }}</span>
                    <v-btn
                      icon="mdi-chevron-right"
                      size="x-small"
                      variant="text"
                      :disabled="getCurrentPosition(state) >= state.records.length"
                      @click.stop="nextRecord(state)"
                    />
                  </div>
                </div>
              </div>

              <div class="card-content">
                <!-- Block tabs -->
                <div
                  v-if="getTemplateBlocks(state.item, templates).length > 1"
                  class="block-tabs"
                >
                  <v-chip
                    v-for="(block, idx) in getTemplateBlocks(state.item, templates)"
                    :key="block.id"
                    size="small"
                    :color="idx === state.currentBlockIndex ? 'primary' : 'grey-lighten-2'"
                    :variant="idx === state.currentBlockIndex ? 'flat' : 'elevated'"
                    @click="state.currentBlockIndex = idx"
                  >
                    {{ block.title }}
                  </v-chip>
                </div>

                <!-- Values list -->
                <div class="values-list">
                  <div
                    v-for="field in getCurrentBlockFields(state)"
                    :key="field.name"
                    class="value-row"
                  >
                    <div class="value-name">
                      <span>{{ field.name }}</span>
                      <v-chip
                        size="x-small"
                        variant="tonal"
                        color="primary"
                        class="ml-2"
                        style="height: 16px; font-size: 0.65rem;"
                      >
                        {{ TYPE_LABEL[field.type] }}
                      </v-chip>
                    </div>
                    <div class="value-content">
                      <!-- File -->
                      <div
                        v-if="field.type === 'file' && hasExistingFileUrl(field)"
                        class="file-preview"
                      >
                        <v-img
                          v-if="isImageFile(field.value)"
                          :src="getFileDisplayUrl(field.value)"
                          width="32"
                          height="32"
                          class="rounded"
                          cover
                        />
                        <v-icon
                          v-else
                          size="18"
                          color="grey-darken-1"
                        >
                          mdi-file
                        </v-icon>
                        <a
                          :href="getFileDisplayUrl(field.value)"
                          target="_blank"
                          class="file-link"
                        >
                          {{ getFileNameFromUrl(field.value) }}
                        </a>
                      </div>
                      <!-- Boolean -->
                      <div
                        v-else-if="field.type === 'bool'"
                        class="bool-value"
                      >
                        <v-icon
                          :color="field.value ? 'success' : 'grey'"
                          size="18"
                        >
                          {{ field.value ? 'mdi-check-circle' : 'mdi-close-circle' }}
                        </v-icon>
                        <span>{{ field.value ? 'Ano' : 'Ne' }}</span>
                      </div>
                      <!-- Number with highlight -->
                      <div
                        v-else-if="field.type === 'float' || field.type === 'int'"
                        class="number-value"
                      >
                        {{ formatFieldValue(field) }}
                      </div>
                      <!-- Other -->
                      <span
                        v-else
                        class="text-value"
                      >{{ formatFieldValue(field) }}</span>
                    </div>
                  </div>
                  
                  <div
                    v-if="getCurrentBlockFields(state).length === 0"
                    class="empty-state"
                  >
                    <v-icon
                      size="32"
                      color="grey-lighten-1"
                    >
                      mdi-table-off
                    </v-icon>
                    <span class="text-caption text-grey mt-2">Žádné hodnoty</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Statistics section -->
            <div
              v-show="state.activeTab === 'stats'"
              class="content-card"
            >
              <div class="card-header">
                <div
                  class="d-flex align-center"
                  style="gap: 8px;"
                >
                  <div class="header-icon">
                    <v-icon size="16">
                      mdi-chart-line
                    </v-icon>
                  </div>
                  <span class="header-title">Statistika</span>
                </div>
              </div>

              <div class="card-content">
                <div v-if="getNumericFieldNames(state.records).length > 0">
                  <ChartPanel
                    :chart-points="getChartStats(state.records, state.selectedField).points"
                    :stats="getChartStats(state.records, state.selectedField).stats"
                    :fields="getNumericFieldNames(state.records)"
                    :selected-field="state.selectedField"
                    :shared-zoom-level="syncZoomEnabled ? sharedZoomLevel : null"
                    @select-field="f => (state.selectedField = f)"
                    @zoom-change="(zoomLevel) => handleZoomChange(panelIndex, zoomLevel)"
                  />
                </div>
                <div
                  v-else
                  class="empty-state"
                >
                  <v-icon
                    size="32"
                    color="grey-lighten-1"
                  >
                    mdi-chart-bar-stacked
                  </v-icon>
                  <span class="text-caption text-grey mt-2">Žádná numerická data</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>


<style scoped>
/* Main dialog */
.compare-dialog {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

/* Gradient Toolbar */
.compare-toolbar {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  gap: 16px;
}

.toolbar-title {
  display: flex;
  align-items: center;
  color: white;
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.sync-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  font-size: 0.875rem;
}

.text-white-60 {
  color: rgba(255, 255, 255, 0.6);
}

.sync-switch :deep(.v-switch__track) {
  opacity: 0.5;
}

/* Comparison panels container */
.compare-panels {
  background: #f5f7fa;
  overflow-x: auto;
  overflow-y: hidden;
}

/* Individual panel */
.compare-panel {
  flex: 1 0 380px;
  min-width: 380px;
  display: flex;
  flex-direction: column;
  background: white;
  position: relative;
}

.border-end { 
  border-right: 2px solid #e0e4e8;
}

/* Accent colors for panels */
.panel-0 { --accent-color: #667eea; --accent-light: rgba(102, 126, 234, 0.1); }
.panel-1 { --accent-color: #f093fb; --accent-light: rgba(240, 147, 251, 0.1); }
.panel-2 { --accent-color: #4facfe; --accent-light: rgba(79, 172, 254, 0.1); }
.panel-3 { --accent-color: #43e97b; --accent-light: rgba(67, 233, 123, 0.1); }

/* Panel header */
.panel-header {
  background: linear-gradient(to bottom, var(--accent-light), white);
  border-bottom: 2px solid var(--accent-color);
  padding: 0;
  flex-shrink: 0;
}

.panel-header-content {
  padding: 16px 16px 12px 16px;
}

/* Modern Tabs styling to match unified UI */
.tabs-container-modern {
  padding: 8px 12px;
  background: white;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  position: sticky;
  top: 0;
  z-index: 10;
  flex-shrink: 0;
}

.inspector-tabs-modern {
  display: flex;
  background: #f1f5f9;
  padding: 4px;
  gap: 4px;
  border-radius: 10px;
}

.tab-btn-modern {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #64748b;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}

.tab-btn-modern:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #1e293b;
}

.tab-btn-modern.active {
  background: #1976d2;
  color: white;
  box-shadow: 0 2px 4px rgba(25, 118, 210, 0.25);
}

.tab-badge-modern {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: rgba(0, 0, 0, 0.2);
  color: white;
  border-radius: 9px;
  font-size: 0.65rem;
  font-weight: 700;
}

.tab-btn-modern.active .tab-badge-modern {
  background: rgba(255, 255, 255, 0.25);
}

.panel-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent-color);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.95rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.measurement-id {
  font-weight: 700;
  font-size: 1.05rem;
  color: #2d3748;
}

.panel-meta {
  font-size: 0.75rem;
  color: #718096;
  margin-top: 4px;
  display: flex;
  align-items: center;
}

/* Scrollable content */
.panel-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #fafbfc;
}

/* Content cards */
.content-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  transition: all 0.2s ease;
}

.content-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(to right, var(--accent-light), white);
  border-bottom: 1px solid #e2e8f0;
  cursor: pointer;
  transition: background 0.2s ease;
}

.card-header:hover {
  background: linear-gradient(to right, var(--accent-light), var(--accent-light));
}

.header-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--accent-color);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: #2d3748;
}

.card-content {
  padding: 16px;
}

/* Info grid */
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.info-item {
  background: #f7fafc;
  padding: 10px 12px;
  border-radius: 8px;
  border-left: 3px solid var(--accent-color);
}

.info-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #718096;
  margin-bottom: 4px;
  font-weight: 600;
}

.info-value {
  font-size: 0.875rem;
  color: #2d3748;
  font-weight: 500;
}

/* Note section */
.note-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e2e8f0;
}

.note-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #718096;
  margin-bottom: 6px;
  font-weight: 600;
  display: flex;
  align-items: center;
}

.note-content {
  font-size: 0.875rem;
  color: #4a5568;
  line-height: 1.5;
  white-space: pre-wrap;
  background: #f7fafc;
  padding: 8px 10px;
  border-radius: 6px;
}

/* Record navigation */
.record-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: #f7fafc;
  border-radius: 6px;
}

.nav-indicator {
  font-size: 0.75rem;
  font-weight: 600;
  color: #4a5568;
  min-width: 32px;
  text-align: center;
}

/* Block tabs */
.block-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
  padding: 8px;
  background: #f7fafc;
  border-radius: 8px;
}

/* Values list */
.values-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.value-row {
  background: #f8f9fa;
  padding: 10px 12px;
  border-radius: 8px;
  border-left: 3px solid var(--accent-color);
  transition: all 0.2s ease;
}

.value-row:hover {
  background: var(--accent-light);
  transform: translateX(2px);
}

.value-name {
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  font-weight: 600;
  color: #2d3748;
  margin-bottom: 6px;
}

.value-content {
  font-size: 0.95rem;
  color: #1a202c;
  font-weight: 500;
}

.number-value {
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent-color);
  padding: 4px 8px;
  background: var(--accent-light);
  border-radius: 6px;
  display: inline-block;
}

.text-value {
  color: #4a5568;
}

.bool-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.file-preview {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-link {
  color: var(--accent-color);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.file-link:hover {
  text-decoration: underline;
  color: #4c51bf;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #a0aec0;
}

/* Animations */
.rotate-180 {
  transform: rotate(180deg);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Scrollbar styling */
.panel-scroll::-webkit-scrollbar {
  width: 8px;
}

.panel-scroll::-webkit-scrollbar-track {
  background: #f1f5f9;
}

.panel-scroll::-webkit-scrollbar-thumb {
  background: var(--accent-color);
  border-radius: 4px;
}

.panel-scroll::-webkit-scrollbar-thumb:hover {
  background: #4c51bf;
}

/* Responsive */
@media (min-width: 2000px) {
  .compare-panel {
    flex: 1 0 450px;
    min-width: 450px;
  }
}

@media (min-width: 1400px) and (max-width: 1999px) {
  .compare-panel {
    flex: 1 0 400px;
    min-width: 400px;
  }
}

@media (min-width: 900px) and (max-width: 1399px) {
  .compare-panel {
    flex: 1 0 380px;
    min-width: 380px;
  }
}

@media (max-width: 899px) {
  .compare-panel {
    flex: 0 0 320px;
    min-width: 320px;
  }
  
  .info-grid {
    grid-template-columns: 1fr;
  }
  
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
