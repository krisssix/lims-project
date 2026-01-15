<script setup lang="ts">
/**
 * MarkdownEditor - WYSIWYG markdown editor component
 * Using md-editor-v3 for Vue 3
 * 
 * Can be used in edit or preview-only mode
 */
import { computed } from 'vue'
import { MdEditor, MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'

const props = defineProps<{
  modelValue: string
  readonly?: boolean
  placeholder?: string
  minHeight?: string
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const content = computed({
  get: () => props.modelValue ?? '',
  set: (v: string) => emits('update:modelValue', v)
})

// Czech language labels for toolbar
const toolbars = [
  'bold',
  'underline',
  'italic',
  'strikeThrough',
  '-',
  'title',
  'quote',
  'unorderedList',
  'orderedList',
  'task',
  '-',
  'codeRow',
  'code',
  'link',
  'image',
  'table',
  '-',
  'revoke',
  'next',
  '=',
  'preview',
  'htmlPreview'
] as const
</script>

<template>
  <div class="markdown-editor-wrapper">
    <!-- Read-only mode: just render markdown -->
    <MdPreview
      v-if="readonly"
      :model-value="content"
      language="en-US"
      :style="{ minHeight: minHeight || '100px' }"
      class="md-preview-readonly"
    />
    
    <!-- Edit mode: full editor with live preview -->
    <MdEditor
      v-else
      v-model="content"
      language="en-US"
      :placeholder="placeholder || 'Pište poznámky...'"
      :toolbars="toolbars"
      :style="{ minHeight: minHeight || '200px' }"
      :preview="true"
      no-upload-img
      class="md-editor-custom"
    />
  </div>
</template>

<style scoped>
.markdown-editor-wrapper {
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
}

.md-editor-custom {
  border-radius: 8px;
}

.md-preview-readonly {
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
}

/* Dark mode support */
:deep(.md-editor-dark) {
  --md-bk-color: #1e1e1e;
}
</style>
