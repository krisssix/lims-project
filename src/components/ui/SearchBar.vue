<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  prependIcon?: string
  variant?: 'outlined' | 'filled' | 'solo' | 'plain' | 'underlined' | 'solo-filled' | 'solo-inverted'
  density?: 'default' | 'comfortable' | 'compact'
  clearable?: boolean
  hideDetails?: boolean
  fullWidth?: boolean
}>(), {
  placeholder: 'Vyhledávání...',
  prependIcon: 'mdi-magnify',
  variant: 'solo-filled',
  density: 'comfortable',
  clearable: true,
  hideDetails: true,
  fullWidth: true
})

const emits = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const internalValue = computed({
  get: () => props.modelValue,
  set: (v: string | null) => emits('update:modelValue', v ?? '')
})

const widthClass = computed(() => props.fullWidth ? 'search-bar--full-width' : '')
</script>

<template>
  <v-text-field
    v-model="internalValue"
    type="search"
    :prepend-inner-icon="props.prependIcon"
    :placeholder="props.placeholder"
    :variant="props.variant"
    :density="props.density"
    :hide-details="props.hideDetails"
    :clearable="props.clearable"
    :class="['search-bar', widthClass]"
    bg-color="grey-lighten-4"
  />
</template>

<style scoped>
.search-bar {
  transition: all 0.2s ease;
}

.search-bar--full-width {
  width: 100%;
  flex: 1 1 100%;
  max-width: 100%;
}

.search-bar :deep(.v-field) {
  border-radius: 12px;
  background: #f5f6f8 !important;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
}

.search-bar :deep(.v-field:hover) {
  background: #ebedf0 !important;
}

.search-bar :deep(.v-field--focused) {
  background: #f5f6f8 !important;
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary)) !important;
}

.search-bar :deep(.v-field__prepend-inner .v-icon) {
  font-size: 22px;
  color: rgb(var(--v-theme-primary));
  opacity: 0.7;
}

.search-bar :deep(.v-field--focused .v-field__prepend-inner .v-icon) {
  color: rgb(var(--v-theme-primary));
  opacity: 1;
}

.search-bar :deep(input::placeholder) {
  color: rgb(var(--v-theme-primary));
  opacity: 0.5;
  font-weight: 400;
}
</style>

