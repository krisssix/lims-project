<script setup lang="ts">
/**
 * ChartPanel (lint-clean + a11y)
 * - Typy grafu: LINE / SCATTER / HISTOGRAM / BOXPLOT
 * - multiSeries, xLabels, outliers
 * - Klávesové zkratky:
 *    Alt+1..9  výběr pole
 *    Alt+G     toggle grid
 *    Alt+M     toggle mean line
 *    Alt+H     toggle hover overlay
 *    Alt+L/S/T/B  změna typu grafu
 *    Alt+X     toggle focusMode (a11y zvýraznění)
 *    Ctrl+E / Ctrl+Shift+E / Ctrl+Alt+E  export CSV / SVG / PNG
 */

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

type StatsObj = {
  mean: number
  median: number
  stdDev: number
  min: number
  max: number
  count: number
}

type OutliersMeta = {
  outlierIndexes: number[]
  lowerFence: number
  upperFence: number
  q1: number
  q3: number
}

type MultiSeriesItem = {
  label: string
  points: number[]
  color?: string
}

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

/* ---------- Tabs & toggles ---------- */
const tabs = ['LINE', 'SCATTER', 'HISTOGRAM', 'BOXPLOT'] as const
type TabKind = typeof tabs[number]
const activeTab = ref<TabKind>('LINE')

const showGrid = ref(true)
const showMean = ref(true)
const showHover = ref(true)
const focusMode = ref(false) // a11y zvýraznění hover elementu

/* ---------- Výběr pole ---------- */
function onSelectField(f: string): void { emit('select-field', f) }

/* ---------- Helpers ---------- */
function fmt2(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '—'
}
function niceNumber(x: number): string {
  if (!Number.isFinite(x)) return ''
  const abs = Math.abs(x)
  if (abs >= 1000 || abs < 0.01) return x.toExponential(1)
  if (abs >= 100) return x.toFixed(0)
  if (abs >= 10) return x.toFixed(1)
  return x.toFixed(2)
}

/* ---------- Série ---------- */
const singleSeriesPoints = computed<number[]>(
  () => (props.multiSeries && props.multiSeries.length ? [] : (props.chartPoints || []))
)

const seriesList = computed<MultiSeriesItem[]>(() =>
  props.multiSeries && props.multiSeries.length
    ? props.multiSeries
    : singleSeriesPoints.value.length
      ? [{ label: props.selectedField || 'Data', points: singleSeriesPoints.value }]
      : []
)

const allValuesFlat = computed<number[]>(() => seriesList.value.flatMap(s => s.points))
const yMin = computed(() => allValuesFlat.value.length ? Math.min(...allValuesFlat.value) : 0)
const yMax = computed(() => allValuesFlat.value.length ? Math.max(...allValuesFlat.value) : 1)
const yRange = computed(() => yMax.value - yMin.value)

const pointCount = computed<number>(() =>
  Math.max(...seriesList.value.map(s => s.points.length), singleSeriesPoints.value.length)
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
  return total <= 1 ? 0 : (idx / (total - 1)) * 100
}
function buildPolyline(points: number[]): string {
  if (!points.length) return ''
  return points.map((v, i) => `${mapXValue(i, points.length)},${mapYValue(v)}`).join(' ')
}

/* ---------- Scatter ---------- */
const scatterSeries = computed<Array<{ cx: number; cy: number; color: string; label: string; idx: number }>>(() => {
  const out: Array<{ cx: number; cy: number; color: string; label: string; idx: number }> = []
  for (const s of seriesList.value) {
    s.points.forEach((v, i) => {
      out.push({
        cx: mapXValue(i, s.points.length),
        cy: mapYValue(v),
        color: s.color || '#3f51b5',
        label: s.label,
        idx: i
      })
    })
  }
  return out
})

/* ---------- Histogram (první série) ---------- */
function buildHistogram(vals: number[]) {
  if (!vals.length) return { bins: [] as { x: number; y: number; w: number; h: number; count: number }[], maxCount: 0 }
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
}
const histogram = computed(() => buildHistogram(seriesList.value[0]?.points || []))
const meanXForHistogram = computed<number | null>(() => {
  const vals = seriesList.value[0]?.points || []
  const st = props.stats
  if (!st || !vals.length || !Number.isFinite(st.mean)) return null
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mx - mn
  if (range === 0) return 50
  const norm = (st.mean - mn) / range
  return Math.max(0, Math.min(100, norm * 100))
})

/* ---------- Boxplot ---------- */
function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * p
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  return sorted[base]
}
function buildBoxplot(vals: number[]) {
  if (!vals.length) return null as null | {
    yMin: number; yQ1: number; yMed: number; yQ3: number; yMax: number
  }
  const sorted = [...vals].sort((a, b) => a - b)
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
}
const box = computed(() => buildBoxplot(seriesList.value[0]?.points || []))

/* ---------- Outliers ---------- */
const outlierLookup = computed<Set<number>>(() =>
  props.outliers ? new Set(props.outliers.outlierIndexes) : new Set()
)
const outlierPoints = computed<Array<{ idx: number; cx: number; cy: number }>>(() => {
  if (!props.outliers || !seriesList.value[0]?.points.length) return []
  return props.outliers.outlierIndexes.map(i => ({
    idx: i,
    cx: mapXValue(i, seriesList.value[0]!.points.length),
    cy: mapYValue(seriesList.value[0]!.points[i]!)
  }))
})

/* ---------- Hover ---------- */
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

function onMouseMoveLine(e: MouseEvent): void {
  if (!seriesList.value[0]?.points.length) return
  const pct = getMouseXPercent(e)
  hoverXPercent.value = pct
  const n = seriesList.value[0]!.points.length
  const idx = n <= 1 ? 0 : Math.round(((n - 1) * pct) / 100)
  hoverIdx.value = Math.max(0, Math.min(n - 1, idx))
  hoverValue.value = seriesList.value[0]!.points[hoverIdx.value]!
}
function onMouseLeaveLine(): void {
  hoverXPercent.value = null
  hoverIdx.value = null
  hoverValue.value = null
}

function onMouseMoveHist(e: MouseEvent): void {
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
function onMouseLeaveHist(): void {
  hoveredBin.value = null
  hoverXPercent.value = null
}
function onMouseMoveBox(e: MouseEvent): void {
  hoverYPercent.value = getMouseYPercent(e)
}
function onMouseLeaveBox(): void {
  hoverYPercent.value = null
}

/* ---------- Mean ---------- */
const meanY = computed<number | null>(() =>
  props.stats && Number.isFinite(props.stats.mean) ? mapYValue(props.stats.mean) : null
)
const hoverMeanActive = computed<boolean>(() =>
  !!(showMean.value && showHover.value && meanY.value !== null && hoverYPercent.value !== null &&
    Math.abs(hoverYPercent.value - meanY.value) < 2)
)

/* ---------- Hover Y value ---------- */
function yPercentToValue(yPct: number): number {
  const yNorm = 100 - yPct
  const norm = (yNorm - 10) / 80
  const clamped = Math.max(0, Math.min(1, norm))
  return yMin.value + clamped * yRange.value
}
const hoverYValueLabel = computed<string | null>(() => {
  if (hoverYPercent.value == null) return null
  return niceNumber(yPercentToValue(hoverYPercent.value))
})

/* ---------- Tab switch ---------- */
function setTab(kind: TabKind): void { activeTab.value = kind }

/* ---------- Exporty ---------- */
function exportCsv(): void {
  const lines: string[] = []
  const header = ['index', ...seriesList.value.map(s => s.label)]
  lines.push(header.join(','))
  const maxLen = Math.max(...seriesList.value.map(s => s.points.length), 0)
  for (let i = 0; i < maxLen; i++) {
    const row: string[] = [String(xLabelsSafe.value[i] ?? i)]
    for (const s of seriesList.value) {
      row.push(s.points[i] != null ? String(s.points[i]) : '')
    }
    lines.push(row.join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = props.selectedField ? `chart-${props.selectedField}.csv` : 'chart-data.csv'
  a.click()
  URL.revokeObjectURL(url)
}
function currentSvgElement(): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>('#chartpanel-svg-current')
}
function exportSvg(): void {
  const svg = currentSvgElement()
  if (!svg) return
  const serializer = new XMLSerializer()
  const source = serializer.serializeToString(svg)
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'chart.svg'
  a.click()
  URL.revokeObjectURL(url)
}
function exportPng(): void {
  const svg = currentSvgElement()
  if (!svg) return
  const serializer = new XMLSerializer()
  const source = serializer.serializeToString(svg)
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
      if (!b) return
      const pngUrl = URL.createObjectURL(b)
      const a = document.createElement('a')
      a.href = pngUrl
      a.download = 'chart.png'
      a.click()
      URL.revokeObjectURL(pngUrl)
    }, 'image/png')
  }
  img.src = url
}

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

  if (alt && key === 'l') { e.preventDefault(); setTab('LINE') }
  if (alt && key === 's') { e.preventDefault(); setTab('SCATTER') }
  if (alt && key === 't') { e.preventDefault(); setTab('HISTOGRAM') }
  if (alt && key === 'b') { e.preventDefault(); setTab('BOXPLOT') }

  if (ctrl && key === 'e' && !e.shiftKey && !e.altKey) { e.preventDefault(); exportCsv() }
  if (ctrl && e.shiftKey && key === 'e') { e.preventDefault(); exportSvg() }
  if (ctrl && e.altKey && key === 'e') { e.preventDefault(); exportPng() }
}

onMounted(() => window.addEventListener('keydown', handleKey))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))

/* ---------- ARIA ---------- */
function ariaLabelFor(type: TabKind): string {
  const c = seriesList.value[0]?.points.length ?? 0
  if (type === 'LINE') return `Line chart with ${c} point(s).`
  if (type === 'SCATTER') return `Scatter chart with ${c} point(s).`
  if (type === 'HISTOGRAM') return `Histogram of ${c} value(s).`
  return `Boxplot of ${c} value(s).`
}

/* ---------- Fallback výběr prvního pole ---------- */
watch(() => props.fields, (fList) => {
  if (!props.selectedField && fList.length) nextTick(() => onSelectField(fList[0]!))
})

/* ---------- A11Y live status ---------- */
const liveStatus = computed<string>(() => {
  if (!seriesList.value.length) return 'Graf nemá žádná data.'
  const parts: string[] = []
  if (props.stats) {
    parts.push(`Mean ${fmt2(props.stats.mean)}`)
    parts.push(`Count ${props.stats.count}`)
  }
  if (focusMode.value && hoverIdx.value != null && hoverValue.value != null) {
    parts.push(`Fokus bod ${hoverIdx.value} = ${fmt2(hoverValue.value)}`)
  }
  return parts.join('. ')
})
</script>

<template>
  <div class="chart-panel" :aria-label="liveStatus" aria-live="polite">
    <!-- Field selector -->
    <div class="field-selector">
      <v-chip
        v-for="(f, i) in fields"
        :key="f + i"
        class="ma-1"
        :color="selectedField === f ? 'primary' : 'grey-lighten-3'"
        clickable
        :title="`Alt+${i + 1}`"
        @click="onSelectField(f)"
      >{{ f }}</v-chip>
    </div>

    <!-- Stats -->
    <v-sheet class="pa-3 mb-4">
      <div v-if="stats">
        <div class="d-flex justify-space-between"><div>Mean</div><div>{{ fmt2(stats.mean) }}</div></div>
        <div class="d-flex justify-space-between"><div>Median</div><div>{{ fmt2(stats.median) }}</div></div>
        <div class="d-flex justify-space-between"><div>Std. deviation</div><div>{{ fmt2(stats.stdDev) }}</div></div>
        <div class="d-flex justify-space-between"><div>Min</div><div>{{ fmt2(stats.min) }}</div></div>
        <div class="d-flex justify-space-between"><div>Max</div><div>{{ fmt2(stats.max) }}</div></div>
        <div class="d-flex justify-space-between"><div>Count</div><div>{{ stats.count }}</div></div>
        <div v-if="outliers && outliers.outlierIndexes.length" class="text-caption mt-2">
          Outliers: {{ outliers.outlierIndexes.join(', ') }}
          (fence {{ fmt2(outliers.lowerFence) }} – {{ fmt2(outliers.upperFence) }})
        </div>
      </div>
      <div v-else class="text-medium-emphasis">
        Vyberte numerické pole pro výpočet statistik
      </div>
    </v-sheet>

    <!-- Tabs -->
    <div class="tab-buttons mb-2">
      <v-btn
        v-for="tab in tabs"
        :key="tab"
        :color="activeTab === tab ? 'primary' : undefined"
        size="small"
        class="me-2"
        @click="activeTab = tab"
      >{{ tab }}</v-btn>
    </div>

    <!-- Options -->
    <div class="chart-options mb-2 d-flex align-center ga-2 flex-wrap">
      <v-btn
        size="x-small"
        :color="showGrid ? 'primary' : undefined"
        variant="tonal"
        role="switch"
        :aria-checked="showGrid"
        title="Přepnout mřížku (Alt+G)"
        @click="showGrid = !showGrid"
      >Mřížka</v-btn>
      <v-btn
        size="x-small"
        :color="showMean ? 'primary' : undefined"
        variant="tonal"
        role="switch"
        :aria-checked="showMean"
        title="Přepnout mean linku (Alt+M)"
        @click="showMean = !showMean"
      >Mean</v-btn>
      <v-btn
        size="x-small"
        :color="showHover ? 'primary' : undefined"
        variant="tonal"
        role="switch"
        :aria-checked="showHover"
        title="Přepnout hover overlay (Alt+H)"
        @click="showHover = !showHover"
      >Hover</v-btn>
      <v-btn
        size="x-small"
        :color="focusMode ? 'primary' : undefined"
        variant="tonal"
        role="switch"
        :aria-checked="focusMode"
        title="A11Y fokus mód (Alt+X)"
        @click="focusMode = !focusMode"
      >Focus</v-btn>
      <v-spacer />
      <v-btn size="x-small" variant="text" title="Export CSV (Ctrl+E)" @click="exportCsv">CSV</v-btn>
      <v-btn size="x-small" variant="text" title="Export SVG (Ctrl+Shift+E)" @click="exportSvg">SVG</v-btn>
      <v-btn size="x-small" variant="text" title="Export PNG (Ctrl+Alt+E)" @click="exportPng">PNG</v-btn>
    </div>

    <!-- Chart area -->
    <v-sheet class="pa-4 chart-area" elevation="1">
      <!-- LINE -->
      <svg
        v-if="activeTab === 'LINE' && seriesList.length && seriesList[0].points.length"
        id="chartpanel-svg-current"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        :aria-label="ariaLabelFor('LINE')"
        role="img"
        style="width: 60%; height: 100%"
        @mousemove="onMouseMoveLine"
        @mouseleave="onMouseLeaveLine"
      >
        <desc>Mean {{ fmt2(stats?.mean) }}, min {{ fmt2(stats?.min) }}, max {{ fmt2(stats?.max) }}</desc>

        <g class="axes">
          <line x1="0" x2="100" y1="90" y2="90" stroke="#9e9e9e" stroke-width="0.6"/>
          <line x1="0" x2="0" y1="10" y2="90" stroke="#9e9e9e" stroke-width="0.6"/>

          <!-- Y grid lines -->
          <template v-if="showGrid">
            <line
              v-for="i in 4"
              :key="'line-y-'+i"
              x1="0" x2="100"
              :y1="10 + (i/4)*80"
              :y2="10 + (i/4)*80"
              stroke="#eeeeee"
              stroke-width="0.4"
            />
          </template>

          <!-- X ticks + labels -->
          <template v-if="showGrid">
            <line
              v-for="(lbl, i) in xLabelsSafe"
              :key="'line-x-'+i"
              :x1="mapXValue(i, xLabelsSafe.length)"
              :x2="mapXValue(i, xLabelsSafe.length)"
              y1="90" y2="92"
              stroke="#9e9e9e"
              stroke-width="0.6"
            />
            <text
              v-for="(lbl, i) in xLabelsSafe"
              :key="'line-x-t-'+i"
              :x="mapXValue(i, xLabelsSafe.length)"
              y="96"
              text-anchor="middle"
              fill="#666"
              font-size="5"
            >{{ lbl }}</text>
          </template>

          <text x="95" y="98" text-anchor="end" fill="#666" font-size="5">Index</text>
          <text x="2" y="8" text-anchor="start" fill="#666" font-size="5">Hodnota</text>
        </g>

        <!-- Polylines -->
        <g>
          <polyline
            v-for="(s, si) in seriesList"
            :key="'pline-'+si"
            :points="buildPolyline(s.points)"
            fill="none"
            :stroke="s.color || (si === 0 ? '#3f51b5' : '#9c27b0')"
            stroke-width="1"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>

        <!-- Mean line -->
        <line
          v-if="meanY !== null && showMean"
          x1="0" x2="100"
          :y1="meanY" :y2="meanY"
          stroke="#ff9800"
          stroke-dasharray="2,2"
          stroke-width="0.8"
        />

        <!-- Points + outlier highlight -->
        <g>
          <circle
            v-for="(v, i) in seriesList[0].points"
            :key="'lp-'+i"
            :cx="mapXValue(i, seriesList[0].points.length)"
            :cy="mapYValue(v)"
            :r="(focusMode && hoverIdx === i) ? 3.2 : 1.6"
            :fill="outlierLookup.has(i) ? '#e64a19' : '#3f51b5'"
            :stroke="(focusMode && hoverIdx === i) ? '#1e88e5' : 'none'"
            stroke-width="1"
          >
            <title>{{ i }}: {{ fmt2(v) }}</title>
          </circle>
        </g>

        <!-- Outliers ring -->
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
          >
            <title>Outlier {{ o.idx }}: {{ fmt2(seriesList[0].points[o.idx]) }}</title>
          </circle>
        </g>

        <!-- Hover crosshair -->
        <g v-if="showHover && hoverXPercent !== null && hoverIdx !== null && hoverValue !== null">
          <line
            :x1="hoverXPercent" :x2="hoverXPercent"
            y1="10" y2="90"
            stroke="#bdbdbd"
            stroke-width="0.6"
            stroke-dasharray="2,2"
          />
          <circle
            :cx="mapXValue(hoverIdx, seriesList[0].points.length)"
            :cy="mapYValue(hoverValue)"
            :r="focusMode ? 4 : 3"
            fill="#1e88e5"
            fill-opacity="0.85"
          />
          <text
            :x="Math.min(95, mapXValue(hoverIdx, seriesList[0].points.length) + 2)"
            :y="Math.max(12, mapYValue(hoverValue) - 2)"
            font-size="5"
            fill="#424242"
          >{{ hoverIdx }}: {{ fmt2(hoverValue) }}</text>
        </g>
      </svg>
      <div v-else-if="activeTab === 'LINE'" class="text-medium-emphasis">
        Žádná data pro graf
      </div>

      <!-- SCATTER -->
      <svg
        v-else-if="activeTab === 'SCATTER' && scatterSeries.length"
        id="chartpanel-svg-current"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        :aria-label="ariaLabelFor('SCATTER')"
        role="img"
        style="width: 60%; height: 100%"
        @mousemove="onMouseMoveLine"
        @mouseleave="onMouseLeaveLine"
      >
        <desc>Scatter chart; mean {{ fmt2(stats?.mean) }}</desc>

        <g class="axes">
          <line x1="0" x2="100" y1="90" y2="90" stroke="#9e9e9e" stroke-width="0.6"/>
          <line x1="0" x2="0" y1="10" y2="90" stroke="#9e9e9e" stroke-width="0.6"/>

          <template v-if="showGrid">
            <line
              v-for="i in 4"
              :key="'sc-yg-'+i"
              x1="0" x2="100"
              :y1="10 + (i/4)*80"
              :y2="10 + (i/4)*80"
              stroke="#eeeeee"
              stroke-width="0.4"
            />
            <line
              v-for="(lbl, i) in xLabelsSafe"
              :key="'sc-xt-'+i"
              :x1="mapXValue(i, xLabelsSafe.length)"
              :x2="mapXValue(i, xLabelsSafe.length)"
              y1="90" y2="92"
              stroke="#9e9e9e"
              stroke-width="0.6"
            />
            <text
              v-for="(lbl, i) in xLabelsSafe"
              :key="'sc-xlab-'+i"
              :x="mapXValue(i, xLabelsSafe.length)"
              y="96"
              text-anchor="middle"
              fill="#666"
              font-size="5"
            >{{ lbl }}</text>
          </template>

          <text x="95" y="98" text-anchor="end" fill="#666" font-size="5">Index</text>
          <text x="2" y="8" text-anchor="start" fill="#666" font-size="5">Hodnota</text>
        </g>

        <g>
          <circle
            v-for="p in scatterSeries"
            :key="p.label + '-' + p.idx"
            :cx="p.cx"
            :cy="p.cy"
            :r="focusMode && hoverIdx === p.idx ? 4 : 2.2"
            :fill="p.color"
            fill-opacity="0.85"
            :stroke="outlierLookup.has(p.idx) ? '#e64a19' : (focusMode && hoverIdx === p.idx ? '#1e88e5' : 'none')"
            stroke-width="1"
          >
            <title>{{ p.label }} [{{ p.idx }}]: {{ fmt2(seriesList.find(s => s.label === p.label)?.points[p.idx]) }}</title>
          </circle>
        </g>

        <line
          v-if="meanY !== null && showMean"
          x1="0" x2="100"
          :y1="meanY" :y2="meanY"
          stroke="#ff9800"
          stroke-dasharray="2,2"
          stroke-width="0.8"
        />

        <g v-if="showHover && hoverXPercent !== null && hoverIdx !== null && hoverValue !== null">
          <line
            :x1="hoverXPercent" :x2="hoverXPercent"
            y1="10" y2="90"
            stroke="#bdbdbd"
            stroke-width="0.6"
            stroke-dasharray="2,2"
          />
          <circle
            :cx="mapXValue(hoverIdx, seriesList[0].points.length)"
            :cy="mapYValue(hoverValue)"
            :r="focusMode ? 4 : 3"
            fill="#1e88e5"
            fill-opacity="0.9"
          />
          <text
            :x="Math.min(95, mapXValue(hoverIdx, seriesList[0].points.length) + 2)"
            :y="Math.max(12, mapYValue(hoverValue) - 2)"
            font-size="5"
            fill="#424242"
          >{{ hoverIdx }}: {{ fmt2(hoverValue) }}</text>
        </g>
      </svg>
      <div v-else-if="activeTab === 'SCATTER'" class="text-medium-emphasis">
        Žádná data pro graf
      </div>

      <!-- HISTOGRAM -->
      <svg
        v-else-if="activeTab === 'HISTOGRAM' && histogram.bins.length"
        id="chartpanel-svg-current"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        :aria-label="ariaLabelFor('HISTOGRAM')"
        role="img"
        style="width: 60%; height: 100%"
        @mousemove="onMouseMoveHist"
        @mouseleave="onMouseLeaveHist"
      >
        <desc>Histogram; mean {{ fmt2(stats?.mean) }}</desc>

        <g class="axes">
          <line x1="0" x2="100" y1="90" y2="90" stroke="#9e9e9e" stroke-width="0.6"/>
          <line x1="0" x2="0" y1="10" y2="90" stroke="#9e9e9e" stroke-width="0.6"/>

          <template v-if="showGrid">
            <line
              v-for="i in 4"
              :key="'hist-yg-'+i"
              x1="0" x2="100"
              :y1="10 + (i/4)*80"
              :y2="10 + (i/4)*80"
              stroke="#eeeeee"
              stroke-width="0.4"
            />
          </template>

          <text x="95" y="98" text-anchor="end" fill="#666" font-size="5">Bin</text>
          <text x="2" y="8" text-anchor="start" fill="#666" font-size="5">Count</text>
        </g>

        <g>
          <rect
            v-for="(b, i) in histogram.bins"
            :key="'bin-'+i"
            :x="b.x" :y="b.y"
            :width="b.w" :height="b.h"
            fill="#90caf9"
            stroke="#42a5f5"
            stroke-width="0.5"
          >
            <title>Bin {{ i + 1 }}: {{ b.count }} items</title>
          </rect>

          <template v-if="showHover && hoveredBin !== null">
            <rect
              :x="histogram.bins[hoveredBin].x"
              :y="histogram.bins[hoveredBin].y"
              :width="histogram.bins[hoveredBin].w"
              :height="histogram.bins[hoveredBin].h"
              fill="#ffcc80"
              fill-opacity="0.22"
              stroke="#fb8c00"
              stroke-width="1"
              pointer-events="none"
            />
            <text
              :x="histogram.bins[hoveredBin].x + histogram.bins[hoveredBin].w/2"
              :y="Math.max(12, histogram.bins[hoveredBin].y - 2)"
              text-anchor="middle"
              font-size="5"
              fill="#424242"
              pointer-events="none"
            >{{ histogram.bins[hoveredBin].count }}</text>
          </template>

          <line
            v-if="showMean && meanXForHistogram !== null"
            :x1="meanXForHistogram"
            :x2="meanXForHistogram"
            y1="10" y2="90"
            stroke="#ff9800"
            stroke-dasharray="2,2"
            stroke-width="0.8"
          />
        </g>
      </svg>
      <div v-else-if="activeTab === 'HISTOGRAM'" class="text-medium-emphasis">
        Žádná data pro graf
      </div>

      <!-- BOXPLOT -->
      <svg
        v-else-if="activeTab === 'BOXPLOT' && box"
        id="chartpanel-svg-current"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        :aria-label="ariaLabelFor('BOXPLOT')"
        role="img"
        style="width: 60%; height: 100%; cursor: crosshair"
        @mousemove="onMouseMoveBox"
        @mouseleave="onMouseLeaveBox"
      >
        <desc>Boxplot; median {{ fmt2(stats?.median) }}</desc>

        <g class="axes">
          <line x1="0" x2="100" y1="90" y2="90" stroke="#9e9e9e" stroke-width="0.6"/>
          <line x1="0" x2="0" y1="10" y2="90" stroke="#9e9e9e" stroke-width="0.6"/>
          <template v-if="showGrid">
            <line
              v-for="i in 4"
              :key="'box-yg-'+i"
              x1="0" x2="100"
              :y1="10 + (i/4)*80"
              :y2="10 + (i/4)*80"
              stroke="#eeeeee"
              stroke-width="0.4"
            />
          </template>
          <text x="2" y="8" text-anchor="start" fill="#666" font-size="5">Hodnota</text>
        </g>

        <g>
          <line
            v-if="meanY !== null && showMean"
            x1="0" x2="100"
            :y1="meanY" :y2="meanY"
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

          <line x1="50" x2="50" :y1="box.yMin" :y2="box.yQ1" stroke="#455a64" stroke-width="1"/>
          <line x1="50" x2="50" :y1="box.yQ3" :y2="box.yMax" stroke="#455a64" stroke-width="1"/>
          <line x1="40" x2="60" :y1="box.yMin" :y2="box.yMin" stroke="#455a64" stroke-width="1"/>
          <line x1="40" x2="60" :y1="box.yMax" :y2="box.yMax" stroke="#455a64" stroke-width="1"/>

          <rect
            :x="35"
            :y="box.yQ3"
            width="30"
            :height="Math.max(0.5, box.yQ1 - box.yQ3)"
            fill="#c5e1a5"
            stroke="#7cb342"
            stroke-width="1"
          >
            <title>Q1–Q3 (median {{ fmt2(stats?.median) }})</title>
          </rect>
          <line
            x1="35" x2="65"
            :y1="box.yMed" :y2="box.yMed"
            stroke="#e53935"
            stroke-width="1.4"
          >
            <title>Median {{ fmt2(stats?.median) }}</title>
          </line>

          <template v-if="showHover && hoverYPercent !== null">
            <line
              x1="0" x2="100"
              :y1="hoverYPercent" :y2="hoverYPercent"
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
              pointer-events="none"
            >{{ hoverYValueLabel }}</text>
          </template>
        </g>
      </svg>
      <div v-else-if="activeTab === 'BOXPLOT'" class="text-medium-emphasis">
        Žádná data pro graf
      </div>
    </v-sheet>
  </div>
</template>

<style scoped>
.chart-panel { display: flex; flex-direction: column; }
.field-selector { display: flex; flex-wrap: wrap; margin-bottom: .75rem; }
.tab-buttons { display: flex; flex-wrap: wrap; }
.chart-options { display: flex; flex-wrap: wrap; gap: 6px; }
.chart-area { height: 280px; display: flex; align-items: center; justify-content: flex-start; }
</style>
