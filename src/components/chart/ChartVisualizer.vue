<script setup lang="ts">
import { ref, computed } from 'vue'
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

}>()
/* reference na svg a exporty (svg ref & exports) */

const svgRef = ref<SVGSVGElement | null>(null)









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
    canvas.width = 800
    canvas.height = 400
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
function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
// zpřístupnění exportních metod rodičovské komponentě (expose methods)
defineExpose({ exportCsv, exportSvg, exportPng })
/* matematické pomůcky (math helpers) */

const allValuesFlat = computed<number[]>(() => {
  const out: number[] = []
  for (const s of props.series) out.push(...s.points)
  return out
})
const yMin = computed(() => allValuesFlat.value.length ? Math.min(...allValuesFlat.value) : 0)
const yMax = computed(() => allValuesFlat.value.length ? Math.max(...allValuesFlat.value) : 1)
const yRange = computed(() => yMax.value - yMin.value)
const pointCount = computed<number>(() =>
  Math.max(...props.series.map(s => s.points.length), 0)
)
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
  if (!points.length) return ''
  return points.map((v, i) => `${mapXValue(i, points.length)},${mapYValue(v)}`).join(' ')
}
/* specifická logika grafů (chart logic) */
// bodový graf (scatter)
const scatterSeries = computed(() => {
  const out: {
    cx: number
    cy: number
    color?: string
    label: string
    idx: number
    seriesIndex: number
  }[] = []
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
// histogram






















const histogram = computed(() => {
  const vals = props.series[0]?.points || []
  if (!vals.length) return { bins: [], maxCount: 0 }
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mx - mn
  const n = vals.length
  const binCount = Math.max(1, Math.ceil(Math.sqrt(n)))
  const binWidth = range === 0 ? 1 : range / binCount
  const counts = Array.from({ length: binCount }, () => 0)






























  for (const v of vals) {
    let idx = range === 0 ? 0 : Math.floor((v - mn) / binWidth)
    if (idx >= binCount) idx = binCount - 1
    if (idx < 0) idx = 0
    counts[idx] += 1
  }
  const maxCount = Math.max(...counts, 0)
  const bins = counts.map((c, i) => {


    const x = (i / binCount) * 100
    const w = (1 / binCount) * 100 * 0.95
    const h = maxCount === 0 ? 0 : (c / maxCount) * 80
    const y = 90 - h
    return { x, y, w, h, count: c }
  })
  return { bins, maxCount }
})

const meanXForHistogram = computed<number | null>(() => {
  const vals = props.series[0]?.points || []
  const st = props.stats
  if (!st || !vals.length || !Number.isFinite(st.mean)) return null
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mx - mn
  if (range === 0) return 50
  const norm = (st.mean - mn) / range
  return Math.max(0, Math.min(100, norm * 100))
})
// krabicový graf (boxplot)

const box = computed(() => {
  const vals = props.series[0]?.points || []
  if (!vals.length) return null
  const sorted = [...vals].sort((a, b) => a - b)
  const quantile = (arr: number[], p: number) => {
    const pos = (arr.length - 1) * p
    const base = Math.floor(pos)
    const rest = pos - base
    if (arr[base + 1] !== undefined) return arr[base] + rest * (arr[base + 1] - arr[base])
    return arr[base]
  }
  const q1 = quantile(sorted, 0.25)
  const med = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1
  const lowFence = q1 - 1.5 * iqr
  const highFence = q3 + 1.5 * iqr
  const whiskerMin = sorted.find(v => v >= lowFence) ?? sorted[0]
  const whiskerMax = [...sorted].reverse().find(v => v <= highFence) ?? sorted[sorted.length - 1]
  return {
    yMin: mapYValue(whiskerMin),
    yQ1: mapYValue(q1),
    yMed: mapYValue(med),
    yQ3: mapYValue(q3),
    yMax: mapYValue(whiskerMax)
  }
})
// odlehlé hodnoty (outliers)
const outlierLookup = computed<Set<number>>(() =>
  props.outliers ? new Set(props.outliers.outlierIndexes) : new Set()
)
const outlierPoints = computed(() => {
  if (!props.outliers || !props.series[0]?.points.length) return []
  return props.outliers.outlierIndexes.map(i => ({
    idx: i,
    cx: mapXValue(i, props.series[0].points.length),
    cy: mapYValue(props.series[0].points[i])
  }))
})
/* interakce při najetí myši (hover) */

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
// Handlers
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
// Computed for Hover Display
const meanY = computed<number | null>(() =>
  props.stats && Number.isFinite(props.stats.mean) ? mapYValue(props.stats.mean) : null
)
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

/* přístupnost (aria) */
const ariaLabel = computed(() => {
  const c = props.series[0]?.points.length ?? 0
  switch (props.activeTab) {
    case 'LINE': return `Čárový graf s ${c} body`
    case 'SCATTER': return `Bodový graf s ${c} body`
    case 'HISTOGRAM': return `Histogram s ${c} hodnotami`
    case 'BOXPLOT': return `Boxplot s ${c} hodnotami`
  }
  return 'Graf'
})






























</script>

<template>
  <v-sheet
    class="pa-4 chart-area"
    elevation="1"
    rounded
  >
    <div
      v-if="!series.length"
      class="text-medium-emphasis"
    >
      Žádná data pro graf
    </div>
    <svg
      v-else
      ref="svgRef"
      class="chart-svg"
      viewBox="-5 0 110 100"  preserveAspectRatio="none"

      :aria-label="ariaLabel"
      role="img"
      @mousemove="activeTab === 'HISTOGRAM' ? onMouseMoveHist($event) : (activeTab === 'BOXPLOT' ? onMouseMoveBox($event) : onMouseMoveLine($event))"
      @mouseleave="activeTab === 'HISTOGRAM' ? onMouseLeaveHist() : (activeTab === 'BOXPLOT' ? onMouseLeaveBox() : onMouseLeaveLine())"
    >
      <desc v-if="stats">Průměr {{ fmt2(stats.mean) }}, min {{ fmt2(stats.min) }}, max {{ fmt2(stats.max) }}</desc>
      <g class="axes">
        <line
          x1="5"
          x2="95"
          y1="90"
          y2="90"
          stroke="#9e9e9e"
          stroke-width="0.6"
        />

        <line
          x1="5"
          x2="5"
          y1="10"
          y2="90"
          stroke="#9e9e9e"
          stroke-width="0.6"
        />
        <template v-if="showGrid">
          <line
            v-for="i in 4"
            :key="'grid-y-'+i"
            x1="0"
            x2="100"
            :y1="10 + (i/4)*80"
            :y2="10 + (i/4)*80"
            stroke="#eeeeee"
            stroke-width="0.4"
          />
          <template v-if="activeTab !== 'HISTOGRAM' && activeTab !== 'BOXPLOT'">
            <line
              v-for="(lbl, i) in xLabelsSafe"
              :key="'grid-x-'+i"
              :x1="mapXValue(i, xLabelsSafe.length)"
              :x2="mapXValue(i, xLabelsSafe.length)"
              y1="90"
              y2="92"
              stroke="#9e9e9e"
              stroke-width="0.6"
            />
            <text
              v-for="(lbl, i) in xLabelsSafe"
              :key="'lbl-'+i"
              :x="mapXValue(i, xLabelsSafe.length)"
              y="96"
              text-anchor="middle"
              fill="#666"
              font-size="5"
            >{{ lbl }}</text>
          </template>
        </template>
        <text
          x="95"
          y="98"
          text-anchor="end"
          fill="#666"
          font-size="5"
        >X</text>
        <text
          x="2"
          y="8"
          text-anchor="start"
          fill="#666"
          font-size="5"
        >Y</text>
      </g>


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
          <template
            v-for="(s, si) in series"
            :key="'pts-'+si"
          >
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
          <line
            :x1="hoverXPercent"
            :x2="hoverXPercent"
            y1="10"
            y2="90"
            stroke="#bdbdbd"
            stroke-width="0.6"
            stroke-dasharray="2,2"
          />
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


      <g v-else-if="activeTab === 'HISTOGRAM'">
        <rect
          v-for="(b, i) in histogram.bins"
          :key="'hb-'+i"
          :x="b.x"
          :y="b.y"
          :width="b.w"
          :height="b.h"
          fill="#90caf9"
          stroke="#42a5f5"
          stroke-width="0.5"
        />
        <template v-if="showHover && hoveredBin !== null">





















          <text
            :x="histogram.bins[hoveredBin].x + histogram.bins[hoveredBin].w/2"
            :y="Math.max(12, histogram.bins[hoveredBin].y - 2)"
            text-anchor="middle"
            font-size="5"
            fill="#424242"
          >{{ histogram.bins[hoveredBin].count }}</text>







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
      </g>


      <g v-else-if="activeTab === 'BOXPLOT' && box">
        <line
          x1="50"
          x2="50"
          :y1="box.yMin"
          :y2="box.yQ1"
          stroke="#455a64"
          stroke-width="1"
        />
        <line
          x1="50"
          x2="50"
          :y1="box.yQ3"
          :y2="box.yMax"
          stroke="#455a64"
          stroke-width="1"
        />
        <line
          x1="40"
          x2="60"
          :y1="box.yMin"
          :y2="box.yMin"
          stroke="#455a64"
          stroke-width="1"
        />
        <line
          x1="40"
          x2="60"
          :y1="box.yMax"
          :y2="box.yMax"
          stroke="#455a64"
          stroke-width="1"
        />
        <rect
          :x="35"
          :y="box.yQ3"
          width="30"
          :height="Math.max(0.5, box.yQ1 - box.yQ3)"
          fill="#c5e1a5"
          stroke="#7cb342"
          stroke-width="1"
        />
        <line
          x1="35"
          x2="65"
          :y1="box.yMed"
          :y2="box.yMed"
          stroke="#e53935"
          stroke-width="1.4"
        />
        <template v-if="showHover && hoverYPercent !== null && !hoverMeanActive">
          <line
            x1="0"
            x2="100"
            :y1="hoverYPercent"
            :y2="hoverYPercent"
            stroke="#bdbdbd"
            stroke-width="0.6"
            stroke-dasharray="2,2"
            pointer-events="none"
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
.chart-canvas-wrapper {
  width: 100%;
  height: 100%;
  display: block;
}

.chart-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.axis-label-main {
  font-family: 'Roboto', sans-serif;
  font-size: 3.5px;
  fill: #9e9e9e;
  font-weight: 500;
}

.tooltip-text {
  font-family: 'Roboto', sans-serif;
  font-size: 3px;
  fill: #424242;
  font-weight: 600;
  pointer-events: none;
  dominant-baseline: middle;
}
</style>
