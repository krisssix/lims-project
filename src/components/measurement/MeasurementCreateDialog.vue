<script setup lang="ts">
import Dialog from '@/components/Dialog.vue'
import type { DeviceItem, TemplateItem } from '@/stores/measurement'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  devices: DeviceItem[]
  templates: TemplateItem[]
}>()

const isOpen = defineModel<boolean>('isOpen', { default: false })
const step = defineModel<1 | 2>('step', { default: 1 })
const selectedDevice = defineModel<string>('selectedDevice', { default: '' })
const selectedTemplateId = defineModel<string | null>('selectedTemplateId', { default: null })

const emit = defineEmits<{
  (e: 'create-template'): void
  (e: 'save', payload: { templateId: string, valuesRows: Array<{ order: number; name: string; type: any; required: boolean; value: any }> }): void
}>()

watch(isOpen, (open) => {
  if (open) {
    step.value = 1
    if (props.devices.length) selectedDevice.value = props.devices[0].id
    selectedTemplateId.value = null
    valuesRows.value = []
  }
})

const availableTemplates = computed(() =>
  props.templates.filter(t => !selectedDevice.value || t.deviceId === selectedDevice.value)
)

function goToStep2() {
  if (!selectedTemplateId.value) return
  const tpl = props.templates.find(t => t.id === selectedTemplateId.value)
  valuesRows.value = (tpl?.fields ?? []).map((f, i) => ({
    order: i + 1,
    name: f.name,
    type: f.type,
    required: f.required,
    value: f.type === 'file' ? null : ''
  }))
  step.value = 2
}

/* Step-2 data */
const valuesRows = ref<Array<{ order: number; name: string; type: any; required: boolean; value: any }>>([])
const canSave = computed(() => valuesRows.value.every(v => !v.required || (v.value !== null && String(v.value).trim().length > 0)))

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    const parts = text.split(/[\s,;]+/).filter(Boolean)
    let idx = 0
    for (let i = 0; i < valuesRows.value.length && idx < parts.length; i++) {
      if (valuesRows.value[i].type === 'file') continue
      const raw = parts[idx++]
      const num = Number(raw)
      valuesRows.value[i].value = Number.isFinite(num) ? num : raw
    }
  } catch {}
}

function onSave() {
  if (!selectedTemplateId.value) return
  emit('save', { templateId: selectedTemplateId.value, valuesRows: valuesRows.value })
}
</script>

<template>
  <Dialog v-model:is-open="isOpen" :hide-footer="false" width="920px" class="measurement-create-dialog">
    <template #header>
      <div class="text-h6">Vytvoření nového měření</div>
    </template>

    <template v-if="step === 1" #content>
      <div class="text-subtitle-2 mb-2">Metadata</div>
      <v-row class="g-4 mb-1">
        <v-col cols="12" md="6">
          <v-select
            v-model="selectedDevice"
            :items="props.devices"
            item-title="name"
            item-value="id"
            label="Přístroj"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          >
            <template #selection="{ item }">
              <v-chip size="small" :color="item.raw.color" text-color="white">{{ item.raw.id }}</v-chip>
            </template>
          </v-select>
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="selectedTemplateId"
            :items="availableTemplates"
            item-title="name"
            item-value="id"
            label="Šablona měření"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            clearable
          />
        </v-col>
      </v-row>

      <div class="mt-2">
        <v-alert type="info" variant="tonal" density="comfortable">
          Nemáte k dispozici potřebnou šablonu?
          <v-btn variant="text" color="primary" class="ml-1 px-1" @click="$emit('create-template')">
            Vytvořte si ji.
          </v-btn>
        </v-alert>
      </div>
    </template>

    <template v-else #content>
      <div class="text-subtitle-2 mb-3">Primární data</div>
      <div class="d-flex ga-2 mb-3">
        <v-btn size="small" color="primary" variant="tonal" @click="pasteFromClipboard">VLOŽIT ZE SCHRÁNKY (Ctrl+V)</v-btn>
        <v-btn size="small" variant="tonal" @click="valuesRows.push({ order: valuesRows.length + 1, name: '', type: 'float', required: false, value: '' })">
          PŘIDAT POLE (Ctrl+Enter)
        </v-btn>
      </div>

      <v-data-table
        :items="valuesRows"
        :headers="[
          { title: 'Poř.č.', key: 'order', width: 80 },
          { title: 'Název pole', key: 'name' },
          { title: 'Vstupní prvek', key: 'value', sortable: false },
        ]"
        item-key="order"
        hide-default-footer
        class="elevation-1"
        density="comfortable"
      >
        <template #item.name="{ item }">
          <div class="d-inline-flex align-center" style="gap: 8px">
            <span>{{ item.name }}</span>
            <v-chip size="x-small" color="blue-lighten-4" text-color="primary" class="text-caption">{{ item.type }}</v-chip>
          </div>
        </template>
        <template #item.value="{ item }">
          <div v-if="item.type === 'file'" class="d-flex align-center" style="gap: 8px">
            <v-file-input density="comfortable" hide-details variant="outlined" accept="image/*,.csv,.txt" v-model="item.value" />
          </div>
          <v-text-field
            v-else
            :model-value="item.value"
            @update:model-value="val => item.value = val"
            :placeholder="item.required ? 'Zadejte hodnotu...' : 'Volitelné...'"
            variant="outlined"
            density="comfortable"
            hide-details
          />
        </template>
      </v-data-table>
    </template>

    <template #footer>
      <v-btn variant="text" @click="isOpen = false">Zrušit</v-btn>
      <v-spacer />
      <v-btn v-if="step === 1" color="primary" :disabled="!selectedTemplateId" @click="goToStep2">Pokračovat</v-btn>
      <v-btn v-else color="primary" :disabled="!canSave" @click="onSave">Uložit</v-btn>
    </template>
  </Dialog>
</template>
