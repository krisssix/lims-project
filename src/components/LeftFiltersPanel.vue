<script setup lang="ts">
import { computed } from 'vue'

type Dict = Record<string, unknown>
type Value = string | number | boolean

type GroupConfig = {
  key: string
  title: string
  label?: string
  items: Dict[]                           // array of objects
  itemTitle?: string                      // default 'name'
  itemValue?: string                      // default 'id'
  type?: 'plain' | 'devices'              // 'devices' renders colored chips
  colorKey?: string                       // default 'color' (for type 'devices')
  showField?: string                      // which field to show on chip, default itemValue
}

const props = defineProps<{
  date: string | Date | null
  groups: GroupConfig[]
  selection: Record<string, Value[]>       // e.g. { devices: [], templates: [] }
}>()

const emit = defineEmits<{
  (e: 'update:date', v: string | Date | null): void
  (e: 'update:selection', v: Record<string, Value[]>): void
}>()

const localDate = computed({
  get: () => props.date,
  set: v => emit('update:date', v),
})

function toValue(x: unknown): Value | null {
  if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') return x
  return null
}

/**
 * Update selection for a single group and emit the whole selection object.
 */
function updateSelection(groupKey: string, val: Value[] | null | undefined) {
  const next = { ...props.selection, [groupKey]: Array.isArray(val) ? val : [] }
  emit('update:selection', next)
}

/* Safe getters working with unknown raw objects (avoid TS casts in template) */
function valueFromRaw(raw: unknown, cfg: GroupConfig): Value | null {
  if (!raw || typeof raw !== 'object') return null
  const key = cfg.itemValue || 'id'
  // index access on a generic record
  const v = (raw as Dict)[key]
  return toValue(v)
}

function colorOf(raw: unknown, cfg: GroupConfig): string {
  if (!raw || typeof raw !== 'object') return 'primary'
  const key = cfg.colorKey || 'color'
  const v = (raw as Dict)[key]
  return typeof v === 'string' && v.length ? v : 'primary'
}

function displayOf(raw: unknown, cfg: GroupConfig): string {
  if (!raw || typeof raw !== 'object') return ''
  const key = cfg.showField || cfg.itemValue || 'id'
  const v = (raw as Dict)[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function allValuesFor(cfg: GroupConfig): Value[] {
  return cfg.items.map(it => valueFromRaw(it, cfg)).filter((v): v is Value => v != null)
}

function selectAll(groupKey: string) {
  const cfg = props.groups.find(g => g.key === groupKey)
  if (!cfg) return
  updateSelection(groupKey, allValuesFor(cfg))
}
function clear(groupKey: string) {
  updateSelection(groupKey, [])
}

/* Handler used by the chip close icon in the selection slot */
function onCloseChip(cfg: GroupConfig, raw: unknown) {
  const current = props.selection[cfg.key] ?? []
  const val = valueFromRaw(raw, cfg)
  const next = val == null ? current : current.filter(v => v !== val)
  updateSelection(cfg.key, next)
}

defineExpose({
  selectAll,
  clear,
})
</script>

<template>
  <v-col
    cols="12"
    md="3"
    class="left-panel"
  >
    <v-sheet
      elevation="1"
      class="pa-4"
    >
      <v-date-picker
        v-model="localDate"
        color="primary"
        hide-header
        show-adjacent-months
        :first-day-of-week="1"
      />
    </v-sheet>

    <v-sheet
      elevation="1"
      class="pa-4 mt-4"
    >
      <template
        v-for="cfg in groups"
        :key="cfg.key"
      >
        <div class="filter-title">
          <div class="title">
            {{ cfg.title }}
          </div>
          <div class="actions">
            <button
              class="link-action"
              @click="selectAll(cfg.key)"
            >
              Vybrat vše
            </button>
            <button
              class="link-action"
              @click="clear(cfg.key)"
            >
              Zrušit výběr
            </button>
          </div>
        </div>

        <v-select
          :model-value="selection[cfg.key] ?? []"
          :items="cfg.items"
          :item-title="cfg.itemTitle || 'name'"
          :item-value="cfg.itemValue || 'id'"
          :label="cfg.label || cfg.title"
          multiple
          chips
          closable-chips
          clearable
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          class="chip-select mb-4"
          @update:model-value="val => updateSelection(cfg.key, val as Value[])"
        >
          <!-- Colored chips for device-type groups -->
          <template
            v-if="cfg.type === 'devices'"
            #selection="{ item }"
          >
            <v-chip
              size="large"
              rounded="lg"
              closable
              :color="colorOf(item.raw, cfg)"
              class="device-chip"
              text-color="white"
              @click:close="onCloseChip(cfg, item.raw)"
            >
              {{ displayOf(item.raw, cfg) }}
            </v-chip>
          </template>
        </v-select>
      </template>
    </v-sheet>
  </v-col>
</template>

<style scoped>
/* ---------- Filter headers ---------- */
.filter-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 2px 2px 6px 2px;
}
.filter-title .title {
  font-weight: 700;
}
.filter-title .actions {
  display: inline-flex;
  gap: 14px;
}
.link-action {
  background: none;
  border: 0;
  color: #1976d2;
  font-size: 0.86rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
}
.link-action:hover {
  text-decoration: underline;
}

/* ---------- Chip selects ---------- */
.chip-select :deep(.v-field) {
  border-radius: 10px;
}
.device-chip {
  font-weight: 700;
  border-radius: 999px;
  color: #fff;
}

.left-panel {
  flex: 0 0 360px;
  max-width: 360px;
}

.left-panel :deep(.v-date-picker) {
  width: 100%;
}
</style>
