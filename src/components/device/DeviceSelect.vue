<script setup lang="ts">
import { computed } from 'vue'

type DeviceOption = {
  id?: string | number
  code?: string
  name: string
  color?: string | null
  active?: boolean
}

const props = defineProps<{
  modelValue: string | null
  items: DeviceOption[]
  valueKey?: 'id' | 'code'
  label?: string
  placeholder?: string
  maxWidthPx?: number
  density?: 'comfortable' | 'compact' | 'default'
  chipSelection?: boolean
  disabled?: boolean
  clearable?: boolean
  showInactive?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: string | null): void
  (e: 'create-device'): void
}>()

const valueKey = computed(() => props.valueKey ?? 'id')
const density = computed(() => props.density ?? 'comfortable')
const clearable = computed(() => props.clearable ?? true)
const chipSelection = computed(() => props.chipSelection ?? true)
// Filter out inactive devices unless showInactive is true
const computedItems = computed<DeviceOption[]>(() => {
  const all = props.items || []
  if (props.showInactive) return all
  return all.filter(d => d.active !== false)
})

// Always produce a STRING value for item comparison to avoid id:number vs modelValue:string mismatch
function getItemValue(item: DeviceOption): string {
  const raw = valueKey.value === 'code' ? item.code : item.id
  return raw != null ? String(raw) : ''
}

// Filter by id/code and name (case-insensitive)
function deviceFilterFn(item: DeviceOption, queryText: string): boolean {
  const q = (queryText || '').toLowerCase()
  const raw = valueKey.value === 'code' ? item.code : item.id
  const codeOrId = (raw != null ? String(raw) : '').toLowerCase()
  const name = (item.name || '').toLowerCase()
  return codeOrId.includes(q) || name.includes(q)
}

function onUpdate(val: unknown): void {
  const v = typeof val === 'string' ? val : (val == null ? null : String(val))
  emits('update:modelValue', v)
}
</script>

<template>
  <v-autocomplete
    :model-value="modelValue"
    :items="computedItems"
    item-title="name"
    :item-value="getItemValue"
    :label="label || 'Přístroj'"
    :placeholder="placeholder || 'Vyberte přístroj...'"
    :density="density"
    variant="outlined"
    hide-details="auto"
    :filter="deviceFilterFn"
    :disabled="disabled"
    clearable
    clear-on-select
    autocomplete="off"
    :style="maxWidthPx ? { maxWidth: maxWidthPx + 'px' } : undefined"
    @update:model-value="onUpdate"
  >
    <template
      v-if="chipSelection && modelValue"
      #selection="{ item }"
    >
      <div class="d-flex align-center" style="gap:8px;">
        <v-chip
          size="small"
          :color="item.raw?.color || 'primary'"
          variant="flat"
          text-color="white"
        >
          {{ (valueKey === 'code' ? (item.raw?.code || String(item.raw?.id ?? '')) : (String(item.raw?.id ?? item.raw?.code ?? ''))) }}
        </v-chip>
        <span class="text-body-2">{{ item.raw?.name }}</span>
      </div>
    </template>

    <template #item="{ item, props: liProps }">
      <v-list-item v-bind="{ ...liProps, title: undefined }">
        <template #prepend>
          <v-chip
            size="small"
            :color="item.raw?.color || 'primary'"
            variant="flat"
            class="mr-2"
          >
            {{ (valueKey === 'code' ? (item.raw?.code || String(item.raw?.id ?? '')) : (String(item.raw?.id ?? item.raw?.code ?? ''))) }}
          </v-chip>
        </template>
        <v-list-item-title>{{ item.raw?.name }}</v-list-item-title>
      </v-list-item>
    </template>

    <!-- Create new device action at the bottom -->
    <template #append-item>
      <v-divider class="my-1" />
      <v-list-item
        class="text-primary"
        prepend-icon="mdi-plus"
        @click="emits('create-device')"
      >
        <v-list-item-title>Vytvořit nový přístroj</v-list-item-title>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>
