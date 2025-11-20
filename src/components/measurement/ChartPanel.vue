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

// Scatter plot: reuse same 0-100 coordinate space as sparkline
const scatterPoints = computed<{ x: number; y: number }[]>(() => {
  const vals = props.chartPoints || []
  if (!vals.length) return []
  const n = vals.length
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mx - mn
  return vals.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * 100
    const yNorm = range === 0 ? 50 : ((v - mn) / range) * 80 + 10
    const y = 100 - yNorm
    return { x, y }
  })
})

// Histogram: simple sqrt(n) bins, scaled to 0..100 space
function buildHistogram(vals: number[]) {
  if (!vals.length) return { bins: [] as { x: number; y: number; w: number; h: number }[], maxCount: 0 }
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
    const w = (1 / binCount) * 100 * 0.95 // small gap
    const h = maxCount === 0 ? 0 : (c / maxCount) * 90
    const y = 100 - h
    return { x, y, w, h }
  })
  return { bins, maxCount }
}
const histogram = computed(() => buildHistogram(props.chartPoints || []))

// Boxplot: compute quartiles with linear interpolation + 1.5*IQR whiskers
function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * p
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  } else {
    return sorted[base]
  }
}
function buildBoxplot(vals: number[]) {
  if (!vals.length) return null as null | { yMin:number; yQ1:number; yMed:number; yQ3:number; yMax:number }
  const sorted = [...vals].sort((a,b)=>a-b)
  const mn = sorted[0]
  const mx = sorted[sorted.length - 1]
  const q1 = quantile(sorted, 0.25)
  const med = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1
  const lowFence = q1 - 1.5 * iqr
  const highFence = q3 + 1.5 * iqr
  const whiskerMin = sorted.find(v => v >= lowFence) ?? mn
  const whiskerMax = [...sorted].reverse().find(v => v <= highFence) ?? mx

  const vMin = Math.min(...vals)
  const vMax = Math.max(...vals)
  const range = vMax - vMin
  const mapY = (v: number) => {
    const norm = range === 0 ? 0.5 : (v - vMin) / range
    const yNorm = norm * 80 + 10
    return 100 - yNorm
  }
  return {
    yMin: mapY(whiskerMin),
    yQ1: mapY(q1),
    yMed: mapY(med),
    yQ3: mapY(q3),
    yMax: mapY(whiskerMax)
  }
}
const box = computed(() => buildBoxplot(props.chartPoints || []))

// Common tick helpers
function mapYValue(v: number, minV: number, maxV: number): number {
  const range = maxV - minV
  const norm = range === 0 ? 0.5 : (v - minV) / range
  const yNorm = norm * 80 + 10
  return 100 - yNorm
}

function niceNumber(x: number): string {
  if (!Number.isFinite(x)) return ''
  const abs = Math.abs(x)
  if (abs >= 1000 || abs < 0.01) return x.toExponential(1)
  if (abs >= 100) return x.toFixed(0)
  if (abs >= 10) return x.toFixed(1)
  return x.toFixed(2)
}

function buildValueTicks(minV: number, maxV: number, steps = 4): number[] {
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return []
  if (maxV === minV) return [minV]
  const out: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = minV + (i / steps) * (maxV - minV)
    out.push(t)
  }
  return out
}

const valueScale = computed(() => {
  const vals = props.chartPoints || []
  if (!vals.length) return null as null | { yMin:number; yMax:number; yTicks:number[]; xTicks:number[] }
  const yMin = Math.min(...vals)
  const yMax = Math.max(...vals)
  const yTicks = buildValueTicks(yMin, yMax, 4)
  const n = vals.length
  const xTicks = n > 1
    ? [0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1]
    : [0]
  return { yMin, yMax, yTicks, xTicks }
})

const hasStats = computed<boolean>(() => !!props.stats)
const statsSafe = computed<{
  mean: number; median: number; stdDev: number; min: number; max: number; count: number
}>(() => props.stats ?? { mean: NaN, median: NaN, stdDev: NaN, min: NaN, max: NaN, count: 0 })

// Overlays & helpers
const meanY = computed<number | null>(() => {
  if (!valueScale.value || !hasStats.value || !Number.isFinite(statsSafe.value.mean)) return null
  return mapYValue(statsSafe.value.mean, valueScale.value.yMin, valueScale.value.yMax)
})

const minIdx = computed<number | null>(() => {
  const vals = props.chartPoints || []
  if (!vals.length) return null
  let idx = 0
  let best = vals[0]
  for (let i = 1; i < vals.length; i++) if (vals[i] < best) { best = vals[i]; idx = i }
  return idx
})
const maxIdx = computed<number | null>(() => {
  const vals = props.chartPoints || []
  if (!vals.length) return null
  let idx = 0
  let best = vals[0]
  for (let i = 1; i < vals.length; i++) if (vals[i] > best) { best = vals[i]; idx = i }
  return idx
})

const meanXForHistogram = computed<number | null>(() => {
  const vals = props.chartPoints || []
  if (!vals.length || !hasStats.value || !Number.isFinite(statsSafe.value.mean)) return null
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mx - mn
  if (range === 0) return 50
  const norm = (statsSafe.value.mean - mn) / range
  return Math.max(0, Math.min(100, norm * 100))
})

function ariaLabelFor(type: 'LINE'|'SCATTER'|'HISTOGRAM'|'BOXPLOT'): string {
  const c = props.chartPoints?.length ?? 0
  if (type === 'LINE') return `Line chart with ${c} points.`
  if (type === 'SCATTER') return `Scatter chart with ${c} points.`
  if (type === 'HISTOGRAM') return `Histogram of ${c} values.`
  return `Boxplot of ${c} values.`
}

// Hover state
const hoverXPercent = ref<number | null>(null)
const hoverYPercent = ref<number | null>(null)
const hoverIdx = ref<number | null>(null)
const hoverValue = ref<number | null>(null)
const hoveredBin = ref<number | null>(null)

const hoverY = computed<number | null>(() => {
  if (hoverValue.value == null || !valueScale.value) return null
  return mapYValue(hoverValue.value, valueScale.value.yMin, valueScale.value.yMax)
})

function getMouseXPercent(e: MouseEvent): number {
  const el = e.currentTarget as SVGSVGElement | null
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left
  const pct = (x / Math.max(1, rect.width)) * 100
  return Math.max(0, Math.min(100, pct))
}
function getMouseYPercent(e: MouseEvent): number {
  const el = e.currentTarget as SVGSVGElement | null
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const y = e.clientY - rect.top
  const pct = (y / Math.max(1, rect.height)) * 100
  return Math.max(0, Math.min(100, pct))
}

function onMouseMoveLine(e: MouseEvent) {
  const vals = props.chartPoints || []
  if (!vals.length) return
  const pct = getMouseXPercent(e)
  hoverXPercent.value = pct
  const n = vals.length
  const idx = n <= 1 ? 0 : Math.round(((n - 1) * pct) / 100)
  hoverIdx.value = Math.max(0, Math.min(n - 1, idx))
  hoverValue.value = vals[hoverIdx.value]
}
function onMouseLeaveLine() {
  hoverXPercent.value = null
  hoverIdx.value = null
  hoverValue.value = null
}

function onMouseMoveHist(e: MouseEvent) {
  const h = histogram.value
  if (!h || !h.bins.length) return
  const pct = getMouseXPercent(e)
  hoverXPercent.value = pct
  const binCount = h.bins.length
  let idx = Math.floor((pct / 100) * binCount)
  if (idx >= binCount) idx = binCount - 1
  if (idx < 0) idx = 0
  hoveredBin.value = idx
}
function onMouseLeaveHist() { hoveredBin.value = null; hoverXPercent.value = null }

// Boxplot hover (horizontal crosshair)
function onMouseMoveBox(e: MouseEvent) {
  const yp = getMouseYPercent(e)
  hoverYPercent.value = yp
}
function onMouseLeaveBox() { hoverYPercent.value = null }

// Toggle panel
const showGrid = ref<boolean>(true)
const showMean = ref<boolean>(true)
const showHover = ref<boolean>(true)

// Boxplot mean hover activation (uživatel chce tooltip při najetí na oranžovou čáru)
const hoverMeanActive = computed<boolean>(() => {
  return !!(showMean.value && showHover.value && meanY.value !== null && hoverYPercent.value !== null && Math.abs(hoverYPercent.value - (meanY.value as number)) < 2)
})

function yPercentToValue(yPct: number, minV: number, maxV: number): number {
  const yNorm = 100 - yPct
  const norm = (yNorm - 10) / 80
  const clamped = Math.max(0, Math.min(1, norm))
  return minV + clamped * (maxV - minV)
}
const hoverYValueLabel = computed<string | null>(() => {
  if (hoverYPercent.value == null || !valueScale.value) return null
  const val = yPercentToValue(hoverYPercent.value, valueScale.value.yMin, valueScale.value.yMax)
  return niceNumber(val)
})
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

    <div class="chart-options mb-2 d-flex align-center ga-2">
      <v-btn
        size="x-small"
        :color="showGrid ? 'primary' : ''"
        variant="tonal"
        title="Přepnout mřížku"
        @click="showGrid = !showGrid"
      >
        Mřížka
      </v-btn>
      <v-btn
        size="x-small"
        :color="showMean ? 'primary' : ''"
        variant="tonal"
        title="Přepnout mean linku"
        @click="showMean = !showMean"
      >
        Mean
      </v-btn>
      <v-btn
        size="x-small"
        :color="showHover ? 'primary' : ''"
        variant="tonal"
        title="Přepnout hover overlay"
        @click="showHover = !showHover"
      >
        Hover
      </v-btn>
    </div>

    <v-sheet
      class="pa-4 chart-area"
      elevation="1"
    >
      <svg
        v-if="activeTab === 'LINE' && chartPoints.length"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        :aria-label="ariaLabelFor('LINE')"
        role="img"
        style="width: 50%; height: 100%"
        @mousemove="onMouseMoveLine"
        @mouseleave="onMouseLeaveLine"
      >
        <desc>Mean {{ fmt2(statsSafe.mean) }}, min {{ fmt2(statsSafe.min) }}, max {{ fmt2(statsSafe.max) }}</desc>
        <!-- axes -->
        <g class="axes">
          <!-- X axis -->
          <line
            x1="0"
            x2="100"
            y1="90"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <!-- Y axis -->
          <line
            x1="0"
            x2="0"
            y1="10"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <!-- gridlines -->
          <g v-if="valueScale && showGrid">
            <line
              v-for="(ty, i) in valueScale.yTicks"
              :key="'yg-l-' + i"
              x1="0"
              x2="100"
              :y1="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
              :y2="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
              stroke="#eeeeee"
              stroke-width="0.4"
            />
            <line
              v-for="(tx, i) in valueScale.xTicks"
              :key="'xg-l-' + i"
              :x1="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
              :x2="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
              y1="10"
              y2="90"
              stroke="#f2f2f2"
              stroke-width="0.4"
            />
          </g>
          <!-- X ticks & labels -->
          <g v-if="valueScale && showGrid">
            <g
              v-for="(tx, i) in valueScale.xTicks"
              :key="'xt-' + i"
            >
              <line
                :x1="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
                :x2="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
                y1="90"
                y2="92"
                stroke="#9e9e9e"
                stroke-width="0.6"
              />
              <text
                :x="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
                y="96"
                text-anchor="middle"
                fill="#666"
                font-size="5"
              >{{ tx }}</text>
            </g>
          </g>
          <!-- Y ticks & labels -->
          <g v-if="valueScale">
            <g
              v-for="(ty, i) in valueScale.yTicks"
              :key="'yt-' + i"
            >
              <line
                x1="0"
                x2="-2"
                :y1="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
                :y2="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
                stroke="#9e9e9e"
                stroke-width="0.6"
              />
              <text
                x="-1"
                :y="mapYValue(ty, valueScale.yMin, valueScale.yMax) + 2"
                text-anchor="end"
                fill="#666"
                font-size="5"
              >{{ niceNumber(ty) }}</text>
            </g>
          </g>
          <!-- axis labels -->
          <text
            x="95"
            y="98"
            text-anchor="end"
            fill="#666"
            font-size="5"
          >Index</text>
          <text
            x="2"
            y="8"
            text-anchor="start"
            fill="#666"
            font-size="5"
          >Hodnota</text>
        </g>
        <polyline
          :points="sparkPoints"
          fill="none"
          stroke="#3f51b5"
          stroke-width="1"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <!-- mean line -->
        <line
          v-if="meanY !== null && showMean"
          x1="0"
          x2="100"
          :y1="meanY"
          :y2="meanY"
          stroke="#ff9800"
          stroke-dasharray="2,2"
          stroke-width="0.8"
        />
        <!-- point titles and min/max highlight -->
        <g v-if="valueScale">
          <circle
            v-for="(v, i) in chartPoints"
            :key="'lp-' + i"
            :cx="chartPoints.length<=1?0:(i/(chartPoints.length-1))*100"
            :cy="mapYValue(v, valueScale.yMin, valueScale.yMax)"
            r="1.5"
            fill="#3f51b5"
          >
            <title>Index {{ i }}: {{ fmt2(v) }}</title>
          </circle>
          <circle
            v-if="minIdx !== null"
            :cx="chartPoints.length<=1?0:(minIdx/(chartPoints.length-1))*100"
            :cy="mapYValue(chartPoints[minIdx], valueScale.yMin, valueScale.yMax)"
            r="2.8"
            fill="#e53935"
          >
            <title>Min {{ fmt2(chartPoints[minIdx]) }} (index {{ minIdx }})</title>
          </circle>
          <circle
            v-if="maxIdx !== null"
            :cx="chartPoints.length<=1?0:(maxIdx/(chartPoints.length-1))*100"
            :cy="mapYValue(chartPoints[maxIdx], valueScale.yMin, valueScale.yMax)"
            r="2.8"
            fill="#2e7d32"
          >
            <title>Max {{ fmt2(chartPoints[maxIdx]) }} (index {{ maxIdx }})</title>
          </circle>
          <!-- hover crosshair + marker -->
          <g v-if="showHover && hoverXPercent !== null && hoverIdx !== null && hoverY !== null">
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
              :cx="chartPoints.length<=1?0:(hoverIdx/(chartPoints.length-1))*100"
              :cy="hoverY"
              r="3"
              fill="#1e88e5"
              fill-opacity="0.9"
            />
            <text
              :x="Math.min(95, (chartPoints.length<=1?0:(hoverIdx/(chartPoints.length-1))*100) + 2)"
              :y="Math.max(12, hoverY - 2)"
              font-size="5"
              fill="#424242"
            >{{ hoverIdx }}: {{ fmt2(hoverValue ?? undefined) }}</text>
          </g>
        </g>
      </svg>
      <div
        v-else-if="activeTab === 'LINE'"
        class="text-medium-emphasis"
      >
        Žádná data pro graf
      </div>
      <!-- SCATTER -->
      <svg
        v-else-if="activeTab === 'SCATTER' && chartPoints.length"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        :aria-label="ariaLabelFor('SCATTER')"
        role="img"
        style="width: 50%;; height: 100%"
        @mousemove="onMouseMoveLine"
        @mouseleave="onMouseLeaveLine"
      >
        <desc>Mean {{ fmt2(statsSafe.mean) }}, min {{ fmt2(statsSafe.min) }}, max {{ fmt2(statsSafe.max) }}</desc>
        <!-- axes -->
        <g class="axes">
          <line
            x1="0"
            x2="100"
            y1="90"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <line
            x1="0"
            x2="0"
            y1="10"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <!-- gridlines -->
          <g v-if="valueScale && showGrid">
            <line
              v-for="(ty, i) in valueScale.yTicks"
              :key="'yg-s-' + i"
              x1="0"
              x2="100"
              :y1="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
              :y2="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
              stroke="#eeeeee"
              stroke-width="0.4"
            />
            <line
              v-for="(tx, i) in valueScale.xTicks"
              :key="'xg-s-' + i"
              :x1="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
              :x2="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
              y1="10"
              y2="90"
              stroke="#f2f2f2"
              stroke-width="0.4"
            />
          </g>
          <!-- X ticks & labels (shown only when grid enabled for parity with LINE) -->
          <g v-if="valueScale && showGrid">
            <g
              v-for="(tx, i) in valueScale.xTicks"
              :key="'xt-s-' + i"
            >
              <line
                :x1="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
                :x2="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
                y1="90"
                y2="92"
                stroke="#9e9e9e"
                stroke-width="0.6"
              />
              <text
                :x="(tx/(valueScale.xTicks[valueScale.xTicks.length-1]||1))*100"
                y="96"
                text-anchor="middle"
                fill="#666"
                font-size="5"
              >{{ tx }}</text>
            </g>
          </g>
          <!-- Y ticks & labels (always visible) -->
          <g v-if="valueScale">
            <g
              v-for="(ty, i) in valueScale.yTicks"
              :key="'yt-s-' + i"
            >
              <line
                x1="0"
                x2="-2"
                :y1="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
                :y2="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
                stroke="#9e9e9e"
                stroke-width="0.6"
              />
              <text
                x="-1"
                :y="mapYValue(ty, valueScale.yMin, valueScale.yMax) + 2"
                text-anchor="end"
                fill="#666"
                font-size="5"
              >{{ niceNumber(ty) }}</text>
            </g>
          </g>
          <text
            x="95"
            y="98"
            text-anchor="end"
            fill="#666"
            font-size="5"
          >Index</text>
          <text
            x="2"
            y="8"
            text-anchor="start"
            fill="#666"
            font-size="5"
          >Hodnota</text>
        </g>
        <g>
          <circle
            v-for="(p, i) in scatterPoints"
            :key="'pt-' + i"
            :cx="p.x"
            :cy="p.y"
            r="2.2"
            fill="#3f51b5"
            fill-opacity="0.8"
          />
          <!-- mean line -->
          <line
            v-if="meanY !== null && showMean"
            x1="0"
            x2="100"
            :y1="meanY"
            :y2="meanY"
            stroke="#ff9800"
            stroke-dasharray="2,2"
            stroke-width="0.8"
          />
          <!-- titles for points -->
          <g>
            <circle
              v-for="(v, i) in chartPoints"
              :key="'stt-' + i"
              :cx="chartPoints.length<=1?0:(i/(chartPoints.length-1))*100"
              :cy="valueScale ? mapYValue(v, valueScale.yMin, valueScale.yMax) : 50"
              r="0.1"
              fill="transparent"
            >
              <title>Index {{ i }}: {{ fmt2(v) }}</title>
            </circle>
          </g>
          <!-- hover crosshair + marker -->
          <g v-if="showHover && hoverXPercent !== null && hoverIdx !== null && hoverY !== null">
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
              :cx="chartPoints.length<=1?0:(hoverIdx/(chartPoints.length-1))*100"
              :cy="hoverY"
              r="3"
              fill="#1e88e5"
              fill-opacity="0.9"
            />
            <text
              :x="Math.min(95, (chartPoints.length<=1?0:(hoverIdx/(chartPoints.length-1))*100) + 2)"
              :y="Math.max(12, hoverY - 2)"
              font-size="5"
              fill="#424242"
            >{{ hoverIdx }}: {{ fmt2(hoverValue ?? undefined) }}</text>
          </g>
        </g>
      </svg>
      <div
        v-else-if="activeTab === 'SCATTER'"
        class="text-medium-emphasis"
      >
        Žádná data pro graf
      </div>

      <!-- HISTOGRAM -->
      <svg
        v-else-if="activeTab === 'HISTOGRAM' && chartPoints.length"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        :aria-label="ariaLabelFor('HISTOGRAM')"
        role="img"
        style="width: 50%;; height: 100%"
        @mousemove="onMouseMoveHist"
        @mouseleave="onMouseLeaveHist"
      >
        <desc>Histogram; mean {{ fmt2(statsSafe.mean) }}</desc>
        <!-- axes (y = counts) -->
        <g class="axes">
          <line
            x1="0"
            x2="100"
            y1="90"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <line
            x1="0"
            x2="0"
            y1="10"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <g>
            <g
              v-for="i in 4"
              :key="'yt-h-' + i"
            >
              <line
                x1="0"
                x2="-2"
                :y1="100 - (i/4)*80 - 10"
                :y2="100 - (i/4)*80 - 10"
                stroke="#9e9e9e"
                stroke-width="0.6"
              />
              <line
                v-if="showGrid"
                x1="0"
                x2="100"
                :y1="100 - (i/4)*80 - 10"
                :y2="100 - (i/4)*80 - 10"
                stroke="#eeeeee"
                stroke-width="0.4"
              />
              <text
                x="-1"
                :y="100 - (i/4)*80 - 8"
                text-anchor="end"
                fill="#666"
                font-size="5"
              >{{ Math.round((histogram.maxCount * i) / 4) }}</text>
            </g>
          </g>
          <text
            x="95"
            y="98"
            text-anchor="end"
            fill="#666"
            font-size="5"
          >Bin</text>
          <text
            x="2"
            y="8"
            text-anchor="start"
            fill="#666"
            font-size="5"
          >Count</text>
        </g>
        <g>
          <rect
            v-for="(b, i) in histogram.bins"
            :key="'bin-' + i"
            :x="b.x"
            :y="b.y"
            :width="b.w"
            :height="b.h"
            fill="#90caf9"
            stroke="#42a5f5"
            stroke-width="0.5"
          >
            <title>Bin {{ i + 1 }}: {{ Math.round((b.h/90) * histogram.maxCount) }} items</title>
          </rect>
          <!-- hovered bin outline + label -->
          <template v-if="showHover && hoveredBin !== null">
            <rect
              :x="histogram.bins[hoveredBin].x"
              :y="histogram.bins[hoveredBin].y"
              :width="histogram.bins[hoveredBin].w"
              :height="histogram.bins[hoveredBin].h"
              fill="#ffcc80"
              fill-opacity="0.18"
              stroke="#fb8c00"
              stroke-width="1.2"
              pointer-events="none"
            />
            <text
              :x="histogram.bins[hoveredBin].x + histogram.bins[hoveredBin].w/2"
              :y="Math.max(12, histogram.bins[hoveredBin].y - 2)"
              text-anchor="middle"
              font-size="5"
              fill="#424242"
              pointer-events="none"
            >{{ Math.round((histogram.bins[hoveredBin].h/90) * histogram.maxCount) }}</text>
          </template>
          <!-- hover crosshair -->
          <line
            v-if="showHover && hoverXPercent !== null"
            :x1="hoverXPercent"
            :x2="hoverXPercent"
            y1="10"
            y2="90"
            stroke="#bdbdbd"
            stroke-width="0.6"
            stroke-dasharray="2,2"
            pointer-events="none"
          />
          <!-- mean marker -->
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
      </svg>
      <div
        v-else-if="activeTab === 'HISTOGRAM'"
        class="text-medium-emphasis"
      >
        Žádná data pro graf
      </div>

      <!-- BOXPLOT -->
      <svg
        v-else-if="activeTab === 'BOXPLOT' && chartPoints.length && box"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        :aria-label="ariaLabelFor('BOXPLOT')"
        role="img"
        style="width: 50%;; height: 100%; cursor: crosshair"
        @mousemove="onMouseMoveBox"
        @mouseleave="onMouseLeaveBox"
      >
        <desc>Boxplot with median {{ fmt2(statsSafe.median) }}</desc>
        <!-- axes -->
        <g class="axes">
          <line
            x1="0"
            x2="100"
            y1="90"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <line
            x1="0"
            x2="0"
            y1="10"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <g v-if="valueScale && showGrid">
            <line
              v-for="(ty, i) in valueScale.yTicks"
              :key="'yg-b-' + i"
              x1="0"
              x2="100"
              :y1="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
              :y2="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
              stroke="#eeeeee"
              stroke-width="0.4"
            />
            <g
              v-for="(ty, i) in valueScale.yTicks"
              :key="'yt-b-' + i"
            >
              <line
                x1="0"
                x2="-2"
                :y1="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
                :y2="mapYValue(ty, valueScale.yMin, valueScale.yMax)"
                stroke="#9e9e9e"
                stroke-width="0.6"
              />
              <text
                x="-1"
                :y="mapYValue(ty, valueScale.yMin, valueScale.yMax) + 2"
                text-anchor="end"
                fill="#666"
                font-size="5"
              >{{ niceNumber(ty) }}</text>
            </g>
          </g>
          <text
            x="2"
            y="8"
            text-anchor="start"
            fill="#666"
            font-size="5"
          >Hodnota</text>
        </g>
        <g>
          <!-- mean line for boxplot -->
          <line
            v-if="meanY !== null && showMean"
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
          >Mean: {{ fmt2(statsSafe.mean) }}</text>
          <!-- whiskers -->
          <line
            :x1="50"
            :x2="50"
            :y1="box.yMin"
            :y2="box.yQ1"
            stroke="#455a64"
            stroke-width="1"
          />
          <line
            :x1="50"
            :x2="50"
            :y1="box.yQ3"
            :y2="box.yMax"
            stroke="#455a64"
            stroke-width="1"
          />
          <line
            :x1="40"
            :x2="60"
            :y1="box.yMin"
            :y2="box.yMin"
            stroke="#455a64"
            stroke-width="1"
          />
          <line
            :x1="40"
            :x2="60"
            :y1="box.yMax"
            :y2="box.yMax"
            stroke="#455a64"
            stroke-width="1"
          />
          <!-- box -->
          <rect
            :x="35"
            :y="box.yQ3"
            :width="30"
            :height="Math.max(0.5, box.yQ1 - box.yQ3)"
            fill="#c5e1a5"
            stroke="#7cb342"
            stroke-width="1"
          >
            <title>Q1–Q3 box; median {{ fmt2(statsSafe.median) }}</title>
          </rect>
          <!-- median -->
          <line
            :x1="35"
            :x2="65"
            :y1="box.yMed"
            :y2="box.yMed"
            stroke="#e53935"
            stroke-width="1.5"
          >
            <title>Median {{ fmt2(statsSafe.median) }}</title>
          </line>
          <!-- hover horizontal crosshair -->
          <template v-if="showHover && hoverYPercent !== null">
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
              pointer-events="none"
            >{{ hoverYValueLabel }}</text>
          </template>
        </g>
      </svg>
      <div
        v-else-if="activeTab === 'BOXPLOT'"
        class="text-medium-emphasis"
      >
        Žádná data pro graf
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
.chart-area {
  height: 260px;
  display: flex;
  align-items: center;
  justify-content: left;
}
</style>
