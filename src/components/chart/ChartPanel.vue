<!-- ChartPanel.vue -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { type StatsObj, type OutliersMeta, type MultiSeriesItem, fmt2 } from './types'
// Import sub-components
import ChartStats from './ChartStats.vue'
import ChartVisualizer from './ChartVisualizer.vue'

const props = defineProps<{
  chartPoints: number[]
  stats: StatsObj | null
  fields: string[]
  selectedField: string | null
  xLabels?: Array<number | string>
  outliers?: OutliersMeta | null
  multiSeries?: MultiSeriesItem[] | null
}>()
const emit = defineEmits<{
  (e: 'select-field', field: string): void
}>()
/* ---------- State ---------- */
const tabs = ['LINE', 'SCATTER', 'HISTOGRAM', 'BOXPLOT'] as const
type TabKind = typeof tabs[number]

















const activeTab = ref<TabKind>('LINE')
const tabIcons: Record<TabKind, string> = {
  LINE: 'mdi-chart-line',
  SCATTER: 'mdi-chart-scatter-plot',
  HISTOGRAM: 'mdi-chart-bar',
  BOXPLOT: 'mdi-chart-box-outline'
}











const showGrid = ref(true)
const showMean = ref(true)
const showHover = ref(true)
const focusMode = ref(false)

/* ---------- Data Prep ---------- */
const palette = ['#1e88e5','#8e24aa','#43a047','#fb8c00','#5d4037','#3949ab','#f4511e','#00897b','#6d4c41','#7cb342']
const singleSeriesPoints = computed<number[]>(() =>
  (props.multiSeries && props.multiSeries.length ? [] : (props.chartPoints || []))
)
const seriesEnhanced = computed<MultiSeriesItem[]>(() => {
  const baseList = props.multiSeries && props.multiSeries.length
    ? props.multiSeries
    : singleSeriesPoints.value.length
      ? [{ label: props.selectedField || 'Data', points: singleSeriesPoints.value }]
      : []
  return baseList.map((s, i) => ({
    ...s,
    colorAssigned: s.color || palette[i % palette.length]
  }))
})

/* ---------- Actions ---------- */
function onSelectField(f: string): void { emit('select-field', f) }
// Ref to Visualizer to trigger exports

const visualizerRef = ref<InstanceType<typeof ChartVisualizer> | null>(null)
function triggerCsv() { visualizerRef.value?.exportCsv() }
function triggerSvg() { visualizerRef.value?.exportSvg() }
function triggerPng() { visualizerRef.value?.exportPng() }
/* ---------- Watchers & Hooks ---------- */

watch(() => props.fields, (fList) => {
  if (!props.selectedField && fList.length) nextTick(() => onSelectField(fList[0]!))
})

/* ---------- Hotkeys ---------- */
function handleKey(e: KeyboardEvent): void {
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey

  if (alt && /^[1-9]$/.test(key)) {
    const idx = parseInt(key, 10) - 1
    if (idx >= 0 && idx < props.fields.length) {
      e.preventDefault()
      onSelectField(props.fields[idx]!)
    }
  }
  if (alt && key === 'g') { e.preventDefault(); showGrid.value = !showGrid.value }
  if (alt && key === 'm') { e.preventDefault(); showMean.value = !showMean.value }
  if (alt && key === 'h') { e.preventDefault(); showHover.value = !showHover.value }
  if (alt && key === 'x') { e.preventDefault(); focusMode.value = !focusMode.value }
  if (alt && key === 'l') { e.preventDefault(); activeTab.value = 'LINE' }
  if (alt && key === 's') { e.preventDefault(); activeTab.value = 'SCATTER' }
  if (alt && key === 't') { e.preventDefault(); activeTab.value = 'HISTOGRAM' }
  if (alt && key === 'b') { e.preventDefault(); activeTab.value = 'BOXPLOT' }


  if (ctrl && key === 'e' && !e.shiftKey && !e.altKey) { e.preventDefault(); triggerCsv() }
  if (ctrl && e.shiftKey && key === 'e') { e.preventDefault(); triggerSvg() }
  if (ctrl && e.altKey && key === 'e') { e.preventDefault(); triggerPng() }
}
onMounted(() => window.addEventListener('keydown', handleKey))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))

/* ---------- A11Y ---------- */
const liveStatus = computed<string>(() => {
  if (!seriesEnhanced.value.length) return 'Graf nemá žádná data.'
  const parts: string[] = []
  if (props.stats) parts.push(`Mean ${fmt2(props.stats.mean)}, Count ${props.stats.count}`)
  if (focusMode.value) parts.push(`Fokus mód aktivní`)

  return parts.join('. ')
})
</script>

<template>
  <div
    class="chart-panel"
    :aria-label="liveStatus"
    aria-live="polite"
  >
    <!-- HODNOTY -->
    <section class="modern-section mb-4">
      <div class="section-header">
        <v-icon
          size="18"
          color="primary"
          class="mr-2"
        >
          mdi-tag-multiple
        </v-icon>
        <h3 class="section-title">
          Numerická pole
        </h3>
        <v-spacer />
        <v-tooltip
          location="top"
          text="Pro rychlý výběr použijte klávesy Alt + číslo"
        >
          <template #activator="{ props }">
            <v-chip
              v-bind="props"
              size="small"
              color="grey-darken-1"
              variant="tonal"
              class="keyboard-hint cursor-help"
              label
            >
              <v-icon
                size="14"
                start
                icon="mdi-keyboard-variant"
              />
              <span class="font-weight-bold">Alt+1..9</span>
            </v-chip>
          </template>
        </v-tooltip>
      </div>

      <div class="section-content pt-2 pb-3 px-3">
        <v-select
          :model-value="selectedField"
          :items="fields"
          label="Vyberte pole pro vizualizaci"
          variant="outlined"
          density="comfortable"
          hide-details
          class="field-select"
          menu-icon="mdi-chevron-down"
          @update:model-value="onSelectField"
        >
          <template #selection="{ item }">
            <v-chip
              color="primary"
              variant="flat"
              size="small"
              class="font-weight-medium"
              label
            >
              <template #prepend>
                <v-avatar
                  color="white"
                  size="20"
                  class="mr-1"
                >
                  <span class="text-primary text-caption font-weight-black">
                    {{ fields.indexOf(item.raw) + 1 }}
                  </span>
                </v-avatar>
              </template>
              {{ item.raw }}
            </v-chip>
          </template>

          <template #item="{ props, item, index }">
            <v-list-item
              v-bind="props"
              :title="item.raw"
              density="compact"
              class="mb-1 rounded-md"
              :class="{ 'bg-primary-lighten-5 text-primary font-weight-bold': item.raw === selectedField }"
            >
              <template #prepend>
                <v-avatar
                  size="24"
                  :color="item.raw === selectedField ? 'primary' : 'grey-lighten-2'"
                  :variant="item.raw === selectedField ? 'flat' : 'tonal'"
                  class="mr-3"
                >
                  <span
                    class="text-caption font-weight-bold"
                    :class="{'text-grey-darken-2': item.raw !== selectedField}"
                  >
                    {{ index + 1 }}
                  </span>
                </v-avatar>
              </template>

              <template
                v-if="item.raw === selectedField"
                #append
              >
                <v-icon
                  color="primary"
                  icon="mdi-check-circle"
                  size="small"
                />
              </template>
            </v-list-item>
          </template>
        </v-select>
      </div>
    </section>


    <!-- Chart + Stats Horizontal Layout -->
    <div class="chart-stats-row">
      <!-- Chart with Integrated Controls -->
      <section class="modern-section chart-section chart-section-flex">
      <!-- Chart Type Selector Bar -->
      <div class="chart-type-bar">
        <v-icon
          size="18"
          color="primary"
        >
          mdi-chart-multiple
        </v-icon>
        <span class="chart-type-label">Typ grafu</span>
        <v-btn-toggle
          v-model="activeTab"
          class="chart-type-toggle"
          divided
          mandatory
          density="comfortable"
          color="primary"
        >
          <v-btn
            v-for="tab in tabs"
            :key="tab"
            :value="tab"
            size="small"
            class="chart-type-btn"
          >
            <v-icon
              :icon="tabIcons[tab]"
              size="18"
            />
            <span class="ml-1 text-caption">{{ tab }}</span>
          </v-btn>
        </v-btn-toggle>










      </div>
      <!-- Main Chart Layout -->
      <div class="chart-main-layout">
        <!-- Chart Visualizer -->
        <div class="chart-visualizer-wrapper">
          <ChartVisualizer
            ref="visualizerRef"
            :series="seriesEnhanced"
            :active-tab="activeTab"
            :stats="stats"
            :outliers="outliers"
            :x-labels="xLabels"
            :show-grid="showGrid"
            :show-mean="showMean"
            :show-hover="showHover"
            :focus-mode="focusMode"

          />
        </div>
        <!-- Controls Sidebar -->
        <div class="chart-controls-sidebar">
          <!-- Display Options -->
          <div class="control-group">
            <div class="control-label">
              <v-icon size="14">
                mdi-tune
              </v-icon>
              <span>Zobrazení</span>
            </div>
            <v-btn
              size="small"
              :color="showGrid ? 'primary' : 'grey'"
              :variant="showGrid ? 'flat' : 'tonal'"
              prepend-icon="mdi-grid"
              block
              class="control-btn"
              @click="showGrid = !showGrid"
            >
              Mřížka
            </v-btn>
            <v-btn
              size="small"
              :color="showMean ? 'orange' : 'grey'"
              :variant="showMean ? 'flat' : 'tonal'"
              prepend-icon="mdi-chart-bell-curve"
              block
              class="control-btn"
              @click="showMean = !showMean"
            >
              Mean
            </v-btn>
            <v-btn
              size="small"
              :color="showHover ? 'primary' : 'grey'"
              :variant="showHover ? 'flat' : 'tonal'"
              prepend-icon="mdi-crosshairs"
              block
              class="control-btn"
              @click="showHover = !showHover"
            >
              Hover
            </v-btn>
            <v-btn
              size="small"
              :color="focusMode ? 'deep-purple' : 'grey'"
              :variant="focusMode ? 'flat' : 'tonal'"
              prepend-icon="mdi-eye-outline"
              block
              class="control-btn"
              @click="focusMode = !focusMode"
            >
              Focus
            </v-btn>
          </div>
          <div class="control-divider" />
          <!-- Export Options -->
          <div class="control-group">
            <div class="control-label">
              <v-icon size="14">
                mdi-download
              </v-icon>
              <span>Export</span>
            </div>
            <v-tooltip
              text="Export CSV (Ctrl+E)"
              location="left"
            >
              <template #activator="{ props: tp }">
                <v-btn
                  v-bind="tp"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-file-delimited"
                  block
                  class="control-btn"
                  @click="triggerCsv"
                >
                  CSV
                </v-btn>
              </template>
            </v-tooltip>
            <v-tooltip
              text="Export SVG (Ctrl+Shift+E)"
              location="left"
            >
              <template #activator="{ props: tp }">
                <v-btn
                  v-bind="tp"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-vector-square"
                  block
                  class="control-btn"
                  @click="triggerSvg"
                >
                  SVG
                </v-btn>
              </template>
            </v-tooltip>
            <v-tooltip
              text="Export PNG (Ctrl+Alt+E)"
              location="left"
            >
              <template #activator="{ props: tp }">
                <v-btn
                  v-bind="tp"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-file-image"
                  block
                  class="control-btn"
                  @click="triggerPng"
                >
                  PNG
                </v-btn>
              </template>
            </v-tooltip>
          </div>
        </div>
      </div>
    </section>
    <!-- Stats Component (beside chart) -->
    <ChartStats
      :stats="stats"
      :outliers="outliers"
      class="stats-beside-chart"
    />
    </div><!-- end chart-stats-row -->
    <!-- Series Legend -->
    <v-expand-transition>
      <section
        v-if="seriesEnhanced.length > 1"
        class="modern-section mt-4"
      >
        <div class="section-header">
          <v-icon
            size="18"
            color="primary"
          >
            mdi-format-list-bulleted
          </v-icon>
          <h3 class="section-title">
            Legenda sérií
          </h3>
        </div>
        <div class="section-content">
          <div class="series-legend">
            <v-chip
              v-for="(s, i) in seriesEnhanced"
              :key="s.label + i"
              size="small"
              variant="flat"
              :style="{ backgroundColor: s.colorAssigned, color: 'white' }"
              class="legend-chip"
            >
              {{ s.label }}
              <v-chip
                size="small"
                variant="elevated"
                color="white"
                class="ml-1"
                style="color: inherit;"
              >
                {{ s.points.length }}
              </v-chip>
            </v-chip>
          </div>
        </div>
      </section>
    </v-expand-transition>
  </div>
</template>

<style scoped>
.chart-panel {
  display: flex;
  flex-direction: column;
}
/* Modern Section - Blue Card Style */
.modern-section {
  background: #F4F7FB;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.modern-section:hover {
  background: #F0F4F9;
  border-color: rgba(var(--v-theme-primary), 0.3);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-height: 40px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.4);
}
.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
  letter-spacing: 0.01em;
  margin: 0;
}
.section-content {
  padding: 16px;
}
/* Field Chips */
.field-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.field-chip {
  transition: all 0.2s ease;
}
.field-chip:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}
.keyboard-hint {
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
}
/* Chart + Stats Horizontal Layout */
.chart-stats-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.chart-section-flex {
  flex: 1;
  min-width: 0;
}
.stats-beside-chart {
  width: 280px;
  flex-shrink: 0;
}
.stats-beside-chart :deep(.stats-grid) {
  grid-template-columns: repeat(2, 1fr);
}
.stats-beside-chart :deep(.stat-item) {
  padding: 12px 14px;
  min-height: 70px;
}
.stats-beside-chart :deep(.stat-item:nth-child(3n)) {
  border-right: 1px solid rgba(0, 0, 0, 0.06);
}
.stats-beside-chart :deep(.stat-item:nth-child(2n)) {
  border-right: none;
}
.stats-beside-chart :deep(.stat-item:nth-last-child(-n+3)) {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.stats-beside-chart :deep(.stat-item:nth-last-child(-n+2)) {
  border-bottom: none;
}
/* Chart Section Specific */
.chart-section {
  padding: 0;
}
.chart-type-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.4);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.chart-type-label {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
}
.chart-type-toggle {
  flex: 1;
  max-width: 500px;
  margin-left: auto;
}
.chart-type-btn {
  flex: 1;
  font-weight: 600;
}
/* Main Chart Layout */
.chart-main-layout {
  display: flex;
  min-height: 280px;
}
.chart-visualizer-wrapper {
  flex: 1;
  padding: 16px;
  background: white;
  min-width: 0;
}
.chart-controls-sidebar {
  width: 180px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.6);
  border-left: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
}
.control-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.control-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: rgba(0, 0, 0, 0.5);
  margin-bottom: 4px;
}
.control-btn {
  text-transform: none;
  justify-content: flex-start;
}
.control-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 12px 0;
}
/* Series Legend */
.series-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.legend-chip {
  font-weight: 600;
  letter-spacing: 0.02em;
}
/* Responsive */
@media (max-width: 960px) {
  .chart-main-layout {
    flex-direction: column;
  }
  .chart-controls-sidebar {
    width: 100%;
    border-left: none;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
  }
  .control-group {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .control-label {
    width: 100%;
  }
  .control-group .v-btn {
    flex: 1;
    min-width: 100px;
  }
  .control-divider {
    width: 100%;
    margin: 8px 0;
  }
}
@media (max-width: 768px) {
  .field-chips {
    gap: 6px;
  }
  .chart-type-btn span {
    display: none;
  }
  .chart-type-toggle {
    max-width: none;
  }
  .chart-visualizer-wrapper {
    padding: 12px;
  }
  .chart-controls-sidebar {
    padding: 12px;
  }
}
</style>
