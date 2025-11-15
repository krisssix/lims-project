<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  chartPoints: number[]
  stats: {
    mean: number
    median: number
    stdDev: number
    min: number
    max: number
    count: number
  } | null
  fields: string[]
  selectedField: string | null
}>()

const emit = defineEmits<{
  (e: 'select-field', field: string): void
}>()

const tabs = ['LINE', 'SCATTER', 'HISTOGRAM', 'BOXPLOT'] as const
const activeTab = ref<'LINE'|'SCATTER'|'HISTOGRAM'|'BOXPLOT'>('LINE')

function fmt2(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '—'
}

function buildSparkPoints(vals: number[]): string {
  if (!vals.length) return ''
  const n = vals.length
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mx - mn
  return vals.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * 100
    const yNorm = range === 0 ? 50 : ((v - mn) / range) * 80 + 10
    const y = 100 - yNorm
    return `${x},${y}`
  }).join(' ')
}

const sparkPoints = computed(() => buildSparkPoints(props.chartPoints))
const sparkWidth = computed(() => Math.max(320, props.chartPoints.length * 30))

const hasStats = computed<boolean>(() => !!props.stats)
const statsSafe = computed<{
  mean: number; median: number; stdDev: number; min: number; max: number; count: number
}>(() => props.stats ?? { mean: NaN, median: NaN, stdDev: NaN, min: NaN, max: NaN, count: 0 })
</script>

<template>
  <div class="chart-panel">
    <div class="field-selector">
      <v-chip
        v-for="(f, i) in fields"
        :key="f + i"
        class="ma-1"
        :color="selectedField === f ? 'primary' : 'grey lighten-3'"
        clickable
        :title="`Alt+${i + 1}`"
        @click="() => emit('select-field', f)"
      >
        {{ f }}
      </v-chip>
    </div>

    <v-sheet class="pa-3 mb-4">
      <div v-if="hasStats">
        <div class="d-flex justify-space-between">
          <div>Mean</div><div>{{ fmt2(statsSafe.mean) }}</div>
        </div>
        <div class="d-flex justify-space-between">
          <div>Median</div><div>{{ fmt2(statsSafe.median) }}</div>
        </div>
        <div class="d-flex justify-space-between">
          <div>St. deviation</div><div>{{ fmt2(statsSafe.stdDev) }}</div>
        </div>
        <div class="d-flex justify-space-between">
          <div>Min</div><div>{{ fmt2(statsSafe.min) }}</div>
        </div>
        <div class="d-flex justify-space-between">
          <div>Max</div><div>{{ fmt2(statsSafe.max) }}</div>
        </div>
        <div class="d-flex justify-space-between">
          <div>Count</div><div>{{ statsSafe.count }}</div>
        </div>
      </div>
      <div
        v-else
        class="text-medium-emphasis"
      >
        Vyberte numerické pole pro výpočet statistik
      </div>
    </v-sheet>

    <div class="tab-buttons mb-2">
      <v-btn
        v-for="tab in tabs"
        :key="tab"
        :color="activeTab === tab ? 'primary' : 'default'"
        size="small"
        class="me-2"
        @click="activeTab = tab"
      >
        {{ tab }}
      </v-btn>
    </div>

    <v-sheet
      class="pa-4"
      elevation="1"
      style="height: 200px; display: flex; align-items: center; justify-content: center"
    >
      <svg
        v-if="activeTab === 'LINE' && chartPoints.length"
        :width="sparkWidth"
        height="160"
        style="width: 100%; height: 160px"
      >
        <polyline
          :points="sparkPoints"
          fill="none"
          stroke="#3f51b5"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <div
        v-else-if="activeTab === 'LINE'"
        class="text-medium-emphasis"
      >
        Žádná data pro graf
      </div>
      <div
        v-else
        class="text-medium-emphasis"
      >
        {{ activeTab }} vizualizace zatím není implementována
      </div>
    </v-sheet>
  </div>
</template>

<style scoped>
.chart-panel {
  display: flex;
  flex-direction: column;
}
.field-selector {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.tab-buttons {
  display: flex;
  flex-wrap: wrap;
}
</style>
