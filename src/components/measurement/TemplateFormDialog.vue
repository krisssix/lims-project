<script setup lang="ts">
import Dialog from '@/components/Dialog.vue'
import { computed, ref, watch } from 'vue'
import { type DeviceItem, type FieldRow } from '@/types/measurement-ui'
import { type MeasurementTemplateRequest } from '@/stores/measurement-templates'

const props = defineProps<{
  modelValue: boolean
  mode: 'create' | 'edit'
  devices: DeviceItem[]
  initName?: string
  initDeviceId?: string
  initFields?: FieldRow[]
  deleting?: boolean
  allowDelete?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', req: MeasurementTemplateRequest): void
  (e: 'delete'): void
  (e: 'pasteFromClipboard'): void
}>()

const formName = ref<string>(props.initName ?? '')
const selectedDeviceId = ref<string>(props.initDeviceId ?? '')
const fields = ref<FieldRow[]>(props.initFields ? props.initFields.map(f => ({ ...f })) : [])

watch(() => props.initName, v => { if (props.mode === 'edit') formName.value = v ?? '' })
watch(() => props.initDeviceId, v => { if (props.mode === 'edit') selectedDeviceId.value = v ?? '' })
watch(() => props.initFields, v => { if (props.mode === 'edit') fields.value = (v ?? []).map(f => ({ ...f })) })

watch(() => props.devices, (list) => {
  if (!selectedDeviceId.value && list.length) selectedDeviceId.value = list[0].id
}, { immediate: true })

const fieldTypeOptions = [
  { label: 'Float', value: 'float' },
  { label: 'Integer', value: 'int' },
  { label: 'Text', value: 'text' },
  { label: 'Soubor', value: 'file' },
  { label: 'Boolean', value: 'bool' },
  { label: 'Date', value: 'date' },
]
const isValid = computed(() =>
  !!formName.value.trim() &&
  !!selectedDeviceId.value &&
  fields.value.length > 0 &&
  fields.value.every(f => !!f.name.trim())
)
function addField() {
  fields.value.push({ id: `f-${Date.now()}-${Math.floor(Math.random() * 1000)}`, type: 'float', required: false, name: '' })
}
function removeField(idx: number) {
  fields.value.splice(idx, 1)
}
function close() { emits('update:modelValue', false) }
function onSave() {
  const req: MeasurementTemplateRequest = {
    name: formName.value.trim(),
    deviceCode: selectedDeviceId.value,
    fields: fields.value.map((f, i) => ({
      orderIndex: i + 1,
      type: f.type,
      required: Boolean(f.required),
      name: f.name.trim()
    }))
  }
  emits('save', req)
}
</script>

<template>
  <Dialog
    :is-open="props.modelValue"
    width="920px"
    height="808px"
    :hide-footer="false"
    class="template-form-dialog"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div class="text-h6">
        {{ props.mode === 'create' ? 'Vytvoření šablony' : 'Editace šablony' }}
      </div>
    </template>

    <template #content>
      <v-row class="g-4 mb-1">
        <v-col
          cols="12"
          md="6"
        >
          <v-text-field
            v-model="formName"
            label="Název šablony"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          />
        </v-col>
        <v-col
          cols="12"
          md="6"
        >
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
              <v-chip
                size="small"
                :color="item.raw?.color"
                text-color="white"
                class="ma-0"
              >
                {{ item.raw?.name }}
              </v-chip>
            </template>
          </v-select>
        </v-col>
      </v-row>

      <div class="section-title">
        Zaznamenávané hodnoty
      </div>

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
        <!-- bracket slot syntax -> vyhne se chybě „v-slot directive doesn't support any modifier“ -->
        <template #[`item.type`]="{ item }">
          <v-select
            v-model="item.type"
            :items="fieldTypeOptions"
            item-title="label"
            item-value="value"
            hide-details
            density="compact"
            variant="plain"
          />
        </template>

        <template #[`item.required`]="{ item }">
          <v-checkbox
            v-model="item.required"
            hide-details
            density="compact"
          />
        </template>

        <template #[`item.name`]="{ item }">
          <v-text-field
            v-model="item.name"
            hide-details
            density="compact"
            variant="plain"
          />
        </template>

        <template #[`item.actions`]="{ index }">
          <v-btn
            icon="mdi-delete-outline"
            color="error"
            size="x-small"
            variant="text"
            @click="removeField(index)"
          />
        </template>
      </v-data-table>

      <div
        class="mt-3 d-flex"
        style="gap:12px"
      >
        <v-btn
          size="small"
          color="primary"
          variant="tonal"
          @click="addField"
        >
          PŘIDAT NOVÉ POLE (Ctrl+Enter)
        </v-btn>
        <v-btn
          size="small"
          color="primary"
          variant="tonal"
          title="Vložit hlavičky a sady (Ctrl+V)"
          @click="() => emits('pasteFromClipboard')"
        >
          VLOŽIT ZE SCHRÁNKY
        </v-btn>
      </div>
    </template>

    <template #footer>
      <v-btn
        v-if="props.mode === 'edit' && props.allowDelete"
        color="error"
        variant="outlined"
        :disabled="props.deleting"
        @click="() => emits('delete')"
      >
        Smazat šablonu (Del)
      </v-btn>
      <v-spacer />
      <v-btn
        variant="text"
        @click="close"
      >
        Zrušit
      </v-btn>
      <v-btn
        color="primary"
        :disabled="!isValid"
        @click="onSave"
      >
        Uložit (Ctrl+S)
      </v-btn>
    </template>
  </Dialog>
</template>
