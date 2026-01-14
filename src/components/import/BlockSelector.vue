<script setup lang="ts">
/**
 * BlockSelector - Shows detected blocks with checkboxes for multi-select.
 * Layer 2 of the 3-layer import architecture.
 * User can include/exclude any block independently.
 */
import { computed } from 'vue'
import type { DetectedBlock, BlockAction } from '@/types/import-blocks'
import { getBlockTypeLabel } from '@/types/import-blocks'

const props = defineProps<{
  blocks: DetectedBlock[]
  selectedBlockId?: string | null
  includedBlockIds: string[] // Blocks that are included/checked
}>()

const emit = defineEmits<{
  (e: 'select', blockId: string): void
  (e: 'toggle-include', blockId: string, included: boolean): void
  (e: 'action', blockId: string, action: BlockAction): void
  (e: 'change-type', blockId: string, newType: 'table' | 'series'): void
  (e: 'update-description', blockId: string, description: string): void
  (e: 'confirm-blocks'): void
}>()

// Type options for dropdown
const typeOptions = [
  { value: 'table', label: 'Tabulka hodnot', icon: 'mdi-table', color: 'primary' },
  { value: 'series', label: 'Datová série', icon: 'mdi-chart-line', color: 'success' }
]

function onTypeChange(blockId: string, newType: string): void {
  console.log('[BlockSelector] onTypeChange called:', { blockId, newType })
  if (newType === 'table' || newType === 'series') {
    emit('change-type', blockId, newType)
  }
}


function onDescriptionChange(blockId: string, newDesc: string): void {
  emit('update-description', blockId, newDesc)
}


const sortedBlocks = computed(() => {
  return [...props.blocks].sort((a, b) => a.startRow - b.startRow)
})

function isBlockIncluded(blockId: string): boolean {
  return props.includedBlockIds.includes(blockId)
}

function getBlockIcon(type: string): string {
  switch (type) {
    case 'kv': return 'mdi-format-list-bulleted'
    case 'table': return 'mdi-table'
    case 'series': return 'mdi-chart-line'
    case 'stats': return 'mdi-calculator'
    default: return 'mdi-help-circle-outline'
  }
}

function getBlockColor(type: string): string {
  switch (type) {
    case 'kv': return 'deep-purple'
    case 'table': return 'primary'
    case 'series': return 'success'
    case 'stats': return 'warning'
    default: return 'grey'
  }
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return '●●●'
  if (confidence >= 0.5) return '●●○'
  return '●○○'
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'success'
  if (confidence >= 0.5) return 'warning'
  return 'error'
}

function onCheckboxChange(blockId: string, checked: boolean): void {
  emit('toggle-include', blockId, checked)
}

function truncate(text: string, maxLen: number): string {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}
</script>

<template>
  <div class="block-selector">
    <div class="selector-header d-flex align-center mb-3">
      <v-icon size="18" class="mr-2">mdi-layers-outline</v-icon>
      <span class="text-subtitle-2">Nalezené části souboru</span>
      <span class="text-caption text-medium-emphasis ml-2">
        ({{ includedBlockIds.length }}/{{ blocks.length }} zahrnuto)
      </span>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        prepend-icon="mdi-check"
        :disabled="includedBlockIds.length === 0"
        @click.stop="emit('confirm-blocks')"
      >
        Potvrdit výběr
      </v-btn>
    </div>

    
    <div class="block-list">
      <div
        v-for="block in sortedBlocks"
        :key="block.id"
        class="block-item"
        :class="{ 
          'selected': selectedBlockId === block.id,
          'is-included': isBlockIncluded(block.id),
          'is-excluded': !isBlockIncluded(block.id)
        }"
        @click="emit('select', block.id)"
      >
        <div class="block-main d-flex align-center">
          <!-- Checkbox for include/exclude -->
          <v-checkbox
            :model-value="isBlockIncluded(block.id)"
            hide-details
            density="compact"
            class="mr-2 flex-shrink-0"
            @update:model-value="val => onCheckboxChange(block.id, !!val)"
            @click.stop
          />
          
          <!-- Block icon and info -->
          <v-icon :color="getBlockColor(block.type)" size="20" class="mr-2">
            {{ getBlockIcon(block.type) }}
          </v-icon>
          
          <div class="block-info">
            <div class="block-title">
              {{ block.description }}
            </div>
            <div class="block-meta text-caption text-medium-emphasis">
              Řádky {{ block.startRow + 1 }}–{{ block.endRow + 1 }}
              <span v-if="block.columnCount">, {{ block.columnCount }} sloupců</span>
            </div>
          </div>
          
          <v-spacer />
          
          <!-- Confidence -->
          <span 
            class="confidence text-caption"
            :style="{ color: `rgb(var(--v-theme-${getConfidenceColor(block.confidence)}))` }"
            :title="`Spolehlivost: ${Math.round(block.confidence * 100)}%`"
          >
            {{ getConfidenceLabel(block.confidence) }}
          </span>
          
          <!-- Type dropdown (editable) -->
          <v-select
            :model-value="block.type === 'table' || block.type === 'series' ? block.type : 'table'"
            :items="typeOptions"
            item-title="label"
            item-value="value"
            density="compact"
            variant="outlined"
            hide-details
            class="ml-2 type-select"
            style="max-width: 160px;"
            @click.stop
            @update:model-value="val => onTypeChange(block.id, val)"
          >
            <template #selection="{ item }">
              <v-icon :color="item.raw.color" size="16" class="mr-1">{{ item.raw.icon }}</v-icon>
              <span class="text-caption">{{ item.raw.label }}</span>
            </template>
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps">
                <template #prepend>
                  <v-icon :color="item.raw.color" size="18">{{ item.raw.icon }}</v-icon>
                </template>
              </v-list-item>
            </template>
          </v-select>
        </div>
        
        <!-- Editable description when selected -->
        <div v-if="selectedBlockId === block.id && isBlockIncluded(block.id)" class="block-edit-row mt-2">
          <v-text-field
            :model-value="block.description"
            label="Název bloku"
            density="compact"
            variant="outlined"
            hide-details
            class="flex-grow-1"
            @click.stop
            @update:model-value="val => onDescriptionChange(block.id, val)"
          />
        </div>

        
        <!-- BLOCK PREVIEW (expandable) -->
        <v-expand-transition>
          <div v-show="selectedBlockId === block.id" class="block-preview mt-2">
            <div class="preview-table-wrap">
              <table class="preview-mini-table">
                <thead>
                  <tr>
                    <th v-for="(h, i) in (block.headers || []).slice(0, 6)" :key="'h-' + i">
                      {{ truncate(h, 15) }}
                    </th>
                    <th v-if="(block.headers?.length || 0) > 6">...</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in (block.sampleRows || []).slice(0, 2)" :key="'r-' + ri">
                    <td v-for="(cell, ci) in row.slice(0, 6)" :key="'c-' + ci">
                      {{ truncate(String(cell), 20) }}
                    </td>
                    <td v-if="row.length > 6">...</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="(block.sampleRows?.length || 0) > 2" class="text-caption text-medium-emphasis mt-1">
              + {{ (block.sampleRows?.length || 0) - 2 }} dalších řádků
            </div>
          </div>
        </v-expand-transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.block-selector {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
}

.block-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-item {
  padding: 12px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.block-item:hover {
  border-color: #bdbdbd;
  background: #fafafa;
}

.block-item.selected {
  border-color: #1976d2;
  background: rgba(25, 118, 210, 0.04);
}

.block-item.is-included {
  border-left: 3px solid #4caf50;
}

.block-item.is-excluded {
  opacity: 0.6;
  border-left: 3px solid #9e9e9e;
}

.block-item.is-excluded .block-title {
  text-decoration: line-through;
  color: #9e9e9e;
}

.block-info {
  flex: 1;
  min-width: 0;
}

.block-title {
  font-weight: 500;
  font-size: 0.9rem;
}

.confidence {
  font-weight: bold;
  letter-spacing: 1px;
}

/* Block preview styles */
.block-preview {
  padding-top: 12px;
  border-top: 1px solid #eee;
}

.preview-table-wrap {
  overflow-x: auto;
  max-width: 100%;
}

.preview-mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.preview-mini-table th {
  background: #f0f0f0;
  padding: 4px 8px;
  text-align: left;
  font-weight: 600;
  border-bottom: 1px solid #ddd;
  white-space: nowrap;
}

.preview-mini-table td {
  padding: 4px 8px;
  border-bottom: 1px solid #eee;
  white-space: nowrap;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: monospace;
  font-size: 0.7rem;
  color: #666;
}
</style>
