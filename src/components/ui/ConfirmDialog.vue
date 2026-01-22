<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmColor?: string
  icon?: string
  iconColor?: string
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function onConfirm() {
  emits('confirm')
  emits('update:modelValue', false)
}

function onCancel() {
  emits('cancel')
  emits('update:modelValue', false)
}
</script>

<template>
  <teleport to="body">
    <v-dialog
      :model-value="modelValue"
      max-width="420"
      persistent
      :z-index="3000"
      @update:model-value="emits('update:modelValue', $event)"
    >
      <v-card class="confirm-dialog">
        <v-card-title class="dialog-header">
          <v-icon 
            :color="iconColor || 'warning'" 
            size="24"
            class="mr-2"
          >
            {{ icon || 'mdi-alert-circle' }}
          </v-icon>
          {{ title || 'Potvrzení' }}
        </v-card-title>
        
        <v-card-text class="dialog-body">
          {{ message }}
        </v-card-text>
        
        <v-card-actions class="dialog-actions">
          <v-spacer />
          <v-btn 
            variant="text" 
            @click="onCancel"
          >
            {{ cancelText || 'Zrušit' }}
          </v-btn>
          <v-btn 
            :color="confirmColor || 'error'" 
            variant="flat"
            @click="onConfirm"
          >
            {{ confirmText || 'Potvrdit' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </teleport>
</template>

<style scoped>
.confirm-dialog {
  border-radius: 12px;
}

.dialog-header {
  display: flex;
  align-items: center;
  padding: 20px 24px 12px;
  font-size: 1.1rem;
  font-weight: 600;
}

.dialog-body {
  padding: 12px 24px 20px;
  font-size: 0.95rem;
  color: #555;
  line-height: 1.5;
}

.dialog-actions {
  padding: 12px 24px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
</style>
