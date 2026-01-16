<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { type MeasurementResponse } from '@/stores/measurement'
import { useExport, DEFAULT_EXPORT_COLUMNS, type ExportColumn, type ExportFormat } from '@/composables/useExport'

const props = defineProps<{
  modelValue: boolean
  measurements: MeasurementResponse[]
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'exported', format: ExportFormat, count: number): void
}>()

const { doExport } = useExport()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emits('update:modelValue', v)
})

// možnosti exportu (export options)
const selectedFormat = ref<ExportFormat>('xlsx')
const columns = ref<ExportColumn[]>([])
const customFilename = ref('')

// inicializace sloupců při otevření dialogu (initialize columns)
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    columns.value = DEFAULT_EXPORT_COLUMNS.map(c => ({ ...c }))
    customFilename.value = ''
  }
})

const formatOptions = [
  { value: 'csv', title: 'CSV', icon: 'mdi-file-delimited', description: 'Textový formát pro import' },
  { value: 'xlsx', title: 'Excel (XLSX)', icon: 'mdi-microsoft-excel', description: 'Microsoft Excel' },
  { value: 'pdf', title: 'PDF', icon: 'mdi-file-pdf-box', description: 'Tisknutelný dokument' },
  { value: 'json', title: 'JSON', icon: 'mdi-code-json', description: 'Strukturovaná data' }
]

// statistiky (stats)
const measurementCount = computed(() => props.measurements.length)
const enabledColumnsCount = computed(() => columns.value.filter(c => c.enabled).length)

// vybrat nebo odznačit vše (select / deselect all)
const allSelected = computed({
  get: () => columns.value.every(c => c.enabled),
  set: (v) => columns.value.forEach(c => c.enabled = v)
})

function toggleAll(): void {
  allSelected.value = !allSelected.value
}

// export (export)
function handleExport(): void {
  if (!props.measurements.length || enabledColumnsCount.value === 0) return
  
  const filename = customFilename.value.trim() || 
    `mereni_export_${new Date().toISOString().slice(0, 10)}`
  
  // mapování measurementresponse na exportmeasurement (mapping data)
  const exportData = props.measurements.map(m => ({
    id: m.id,
    type: m.type,
    value: m.value,
    unit: m.unit,
    timestamp: m.timestamp,
    measuredByUsername: (m as unknown as { measuredByUsername?: string }).measuredByUsername || null,
    note: (m as unknown as { note?: string }).note || null,
    zenodoDoi: m.zenodoDoi || null
  }))
  
  doExport(selectedFormat.value, exportData, columns.value, filename)
  emits('exported', selectedFormat.value, props.measurements.length)
  open.value = false
}

function cancel(): void {
  open.value = false
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" persistent>
    <v-card class="export-dialog">
      <v-card-title class="dialog-header">
        <v-icon color="primary" class="mr-2">mdi-export</v-icon>
        Export měření
        <v-spacer />
        <v-btn icon variant="text" size="small" @click="cancel">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text class="dialog-content">
        <!-- statistiky (stats) -->
        <v-alert type="info" variant="tonal" density="compact" class="mb-4">
          <strong>{{ measurementCount }}</strong> měření bude exportováno
        </v-alert>

        <!-- výběr formátu (format selection) -->
        <div class="text-subtitle-2 mb-2">Formát exportu</div>
        <v-select
          v-model="selectedFormat"
          :items="formatOptions"
          item-value="value"
          item-title="title"
          variant="outlined"
          density="compact"
          hide-details
          class="mb-4"
        >
          <template #item="{ item, props: itemProps }">
            <v-list-item v-bind="itemProps">
              <template #prepend>
                <v-icon :icon="item.raw.icon" class="mr-3" />
              </template>
              <template #subtitle>
                {{ item.raw.description }}
              </template>
            </v-list-item>
          </template>
          <template #selection="{ item }">
            <v-icon :icon="item.raw.icon" size="small" class="mr-2" />
            {{ item.raw.title }}
          </template>
        </v-select>

        <!-- název souboru (filename) -->
        <v-text-field
          v-model="customFilename"
          label="Název souboru"
          :placeholder="`mereni_export_${new Date().toISOString().slice(0, 10)}`"
          hint="Přípona bude přidána automaticky"
          persistent-hint
          density="compact"
          variant="outlined"
          class="mb-4"
        />

        <!-- výběr sloupců (column selection) -->
        <div class="columns-section">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-subtitle-2">Sloupce k exportu</span>
            <v-btn size="small" variant="text" @click="toggleAll">
              {{ allSelected ? 'Odznačit vše' : 'Vybrat vše' }}
            </v-btn>
          </div>
          
          <div class="columns-grid">
            <v-checkbox
              v-for="col in columns"
              :key="col.key"
              v-model="col.enabled"
              :label="col.label"
              density="compact"
              hide-details
              color="primary"
            />
          </div>
        </div>

        <div v-if="enabledColumnsCount === 0" class="text-error text-caption mt-2">
          Vyberte alespoň jeden sloupec
        </div>
      </v-card-text>

      <v-card-actions class="dialog-actions">
        <v-spacer />
        <v-btn variant="text" @click="cancel">Zrušit</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-download"
          :disabled="enabledColumnsCount === 0"
          @click="handleExport"
        >
          Stáhnout {{ selectedFormat.toUpperCase() }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.export-dialog {
  border-radius: 12px;
}

.dialog-header {
  display: flex;
  align-items: center;
  padding: 20px 24px 16px;
  font-size: 1.1rem;
  font-weight: 600;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.dialog-content {
  padding: 20px 24px;
}

.columns-section {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 12px 16px;
}

.columns-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}

.dialog-actions {
  padding: 16px 24px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
</style>
