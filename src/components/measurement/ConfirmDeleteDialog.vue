<script setup lang="ts">
import Dialog from '@/components/Dialog.vue'

const isOpen = defineModel<boolean>('isOpen', { default: false })
defineProps<{
  loading?: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
}>()
const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Dialog v-model:is-open="isOpen" :hide-footer="true" width="520px">
    <template #content>
      <div class="pa-4">
        <div class="text-h6 mb-2">{{ title || 'Opravdu smazat?' }}</div>
        <div class="mb-4">{{ message || 'Tato akce je nevratná.' }}</div>
        <div class="d-flex" style="gap: 12px">
          <v-btn color="error" :loading="loading" @click="$emit('confirm')">{{ confirmText || 'Smazat' }}</v-btn>
          <v-spacer />
          <v-btn variant="tonal" @click="$emit('cancel')">{{ cancelText || 'Zrušit' }}</v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>
