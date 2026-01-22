<script setup lang="ts">
import { type TemplateBlockRow } from '@/types/measurement-ui'
const props = defineProps<{
  templateBlocks: TemplateBlockRow[]
  currentBlockIndex: number
  currentBlockTitle: string
}>()
const emits = defineEmits<{
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'set-index', idx: number): void
}>()
</script>

<template>
  <div
    v-if="templateBlocks.length > 1"
    class="blocks-nav"
  >
    <div class="blocks-tabs">
      <button
        v-for="(block, idx) in templateBlocks"
        :key="block.id"
        class="block-tab"
        :class="{ 'is-active': idx === currentBlockIndex }"
        @click="emits('set-index', idx)"
      >
        {{ block.title }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.blocks-nav {
  margin-bottom: 12px;
}

.blocks-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 2px 0;
}

.block-tab {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: #f1f3f5;
  color: #495057;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.block-tab:hover {
  background: #e9ecef;
}

.block-tab.is-active {
  background: #1867c0;
  color: white;
}

.block-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  padding: 6px 0;
  margin-bottom: 8px;
}
</style>
