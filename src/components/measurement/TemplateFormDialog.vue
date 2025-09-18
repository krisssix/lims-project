<script setup lang="ts">
import Dialog from '@/components/Dialog.vue'
import type { DeviceItem, TemplateItem, FieldRow } from '@/stores/measurement'
import type { MeasurementTemplateRequest } from '@/stores/measurement-templates'
import { computed, watch, ref } from 'vue'

const props = defineProps<{
  devices: DeviceItem[]
  mode: 'create' | 'edit'
  initial: TemplateItem | null
}>()

const isOpen = defineModel<boolean>('isOpen', { default: false })
const emit = defineEmits<{
  (e: 'save', payload: MeasurementTemplateRequest, id?: string | number | null): void
  (e: 'cancel'): void
}>()

const formName = ref<string>('')

// default device
const selectedDeviceId = ref<string>('')

watch(() => props.devices, (list) => {
  if (!selectedDeviceId.value && list.length) selectedDeviceId.value = list[0].id
}, { immediate: true })

const fields = ref<FieldRow[]>([])
const fieldTypeOptions = [
  { label: 'Float', value: 'float' },
  { label: 'Integer', value: 'int' },
  { label: 'Text', value: 'text' },
  { label: 'Soubor', value: 'file' },
  { label: 'Boolean', value: 'bool' },
  { label: 'Date', value: 'date' },
]
const isValid = computed(() => !!formName.value.trim() && fields.value.length > 0 && fields.value.every(f => !!f.name.trim()))

watch(isOpen, (open) => {
  if (!open) return
  if (props.mode === 'edit' && props.initial) {
    formName.value = props.initial.name
    selectedDeviceId.value = props.initial.deviceId
    fields.value = props.initial.fields.map(f => ({ ...f }))
  } else {
    formName.value = ''
    selectedDeviceId.value = props.devices[0]?.id ?? ''
    fields.value = [{ id: `f-${Date.now()}`, type: 'float', required: true, name: 'Replika_1' }]
  }
}, { immediate: true })

function addField() {
  fields.value.push({ id: `f-${Date.now()}-${Math.floor(Math.random()*1000)}`, type: 'float', required: false, name: '' })
}
function removeField(idx: number) { fields.value.splice(idx, 1) }

function onSave() {
  const payload: MeasurementTemplateRequest = {
    name: formName.value.trim(),
    deviceCode: selectedDeviceId.value,
    fields: fields.value.map((f, i) => ({
      orderIndex: i + 1,
      type: f.type,
      required: !!f.required,
      name: f.name.trim()
    }))
  }
  emit('save', payload, props.initial?.id ?? null)
}
</script>

<template>
  <Dialog v-model:is-open="isOpen" :hide-footer="false" width="920px" class="template-form-dialog">
    <template #header>
      <div class="text-h6">{{ props.mode === 'create' ? 'Vytvoření šablony' : 'Editace šablony' }}</div>
    </template>
    <template #content>
      <v-row class="g-4 mb-1">
        <v-col cols="12" md="6">
          <v-text-field v-model="formName" label="Název šablony" variant="outlined" density="comfortable" hide-details="auto" />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="selectedDeviceId"
            :items="props.devices"
            item-title="name"
            item-value="id"
            label="Přístroj"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          >
            <template #selection="{ item }">
              <v-chip size="small" :color="item.raw.color" text-color="white" class="ma-0">{{ item.raw.name }}</v-chip>
            </template>
          </v-select>
        </v-col>
      </v-row>

      <div class="section-title">Zaznamenávané hodnoty</div>
      <v-data-table
        :items="fields"
        :headers="[
          { title: 'Typ', key: 'type', sortable: false },
          { title: 'Povinné', key: 'required', sortable: false, width: 120 },
          { title: 'Název pole', key: 'name', sortable: false },
          { title: '', key: 'actions', sortable: false, width: 60 },
        ]"
        class="elevation-1"
        density="comfortable"
        hide-default-footer
      >
        <template #item.type="{ item }">
          <v-select v-model="item.type" :items="fieldTypeOptions" item-title="label" item-value="value" hide-details density="compact" variant="plain" />
        </template>
        <template #item.required="{ item }">
          <v-checkbox v-model="item.required" hide-details density="compact" />
        </template>
        <template #item.name="{ item }">
          <v-text-field v-model="item.name" hide-details density="compact" variant="plain" />
        </template>
        <template #item.actions="{ index }">
          <v-btn icon="mdi-delete-outline" color="error" size="x-small" variant="text" @click="removeField(index)" />
        </template>
      </v-data-table>

      <div class="mt-3">
        <v-btn size="small" color="primary" variant="tonal" @click="addField">PŘIDAT NOVÉ POLE (Ctrl+Enter)</v-btn>
      </div>
    </template>
    <template #footer>
      <v-spacer />
      <v-btn variant="text" @click="$emit('cancel')">Zrušit</v-btn>
      <v-btn color="primary" :disabled="!isValid" @click="onSave">Uložit</v-btn>
    </template>
  </Dialog>
</template>
