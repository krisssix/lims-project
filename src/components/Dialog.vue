<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    isOpen: boolean,
    width?: string | number,
    hideFooter?: boolean,
    maxHeight?: string | number,
    
    // New aesthetic props
    title?: string,
    subtitle?: string,
    icon?: string
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean],
  'close': []
}>()

function close() {
  emit('update:isOpen', false)
  emit('close')
}
</script>

<template>
  <v-dialog
    :model-value="isOpen"
    @update:model-value="v => emit('update:isOpen', v)"
    :width="width || '500px'"
    scrollable
    persistent
  >
    <div class="dialog-card" :style="{ maxHeight: props.maxHeight || '90vh' }">
      
      <!-- HEADER -->
      <div class="dialog-header text-left" v-if="title || $slots.header || icon">
        <slot name="header">
           <div class="header-row">
             <div class="header-left">
               <div class="header-icon" v-if="icon">
                 <v-icon size="24" color="white">{{ icon }}</v-icon>
               </div>
               <div class="header-text">
                 <div class="header-title">{{ title }}</div>
                 <div class="header-subtitle" v-if="subtitle">
                   {{ subtitle }}
                 </div>
               </div>
             </div>
             <button type="button" class="close-btn" @click="close">
               <v-icon size="18">mdi-close</v-icon>
             </button>
           </div>
        </slot>
      </div>

      <!-- CONTENT -->
      <div class="dialog-content text-left">
        <slot name="content"></slot>
        <slot></slot>
      </div>

      <!-- FOOTER -->
      <div class="dialog-footer" v-if="!hideFooter || $slots.footer">
        <slot name="footer"></slot>
      </div>

    </div>
  </v-dialog>
</template>

<style scoped>
/* Copied styles from ReservationEditorDialog, renamed .res-* to .dialog-* */
.dialog-card {
  border-radius: 16px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  /* Max height handled by style binding */
}

/* Header */
.dialog-header {
  background: #1976d2;
  padding: 20px 24px;
  color: white;
  flex-shrink: 0;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  width: 44px;
  height: 44px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.header-title {
  font-size: 18px;
  font-weight: 600;
}

.header-subtitle {
  font-size: 13px;
  opacity: 0.9;
  display: flex;
  align-items: center;
  margin-top: 2px;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* Content */
.dialog-content {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

/* Footer */
.dialog-footer {
  padding: 16px 24px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
</style>
