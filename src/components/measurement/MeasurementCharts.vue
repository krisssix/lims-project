<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, type PropType } from 'vue'
import Chart, { type ChartDataset } from 'chart.js/auto'

type FieldKey = string
type Point = { x: number; y: number }
type SeriesItem = { key: FieldKey; label: string; values: number[]; color?: string }
type ChartKind = 'line'|'scatter'|'histogram'|'box'

const props = defineProps({
  series: { type: Array as PropType<SeriesItem[]>, default: () => [] },
  availableFields: { type: Array as PropType<{ key: string; label: string }[]>, default: () => [] },
  initialType: { type: String as PropType<ChartKind>, default: 'line' }
})

const canvas = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null

const chartType = ref<ChartKind>(props.initialType)
const selectedFields = ref<FieldKey[]>(
  props.series.map(s => s.key).slice(0, 1)
)

function fieldLabel(key: string): string {
  const found = props.availableFields.find(f => f.key === key)
  return found ? found.label : key
}

function buildDatasets(): ChartDataset<'line'|'scatter', Point[]>[] {
  const chosen = props.series.filter(s => selectedFields.value.includes(s.key))
  return chosen.map((s) => ({
    label: s.label,
    data: s.values.map((v, i) => ({ x: i, y: v })),
    borderColor: s.color,
    backgroundColor: s.color,
    showLine: chartType.value === 'line',
    type: chartType.value === 'line' ? 'line' : 'scatter'
  }))
}

function renderChart(): void {
  if (!canvas.value) return
  const ctx = canvas.value.getContext('2d')
  if (!ctx) return
  if (chart) chart.destroy()

  // Histogram a boxplot zatím zobrazíme jako scatter/line (viz budoucí rozšíření)
  const baseType = chartType.value === 'line' ? 'line' : 'scatter'

  chart = new Chart(ctx, {
    type: baseType,
    data: { datasets: buildDatasets() },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: 'Index / Record' } },
        y: { title: { display: true, text: 'Hodnota' } }
      },
      plugins: {
        legend: { display: true }
      }
    }
  })
}

function statsOf(key: string): { mean: number; median: number; stdDev: number } {
  const s = props.series.find(x => x.key === key)
  if (!s || !s.values.length) return { mean: NaN, median: NaN, stdDev: NaN }
  const arr = s.values
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const sorted = [...arr].sort((a, b) => a - b)
  const median = (sorted.length % 2 === 1)
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const variance = arr.length > 1
    ? arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (arr.length - 1)
    : 0
  const stdDev = Math.sqrt(variance)
  return { mean, median, stdDev }
}

function exportCsv(): void {
  const rows: string[] = []
  const headers = ['index', ...selectedFields.value.map(f => fieldLabel(f))]
  rows.push(headers.join(','))

  const maxLen = Math.max(
    0,
    ...props.series.map(s =>
      (selectedFields.value.includes(s.key) ? s.values.length : 0)
    )
  )

  for (let i = 0; i < maxLen; i++) {
    const row: string[] = [String(i)]
    for (const k of selectedFields.value) {
      const s = props.series.find(x => x.key === k)
      row.push(s?.values[i]?.toString() ?? '')
    }
    rows.push(row.join(','))
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'chart-data.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function exportPng(): void {
  if (!canvas.value) return
  const url = canvas.value.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = 'chart.png'
  a.click()
}

onMounted(renderChart)
onBeforeUnmount(() => { if (chart) chart.destroy() })
watch([() => props.series, chartType, selectedFields], () => renderChart(), { deep: true })
</script>

<template>
  <div class="measurement-charts">
    <div class="controls d-flex align-center mb-3">
      <div class="field-select">
        <label class="text-caption">Vybrat pole pro graf</label>
        <v-autocomplete
          v-model="selectedFields"
          :items="availableFields"
          item-title="label"
          item-value="key"
          label="Pole"
          multiple
          density="comfortable"
          hide-details
          chips
          clearable
        />
      </div>

      <!-- PascalCase zlepší typovou inferenci (a potlačí unknown tag lint) -->
      <VSegmentedButton
        v-model="chartType"
        class="ml-4"
      >
        <v-btn value="line">
          LINE
        </v-btn>
        <v-btn value="scatter">
          SCATTER
        </v-btn>
        <v-btn value="histogram">
          HISTOGRAM
        </v-btn>
        <v-btn value="box">
          BOXPLOT
        </v-btn>
      </VSegmentedButton>

      <v-spacer />
      <v-btn
        size="small"
        variant="text"
        @click="exportCsv"
      >
        Export CSV
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        @click="exportPng"
      >
        Export PNG
      </v-btn>
    </div>

    <div
      class="content d-flex"
      style="gap:16px"
    >
      <div
        class="stats"
        style="min-width:180px"
      >
        <div
          v-for="f of selectedFields"
          :key="f"
          class="mb-2"
        >
          <div class="text-caption">
            {{ fieldLabel(f) }}
          </div>
          <div class="text-subtitle-2">
            {{ statsOf(f).mean.toFixed(2) }}
          </div>
          <div class="text-caption">
            median {{ statsOf(f).median.toFixed(2) }} · σ {{ statsOf(f).stdDev.toFixed(2) }}
          </div>
        </div>
      </div>

      <div
        class="chart-wrap"
        style="flex:1 1 0"
      >
        <canvas ref="canvas" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.measurement-charts .controls { align-items: center; gap: 12px; display: flex; }
.chart-wrap { height: 320px; border-radius: 6px; background: #fff; padding: 8px; }
.stats { background: #fafafa; padding: 8px; border-radius: 6px; }
</style>
