<script setup lang="ts">
import Dialog from '@/components/Dialog.vue'
import type { DeviceItem } from '@/stores/measurement'

const props = defineProps<{
  item: any | null
  devices: DeviceItem[]
}>()

const isOpen = defineModel<boolean>('isOpen', { default: false })

const emit = defineEmits<{
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'delete'): void
  (e: 'close'): void
}>()

function toDisplayRows(item: any) {
  const list = (item?.values && item.values.length ? item.values : [{
    orderIndex: 1,
    name: 'Hodnota',
    type: 'float',
    numberValue: item?.value
  }]) as any[]
  return list.map(v => {
    let value = ''
    if (v.numberValue !== undefined && v.numberValue !== null) value = String(v.numberValue)
    else if (v.textValue) value = v.textValue
    else if (typeof v.boolValue === 'boolean') value = v.boolValue ? 'true' : 'false'
    else if (v.dateValue) value = new Date(v.dateValue).toLocaleString()
    else if (v.fileUrl) value = v.fileUrl
    return { order: v.orderIndex, name: v.name, type: v.type, value }
  })
}
</script>

<template>
  <Dialog v-model:is-open="isOpen" :hide-footer="false" width="920px">
    <template #header>
      <div class="d-flex align-center justify-space-between">
        <div class="text-h6">Detail měření</div>
        <div class="d-flex align-center" style="gap: 8px">
          <v-btn icon="mdi-chevron-left" variant="text" @click="$emit('prev')" />
          <v-btn icon="mdi-chevron-right" variant="text" @click="$emit('next')" />
        </div>
      </div>
    </template>
    <template #content>
      <v-row class="g-4 mb-1">
        <v-col cols="12" md="6">
          <v-text-field :model-value="props.item?.type" label="Šablona" variant="outlined" density="comfortable" readonly />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            :model-value="props.item?.unit"
            :items="props.devices"
            item-title="name"
            item-value="id"
            label="Přístroj"
            variant="outlined"
            density="comfortable"
            readonly
          >
            <template #selection="{ item }">
              <v-chip size="small" :color="item.raw.color" text-color="white">{{ item.raw.id }}</v-chip>
            </template>
          </v-select>
        </v-col>
      </v-row>

      <div class="text-subtitle-2">Naměřené hodnoty</div>
      <v-data-table
        :items="toDisplayRows(props.item)"
        :headers="[
          { title: 'Poř.č.', key: 'order', width: 80 },
          { title: 'Název pole', key: 'name' },
          { title: 'Typ', key: 'type', width: 140 },
          { title: 'Hodnota', key: 'value' },
        ]"
        density="comfortable"
        hide-default-footer
        class="elevation-1 mt-2"
      />
    </template>
    <template #footer>
      <v-btn color="error" variant="outlined" prepend-icon="mdi-delete-outline" @click="$emit('delete')">Smazat</v-btn>
      <v-spacer />
      <v-btn variant="text" @click="$emit('close')">Zavřít</v-btn>
    </template>
  </Dialog>
</template>
