<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { type ImportedFileStructure } from '@/utils/import/importCompatibility'

type InputMode = 'file' | 'text' | null

const props = defineProps<{
  importedFile: File | null
  importedStructure: ImportedFileStructure | null
  importBusy: boolean
  importError: string | null
  importCompatibility: { compatible: boolean; reasons: string[] } | null
  isImportCompatible: boolean
  unmappedFieldsCount?: number  // Number of fields that need manual mapping
  rowOffset?: number  // Number of rows to skip at the beginning
  dataApplied?: boolean  // Whether data has been applied already
  mappingApplied?: boolean  // Whether user has applied custom mapping
  mappingAutoApplied?: boolean  // Whether mapping was auto-applied from learned
  learnedMappingsAvailable?: boolean  // Whether learned mappings are available for this import
  
  // Parsing options
  parsingDelimiter?: string
  parsingDecimalSeparator?: '.' | ','
  parsingHasHeader?: boolean
  parsingHeaderRowIndex?: number
}>()
const emits = defineEmits<{
  (e: 'pick-file', f: File | null): void
  (e: 'analyze'): void
  (e: 'analyze-text', text: string): void
  (e: 'apply'): void
  (e: 'reset'): void
  (e: 'open-mapping'): void
  (e: 'clear-all'): void
  (e: 'update:rowOffset', offset: number): void
  
  // New emits for parsing options
  (e: 'update:parsingDelimiter', val: string): void
  (e: 'update:parsingDecimalSeparator', val: '.' | ','): void
  (e: 'update:parsingHasHeader', val: boolean): void
  (e: 'update:parsingHeaderRowIndex', val: number): void
  (e: 'pick-header-row'): void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const inputMode = ref<InputMode>(null)
const pastedText = ref('')

// Row offset for skipping initial rows
const localRowOffset = ref(0)

// Sync with prop if provided
watch(() => props.rowOffset, (val) => {
  if (val !== undefined && val !== localRowOffset.value) {
    localRowOffset.value = val
  }
}, { immediate: true })

// Emit offset changes
function updateRowOffset(newOffset: number) {
  const maxOffset = totalRowCount.value - 1
  const clampedOffset = Math.max(0, Math.min(newOffset, maxOffset))
  emits('update:rowOffset', clampedOffset)
}

const highlightMappingBtn = ref(false)

function handleApply() {
  // Check compatibility
  if (props.importCompatibility && !props.importCompatibility.compatible) {
    // Not compatible -> highlight mapping button
    highlightMappingBtn.value = true
    setTimeout(() => { highlightMappingBtn.value = false }, 2000)
    return
  }
  emits('apply')
}

// Total row count before offset
const totalRowCount = computed(() => {
  return props.importedStructure?.blocks[0]?.rows.length || 0
})

// Rows after applying offset
const offsetRows = computed(() => {
  if (!props.importedStructure?.blocks[0]?.rows) return []
  return props.importedStructure.blocks[0].rows.slice(localRowOffset.value)
})

// Current input has data?
const hasInput = computed(() => {
  // Also show buttons if we have analyzed structure
  if (props.importedStructure) return true
  if (inputMode.value === 'file') return !!props.importedFile
  if (inputMode.value === 'text') return !!pastedText.value.trim()
  return false
})

// Can analyze?
const canAnalyze = computed(() => hasInput.value && !props.importBusy)

const delimiterLabel = computed(() => {
  const d = props.parsingDelimiter ?? props.importedStructure?.delimiter
  if (d === ',') return 'Čárka (,)'
  if (d === ';') return 'Středník (;)'
  if (d === '\t') return 'Tabulátor'
  if (d === '|') return 'Svislítko (|)'
  return d ? `"${d}"` : 'Auto'
})

const delimiterOptions = [
  { title: 'Auto', value: '' },
  { title: 'Čárka (,)', value: ',' },
  { title: 'Středník (;)', value: ';' },
  { title: 'Tabulátor', value: '\t' },
  { title: 'Svislítko (|)', value: '|' }
]

const decimalSeparatorOptions = [
  { title: 'Tečka (.)', value: '.' },
  { title: 'Čárka (,)', value: ',' }
]


function openFileChooser(): void {
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
  fileInputRef.value?.click()
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] || null
  if (file) {
    // Switch to file mode and emit
    inputMode.value = 'file'
    pastedText.value = '' // Clear text when file is selected
    localRowOffset.value = 0 // Reset offset on new file
    emits('pick-file', file)
  }
}

function switchToTextMode(): void {
  // If switching from file mode with data, clear it
  if (inputMode.value === 'file' && props.importedFile) {
    emits('reset')
  }
  inputMode.value = 'text'
  localRowOffset.value = 0
}

function switchToFileMode(): void {
  // If switching from text mode with data, clear it
  if (inputMode.value === 'text' && pastedText.value.trim()) {
    pastedText.value = ''
  }
  inputMode.value = 'file'
  localRowOffset.value = 0
  openFileChooser()
}

function cancelInput(): void {
  if (inputMode.value === 'file') {
    emits('reset')
  }
  pastedText.value = ''
  inputMode.value = null
  localRowOffset.value = 0
}

function analyze(): void {
  if (inputMode.value === 'file') {
    emits('analyze')
  } else if (inputMode.value === 'text' && pastedText.value.trim()) {
    emits('analyze-text', pastedText.value)
  }
}
</script>

<template>
  <div class="import-panel">
    <!-- Hidden file input -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".csv,.tsv,.txt,.xlsx,.xls"
      style="display:none"
      @change="onFileChange"
    >

    <!-- Import Toolbar -->
    <div class="import-toolbar">
      <div class="toolbar-actions">
        <!-- Změnit soubor / Soubor button -->
        <v-btn
          variant="flat"
          color="primary"
          :class="{ 'btn-secondary': props.importedFile }"
          prepend-icon="mdi-file-upload-outline"
          @click="switchToFileMode"
        >
          {{ props.importedFile ? 'Změnit soubor' : 'Nahrát soubor' }}
        </v-btn>
        
        <!-- Vložit text button -->
        <v-btn :active="inputMode === 'text'"
          variant="outlined"
          color="primary"
          prepend-icon="mdi-content-paste"
          @click="switchToTextMode"
        >
          Vložit text
        </v-btn>
        
        <div class="toolbar-divider"></div>
        
        <!-- Vyčistit vše button -->
        <v-btn
          variant="tonal"
          color="secondary"
          prepend-icon="mdi-broom"
          @click="emits('clear-all')"
        >
          Vyčistit vše
        </v-btn>
      </div>
      
      <div class="toolbar-spacer"></div>
      
      <!-- File info + status -->
      <div v-if="hasInput" class="toolbar-info">
        <!-- File Info Chip -->
        <div v-if="inputMode === 'file' && props.importedFile" class="info-chip file-chip">
          <v-icon size="14" color="primary">mdi-file-document-outline</v-icon>
          <span class="chip-filename">{{ props.importedFile.name }}</span>
          <span v-if="props.importedStructure" class="chip-count">{{ offsetRows.length }} záznamy</span>
        </div>
        
        <!-- Text Info Chip -->
        <div v-else-if="inputMode === 'text' && pastedText.trim()" class="info-chip text-chip">
          <v-icon size="14" color="secondary">mdi-text-box-outline</v-icon>
          <span class="chip-filename">{{ pastedText.split('\n').length }} řádků</span>
        </div>
        
        <!-- Analyze Button for File -->
        <v-btn
          v-if="inputMode === 'file' && props.importedFile && !props.importedStructure"
          color="primary"
          variant="flat"
          height="32"
          class="px-3"
          prepend-icon="mdi-play"
          @click="analyze"
        >
          Analyzovat
        </v-btn>

        <!-- Status Chip -->
        <div v-if="props.importedStructure" class="status-chip success">
          <v-icon size="14">mdi-check-circle</v-icon>
          <span>Analyzováno</span>
        </div>
        
        <!-- Cancel button -->
        <button 
          type="button" 
          class="icon-btn"
          title="Zrušit vstup"
          @click="cancelInput"
        >
          <v-icon size="18">mdi-close</v-icon>
        </button>
      </div>
    </div>

    <!-- Text input area (only when in text mode) -->
    <div v-if="inputMode === 'text'" class="text-input-section">
      <v-textarea
        v-model="pastedText"
        label="Vlož data ze schránky"
        :rows="4"
        variant="outlined"
        density="compact"
        hide-details
        autofocus
        placeholder="Ctrl+V pro vložení dat..."
      />
      <div class="d-flex justify-end mt-2">
        <v-btn
          v-if="pastedText.trim()"
          color="primary"
          variant="flat"
          prepend-icon="mdi-play"
          @click="analyze"
        >
          Analyzovat
        </v-btn>
      </div>
    </div>

    <!-- Error message -->
    <div v-if="props.importError" class="status-msg error">
      <v-icon size="16">mdi-alert-circle</v-icon>
      {{ props.importError }}
    </div>

    <!-- Preview Section -->
    <details v-if="props.importedStructure" class="preview-section" open>
      <summary class="preview-summary">
        <!-- Section Icon Badge -->
        <div class="section-icon" :class="{ success: props.importCompatibility?.compatible }">
          <v-icon size="18" color="white">{{ props.importCompatibility?.compatible ? 'mdi-check' : 'mdi-alert' }}</v-icon>
        </div>
        
        <!-- Section Title -->
        <div class="section-info">
          <span class="section-title">Náhled importovaných dat</span>
          <span class="section-subtitle">
            {{ props.importCompatibility?.compatible ? 'Soubor analyzován a připraven k importu' : 'Data potřebují úpravu mapování' }}
          </span>
        </div>
        
        <!-- Info Chips -->
        <div class="section-chips">
          <span class="mini-chip primary">
            <v-icon size="12">mdi-database</v-icon>
            {{ offsetRows.length }} záznamy měření
          </span>
          <span v-if="props.importedStructure?.series?.length" class="mini-chip secondary">
            <v-icon size="12">mdi-chart-line</v-icon>
            {{ props.importedStructure.series.length }} sérií
          </span>

        </div>
        
        <div class="section-spacer"></div>
        
        <div class="section-actions" @click.stop>
          <v-btn
            variant="outlined"
            color="primary"
            :class="{ 'btn-pulse': highlightMappingBtn }"
            prepend-icon="mdi-table-cog"
            @click="emits('open-mapping')"
          >
            Upravit mapování
          </v-btn>
          <v-btn
            v-if="props.importedStructure"
            :variant="props.dataApplied ? 'tonal' : 'flat'"
            :color="props.dataApplied ? 'secondary' : 'primary'"
            prepend-icon="mdi-check"
            @click="handleApply"
          >
            {{ props.dataApplied ? 'Znovu použít' : 'Použít data' }}
          </v-btn>
        </div>
      </summary>
      
      <div class="preview-content">
        <!-- Settings Card -->
        <div class="settings-card">
          <div class="settings-header">
            <div class="settings-title">
              <div class="settings-icon"><v-icon size="15" color="primary">mdi-tune-variant</v-icon></div>
              <span>Nastavení parsování</span>
            </div>
            <span class="auto-badge">
              <v-icon size="10">mdi-auto-fix</v-icon>
              AUTO
            </span>
          </div>
          
          <div class="settings-row">
            <!-- Delimiter -->
            <div class="setting-item">
              <span class="setting-label">Oddělovač</span>
              <div style="width: 120px;">
                <v-select
                  :model-value="props.parsingDelimiter || ''"
                  :items="delimiterOptions"
                  density="compact"
                  variant="outlined"
                  hide-details
                  item-title="title"
                  item-value="value"
                  bg-color="white"
                  style="font-size: 13px;"
                  @update:model-value="v => emits('update:parsingDelimiter', v)"
                />
              </div>
            </div>

            <div class="setting-divider"></div>

            <!-- Decimal Separator -->
            <div class="setting-item">
              <span class="setting-label">Desetinná čárka</span>
              <div style="width: 110px;">
                 <v-select
                  :model-value="props.parsingDecimalSeparator || '.'"
                  :items="decimalSeparatorOptions"
                  density="compact"
                  variant="outlined"
                  hide-details
                  item-title="title"
                  item-value="value"
                  bg-color="white"
                  style="font-size: 13px;"
                  @update:model-value="v => emits('update:parsingDecimalSeparator', v)"
                />
              </div>
            </div>

            <div class="setting-divider"></div>

            <!-- Skip rows / Header Row Picker -->
            <div class="setting-item">
              <span class="setting-label">Začátek dat</span>
              <div class="d-flex align-center ga-2">
                 <div class="stepper-control">
                  <button 
                    type="button" 
                    class="stepper-btn"
                    :disabled="(props.parsingHeaderRowIndex || 0) <= 0"
                    @click="emits('update:parsingHeaderRowIndex', (props.parsingHeaderRowIndex || 0) - 1)"
                  >−</button>
                  <span class="stepper-value" style="min-width: 40px; font-size: 12px;">
                    {{ (props.parsingHeaderRowIndex || 0) + 1 }}. řádek
                  </span>
                  <button 
                    type="button" 
                    class="stepper-btn"
                    :disabled="(props.parsingHeaderRowIndex || 0) >= totalRowCount - 1"
                    @click="emits('update:parsingHeaderRowIndex', (props.parsingHeaderRowIndex || 0) + 1)"
                  >+</button>
                </div>
                 <v-btn
                  size="x-small"
                  variant="tonal"
                  icon="mdi-target"
                  title="Vybrat řádek kliknutím"
                  @click="emits('pick-header-row')"
                />
              </div>
            </div>
            
            <div class="setting-divider"></div>
            
            <!-- Header checkbox -->
            <label class="checkbox-item">
              <input 
                type="checkbox" 
                :checked="props.parsingHasHeader !== false"
                @change="e => emits('update:parsingHasHeader', (e.target as HTMLInputElement).checked)"
              >
              <span class="setting-label">Hlavička</span>
            </label>
            
            <!-- Re-analyze button (shown only if settings differ from detected/current) -->
             <v-btn
              v-if="true" 
              size="small"
              variant="text"
              color="primary"
              prepend-icon="mdi-refresh"
              class="ml-auto"
              @click="analyze"
            >
              Přegenerovat
            </v-btn>
          </div>
        </div>
        
        <!-- Records Table -->
        <div class="records-section">
          <div class="records-header">
            <div class="records-icon"><v-icon size="15" color="primary">mdi-table</v-icon></div>
            <span>Rozpoznané hodnoty</span>
          </div>
          
          <div class="records-table-wrapper">
            <table class="records-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th v-for="(h, i) in props.importedStructure.blocks[0]?.headers" :key="i">{{ h }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in offsetRows.slice(0, 5)" :key="ri" :class="{ alternate: ri % 2 === 1 }">
                  <td class="row-number">{{ ri + 1 }}</td>
                  <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.import-panel {
  margin-bottom: 16px;
}

/* Toolbar */
.import-toolbar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 16px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Button styles removed to use global system from src/styles/global.scss */


.toolbar-divider {
  width: 1px;
  height: 24px;
  background: #e2e8f0;
  margin: 0 4px;
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Chips */
.info-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
}

.info-chip.file-chip {
  background: #e3f2fd;
  border: 1px solid #bbdefb;
}

.info-chip.text-chip {
  background: #f3e5f5;
  border: 1px solid #e1bee7;
}

.chip-filename {
  font-size: 0.8125rem;
  font-weight: 500;
  color: #1e293b;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-count {
  font-size: 0.75rem;
  color: #64748b;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 20px;
}

.status-chip.success {
  background: #dcfce7;
  color: #16a34a;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: #64748b;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}

/* Text input */
.text-input-section {
  padding: 12px;
  margin-top: 12px;
  background: #f8f9fa;
  border: 2px dashed #dee2e6;
  border-radius: 8px;
}

/* Status messages */
.status-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-top: 12px;
}

.status-msg.error {
  background: #fef2f2;
  color: #991b1b;
}

.status-msg.success {
  background: #f0fdf4;
  color: #166534;
}

.status-msg.warning {
  background: #fffbeb;
  color: #92400e;
}

.status-msg.info {
  background: #eff6ff;
  color: #1e40af;
}

/* Preview Section */
.preview-section {
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  margin-top: 16px;
}

.preview-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid #e2e8f0;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(180deg, #fafbfc 0%, #ffffff 100%);
}

.section-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #f59e0b;
  border-radius: 8px;
}

.section-icon.success {
  background: #1976d2;
}

.section-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1e293b;
}

.section-subtitle {
  font-size: 0.75rem;
  color: #64748b;
}

.section-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
}

.mini-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 16px;
  font-size: 0.75rem;
  font-weight: 500;
}

.mini-chip.primary {
  background: #e3f2fd;
  color: #1976d2;
}

.mini-chip.secondary {
  background: #f3e5f5;
  color: #9c27b0;
}

.section-spacer {
  flex: 1;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* .action-btn classes removed */


.btn-pulse {
  animation: pulse-orange 1s ease-in-out infinite;
  border-color: #f59e0b !important;
  color: #d97706 !important;
  font-weight: 700;
}

@keyframes pulse-orange {
  0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); transform: scale(1); }
  50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); transform: scale(1.05); }
  100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); transform: scale(1); }
}

/* Preview Content */
.preview-content {
  padding: 16px 18px;
}

/* Settings Card */
.settings-card {
  margin-bottom: 20px;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.settings-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

.settings-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #e3f2fd;
  border-radius: 6px;
}

.auto-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #1976d2;
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.6875rem;
  font-weight: 600;
}

.settings-row {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.setting-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.stepper-control {
  display: flex;
  align-items: center;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}

.stepper-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #f8fafc;
  cursor: pointer;
  color: #64748b;
  font-size: 14px;
}

.stepper-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stepper-value {
  width: 32px;
  text-align: center;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

.setting-divider {
  width: 1px;
  height: 24px;
  background: #e2e8f0;
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.checkbox-item input {
  width: 16px;
  height: 16px;
  accent-color: #1976d2;
}

/* Records Section */
.records-section {
  margin-bottom: 20px;
}

.records-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

.records-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #e3f2fd;
  border-radius: 6px;
}

.records-table-wrapper {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.records-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.value-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: #1e293b;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.records-table th {
  padding: 10px 12px;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  background: #f8fafc;
}

.records-table td {
  padding: 10px 12px;
  color: #1e293b;
  border-top: 1px solid #f1f5f9;
}

.records-table tr.alternate {
  background: #fafbfc;
}

.records-table .row-number {
  font-weight: 600;
  color: #1976d2;
}
</style>
