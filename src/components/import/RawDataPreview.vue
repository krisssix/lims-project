<script setup lang="ts">
/**
 * rawdatapreview: zobrazuje nezměněná surová data s podporou posunu na konkrétní blok.
 * vrstva 1 třívrstvé importní architektury.
 */
import { ref, computed, watch, nextTick } from 'vue'
import type { DetectedBlock } from '@/types/import-blocks'
import { getBlockTypeLabel } from '@/types/import-blocks'

const props = defineProps<{
  rawLines?: string[]
  rawGrid?: string[][]
  blocks: DetectedBlock[]
  selectedBlockId?: string | null
  maxVisibleRows?: number
}>()

const emit = defineEmits<{
  (e: 'row-click', row: number): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const expanded = ref(false)

const displayRows = computed(() => {
  if (props.rawGrid) {
    return props.rawGrid.map((row, i) => ({
      index: i,
      content: row.join('\t'),
      cells: row
    }))
  }
  if (props.rawLines) {
    return props.rawLines.map((line, i) => ({
      index: i,
      content: line,
      cells: line.split(/\t|;|,/)
    }))
  }
  return []
})

const visibleRows = computed(() => {
  const max = expanded.value ? displayRows.value.length : (props.maxVisibleRows || 15)
  return displayRows.value.slice(0, max)
})

const hasMore = computed(() => displayRows.value.length > (props.maxVisibleRows || 15))

// kontrola, zda je řádek součástí bloku (row in block)
function getRowBlock(rowIndex: number): DetectedBlock | undefined {
  return props.blocks.find(b => rowIndex >= b.startRow && rowIndex <= b.endRow)
}

function isRowHighlighted(rowIndex: number): boolean {
  if (!props.selectedBlockId) return false
  const block = getRowBlock(rowIndex)
  return block?.id === props.selectedBlockId
}

function getRowBlockBadge(rowIndex: number): { label: string; color: string } | null {
  const block = getRowBlock(rowIndex)
  if (!block) return null
  if (rowIndex !== block.startRow) return null // odznak zobrazit pouze na prvním řádku
  
  const colors: Record<string, string> = {
    kv: 'deep-purple',
    table: 'primary',
    series: 'success',
    stats: 'warning',
    unknown: 'grey'
  }
  
  return {
    label: `${getBlockTypeLabel(block.type)} (${block.startRow + 1}–${block.endRow + 1})`,
    color: colors[block.type] || 'grey'
  }
}

// posun (scroll) na blok při změně vybraného bloku (selectedBlockId)
watch(() => props.selectedBlockId, async (blockId) => {
  if (!blockId || !containerRef.value) return
  
  const block = props.blocks.find(b => b.id === blockId)
  if (!block) return
  
  await nextTick()
  
  const rowEl = containerRef.value.querySelector(`[data-row="${block.startRow}"]`)
  if (rowEl) {
    rowEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
})
</script>

<template>
  <div class="raw-preview">
    <div class="raw-header d-flex align-center mb-2">
      <v-icon size="16" class="mr-2">mdi-file-document-outline</v-icon>
      <span class="text-subtitle-2">Raw data</span>
      <span class="text-caption text-medium-emphasis ml-2">
        ({{ displayRows.length }} řádků, nezměněno)
      </span>
      <v-spacer />
      <v-btn
        v-if="hasMore"
        size="small"
        variant="text"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Sbalit' : 'Zobrazit více' }}
      </v-btn>
    </div>
    
    <div ref="containerRef" class="raw-container">
      <div
        v-for="row in visibleRows"
        :key="row.index"
        :data-row="row.index"
        class="raw-row"
        :class="{ 'highlighted': isRowHighlighted(row.index) }"
        @click="emit('row-click', row.index)"
      >
        <span class="row-number">{{ row.index + 1 }}</span>
        <span class="row-content">{{ row.content }}</span>
        <v-chip
          v-if="getRowBlockBadge(row.index)"
          :color="getRowBlockBadge(row.index)!.color"
          size="small"
          variant="tonal"
          class="ml-2"
        >
          {{ getRowBlockBadge(row.index)!.label }}
        </v-chip>
      </div>
      
      <div v-if="!expanded && hasMore" class="more-indicator">
        + {{ displayRows.length - visibleRows.length }} dalších řádků...
      </div>
    </div>
  </div>
</template>

<style scoped>
.raw-preview {
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
}

.raw-container {
  max-height: 300px;
  overflow: auto;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.75rem;
  line-height: 1.4;
}

.raw-row {
  display: flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.raw-row:hover {
  background: rgba(0, 0, 0, 0.04);
}

.raw-row.highlighted {
  background: rgba(25, 118, 210, 0.12);
  border-left: 3px solid #1976d2;
}

.row-number {
  color: #999;
  min-width: 36px;
  text-align: right;
  margin-right: 12px;
  font-size: 0.7rem;
}

.row-content {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 600px;
}

.more-indicator {
  text-align: center;
  color: #666;
  font-style: italic;
  padding: 8px;
}
</style>
