<script setup lang="ts">
/**
 * importpreviewgrid: zobrazuje náhled parsovaných dat s odznaky formátu.
 * zobrazuje standardně maximálně 200 řádků (dříve 5).
 */
import { computed } from 'vue'

const props = defineProps<{
  rows: string[][]
  headers?: string[]
  usedDelimiter?: string
  usedDecimal?: string
  usedHeaderRow?: number | null
  maxRows?: number
  maxCols?: number
}>()

const maxRowsLimit = computed(() => props.maxRows ?? 200)
const maxColsLimit = computed(() => props.maxCols ?? 20)

const displayRows = computed(() => {
  return props.rows.slice(0, maxRowsLimit.value).map(row =>
    row.slice(0, maxColsLimit.value)
  )
})

const displayHeaders = computed(() => {
  if (!props.headers) return null
  return props.headers.slice(0, maxColsLimit.value)
})

const delimiterLabel = computed(() => {
  switch (props.usedDelimiter) {
    case '\t': return 'TAB'
    case ';': return 'Středník'
    case ',': return 'Čárka'
    case '|': return 'Pipe'
    default: return props.usedDelimiter || 'Auto'
  }
})

const headerLabel = computed(() => {
  if (props.usedHeaderRow === null || props.usedHeaderRow === undefined) {
    return 'Bez hlavičky'
  }
  return `Řádek ${props.usedHeaderRow}`
})

const hasMoreRows = computed(() => props.rows.length > maxRowsLimit.value)
const hasMoreCols = computed(() => {
  const maxCols = Math.max(...props.rows.map(r => r.length), props.headers?.length || 0)
  return maxCols > maxColsLimit.value
})

const totalRows = computed(() => props.rows.length)
const totalCols = computed(() => {
  return Math.max(...props.rows.map(r => r.length), props.headers?.length || 0)
})

function getRowIndex(visualIndex: number): number {
  // pokud máme index řádku hlavičky, předpokládáme, že následující řádky ho následují
  const start = (props.usedHeaderRow ?? -1) + 1
  return start + visualIndex
}
</script>

<template>
  <div class="import-preview-grid">
    <!-- odznaky formátu (format badges) -->
    <div class="preview-badges mb-2 d-flex flex-wrap ga-2 text-caption">
      <v-chip
        size="x-small"
        variant="tonal"
        color="primary"
      >
        <v-icon
          start
          size="12"
        >
          mdi-format-columns
        </v-icon>
        {{ delimiterLabel }}
      </v-chip>
      <v-chip
        size="x-small"
        variant="tonal"
        color="primary"
      >
        <v-icon
          start
          size="12"
        >
          mdi-table-row
        </v-icon>
        Hlavička: {{ props.usedHeaderRow !== undefined && props.usedHeaderRow !== null ? props.usedHeaderRow : 'Ne' }}
      </v-chip>
      <v-chip
        v-if="usedDecimal"
        size="x-small"
        variant="tonal"
        color="primary"
      >
        <v-icon
          start
          size="12"
        >
          mdi-decimal
        </v-icon>
        {{ usedDecimal === ',' ? 'Čárka' : 'Tečka' }}
      </v-chip>
      <v-chip
        size="x-small"
        variant="outlined"
      >
        {{ totalRows }} řádků × {{ totalCols }} sloupců
      </v-chip>
    </div>

    <!-- tabulka náhledu (preview table) -->
    <div class="preview-table-wrapper">
      <table class="preview-table">
        <thead v-if="displayHeaders">
          <tr>
            <!-- číslo řádku pro hlavičku -->
            <th class="preview-header-cell row-num-cell">
              {{ props.usedHeaderRow ?? '#' }}
            </th>
            <th 
              v-for="(h, i) in displayHeaders" 
              :key="'h-' + i"
              class="preview-header-cell"
            >
              {{ h || `(${i + 1})` }}
            </th>
            <th
              v-if="hasMoreCols"
              class="preview-header-cell more-indicator"
            >
              ...
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, ri) in displayRows"
            :key="'r-' + ri"
          >
            <!-- číslo řádku pro data -->
            <td class="preview-cell row-num-cell">
              {{ getRowIndex(ri) }}
            </td>
            <td 
              v-for="(cell, ci) in row" 
              :key="'c-' + ci"
              class="preview-cell"
              :title="cell"
            >
              {{ truncateCell(cell) }}
            </td>
            <td
              v-if="hasMoreCols"
              class="preview-cell more-indicator"
            >
              ...
            </td>
          </tr>
          <tr
            v-if="hasMoreRows"
            class="more-rows"
          >
            <td :colspan="(displayHeaders?.length || displayRows[0]?.length || 1) + 2">
              + {{ totalRows - maxRowsLimit }} dalších řádků... (z celkem {{ totalRows }})
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script lang="ts">
function truncateCell(value: string, maxLen = 40): string {
  if (!value) return ''
  if (value.length <= maxLen) return value
  return value.slice(0, maxLen - 3) + '...'
}
</script>

<style scoped>
.import-preview-grid {
  margin-top: 8px;
}

.preview-table-wrapper {
  max-height: 400px; /* zvýšená výška pro lepší zobrazení */
  overflow: auto;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fafafa;
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
  font-family: 'Roboto Mono', monospace; /* neproporcionální písmo pro zarovnání */
}

.preview-header-cell {
  background: #f5f5f5;
  padding: 6px 10px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid #e0e0e0;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  position: sticky;
  top: 0;
  z-index: 2;
}

.preview-cell {
  padding: 4px 10px;
  border-bottom: 1px solid #eee;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-num-cell {
  width: 40px;
  min-width: 40px;
  text-align: center;
  color: #888;
  border-right: 1px solid #e0e0e0;
  background-color: #f9f9f9;
  font-weight: bold;
  user-select: none;
}
.preview-header-cell.row-num-cell {
  background-color: #eee;
  z-index: 3; /* nad ostatními hlavičkami */
}

.more-indicator {
  color: #999;
  font-style: italic;
  text-align: center;
}

.more-rows td {
  text-align: center;
  color: #666;
  font-style: italic;
  padding: 8px;
  background: #f9f9f9;
}
</style>
