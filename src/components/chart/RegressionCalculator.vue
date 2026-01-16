<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { 
  linearRegression, 
  logarithmicRegression, 
  type RegressionResult, 
  type DataPoint 
} from '@/utils/regression'

const props = defineProps<{
  /** výchozí x hodnoty (initial x values) */
  xValues?: number[]
  /** výchozí y hodnoty (initial y values) */
  yValues?: number[]
  /** režim pouze pro čtení: zobrazí pouze výsledky (readonly) */
  /** titulek grafu (chart title) */
  title?: string
}>()

const emits = defineEmits<{
  (e: 'result', result: RegressionResult | null): void
}>()

// vstup dat (data input)
const xInput = ref('')
const yInput = ref('')

// typ regrese (regression type)
type RegressionType = 'linear' | 'logarithmic' | 'auto'
const regressionType = ref<RegressionType>('linear')

// výsledky (results)
const result = ref<RegressionResult | null>(null)
const error = ref<string | null>(null)

// inicializace z props (initialize from props)
watch([() => props.xValues, () => props.yValues], ([x, y]) => {
  if (x?.length && y?.length) {
    xInput.value = x.join('\n')
    yInput.value = y.join('\n')
    calculate()
  }
}, { immediate: true })

// parsování vstupu na čísla (parse input)
function parseInput(text: string): number[] {
  return text
    .split(/[\n,;\s]+/)
    .map(s => s.trim().replace(',', '.'))
    .filter(s => s !== '')
    .map(s => parseFloat(s))
    .filter(n => !isNaN(n))
}

// získání datových bodů (data points)
const dataPoints = computed<DataPoint[]>(() => {
  const xVals = parseInput(xInput.value)
  const yVals = parseInput(yInput.value)
  const len = Math.min(xVals.length, yVals.length)
  const points: DataPoint[] = []
  for (let i = 0; i < len; i++) {
    points.push({ x: xVals[i], y: yVals[i] })
  }
  return points
})

// výpočet regrese (calculate regression)
function calculate() {
  error.value = null
  result.value = null
  
  const points = dataPoints.value
  if (points.length < 2) {
    error.value = 'Potřeba alespoň 2 datové body'
    emits('result', null)
    return
  }
  
  try {
    if (regressionType.value === 'linear') {
      result.value = linearRegression(points)
    } else if (regressionType.value === 'logarithmic') {
      result.value = logarithmicRegression(points)
    } else {
      // auto: zkusit obojí, vybrat lepší koeficient determinace (r na druhou)
      const lin = linearRegression(points)
      try {
        const log = logarithmicRegression(points)
        result.value = log.rSquared > lin.rSquared ? log : lin
      } catch {
        result.value = lin
      }
    }
    emits('result', result.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Chyba výpočtu'
    emits('result', null)
  }
}

// sledování změn a automatický výpočet (watch for changes)
watch([xInput, yInput, regressionType], () => {
  if (dataPoints.value.length >= 2) {
    calculate()
  }
})

// rozměry svg grafu (svg chart dimensions)
const CHART_WIDTH = 300
const CHART_HEIGHT = 200
const PADDING = 30

// škálování grafu (chart scaling)
const chartBounds = computed(() => {
  const pts = dataPoints.value
  if (pts.length === 0) {
    return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
  }
  const xVals = pts.map(p => p.x)
  const yVals = pts.map(p => p.y)
  let xMin = Math.min(...xVals)
  let xMax = Math.max(...xVals)
  let yMin = Math.min(...yVals)
  let yMax = Math.max(...yVals)
  
  // přidání odsazení (padding)
  const xPad = (xMax - xMin) * 0.1 || 1
  const yPad = (yMax - yMin) * 0.1 || 1
  xMin -= xPad
  xMax += xPad
  yMin -= yPad
  yMax += yPad
  
  return { xMin, xMax, yMin, yMax }
})

function mapX(x: number): number {
  const { xMin, xMax } = chartBounds.value
  return PADDING + ((x - xMin) / (xMax - xMin)) * (CHART_WIDTH - PADDING * 2)
}

function mapY(y: number): number {
  const { yMin, yMax } = chartBounds.value
  return CHART_HEIGHT - PADDING - ((y - yMin) / (yMax - yMin)) * (CHART_HEIGHT - PADDING * 2)
}

// body regresní čáry pro svg (regression line path)
const regressionLinePath = computed(() => {
  if (!result.value) return ''
  const { xMin, xMax } = chartBounds.value
  
  const steps = 50
  const path: string[] = []
  
  for (let i = 0; i <= steps; i++) {
    const x = xMin + (i / steps) * (xMax - xMin)
    const y = result.value.predictY(x)
    if (!isFinite(y)) continue
    
    const sx = mapX(x)
    const sy = mapY(y)
    
    if (path.length === 0) {
      path.push(`M ${sx} ${sy}`)
    } else {
      path.push(`L ${sx} ${sy}`)
    }
  }
  
  return path.join(' ')
})

// formátování čísla pro zobrazení (format number)
function fmt(n: number, decimals = 4): string {
  if (Math.abs(n) < 0.0001 && n !== 0) {
    return n.toExponential(2)
  }
  return n.toFixed(decimals).replace(/\.?0+$/, '')
}

// kopírovat výsledky do schránky (copy to clipboard)
function copyResults() {
  if (!result.value) return
  const r = result.value
  const text = `Typ: ${r.type === 'linear' ? 'Lineární' : 'Logaritmická'}
Rovnice: ${r.equation}
Sklon (a): ${fmt(r.slope)}
Průsečík (b): ${fmt(r.intercept)}
r na druhou: ${fmt(r.rSquared)}
Korelace: ${fmt(r.correlation)}`
  navigator.clipboard.writeText(text)
}
</script>

<template>
  <div class="regression-calculator">
    <!-- záhlaví (header) -->
    <div class="d-flex align-center mb-3">
      <v-icon size="20" color="primary" class="mr-2">mdi-chart-scatter-plot</v-icon>
      <span class="text-subtitle-1 font-weight-medium">{{ title || 'Regresní kalkulátor' }}</span>
    </div>

    <!-- sekce vstupu: pokud není pouze pro čtení (input section) -->
    <div v-if="!readonly" class="input-section mb-4">
      <div class="d-flex ga-3">
        <v-textarea
          v-model="xInput"
          label="X hodnoty"
          placeholder="1&#10;2&#10;5&#10;10&#10;20"
          variant="outlined"
          density="compact"
          rows="5"
          hide-details
          class="flex-1"
        />
        <v-textarea
          v-model="yInput"
          label="Y hodnoty"
          placeholder="11.5&#10;19.5&#10;28.5&#10;36&#10;66"
          variant="outlined"
          density="compact"
          rows="5"
          hide-details
          class="flex-1"
        />
      </div>
      
      <div class="d-flex align-center mt-3 ga-2">
        <v-btn-toggle
          v-model="regressionType"
          mandatory
          density="compact"
          color="primary"
        >
          <v-btn value="linear" size="small">Lineární</v-btn>
          <v-btn value="logarithmic" size="small">Logaritmická</v-btn>
          <v-btn value="auto" size="small">Auto</v-btn>
        </v-btn-toggle>
        
        <v-spacer />
        
        <v-btn
          color="primary"
          size="small"
          variant="flat"
          :disabled="dataPoints.length < 2"
          @click="calculate"
        >
          <v-icon start size="16">mdi-calculator</v-icon>
          Vypočítat
        </v-btn>
      </div>
    </div>

    <!-- chyba (error) -->
    <v-alert v-if="error" type="error" density="compact" class="mb-3">
      {{ error }}
    </v-alert>

    <!-- výsledky (results) -->
    <div v-if="result" class="results-section">
      <!-- graf (chart) -->
      <div class="chart-container mb-4">
        <svg 
          :width="CHART_WIDTH" 
          :height="CHART_HEIGHT"
          class="regression-chart"
        >
          <!-- mřížka (grid lines) -->
          <g class="grid">
            <line 
              :x1="PADDING" 
              :y1="CHART_HEIGHT - PADDING" 
              :x2="CHART_WIDTH - PADDING" 
              :y2="CHART_HEIGHT - PADDING" 
              stroke="#e0e0e0"
            />
            <line 
              :x1="PADDING" 
              :y1="PADDING" 
              :x2="PADDING" 
              :y2="CHART_HEIGHT - PADDING" 
              stroke="#e0e0e0"
            />
          </g>
          
          <!-- regresní čára (regression line) -->
          <path
            v-if="regressionLinePath"
            :d="regressionLinePath"
            fill="none"
            stroke="#1976d2"
            stroke-width="2"
            stroke-dasharray="5,3"
          />
          
          <!-- datové body (data points) -->
          <g class="points">
            <circle
              v-for="(pt, i) in dataPoints"
              :key="i"
              :cx="mapX(pt.x)"
              :cy="mapY(pt.y)"
              r="5"
              fill="#1976d2"
              stroke="white"
              stroke-width="1.5"
            >
              <title>X: {{ fmt(pt.x, 2) }}, Y: {{ fmt(pt.y, 2) }}</title>
            </circle>
          </g>
          
          <!-- popisky os (axis labels) -->
          <text 
            :x="CHART_WIDTH / 2" 
            :y="CHART_HEIGHT - 5" 
            text-anchor="middle" 
            font-size="10"
            fill="#666"
          >X</text>
          <text 
            :x="10" 
            :y="CHART_HEIGHT / 2" 
            text-anchor="middle" 
            font-size="10"
            fill="#666"
            transform="rotate(-90, 10, 100)"
          >Y</text>
        </svg>
      </div>
      
      <!-- tabulka výsledků (results table) -->
      <div class="results-grid">
        <div class="result-row">
          <span class="result-label">Typ regrese:</span>
          <span class="result-value">
            <v-chip size="small" :color="result.type === 'linear' ? 'primary' : 'secondary'" variant="flat">
              {{ result.type === 'linear' ? 'Lineární' : 'Logaritmická' }}
            </v-chip>
          </span>
        </div>
        
        <div class="result-row equation">
          <span class="result-label">Rovnice:</span>
          <span class="result-value font-weight-medium">{{ result.equation }}</span>
        </div>
        
        <div class="result-row">
          <span class="result-label">Sklon (a):</span>
          <span class="result-value">{{ fmt(result.slope) }}</span>
        </div>
        
        <div class="result-row">
          <span class="result-label">Průsečík (b):</span>
          <span class="result-value">{{ fmt(result.intercept) }}</span>
        </div>
        
        <div class="result-row highlight">
          <span class="result-label">r na druhou (koeficient determinace):</span>
          <span class="result-value">
            <strong>{{ fmt(result.rSquared) }}</strong>
            <v-icon 
              v-if="result.rSquared > 0.95" 
              size="14" 
              color="success" 
              class="ml-1"
            >mdi-check-circle</v-icon>
          </span>
        </div>
        
        <div class="result-row">
          <span class="result-label">Korelace (r):</span>
          <span class="result-value">{{ fmt(result.correlation) }}</span>
        </div>
        
        <div class="result-row">
          <span class="result-label">Směrodatná chyba:</span>
          <span class="result-value">{{ fmt(result.standardError) }}</span>
        </div>
      </div>
      
      <!-- akce (actions) -->
      <div class="d-flex justify-end mt-3">
        <v-btn size="small" variant="text" @click="copyResults">
          <v-icon start size="16">mdi-content-copy</v-icon>
          Kopírovat
        </v-btn>
      </div>
    </div>
    
    <!-- prázdný stav (empty state) -->
    <div v-else-if="!error && dataPoints.length < 2" class="empty-state text-center py-6 text-medium-emphasis">
      <v-icon size="48" class="mb-2">mdi-chart-bell-curve-cumulative</v-icon>
      <div>Zadejte X a Y hodnoty pro výpočet regrese</div>
    </div>
  </div>
</template>

<style scoped>
.regression-calculator {
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}

.input-section {
  background: white;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid #eee;
}

.chart-container {
  display: flex;
  justify-content: center;
  background: white;
  padding: 16px;
  border-radius: 6px;
  border: 1px solid #eee;
}

.regression-chart {
  display: block;
}

.results-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: white;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid #eee;
}

.result-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.result-row.equation {
  border-bottom: 1px solid #eee;
  padding-bottom: 8px;
  margin-bottom: 4px;
}

.result-row.highlight {
  background: #e3f2fd;
  margin: 4px -12px;
  padding: 8px 12px;
  border-radius: 4px;
}

.result-label {
  color: #666;
  font-size: 13px;
}

.result-value {
  font-size: 14px;
  font-family: 'Roboto Mono', monospace;
}

.empty-state {
  color: #999;
}
</style>
