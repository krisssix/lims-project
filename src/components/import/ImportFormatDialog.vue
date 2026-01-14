<script setup lang="ts">
/**
 * ImportFormatDialog - modal for manual format configuration.
 * Allows user to set delimiter, decimal, header row, and skip empty lines.
 * Shows live preview of parsed data.
 */
import { ref, computed, watch } from 'vue'
import Dialog from '@/components/Dialog.vue'
import ImportPreviewGrid from './ImportPreviewGrid.vue'
import { parseWithOptions, type ParseOptions, type ParseResult, DEFAULT_PARSE_OPTIONS } from '@/utils/import/clientParser'

const props = defineProps<{
  modelValue: boolean
  rawText: string
  hasUserEditedFields?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'apply-format', opts: ParseOptions, result: ParseResult): void
}>()

// Local options state
const localOptions = ref<ParseOptions>({ ...DEFAULT_PARSE_OPTIONS })

// Debounced preview result
const previewResult = ref<ParseResult | null>(null)
const parseError = ref<string | null>(null)

// Confirm dialog for overwriting fields
const showConfirmOverwrite = ref(false)

// Delimiter options
const delimiterOptions = [
  { title: 'Auto', value: 'auto' },
  { title: 'Čárka (,)', value: ',' },
  { title: 'Středník (;)', value: ';' },
  { title: 'Tab', value: '\t' },
  { title: 'Pipe (|)', value: '|' },
]

// Decimal options
const decimalOptions = [
  { title: 'Auto', value: 'auto' },
  { title: 'Tečka (.)', value: '.' },
  { title: 'Čárka (,)', value: ',' },
]

// Header options
const headerOptions = [
  { title: 'Auto', value: 'auto' },
  { title: 'Bez hlavičky', value: 'no_header' },
]

const headerRowNumber = ref<number>(0)
const useCustomHeaderRow = ref(false)

const effectiveHeaderOption = computed(() => {
  if (useCustomHeaderRow.value) {
    return headerRowNumber.value
  }
  return localOptions.value.header
})

// Watch for changes and re-parse with debounce
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function debouncedParse(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    runPreviewParse()
  }, 250)
}

function runPreviewParse(): void {
  if (!props.rawText.trim()) {
    previewResult.value = null
    return
  }
  
  try {
    const opts: ParseOptions = {
      ...localOptions.value,
      header: effectiveHeaderOption.value
    }
    const result = parseWithOptions(props.rawText, opts)
    previewResult.value = result
    parseError.value = null
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : 'Chyba při parsování'
    previewResult.value = null
  }
}

// Re-parse when options change
watch([localOptions, useCustomHeaderRow, headerRowNumber], () => {
  debouncedParse()
}, { deep: true })

// Parse on dialog open
watch(() => props.modelValue, (open) => {
  if (open) {
    localOptions.value = { ...DEFAULT_PARSE_OPTIONS }
    useCustomHeaderRow.value = false
    headerRowNumber.value = 0
    runPreviewParse()
  }
})

// Apply button handler
function handleApply(): void {
  if (props.hasUserEditedFields) {
    showConfirmOverwrite.value = true
  } else {
    doApply()
  }
}

function doApply(): void {
  if (!previewResult.value) return
  
  const opts: ParseOptions = {
    ...localOptions.value,
    header: effectiveHeaderOption.value
  }
  
  emits('apply-format', opts, previewResult.value)
  emits('update:modelValue', false)
  showConfirmOverwrite.value = false
}

function close(): void {
  emits('update:modelValue', false)
}
</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="800px"
    :hide-footer="true"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div class="text-h6 d-flex align-center">
        <v-icon class="mr-2">mdi-cog</v-icon>
        Nastavení formátu souboru
      </div>
    </template>

    <template #content>
      <div class="pa-4">
        <!-- Format options -->
        <v-row class="mb-4">
          <v-col cols="12" sm="6" md="3">
            <v-select
              v-model="localOptions.delimiter"
              :items="delimiterOptions"
              item-title="title"
              item-value="value"
              label="Oddělovač"
              density="comfortable"
              variant="outlined"
              hide-details
            />
          </v-col>
          
          <v-col cols="12" sm="6" md="3">
            <v-select
              v-model="localOptions.decimal"
              :items="decimalOptions"
              item-title="title"
              item-value="value"
              label="Desetinný oddělovač"
              density="comfortable"
              variant="outlined"
              hide-details
            />
          </v-col>
          
          <v-col cols="12" sm="6" md="3">
            <v-select
              v-model="localOptions.header"
              :items="headerOptions"
              item-title="title"
              item-value="value"
              label="Hlavička"
              density="comfortable"
              variant="outlined"
              hide-details
              :disabled="useCustomHeaderRow"
            />
          </v-col>
          
          <v-col cols="12" sm="6" md="3">
            <v-switch
              v-model="localOptions.skipEmptyLines"
              label="Přeskočit prázdné"
              density="comfortable"
              hide-details
              color="primary"
            />
          </v-col>
        </v-row>

        <!-- Custom header row -->
        <v-row class="mb-4">
          <v-col cols="12" class="d-flex align-center ga-3">
            <v-checkbox
              v-model="useCustomHeaderRow"
              label="Vlastní řádek hlavičky"
              density="compact"
              hide-details
            />
            <v-text-field
              v-if="useCustomHeaderRow"
              v-model.number="headerRowNumber"
              type="number"
              label="Číslo řádku (0 = první)"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width: 180px;"
              :min="0"
            />
          </v-col>
        </v-row>

        <v-divider class="mb-4" />

        <!-- Parse error -->
        <v-alert
          v-if="parseError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          {{ parseError }}
        </v-alert>

        <!-- Parse status -->
        <v-alert
          v-else-if="previewResult"
          :type="previewResult.status === 'SUCCESS' ? 'success' : 'warning'"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          <div class="d-flex align-center justify-space-between">
            <span>
              <strong>
                {{ previewResult.status === 'SUCCESS' ? 'Úspěch' : 
                   previewResult.status === 'PARTIAL' ? 'Částečně' : 'Selhalo' }}:
              </strong>
              {{ previewResult.headers.length }} polí, {{ previewResult.metrics.totalRows }} řádků
            </span>
            <span v-if="previewResult.reasons.length" class="text-caption">
              {{ previewResult.reasons.join(', ') }}
            </span>
          </div>
        </v-alert>

        <!-- Preview grid -->
        <ImportPreviewGrid
          v-if="previewResult"
          :rows="previewResult.rows"
          :headers="previewResult.headers"
          :used-delimiter="previewResult.usedDelimiter"
          :used-decimal="previewResult.usedDecimal"
          :used-header-row="previewResult.usedHeaderRow"
        />

        <!-- Footer buttons -->
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn variant="text" @click="close">
            Zrušit
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!previewResult || previewResult.status === 'FAIL'"
            @click="handleApply"
          >
            Použít nastavení
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>

  <!-- Confirm overwrite dialog -->
  <v-dialog v-model="showConfirmOverwrite" max-width="450">
    <v-card>
      <v-card-title class="text-h6">
        Přepsat existující pole?
      </v-card-title>
      <v-card-text>
        Máte upravená pole. Chcete je přepsat podle nového parsování?
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="showConfirmOverwrite = false">
          Zrušit
        </v-btn>
        <v-btn color="primary" variant="flat" @click="doApply">
          Přepsat pole
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Dialog styling handled by Dialog component */
</style>
