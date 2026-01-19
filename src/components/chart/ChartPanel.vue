<!-- ChartPanel.vue -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { type StatsObj, type OutliersMeta, type MultiSeriesItem, fmt2 } from './types'
import ChartStats from './ChartStats.vue'
import ChartVisualizer from './ChartVisualizer.vue'

/* -------------------------------------------------
   Props & Emits
   ------------------------------------------------- */
const props = defineProps<{
  chartPoints: number[]
  stats: StatsObj | null
  fields: string[]
  selectedField: string | null
  xLabels?: Array<number | string>
  outliers?: OutliersMeta | null
  multiSeries?: MultiSeriesItem[] | null
  sharedZoomLevel?: number | null  // For synced zoom across multiple charts
}>()

const emit = defineEmits<{
  (e: 'select-field', field: string): void
  (e: 'point-click', payload: { event: MouseEvent; idx: number; val: number }): void
  (e: 'zoom-change', zoomLevel: number): void
}>()

/* -------------------------------------------------
   State
   ------------------------------------------------- */
const tabs = ['LINE', 'SCATTER', 'HISTOGRAM', 'BOXPLOT'] as const
type TabKind = (typeof tabs)[number]

const activeTab = ref<TabKind>('LINE')
const tabIcons: Record<TabKind, string> = {
  LINE: 'mdi-chart-line',
  SCATTER: 'mdi-chart-scatter-plot',
  HISTOGRAM: 'mdi-chart-bar',
  BOXPLOT: 'mdi-chart-box-outline',
}

const tabLabels: Record<TabKind, string> = {
  LINE: 'Čárový',
  SCATTER: 'Bodový',
  HISTOGRAM: 'Histogram',
  BOXPLOT: 'Box Plot',
}

const showGrid = ref(true)
const showMean = ref(true)
const showHover = ref(true)
const showTrend = ref(false)
const trendType = ref<'linear' | 'logarithmic'>('linear')

/* -------------------------------------------------
   Data preparation
   ------------------------------------------------- */
const palette = [
  '#1e88e5',
  '#8e24aa',
  '#43a047',
  '#fb8c00',
  '#5d4037',
  '#3949ab',
  '#f4511e',
  '#00897b',
  '#6d4c41',
  '#7cb342',
]

const singleSeriesPoints = computed<number[]>(() =>
  props.multiSeries && props.multiSeries.length ? [] : props.chartPoints || []
)

const seriesEnhanced = computed<MultiSeriesItem[]>(() => {
  const baseList =
    props.multiSeries && props.multiSeries.length
      ? props.multiSeries
      : singleSeriesPoints.value.length
      ? [{ label: props.selectedField || 'Data', points: singleSeriesPoints.value }]
      : []
  return baseList.map((s, i) => ({
    ...s,
    colorAssigned: s.color || palette[i % palette.length],
  }))
})

/* -------------------------------------------------
   Actions
   ------------------------------------------------- */
function onSelectField(f: string): void {
  emit('select-field', f)
}

const visualizerRef = ref<InstanceType<typeof ChartVisualizer> | null>(null)
function triggerCsv() {
  visualizerRef.value?.exportCsv()
}
function triggerSvg() {
  visualizerRef.value?.exportSvg()
}
function triggerPng() {
  visualizerRef.value?.exportPng()
}

/* -------------------------------------------------
   Watchers
   ------------------------------------------------- */
watch(
  () => props.fields,
  (fList) => {
    // If we have fields, and either no selection or invalid selection, defaults to first
    if (fList.length > 0) {
      if (!props.selectedField || !fList.includes(props.selectedField)) {
        nextTick(() => onSelectField(fList[0]))
      }
    }
  },
  { immediate: true }
)

/* -------------------------------------------------
   Keyboard shortcuts
   ------------------------------------------------- */
function handleKey(e: KeyboardEvent): void {
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey

  // Alt + 1-9: Select field
  if (alt && /^[1-9]$/.test(key)) {
    const idx = parseInt(key, 10) - 1
    if (idx >= 0 && idx < props.fields.length) {
      e.preventDefault()
      onSelectField(props.fields[idx]!)
    }
  }

  // Alt + G/M/H/T: Toggle display options
  if (alt && key === 'g') {
    e.preventDefault()
    showGrid.value = !showGrid.value
  }
  if (alt && key === 'm') {
    e.preventDefault()
    showMean.value = !showMean.value
  }
  if (alt && key === 'h') {
    e.preventDefault()
    showHover.value = !showHover.value
  }
  if (alt && key === 't') {
    e.preventDefault()
    showTrend.value = !showTrend.value
  }

  // Alt + L/S/T/B: Switch chart type
  if (alt && key === 'l') {
    e.preventDefault()
    activeTab.value = 'LINE'
  }
  if (alt && key === 's') {
    e.preventDefault()
    activeTab.value = 'SCATTER'
  }
  if (alt && key === 't') {
    e.preventDefault()
    activeTab.value = 'HISTOGRAM'
  }
  if (alt && key === 'b') {
    e.preventDefault()
    activeTab.value = 'BOXPLOT'
  }

  // Ctrl + E: Export shortcuts
  if (ctrl && key === 'e' && !e.shiftKey && !e.altKey) {
    e.preventDefault()
    triggerCsv()
  }
  if (ctrl && e.shiftKey && key === 'e') {
    e.preventDefault()
    triggerSvg()
  }
  if (ctrl && e.altKey && key === 'e') {
    e.preventDefault()
    triggerPng()
  }
}

onMounted(() => window.addEventListener('keydown', handleKey))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))

/* -------------------------------------------------
   Accessibility
   ------------------------------------------------- */
const liveStatus = computed<string>(() => {
  if (!seriesEnhanced.value.length) return 'Graf nemá žádná data.'
  const parts: string[] = []
  if (props.stats) parts.push(`Průměr ${fmt2(props.stats.mean)}, počet ${props.stats.count}`)
  return parts.join('. ')
})

const displayOptions = computed(() => [
  {
    label: 'Mřížka',
    icon: 'mdi-grid',
    active: showGrid.value,
    action: () => (showGrid.value = !showGrid.value),
    shortcut: 'Alt+G',
  },
  {
    label: 'Průměr',
    icon: 'mdi-chart-bell-curve',
    active: showMean.value,
    action: () => (showMean.value = !showMean.value),
    shortcut: 'Alt+M',
  },
  {
    label: 'Hover',
    icon: 'mdi-crosshairs',
    active: showHover.value,
    action: () => (showHover.value = !showHover.value),
    shortcut: 'Alt+H',
  },
  {
    label: 'Trend',
    icon: 'mdi-chart-line-variant',
    active: showTrend.value,
    action: () => (showTrend.value = !showTrend.value),
    shortcut: 'Alt+T',
  },
])

// Menu state for the field selector
const isFieldMenuOpen = ref(false)
function openFieldSelect() {
  isFieldMenuOpen.value = true
}
</script>

<template>
  <div class="chart-panel" :aria-label="liveStatus" aria-live="polite">
    <!-- Compact field selector -->
    <div class="field-selector-compact">
      <v-select
        v-model:menu="isFieldMenuOpen"
        :model-value="selectedField"
        :items="fields"
        label="Vyberte pole pro vizualizaci"
        variant="outlined"
        density="compact"
        hide-details
        class="field-select-compact"
        @update:model-value="onSelectField"
      >
        <template #prepend-inner>
          <v-icon size="18" color="primary">mdi-tag-multiple</v-icon>
        </template>
        <template #selection="{ item }">
          <span class="font-weight-medium">{{ item.raw }}</span>
        </template>
      </v-select>

      <v-tooltip location="top" text="Pro rychlý výběr použijte Alt + číslo">
        <template #activator="{ props: tooltipProps }">
          <v-chip v-bind="tooltipProps" size="small" variant="tonal" class="keyboard-hint ml-2">
            <v-icon size="14" start>mdi-keyboard-variant</v-icon>
            Alt+1..9
          </v-chip>
        </template>
      </v-tooltip>
    </div>

    <!-- Main chart area with integrated controls -->
    <div class="chart-main-container">
      <!-- Chart toolbar -->
      <div class="chart-toolbar">
        <!-- Chart type selector -->
        <div class="toolbar-section">
          <v-btn-toggle v-model="activeTab" class="chart-type-toggle-compact" divided mandatory density="compact" color="primary">
            <v-tooltip v-for="tab in tabs" :key="tab" location="top" :text="`${tabLabels[tab]} (Alt+${tab[0]})`">
              <template #activator="{ props: tooltipProps }">
                <v-btn v-bind="tooltipProps" :value="tab" size="small">
                  <v-icon :icon="tabIcons[tab]" size="18" />
                </v-btn>
              </template>
            </v-tooltip>
          </v-btn-toggle>
        </div>

        <!-- Display options -->
        <div class="toolbar-section">
          <v-tooltip v-for="opt in displayOptions" :key="opt.label" location="top" :text="`${opt.label} (${opt.shortcut})`">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                size="small"
                :color="opt.active ? 'primary' : 'grey'"
                :variant="opt.active ? 'flat' : 'text'"
                :icon="opt.icon"
                @click="opt.action"
              />
            </template>
          </v-tooltip>
        </div>

        <!-- Trend type selector (shown when trend is active) -->
        <v-expand-transition>
          <div v-if="showTrend" class="toolbar-section">
            <v-btn-toggle v-model="trendType" density="compact" color="primary" mandatory class="trend-toggle">
              <v-tooltip location="top" text="Lineární regrese (y = ax + b)">
                <template #activator="{ props: tooltipProps }">
                  <v-btn v-bind="tooltipProps" value="linear" size="x-small">
                    <v-icon size="16">mdi-chart-line</v-icon>
                    <span class="ml-1 text-caption">Lin</span>
                  </v-btn>
                </template>
              </v-tooltip>
              <v-tooltip location="top" text="Logaritmická regrese (y = a*ln(x) + b)">
                <template #activator="{ props: tooltipProps }">
                  <v-btn v-bind="tooltipProps" value="logarithmic" size="x-small">
                    <v-icon size="16">mdi-chart-bell-curve-cumulative</v-icon>
                    <span class="ml-1 text-caption">Log</span>
                  </v-btn>
                </template>
              </v-tooltip>
            </v-btn-toggle>
          </div>
        </v-expand-transition>

        <v-spacer />

        <!-- Export options -->
        <div class="toolbar-section">
          <v-tooltip text="Export CSV (Ctrl+E)" location="top">
            <template #activator="{ props: tooltipProps }">
              <v-btn v-bind="tooltipProps" size="small" variant="text" icon="mdi-file-delimited" @click="triggerCsv" />
            </template>
          </v-tooltip>
          <v-tooltip text="Export SVG (Ctrl+Shift+E)" location="top">
            <template #activator="{ props: tooltipProps }">
              <v-btn v-bind="tooltipProps" size="small" variant="text" icon="mdi-vector-square" @click="triggerSvg" />
            </template>
          </v-tooltip>
          <v-tooltip text="Export PNG (Ctrl+Alt+E)" location="top">
            <template #activator="{ props: tooltipProps }">
              <v-btn v-bind="tooltipProps" size="small" variant="text" icon="mdi-file-image" @click="triggerPng" />
            </template>
          </v-tooltip>
        </div>
      </div>

      <!-- Chart and stats layout -->
      <div class="chart-content-layout">
        <!-- Main chart area -->
        <div class="chart-area-main" style="position: relative;">
          <!-- Empty state button -->
          <div v-if="!seriesEnhanced.length" class="no-data-overlay">
            <div class="text-medium-emphasis mb-4">Žádná data pro graf</div>
            <v-btn color="primary" prepend-icon="mdi-tag-multiple" @click="openFieldSelect">
              Vybrat pole pro vizualizaci
            </v-btn>
          </div>

          <ChartVisualizer
            v-else
            ref="visualizerRef"
            :series="seriesEnhanced"
            :active-tab="activeTab"
            :stats="stats"
            :outliers="outliers"
            :x-labels="xLabels"
            :show-grid="showGrid"
            :show-mean="showMean"
            :show-hover="showHover"
            :show-trend="showTrend"
            :trend-type="trendType"
            :focus-mode="false"
            :shared-zoom-level="sharedZoomLevel"
            @point-click="(p) => emit('point-click', p)"
            @zoom-change="(z) => emit('zoom-change', z)"
          />
        </div>

        <!-- Compact stats sidebar -->
        <div class="stats-sidebar-compact">
          <ChartStats :stats="stats" :outliers="outliers" />
        </div>
      </div>
    </div>

    <!-- Series legend (if multiple) -->
    <v-expand-transition>
      <div v-if="seriesEnhanced.length > 1" class="series-legend-compact">
        <div class="legend-header">
          <v-icon size="16" color="primary">mdi-format-list-bulleted</v-icon>
          <span class="legend-title">Série ({{ seriesEnhanced.length }})</span>
        </div>
        <div class="legend-items">
          <v-chip
            v-for="(s, i) in seriesEnhanced"
            :key="s.label + i"
            size="small"
            variant="flat"
            :style="{ backgroundColor: s.colorAssigned, color: 'white' }"
            class="legend-chip"
          >
            {{ s.label }}
            <v-chip size="x-small" variant="elevated" color="white" class="ml-1">
              {{ s.points.length }}
            </v-chip>
          </v-chip>
        </div>
      </div>
    </v-expand-transition>
  </div>
</template>

<style scoped>
/* -----------------------------------------------------------------
   Main layout
   ----------------------------------------------------------------- */
.chart-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Remove fixed height to allow natural flow */
  /* height: 100%; */
}

/* -----------------------------------------------------------------
   Compact field selector
   ----------------------------------------------------------------- */
.field-selector-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(to bottom, #f9fafb, #ffffff);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
}

.field-select-compact {
  max-width: 400px;
}

.keyboard-hint {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'Roboto Mono', monospace;
  font-size: 0.7rem;
  cursor: help;
  flex-shrink: 0;
}

/* -----------------------------------------------------------------
   Main chart container
   ----------------------------------------------------------------- */
.chart-main-container {
  /* Flex 1 was causing it to expand. Removed to respect max-height */
  /* flex: 1; */
  display: flex;
  flex-direction: column;
  background: linear-gradient(to bottom, #f9fafb, #ffffff);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  overflow: hidden;
  /* height: 380px; Removed fixed height to allow natural flow */
  min-height: 380px;
}

/* -----------------------------------------------------------------
   Chart toolbar
   ----------------------------------------------------------------- */
.chart-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.8);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(8px);
  flex-shrink: 0;
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: 4px;
}

.chart-type-toggle-compact {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.trend-toggle {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* -----------------------------------------------------------------
   Chart content layout
   ----------------------------------------------------------------- */
.chart-content-layout {
  flex: 1;
  display: flex;
  flex-direction: column; 
  gap: 12px;
  padding: 12px;
  min-height: 0;
  overflow: hidden;
}

.chart-area-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* No data overlay */
.no-data-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: rgba(255, 255, 255, 0.5);
}

.stats-sidebar-compact {
  width: 100%;
  max-height: 160px;
  flex-shrink: 0;
  overflow-y: auto;
  border-top: 1px solid rgba(0,0,0,0.06);
  padding-top: 12px;
}

.stats-sidebar-compact :deep(.stats-grid) {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.stats-sidebar-compact :deep(.stat-item) {
  padding: 10px 12px;
  min-height: auto;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.06);
}



/* -----------------------------------------------------------------
   Series legend compact
   ----------------------------------------------------------------- */
.series-legend-compact {
  padding: 10px 12px;
  background: linear-gradient(to bottom, #f9fafb, #ffffff);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
}

.legend-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.legend-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
}

.legend-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.legend-chip {
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: all 0.2s ease;
}

.legend-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

/* -----------------------------------------------------------------
   Responsive design
   ----------------------------------------------------------------- */
@media (max-width: 1200px) {
  .chart-content-layout {
    flex-direction: column;
  }

  .stats-sidebar-compact {
    width: 100%;
    max-height: 200px;
  }

  .stats-sidebar-compact :deep(.stats-grid) {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .field-selector-compact {
    flex-direction: column;
    align-items: stretch;
  }

  .field-select-compact {
    max-width: none;
  }

  .chart-toolbar {
    flex-wrap: wrap;
  }

  .stats-sidebar-compact :deep(.stats-grid) {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .chart-main-container {
    height: auto;
    min-height: 400px;
  }
}

@media (max-width: 480px) {
  .chart-content-layout {
    padding: 8px;
  }

  .stats-sidebar-compact :deep(.stats-grid) {
    grid-template-columns: 1fr;
  }
}
</style>
