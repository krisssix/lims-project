<script setup lang="ts">
const props = defineProps<{
  enabled: boolean
  count: number
  index: number
}>()
const emit = defineEmits<{
  (e: 'update:enabled', v: boolean): void
  (e: 'update:count', v: number): void
  (e: 'update:index', v: number): void
  (e: 'prev'): void
  (e: 'next'): void
}>()

function toggle(v: boolean | null) {
  // Vuetify emituje boolean | null → převeď na boolean
  emit('update:enabled', v === true)
}
function setCount(v: number) {
  const n = Math.max(1, Math.min(999, Math.floor(v)))
  emit('update:count', n)
  if (props.index > n) emit('update:index', n)
}
function toPrev() { emit('prev') }
function toNext() { emit('next') }
</script>

<template>
  <div class="d-flex align-center ga-3 mb-2">
    <v-switch
      :model-value="enabled"
      color="primary" variant="flat"
      inset
      hide-details
      density="comfortable"
      label="Opakovatelné sady"
      @update:model-value="toggle"
    />
    <v-text-field
      v-if="enabled"
      :model-value="String(count)"
      label="Počet sad"
      type="number"
      min="1"
      max="999"
      step="1"
      hide-details
      density="comfortable"
      variant="outlined"
      style="max-width: 140px"
      @update:model-value="v => setCount(Number.parseInt(String(v || '1'), 10) || 1)"
    />
    <div
      v-if="enabled"
      class="d-flex align-center ga-2"
    >
      <v-btn
        icon="mdi-chevron-left"
        variant="text"
        title="Předchozí tabulka(Alt+←)"
        @click="toPrev"
      />
      <div class="text-subtitle-2">
        {{ index }} / {{ count }}
      </div>
      <v-btn
        icon="mdi-chevron-right"
        variant="text"
        title="Další tabulka(Alt+→)"
        @click="toNext"
      />
    </div>
    <v-spacer />
  </div>
</template>

<style scoped>
</style>
