<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import * as XLSX from 'xlsx'
import {
  type MultiSeriesItem,
  type StatsObj,
  type OutliersMeta,
  fmt2,
  niceNumber,
} from './types'

/* -------------------------------------------------
   Component Props
   ------------------------------------------------- */
const props = withDefaults(
  defineProps<{
    series: MultiSeriesItem[]
    activeTab: 'LINE' | 'SCATTER' | 'HISTOGRAM' | 'BOXPLOT'
    stats: StatsObj | null
    outliers?: OutliersMeta | null
    xLabels?: Array<number | string>
    xAxisPoints?: number[]  // Custom X-axis values (if provided, use these instead of indices)
    showGrid?: boolean
    showMean?: boolean
    showHover?: boolean
    showTrend?: boolean
    trendType?: 'linear' | 'logarithmic'
    focusMode?: boolean
    sharedZoomLevel?: number | null  // For synced zoom across multiple charts
  }>(),
  {
    xLabels: undefined,
    xAxisPoints: undefined,
    outliers: null,
    showGrid: true,
    showMean: true,
    showHover: true,
    showTrend: false,
    trendType: 'linear',
    focusMode: false,
    sharedZoomLevel: null,
  }
)

const emit = defineEmits<{
  (e: 'point-click', payload: { event: MouseEvent; idx: number; val: number }): void
  (e: 'zoom-change', zoomLevel: number): void
}>()

/* -------------------------------------------------
   SVG reference & zoom state
   ------------------------------------------------- */
const svgRef = ref<SVGSVGElement | null>(null)
const zoomLevel = ref(1)
const minZoom = 0.5
const maxZoom = 3
let isUpdatingFromExternal = false

// Watch for external zoom level changes (synced from other charts)
watch(() => props.sharedZoomLevel, (newLevel) => {
  if (newLevel !== null && newLevel !== undefined && newLevel !== zoomLevel.value) {
    isUpdatingFromExternal = true
    zoomLevel.value = Math.min(maxZoom, Math.max(minZoom, newLevel))
    isUpdatingFromExternal = false
  }
})

function handleWheel(e: WheelEvent) {
  if (!e.ctrlKey) return
  e.preventDefault()

  const delta = e.deltaY > 0 ? -0.1 : 0.1
  const newZoom = Math.min(maxZoom, Math.max(minZoom, zoomLevel.value + delta))
  zoomLevel.value = newZoom

  // Emit zoom change for sync (only if not updating from external source)
  if (!isUpdatingFromExternal) {
    emit('zoom-change', newZoom)
  }
}

function resetZoom() {
  zoomLevel.value = 1
  emit('zoom-change', 1)
}

function exportCsv() {
  const lines: string[] = []
  const header = ['index', ...props.series.map((s) => s.label)]
  lines.push(header.join(','))
  const maxLen = Math.max(...props.series.map((s) => s.points.length), 0)
  for (let i = 0; i < maxLen; i++) {
    const row: string[] = [String(xLabelsSafe.value[i] ?? i)]
    for (const s of props.series) row.push(s.points[i] != null ? String(s.points[i]) : '')
    lines.push(row.join(','))
  }
  downloadBlob(lines.join('\n'), 'chart-data.csv', 'text/csv;charset=utf-8;')
}

function exportXlsx() {
  const header = ['index', ...props.series.map((s) => s.label)]
  const maxLen = Math.max(...props.series.map((s) => s.points.length), 0)
  const data: (string | number)[][] = [header]
  for (let i = 0; i < maxLen; i++) {
    const row: (string | number)[] = [xLabelsSafe.value[i] ?? i]
    for (const s of props.series) {
      row.push(s.points[i] != null ? s.points[i] : '')
    }
    data.push(row)
  }
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Chart Data')
  XLSX.writeFile(wb, 'chart-data.xlsx')
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
  const w = 1400
  const h = 600
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob((b) => {
        if (b) {
          const pngUrl = URL.createObjectURL(b)
          const a = document.createElement('a')
          a.style.display = 'none'
          a.href = pngUrl
          a.download = 'chart.png'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(pngUrl)
        }
      }, 'image/png')
    }
    URL.revokeObjectURL(url)
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
defineExpose({ exportCsv, exportXlsx, exportSvg, exportPng })
/* -------------------------------------------------
   Math helpers
   ------------------------------------------------- */
const allValuesFlat = computed<number[]>(() => {
  const out: number[] = []
  for (const s of props.series) out.push(...s.points)
  return out
})
const yMin = computed(() => {
  if (props.activeTab === 'BOXPLOT' && boxStats.value) {
    const range = boxStats.value.whiskerMax - boxStats.value.whiskerMin
    const margin = range === 0 ? 1 : range * 0.1
    return boxStats.value.whiskerMin - margin
  }
  return allValuesFlat.value.length ? Math.min(...allValuesFlat.value) : 0
})
const yMax = computed(() => {
  if (props.activeTab === 'BOXPLOT' && boxStats.value) {
    const range = boxStats.value.whiskerMax - boxStats.value.whiskerMin
    const margin = range === 0 ? 1 : range * 0.1
    return boxStats.value.whiskerMax + margin
  }
  return allValuesFlat.value.length ? Math.max(...allValuesFlat.value) : 1
})
const yRange = computed(() => yMax.value - yMin.value)

// X-axis min/max/range for custom X-axis data
const hasCustomXAxis = computed(() => 
  props.xAxisPoints && props.xAxisPoints.length === pointCount.value
)
const xMin = computed(() => {
  if (!hasCustomXAxis.value) return 0
  return Math.min(...props.xAxisPoints!)
})
const xMax = computed(() => {
  if (!hasCustomXAxis.value) return pointCount.value - 1
  return Math.max(...props.xAxisPoints!)
})
const xRange = computed(() => xMax.value - xMin.value)
/* -------------------------------------------------
   Box‑plot helper (avoids circular deps)
   ------------------------------------------------- */
const boxStats = computed(() => {
  if (props.activeTab !== 'BOXPLOT') return null
  const vals = props.series[0]?.points || []
  if (!vals.length) return null
  const indexed = vals.map((v, i) => ({ v, i }))
  const sorted = [...indexed].sort((a, b) => a.v - b.v)
  const quantile = (p: number) => {
    const pos = (sorted.length - 1) * p
    const base = Math.floor(pos)
    const rest = pos - base
    const vBase = sorted[base].v
    return sorted[base + 1] ? vBase + rest * (sorted[base + 1].v - vBase) : vBase
  }
  const q1 = quantile(0.25)
  const med = quantile(0.5)
  const q3 = quantile(0.75)
  const iqr = q3 - q1
  const lowFence = q1 - 1.5 * iqr
  const highFence = q3 + 1.5 * iqr
  const whiskerMinObj = sorted.find((x) => x.v >= lowFence) ?? sorted[0]
  const whiskerMaxObj = [...sorted].reverse().find((x) => x.v <= highFence) ?? sorted[sorted.length - 1]
  const outliers = sorted.filter((x) => x.v < lowFence || x.v > highFence)
  return {
    q1,
    med,
    q3,
    lowFence,
    highFence,
    whiskerMin: whiskerMinObj.v,
    whiskerMax: whiskerMaxObj.v,
    outliers,
  }
})
/* -------------------------------------------------
   Point / label helpers
   ------------------------------------------------- */
const pointCount = computed<number>(() =>
  Math.max(...props.series.map((s) => s.points.length), 0)
)
const xLabelsSafe = computed<Array<number | string>>(() => {
  const xl = props.xLabels
  return xl && xl.length === pointCount.value ? xl : Array.from({ length: pointCount.value }, (_, i) => i)
})
/* -------------------------------------------------
   Layout & scaling (dynamic width for scrolling + zoom)
   ------------------------------------------------- */
const layout = computed(() => {
  const count = pointCount.value
  // Base width minimum 528 (user preference), growing for larger datasets to maintain density
  const baseWidth = Math.max(528, 10 + count * 4 + 10)
  // Apply zoom to width (makes chart wider/narrower)
  const width = baseWidth * zoomLevel.value
  return {
    width,
    height: 120,
    minX: 20 * zoomLevel.value,
    maxX: width - 15 * zoomLevel.value,
    viewBox: `-5 0 ${width} 120`,
    zoom: zoomLevel.value,
  }
})
function mapYValue(v: number): number {
  const range = yRange.value
  const norm = range === 0 ? 0.5 : (v - yMin.value) / range
  return 100 - (norm * 80 + 10)
}
function mapXValue(idx: number, total: number): number {
  const { minX, maxX } = layout.value
  
  // If we have custom X-axis values, map by actual value rather than index
  if (hasCustomXAxis.value && props.xAxisPoints) {
    const xVal = props.xAxisPoints[idx]
    if (xVal !== undefined) {
      const range = xRange.value
      if (range === 0) return (minX + maxX) / 2
      const norm = (xVal - xMin.value) / range
      return minX + norm * (maxX - minX)
    }
  }
  
  // Default: map by index
  return total <= 1 ? (minX + maxX) / 2 : minX + (idx / (total - 1)) * (maxX - minX)
}

function buildPolyline(points: number[]): string {
  if (!points.length) return ''
  return points.map((v, i) => `${mapXValue(i, points.length)},${mapYValue(v)}`).join(' ')
}
/* -------------------------------------------------
   Series & histogram calculations (use layout)
   ------------------------------------------------- */
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
        seriesIndex: si,
      })
    })
  })
  return out
})
const histogram = computed(() => {
  const vals = props.series[0]?.points || []
  if (!vals.length) return { bins: [], maxCount: 0, minVal: 0, maxVal: 0, binEdges: [], binCount: 0 }

  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mx - mn
  const n = vals.length

  // Sturges' rule for better bin count
  const binCount = range === 0 ? 1 : Math.max(5, Math.min(20, Math.ceil(1 + 3.322 * Math.log10(n))))
  const binWidth = range === 0 ? 1 : range / binCount

  // Create bin edges for proper labeling
  const binEdges: number[] = []
  for (let i = 0; i <= binCount; i++) {
    binEdges.push(mn + i * binWidth)
  }

  const counts = Array.from({ length: binCount }, () => 0)

  for (const v of vals) {
    if (range === 0) {
      counts[0] += 1
    } else {
      let idx = Math.floor((v - mn) / binWidth)
      // Handle edge case where value equals max
      if (idx >= binCount) idx = binCount - 1
      if (idx < 0) idx = 0
      counts[idx] += 1
    }
  }

  const maxCount = Math.max(...counts, 1)
  const { minX, maxX } = layout.value
  const totalW = maxX - minX

  const bins = counts.map((c, i) => {
    const binStart = binEdges[i]
    const binEnd = binEdges[i + 1]
    const x = minX + (i / binCount) * totalW
    const w = (totalW / binCount) * 0.92 // Slightly narrower for visual separation
    const h = maxCount === 0 ? 0 : (c / maxCount) * 75 // Use 75% of available height
    const y = 90 - h
    return {
      x,
      y,
      w,
      h,
      count: c,
      binStart,
      binEnd,
      label: `${fmt2(binStart)} - ${fmt2(binEnd)}`
    }
  })

  return { bins, maxCount, minVal: mn, maxVal: mx, binEdges, binCount }
})

const meanXForHistogram = computed<number | null>(() => {
  const vals = props.series[0]?.points || []
  const st = props.stats
  if (!st || !vals.length || !Number.isFinite(st.mean)) return null
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  const range = mx - mn
  const { minX, maxX } = layout.value
  if (range === 0) return (minX + maxX) / 2
  const norm = (st.mean - mn) / range
  return minX + Math.max(0, Math.min(1, norm)) * (maxX - minX)
})
const box = computed(() => {
  const st = boxStats.value
  if (!st) return null
  const { minX, maxX } = layout.value
  const center = (minX + maxX) / 2
  return {
    center,
    yMin: mapYValue(st.whiskerMin),
    yQ1: mapYValue(st.q1),
    yMed: mapYValue(st.med),
    yQ3: mapYValue(st.q3),
    yMax: mapYValue(st.whiskerMax),
    outlierPoints: st.outliers.map((o) => {
      const rawY = mapYValue(o.v)
      const clampedY = Math.max(5, Math.min(95, rawY))
      const isClipped = Math.abs(rawY - clampedY) > 0.1
      return { y: clampedY, val: o.v, idx: o.i, isClipped }
    }),
  }
})
/* -------------------------------------------------
   Outlier handling
   ------------------------------------------------- */
const outlierLookup = computed<Set<number>>(() =>
  props.outliers ? new Set(props.outliers.outlierIndexes) : new Set()
)

const outlierPoints = computed(() => {
  if (!props.outliers || !props.outliers.outlierIndexes.length) return []
  const vals = props.series[0]?.points || []
  const out: { cx: number; cy: number; idx: number; val: number }[] = []
  for (const idx of props.outliers.outlierIndexes) {
    const val = vals[idx]
    if (val != null) {
      const cx = mapXValue(idx, vals.length)
      const cy = mapYValue(val)
      out.push({ cx, cy, idx, val })
    }
  }
  return out
})

/* -------------------------------------------------
   Regression calculations
   ------------------------------------------------- */
const regression = computed(() => {
  if (!props.showTrend || (props.activeTab !== 'LINE' && props.activeTab !== 'SCATTER')) {
    return null
  }

  const vals = props.series[0]?.points || []
  if (vals.length < 2) return null

  const n = vals.length

  if (props.trendType === 'linear') {
    // Linear regression: y = a*x + b
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0

    for (let i = 0; i < n; i++) {
      sumX += i
      sumY += vals[i]
      sumXY += i * vals[i]
      sumX2 += i * i
    }

    const a = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const b = (sumY - a * sumX) / n

    // Calculate R² (coefficient of determination)
    const meanY = sumY / n
    let ssTotal = 0, ssResidual = 0

    for (let i = 0; i < n; i++) {
      const predicted = a * i + b
      ssTotal += (vals[i] - meanY) ** 2
      ssResidual += (vals[i] - predicted) ** 2
    }

    const r2 = ssTotal === 0 ? 1 : 1 - (ssResidual / ssTotal)

    // Generate line points
    const x1 = 0
    const y1 = a * x1 + b
    const x2 = n - 1
    const y2 = a * x2 + b

    return {
      type: 'linear' as const,
      a,
      b,
      r2,
      equation: `y = ${fmt2(a)}x + ${fmt2(b)}`,
      x1: mapXValue(x1, n),
      y1: mapYValue(y1),
      x2: mapXValue(x2, n),
      y2: mapYValue(y2),
    }
  } else {
    // Logarithmic regression: y = a*ln(x+1) + b
    let sumLnX = 0, sumY = 0, sumLnXY = 0, sumLnX2 = 0

    for (let i = 0; i < n; i++) {
      const lnX = Math.log(i + 1)
      sumLnX += lnX
      sumY += vals[i]
      sumLnXY += lnX * vals[i]
      sumLnX2 += lnX * lnX
    }

    const a = (n * sumLnXY - sumLnX * sumY) / (n * sumLnX2 - sumLnX * sumLnX)
    const b = (sumY - a * sumLnX) / n

    // Calculate R²
    const meanY = sumY / n
    let ssTotal = 0, ssResidual = 0

    for (let i = 0; i < n; i++) {
      const predicted = a * Math.log(i + 1) + b
      ssTotal += (vals[i] - meanY) ** 2
      ssResidual += (vals[i] - predicted) ** 2
    }

    const r2 = ssTotal === 0 ? 1 : 1 - (ssResidual / ssTotal)

    // Generate curve points
    const points: Array<{ x: number; y: number }> = []
    const steps = Math.min(50, n * 2)

    for (let i = 0; i <= steps; i++) {
      const x = (n - 1) * (i / steps)
      const y = a * Math.log(x + 1) + b
      points.push({
        x: mapXValue(x, n),
        y: mapYValue(y),
      })
    }

    return {
      type: 'logarithmic' as const,
      a,
      b,
      r2,
      equation: `y = ${fmt2(a)}ln(x+1) + ${fmt2(b)}`,
      points,
    }
  }
})

/* -------------------------------------------------
   Hover interaction
   ------------------------------------------------- */
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
/* Line chart hover */
function onMouseMoveLine(e: MouseEvent) {
  if (!props.series[0]?.points.length) return
  const el = e.currentTarget as SVGSVGElement
  const rect = el.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const { width, height, minX, maxX } = layout.value

  // X calculation
  const scaleX = width / rect.width
  const svgX = mouseX * scaleX - 5 // compensate viewBox offset
  const n = props.series[0].points.length
  const totalW = maxX - minX
  let idx = Math.round(((svgX - minX) / totalW) * (n - 1))
  idx = Math.max(0, Math.min(n - 1, idx))

  hoverIdx.value = idx
  hoverValue.value = props.series[0].points[idx]
  hoverXPercent.value = mapXValue(idx, n)

  // Y calculation for Mean hover
  const scaleY = height / rect.height
  const svgY = (e.clientY - rect.top) * scaleY
  hoverYPercent.value = svgY
}
/* Histogram hover */
function onMouseMoveHist(e: MouseEvent) {
  const h = histogram.value
  if (!h.bins.length) return
  const el = e.currentTarget as SVGSVGElement
  const rect = el.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const { width, minX, maxX } = layout.value
  const scale = width / rect.width
  const svgX = mouseX * scale - 5
  const totalW = maxX - minX
  const binCount = h.bins.length
  let idx = Math.floor((svgX - minX) / (totalW / binCount))
  if (idx >= binCount) idx = binCount - 1
  if (idx < 0) idx = 0
  hoveredBin.value = idx
}
/* Box‑plot hover */
function onMouseMoveBox(e: MouseEvent) {
  // Use SVG coordinates for consistency
  const el = e.currentTarget as SVGSVGElement
  const rect = el.getBoundingClientRect()
  // Scale 0..100% of height to 0..layout.height
  const { height } = layout.value
  const scaleY = height / rect.height
  const svgY = (e.clientY - rect.top) * scaleY
  hoverYPercent.value = svgY
}
/* Leave handlers */
function onMouseLeaveLine() {
  hoverXPercent.value = null
  hoverIdx.value = null
  hoverValue.value = null
  hoverYPercent.value = null
}
function onMouseLeaveHist() {
  hoveredBin.value = null
  hoverXPercent.value = null
}
function onMouseLeaveBox() {
  hoverYPercent.value = null
}
/* -------------------------------------------------
   Computed hover values
   ------------------------------------------------- */
const meanY = computed<number | null>(() =>
  props.stats && Number.isFinite(props.stats.mean) ? mapYValue(props.stats.mean) : null
)
const hoverMeanActive = computed<boolean>(() =>
  props.showMean &&
  props.showHover &&
  meanY.value !== null &&
  hoverYPercent.value !== null &&
  Math.abs(hoverYPercent.value - meanY.value) < 4 // increased from 2
)
const hoverMedianActive = computed<boolean>(() =>
  props.activeTab === 'BOXPLOT' &&
  props.showHover &&
  box.value?.yMed !== undefined &&
  hoverYPercent.value !== null &&
  Math.abs(hoverYPercent.value - box.value.yMed) < 4
)
const hoverYValueLabel = computed<string | null>(() => {
  if (hoverYPercent.value == null) return null
  // svgY is 10..90 range typically (mapped y).
  // mapYValue does: 100 - (norm * 80 + 10). So 90 is min, 10 is max.
  // Inverse: val = 100 - svgY.
  // norm * 80 + 10 = val
  // norm * 80 = val - 10
  // norm = (val - 10) / 80

  const rawY = hoverYPercent.value
  const norm = (100 - rawY - 10) / 80 // inverse mapYValue logic

  const clamped = Math.max(0, Math.min(1, norm))
  const val = yMin.value + clamped * yRange.value
  return niceNumber(val)
})
/* -------------------------------------------------
   Accessibility
   ------------------------------------------------- */
const ariaLabel = computed(() => {
  const c = props.series[0]?.points.length ?? 0
  switch (props.activeTab) {
    case 'LINE':
      return `Čárový graf s ${c} body`
    case 'SCATTER':
      return `Bodový graf s ${c} body`
    case 'HISTOGRAM':
      return `Histogram s ${c} hodnotami`
    case 'BOXPLOT':
      return `Boxplot s ${c} hodnotami`
    default:
      return 'Graf'
  }
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

    <div
      v-if="zoomLevel !== 1"
      class="d-flex justify-end mb-1"
    >
      <v-btn
        size="small"
        variant="text"
        color="primary"
        prepend-icon="mdi-magnify-minus-outline"
        @click="resetZoom"
      >
        Resetovat přiblížení
      </v-btn>
    </div>

    <div class="chart-wrapper">
      <svg
        ref="svgRef"
        class="chart-svg"
        :viewBox="layout.viewBox"
        :aria-label="ariaLabel"
        role="img"
        @wheel="handleWheel"
        @mousemove="
          activeTab === 'HISTOGRAM'
            ? onMouseMoveHist($event)
            : activeTab === 'BOXPLOT'
              ? onMouseMoveBox($event)
              : onMouseMoveLine($event)
        "
        @mouseleave="
          activeTab === 'HISTOGRAM'
            ? onMouseLeaveHist()
            : activeTab === 'BOXPLOT'
              ? onMouseLeaveBox()
              : onMouseLeaveLine()
        "
      >
        <desc v-if="stats">
          Průměr {{ fmt2(stats.mean) }}, min {{ fmt2(stats.min) }}, max {{ fmt2(stats.max) }}
        </desc>
        <!-- Axes -->
        <g class="axes">
          <!-- X‑axis -->
          <!-- X‑axis -->
          <line
            :x1="layout.minX"
            :x2="layout.maxX"
            y1="90"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <!-- Y‑axis -->
          <line
            :x1="layout.minX"
            :x2="layout.minX"
            y1="10"
            y2="90"
            stroke="#9e9e9e"
            stroke-width="0.6"
          />
          <!-- Grid & ticks -->
          <template v-if="showGrid">
            <!-- Y‑grid -->
            <line
              v-for="i in 4"
              :key="'grid-y-' + i"
              x1="0"
              :x2="layout.width"
              :y1="10 + (i / 4) * 80"
              :y2="10 + (i / 4) * 80"
              stroke="#eeeeee"
              stroke-width="0.4"
            />

            <!-- Y-axis value labels for LINE/SCATTER -->
            <template v-if="activeTab === 'LINE' || activeTab === 'SCATTER'">
              <text
                v-for="i in 5"
                :key="'y-label-' + i"
                :x="layout.minX - 2"
                :y="90 - ((i - 1) / 4) * 80"
                text-anchor="end"
                font-size="3.5"
                fill="#666"
              >{{ fmt2(yMin + ((i - 1) / 4) * yRange) }}</text>
            </template>

            <!-- X‑ticks & labels (except histogram) -->
            <template v-if="activeTab !== 'HISTOGRAM' && activeTab !== 'BOXPLOT'">
              <line
                v-for="(lbl, i) in xLabelsSafe"
                :key="'grid-x-' + i"
                :x1="mapXValue(i, xLabelsSafe.length)"
                :x2="mapXValue(i, xLabelsSafe.length)"
                y1="90"
                y2="92"
                stroke="#9e9e9e"
                stroke-width="0.6"
              />
              <text
                v-for="(lbl, i) in xLabelsSafe"
                :key="'lbl-' + i"
                :x="mapXValue(i, xLabelsSafe.length)"
                y="97"
                text-anchor="middle"
                fill="#666"
                font-size="4.5"
                font-weight="500"
              >{{ lbl }}</text>
            </template>
            <!-- Histogram specific axis labels -->
            <template v-else-if="activeTab === 'HISTOGRAM'">
              <!-- Y-axis labels (frequency) -->
              <text
                x="2"
                y="92"
                text-anchor="end"
                font-size="4"
                fill="#666"
                font-weight="600"
              >0</text>
              <text
                x="2"
                y="12"
                text-anchor="end"
                font-size="4"
                fill="#666"
                font-weight="600"
              >
                {{ histogram.maxCount }}
              </text>
              <!-- Y-axis title -->
              <text
                x="-2"
                y="50"
                text-anchor="middle"
                font-size="4"
                fill="#666"
                font-weight="600"
                transform="rotate(-90, -2, 50)"
              >
                Počet hodnot
              </text>

              <!-- X-axis bin labels (show only a few key bins) -->
              <template v-if="histogram.binCount <= 10">
                <text
                  v-for="(edge, i) in histogram.binEdges"
                  :key="'edge-' + i"
                  :x="layout.minX + (i / histogram.binCount) * (layout.maxX - layout.minX)"
                  y="97"
                  text-anchor="middle"
                  font-size="3.5"
                  fill="#9e9e9e"
                >{{ fmt2(edge) }}</text>
              </template>
              <template v-else>
                <!-- Show only first, middle, and last for many bins -->
                <text
                  :x="layout.minX"
                  y="97"
                  text-anchor="start"
                  font-size="3.5"
                  fill="#9e9e9e"
                >
                  {{ fmt2(histogram.minVal) }}
                </text>
                <text
                  :x="(layout.minX + layout.maxX) / 2"
                  y="97"
                  text-anchor="middle"
                  font-size="3.5"
                  fill="#9e9e9e"
                >
                  {{ fmt2((histogram.minVal + histogram.maxVal) / 2) }}
                </text>
                <text
                  :x="layout.maxX"
                  y="97"
                  text-anchor="end"
                  font-size="3.5"
                  fill="#9e9e9e"
                >
                  {{ fmt2(histogram.maxVal) }}
                </text>
              </template>

              <!-- X-axis title -->
              <text
                :x="(layout.minX + layout.maxX) / 2"
                y="102"
                text-anchor="middle"
                font-size="4"
                fill="#666"
                font-weight="600"
              >
                Rozsah hodnot
              </text>
            </template>
          </template>

          <!-- Axis titles for LINE/SCATTER -->
          <template v-if="activeTab === 'LINE' || activeTab === 'SCATTER'">
            <!-- Y-axis title -->
            <text
              x="-2"
              y="50"
              text-anchor="middle"
              font-size="4"
              fill="#666"
              font-weight="600"
              transform="rotate(-90, -2, 50)"
            >
              Hodnota
            </text>
            <!-- X-axis title -->
            <text
              :x="(layout.minX + layout.maxX) / 2"
              y="102"
              text-anchor="middle"
              font-size="4"
              fill="#666"
              font-weight="600"
            >
              {{ xLabels && xLabels.length ? 'Index měření' : 'Pořadí' }}
            </text>
          </template>

          <!-- Axis titles for BOXPLOT -->
          <template v-if="activeTab === 'BOXPLOT'">
            <text
              x="-2"
              y="50"
              text-anchor="middle"
              font-size="4"
              fill="#666"
              font-weight="600"
              transform="rotate(-90, -2, 50)"
            >
              Hodnota
            </text>
            <text
              :x="(layout.minX + layout.maxX) / 2"
              y="102"
              text-anchor="middle"
              font-size="4"
              fill="#666"
              font-weight="600"
            >
              Distribuce
            </text>
            <!-- Y-axis value labels -->
            <text
              x="2"
              y="92"
              text-anchor="end"
              font-size="3.5"
              fill="#666"
            >{{ fmt2(yMin) }}</text>
            <text
              x="2"
              y="50"
              text-anchor="end"
              font-size="3.5"
              fill="#666"
            >{{ fmt2((yMin + yMax) / 2) }}</text>
            <text
              x="2"
              y="12"
              text-anchor="end"
              font-size="3.5"
              fill="#666"
            >{{ fmt2(yMax) }}</text>
          </template>
        </g>
        <!-- LINE chart -->
        <g v-if="activeTab === 'LINE'">
          <polyline
            v-for="(s, si) in series"
            :key="'pl-' + si"
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
              :key="'pts-' + si"
            >
              <circle
                v-for="(v, i) in s.points"
                :key="'pt-' + si + '-' + i"
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
              :key="'out-' + o.idx"
              :cx="o.cx"
              :cy="o.cy"
              r="3"
              fill="none"
              stroke="#e64a19"
              stroke-width="0.8"
            />
          </g>
          <!-- Hover marker -->
          <g
            v-if="
              showHover && hoverXPercent !== null && hoverIdx !== null && hoverValue !== null && !hoverMeanActive
            "
          >
            <line
              :x1="hoverXPercent"
              :x2="hoverXPercent"
              y1="10"
              y2="90"
              stroke="#1976d2"
              stroke-width="1"
              stroke-dasharray="3,2"
              opacity="0.6"
            />
            <circle
              :cx="mapXValue(hoverIdx, series[0].points.length)"
              :cy="mapYValue(hoverValue)"
              :r="focusMode ? 4 : 3.5"
              fill="#1e88e5"
              stroke="white"
              stroke-width="1.5"
            />
            <!-- Tooltip -->
            <rect
              :x="Math.min(layout.width - 45, mapXValue(hoverIdx, series[0].points.length) - 20)"
              :y="Math.max(5, mapYValue(hoverValue) - 18)"
              width="40"
              height="16"
              fill="white"
              stroke="#1976d2"
              stroke-width="0.8"
              rx="3"
              opacity="0.98"
              filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
            />
            <text
              :x="Math.min(layout.width - 25, mapXValue(hoverIdx, series[0].points.length))"
              :y="Math.max(12, mapYValue(hoverValue) - 12)"
              text-anchor="middle"
              font-size="3.5"
              font-weight="600"
              fill="#666"
            >#{{ hoverIdx + 1 }}</text>
            <text
              :x="Math.min(layout.width - 25, mapXValue(hoverIdx, series[0].points.length))"
              :y="Math.max(18, mapYValue(hoverValue) - 5)"
              text-anchor="middle"
              font-size="5"
              font-weight="700"
              fill="#1976d2"
            >{{ fmt2(hoverValue) }}</text>
          </g>
        </g>
        <!-- SCATTER chart -->
        <g v-else-if="activeTab === 'SCATTER'">
          <circle
            v-for="p in scatterSeries"
            :key="'sc-' + p.seriesIndex + '-' + p.idx"
            :cx="p.cx"
            :cy="p.cy"
            :r="focusMode && hoverIdx === p.idx ? 4 : 2.2"
            :fill="p.color"
            fill-opacity="0.85"
            :stroke="
              outlierLookup.has(p.idx) && p.seriesIndex === 0
                ? '#e64a19'
                : focusMode && hoverIdx === p.idx
                  ? '#1e88e5'
                  : 'none'
            "
            stroke-width="1"
          />

          <!-- Hover tooltip for scatter -->
          <g
            v-if="
              showHover && hoverXPercent !== null && hoverIdx !== null && hoverValue !== null && !hoverMeanActive
            "
          >
            <rect
              :x="Math.min(layout.width - 45, mapXValue(hoverIdx, series[0].points.length) - 20)"
              :y="Math.max(5, mapYValue(hoverValue) - 18)"
              width="40"
              height="16"
              fill="white"
              stroke="#1976d2"
              stroke-width="0.8"
              rx="3"
              opacity="0.98"
              filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
            />
            <text
              :x="Math.min(layout.width - 25, mapXValue(hoverIdx, series[0].points.length))"
              :y="Math.max(12, mapYValue(hoverValue) - 12)"
              text-anchor="middle"
              font-size="3.5"
              font-weight="600"
              fill="#666"
            >#{{ hoverIdx + 1 }}</text>
            <text
              :x="Math.min(layout.width - 25, mapXValue(hoverIdx, series[0].points.length))"
              :y="Math.max(18, mapYValue(hoverValue) - 5)"
              text-anchor="middle"
              font-size="5"
              font-weight="700"
              fill="#1976d2"
            >{{ fmt2(hoverValue) }}</text>
          </g>
        </g>

        <!-- Regression overlay (for LINE and SCATTER) -->
        <g v-if="regression">
          <!-- Linear regression line -->
          <line
            v-if="regression.type === 'linear'"
            :x1="regression.x1"
            :y1="regression.y1"
            :x2="regression.x2"
            :y2="regression.y2"
            stroke="#ff6f00"
            stroke-width="1.5"
            stroke-dasharray="5,3"
            opacity="0.9"
          />

          <!-- Logarithmic regression curve -->
          <polyline
            v-else-if="regression.type === 'logarithmic'"
            :points="regression.points.map(p => `${p.x},${p.y}`).join(' ')"
            fill="none"
            stroke="#ff6f00"
            stroke-width="1.5"
            stroke-dasharray="5,3"
            opacity="0.9"
          />

          <!-- Regression info box -->
          <g>
            <rect
              :x="layout.maxX - 60"
              y="12"
              width="58"
              height="18"
              fill="white"
              stroke="#ff6f00"
              stroke-width="0.8"
              rx="2"
              opacity="0.95"
            />
            <text
              :x="layout.maxX - 31"
              y="18"
              text-anchor="middle"
              font-size="3.5"
              font-weight="600"
              fill="#ff6f00"
            >{{ regression.equation }}</text>
            <text
              :x="layout.maxX - 31"
              y="26"
              text-anchor="middle"
              font-size="3"
              font-weight="500"
              fill="#666"
            >R² = {{ fmt2(regression.r2) }}</text>
          </g>
        </g>

        <!-- HISTOGRAM chart -->
        <g v-else-if="activeTab === 'HISTOGRAM'">
          <!-- Gradient definition for histogram bars -->
          <defs>
            <linearGradient
              id="histogramGradient"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop
                offset="0%"
                style="stop-color:#64b5f6;stop-opacity:1"
              />
              <stop
                offset="100%"
                style="stop-color:#1976d2;stop-opacity:1"
              />
            </linearGradient>
          </defs>

          <!-- Histogram bars -->
          <rect
            v-for="(b, i) in histogram.bins"
            :key="'hb-' + i"
            :x="b.x"
            :y="b.y"
            :width="b.w"
            :height="b.h"
            fill="url(#histogramGradient)"
            :stroke="hoveredBin === i ? '#1565c0' : '#42a5f5'"
            :stroke-width="hoveredBin === i ? 1.5 : 0.5"
            :opacity="hoveredBin !== null && hoveredBin !== i ? 0.6 : 1"
            style="transition: all 0.2s ease"
          />

          <!-- Hover tooltip -->
          <template v-if="showHover && hoveredBin !== null && histogram.bins[hoveredBin]">
            <g>
              <!-- Tooltip background -->
              <rect
                :x="histogram.bins[hoveredBin].x + histogram.bins[hoveredBin].w / 2 - 35"
                :y="Math.max(5, histogram.bins[hoveredBin].y - 20)"
                width="70"
                height="18"
                fill="white"
                stroke="#1976d2"
                stroke-width="0.8"
                rx="3"
                opacity="0.98"
                filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
              />
              <!-- Count -->
              <text
                :x="histogram.bins[hoveredBin].x + histogram.bins[hoveredBin].w / 2"
                :y="Math.max(12, histogram.bins[hoveredBin].y - 13)"
                text-anchor="middle"
                font-size="5.5"
                font-weight="700"
                fill="#1976d2"
              >{{ histogram.bins[hoveredBin].count }} {{ histogram.bins[hoveredBin].count === 1 ? 'hodnota' : histogram.bins[hoveredBin].count < 5 ? 'hodnoty' : 'hodnot' }}</text>

              <!-- Range label -->
              <text
                :x="histogram.bins[hoveredBin].x + histogram.bins[hoveredBin].w / 2"
                :y="Math.max(18, histogram.bins[hoveredBin].y - 7)"
                text-anchor="middle"
                font-size="3.5"
                font-weight="500"
                fill="#666"
              >{{ histogram.bins[hoveredBin].label }}</text>
            </g>
          </template>

          <!-- Mean line -->
          <g v-if="showMean && meanXForHistogram !== null">
            <line
              :x1="meanXForHistogram"
              :x2="meanXForHistogram"
              y1="10"
              y2="90"
              stroke="#ff6f00"
              stroke-dasharray="4,3"
              stroke-width="1.5"
            />
            <!-- Mean label with background -->
            <rect
              :x="meanXForHistogram - 18"
              y="8"
              width="36"
              height="8"
              fill="white"
              stroke="#ff6f00"
              stroke-width="0.5"
              rx="2"
              opacity="0.95"
            />
            <text
              :x="meanXForHistogram"
              y="13.5"
              text-anchor="middle"
              font-size="4"
              font-weight="700"
              fill="#ff6f00"
            >Průměr: {{ fmt2(stats?.mean) }}</text>
          </g>
        </g>
        <!-- BOXPLOT chart -->
        <g v-else-if="activeTab === 'BOXPLOT' && box">
          <line
            :x1="box.center"
            :x2="box.center"
            :y1="box.yMin"
            :y2="box.yQ1"
            stroke="#455a64"
            stroke-width="1"
          />
          <line
            :x1="box.center"
            :x2="box.center"
            :y1="box.yQ3"
            :y2="box.yMax"
            stroke="#455a64"
            stroke-width="1"
          />
          <line
            :x1="box.center - 10"
            :x2="box.center + 10"
            :y1="box.yMin"
            :y2="box.yMin"
            stroke="#455a64"
            stroke-width="1"
          />
          <line
            :x1="box.center - 10"
            :x2="box.center + 10"
            :y1="box.yMax"
            :y2="box.yMax"
            stroke="#455a64"
            stroke-width="1"
          />
          <rect
            :x="box.center - 15"
            :y="box.yQ3"
            width="30"
            :height="Math.max(0.5, box.yQ1 - box.yQ3)"
            fill="#c5e1a5"
            stroke="#7cb342"
            stroke-width="1"
          />
          <line
            :x1="box.center - 15"
            :x2="box.center + 15"
            :y1="box.yMed"
            :y2="box.yMed"
            stroke="#e53935"
            :stroke-width="hoverMedianActive ? 2.5 : 1.4"
          />
          <text
            v-if="hoverMedianActive"
            :x="box.center + 18"
            :y="box.yMed + 1.5"
            font-size="5"
            fill="#e53935"
            font-weight="bold"
          >Medián: {{ fmt2(boxStats?.med) }}</text>
          <g v-if="outliers && outliers.outlierIndexes.length && series[0]">
            <circle
              v-for="idx in outliers.outlierIndexes"
              :key="'out-box-' + idx"
              :cx="box.center"
              :cy="mapYValue(series[0].points[idx])"
              r="2.5"
              fill="white"
              stroke="#e64a19"
              stroke-width="1.5"
            />
          </g>
          <g v-if="box.outlierPoints && box.outlierPoints.length">
            <circle
              v-for="(o, i) in box.outlierPoints"
              :key="'calc-out-' + i"
              :cx="box.center"
              :cy="o.y"
              r="3"
              :fill="o.isClipped ? 'none' : 'white'"
              :stroke="o.isClipped ? '#d32f2f' : '#e64a19'"
              stroke-width="1.5"
              style="cursor: pointer"
              @click="(e) => $emit('point-click', { event: e, idx: o.idx, val: o.val })"
            >
              <title>Měření #{{ o.idx + 1 }}: {{ fmt2(o.val) }}</title>
            </circle>
          </g>
          <!-- Hover line for boxplot -->
          <template v-if="showHover && hoverYPercent !== null && !hoverMeanActive">
            <line
              x1="0"
              :x2="layout.width"
              :y1="hoverYPercent"
              :y2="hoverYPercent"
              stroke="#bdbdbd"
              stroke-width="0.6"
              stroke-dasharray="2,2"
              pointer-events="none"
            />
            <text
              :x="layout.width - 2"
              :y="Math.max(12, hoverYPercent - 2)"
              text-anchor="end"
              font-size="5"
              fill="#424242"
            >{{ hoverYValueLabel }}</text>
          </template>
        </g>
        <!-- Mean line (line / scatter / boxplot) -->
        <template
          v-if="(activeTab === 'LINE' || activeTab === 'SCATTER' || activeTab === 'BOXPLOT') && showMean && meanY !== null"
        >
          <line
            x1="0"
            :x2="layout.width"
            :y1="meanY"
            :y2="meanY"
            :stroke="hoverMeanActive ? '#fb8c00' : '#ff9800'"
            stroke-dasharray="2,2"
            :stroke-width="hoverMeanActive ? 1.2 : 0.8"
          />
          <text
            v-if="hoverMeanActive"
            :x="layout.width - 2"
            :y="Math.max(12, (meanY ?? 12) - 2)"
            text-anchor="end"
            font-size="5"
            fill="#424242"
          >Mean: {{ fmt2(stats?.mean) }}</text>
        </template>
      </svg>
    </div>
  </v-sheet>
  <!-- Box‑plot legend -->
  <div
    v-if="activeTab === 'BOXPLOT'"
    class="d-flex align-center justify-end mt-2 text-caption text-grey"
  >
    <div class="d-flex align-center mr-4">
      <div class="legend-iqr" />IQR (50%)
    </div>
    <div class="d-flex align-center mr-4">
      <div class="legend-median" />Medián
    </div>
    <div class="d-flex align-center">
      <div class="legend-outlier" />Odlehlá hodnota (Outlier)
    </div>
  </div>
</template>
<style scoped>
/* -----------------------------------------------------------------
   Layout containers
   ----------------------------------------------------------------- */
.chart-wrapper {
  overflow-x: auto;               /* horizontal scroll for wide charts */
  overflow-y: hidden;
  padding-bottom: 4px;            /* space for possible scrollbars */
}
/* Slight background gradient for premium feel */
.chart-area {
  background: linear-gradient(to bottom, #f9fafb, #fff);
  border-radius: 8px;
}
/* -----------------------------------------------------------------
   SVG sizing
   ----------------------------------------------------------------- */
.chart-svg {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
/* -----------------------------------------------------------------
   Typography & axis styling
   ----------------------------------------------------------------- */
.axes line {
  shape-rendering: crispEdges;
}
.axis-label-main {
  font-family: 'Roboto', sans-serif;
  font-size: 3.5px;
  fill: #9e9e9e;
  font-weight: 500;
}
/* -----------------------------------------------------------------
   Legend symbols (box‑plot)
   ----------------------------------------------------------------- */
.legend-iqr {
  width: 30px;
  height: 12px;
  background: #c5e1a5;
  border: 1px solid #7cb342;
  margin-right: 6px;
}
.legend-median {
  width: 20px;
  height: 2px;
  background: #e53935;
  margin-right: 6px;
}
.legend-outlier {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: white;
  border: 1.5px solid #e64a19;
  margin-right: 6px;
}
/* -----------------------------------------------------------------
   Chart title
   ----------------------------------------------------------------- */
.chart-title {
  font-family: 'Roboto', sans-serif;
  font-weight: 600;
  color: #424242;
}
/* -----------------------------------------------------------------
   Tooltip text (used in future extensions)
   ----------------------------------------------------------------- */
.tooltip-text {
  font-family: 'Roboto', sans-serif;
  font-size: 3px;
  fill: #424242;
  font-weight: 600;
  pointer-events: none;
  dominant-baseline: middle;
}
</style>
