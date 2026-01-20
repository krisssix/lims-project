<script setup lang="ts">
/**
 * FilterMultiSelect - Kompaktní multiselect filtr pro toolbar
 * - Dropdown s checkboxy
 * - Chipy pro barevné položky
 * - Okamžité filtrování
 */
import { ref, computed } from 'vue'

interface SelectItem {
  [key: string]: unknown
}

const props = withDefaults(defineProps<{
  modelValue: string[]
  items: SelectItem[]
  label: string
  itemTitle?: string
  itemValue?: string
  color?: string
  allLabel?: string
  icon?: string
}>(), {
  itemTitle: 'name',
  itemValue: 'id',
  color: 'primary',
  allLabel: 'Vše',
  icon: undefined
})

const emits = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const menuOpen = ref(false)

const searchQuery = ref('')

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter(i => String(i[props.itemTitle]).toLowerCase().includes(q))
})

const selectedSet = computed(() => new Set(props.modelValue))

const allSelected = computed(() => 
  props.items.length > 0 && props.modelValue.length === props.items.length
)

const noneSelected = computed(() => props.modelValue.length === 0)

const displayLabel = computed(() => {
  if (noneSelected.value || allSelected.value) {
    return props.allLabel
  }
  if (props.modelValue.length === 1) {
    const item = props.items.find(i => String(i[props.itemValue]) === props.modelValue[0])
    return item ? String(item[props.itemTitle]) : props.modelValue[0]
  }
  return `${props.modelValue.length} vybráno`
})

function toggleItem(itemValue: string) {
  const current = new Set(props.modelValue)
  if (current.has(itemValue)) {
    current.delete(itemValue)
  } else {
    current.add(itemValue)
  }
  emits('update:modelValue', Array.from(current))
}

function selectAll() {
  // Select all VISIBLE items in search
  const current = new Set(props.modelValue)
  for (const item of filteredItems.value) {
    current.add(String(item[props.itemValue]))
  }
  emits('update:modelValue', Array.from(current))
}

function clearAll() {
  // Clear all (if search is active, maybe clear only visible? Usually "Clear all" means clear selection)
  // But let's stick to "Zrušit výběr" clearing everything.
  emits('update:modelValue', [])
}

function getItemValue(item: SelectItem): string {
  return String(item[props.itemValue])
}

function getItemTitle(item: SelectItem): string {
  return String(item[props.itemTitle])
}

function getItemColor(item: SelectItem): string | undefined {
  return item.color ? String(item.color) : undefined
}
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="bottom start"
    offset="4"
  >
    <template #activator="{ props: menuProps }">
      <slot
        name="activator"
        :props="menuProps"
      >
        <button
          v-bind="menuProps"
          :class="['btn-secondary', 'filter-btn', { 'filter-active': props.modelValue.length > 0 && !allSelected }]"
        >
          <v-icon
            v-if="icon"
            :icon="icon"
            size="18"
          />
          <span class="filter-label">{{ label }}:</span>
          <span class="filter-value">{{ displayLabel }}</span>
          <v-icon
            icon="mdi-menu-down"
            size="20"
          />
        </button>
      </slot>
    </template>

    <v-card
      min-width="260"
      max-width="340"
      elevation="3"
      class="rounded-lg mt-1 border"
    >
      <!-- Search -->
      <div class="pa-2 pb-0">
        <v-text-field
          v-model="searchQuery"
          placeholder="Hledat..."
          variant="outlined"
          density="compact"
          hide-details
          prepend-inner-icon="mdi-magnify"
          class="mb-2"
          bg-color="white"
        />
      </div>

      <!-- Actions -->
      <div class="d-flex justify-space-between align-center px-2 pb-2 border-b">
        <button
          type="button"
          class="btn-tertiary"
          @click="selectAll"
        >
          Vybrat {{ searchQuery ? 'filtrované' : 'vše' }}
        </button>
        <button
          type="button"
          class="btn-tertiary"
          :disabled="noneSelected"
          @click="clearAll"
        >
          Zrušit výběr
        </button>
      </div>

      <!-- Items list -->
      <v-list
        density="compact"
        class="filter-list py-1"
        lines="one"
        select-strategy="leaf"
      >
        <v-list-item
          v-for="item in filteredItems"
          :key="getItemValue(item)"
          :value="getItemValue(item)"
          ripple
          class="px-2"
          :active="false"
          @click="toggleItem(getItemValue(item))"
        >
          <template #prepend>
            <div class="mr-2 d-flex align-center">
              <v-checkbox-btn
                :model-value="selectedSet.has(getItemValue(item))"
                color="primary"
                density="compact"
                hide-details
              />
            </div>
          </template>
          
          <v-list-item-title class="d-flex align-center">
            <!-- Chip for items with color (Devices) -->
            <v-chip
              v-if="getItemColor(item)"
              size="small"
              :color="getItemColor(item)"
              variant="flat"
              class="font-weight-bold px-2"
              label
              style="height: 24px;"
            >
              {{ getItemTitle(item) }}
            </v-chip>
            <!-- Plain text for others (Members) -->
            <span
              v-else
              class="text-body-2 font-weight-medium"
            >{{ getItemTitle(item) }}</span>
          </v-list-item-title>
        </v-list-item>
        <div
          v-if="filteredItems.length === 0"
          class="text-center text-caption py-4 text-grey"
        >
          Žádné výsledky
        </div>
      </v-list>
    </v-card>
  </v-menu>
</template>

<style scoped>
/* Filter button specifics (extends btn-secondary) */
.filter-btn {
  gap: 6px;
  padding: 0 14px;
  font-size: 13px;
}

.filter-label {
  color: #64748b;
  font-weight: 400;
}

.filter-value {
  font-weight: 600;
  color: #1e293b;
}

.filter-active {
  border: 2px solid #3b82f6 !important;
  background: #eff6ff !important;
}

.filter-active .filter-value {
  color: #1d4ed8;
}

.filter-list {
  max-height: 350px;
  overflow-y: auto;
}
</style>
