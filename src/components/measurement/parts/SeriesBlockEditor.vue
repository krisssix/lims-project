<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TemplateBlockRow } from '@/types/measurement-ui'

export interface SeriesRow {
  id: number
  x: number | string
  y: number | string
}

export interface SeriesBlockData {
  blockIndex: number
  name: string
  date: string
  description: string
  rows: SeriesRow[]
}

const props = defineProps<{
  block: TemplateBlockRow
  data: SeriesBlockData
  recordIndex: number
}>()

const emits = defineEmits<{
  (e: 'update:data', val: SeriesBlockData): void
}>()

const nextRowId = ref(1)

// Get X and Y column names from block fields
const xColumnName = computed(() => props.block.fields?.[0]?.name || 'X')
const yColumnName = computed(() => props.block.fields?.[1]?.name || 'Y')

function updateField(field: keyof SeriesBlockData, value: string): void {
  emits('update:data', { ...props.data, [field]: value })
}

function updateRowValue(rowIndex: number, axis: 'x' | 'y', value: string): void {
  const newRows = [...props.data.rows]
  const numVal = parseFloat(value.replace(',', '.'))
  newRows[rowIndex] = {
    ...newRows[rowIndex],
    [axis]: isNaN(numVal) ? value : numVal
  }
  emits('update:data', { ...props.data, rows: newRows })
}

function addRow(): void {
  const lastRow = props.data.rows[props.data.rows.length - 1]
  const newX = typeof lastRow?.x === 'number' ? lastRow.x + 1 : 0
  const newRows = [...props.data.rows, { id: nextRowId.value++, x: newX, y: 0 }]
  emits('update:data', { ...props.data, rows: newRows })
}

function removeRow(index: number): void {
  const newRows = props.data.rows.filter((_, i) => i !== index)
  emits('update:data', { ...props.data, rows: newRows })
}
</script>

<template>
  <v-card
    class="series-block-card mb-4"
    variant="outlined"
  >
    <v-card-title class="d-flex align-center justify-space-between py-2 px-4">
      <div
        class="d-flex align-center"
        style="gap: 8px;"
      >
        <v-icon
          size="20"
          color="primary"
        >
          mdi-chart-line
        </v-icon>
        <span class="text-subtitle-1 font-weight-medium">{{ block.title }}</span>
        <v-chip
          size="small"
          variant="tonal"
          color="primary"
        >
          Record {{ recordIndex }}
        </v-chip>
      </div>
      <span class="text-caption text-medium-emphasis">
        {{ data.rows.length }} polí
      </span>
    </v-card-title>

    <v-divider />

    <v-card-text class="pa-4">
      <!-- Metadata row -->
      <div
        class="d-flex flex-wrap mb-4"
        style="gap: 12px;"
      >
        <v-text-field
          :model-value="data.name"
          label="Název záznamu"
          density="compact"
          variant="outlined"
          hide-details
          style="flex: 1; min-width: 150px; max-width: 200px;"
          @update:model-value="v => updateField('name', v)"
        />
        <v-text-field
          :model-value="data.date"
          label="Datum"
          type="date"
          density="compact"
          variant="outlined"
          hide-details
          style="width: 160px;"
          @update:model-value="v => updateField('date', v)"
        />
        <v-text-field
          :model-value="data.description"
          label="Popis"
          density="compact"
          variant="outlined"
          hide-details
          style="flex: 2; min-width: 200px;"
          @update:model-value="v => updateField('description', v)"
        />
      </div>

      <!-- Data table -->
      <div class="series-table-wrapper">
        <v-table
          density="compact"
          class="series-table"
        >
          <thead>
            <tr>
              <th
                class="text-left"
                style="width: 60px;"
              >
                #
              </th>
              <th class="text-left">
                {{ xColumnName }}
              </th>
              <th class="text-left">
                {{ yColumnName }}
              </th>
              <th style="width: 50px;" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, idx) in data.rows"
              :key="row.id"
            >
              <td class="text-caption text-medium-emphasis">
                {{ idx + 1 }}
              </td>
              <td>
                <input
                  type="text"
                  :value="row.x"
                  class="inline-edit"
                  @blur="e => updateRowValue(idx, 'x', (e.target as HTMLInputElement).value)"
                  @keydown.enter="e => (e.target as HTMLInputElement).blur()"
                >
              </td>
              <td>
                <input
                  type="text"
                  :value="row.y"
                  class="inline-edit"
                  @blur="e => updateRowValue(idx, 'y', (e.target as HTMLInputElement).value)"
                  @keydown.enter="e => (e.target as HTMLInputElement).blur()"
                >
              </td>
              <td>
                <v-btn
                  size="small"
                  variant="text"
                  icon="mdi-delete-outline"
                  color="error"
                  @click="removeRow(idx)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <!-- Add row button -->
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-plus"
        class="mt-2"
        @click="addRow"
      >
        Přidat řádek
      </v-btn>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.series-block-card {
  border-color: rgba(var(--v-theme-primary), 0.3);
}

.series-table-wrapper {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}

.series-table {
  font-size: 0.875rem;
}

.inline-edit {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  font-size: 0.875rem;
  outline: none;
  transition: all 0.15s;
}

.inline-edit:hover {
  background: rgba(var(--v-theme-primary), 0.05);
}

.inline-edit:focus {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
