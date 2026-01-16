
<script setup lang="ts">
/**
 * smartimportwizard: vylepšený proces (workflow) importu
 *
 * kroky (flow):
 * 1. nahrání souboru / vložení ze schránky
 * 2. detekce struktury (bloky, hlavičky, oddělovač)
 * 3. výběr/úprava hlaviček (jasné ui pro každý sloupec)
 * 4. mapování na šablonu (pokud existuje) nebo vytvoření nové
 * 5. náhled dat (preview)
 * 6. import
 */

import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Dialog from '@/components/Dialog.vue'
import { parseMeasurementFile, buildTemplateDraft, buildMeasurementPreview } from '@/utils/import/parseMeasurementFile'
import type { FileParseResult, MeasurementImportPreview, TemplateDraft } from '@/types/import'

type WizardStep = 'upload' | 'structure' | 'headers' | 'mapping' | 'preview'

const props = defineProps<{
  modelValue: boolean
  deviceOptions: { id: string; name: string; color?: string }[]
  existingTemplates?: { id: string; name: string; deviceId: string }[]
  defaultDeviceId?: string
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'importMeasurement', payload: MeasurementImportPreview): void
  (e: 'createTemplate', draft: TemplateDraft): void
}>()

// stav (state)
const currentStep = ref<WizardStep>('upload')
const rawFile = ref<File | null>(null)
const clipboardText = ref('')
const parseResult = ref<FileParseResult | null>(null)
const templateDraft = ref<TemplateDraft | null>(null)
const preview = ref<MeasurementImportPreview | null>(null)
const deviceId = ref<string>(props.defaultDeviceId || props.deviceOptions[0]?.id || '')
const loading = ref(false)
const errorMessage = ref<string | null>(null)

// volby parsování (parse options)
const delimiterOverride = ref<string | null>(null)
const useSecondLineUnits = ref(true)
const headerRowIndex = ref<number>(0)

// stav úpravy hlaviček (header editing state)
const editingHeaders = ref<string[]>([])
const selectedDataSection = ref<number>(0)

// stav mapování (mapping state)
const useExistingTemplate = ref(false)
const selectedTemplateId = ref<string | null>(null)

// vypočtené vlastnosti (computed)
const steps: { key: WizardStep; label: string; icon: string }[] = [
  { key: 'upload', label: 'Nahrát', icon: 'mdi-upload' },
  { key: 'structure', label: 'Struktura', icon: 'mdi-table-eye' },
  { key: 'headers', label: 'Hlavičky', icon: 'mdi-format-header-1' },
  { key: 'mapping', label: 'Mapování', icon: 'mdi-link-variant' },
  { key: 'preview', label: 'Náhled', icon: 'mdi-eye-check' }
]

const stepIndex = computed(() => steps.findIndex(s => s.key === currentStep.value))

const canGoNext = computed<boolean>(() => {
  switch (currentStep.value) {
    case 'upload': return !!rawFile.value || !!clipboardText.value.trim()
    case 'structure': return !!parseResult.value && parseResult.value.blocks.length > 0
    case 'headers': return editingHeaders.value.length > 0
    case 'mapping': return true
    case 'preview': return !!preview.value
    default: return false
  }
})

const currentDataSection = computed(() => {
  if (! parseResult.value?.blocks.length) return null
  return parseResult.value.blocks[selectedDataSection.value] || null
})

const delimiterLabel = computed<string>(() => {
  switch (delimiterOverride.value) {
    case ',': return 'Čárka (,)'
    case ';': return 'Středník (;)'
    case '\t': return 'Tab'
    case '|': return 'Pipe (|)'
    default: return 'Auto'
  }
})

const availableHeaderRows = computed(() => {
  const section = currentDataSection.value
  if (! section) return []
  const rows = section.rows.slice(0, 10)
  return rows.map((row, i) => ({
    index: i,
    label: `Řádek ${i + 1}: ${row.slice(0, 4).join(' | ')}${row.length > 4 ? '.. .' : ''}`,
    cells: row
  }))
})

// metody (methods)
function resetAll(): void {
  currentStep.value = 'upload'
  rawFile.value = null
  clipboardText.value = ''
  parseResult.value = null
  templateDraft.value = null
  preview.value = null
  delimiterOverride.value = null
  useSecondLineUnits.value = true
  headerRowIndex.value = 0
  editingHeaders.value = []
  selectedDataSection.value = 0
  useExistingTemplate.value = false
  selectedTemplateId.value = null
  errorMessage.value = null
}

function close(): void {
  emits('update:modelValue', false)
}

function onFileSelected(file: File | null): void {
  rawFile.value = file
  if (file) clipboardText.value = ''
}

async function parseFile(): Promise<void> {
  if (!rawFile.value && !clipboardText.value.trim()) return
  loading.value = true
  errorMessage.value = null

  try {
    const source = rawFile.value || clipboardText.value
    const result = await parseMeasurementFile(source, {
      explicitDelimiter: delimiterOverride.value || undefined,
      assumeSecondLineUnits: useSecondLineUnits.value
    })
    parseResult.value = result

    // inicializace hlaviček k úpravě z prvního bloku
    if (result.blocks.length > 0) {
      const firstBlock = result.blocks[0]
      editingHeaders.value = [... firstBlock.header]
    }

    currentStep.value = 'structure'
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Chyba při parsování souboru'
  } finally {
    loading.value = false
  }
}

function cycleDelimiter(): void {
  const options = [null, ',', ';', '\t', '|'] as const
  const current = delimiterOverride.value
  const idx = options.indexOf(current as typeof options[number])
  delimiterOverride.value = options[(idx + 1) % options.length]
}

function applyHeaderRow(rowIndex: number): void {
  const section = currentDataSection.value
  if (!section) return
  headerRowIndex.value = rowIndex
  const row = section.rows[rowIndex]
  if (row) {
    editingHeaders.value = row.map(cell => cell.trim() || `Sloupec ${editingHeaders.value.indexOf(cell) + 1}`)
  }
}

function updateHeader(index: number, newValue: string): void {
  if (index >= 0 && index < editingHeaders.value.length) {
    editingHeaders.value[index] = newValue
  }
}

function generateDefaultHeaders(): void {
  const count = editingHeaders.value.length || currentDataSection.value?.rows[0]?.length || 0
  editingHeaders.value = Array.from({ length: count }, (_, i) => `Sloupec ${i + 1}`)
}

function goToStep(step: WizardStep): void {
  const targetIdx = steps.findIndex(s => s.key === step)
  if (targetIdx <= stepIndex.value) {
    currentStep.value = step
  }
}

function goNext(): void {
  if (! canGoNext.value) return

  switch (currentStep.value) {
    case 'upload':
      void parseFile()
      break
    case 'structure':
      currentStep.value = 'headers'
      break
    case 'headers':
      currentStep.value = 'mapping'
      break
    case 'mapping':
      buildPreview()
      currentStep.value = 'preview'
      break
    case 'preview':
      doImport()
      break
  }
}

function goBack(): void {
  const idx = stepIndex.value
  if (idx > 0) {
    currentStep.value = steps[idx - 1].key
  }
}

function buildPreview(): void {
  if (!parseResult.value) return

  // aktualizace výsledku parsování upravenými hlavičkami
  const updatedResult = { ...parseResult.value }
  if (updatedResult.blocks[selectedDataSection.value]) {
    updatedResult.blocks[selectedDataSection.value].header = [... editingHeaders.value]
  }

  templateDraft.value = buildTemplateDraft(
    updatedResult,
    rawFile.value?.name.replace(/\.(csv|tsv|txt|xlsx?)$/i, '') || 'Import',
    deviceId.value
  )
  preview.value = buildMeasurementPreview(updatedResult, templateDraft.value)
}

function doImport(): void {
  if (!preview.value) return
  emits('importMeasurement', preview.value)
  close()
}

function createTemplate(): void {
  if (! templateDraft.value) return
  emits('createTemplate', templateDraft.value)
}

// klávesové zkratky (hotkeys)
function handleKey(e: KeyboardEvent): void {
  if (! props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey

  // přeskočit, pokud je aktivní vstupní pole (input)
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    if (key === 'escape') {
      e.preventDefault()
      close()
    }
    return
  }

  if (key === 'escape') { e.preventDefault(); close(); return }
  if (ctrl && key === 'enter') { e.preventDefault(); goNext(); return }
  if (alt && key === 'arrowleft') { e.preventDefault(); goBack(); return }
  if (alt && key === 'arrowright') { e.preventDefault(); goNext(); return }
  if (alt && key === 'd') { e.preventDefault(); cycleDelimiter(); return }
  if (alt && key === 'u') { e.preventDefault(); useSecondLineUnits.value = !useSecondLineUnits.value; return }
  if (ctrl && key === 'v' && currentStep.value === 'upload') {
    e.preventDefault()
    void navigator.clipboard.readText().then(t => { clipboardText.value = t })
    return
  }
}

watch(() => props.modelValue, v => {
  if (v) {
    resetAll()
    window.addEventListener('keydown', handleKey)
    nextTick(() => {
      document.querySelector<HTMLElement>('[data-import-primary]')?.focus()
    })
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})

onMounted(() => {
  if (props.modelValue) window.addEventListener('keydown', handleKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKey)
})
</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="1100px"
    :hide-footer="true"
    class="smart-import-wizard"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #content>
      <div class="wizard-container">
        <!-- kroky postupu (progress steps) -->
        <div class="wizard-steps">
          <button
            v-for="(step, i) in steps"
            :key="step.key"
            class="wizard-step"
            :class="{
              'step-active': currentStep === step.key,
              'step-completed': i < stepIndex,
              'step-disabled': i > stepIndex
            }"
            :disabled="i > stepIndex"
            @click="goToStep(step.key)"
          >
            <div class="step-indicator">
              <v-icon
                v-if="i < stepIndex"
                size="16"
                color="white"
              >
                mdi-check
              </v-icon>
              <v-icon
                v-else
                :icon="step.icon"
                size="16"
              />
            </div>
            <span class="step-label">{{ step.label }}</span>
          </button>
        </div>

        <!-- upozornění na chybu (error alert) -->
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          closable
          class="mx-4 mt-4"
          @click:close="errorMessage = null"
        >
          {{ errorMessage }}
        </v-alert>

        <!-- obsah kroku -->
        <div class="wizard-content">
          <!-- krok 1: nahrát (upload) -->
          <div
            v-if="currentStep === 'upload'"
            class="step-content"
          >
            <div class="step-header">
              <v-icon
                size="24"
                color="primary"
                class="mr-3"
              >
                mdi-upload
              </v-icon>
              <div>
                <h2 class="step-title">
                  Nahrát data
                </h2>
                <p class="step-subtitle">
                  Nahrajte soubor nebo vložte data ze schránky
                </p>
              </div>
            </div>

            <div class="upload-grid">
              <!-- nahrání souboru -->
              <div class="upload-card">
                <div class="upload-card-header">
                  <v-icon
                    size="20"
                    color="primary"
                  >
                    mdi-file-document
                  </v-icon>
                  <span>Soubor</span>
                </div>
                <v-file-input
                  :model-value="rawFile"
                  label="Vyberte soubor"
                  variant="outlined"
                  density="comfortable"
                  accept=".csv,.tsv,.txt,.xlsx,.xls"
                  hide-details="auto"
                  prepend-icon=""
                  prepend-inner-icon="mdi-paperclip"
                  :disabled="loading"
                  data-import-primary
                  @update:model-value="f => onFileSelected((Array.isArray(f) ? f[0] : f) as File | null)"
                />
                <div class="upload-hint">
                  Podporované formáty: CSV, TSV, TXT, XLSX
                </div>
              </div>

              <!-- schránka (clipboard) -->
              <div class="upload-card">
                <div class="upload-card-header">
                  <v-icon
                    size="20"
                    color="primary"
                  >
                    mdi-clipboard-text
                  </v-icon>
                  <span>Schránka</span>
                  <v-chip
                    size="small"
                    variant="tonal"
                    color="primary"
                    class="ml-2"
                  >
                    Ctrl+V
                  </v-chip>
                </div>
                <v-textarea
                  v-model="clipboardText"
                  label="Vložte text"
                  variant="outlined"
                  density="comfortable"
                  rows="5"
                  hide-details="auto"
                  placeholder="Vložte obsah ze schránky..."
                  :disabled="!! rawFile || loading"
                />
              </div>
            </div>

            <!-- volby parsování (parse options) -->
            <div class="parse-options">
              <div class="option-group">
                <span class="option-label">Přístroj</span>
                <v-select
                  v-model="deviceId"
                  :items="deviceOptions"
                  item-title="name"
                  item-value="id"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                  style="max-width: 280px"
                />
              </div>

              <div class="option-group">
                <span class="option-label">Oddělovač</span>
                <v-btn
                  variant="tonal"
                  :color="delimiterOverride ? 'primary' : undefined"
                  @click="cycleDelimiter"
                >
                  {{ delimiterLabel }}
                  <v-icon
                    end
                    size="16"
                  >
                    mdi-refresh
                  </v-icon>
                </v-btn>
              </div>

              <div class="option-group">
                <v-switch
                  v-model="useSecondLineUnits"
                  label="2.řádek = jednotky"
                  color="primary"
                  hide-details
                  density="comfortable"
                />
              </div>
            </div>
          </div>

          <!-- krok 2: struktura (structure) -->
          <div
            v-else-if="currentStep === 'structure'"
            class="step-content"
          >
            <div class="step-header">
              <v-icon
                size="24"
                color="primary"
                class="mr-3"
              >
                mdi-table-eye
              </v-icon>
              <div>
                <h2 class="step-title">
                  Struktura dat
                </h2>
                <p class="step-subtitle">
                  Detekováno {{ parseResult?.blocks.length || 0 }} datových sekcí
                </p>
              </div>
            </div>

            <!-- varování (warnings) -->
            <v-alert
              v-if="parseResult?.warnings?.length"
              type="warning"
              variant="tonal"
              class="mb-4"
            >
              <div
                v-for="(w, i) in parseResult.warnings"
                :key="i"
              >
                {{ w }}
              </div>
            </v-alert>

            <!-- záložky datových sekcí -->
            <div
              v-if="parseResult && parseResult.blocks.length > 1"
              class="section-tabs mb-4"
            >
              <v-chip
                v-for="(block, i) in parseResult.blocks"
                :key="i"
                :color="selectedDataSection === i ? 'primary' : undefined"
                :variant="selectedDataSection === i ? 'flat' : 'tonal'"
                @click="selectedDataSection = i"
              >
                <v-icon
                  start
                  size="16"
                >
                  mdi-table
                </v-icon>
                Sekce {{ i + 1 }}
                <v-chip
                  size="small"
                  variant="text"
                  class="ml-1"
                >
                  {{ block.rows.length }} řádků
                </v-chip>
              </v-chip>
            </div>

            <!-- náhled dat -->
            <div
              v-if="currentDataSection"
              class="data-preview"
            >
              <div class="preview-header-row">
                <v-chip
                  v-for="(h, i) in currentDataSection.header"
                  :key="i"
                  size="small"
                  color="primary"
                  variant="flat"
                  class="header-chip"
                >
                  {{ h || `Col ${i + 1}` }}
                </v-chip>
              </div>
              <div class="preview-data-rows">
                <div
                  v-for="(row, ri) in currentDataSection.rows.slice(0, 8)"
                  :key="ri"
                  class="preview-row"
                >
                  <span
                    v-for="(cell, ci) in row"
                    :key="ci"
                    class="preview-cell"
                  >
                    {{ cell || '—' }}
                  </span>
                </div>
                <div
                  v-if="currentDataSection.rows.length > 8"
                  class="preview-more"
                >
                  + {{ currentDataSection.rows.length - 8 }} dalších řádků
                </div>
              </div>
            </div>

            <!-- statistiky, jsou-li k dispozici -->
            <div
              v-if="currentDataSection?.stats"
              class="section-stats mt-4"
            >
              <div class="stats-title">
                <v-icon
                  size="16"
                  class="mr-1"
                >
                  mdi-chart-box
                </v-icon>
                Statistiky
              </div>
              <div class="stats-grid">
                <div
                  v-for="(stat, name) in currentDataSection.stats"
                  :key="name"
                  class="stat-item"
                >
                  <span class="stat-name">{{ name }}</span>
                  <span class="stat-value">
                    μ={{ stat.mean.toFixed(2) }}, σ={{ stat.stdDev.toFixed(2) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- krok 3: hlavičky (headers) -->
          <div
            v-else-if="currentStep === 'headers'"
            class="step-content"
          >
            <div class="step-header">
              <v-icon
                size="24"
                color="primary"
                class="mr-3"
              >
                mdi-format-header-1
              </v-icon>
              <div>
                <h2 class="step-title">
                  Upravit hlavičky
                </h2>
                <p class="step-subtitle">
                  Pojmenujte sloupce nebo vyberte řádek s hlavičkami
                </p>
              </div>
            </div>

            <!-- výběr řádku s hlavičkou -->
            <div class="header-source mb-4">
              <div class="source-label">
                Zdroj hlaviček:
              </div>
              <v-btn-toggle
                :model-value="headerRowIndex"
                divided
                mandatory
                density="comfortable"
                @update:model-value="v => applyHeaderRow(v as number)"
              >
                <v-btn
                  v-for="opt in availableHeaderRows.slice(0, 5)"
                  :key="opt.index"
                  :value="opt.index"
                  size="small"
                >
                  Řádek {{ opt.index + 1 }}
                </v-btn>
              </v-btn-toggle>
              <v-btn
                variant="text"
                size="small"
                class="ml-2"
                @click="generateDefaultHeaders"
              >
                <v-icon
                  start
                  size="16"
                >
                  mdi-refresh
                </v-icon>
                Výchozí
              </v-btn>
            </div>

            <!-- editor hlaviček -->
            <div class="headers-editor">
              <div
                v-for="(header, i) in editingHeaders"
                :key="i"
                class="header-item"
              >
                <div class="header-index">
                  {{ i + 1 }}
                </div>
                <v-text-field
                  :model-value="header"
                  variant="outlined"
                  density="compact"
                  hide-details
                  placeholder="Název sloupce"
                  @update:model-value="v => updateHeader(i, String(v))"
                />
                <div class="header-preview">
                  {{ currentDataSection?.rows[headerRowIndex + 1]?.[i] || '—' }}
                </div>
              </div>
            </div>
          </div>

          <!-- krok 4: mapování (mapping) -->
          <div
            v-else-if="currentStep === 'mapping'"
            class="step-content"
          >
            <div class="step-header">
              <v-icon
                size="24"
                color="primary"
                class="mr-3"
              >
                mdi-link-variant
              </v-icon>
              <div>
                <h2 class="step-title">
                  Mapování
                </h2>
                <p class="step-subtitle">
                  Propojte data s existující šablonou nebo vytvořte novou
                </p>
              </div>
            </div>

            <div class="mapping-options">
              <v-radio-group
                v-model="useExistingTemplate"
                hide-details
              >
                <v-radio
                  :value="false"
                  color="primary"
                >
                  <template #label>
                    <div class="radio-label">
                      <v-icon
                        size="20"
                        class="mr-2"
                      >
                        mdi-plus-circle
                      </v-icon>
                      <div>
                        <div class="radio-title">
                          Vytvořit novou šablonu
                        </div>
                        <div class="radio-subtitle">
                          Použít rozpoznané hlavičky jako pole šablony
                        </div>
                      </div>
                    </div>
                  </template>
                </v-radio>

                <v-radio
                  :value="true"
                  color="primary"
                  :disabled="!existingTemplates?.length"
                >
                  <template #label>
                    <div class="radio-label">
                      <v-icon
                        size="20"
                        class="mr-2"
                      >
                        mdi-link
                      </v-icon>
                      <div>
                        <div class="radio-title">
                          Použít existující šablonu
                        </div>
                        <div class="radio-subtitle">
                          {{ existingTemplates?.length ? `${existingTemplates.length} dostupných šablon` : 'Žádné šablony' }}
                        </div>
                      </div>
                    </div>
                  </template>
                </v-radio>
              </v-radio-group>

              <!-- výběr šablony -->
              <v-expand-transition>
                <div
                  v-if="useExistingTemplate && existingTemplates?.length"
                  class="template-selector mt-4"
                >
                  <v-select
                    v-model="selectedTemplateId"
                    :items="existingTemplates"
                    item-title="name"
                    item-value="id"
                    label="Vyberte šablonu"
                    variant="outlined"
                    density="comfortable"
                    hide-details
                  />
                </div>
              </v-expand-transition>

              <!-- New template preview -->
              <v-expand-transition>
                <div
                  v-if="! useExistingTemplate"
                  class="new-template-preview mt-4"
                >
                  <div class="preview-title">
                    Náhled šablony
                  </div>
                  <div class="template-fields">
                    <v-chip
                      v-for="(h, i) in editingHeaders"
                      :key="i"
                      size="small"
                      variant="tonal"
                      color="primary"
                    >
                      {{ h }}
                    </v-chip>
                  </div>
                </div>
              </v-expand-transition>
            </div>
          </div>

          <!-- STEP 5: Preview -->
          <div
            v-else-if="currentStep === 'preview'"
            class="step-content"
          >
            <div class="step-header">
              <v-icon
                size="24"
                color="success"
                class="mr-3"
              >
                mdi-eye-check
              </v-icon>
              <div>
                <h2 class="step-title">
                  Náhled importu
                </h2>
                <p class="step-subtitle">
                  Připraveno {{ preview?.records.length || 0 }} záznamů k importu
                </p>
              </div>
            </div>

            <v-alert
              type="success"
              variant="tonal"
              class="mb-4"
            >
              <div class="d-flex align-center">
                <v-icon class="mr-2">
                  mdi-check-circle
                </v-icon>
                <div>
                  <strong>Data jsou připravena k importu</strong>
                  <div class="text-caption">
                    {{ preview?.records.length || 0 }} záznamů bude vytvořeno
                  </div>
                </div>
              </div>
            </v-alert>

            <!-- Records preview -->
            <div
              v-if="preview"
              class="records-preview"
            >
              <v-table
                density="compact"
                class="preview-table"
              >
                <thead>
                  <tr>
                    <th style="width: 60px">
                      #
                    </th>
                    <th
                      v-for="(h, i) in editingHeaders.slice(0, 6)"
                      :key="i"
                    >
                      {{ h }}
                    </th>
                    <th v-if="editingHeaders.length > 6">
                      ...
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="rec in preview.records.slice(0, 10)"
                    :key="rec.recordIndex"
                  >
                    <td class="text-caption text-medium-emphasis">
                      {{ rec.recordIndex }}
                    </td>
                    <td
                      v-for="(f, i) in rec.fields.slice(0, 6)"
                      :key="i"
                    >
                      {{ String(f.value ?? '—').slice(0, 20) }}
                    </td>
                    <td
                      v-if="rec.fields.length > 6"
                      class="text-medium-emphasis"
                    >
                      +{{ rec.fields.length - 6 }}
                    </td>
                  </tr>
                </tbody>
              </v-table>
              <div
                v-if="preview.records.length > 10"
                class="preview-more"
              >
                + {{ preview.records.length - 10 }} dalších záznamů
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="wizard-footer">
          <v-btn
            variant="text"
            @click="close"
          >
            Zrušit
            <span class="hotkey-hint ml-1">(Esc)</span>
          </v-btn>

          <v-spacer />

          <v-btn
            v-if="stepIndex > 0"
            variant="text"
            @click="goBack"
          >
            <v-icon start>
              mdi-chevron-left
            </v-icon>
            Zpět
          </v-btn>

          <v-btn
            color="primary"
            variant="flat"
            :disabled="!canGoNext"
            :loading="loading"
            @click="goNext"
          >
            {{ currentStep === 'preview' ? 'Importovat' : 'Pokračovat' }}
            <v-icon
              v-if="currentStep !== 'preview'"
              end
            >
              mdi-chevron-right
            </v-icon>
            <v-icon
              v-else
              end
            >
              mdi-check
            </v-icon>
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.wizard-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 600px;
}

/* Steps */
.wizard-steps {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 20px 24px;
  background: linear-gradient(to bottom, #f8fafc 0%, #ffffff 100%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.wizard-step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border: none;
  background: transparent;
  border-radius: 24px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.5);
}

.wizard-step:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.04);
}

.wizard-step.step-active {
  background: rgb(var(--v-theme-primary));
  color: white;
}

.wizard-step.step-completed {
  color: rgb(var(--v-theme-primary));
}

.wizard-step.step-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.08);
  transition: all 0.2s;
}

.step-active .step-indicator {
  background: rgba(255, 255, 255, 0.2);
}

.step-completed .step-indicator {
  background: rgb(var(--v-theme-primary));
}

.step-label {
  display: none;
}

@media (min-width: 768px) {
  .step-label {
    display: inline;
  }
}

/* Content */
.wizard-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.step-content {
  max-width: 900px;
  margin: 0 auto;
}

.step-header {
  display: flex;
  align-items: flex-start;
  margin-bottom: 24px;
}

.step-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
  margin: 0 0 4px 0;
}

.step-subtitle {
  font-size: 0.875rem;
  color: rgba(0, 0, 0, 0.6);
  margin: 0;
}

/* Upload */
.upload-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.upload-card {
  padding: 20px;
  background: #f8fafc;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
}

.upload-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 16px;
}

.upload-hint {
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 8px;
}

.parse-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  padding: 16px 20px;
  background: #f8fafc;
  border-radius: 12px;
}

.option-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.option-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
}

/* Structure */
.section-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.data-preview {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
}

.preview-header-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 16px;
  background: #f8fafc;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.header-chip {
  font-size: 0.75rem;
  font-weight: 600;
}

.preview-data-rows {
  padding: 12px 16px;
  max-height: 300px;
  overflow-y: auto;
}

.preview-row {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  font-family: ui-monospace, monospace;
  font-size: 0.8125rem;
}

.preview-cell {
  flex: 1;
  min-width: 80px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-more {
  padding: 12px 0;
  text-align: center;
  font-size: 0.8125rem;
  color: rgba(0, 0, 0, 0.5);
}

.section-stats {
  padding: 16px;
  background: #f8fafc;
  border-radius: 12px;
}

.stats-title {
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 12px;
}

.stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background: white;
  border-radius: 8px;
}

.stat-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.6);
}

.stat-value {
  font-size: 0.8125rem;
  font-family: ui-monospace, monospace;
}

/* Headers */
.header-source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.source-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
}

.headers-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.header-item {
  display: grid;
  grid-template-columns: 40px 1fr 150px;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 8px;
}

.header-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
}

.header-preview {
  font-size: 0.8125rem;
  color: rgba(0, 0, 0, 0.5);
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Mapping */
.mapping-options {
  padding: 20px;
  background: #f8fafc;
  border-radius: 12px;
}

.radio-label {
  display: flex;
  align-items: flex-start;
}

.radio-title {
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
}

.radio-subtitle {
  font-size: 0.8125rem;
  color: rgba(0, 0, 0, 0.6);
}

.template-selector,
.new-template-preview {
  padding: 16px;
  background: white;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.preview-title {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 12px;
}

.template-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Preview */
.records-preview {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
}

.preview-table {
  background: white;
}

/* Footer */
.wizard-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  background: #f8fafc;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.hotkey-hint {
  font-size: 0.7rem;
  opacity: 0.6;
  font-family: ui-monospace, monospace;
}

/* Responsive */
@media (max-width: 768px) {
  .wizard-steps {
    padding: 12px 16px;
    gap: 4px;
  }

  .wizard-step {
    padding: 8px 12px;
  }

  .wizard-content {
    padding: 16px;
  }

  .upload-grid {
    grid-template-columns: 1fr;
  }

  .parse-options {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-item {
    grid-template-columns: 32px 1fr;
  }

  .header-preview {
    display: none;
  }
}
</style>
