<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { type MultiSeriesItem, type StatsObj, type OutliersMeta, fmt2, niceNumber } from './types'

const props = defineProps<{
  series: MultiSeriesItem[]
  activeTab: 'LINE' | 'SCATTER' | 'HISTOGRAM' | 'BOXPLOT'
  stats: StatsObj | null
  outliers?: OutliersMeta | null
  xLabels?: Array<number | string>
  showGrid: boolean
  showMean: boolean
  showHover: boolean
  focusMode: boolean
  histogramEligible: boolean
}>()

/* ---------- Export ---------- */
const svgRef = ref<SVGSVGElement | null>(null)
function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
function exportCsv() {
  const lines: string[] = []
  const header = ['index', ...props.series.map(s => s.label)]
  lines.push(header.join(','))
  const maxLen = Math.max(...props.series.map(s => s.points.length), 0)
  for (let i = 0; i < maxLen; i++) {
    const row: string[] = [String(xLabelsSafe.value[i] ?? i)]
    for (const s of props.series) {
      row.push(s.points[i] != null ? String(s.points[i]) : '')
    }
    lines.push(row.join(','))
  }
  downloadBlob(lines.join('\n'), 'chart-data.csv', 'text/csv;charset=utf-8;')
}
function exportSvg() {
  if (!svgRef.value) return
  const serializer = new XMLSerializer()
  const source = serializer.serializeToString(svgRef.value)
  downloadBlob(source, 'chart.svg', 'image/svg+xml;charset=utf-8')
}
function exportPng() {
  if (!svgRef.value) return
  const serializer = new XMLSerializer()
  const source = serializer.serializeToString(svgRef.value)
  const img = new Image()
  const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 450
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    canvas.toBlob(b => {
      if (b) {
        const pngUrl = URL.createObjectURL(b)
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = 'chart.png'
        a.click()
        URL.revokeObjectURL(pngUrl)
      }
    }, 'image/png')
  }
  img.src = url
}
defineExpose({ exportCsv, exportSvg, exportPng })

/* ---------- Common math ---------- */
const allValuesFlat = computed<number[]>(() => {
  const out: number[] = []
  for (const s of props.series) out.push(...s.points)
  return out
})
const yMin = computed(() => allValuesFlat.value.length ? Math.min(...allValuesFlat.value) : 0)
const yMax = computed(() => allValuesFlat.value.length ? Math.max(...allValuesFlat.value) : 1)
const yRange = computed(() => yMax.value - yMin.value)
const pointCount = computed<number>(() => Math.max(...props.series.map(s => s.points.length), 0))
const xLabelsSafe = computed<Array<number | string>>(() => {
  const xl = props.xLabels
  if (xl && xl.length === pointCount.value) return xl
  return Array.from({ length: pointCount.value }, (_v, i) => i)
})
function mapYValue(v: number): number {
  const range = yRange.value
  const yNorm = range === 0 ? 0.5 : (v - yMin.value) / range
  return 100 - (yNorm * 80 + 10)
}
function mapXValue(idx: number, total: number): number {
  return total <= 1 ? 50 : 5 + (idx / (total - 1)) * 90
}
function buildPolyline(points: number[]): string {
  return points.map((v, i) => `${mapXValue(i, points.length)},${mapYValue(v)}`).join(' ')
}

/* ---------- Scatter data ---------- */
const scatterSeries = computed(() => {
  const out: { cx: number; cy: number; color?: string; label: string; idx: number; seriesIndex: number }[] = []
  props.series.forEach((s, si) => {
    s.points.forEach((v, i) => {
      out.push({
        cx: mapXValue(i, s.points.length),
        cy: mapYValue(v),
        color: s.colorAssigned,
        label: s.label,
        idx: i,
        seriesIndex: si
      })
    })
  })
  return out
})

/* ---------- Adaptivní histogram ---------- */
const histogramMode = ref<'AUTO' | 'FD' | 'SCOTT' | 'SQRT'>('AUTO')
const manualBins = ref<number | null>(null)

function fdBinWidth(values: number[]): number {
  if (values.length < 2) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(0.25 * (sorted.length - 1))]
  const q3 = sorted[Math.floor(0.75 * (sorted.length - 1))]
  const iqr = (q3 - q1) || 0
  if (iqr === 0) return 0
  return 2 * iqr / Math.cbrt(values.length)
}
function scottBinWidth(values: number[]): number {
  if (values.length < 2) return 0
  const m = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length
  const stdDev = Math.sqrt(variance) || 0
  if (stdDev === 0) return 0
  return 3.5 * stdDev / Math.cbrt(values.length)
}

const histogram = computed(() => {
  const vals = props.series[0]?.points.filter(v => Number.isFinite(v)) || []
  const unique = new Set(vals)
  if (!props.histogramEligible) {
    return { bins: [], maxCount: 0, meta: { reason: 'ineligible', count: vals.length, unique: unique.size } }
  }
  if (!vals.length) return { bins: [], maxCount: 0, meta: null }
  const minV = Math.min(...vals)
  const maxV = Math.max(...vals)
  const range = maxV - minV
  if (range === 0) {
    return {
      bins: [{
        x: 10, y: 10, w: 80, h: 80, count: vals.length, from: minV, to: maxV, mean: minV
      }],
      maxCount: vals.length,
      meta: { singleValue: true, binCount: 1, min: minV, max: maxV, method: 'NONE' }
    }
  }

  let binCount: number
  if (manualBins.value && manualBins.value > 1) {
    binCount = manualBins.value
  } else {
    let width = 0
    switch (histogramMode.value) {
      case 'FD': width = fdBinWidth(vals); break
      case 'SCOTT': width = scottBinWidth(vals); break
      case 'SQRT': width = range / Math.ceil(Math.sqrt(vals.length)); break
      case 'AUTO':
      default: {
        width = fdBinWidth(vals) || scottBinWidth(vals) || (range / Math.ceil(Math.sqrt(vals.length)))
      }
    }
    if (width <= 0) width = range / Math.ceil(Math.sqrt(vals.length))
    binCount = Math.min(80, Math.max(2, Math.ceil(range / width)))
  }

  const counts = new Array(binCount).fill(0)
  const binWidth = range / binCount
  for (const v of vals) {
    let idx = Math.floor((v - minV) / binWidth)
    if (idx >= binCount) idx = binCount - 1
    if (idx < 0) idx = 0
    counts[idx]++
  }
  const maxCount = Math.max(...counts, 0)
  const bins = counts.map((c, i) => {
    const from = minV + i * binWidth
    const to = i === binCount - 1 ? maxV : from + binWidth
    const x = (i / binCount) * 100
    const w = (1 / binCount) * 100 * 0.95
    const h = maxCount === 0 ? 0 : (c / maxCount) * 80
    const y = 90 - h
    return { x, y, w, h, count: c, from, to }
  })
  return { bins, maxCount, meta: { min: minV, max: maxV, binCount, range, method: histogramMode.value } }
})

const meanXForHistogram = computed<number | null>(() => {
  const st = props.stats
  const meta = histogram.value.meta
  if (!st || !meta || !Number.isFinite(st.mean)) return null
  const { min, max } = meta
  const range = max - min
  if (range <= 0) return 50
  const norm = (st.mean - min) / range
  return Math.max(0, Math.min(100, norm * 100))
})

/* ---------- Boxplot ---------- */
const box = computed(() => {
  const vals = props.series[0]?.points.filter(v => Number.isFinite(v)) || []
  if (!vals.length) return null
  const sorted = [...vals].sort((a, b) => a - b)
  const quantile = (arr: number[], p: number) => {
    const pos = (arr.length - 1) * p
    const base = Math.floor(pos)
    const rest = pos - base
    return arr[base + 1] !== undefined ? arr[base] + rest * (arr[base + 1] - arr[base]) : arr[base]
  }
  const q1 = quantile(sorted, 0.25)
  const med = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1
  const lowFence = q1 - 1.5 * iqr
  const highFence = q3 + 1.5 * iqr
  const whiskerMin = sorted.find(v => v >= lowFence) ?? sorted[0]
  const whiskerMax = [...sorted].reverse().find(v => v <= highFence) ?? sorted[sorted.length - 1]
  return { yMin: mapYValue(whiskerMin), yQ1: mapYValue(q1), yMed: mapYValue(med), yQ3: mapYValue(q3), yMax: mapYValue(whiskerMax) }
})

/* ---------- Outliers ---------- */
const outlierLookup = computed<Set<number>>(() => props.outliers ? new Set(props.outliers.outlierIndexes) : new Set())
const outlierPoints = computed(() => {
  if (!props.outliers || !props.series[0]?.points.length) return []
  return props.outliers.outlierIndexes.map(i => ({
    idx: i,
    cx: mapXValue(i, props.series[0].points.length),
    cy: mapYValue(props.series[0].points[i])
  }))
})

/* ---------- Interaction ---------- */
const hoverXPercent = ref<number | null>(null)
const hoverYPercent = ref<number | null>(null)
const hoverIdx = ref<number | null>(null)
const hoverValue = ref<number | null>(null)
const hoveredBin = ref<number | null>(null)

function getMouseXPercent(e: MouseEvent): number {
  const el = e.currentTarget as SVGSVGElement | null
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  return Math.max(0, Math.min(100, ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100))
}
function getMouseYPercent(e: MouseEvent): number {
  const el = e.currentTarget as SVGSVGElement | null
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  return Math.max(0, Math.min(100, ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100))
}
function onMouseMoveLine(e: MouseEvent) {
  if (!props.series[0]?.points.length) return
  const pct = getMouseXPercent(e)
  hoverXPercent.value = pct
  const n = props.series[0].points.length
  const idx = n <= 1 ? 0 : Math.round(((n - 1) * pct) / 100)
  hoverIdx.value = Math.max(0, Math.min(n - 1, idx))
  hoverValue.value = props.series[0].points[hoverIdx.value]
}
function onMouseLeaveLine() {
  hoverXPercent.value = null
  hoverIdx.value = null
  hoverValue.value = null
}
function onMouseMoveHist(e: MouseEvent) {
  const h = histogram.value
  if (!h.bins.length) return
  const pct = getMouseXPercent(e)
  hoverXPercent.value = pct
  const binCount = h.bins.length
  let idx = Math.floor((pct / 100) * binCount)
  if (idx >= binCount) idx = binCount - 1
  if (idx < 0) idx = 0
  hoveredBin.value = idx
}
function onMouseLeaveHist() {
  hoveredBin.value = null
  hoverXPercent.value = null
}
function onMouseMoveBox(e: MouseEvent) {
  hoverYPercent.value = getMouseYPercent(e)
}
function onMouseLeaveBox() {
  hoverYPercent.value = null
}

/* ---------- Hover mean / value ---------- */
const meanY = computed<number | null>(() => props.stats && Number.isFinite(props.stats.mean) ? mapYValue(props.stats.mean) : null)
const hoverMeanActive = computed<boolean>(() =>
  (props.showMean && props.showHover && meanY.value !== null && hoverYPercent.value !== null &&
    Math.abs(hoverYPercent.value - meanY.value) < 2)
)
const hoverYValueLabel = computed<string | null>(() => {
  if (hoverYPercent.value == null) return null
  const yNorm = 100 - hoverYPercent.value
  const norm = (yNorm - 10) / 80
  const clamped = Math.max(0, Math.min(1, norm))
  const val = yMin.value + clamped * yRange.value
  return niceNumber(val)
})

/* ---------- ARIA ---------- */
const ariaLabel = computed(() => {
  const c = props.series[0]?.points.length ?? 0
  switch (props.activeTab) {
    case 'LINE': return `Line chart with ${c} points`
    case 'SCATTER': return `Scatter chart with ${c} points`
    case 'HISTOGRAM': return props.histogramEligible ? `Adaptive histogram of ${c} values` : `Histogram unavailable`
    case 'BOXPLOT': return `Boxplot of ${c} values`
  }
  return 'Chart'
})

/* ---------- Histogram hotkeys (Alt+H / Alt+Plus / Alt+Minus) ---------- */
function onKey(e: KeyboardEvent) {
  if (props.activeTab !== 'HISTOGRAM' || !props.histogramEligible) return
  if (!e.altKey) return
  const k = e.key
  if (k === 'h' || k === 'H') {
    e.preventDefault()
    const order: Array<typeof histogramMode.value> = ['AUTO', 'FD', 'SCOTT', 'SQRT']
    const idx = order.indexOf(histogramMode.value)
    histogramMode.value = order[(idx + 1) % order.length]
    manualBins.value = null
    return
  }
  if (k === '+' || k === '=') {
    e.preventDefault()
    manualBins.value = (manualBins.value ?? histogram.value.meta?.binCount ?? 10) + 1
    return
  }
  if (k === '-' || k === '_') {
    e.preventDefault()
    manualBins.value = Math.max(2, (manualBins.value ?? histogram.value.meta?.binCount ?? 10) - 1)
    return
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/* Reset manual bins při změně dat */
watch(() => props.series[0]?.points.length, () => { manualBins.value = null })
</script>

<template>
  <v-sheet class="pa-4 chart-area" elevation="1" rounded>
    <div v-if="!series.length" class="text-medium-emphasis">Žádná data pro graf</div>
    <div v-else-if="activeTab === 'HISTOGRAM' && !histogramEligible" class="text-medium-emphasis">
      Histogram není k dispozici (nedostatek unikátních hodnot nebo nulová variance).
    </div>
    <svg
      v-else
      ref="svgRef"
      class="chart-svg"
      viewBox="-5 0 110 100"
      preserveAspectRatio="none"
      :aria-label="ariaLabel"
      role="img"
      @mousemove="activeTab === 'HISTOGRAM' ? onMouseMoveHist($event) : (activeTab === 'BOXPLOT' ? onMouseMoveBox($event) : onMouseMoveLine($event))"
      @mouseleave="activeTab === 'HISTOGRAM' ? onMouseLeaveHist() : (activeTab === 'BOXPLOT' ? onMouseLeaveBox() : onMouseLeaveLine())"
    >
      <desc v-if="stats">Mean {{ fmt2(stats.mean) }}, min {{ fmt2(stats.min) }}, max {{ fmt2(stats.max) }}</desc>
      <g class="axes">
        <line x1="5" x2="95" y1="90" y2="90" stroke="#9e9e9e" stroke-width="0.6" />
        <line x1="5" x2="5" y1="10" y2="90" stroke="#9e9e9e" stroke-width="0.6" />
        <template v-if="showGrid">
          <line v-for="i in 4" :key="'grid-y-'+i" x1="0" x2="100" :y1="10 + (i/4)*80" :y2="10 + (i/4)*80" stroke="#eeeeee" stroke-width="0.4" />
          <template v-if="activeTab !== 'HISTOGRAM' && activeTab !== 'BOXPLOT'">
            <line v-for="(_lbl, i) in xLabelsSafe" :key="'grid-x-'+i" :x1="mapXValue(i, xLabelsSafe.length)" :x2="mapXValue(i, xLabelsSafe.length)" y1="90" y2="92" stroke="#9e9e9e" stroke-width="0.6" />
            <text v-for="(lbl, i) in xLabelsSafe" :key="'lbl-'+i" :x="mapXValue(i, xLabelsSafe.length)" y="96" text-anchor="middle" fill="#666" font-size="5">{{ lbl }}</text>
          </template>
        </template>
        <text x="95" y="98" text-anchor="end" fill="#666" font-size="5">X</text>
        <text x="2" y="8" text-anchor="start" fill="#666" font-size="5">Y</text>
      </g>

      <!-- LINE -->
      <g v-if="activeTab === 'LINE'">
        <polyline
          v-for="(s, si) in series"
          :key="'pl-'+si"
          :points="buildPolyline(s.points)"
          fill="none"
          :stroke="s.colorAssigned"
          stroke-width="1"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <g>
          <template v-for="(s, si) in series" :key="'pts-'+si">
            <circle
              v-for="(v, i) in s.points"
              :key="'pt-'+si+'-'+i"
              :cx="mapXValue(i, s.points.length)"
              :cy="mapYValue(v)"
              :r="focusMode && hoverIdx === i ? 3.2 : 1.6"
              :fill="si === 0 && outlierLookup.has(i) ? '#e64a19' : s.colorAssigned"
              :stroke="focusMode && hoverIdx === i ? '#1e88e5' : 'none'"
              stroke-width="1"
            />
          </template>
        </g>
        <g v-if="outlierPoints.length">
          <circle
            v-for="o in outlierPoints"
            :key="'out-'+o.idx"
            :cx="o.cx"
            :cy="o.cy"
            r="3"
            fill="none"
            stroke="#e64a19"
            stroke-width="0.8"
          />
        </g>
        <g v-if="showHover && hoverXPercent !== null && hoverIdx !== null && hoverValue !== null && !hoverMeanActive">
          <line :x1="hoverXPercent" :x2="hoverXPercent" y1="10" y2="90" stroke="#bdbdbd" stroke-width="0.6" stroke-dasharray="2,2" />
          <circle
            :cx="mapXValue(hoverIdx, series[0].points.length)"
            :cy="mapYValue(hoverValue)"
            :r="focusMode ? 4 : 3"
            fill="#1e88e5"
            fill-opacity="0.85"
          />
          <text
            :x="Math.min(95, mapXValue(hoverIdx, series[0].points.length) + 2)"
            :y="Math.max(12, mapYValue(hoverValue) - 2)"
            font-size="5"
            fill="#424242"
          >{{ hoverIdx }}: {{ fmt2(hoverValue) }}</text>
        </g>
      </g>

      <!-- SCATTER -->
      <g v-else-if="activeTab === 'SCATTER'">
        <circle
          v-for="p in scatterSeries"
          :key="'sc-'+p.seriesIndex+'-'+p.idx"
          :cx="p.cx"
          :cy="p.cy"
          :r="focusMode && hoverIdx === p.idx ? 4 : 2.2"
          :fill="p.color"
          fill-opacity="0.85"
          :stroke="outlierLookup.has(p.idx) && p.seriesIndex === 0 ? '#e64a19' : (focusMode && hoverIdx === p.idx ? '#1e88e5' : 'none')"
          stroke-width="1"
        />
        <g v-if="showHover && hoverXPercent !== null && hoverIdx !== null && hoverValue !== null && !hoverMeanActive">
          <text
            :x="Math.min(95, mapXValue(hoverIdx, series[0].points.length) + 2)"
            :y="Math.max(12, mapYValue(hoverValue) - 2)"
            font-size="5"
            fill="#424242"
          >{{ hoverIdx }}: {{ fmt2(hoverValue) }}</text>
        </g>
      </g>

      <!-- HISTOGRAM -->
      <g v-else-if="activeTab === 'HISTOGRAM'">
        <template v-if="histogram.bins.length">
          <rect
            v-for="(b, i) in histogram.bins"
            :key="'hb-'+i"
            :x="b.x"
            :y="b.y"
            :width="b.w"
            :height="b.h"
            :fill="meanXForHistogram !== null && meanXForHistogram >= b.x && meanXForHistogram < b.x + b.w ? '#64b5f6' : '#90caf9'"
            stroke="#42a5f5"
            stroke-width="0.5"
          />
          <template v-if="showHover && hoveredBin !== null && histogram.bins[hoveredBin]">
            <text
              :x="histogram.bins[hoveredBin].x + histogram.bins[hoveredBin].w/2"
              :y="Math.max(12, histogram.bins[hoveredBin].y - 2)"
              text-anchor="middle"
              font-size="5"
              fill="#424242"
            >
              {{ histogram.bins[hoveredBin].count }} | {{ fmt2(histogram.bins[hoveredBin].from) }}–{{ fmt2(histogram.bins[hoveredBin].to) }}
            </text>
          </template>
          <line
            v-if="showMean && meanXForHistogram !== null"
            :x1="meanXForHistogram"
            :x2="meanXForHistogram"
            y1="10"
            y2="90"
            stroke="#ff9800"
            stroke-dasharray="2,2"
            stroke-width="0.8"
          />
          <text
            v-if="histogram.meta"
            x="6"
            y="8"
            font-size="5"
            fill="#424242"
          >
            {{ histogram.meta.binCount }} bins ({{ histogram.meta.method }}) {{ manualBins ? '(manual '+manualBins+')' : '' }}
          </text>
        </template>
        <template v-else>
          <text x="10" y="50" font-size="6" fill="#666">
            Histogram nelze sestavit
          </text>
        </template>
      </g>

      <!-- BOXPLOT -->
      <g v-else-if="activeTab === 'BOXPLOT' && box">
        <line x1="50" x2="50" :y1="box.yMin" :y2="box.yQ1" stroke="#455a64" stroke-width="1" />
        <line x1="50" x2="50" :y1="box.yQ3" :y2="box.yMax" stroke="#455a64" stroke-width="1" />
        <line x1="40" x2="60" :y1="box.yMin" :y2="box.yMin" stroke="#455a64" stroke-width="1" />
        <line x1="40" x2="60" :y1="box.yMax" :y2="box.yMax" stroke="#455a64" stroke-width="1" />
        <rect :x="35" :y="box.yQ3" width="30" :height="Math.max(0.5, box.yQ1 - box.yQ3)" fill="#c5e1a5" stroke="#7cb342" stroke-width="1" />
        <line x1="35" x2="65" :y1="box.yMed" :y2="box.yMed" stroke="#e53935" stroke-width="1.4" />
        <template v-if="showHover && hoverYPercent !== null && !hoverMeanActive">
          <line
            x1="0" x2="100"
            :y1="hoverYPercent" :y2="hoverYPercent"
            stroke="#bdbdbd" stroke-width="0.6" stroke-dasharray="2,2" pointer-events="none"
          />
          <text
            x="98"
            :y="Math.max(12, hoverYPercent - 2)"
            text-anchor="end"
            font-size="5"
            fill="#424242"
          >{{ hoverYValueLabel }}</text>
        </template>
      </g>

      <!-- Mean line for line/scatter/box -->
      <template v-if="(activeTab === 'LINE' || activeTab === 'SCATTER' || activeTab === 'BOXPLOT') && showMean && meanY !== null">
        <line
          x1="0"
          x2="100"
          :y1="meanY"
          :y2="meanY"
          :stroke="hoverMeanActive ? '#fb8c00' : '#ff9800'"
          stroke-dasharray="2,2"
          :stroke-width="hoverMeanActive ? 1.2 : 0.8"
        />
        <text
          v-if="hoverMeanActive"
          x="98"
          :y="Math.max(12, (meanY ?? 12) - 2)"
          text-anchor="end"
          font-size="5"
          fill="#424242"
        >Mean: {{ fmt2(stats?.mean) }}</text>
      </template>
    </svg>
  </v-sheet>
</template>

<style scoped>
.chart-svg { width: 100%; height: 100%; overflow: visible; }
.chart-area { min-height: 320px; }
</style>
