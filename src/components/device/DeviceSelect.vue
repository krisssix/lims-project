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
// filtrování neaktivních přístrojů, pokud není povoleno jejich zobrazení (filter out inactive)
const computedItems = computed<DeviceOption[]>(() => {
  const all = props.items || []
  if (props.showInactive) return all
  return all.filter(d => d.active !== false)
})

// vždy vrací řetězec pro porovnání položek, aby se předešlo neshodě typů (string value)
function getItemValue(item: DeviceOption): string {
  const raw = valueKey.value === 'code' ? item.code : item.id
  return raw != null ? String(raw) : ''
}

// filtrování podle id/kódu a názvu: nezáleží na velikosti písmen (filter case-insensitive)
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
    :item-title="(item) => (valueKey === 'code' ? (item.code || String(item.id ?? '')) : String(item.id ?? item.code ?? ''))"
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
    :chips="chipSelection"
    @update:model-value="onUpdate"
  >
    <template v-slot:selection="{ item }">
      <div class="d-flex align-center" style="gap:8px; overflow: hidden;">
        <v-chip
          size="small"
          :color="item.raw?.color || 'primary'"
          variant="flat"
          text-color="white"
          class="flex-shrink-0"
        >
          {{ (valueKey === 'code' ? (item.raw?.code || String(item.raw?.id ?? '')) : (String(item.raw?.id ?? item.raw?.code ?? ''))) }}
        </v-chip>
        <span class="text-body-2 text-truncate">{{ item.raw?.name }}</span>
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

    <!-- akce pro vytvoření nového přístroje úplně dole (create item) -->
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

<style scoped>
/* Zvýšení viditelnosti při disabled stavu (Increase visibility when disabled) */
:deep(.v-input--disabled) {
  opacity: 0.9 !important;
  pointer-events: none;
}
:deep(.v-field--disabled) {
  opacity: 0.9 !important;
}
:deep(.v-input--disabled .v-input__control) {
  opacity: 1 !important;
}
:deep(.v-field--disabled .v-field__outline) {
  opacity: 0.4 !important; /* Outline still dimmer */
}
/* Ensure the chip and text inside retain high opacity */
:deep(.v-input--disabled .v-chip),
:deep(.v-input--disabled .v-select__selection-text) {
  opacity: 1 !important;
  color: rgba(0, 0, 0, 0.87) !important;
}
</style>
