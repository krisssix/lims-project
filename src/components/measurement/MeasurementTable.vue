<script setup lang="ts">
import { computed } from 'vue'
import { type DeviceItem } from '@/types/measurement-ui'

type TableHeader = { title: string; key: string; width?: number; align?: 'start'|'center'|'end'; sortable?: boolean }
type TableRow = {
  id: number
  type: string
  device: string
  user?: string
  date: string
  count: number
  note?: string | null
  _raw?: unknown
}

const props = defineProps<{
  headers: TableHeader[]
  items: TableRow[]
  devicesById: Map<string, DeviceItem>
}>()

const emits = defineEmits<{
  (e: 'row-click', id: number): void
}>()

function onRowClick(_ev: MouseEvent, payload: { item: TableRow }) {
  if (!payload?.item) return
  const id = payload.item.id
  if (Number.isFinite(id)) emits('row-click', id)
}

function initials(u?: string | null): string {
  const s = (u ?? '').trim()
  return s.length ? s[0]!.toUpperCase() : '—'
}

const hasNotes = computed<boolean>(() =>
  props.items.some(i => typeof i.note === 'string' && i.note.trim().length > 0)
)
</script>

<template>
  <v-data-table
    :headers="props.headers"
    :items="props.items"
    :items-per-page="10"
    class="v-data-table elevation-1 pretty-table"
    density="comfortable"
    hover
    :show-expand="hasNotes"
    :expand-on-click="false"
    @click:row="onRowClick"
  >
    <!-- device chip -->
    <template #[`item.device`]="{ item }">
      <v-chip
        :color="props.devicesById.get(item.device)?.color || 'primary'"
        text-color="white"
        size="small"
        variant="flat"
        class="font-weight-bold"
      >
        {{ item.device || '—' }}
      </v-chip>
    </template>

    <!-- user column -->
    <template #[`item.user`]="{ item }">
      <div class="d-inline-flex align-center ga-2">
        <v-avatar
          size="20"
          class="elevation-0"
          color="grey-lighten-3"
        >
          <span class="text-caption">{{ initials(item.user) }}</span>
        </v-avatar>
        <span class="text-body-2">{{ item.user || '—' }}</span>
      </div>
    </template>

    <!-- expanded row with note -->
    <template #expanded-row="{ columns, item }">
      <td
        :colspan="columns.length"
        class="pa-3"
      >
        <div
          v-if="item.note && item.note.trim().length"
          class="d-flex align-start ga-2"
        >
          <v-icon
            size="16"
            color="grey-darken-1"
          >
            mdi-text
          </v-icon>
          <div class="text-body-2">
            {{ item.note }}
          </div>
        </div>
        <div
          v-else
          class="text-medium-emphasis"
        >
          Žádná poznámka
        </div>
      </td>
    </template>

    <template #no-data>
      <div class="pa-6 text-medium-emphasis text-center">
        Žádná měření pro zadané filtry.
      </div>
    </template>
  </v-data-table>
</template>
