<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import type { DeviceItem, TemplateItem } from '@/stores/measurement'

const props = defineProps<{
  devices: DeviceItem[]
  templates: TemplateItem[]
}>()

const emit = defineEmits<{
  (e: 'update:selectedDate', v: string | Date | null): void
  (e: 'update:pickedDevices', v: string[]): void
  (e: 'update:pickedTemplates', v: string[]): void
  (e: 'select-all-devices'): void
  (e: 'clear-devices'): void
  (e: 'select-all-templates'): void
  (e: 'clear-templates'): void
}>()

const selectedDate = defineModel<string | Date | null>('selectedDate', { default: null })
const pickedDevices = defineModel<string[]>('pickedDevices', { default: [] })
const pickedTemplates = defineModel<string[]>('pickedTemplates', { default: [] })

const templateNames = computed(() => [...new Set(props.templates.map(t => t.name))])

function onFilterKeys(e: KeyboardEvent) {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); emit('select-all-devices') }
  if (e.ctrlKey && e.altKey   && e.key.toLowerCase() === 'd') { e.preventDefault(); emit('clear-devices') }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); emit('select-all-templates') }
  if (e.ctrlKey && e.altKey   && e.key.toLowerCase() === 's') { e.preventDefault(); emit('clear-templates') }
}
onMounted(() => window.addEventListener('keydown', onFilterKeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onFilterKeys))
</script>

<template>
  <v-sheet elevation="1" class="pa-4">
    <v-date-picker
      v-model="selectedDate"
      color="primary"
      show-adjacent-months
      first-day-of-week="1"
    />
  </v-sheet>

  <v-sheet elevation="1" class="pa-4 mt-4">
    <div class="filter-title">
      <div class="title">Přístroje</div>
      <div class="actions">
        <button class="link-action" @click="$emit('select-all-devices')">Vybrat vše</button>
        <button class="link-action" @click="$emit('clear-devices')">Zrušit výběr</button>
      </div>
    </div>
    <v-select
      v-model="pickedDevices"
      :items="props.devices"
      item-title="name"
      item-value="id"
      label="Přístroje"
      multiple
      chips
      closable-chips
      clearable
      density="comfortable"
      variant="outlined"
      hide-details="auto"
      class="mb-4 chip-select"
    >
      <template #selection="{ item }">
        <v-chip
          size="large"
          rounded="lg"
          closable
          :color="item.raw.color"
          class="device-chip"
          text-color="white"
          @click:close="pickedDevices = pickedDevices.filter(id => id !== item.raw.id)"
        >
          {{ item.raw.id }}
        </v-chip>
      </template>
    </v-select>

    <div class="filter-title">
      <div class="title">Šablona</div>
      <div class="actions">
        <button class="link-action" @click="$emit('select-all-templates')">Vybrat vše</button>
        <button class="link-action" @click="$emit('clear-templates')">Zrušit výběr</button>
      </div>
    </div>
    <v-select
      v-model="pickedTemplates"
      :items="templateNames"
      label="Šablona"
      multiple
      chips
      closable-chips
      clearable
      density="comfortable"
      variant="outlined"
      hide-details="auto"
      class="chip-select"
    />
  </v-sheet>
</template>

<style scoped>
.filter-title { display: flex; align-items: center; justify-content: space-between; margin: 2px 2px 6px 2px; }
.filter-title .title { font-weight: 700; }
.filter-title .actions { display: inline-flex; gap: 14px; }
.link-action { background: none; border: 0; color: #1976d2; font-size: .86rem; font-weight: 500; letter-spacing: .01em; cursor: pointer; padding: 0; text-decoration: none; }
.link-action:hover { text-decoration: underline; }
.chip-select :deep(.v-field) { border-radius: 10px; }
.device-chip { font-weight: 700; border-radius: 999px; color: #fff; }
</style>
