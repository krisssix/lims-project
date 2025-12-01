<!-- ChartPanel.vue -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { type StatsObj, type OutliersMeta, type MultiSeriesItem, fmt2 } from './types'
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
const emit = defineEmits<{ (e: 'select-field', field: string): void }>()

/* ---------- Histogram eligibility ---------- */
const MIN_UNIQUE_FOR_HIST = 8
const baseNumericValues = computed<number[]>(() =>
  (props.multiSeries && props.multiSeries.length
    ? props.multiSeries[0]!.points
    : props.chartPoints) || []
)
const uniqueCount = computed<number>(() => new Set(baseNumericValues.value.filter(v => Number.isFinite(v))).size)
const varianceApprox = computed<number>(() => {
  const arr = baseNumericValues.value
  if (arr.length <= 1) return 0
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  return arr.reduce((acc, v) => acc + (v - m) * (v - m), 0) / arr.length
})
const histogramEligible = computed<boolean>(() =>
  uniqueCount.value >= MIN_UNIQUE_FOR_HIST && varianceApprox.value > 0
)

/* ---------- Tabs ---------- */
const rawTabs = ['LINE', 'SCATTER', 'HISTOGRAM', 'BOXPLOT'] as const
type TabKind = typeof rawTabs[number]
const activeTab = ref<TabKind>('LINE')
const tabIcons: Record<TabKind, string> = {
  LINE: 'mdi-chart-line',
  SCATTER: 'mdi-chart-scatter-plot',
  HISTOGRAM: 'mdi-chart-bar',
  BOXPLOT: 'mdi-chart-box-outline'
}

/* Vypočítaná sada tabs podle eligibility */
const tabs = computed<TabKind[]>(() =>
  rawTabs.filter(t => t !== 'HISTOGRAM' || histogramEligible.value)
)

/* Pokud se eligibility změní z true->false a jsme na HISTOGRAM, přepnout na LINE */
watch(histogramEligible, (ok) => {
  if (!ok && activeTab.value === 'HISTOGRAM') activeTab.value = 'LINE'
})

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

/* ---------- Exports přes ref ---------- */
const visualizerRef = ref<InstanceType<typeof ChartVisualizer> | null>(null)
function triggerCsv() { visualizerRef.value?.exportCsv() }
function triggerSvg() { visualizerRef.value?.exportSvg() }
function triggerPng() { visualizerRef.value?.exportPng() }

/* ---------- Auto select prvního pole ---------- */
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
  if (alt && key === 'b') { e.preventDefault(); activeTab.value = 'BOXPLOT' }
  // Alt+T (histogram) jen pokud eligible
  if (alt && key === 't' && histogramEligible.value) { e.preventDefault(); activeTab.value = 'HISTOGRAM' }
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
  if (focusMode.value) parts.push('Fokus mód aktivní')
  if (!histogramEligible.value) parts.push('Histogram skryt – málo unikátních hodnot')
  return parts.join('. ')
})
</script>

<template>
  <div class="chart-panel" :aria-label="liveStatus" aria-live="polite">
    <section class="modern-section mb-4">
      <div class="section-header">
        <v-icon size="18" color="primary" class="mr-2">mdi-tag-multiple</v-icon>
        <h3 class="section-title">Numerická pole</h3>
        <v-spacer />
        <v-tooltip location="top" text="Pro rychlý výběr použijte klávesy Alt + číslo">
          <template #activator="{ props }">
            <v-chip v-bind="props" size="x-small" color="grey-darken-1" variant="tonal" class="keyboard-hint cursor-help" label>
              <v-icon size="14" start icon="mdi-keyboard-variant" />
              <span class="font-weight-bold">Alt+1..9</span>
            </v-chip>
          </template>
        </v-tooltip>
      </div>

      <div class="section-content pt-2 pb-3 px-3">
        <v-select
          :model-value="props.selectedField"
          :items="props.fields"
          label="Vyberte pole pro vizualizaci"
          variant="outlined"
          density="comfortable"
          hide-details
          class="field-select"
          menu-icon="mdi-chevron-down"
          @update:model-value="onSelectField"
        >
          <template #selection="{ item }">
            <v-chip color="primary" variant="flat" size="small" class="font-weight-medium" label>
              <template #prepend>
                <v-avatar color="white" size="20" class="mr-1">
                  <span class="text-primary text-caption font-weight-black">
                    {{ props.fields.indexOf(item.raw) + 1 }}
                  </span>
                </v-avatar>
              </template>
              {{ item.raw }}
            </v-chip>
          </template>
          <template #item="{ props: itemProps, item, index }">
            <v-list-item
              v-bind="itemProps"
              :title="item.raw"
              density="compact"
              class="mb-1 rounded-md"
              :class="{ 'bg-primary-lighten-5 text-primary font-weight-bold': item.raw === props.selectedField }"
            >
              <template #prepend>
                <v-avatar
                  size="24"
                  :color="item.raw === props.selectedField ? 'primary' : 'grey-lighten-2'"
                  :variant="item.raw === props.selectedField ? 'flat' : 'tonal'"
                  class="mr-3"
                >
                  <span class="text-caption font-weight-bold" :class="{'text-grey-darken-2': item.raw !== props.selectedField}">
                    {{ index + 1 }}
                  </span>
                </v-avatar>
              </template>
              <template v-if="item.raw === props.selectedField" #append>
                <v-icon color="primary" icon="mdi-check-circle" size="small" />
              </template>
            </v-list-item>
          </template>
        </v-select>
      </div>
    </section>

    <ChartStats :stats="props.stats" :outliers="props.outliers" class="mb-4" />

    <section class="modern-section chart-section">
      <div class="chart-type-bar">
        <v-icon size="18" color="primary">mdi-chart-multiple</v-icon>
        <span class="chart-type-label">Typ grafu</span>
        <v-btn-toggle v-model="activeTab" class="chart-type-toggle" divided mandatory density="comfortable" color="primary">
          <v-btn v-for="tab in tabs" :key="tab" :value="tab" size="small" class="chart-type-btn">
            <v-icon :icon="tabIcons[tab]" size="18" />
            <span class="ml-1 text-caption">{{ tab }}</span>
          </v-btn>
        </v-btn-toggle>
        <v-chip
          v-if="!histogramEligible"
          size="x-small"
          color="grey"
          variant="tonal"
          class="ml-3"
          title="Histogram skryt: unikátních hodnot méně než 8 nebo variance=0"
        >
          Histogram nedostupný
        </v-chip>
      </div>

      <div class="chart-main-layout">
        <div class="chart-visualizer-wrapper">
          <ChartVisualizer
            ref="visualizerRef"
            :series="seriesEnhanced"
            :active-tab="activeTab"
            :stats="props.stats"
            :outliers="props.outliers"
            :x-labels="props.xLabels"
            :show-grid="showGrid"
            :show-mean="showMean"
            :show-hover="showHover"
            :focus-mode="focusMode"
            :histogram-eligible="histogramEligible"
          />
        </div>
        <div class="chart-controls-sidebar">
          <div class="control-group">
            <div class="control-label">
              <v-icon size="14">mdi-tune</v-icon>
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
          <div class="control-group">
            <div class="control-label">
              <v-icon size="14">mdi-download</v-icon>
              <span>Export</span>
            </div>
            <v-tooltip text="Export CSV (Ctrl+E)" location="left">
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
            <v-tooltip text="Export SVG (Ctrl+Shift+E)" location="left">
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
            <v-tooltip text="Export PNG (Ctrl+Alt+E)" location="left">
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

    <v-expand-transition>
      <section v-if="seriesEnhanced.length > 1" class="modern-section mt-4">
        <div class="section-header">
          <v-icon size="18" color="primary">mdi-format-list-bulleted</v-icon>
          <h3 class="section-title">Legenda sérií</h3>
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
              <v-chip size="x-small" variant="elevated" color="white" class="ml-1" style="color: inherit;">
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
.chart-panel { display: flex; flex-direction: column; }
.modern-section { background: #F4F7FB; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 12px; overflow: hidden; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.modern-section:hover { background: #F0F4F9; border-color: rgba(var(--v-theme-primary), 0.3); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04); }
.section-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; min-height: 56px; border-bottom: 1px solid rgba(0, 0, 0, 0.06); background: rgba(255, 255, 255, 0.4); }
.section-title { font-size: 0.95rem; font-weight: 600; margin: 0; }
.chart-section { padding: 0; }
.chart-type-bar { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: rgba(255, 255, 255, 0.4); border-bottom: 1px solid rgba(0, 0, 0, 0.06); }
.chart-type-toggle { flex: 1; max-width: 500px; margin-left: auto; }
.chart-type-btn { flex: 1; font-weight: 600; }
.chart-main-layout { display: flex; min-height: 400px; }
.chart-visualizer-wrapper { flex: 1; padding: 16px; background: white; min-width: 0; }
.chart-controls-sidebar { width: 180px; padding: 16px; background: rgba(255, 255, 255, 0.6); border-left: 1px solid rgba(0, 0, 0, 0.06); display: flex; flex-direction: column; }
.control-group { display: flex; flex-direction: column; gap: 8px; }
.control-label { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: rgba(0, 0, 0, 0.5); margin-bottom: 4px; }
.control-btn { text-transform: none; justify-content: flex-start; }
.control-divider { height: 1px; background: rgba(0, 0, 0, 0.06); margin: 12px 0; }
.series-legend { display: flex; flex-wrap: wrap; gap: 8px; }
.legend-chip { font-weight: 600; letter-spacing: 0.02em; }
@media (max-width: 960px) {
  .chart-main-layout { flex-direction: column; }
  .chart-controls-sidebar { width: 100%; border-left: none; border-top: 1px solid rgba(0, 0, 0, 0.06); }
  .control-group { flex-direction: row; flex-wrap: wrap; }
  .control-group .v-btn { flex: 1; min-width: 100px; }
}
</style>
