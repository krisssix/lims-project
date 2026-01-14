<script setup lang="ts">
import { computed } from 'vue'

type TemplateOption = {
  id: string
  name: string
  deviceId: string
  deviceColor?: string
  status?: 'DRAFT' | 'ACTIVE' | 'DEPRECATED'
  version?: string
}

const props = defineProps<{
  modelValue: string | null
  items: TemplateOption[]
  deviceId?: string | null
  valueKey?: 'id' | 'name'
  label?: string
  placeholder?: string
  density?: 'comfortable' | 'compact' | 'default'
  disabled?: boolean
  clearable?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: string | null): void
  (e: 'create-template'): void
}>()

const density = computed(() => props.density ?? 'comfortable')
const valueKey = computed(() => props.valueKey ?? 'id')

// Filter templates by device if deviceId is provided
// ONLY show ACTIVE templates (not DRAFT or DEPRECATED)
// Deduplicate by base name to show only one version per template
const filteredItems = computed<TemplateOption[]>(() => {
  const all = props.items || []
  if (!props.deviceId) return []
  
  // Match by deviceId OR deviceCode (some templates use code, some use id)
  const filtered = all.filter(t => {
    const tplDeviceId = String(t.deviceId ?? '')
    const tplDeviceCode = String((t as unknown as { deviceCode?: string }).deviceCode ?? '')
    const selectedId = String(props.deviceId)
    const matchesDevice = tplDeviceId === selectedId || tplDeviceCode === selectedId
    
    // ONLY show ACTIVE templates (or templates without status for backward compatibility)
    const isActive = !t.status || t.status === 'ACTIVE'
    
    return matchesDevice && isActive
  })
  
  // Deduplicate by id
  const seen = new Set<string>()
  return filtered.filter(t => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
})


// Get item value based on valueKey
function getItemValue(item: TemplateOption): string {
  return valueKey.value === 'name' ? item.name : item.id
}

// Filter by name (case-insensitive)
function templateFilterFn(item: TemplateOption, queryText: string): boolean {
  const q = (queryText || '').toLowerCase()
  const name = (item.name || '').toLowerCase()
  const id = (item.id || '').toLowerCase()
  return name.includes(q) || id.includes(q)
}

function onUpdate(val: unknown): void {
  const v = typeof val === 'string' ? val : (val == null ? null : String(val))
  emits('update:modelValue', v)
}
</script>

<template>
  <v-autocomplete
    :model-value="modelValue"
    :items="filteredItems"
    item-title="name"
    :item-value="getItemValue"
    :label="label || 'Šablona'"
    :placeholder="placeholder || (deviceId ? 'Vyberte šablonu...' : 'Nejprve vyberte přístroj')"
    :density="density"
    variant="outlined"
    hide-details="auto"
    :filter="templateFilterFn"
    :disabled="disabled || !deviceId"
    clearable
    clear-on-select
    autocomplete="off"
    @update:model-value="onUpdate"
  >
    <template
      v-if="modelValue"
      #selection="{ item }"
    >
      <div class="d-flex align-center" style="gap:8px;">
        <v-icon size="18" color="primary">mdi-file-document-outline</v-icon>
        <span class="text-body-2">{{ item.raw?.name }}</span>
      </div>
    </template>

    <template #item="{ item, props: liProps }">
      <v-list-item v-bind="liProps" :title="undefined">
        <template #prepend>
          <v-icon size="20" color="primary">mdi-file-document-outline</v-icon>
        </template>
        <v-list-item-title>{{ item.raw?.name }}</v-list-item-title>
      </v-list-item>
    </template>

    <template #no-data>
      <v-list-item>
        <v-list-item-title class="text-caption text-medium-emphasis">
          {{ deviceId ? 'Žádné šablony pro zvolený přístroj' : 'Nejprve vyberte přístroj' }}
        </v-list-item-title>
      </v-list-item>
    </template>

    <!-- Create new template action at the bottom -->
    <template #append-item>
      <v-divider class="my-1" />
      <v-list-item
        class="text-primary"
        prepend-icon="mdi-plus"
        :disabled="!deviceId"
        @click="emits('create-template')"
      >
        <v-list-item-title>Vytvořit novou šablonu</v-list-item-title>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>
