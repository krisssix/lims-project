<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Dialog from '@/components/Dialog.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import DeviceCreateDialog from '@/components/device/DeviceCreateDialog.vue'
import MappingWizardDialog from '@/components/import/MappingWizardDialog.vue'
import ManualHeaderPickerDialog from '@/components/import/ManualHeaderPickerDialog.vue'

import MeasurementMetaStep from './parts/MeasurementMetaStep.vue'
import ImportPanel from './parts/ImportPanel.vue'
import RecordsToolbar from './parts/RecordsToolbar.vue'
import BlocksNavigation from './parts/BlocksNavigation.vue'
import FieldsGrid from './parts/FieldsGrid.vue'
import SeriesSection, { type SeriesData } from './parts/SeriesSection.vue'
import ManualGridPickerDialog from './parts/ManualGridPickerDialog.vue'
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue'
import { parseFileToGrid, parseTextToGrid } from '@/utils/import/excelParser'


import { useDeviceStore } from '@/stores/devices'
import { useImportStore } from '@/stores/import'
import { type DeviceItem, type TemplateItem, type ValueType, type TemplateBlockRow } from '@/types/measurement-ui'
import { type MeasurementRequest, type MeasuredValue, type MeasurementSeriesRequest } from '@/stores/measurement'
import {
  newRecordFromTemplateFields,
  duplicateRecord,
  flattenRecords,
  extractSeries,
  computeBasicStats,
  type MeasurementRecord,
  type RecordField,
  toNumber,
  normalizeBool,
  toDateMs,
  validateField
} from '@/utils/measurement-record-helpers'
import {
  parseImportedMeasurementFile,
  checkTemplateCompatibility,
  buildRecordsFromImported,
  type ImportedFileStructure,
  type TemplateLike
} from '@/utils/import/importCompatibility'
import { buildMappingModel, exportMapping, applyLearnedSuggestions, type MappingModel } from '@/utils/import/importMapping'
import { isVectorCell, parseVectorCell } from '@/utils/import/vectorDetection'
import { isEditableElement } from '@/components/ui/hotkeyGuard'
import { parseCzechDate } from '@/utils/czechDateParser'
import { uploadFile, extractFilesFromRecords } from '@/services/api/file-upload'
import { useMeasurementImport } from '@/composables/useMeasurementImport'

const props = defineProps<{
  modelValue: boolean
  devices: DeviceItem[]
  templates: TemplateItem[]
  templateById: Map<string, TemplateItem>
  initialTemplateId?: string | null
  members?: Array<{ username: string }>
  /** BoardCard ID to link measurement to */
  boardCardId?: number | null
  /** When duplicating a measurement, pass the source measurement here */
  duplicateFrom?: {
    type: string | null  // template name
    unit: string | null  // device code
    values?: Array<{ fieldName: string; value: unknown; recordNumber?: number; blockIndex?: number }>
    note?: string | null
    measuredByUsername?: string | null
  } | null
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'save', payload: MeasurementRequest): void
  (e: 'createTemplate', deviceCode: string): void
  (e: 'createTemplateFromClipboard', deviceCode: string): void
  (e: 'deriveTemplate', templateId: string): void
}>()

/* Pop up*/
const showSuccessToast = ref(false)
const showValidationError = ref(false)
const validationErrorMessage = ref('')
const lastCreatedMeasurementId = ref<number | null>(null)

/* Warning dialogs */
const showClearAllWarning = ref(false)
const showApplyDataWarning = ref(false)
const showEmptySeriesWarning = ref(false)
const showGoBackWarning = ref(false)
const pendingAction = ref<'back' | 'close'>('back')

/* Series validation state */
const showSeriesValidation = ref(false)

/* Data Mapping Grid */
const showDataMappingGrid = ref(false)
const rawGridData = ref<(string | number)[][]>([])




/* Store + devices */
const deviceStore = useDeviceStore()
const storeDevices = computed(() => deviceStore.devices)
async function ensureDeviceStoreLoaded(): Promise<void> {
  if (!deviceStore.devices.length) {
    await deviceStore.fetchDevices().catch(() => {})
  }
}
void ensureDeviceStoreLoaded()

/* Dialog state */
const wizardStep = ref<1 | 2 | 3>(1)
const saving = ref(false)
const importPanelOpen = ref(false)
const mappingApplied = ref(false)  // Track if user applied custom mapping
const mappingAutoApplied = ref(false)  // Track if mapping was auto-applied from learned
const learnedMappingsAvailable = ref(false)  // Track if learned mappings exist for current import
const showHelp = ref(true)

/* Meta selections */
const selectedMember = ref<string>('')
const selectedDeviceId = ref<string>('')
const selectedTemplateId = ref<string | null>(null)
const measurementNote = ref<string>('')
const membersList = computed<string[]>(() => (props.members ?? []).map(m => m.username))

/* Handle duplicate mode - pre-fill from source measurement */
watch(() => props.duplicateFrom, (source) => {
  if (!source) return

  // Pre-fill device
  if (source.unit) {
    selectedDeviceId.value = source.unit
  }

  // Pre-fill template by name
  if (source.type) {
    const template = props.templates.find(t => t.name === source.type)
    if (template) {
      selectedTemplateId.value = template.id
    }
  }

  // Pre-fill note
  if (source.note) {
    measurementNote.value = source.note
  }

  // Pre-fill member
  if (source.measuredByUsername) {
    selectedMember.value = source.measuredByUsername
  }

  // Wait for template to be selected, then pre-fill records
  nextTick(() => {
    if (source.values && source.values.length > 0) {
      // Group values by record number
      const recordMap = new Map<number, Array<{ fieldName: string; value: unknown; blockIndex?: number }>>()
      for (const v of source.values) {
        const recNum = v.recordNumber ?? 1
        if (!recordMap.has(recNum)) recordMap.set(recNum, [])
        recordMap.get(recNum)!.push({ fieldName: v.fieldName, value: v.value, blockIndex: v.blockIndex })
      }

      // Initialize records from template first
      const tplFields = templateFields.value
      records.value = []

      for (const [recNum, fields] of recordMap) {
        const newRec: MeasurementRecord = {
          recordIndex: recNum,
          fields: tplFields.map(tf => {
            const match = fields.find(f => f.fieldName === tf.name && (f.blockIndex ?? 1) === (tf.blockIndex ?? 1))
            return {
              name: tf.name,
              type: tf.type,
              required: tf.required,
              value: match?.value ?? null,
              blockIndex: tf.blockIndex ?? 1,
              blockTitle: tf.blockTitle
            }
          })
        }
        records.value.push(newRec)
      }

      if (records.value.length > 0) {
        currentRecordIndex.value = records.value[0].recordIndex
        selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
      }
    }

    // Jump to step 2 (data)
    if (canProceedToData.value) {
      wizardStep.value = 2
    }
  })
}, { immediate: true })

/* Validation Step 1 */
const canProceedToData = computed(() => !!selectedDeviceId.value && !!selectedTemplateId.value)

/* Device create dialog */
const showDeviceCreate = ref(false)
function openDeviceCreate(): void { showDeviceCreate.value = true }
function onDeviceCreated(dev: { id: number; code: string; name: string; color?: string | null; active: boolean }): void {
  selectedDeviceId.value = dev.code
  showDeviceCreate.value = false
}

/* Records */
const records = ref<MeasurementRecord[]>([])
const currentRecordIndex = ref<number>(1)
const selectedRecordIndexes = ref<Set<number>>(new Set())

/* Block navigation */
const currentBlockIndex = ref<number>(0)

/* Derived template */
const selectedTemplate = computed<TemplateItem | null>(() => {
  if (!selectedTemplateId.value) return null
  return props.templateById.get(selectedTemplateId.value) ?? null
})
const templateBlocks = computed<TemplateBlockRow[]>(() => {
  const tpl = selectedTemplate.value
  if (!tpl) return []
  if (tpl.blocks && tpl.blocks.length > 0) {
    // Filter out series blocks - they go to SeriesSection, not regular block navigation
    // Check both kind AND title to ensure series aren't displayed as regular blocks
    return tpl.blocks.filter(b => {
      const isSeries = b.kind === 'series' ||
        (b.title?.toLowerCase().includes('série')) ||
        (b.title?.toLowerCase().includes('series'))
      return !isSeries
    })
  }
  return [{
    id: 0,
    blockIndex: 1,
    title: 'Hodnoty',
    fields: tpl.fields || []
  }]
})


/* Series blocks from template - displayed in SeriesSection */
const templateSeriesBlocks = computed<TemplateBlockRow[]>(() => {
  const tpl = selectedTemplate.value
  if (!tpl || !tpl.blocks) return []

  // Detect series blocks by:
  // 1. kind === 'series' (explicit backend flag)
  // 2. title containing série/series keywords
  // 3. title containing common series data patterns (size data, intensity, distribution)
  // 4. blocks with "Data" suffix and multiple numeric fields
  return tpl.blocks.filter(b => {
    const titleLower = b.title?.toLowerCase() || ''

    // Explicit series kind
    if (b.kind === 'series') return true

    // Direct série/series keyword
    if (titleLower.includes('série') || titleLower.includes('series')) return true

    // Common DLS/measurement series patterns
    if (titleLower.includes('size') && titleLower.includes('data')) return true
    if (titleLower.includes('intensity')) return true
    if (titleLower.includes('distribution')) return true

    // Blocks ending with "Data" that have multiple fields (likely series)
    if (titleLower.endsWith('data') && b.fields && b.fields.length >= 2) {
      // Check if most fields are numeric (float/int) - series indicator
      const numericFields = b.fields.filter(f => f.type === 'float' || f.type === 'int')
      return numericFields.length >= Math.floor(b.fields.length * 0.7)
    }

    return false
  })
})

/* Series field definitions from template - passed to SeriesSection for dynamic columns */
const seriesFieldDefinitions = computed<Array<{ name: string; type: 'float' | 'int' | 'text'; required: boolean }>>(() => {
  const blocks = templateSeriesBlocks.value
  if (!blocks.length) return []
  // Get fields from first series block as the column definition
  const firstBlock = blocks[0]
  if (!firstBlock?.fields?.length) return []
  return firstBlock.fields.map(f => ({
    name: f.name,
    type: f.type as 'float' | 'int' | 'text',
    required: f.required
  }))
})

const currentBlock = computed<TemplateBlockRow | null>(() =>
  templateBlocks.value[currentBlockIndex.value] ?? null
)
const templateFields = computed<Array<{ name: string; type: ValueType; required: boolean; blockIndex?: number; blockTitle?: string }>>(() => {
  if (!selectedTemplateId.value) return []
  const tpl = props.templateById.get(selectedTemplateId.value)
  if (!tpl) return []
  if (tpl.blocks && tpl.blocks.length > 0) {
    const fields: Array<{ name: string; type: ValueType; required: boolean; blockIndex: number; blockTitle: string }> = []
    for (const block of tpl.blocks) {
      // Skip series blocks - they are handled separately in SeriesSection
      // Same filter as templateBlocks uses
      const isSeries = block.kind === 'series' ||
        (block.title?.toLowerCase().includes('série')) ||
        (block.title?.toLowerCase().includes('series'))
      if (isSeries) continue

      for (const field of block.fields) {
        fields.push({
          name: field.name,
          type: field.type,
          required: field.required,
          blockIndex: block.blockIndex,
          blockTitle: block.title
        })
      }
    }
    return fields
  }
  return (tpl.fields ?? []).map(f => ({
    name: f.name,
    type: f.type,
    required: f.required,
    blockIndex: 1,
    blockTitle: 'Hodnoty'
  }))
})

/* Current block fields */
const currentBlockFields = computed<RecordField[]>(() => {
  const rec = records.value.find(r => r.recordIndex === currentRecordIndex.value)
  if (!rec || !currentBlock.value) return []
  const blockIdx = currentBlock.value.blockIndex
  return rec.fields.filter(f => (f.blockIndex ?? 1) === blockIdx)
})

/* Helpers for template bindings */
function textModel(field: RecordField): string | number | null {
  const val = field.value
  return (val === undefined ? null : (val as string | number | null))
}
function dateModel(field: RecordField): string | null {
  const val = field.value
  // If already a number (epoch ms), convert to YYYY-MM-DD
  if (typeof val === 'number') {
    return new Date(val).toISOString().slice(0, 10)
  }
  // If string, try to parse as Czech date (e.g. "4. října 2022 16:58:51")
  if (typeof val === 'string' && val.trim()) {
    const parsed = parseCzechDate(val)
    if (parsed.success && parsed.date) {
      return parsed.date.toISOString().slice(0, 10)
    }
    // If already in YYYY-MM-DD format, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return val
    }
  }
  return null
}
function timeModel(field: RecordField): string | null {
  const val = field.value
  // If already a number (epoch ms), extract time as HH:MM
  if (typeof val === 'number') {
    const d = new Date(val)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  // If string, try to parse as Czech date (e.g. "4. října 2022 16:58:51")
  if (typeof val === 'string' && val.trim()) {
    const parsed = parseCzechDate(val)
    if (parsed.success && parsed.hours !== null && parsed.minutes !== null) {
      return `${parsed.hours.toString().padStart(2, '0')}:${parsed.minutes.toString().padStart(2, '0')}`
    }
  }
  return null
}
function fileModel(field: RecordField): File | null {
  const v = field.value
  return v && typeof v === 'object' && 'name' in (v as Record<string, unknown>) ? (v as File) : null
}

/* Numeric fields + stats */
const numericFieldNames = computed<string[]>(() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of records.value) {
    for (const f of r.fields) {
      let isNumeric = f.type === 'float' || f.type === 'int'
      if (!isNumeric && f.type === 'text') {
        const n = toNumber(f.value, false)
        isNumeric = n != null && Number.isFinite(n)
      }
      if (isNumeric && !seen.has(f.name)) {
        seen.add(f.name)
        out.push(f.name)
      }
    }
  }
  return out
})
const selectedNumericField = ref<string | null>(null)
const statsCollapsed = ref(true)
watch(numericFieldNames, list => {
  if (!list.length) selectedNumericField.value = null
  else if (!selectedNumericField.value) selectedNumericField.value = list[0]!
})
const chartPoints = computed<number[]>(() => {
  if (!selectedNumericField.value) return []
  const subset = selectedRecordIndexes.value.size
    ? Array.from(selectedRecordIndexes.value)
    : records.value.map(r => r.recordIndex)
  const subsetRecords = records.value.filter(r => subset.includes(r.recordIndex))
  return extractSeries(subsetRecords, selectedNumericField.value)
})
const statsObj = computed(() => computeBasicStats(chartPoints.value))

/* Validation state */
const visitedFields = ref<Set<string>>(new Set())
const touchedFields = ref<Set<string>>(new Set())
function fieldKey(field: RecordField): string { return `${currentRecordIndex.value}-${field.name}` }
function markFieldVisited(field: RecordField): void { visitedFields.value.add(fieldKey(field)) }
function markFieldTouched(field: RecordField): void { touchedFields.value.add(fieldKey(field)) }
function isFieldVisited(field: RecordField): boolean { return visitedFields.value.has(fieldKey(field)) }
function isFieldTouched(field: RecordField): boolean { return touchedFields.value.has(fieldKey(field)) }
function requiredEmptyPristine(field: RecordField): boolean {
  const empty = field.value == null || String(field.value).trim() === ''
  return field.required && empty && !isFieldVisited(field)
}
function fieldError(field: RecordField): string | null {
  if (!isFieldTouched(field)) return null
  return validateField(field)
}
const invalidTotal = computed<number>(() => {
  let count = 0
  records.value.forEach(r =>
    r.fields.forEach(f => { if (validateField(f)) count++ })
  )
  return count
})
const canSave = computed<boolean>(() =>
  !!selectedTemplateId.value &&
  !!selectedDeviceId.value &&
  invalidTotal.value === 0
)

/* Series validation computed properties */
// Check if any series has at least one non-null value
const seriesHasAnyData = computed<boolean>(() => {
  return seriesData.value.some(s =>
    s.data.some(row =>
      Object.values(row).some(val => val !== null && val !== '')
    )
  )
})

// Check if series has empty required fields when at least one value exists
const seriesHasIncompleteData = computed<boolean>(() => {
  if (!seriesHasAnyData.value) return false

  return seriesData.value.some(s => {
    const columns = s.columns || []
    return s.data.some(row =>
      columns.some(col => col.required && (row[col.name] === null || row[col.name] === ''))
    )
  })
})

// Check if series exists from template but is completely empty
const seriesIsEmpty = computed<boolean>(() => {
  return templateSeriesBlocks.value.length > 0 && !seriesHasAnyData.value
})

/* Dirty state detection - check if user has made any changes */
const hasAnyChanges = computed<boolean>(() => {
  // Check if any record has values
  const hasRecordData = records.value.some(r =>
    r.fields.some(f => f.value !== null && f.value !== '' && f.value !== undefined)
  )
  // Check if series has data
  const hasSeriesData = seriesHasAnyData.value
  // Check if notes added
  const hasNotes = !!measurementNote.value && measurementNote.value.trim() !== ''
  // Check if file imported
  const hasImportedFile = !!importedFile.value

  return hasRecordData || hasSeriesData || hasNotes || hasImportedFile
})

/* Focus helpers */
function focusFieldByIndex(idx: number, flashAnimation = false): void {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-field-input]')
    const el = els[idx]
    if (!el) return

    // Scroll into view first
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Focus after scroll
    setTimeout(() => {
      el.focus()

      // Add flash animation if requested
      if (flashAnimation) {
        const row = el.closest('.data-row') as HTMLElement | null
        if (row) {
          row.classList.add('field-highlight-error')
          setTimeout(() => row.classList.remove('field-highlight-error'), 2000)
        }
      }
    }, 300)
  })
}
function focusFirstInvalidInCurrentBlock(): void {
  nextTick(() => {
    const fields = currentBlockFields.value
    const firstBad = fields.findIndex(f => validateField(f))
    if (firstBad >= 0) focusFieldByIndex(firstBad, true)
  })
}

/**
 * Find first invalid field across ALL records and blocks, navigate there, show error.
 * Returns true if found invalid field, false if all valid.
 */
function goToFirstInvalidField(): boolean {
  for (const record of records.value) {
    for (const field of record.fields) {
      const error = validateField(field)
      if (error) {
        console.warn('[DEBUG goToFirstInvalidField] Found invalid field:', {
          recordIndex: record.recordIndex,
          fieldName: field.name,
          fieldType: field.type,
          fieldValue: field.value,
          required: field.required,
          blockIndex: field.blockIndex,
          error: error
        })

        // Find which block this field belongs to
        const blockIdx = templateBlocks.value.findIndex(b => b.blockIndex === (field.blockIndex ?? 1))
        console.warn('[DEBUG goToFirstInvalidField] Block index for field:', blockIdx, 'Template blocks:', templateBlocks.value.map(b => ({ blockIndex: b.blockIndex, title: b.title })))

        // Navigate to that record and block
        currentRecordIndex.value = record.recordIndex
        if (blockIdx >= 0) currentBlockIndex.value = blockIdx

        // Show error message
        validationErrorMessage.value = `Záznam ${record.recordIndex}: pole "${field.name}" - ${error}`
        showValidationError.value = true

        // Focus the field after navigation
        nextTick(() => {
          const fieldsInBlock = record.fields.filter(f => (f.blockIndex ?? 1) === (field.blockIndex ?? 1))
          const fieldIdxInBlock = fieldsInBlock.findIndex(f => f.name === field.name)
          if (fieldIdxInBlock >= 0) focusFieldByIndex(fieldIdxInBlock, true)
        })

        return true
      }
    }
  }
  return false
}

/* Block navigation */
function prevBlock(): void { if (currentBlockIndex.value > 0) currentBlockIndex.value-- }
function nextBlock(): void { if (currentBlockIndex.value < templateBlocks.value.length - 1) currentBlockIndex.value++ }

/* Watch for external template selection (e.g., after creating a new template) */
watch(() => props.initialTemplateId, (newId) => {
  if (newId && props.modelValue) {
    selectedTemplateId.value = newId
  }
})

/* When selected template changes, reset series data and import state */
watch(selectedTemplateId, (newVal, oldVal) => {
  // Skip if templateId is being set for the first time (from null) or unchanged
  if (oldVal === null || newVal === oldVal) return

  // Clear all data when template changes - fresh start for the new template
  seriesData.value = []
  resetImport()
  records.value = []
  currentBlockIndex.value = 0
  currentRecordIndex.value = 1
  selectedRecordIndexes.value = new Set()
  visitedFields.value.clear()
  touchedFields.value.clear()
})

/* Initialization */
/* Initialization */
function initDialog(): void {
  wizardStep.value = 1
  selectedMember.value = membersList.value.length ? membersList.value[0]! : ''
  selectedDeviceId.value = ''
  selectedTemplateId.value = props.initialTemplateId ?? null
  records.value = []
  currentRecordIndex.value = 1
  currentBlockIndex.value = 0
  selectedRecordIndexes.value = new Set()
  selectedNumericField.value = null
  showHelp.value = true
  visitedFields.value.clear()
  touchedFields.value.clear()
  seriesData.value = [] // Reset series data when dialog opens
  resetImport()
}

/* Step transition */
function goToNextStep(): void {
  console.warn('[DEBUG goToNextStep] Current step:', wizardStep.value)
  console.warn('[DEBUG goToNextStep] Records count:', records.value.length)
  console.warn('[DEBUG goToNextStep] Series data:', JSON.stringify(seriesData.value, null, 2))

  if (wizardStep.value === 1) {
    if (!canProceedToData.value) return
    // Initialize records if empty
    if (records.value.length === 0) {
      records.value = [newRecordFromTemplateFields(1, templateFields.value)]
      currentRecordIndex.value = 1
      currentBlockIndex.value = 0
      selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
      visitedFields.value.clear()
      touchedFields.value.clear()

      // Initialize series data from template series blocks (if any)
      // This creates empty series entries with correct structure from template definition
      const seriesBlocks = templateSeriesBlocks.value
      console.warn('[DEBUG goToNextStep] Series blocks from template:', seriesBlocks)
      if (seriesBlocks.length > 0) {
        seriesData.value = seriesBlocks.map((block, idx) => {
          // Convert block fields to column definitions
          const columns = block.fields?.map(f => ({
            name: f.name,
            type: f.type as 'float' | 'int' | 'text',
            required: f.required
          })) || []

          // Create 5 empty placeholder rows with null values
          const emptyRows: Record<string, number | string | null>[] = []
          for (let i = 0; i < 5; i++) {
            const row: Record<string, number | string | null> = {}
            columns.forEach(col => {
              row[col.name] = null  // Empty placeholder, user fills in
            })
            emptyRows.push(row)
          }

          return {
            seriesType: block.title || `Série ${idx + 1}`,
            seriesName: block.title || undefined,
            linkedRecordIndex: currentRecordIndex.value,
            linkedRecordDescription: `Záznam ${currentRecordIndex.value}`,
            columns: columns,  // Include column definitions
            data: emptyRows
          }
        })
        console.warn('[DEBUG goToNextStep] Initialized series data:', seriesData.value)
      } else {
        seriesData.value = []
      }

    }
    wizardStep.value = 2
    nextTick(() => {
      const el = document.querySelector<HTMLElement>('[data-field-input]')
      el?.focus()
    })
  } else if (wizardStep.value === 2) {
    // Mark all fields as touched to show validation errors
    records.value.forEach(r => r.fields.forEach(f => markFieldTouched(f)))

    // Enable series validation display
    showSeriesValidation.value = true

    console.warn('[DEBUG goToNextStep] Step 2 -> 3 validation')
    console.warn('[DEBUG goToNextStep] invalidTotal:', invalidTotal.value)
    console.warn('[DEBUG goToNextStep] seriesHasAnyData:', seriesHasAnyData.value)
    console.warn('[DEBUG goToNextStep] seriesHasIncompleteData:', seriesHasIncompleteData.value)
    console.warn('[DEBUG goToNextStep] seriesIsEmpty:', seriesIsEmpty.value)

    // Check validation - if invalid, go to first error
    if (invalidTotal.value > 0) {
      console.warn('[DEBUG goToNextStep] Validation failed, finding first invalid field...')
      goToFirstInvalidField()
      return
    }

    // Check if series has incomplete required data
    if (seriesHasIncompleteData.value) {
      validationErrorMessage.value = 'Datová série obsahuje nezadaná povinná pole. Doplňte hodnoty nebo smažte prázdné řádky.'
      showValidationError.value = true
      return
    }

    // Check if series is completely empty - show warning dialog
    if (seriesIsEmpty.value) {
      showEmptySeriesWarning.value = true
      return
    }

    console.warn('[DEBUG goToNextStep] Validation passed, going to step 3')
    wizardStep.value = 3
  }
}


/* Navigation with unsaved changes warning */
function goToPrevStep(): void {
  if (wizardStep.value === 2) {
    wizardStep.value = 1
  } else if (wizardStep.value === 3) {
    wizardStep.value = 2
  }
}

function requestGoBack(): void {
  console.log('[DEBUG requestGoBack]', {
    step: wizardStep.value,
    hasChanges: hasAnyChanges.value,
    showWarning: showGoBackWarning.value
  })
  // From step 2: check if there are changes
  if (wizardStep.value === 2 && hasAnyChanges.value) {
    console.log('[DEBUG] Showing go back warning dialog')
    pendingAction.value = 'back'
    showGoBackWarning.value = true
  } else {
    console.log('[DEBUG] Going back directly')
    goToPrevStep()
  }
}

function requestCancel(): void {
  if (hasAnyChanges.value) {
    pendingAction.value = 'close'
    showGoBackWarning.value = true
  } else {
    close()
  }
}

function confirmGoBack(): void {
  showGoBackWarning.value = false
  // Reset all data
  doClearAll()

  if (pendingAction.value === 'close') {
    close()
  } else {
    goToPrevStep()
  }
}

function close(): void { emits('update:modelValue', false) }

/* Series warning confirmation */
function confirmSaveWithoutSeries(): void {
  showEmptySeriesWarning.value = false
  // Clear empty series data before proceeding
  seriesData.value = []
  wizardStep.value = 3
}

/* ============================================
   DRAFTS FUNCTIONALITY - localStorage
   ============================================ */
const DRAFT_STORAGE_KEY = 'measurement-create-draft'
const showDraftDialog = ref(false)

interface MeasurementDraft {
  templateId: string | number | null
  deviceId: string | number | null
  memberId: string | null
  records: typeof records.value
  seriesData: typeof seriesData.value
  measurementNote: string
  savedAt: number
}

// Check if draft exists in localStorage
const hasDraft = computed<boolean>(() => {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
    return !!stored
  } catch {
    return false
  }
})

// Get draft info without loading
function getDraftInfo(): { savedAt: Date; templateId: number | null } | null {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!stored) return null
    const draft = JSON.parse(stored) as MeasurementDraft
    return { savedAt: new Date(draft.savedAt), templateId: draft.templateId }
  } catch {
    return null
  }
}

// Save current state as draft
function saveDraft(): void {
  try {
    const draft: MeasurementDraft = {
      templateId: selectedTemplateId.value,
      deviceId: selectedDeviceId.value,
      memberId: selectedMember.value,
      records: JSON.parse(JSON.stringify(records.value)),
      seriesData: JSON.parse(JSON.stringify(seriesData.value)),
      measurementNote: measurementNote.value,
      savedAt: Date.now()
    }
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
    // Show success feedback
    validationErrorMessage.value = 'Koncept byl uložen'
    showValidationError.value = true
  } catch (e) {
    console.error('Failed to save draft:', e)
  }
}

// Load draft from localStorage
function loadDraft(): void {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!stored) return

    const draft = JSON.parse(stored) as MeasurementDraft

    // Restore state - cast to expected types
    if (draft.templateId != null) selectedTemplateId.value = draft.templateId as typeof selectedTemplateId.value
    if (draft.deviceId != null) selectedDeviceId.value = draft.deviceId as typeof selectedDeviceId.value
    if (draft.memberId) selectedMember.value = draft.memberId
    if (draft.measurementNote) measurementNote.value = draft.measurementNote
    if (draft.records) records.value = draft.records
    if (draft.seriesData) seriesData.value = draft.seriesData

    showDraftDialog.value = false

    // Go to step 2 if we have template selected
    if (draft.templateId && draft.deviceId) {
      wizardStep.value = 2
    }
  } catch (e) {
    console.error('Failed to load draft:', e)
  }
}

// Clear draft from localStorage
function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch (e) {
    console.error('Failed to clear draft:', e)
  }
}

// Dismiss draft dialog without loading
function dismissDraftDialog(): void {
  showDraftDialog.value = false
  clearDraft()
}

/* Record operations */
function addRecord(): void {
  const nextIdx = records.value.length
    ? Math.max(...records.value.map(r => r.recordIndex)) + 1
    : 1
  const rec = newRecordFromTemplateFields(nextIdx, templateFields.value)
  records.value.push(rec)
  currentRecordIndex.value = rec.recordIndex
  currentBlockIndex.value = 0
  selectedRecordIndexes.value.add(rec.recordIndex)
  visitedFields.value.clear()
  touchedFields.value.clear()
  nextTick(() => {
    const el = document.querySelector<HTMLElement>('[data-field-input]')
    el?.focus()
  })
}
function duplicateCurrentRecord(): void {
  const curr = records.value.find(r => r.recordIndex === currentRecordIndex.value)
  if (!curr) return
  const nextIdx = Math.max(...records.value.map(r => r.recordIndex)) + 1
  const dup = duplicateRecord(curr, nextIdx)
  records.value.push(dup)
  currentRecordIndex.value = dup.recordIndex
  currentBlockIndex.value = 0
  selectedRecordIndexes.value.add(dup.recordIndex)
  visitedFields.value.clear()
  touchedFields.value.clear()
  nextTick(() => {
    const el = document.querySelector<HTMLElement>('[data-field-input]')
    el?.focus()
  })
}
function deleteCurrentRecord(): void {
  if (records.value.length <= 1) return
  const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
  if (idx === -1) return

  // Find the next record to select after deletion
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const posInSorted = sorted.indexOf(currentRecordIndex.value)

  // Remove the record
  records.value.splice(idx, 1)

  // After deletion, pick the next record (or previous if we deleted the last one)
  const newSorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  if (posInSorted < newSorted.length) {
    // There's still a record at this position (the one that was after the deleted)
    currentRecordIndex.value = newSorted[posInSorted]!
  } else {
    // We deleted the last one, go to the new last record
    currentRecordIndex.value = newSorted[newSorted.length - 1]!
  }

  currentBlockIndex.value = 0
  if (!selectedRecordIndexes.value.size) {
    selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  }
  visitedFields.value.clear()
  touchedFields.value.clear()
}
function toPrevRecord(): void {
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const pos = sorted.indexOf(currentRecordIndex.value)
  if (pos > 0) {
    currentRecordIndex.value = sorted[pos - 1]!
    currentBlockIndex.value = 0
    visitedFields.value.clear()
    touchedFields.value.clear()
  }
}
function toNextRecord(): void {
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const pos = sorted.indexOf(currentRecordIndex.value)
  if (pos < sorted.length - 1) {
    currentRecordIndex.value = sorted[pos + 1]!
    currentBlockIndex.value = 0
    visitedFields.value.clear()
    touchedFields.value.clear()
  }
}
function toggleRecordSelection(idx: number, multi: boolean): void {
  if (multi) {
    if (selectedRecordIndexes.value.has(idx)) selectedRecordIndexes.value.delete(idx)
    else selectedRecordIndexes.value.add(idx)
    if (!selectedRecordIndexes.value.size) selectedRecordIndexes.value.add(idx)
  } else {
    currentRecordIndex.value = idx
    currentBlockIndex.value = 0
  }
}

/* Field edit */
function updateField(field: RecordField, raw: unknown): void {
  markFieldTouched(field)
  switch (field.type) {
    case 'float': field.value = toNumber(raw, false); break
    case 'int': field.value = toNumber(raw, true); break
    case 'bool': field.value = normalizeBool(raw); break
    case 'date': field.value = toDateMs(raw); break
    case 'file': field.value = raw; break
    case 'text':
    default: field.value = raw ?? ''
  }
}

function updateTimeField(field: RecordField, timeStr: string): void {
  markFieldTouched(field)
  // Get existing date from field, or use today as fallback
  let datePart: string | null = dateModel(field)
  if (!datePart) {
    // Use today's date if no date is set
    datePart = new Date().toISOString().slice(0, 10)
  }
  // Combine date and time into epoch milliseconds
  const [hours, minutes] = (timeStr || '00:00').split(':').map(Number)
  const [year, month, day] = datePart.split('-').map(Number)
  const combined = new Date(year, month - 1, day, hours || 0, minutes || 0, 0)
  field.value = combined.getTime()
}

/* Import state - from composable */
const {
  importedFile,
  importedStructure,
  importCompatibility,
  importBusy,
  importError,
  importRowOffset,
  mappingOpen,
  mappingModel,
  isImportCompatible,
  onImportFilePicked: composableOnImportFilePicked,
  resetImport: composableResetImport,
  parseImportFile,
  checkCompatibility
} = useMeasurementImport()

// Count how many template fields don't have matching headers in imported data
const unmappedFieldsCount = computed<number>(() => {
  if (!importedStructure.value || !selectedTemplate.value) return 0
  const tmpl = buildTemplateLike()
  if (!tmpl) return 0

  const importedHeaders = importedStructure.value.blocks[0]?.headers || []
  const normalizeHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
  const normalizedImported = importedHeaders.map(normalizeHeader)

  let unmapped = 0
  for (const block of tmpl.blocks) {
    for (const field of block.fields) {
      const normalizedField = normalizeHeader(field.name)
      const hasMatch = normalizedImported.some(h =>
        h === normalizedField || h.includes(normalizedField) || normalizedField.includes(h)
      )
      if (!hasMatch) unmapped++
    }
  }
  return unmapped
})

/* Manual grid picker */
const gridPickerOpen = ref(false)
const gridPickerTargetField = ref('')
const gridPickerData = computed(() => {
  if (!importedStructure.value || importedStructure.value.blocks.length === 0) return null
  const block = importedStructure.value.blocks[0]!
  return {
    headers: block.headers,
    rows: block.rows
  }
})

/**
 * Convert imported series data to 2D string array for SeriesDataPicker
 * Combines all series columns into a single table: header row + data rows
 * Falls back to main block rows if no series data
 */
const seriesRawDataForPicker = computed<string[][] | undefined>(() => {
  const structure = importedStructure.value
  if (!structure) return undefined

  // If we have series data, convert it to 2D array
  if (structure.series && structure.series.length > 0) {
    // Collect all unique column names from all series
    const allColumns: string[] = []
    const seenCols = new Set<string>()

    for (const s of structure.series) {
      if (s.columns && s.columns.length > 0) {
        for (const col of s.columns) {
          if (!seenCols.has(col.name)) {
            seenCols.add(col.name)
            allColumns.push(col.name)
          }
        }
      } else {
        // Default x/y columns
        if (!seenCols.has(s.xLabel)) { seenCols.add(s.xLabel); allColumns.push(s.xLabel) }
        if (!seenCols.has(s.yLabel)) { seenCols.add(s.yLabel); allColumns.push(s.yLabel) }
      }
    }

    if (allColumns.length === 0) return structure.blocks[0]?.originalRows

    // Create header row
    const rows: string[][] = [allColumns]

    // Find max data length across all series
    let maxDataLen = 0
    for (const s of structure.series) {
      if (Array.isArray(s.data)) {
        maxDataLen = Math.max(maxDataLen, s.data.length)
      }
    }

    // Create data rows - merge all series data
    for (let i = 0; i < maxDataLen; i++) {
      const row: string[] = allColumns.map(() => '')

      for (const s of structure.series) {
        if (!Array.isArray(s.data) || !s.data[i]) continue
        const dataPoint = s.data[i]

        // Handle {x, y} format
        if ('x' in dataPoint && 'y' in dataPoint) {
          const xColIdx = allColumns.indexOf(s.xLabel)
          const yColIdx = allColumns.indexOf(s.yLabel)
          if (xColIdx >= 0 && dataPoint.x != null) row[xColIdx] = String(dataPoint.x)
          if (yColIdx >= 0 && dataPoint.y != null) row[yColIdx] = String(dataPoint.y)
        }
        // Handle Record<string, ...> format
        else if (typeof dataPoint === 'object') {
          for (const [key, val] of Object.entries(dataPoint)) {
            const colIdx = allColumns.indexOf(key)
            if (colIdx >= 0 && val != null) row[colIdx] = String(val)
          }
        }
      }

      rows.push(row)
    }

    console.log('[seriesRawDataForPicker] Created', rows.length, 'rows from series data, columns:', allColumns)
    return rows
  }

  // Fallback to main block rows
  return structure.blocks[0]?.originalRows
})

function openGridPicker(fieldName: string): void {
  gridPickerTargetField.value = fieldName
  gridPickerOpen.value = true
}

function applyGridPickerValues(values: (string | number)[]): void {
  // Distribute values across records for the target field
  const fieldName = gridPickerTargetField.value

  // Auto-create records if we need more than exist
  const neededRecords = values.length
  const existingRecords = records.value.length

  if (neededRecords > existingRecords) {
    for (let i = existingRecords; i < neededRecords; i++) {
      const nextIdx = records.value.length
        ? Math.max(...records.value.map(r => r.recordIndex)) + 1
        : 1
      const rec = newRecordFromTemplateFields(nextIdx, templateFields.value)
      records.value.push(rec)
      selectedRecordIndexes.value.add(rec.recordIndex)
    }
  }

  const sortedRecords = [...records.value].sort((a, b) => a.recordIndex - b.recordIndex)

  values.forEach((val, idx) => {
    const record = sortedRecords[idx]
    if (!record) return

    const field = record.fields.find(f => f.name === fieldName)
    if (field) {
      // Parse value based on field type
      if (field.type === 'int') {
        field.value = parseInt(String(val), 10) || 0
      } else if (field.type === 'float') {
        const normalized = String(val).replace(',', '.')
        field.value = parseFloat(normalized) || 0
      } else if (field.type === 'date') {
        // Try to parse date values
        const dateMs = toDateMs(String(val))
        field.value = dateMs ?? val
      } else {
        field.value = val
      }
    }
  })

  // Navigate to the first record to see the applied values
  if (sortedRecords[0]) {
    currentRecordIndex.value = sortedRecords[0].recordIndex
    currentBlockIndex.value = 0
  }
}

/* Series state */
const seriesData = ref<SeriesData[]>([])
const recordOptions = computed(() =>
  records.value.map(r => ({
    title: `Záznam ${r.recordIndex}`,
    value: r.recordIndex
  }))
)

/* Filtered series - only show series for current record or unlinked series */
const currentRecordSeriesData = computed<SeriesData[]>({
  get: () => {
    return seriesData.value.filter(s =>
      s.linkedRecordIndex === null ||
      s.linkedRecordIndex === currentRecordIndex.value
    )
  },
  set: (newFiltered: SeriesData[]) => {
    // When SeriesSection updates, merge changes back to full list
    // This is tricky - we need to update only the matching items
    const otherSeries = seriesData.value.filter(s =>
      s.linkedRecordIndex !== null &&
      s.linkedRecordIndex !== currentRecordIndex.value
    )
    seriesData.value = [...otherSeries, ...newFiltered]
  }
})

function addEmptySeries(): void {
  seriesData.value.push({
    seriesType: 'OTHER',
    seriesName: '',
    linkedRecordIndex: null,
    linkedRecordDescription: '',
    data: []
  })
}

function addEmptySeriesForCurrentRecord(): void {
  seriesData.value.push({
    seriesType: 'OTHER',
    seriesName: '',
    linkedRecordIndex: currentRecordIndex.value,
    linkedRecordDescription: `Záznam ${currentRecordIndex.value}`,
    data: []
  })
}

function removeSeries(filteredIdx: number): void {
  // Get the series from filtered list
  const filtered = currentRecordSeriesData.value
  const seriesToRemove = filtered[filteredIdx]
  if (!seriesToRemove) return

  // Find it in the full list and remove
  const fullIdx = seriesData.value.findIndex(s =>
    s.seriesName === seriesToRemove.seriesName &&
    s.linkedRecordIndex === seriesToRemove.linkedRecordIndex &&
    s.seriesType === seriesToRemove.seriesType
  )
  if (fullIdx !== -1) {
    seriesData.value.splice(fullIdx, 1)
  }
}

/* Import helpers */
function toggleImportPanel(): void {
  if (!selectedTemplate.value) return
  importPanelOpen.value = !importPanelOpen.value
}
function resetImport(): void {
  composableResetImport()
}

/**
 * Open the Data Mapping Grid dialog
 * Converts imported data to grid format for manual mapping
 */
function openDataMappingGrid(): void {
  console.log('[openDataMappingGrid] Called', {
    hasBlocks: !!importedStructure.value?.blocks?.length,
    hasFile: !!importedFile.value,
    blocksCount: importedStructure.value?.blocks?.length
  })

  // Try to build grid from imported structure blocks
  if (importedStructure.value?.blocks?.length) {
    const grids: (string | number)[][] = []
    for (const block of importedStructure.value.blocks) {
      if (block.headers?.length) {
        grids.push(block.headers)
      }
      for (const row of block.rows ?? []) {
        grids.push(row)
      }
    }
    console.log('[openDataMappingGrid] Built grid from blocks:', grids.length, 'rows')

    if (grids.length > 0) {
      rawGridData.value = grids
      showDataMappingGrid.value = true
      return
    }
  }

  // If blocks are empty, try to parse file directly
  if (importedFile.value) {
    console.log('[openDataMappingGrid] Parsing file:', importedFile.value.name)
    parseFileToGrid(importedFile.value).then(result => {
      console.log('[openDataMappingGrid] Parse result:', result.success, result.grid?.length, 'rows')
      if (result.success && result.grid.length > 0) {
        rawGridData.value = result.grid
        showDataMappingGrid.value = true
      } else {
        console.warn('[openDataMappingGrid] No data in file')
      }
    }).catch(err => {
      console.error('[openDataMappingGrid] Parse error:', err)
    })
    return
  }

  console.warn('[openDataMappingGrid] No data to map - no blocks and no file')
}

/**
 * Apply mappings from DataMappingGrid to records
 */
function onMappingApply(mappings: FieldMapping[]): void {
  if (!selectedTemplate.value || rawGridData.value.length === 0) return

  // For each mapping, extract data and fill records
  const newRecords: MeasurementRecord[] = []

  // Find max data row count
  let maxDataRows = 0
  for (const m of mappings) {
    if (m.dataCells.length > maxDataRows) maxDataRows = m.dataCells.length
  }

  // Create records from mapped data
  for (let i = 0; i < Math.max(1, maxDataRows); i++) {
    const rec = newRecordFromTemplateFields(i + 1, templateFields.value)

    for (const m of mappings) {
      const field = rec.fields.find(f => f.name === m.fieldName)
      if (!field) continue

      // Get value from grid
      const dataCell = m.dataCells[i]
      if (dataCell) {
        const val = rawGridData.value[dataCell.row]?.[dataCell.col]
        if (val !== undefined && val !== '') {
          field.value = val
        }
      }
    }

    newRecords.push(rec)
  }

  if (newRecords.length > 0) {
    records.value = newRecords
    currentRecordIndex.value = 1
    currentBlockIndex.value = 0
    selectedRecordIndexes.value = new Set(newRecords.map(r => r.recordIndex))
  }

  showDataMappingGrid.value = false
}

/**
 * Apply selections from ManualHeaderPickerDialog
 * tableHeaders -> become field values in records
 * seriesHeaders -> become series data columns
 */
function onManualHeaderPickerApply(result: { tableHeaders: string[], seriesHeaders: string[], headerRowIndex: number | null }): void {
  console.log('[onManualHeaderPickerApply] Received:', result)

  const { tableHeaders, seriesHeaders } = result

  // If we got table headers, match them to template fields and create records
  if (tableHeaders.length > 0) {
    // Try to find matching template fields or use headers as field values
    const rec = records.value.find(r => r.recordIndex === currentRecordIndex.value)
    if (rec) {
      // For each table header, try to fill a matching field
      for (let i = 0; i < tableHeaders.length && i < rec.fields.length; i++) {
        rec.fields[i].value = tableHeaders[i]
      }
    }
    console.log('[onManualHeaderPickerApply] Applied', tableHeaders.length, 'table headers to current record')
  }

  // If we got series headers, create a new series with those columns
  if (seriesHeaders.length > 0) {
    const newSeries: SeriesData = {
      seriesType: 'OTHER',
      seriesName: 'Importovaná série',
      linkedRecordIndex: currentRecordIndex.value,
      linkedRecordDescription: `Záznam ${currentRecordIndex.value}`,
      columns: seriesHeaders.map(name => ({
        name,
        type: 'float' as const,
        required: false
      })),
      data: [
        // Create first row with column names as initial structure
        seriesHeaders.reduce((acc, name) => {
          acc[name] = null
          return acc
        }, {} as Record<string, number | string | null>)
      ]
    }
    seriesData.value.push(newSeries)
    console.log('[onManualHeaderPickerApply] Added new series with', seriesHeaders.length, 'columns')
  }

  showDataMappingGrid.value = false
}


/**
 * Check if any field has meaningful data filled in (ignoring empty records)
 */
function hasFilledData(): boolean {
  // If we have more than one record, consider it as having data
  if (records.value.length > 1) return true
  // Check if any field has a non-empty value
  for (const record of records.value) {
    for (const field of record.fields) {
      const val = field.value
      if (val !== null && val !== '' && val !== undefined) {
        // 0 and false are valid data
        if (typeof val === 'number' || typeof val === 'boolean') return true
        if (typeof val === 'string' && val.trim() !== '') return true
      }
    }
  }
  return seriesData.value.length > 0
}

/**
 * Clear all data - no confirmation needed
 */
function requestClearAll(): void {
  doClearAll()
}

/**
 * Actually clear all data
 */
function doClearAll(): void {
  console.log('[doClearAll] Clearing all data')
  showClearAllWarning.value = false

  // Clear import state
  resetImport()

  // Reset records to fresh empty state (1 empty record)
  records.value = [newRecordFromTemplateFields(1, templateFields.value)]
  currentRecordIndex.value = 1
  currentBlockIndex.value = 0
  selectedRecordIndexes.value = new Set([1])

  // Clear series data
  seriesData.value = []

  // Clear notes
  measurementNote.value = ''

  // Clear validation state
  visitedFields.value.clear()
  touchedFields.value.clear()
}

// clearAll function - wrapper that shows warning if data exists
function clearAll(): void {
  console.log('[clearAll] Called')
  requestClearAll()
}
function onImportFilePicked(f: File | null): void {
  composableOnImportFilePicked(f)
}
function buildTemplateLike(): TemplateLike | null {
  const tpl = selectedTemplate.value
  if (!tpl) return null
  // Filter out series-kind blocks - they go to SeriesSection, not mapping
  const nonSeriesBlocks = templateBlocks.value.filter(b => b.kind !== 'series')
  const blocks = nonSeriesBlocks.map(b => ({
    blockIndex: b.blockIndex,
    title: b.title,
    fields: b.fields.map((f, i) => ({
      name: f.name,
      type: f.type,
      required: f.required,
      sourceIndex: i,
      orderIndex: f.orderIndex
    }))
  }))
  return { name: tpl.name, deviceId: tpl.deviceId || selectedDeviceId.value, blocks }
}
async function analyzeImport(): Promise<void> {
  if (!importedFile.value) return
  if (!selectedTemplate.value) {
    importError.value = 'Nejprve vyberte šablonu.'
    return
  }
  importBusy.value = true
  importError.value = null
  try {
    const structure = await parseImportedMeasurementFile(importedFile.value)
    importedStructure.value = structure

    // Sync imported series to template-defined series
    // Strategy: Fill existing template series with imported data, don't create new series
    if (structure.series?.length && seriesData.value.length > 0) {
      // Group imported series by record index for efficient lookup
      const importedByRecord = new Map<number, typeof structure.series>()
      for (const s of structure.series) {
        const recIdx = s.linkedRecordIndex || 0
        if (!importedByRecord.has(recIdx)) {
          importedByRecord.set(recIdx, [])
        }
        importedByRecord.get(recIdx)!.push(s)
      }

      // For each template series, try to fill data from imported
      const updatedSeries = seriesData.value.map(templateSeries => {
        const columns = templateSeries.columns || []
        if (columns.length === 0) return templateSeries

        // Find imported series that could map to template columns
        // Match by column name (e.g., template "Sizes" column -> imported "Sizes" series)
        const seriesForRecord = importedByRecord.get(templateSeries.linkedRecordIndex || 0)
          || importedByRecord.get(0)
          || Array.from(importedByRecord.values())[0]
          || []

        // Build row data by mapping each column to its imported series
        let maxRows = 0
        const columnDataMap = new Map<string, (number | string | null)[]>()

        for (const col of columns) {
          // Find imported series matching this column name
          const matchingSeries = seriesForRecord.find(s =>
            s.seriesName?.toLowerCase() === col.name.toLowerCase() ||
            s.yLabel?.toLowerCase() === col.name.toLowerCase() ||
            s.xLabel?.toLowerCase() === col.name.toLowerCase()
          )

          if (matchingSeries && Array.isArray(matchingSeries.data)) {
            // Extract values from series data
            const values: (number | string | null)[] = []
            for (const row of matchingSeries.data as { x?: number; y?: number }[]) {
              // Use Y value if column matches yLabel, X otherwise
              const val = col.name.toLowerCase() === matchingSeries.xLabel?.toLowerCase()
                ? row.x
                : row.y
              values.push(val ?? null)
            }
            columnDataMap.set(col.name, values)
            maxRows = Math.max(maxRows, values.length)
          }
        }

        // If no data was mapped, keep original template data
        if (columnDataMap.size === 0) return templateSeries

        // Build rows from column data
        const newData: Record<string, number | string | null>[] = []
        for (let i = 0; i < maxRows; i++) {
          const row: Record<string, number | string | null> = {}
          for (const col of columns) {
            row[col.name] = columnDataMap.get(col.name)?.[i] ?? null
          }
          newData.push(row)
        }

        return {
          ...templateSeries,
          data: newData
        }
      })

      seriesData.value = updatedSeries
    } else if (structure.series?.length && seriesData.value.length === 0) {
      // No template series, use imported series as-is
      seriesData.value = structure.series.map(s => ({
        seriesType: s.seriesType,
        seriesName: s.seriesName,
        linkedRecordIndex: s.linkedRecordIndex,
        linkedRecordDescription: s.linkedRecordDescription,
        data: s.data,
        columns: s.columns
      }))
    }
    // Note: If file has no series, keep existing template-defined series intact


    const tmpl = buildTemplateLike()
    if (!tmpl) {
      importError.value = 'Šablona není dostupná.'
      return
    }
    const compat = checkTemplateCompatibility(tmpl, structure)
    importCompatibility.value = { compatible: compat.compatible, reasons: compat.reasons }

    if (!compat.compatible) {
      // Not compatible by header names - check if learned mappings exist
      importPanelOpen.value = true

      // Check for learned mappings
      const headers = structure.blocks?.[0]?.headers ?? []
      if (headers.length && selectedTemplate.value?.id) {
        const importStore = useImportStore()
        const templateFieldNames = templateFields.value.map(f => f.name)
        const learnedSuggestions = await importStore.suggestLearnedMappings(
          Number(selectedTemplate.value.id),
          headers,
          templateFieldNames
        )
        const learnedCount = Object.keys(learnedSuggestions).filter(h => learnedSuggestions[h]?.matchType === 'LEARNED').length
        console.log('[analyzeImport] Learned mappings available:', learnedCount, '/', templateFieldNames.length)

        if (learnedCount >= Math.ceil(templateFieldNames.length * 0.5)) {
          learnedMappingsAvailable.value = true
          console.log('[analyzeImport] Learned mappings found - UI will show hint')
        }
      }
    }
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Neznámá chyba při parsování souboru.'
  } finally {
    importBusy.value = false
  }
}

function normalizeImportedRecords(ui: Array<{
  recordIndex: number
  fields: Array<{
    name: string
    type: ValueType
    required: boolean
    value: unknown
    blockIndex?: number
    blockTitle?: string
    orderIndex: number
  }>
}>): MeasurementRecord[] {
  return ui.map(r => ({
    recordIndex: r.recordIndex,
    fields: r.fields.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required,
      value: f.value ?? null,
      blockIndex: f.blockIndex ?? 1,
      blockTitle: f.blockTitle,
      orderIndex: f.orderIndex
    }))
  }))
}
/**
 * Request to apply imported data - shows warning if data exists
 */
function requestApplyImport(): void {
  console.log('[requestApplyImport] Called', {
    hasStructure: !!importedStructure.value,
    isCompatible: isImportCompatible.value,
    compatibility: importCompatibility.value
  })

  if (!importedStructure.value) {
    console.log('[requestApplyImport] No structure - returning')
    return
  }

  if (!isImportCompatible.value) {
    // Not compatible - try auto-apply learned mappings!
    console.log('[requestApplyImport] Not compatible - trying auto-apply learned mappings...')
    tryAutoApplyLearnedMappings(importedStructure.value)
      .then(() => console.log('[requestApplyImport] Auto-apply finished'))
      .catch(e => console.error('[requestApplyImport] Auto-apply ERROR:', e))
    return
  }

  // Already compatible - apply directly
  console.log('[requestApplyImport] Calling doApplyImport directly')
  doApplyImport()
}

/**
 * Actually apply imported records
 */
function doApplyImport(): void {
  console.log('[doApplyImport] START')
  showApplyDataWarning.value = false

  if (!importedStructure.value || !isImportCompatible.value) {
    console.log('[doApplyImport] Returning - no structure or not compatible')
    return
  }
  const tmpl = buildTemplateLike()
  if (!tmpl) {
    console.log('[doApplyImport] Returning - no template')
    return
  }
  console.log('[doApplyImport] Template:', tmpl.name, 'Blocks:', tmpl.blocks.length)
  console.log('[doApplyImport] Imported blocks:', importedStructure.value.blocks.length)
  console.log('[doApplyImport] Row offset:', importRowOffset.value)

  // Apply row offset by slicing rows from each block
  const adjustedStructure: ImportedFileStructure = {
    ...importedStructure.value,
    blocks: importedStructure.value.blocks.map(block => ({
      ...block,
      rows: block.rows.slice(importRowOffset.value)
    }))
  }

  const recs = buildRecordsFromImported(tmpl, adjustedStructure)
  console.log('[doApplyImport] Built records:', recs.length)
  if (recs.length > 0) {
    console.log('[doApplyImport] First record:', recs[0])
  }

  const ui = recs.map(r => ({
    recordIndex: r.recordIndex,
    fields: r.fields.map((f, order) => ({
      name: f.name,
      type: f.type as ValueType,
      required: f.required,
      value: f.value,
      blockIndex: f.blockIndex,
      blockTitle: f.blockTitle,
      orderIndex: order + 1
    }))
  }))

  const cleaned = normalizeImportedRecords(ui)
  console.log('[doApplyImport] Cleaned records:', cleaned.length)
  if (!cleaned.length) {
    console.log('[doApplyImport] Returning - no cleaned records')
    return
  }

  records.value = cleaned
  currentRecordIndex.value = records.value[0]!.recordIndex
  selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  visitedFields.value.clear()
  touchedFields.value.clear()

  // === SERIES DATA EXTRACTION FROM PARSED SERIES ===
  // Strategy: If we have template series, fill their columns with matching imported data
  // If no template series, create series from import (fallback)
  const importedSeries = adjustedStructure.series || []

  console.log('[doApplyImport] Imported series from parser:', importedSeries.length)
  console.log('[doApplyImport] Template series count BEFORE init:', seriesData.value.length)

  // Initialize template series if not already done (doApplyImport can be called before goToNextStep)
  if (seriesData.value.length === 0) {
    // Debug: Log all template blocks to understand detection
    const tpl = selectedTemplate.value
    console.log('[doApplyImport] Selected template:', tpl?.name)
    console.log('[doApplyImport] All template blocks:', tpl?.blocks?.map(b => ({
      title: b.title,
      kind: b.kind,
      fieldsCount: b.fields?.length
    })))

    const seriesBlocks = templateSeriesBlocks.value
    console.log('[doApplyImport] Detected series blocks:', seriesBlocks.length, seriesBlocks.map(b => b.title))

    if (seriesBlocks.length > 0) {
      seriesData.value = seriesBlocks.map((block, idx) => {
        const columns = block.fields?.map(f => ({
          name: f.name,
          type: f.type as 'float' | 'int' | 'text',
          required: f.required
        })) || []

        // Create empty placeholder rows
        const emptyRows: Record<string, number | string | null>[] = []
        for (let i = 0; i < 5; i++) {
          const row: Record<string, number | string | null> = {}
          columns.forEach(col => {
            row[col.name] = null
          })
          emptyRows.push(row)
        }

        return {
          seriesType: block.title || `Série ${idx + 1}`,
          seriesName: block.title || undefined,
          linkedRecordIndex: currentRecordIndex.value,
          linkedRecordDescription: `Záznam ${currentRecordIndex.value}`,
          columns: columns,
          data: emptyRows
        }
      })
      console.log('[doApplyImport] Initialized', seriesData.value.length, 'template series')
    }
  }

  console.log('[doApplyImport] Template series count AFTER init:', seriesData.value.length)

  if (importedSeries.length > 0) {
    // Get template columns from seriesData or templateSeriesBlocks
    const templateColumns = seriesData.value[0]?.columns ||
      templateSeriesBlocks.value[0]?.fields?.map(f => ({
        name: f.name,
        type: f.type as 'float' | 'int' | 'text',
        required: f.required
      })) || []

    if (templateColumns.length > 0) {
      console.log('[doApplyImport] Creating series for all records with template columns:', templateColumns.map(c => c.name))

      // Group imported series by linkedRecordIndex
      const seriesByRecord = new Map<number, typeof importedSeries>()
      for (const s of importedSeries) {
        const recIdx = s.linkedRecordIndex || 0
        if (!seriesByRecord.has(recIdx)) {
          seriesByRecord.set(recIdx, [])
        }
        seriesByRecord.get(recIdx)!.push(s)
      }

      console.log('[doApplyImport] Records with series:', Array.from(seriesByRecord.keys()))

      // Create series for each record
      const allSeries: SeriesData[] = []

      for (const [recordIndex, recordSeriesList] of seriesByRecord) {
        // Build column data for this record
        let maxRows = 0
        const columnDataMap = new Map<string, (number | string | null)[]>()

        for (const col of templateColumns) {
          // Find imported series that contains data for this column
          // The imported series now has multi-column data in format: { Sizes: x, Intensities: y1, ... }
          const values: (number | string | null)[] = []

          for (const importedS of recordSeriesList) {
            if (!Array.isArray(importedS.data) || importedS.data.length === 0) continue

            // Check if this series has data for this column
            const firstRow = importedS.data[0] as Record<string, unknown>
            if (col.name in firstRow) {
              // Extract values for this column from all rows
              for (const row of importedS.data as Record<string, number | string | null>[]) {
                values.push(row[col.name] ?? null)
              }
              break // Found data for this column
            }

            // Fallback: check old x/y format
            if ('x' in firstRow && col.name.toLowerCase().includes('size')) {
              for (const row of importedS.data as { x?: number; y?: number }[]) {
                values.push(row.x ?? null)
              }
              break
            }
            if ('y' in firstRow && (
              col.name.toLowerCase().includes('intensit') ||
              col.name.toLowerCase().includes('volume') ||
              col.name.toLowerCase().includes('number')
            )) {
              for (const row of importedS.data as { x?: number; y?: number }[]) {
                values.push(row.y ?? null)
              }
              break
            }
          }

          if (values.length > 0) {
            columnDataMap.set(col.name, values)
            maxRows = Math.max(maxRows, values.length)
          }
        }

        // Build rows from column data
        const newData: Record<string, number | string | null>[] = []
        for (let i = 0; i < maxRows; i++) {
          const row: Record<string, number | string | null> = {}
          for (const col of templateColumns) {
            row[col.name] = columnDataMap.get(col.name)?.[i] ?? null
          }
          newData.push(row)
        }

        console.log('[doApplyImport] Created series for record', recordIndex, 'with', newData.length, 'rows')

        allSeries.push({
          seriesType: templateSeriesBlocks.value[0]?.title || 'Datová série',
          seriesName: templateSeriesBlocks.value[0]?.title || 'Datová série',
          linkedRecordIndex: recordIndex,
          linkedRecordDescription: `Záznam ${recordIndex}`,
          columns: templateColumns,
          data: newData
        })
      }

      seriesData.value = allSeries
      console.log('[doApplyImport] Created', allSeries.length, 'series for all records')
    } else {
      // No template series - create series from import
      console.log('[doApplyImport] No template series, creating from import')
      const populatedSeries: SeriesData[] = importedSeries.map(importedS => {
        const simpleData = importedS.data.map(point => ({
          x: (point as { x?: number }).x,
          y: (point as { y?: number }).y
        }))

        return {
          seriesType: importedS.seriesType || 'OTHER',
          seriesName: importedS.seriesName || 'Series',
          linkedRecordIndex: importedS.linkedRecordIndex ?? null,
          linkedRecordDescription: importedS.linkedRecordDescription || undefined,
          columns: importedS.columns || [
            { name: 'X', type: 'float' as const, required: true },
            { name: 'Y', type: 'float' as const, required: true }
          ],
          data: simpleData as unknown as Record<string, number | string | null>[]
        }
      })

      seriesData.value = populatedSeries
      console.log('[doApplyImport] Created', populatedSeries.length, 'series from import')
    }

    // Log first series details for debugging
    if (seriesData.value.length > 0) {
      const first = seriesData.value[0]
      console.log(`[doApplyImport] First series: "${first.seriesName}", ${first.data.length} rows`)
    }
  } else {
    console.log('[doApplyImport] No imported series found')
  }


  wizardStep.value = 2
}

// applyImportedRecords function - wrapper that shows warning if data exists
function applyImportedRecords(): void {
  requestApplyImport()
}
function openImportFileChooser(): void {
  const el = document.querySelector<HTMLInputElement>('[data-import-file-input]')
  el?.click()
}
async function openMappingWizard(): Promise<void> {
  if (!importedStructure.value || !selectedTemplate.value) return
  const tmpl = buildTemplateLike()
  if (!tmpl) return

  // Build initial model from template and imported structure
  let model = buildMappingModel(tmpl, {
    fileName: importedStructure.value.fileName,
    delimiter: importedStructure.value.delimiter,
    blocks: importedStructure.value.blocks.map(b => ({
      blockIndex: b.blockIndex,
      headers: b.headers
    }))
  })

  // Fetch learned suggestions from backend
  const importStore = useImportStore()
  const headers = importedStructure.value.blocks.flatMap(b => b.headers)
  const templateFieldNames = tmpl.blocks.flatMap(b => b.fields.map(f => f.name))

  try {
    const suggestions = await importStore.suggestLearnedMappings(
      Number(selectedTemplate.value.id),
      headers,
      templateFieldNames
    )
    // Apply learned suggestions to model
    if (Object.keys(suggestions).length > 0) {
      model = applyLearnedSuggestions(model, suggestions)
      console.log('[openMappingWizard] Applied', Object.keys(suggestions).length, 'learned mappings')
    }
  } catch (e) {
    console.warn('[openMappingWizard] Failed to fetch learned mappings:', e)
    // Continue with original model if API fails
  }

  mappingModel.value = model
  mappingOpen.value = true
}
function onApplyMapping(payload: ReturnType<typeof exportMapping>): void {
  if (!importedStructure.value || !selectedTemplate.value || !mappingModel.value) return
  const base = buildTemplateLike()
  if (!base) return

  // Handle new object structure { blockMappings, seriesMappings }
  const blockMappings = payload.blockMappings ?? []

  for (const blockMapping of blockMappings) {
    const blk = base.blocks.find(b => b.blockIndex === blockMapping.blockIndex)
    if (!blk) continue
    for (const m of blockMapping.mappings) {
      const fld = blk.fields.find(f => f.name === m.fieldName)
      if (fld) fld.sourceIndex = m.sourceIndex
    }
  }
  const recs = buildRecordsFromImported(base, importedStructure.value)
  const ui = recs.map(r => ({
    recordIndex: r.recordIndex,
    fields: r.fields.map((f, order) => ({
      name: f.name,
      type: f.type as ValueType,
      required: f.required,
      value: f.value,
      blockIndex: f.blockIndex,
      blockTitle: f.blockTitle,
      orderIndex: order + 1
    }))
  }))
  const cleaned = normalizeImportedRecords(ui)
  if (!cleaned.length) return
  records.value = cleaned
  currentRecordIndex.value = records.value[0]!.recordIndex
  selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
  visitedFields.value.clear()
  touchedFields.value.clear()
  wizardStep.value = 2
  mappingOpen.value = false

  // Uložit mapování pro budoucí importy (learning)
  console.log('[onApplyMapping] Checking save condition:', {
    hasTemplateId: !!selectedTemplate.value?.id,
    hasMappingModel: !!mappingModel.value
  })

  if (selectedTemplate.value?.id && mappingModel.value) {
    const importStore = useImportStore()

    // Sestavit mapping: header -> fieldName
    const learnedMapping: Record<string, string> = {}
    for (const block of mappingModel.value.blocks) {
      console.log('[onApplyMapping] Processing block:', {
        headers: block.headers,
        fieldsCount: block.fields.length
      })
      for (const field of block.fields) {
        if (field.mappedSourceIndex != null && field.mappedSourceIndex >= 0) {
          const header = block.headers[field.mappedSourceIndex]
          if (header) {
            learnedMapping[header] = field.fieldName
            console.log('[onApplyMapping] Mapped:', header, '->', field.fieldName)
          }
        }
      }
    }

    console.log('[onApplyMapping] Final mapping:', learnedMapping)

    if (Object.keys(learnedMapping).length > 0) {
      console.log('[onApplyMapping] Calling saveMappings with templateId:', selectedTemplate.value.id)
      // Fire and forget - neblokovat UI
      void importStore.saveMappings(Number(selectedTemplate.value.id), learnedMapping)
      mappingApplied.value = true  // Mark that user applied custom mapping
    } else {
      console.warn('[onApplyMapping] No mappings to save!')
      mappingApplied.value = true  // Still mark as applied even without save
    }
  } else {
    console.warn('[onApplyMapping] Missing template or model - not saving')
  }
}

/**
 * Try to auto-apply learned mappings when data is analyzed.
 * If learned mappings exist, builds a mapping model, applies, and shows success message.
 */
async function tryAutoApplyLearnedMappings(structure: ImportedFileStructure): Promise<void> {
  try {
    console.log('[tryAutoApply] START')

    if (!selectedTemplate.value?.id) {
      console.log('[tryAutoApply] No template selected - skipping')
      return
    }

    const headers = structure.blocks?.[0]?.headers ?? []
    if (!headers.length) {
      console.log('[tryAutoApply] No headers in structure - skipping')
      return
    }

    const templateFieldNames = templateFields.value.map(f => f.name)
    console.log('[tryAutoApply] Template:', selectedTemplate.value.id, 'Headers:', headers.length, 'Fields:', templateFieldNames.length)

    const importStore = useImportStore()
    const learnedSuggestions = await importStore.suggestLearnedMappings(
      Number(selectedTemplate.value.id),
      headers,
      templateFieldNames
    )

    console.log('[tryAutoApply] Learned suggestions:', learnedSuggestions)

    const learnedCount = Object.keys(learnedSuggestions).filter(h => learnedSuggestions[h]?.matchType === 'LEARNED').length
    const threshold = Math.ceil(templateFieldNames.length * 0.5)
    console.log('[tryAutoApply] Learned count:', learnedCount, '/', templateFieldNames.length, 'threshold:', threshold)

    // Only auto-apply if we have enough learned mappings (at least 50% of fields)
    if (learnedCount >= threshold) {
      console.log('[tryAutoApply] Enough learned mappings - auto-applying!')

      // Build mapping model and apply suggestions
      const tplData = buildTemplateLike()
      if (!tplData) {
        console.log('[tryAutoApply] Could not build template - skipping')
        return
      }

      // Build template object for buildMappingModel
      const templateObj = {
        name: tplData.name,
        deviceId: '',
        blocks: tplData.blocks.map(b => ({
          blockIndex: b.blockIndex,
          title: b.title,
          fields: b.fields.map(f => ({ name: f.name, required: f.required, sourceIndex: f.sourceIndex }))
        }))
      }

      // Build imported object for buildMappingModel
      const importedObj = {
        fileName: structure.fileName || 'imported',
        delimiter: structure.delimiter || ',',
        blocks: (structure.blocks || []).map((b, i) => ({
          blockIndex: b.blockIndex ?? i + 1,
          headers: b.headers
        }))
      }

      const model = buildMappingModel(templateObj, importedObj)
      console.log('[tryAutoApply] Built model with', model.blocks.length, 'blocks')

      applyLearnedSuggestions(model, learnedSuggestions)
      console.log('[tryAutoApply] Applied suggestions to model')

      // Build records from mapping (similar to onApplyMapping)
      const base = buildTemplateLike()
      if (!base) {
        console.log('[tryAutoApply] Could not build base template - skipping')
        return
      }

      // Apply mappings to base template
      for (const block of model.blocks) {
        const tmplBlock = base.blocks.find(b => b.blockIndex === block.blockIndex)
        if (!tmplBlock) continue
        for (const field of block.fields) {
          if (field.mappedSourceIndex != null && field.mappedSourceIndex >= 0) {
            const tmplField = tmplBlock.fields.find(f => f.name === field.fieldName)
            if (tmplField) tmplField.sourceIndex = field.mappedSourceIndex
          }
        }
      }

      const recs = buildRecordsFromImported(base, structure)
      console.log('[tryAutoApply] Built', recs.length, 'records from import')

      const ui = recs.map(r => ({
        recordIndex: r.recordIndex,
        fields: r.fields.map((f, order) => ({
          name: f.name,
          type: f.type as ValueType,
          required: f.required,
          value: f.value,
          blockIndex: f.blockIndex,
          blockTitle: f.blockTitle,
          orderIndex: order + 1
        }))
      }))
      const cleaned = normalizeImportedRecords(ui)
      console.log('[tryAutoApply] Cleaned records:', cleaned.length)

      if (!cleaned.length) {
        console.log('[tryAutoApply] No cleaned records - skipping')
        return
      }

      records.value = cleaned
      currentRecordIndex.value = records.value[0]!.recordIndex
      selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
      visitedFields.value.clear()
      touchedFields.value.clear()
      wizardStep.value = 2
      mappingApplied.value = true
      mappingAutoApplied.value = true  // Mark as auto-applied

      // Update compatibility - data is now "compatible" because we applied learned mappings
      importCompatibility.value = { compatible: true, reasons: [] }

      console.log('[tryAutoApply] ✅ Auto-applied learned mappings successfully!', cleaned.length, 'records')
    } else {
      console.log('[tryAutoApply] Not enough learned mappings, user needs to map manually')
    }
  } catch (e) {
    console.error('[tryAutoApply] ERROR:', e)
  }
}

/**
 * Handle derive template request - emit to parent to open TemplateWizardDialog with deriveFrom
 */
function onDeriveTemplate(payload: {
  newTemplateName: string;
  extraColumns: Array<{ name: string; headerIndex: number }>
}): void {
  if (!selectedTemplate.value) return

  const currentTpl = selectedTemplate.value

  // Build the extra fields with default 'text' type
  const extraFields = payload.extraColumns.map((col, idx) => ({
    orderIndex: (currentTpl.fields?.length ?? 0) + idx + 1,
    type: 'text' as const,
    required: false,
    name: col.name
  }))

  // Use existing emit to trigger parent to open TemplateWizardDialog
  // Parent Measurements.vue will handle this and open TemplateWizardDialog with deriveFrom prop
  emits('deriveTemplate', currentTpl.id)

  // Close mapping dialog
  mappingOpen.value = false
}

/* Text paste handler - uses same parsing as file import */
async function handlePastedText(text: string): Promise<void> {
  if (!text.trim()) return
  importBusy.value = true
  importError.value = null
  try {
    // Use the same import parsing logic as file import
    // Create a File object from the text (parseImportedMeasurementFile expects File)
    const file = new File([text], 'pasted-data.txt', { type: 'text/plain' })
    const structure = await parseImportedMeasurementFile(file)

    if (!structure || !structure.blocks.length) {
      importError.value = 'Nepodařilo se rozpoznat data v textu'
      return
    }

    // Store the parsed structure
    importedStructure.value = structure

    // Sync imported series to editable series state
    if (structure.series?.length) {
      seriesData.value = structure.series.map(s => ({
        seriesType: s.seriesType,
        seriesName: s.seriesName,
        linkedRecordIndex: s.linkedRecordIndex ?? null,
        linkedRecordDescription: '',
        data: s.data,
        columns: s.columns // Preserve column definitions if present
      }))
    }

    // Check compatibility with current template
    const tplLike = buildTemplateLike()
    if (tplLike) {
      const compat = checkTemplateCompatibility(tplLike, structure)
      importCompatibility.value = { compatible: compat.compatible, reasons: compat.reasons }

      if (compat.compatible) {
        // Auto-apply if compatible
        applyImportedRecords()
      }
    } else {
      importCompatibility.value = { compatible: false, reasons: ['Šablona není vybrána'] }
    }
  } catch (err) {
    console.error('Failed to parse pasted text:', err)
    importError.value = 'Nepodařilo se zpracovat vložený text'
  } finally {
    importBusy.value = false
  }
}

function convertValueForField(value: string, type: string): unknown {
  switch (type) {
    case 'float':
      return toNumber(value, false)
    case 'int':
      return toNumber(value, true)
    case 'bool':
      return normalizeBool(value)
    case 'date':
      return toDateMs(value)
    default:
      return value
  }
}

/* Keyboard shortcuts */
function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  if (key === 'escape') {
    e.preventDefault()
    // If on step 2 or 3, ESC acts as Back
    if (wizardStep.value > 1) { goToPrevStep(); return }
    emits('update:modelValue', false)
    return
  }
  if (ctrl && key === 's') { e.preventDefault(); void onSave(); return }
  if (isEditableElement(e.target)) return
  if (ctrl && key === 'enter' && importPanelOpen.value) { e.preventDefault(); void analyzeImport(); return }
  if (ctrl && key === 'o') { e.preventDefault(); openImportFileChooser(); return }
}
watch(() => props.modelValue, v => {
  if (v) {
    initDialog()
    window.addEventListener('keydown', handleKey)
    // Check for existing draft and offer to load it
    if (hasDraft.value) {
      showDraftDialog.value = true
    }
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (props.modelValue) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))

/* Save */
function buildMeasuredValues(): MeasuredValue[] {
  const flat = flattenRecords(records.value)
  return flat.map(v => ({
    orderIndex: v.orderIndex,
    recordIndex: v.recordIndex ?? 1,
    blockIndex: v.blockIndex ?? 1,
    name: v.name,
    type: v.type,
    numberValue: v.numberValue ?? null,
    textValue: v.textValue ?? null,
    boolValue: v.boolValue ?? null,
    dateValue: v.dateValue ?? null,
    fileUrl: v.fileUrl ?? null
  }))
}
async function onSave(): Promise<void> {
  records.value.forEach(r => r.fields.forEach(f => markFieldTouched(f)))
  await nextTick()
  if (!canSave.value) { goToFirstInvalidField(); return }
  saving.value = true
  try {
    // Step 1: Upload all file fields first
    const filesToUpload = extractFilesFromRecords(records.value)
    if (filesToUpload.length > 0) {
      // Upload files and store their URLs back into records
      for (const fileInfo of filesToUpload) {
        const result = await uploadFile(fileInfo.file)
        if (result.success) {
          // Find the record and field, update the value with the server URL
          const record = records.value.find(r => r.recordIndex === fileInfo.recordIndex)
          if (record) {
            const field = record.fields.find(
              f => f.name === fileInfo.fieldName && (f.blockIndex ?? 1) === fileInfo.blockIndex
            )
            if (field) {
              // Replace File object with the server URL
              field.value = result.fileUrl
            }
          }
        } else {
          console.error(`Failed to upload file ${fileInfo.file.name}:`, result.error)
          // Keep the filename as fallback if upload fails
          const record = records.value.find(r => r.recordIndex === fileInfo.recordIndex)
          if (record) {
            const field = record.fields.find(
              f => f.name === fileInfo.fieldName && (f.blockIndex ?? 1) === fileInfo.blockIndex
            )
            if (field) {
              field.value = fileInfo.file.name
            }
          }
        }
      }
    }

    const firstNumeric = records.value
      .flatMap(r => r.fields)
      .filter(f => f.type === 'float' || f.type === 'int')
      .map(f => toNumber(f.value, f.type === 'int'))
      .find(n => n != null && Number.isFinite(n))
    const tpl = selectedTemplateId.value ? props.templateById.get(selectedTemplateId.value) : null
    if (!tpl) return
    // Convert series data to request format
    // Series data can have dynamic column names from template (e.g., Xahojky, Ybhjojky)
    // We need to extract values from the first two columns (or x/y if present)
    const seriesPayload: MeasurementSeriesRequest[] = seriesData.value.map(s => {
      // Get column names - first two columns become X and Y
      const columnNames = s.columns?.map(c => c.name) || []
      const xColName = columnNames[0] || 'x' || 'X'
      const yColName = columnNames[1] || 'y' || 'Y'

      console.warn('[DEBUG onSave] Series conversion:', {
        seriesType: s.seriesType,
        columnNames,
        xColName,
        yColName,
        dataLength: s.data.length,
        sampleData: s.data.slice(0, 2)
      })

      return {
        seriesType: s.seriesType,
        seriesName: s.seriesName,
        seriesScope: s.seriesScope ?? 'record',  // Default to 'record' if not specified
        linkedRecordIndex: s.linkedRecordIndex ?? null,
        linkedRecordDescription: s.linkedRecordDescription ?? null,
        xValues: s.data.map(d => {
          const val = d[xColName]
          return typeof val === 'number' ? val : (parseFloat(String(val)) || 0)
        }),
        yValues: s.data.map(d => {
          const val = d[yColName]
          return typeof val === 'number' ? val : (parseFloat(String(val)) || 0)
        }),
        xUnit: null,
        yUnit: null
      }
    })
    // Extract measurement timestamp from the first date-type field (e.g. "Measurement Date and Time")
    const dateField = records.value
      .flatMap(r => r.fields)
      .find(f => f.type === 'date' && f.value != null)
    const measurementTimestamp = dateField?.value
      ? (typeof dateField.value === 'number' ? dateField.value : toDateMs(dateField.value))
      : Date.now()

    const payload: MeasurementRequest = {
      value: Number.isFinite(firstNumeric as number) ? (firstNumeric as number) : 0,
      type: tpl.name,
      unit: selectedDeviceId.value,
      timestamp: measurementTimestamp ?? Date.now(),
      values: buildMeasuredValues(),
      measuredByUsername: selectedMember.value || null,
      note: measurementNote.value || null,
      series: seriesPayload.length > 0 ? seriesPayload : undefined
    }
    emits('save', payload)
    // Show success toast locally
    showSuccessToast.value = true
    // Clear any saved draft since we successfully saved
    clearDraft()
    // Return to step 1 to allow new entry quickly (optional)
    wizardStep.value = 1
  } finally {
    saving.value = false
  }
}


defineExpose({
  setLastCreatedId(id: number | null) {
    lastCreatedMeasurementId.value = id
  }
})

</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="1400px"
    :hide-footer="false"
    class="measurement-create-dialog"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div class="wizard-header">
        <h2 class="wizard-title">Nové měření</h2>

        <!-- Minimal Stepper -->
        <nav class="wizard-nav" aria-label="Průběh vytváření měření">
          <div
            class="wizard-step"
            :class="{ 'is-active': wizardStep >= 1, 'is-current': wizardStep === 1 }"
          >
            <span class="wizard-step-number">1</span>
            <span class="wizard-step-text">Nastavení</span>
          </div>

          <div class="wizard-connector" :class="{ 'is-active': wizardStep > 1 }"></div>

          <div
            class="wizard-step"
            :class="{ 'is-active': wizardStep >= 2, 'is-current': wizardStep === 2 }"
          >
            <span class="wizard-step-number">2</span>
            <span class="wizard-step-text">Data</span>
          </div>

          <div class="wizard-connector" :class="{ 'is-active': wizardStep > 2 }"></div>

          <div
            class="wizard-step"
            :class="{ 'is-active': wizardStep >= 3, 'is-current': wizardStep === 3 }"
          >
            <span class="wizard-step-number">3</span>
            <span class="wizard-step-text">Uložení</span>
          </div>
        </nav>
      </div>
    </template>

    <template #content>
      <div class="py-2" style="min-height: 400px;">
        <!-- STEP 1: SETUP -->
        <v-window v-model="wizardStep">
          <v-window-item :value="1">
            <div class="pa-1">
              <MeasurementMetaStep
                v-model:selected-member="selectedMember"
                v-model:selected-device-id="selectedDeviceId"
                v-model:selected-template-id="selectedTemplateId"
                :members-list="membersList"
                :devices="storeDevices"
                :templates="templates"
                :show-help="showHelp"
                @create-device="openDeviceCreate"
                @create-template="(deviceCode: string) => emits('createTemplate', deviceCode)"
                @create-template-from-clipboard="(deviceCode: string) => emits('createTemplateFromClipboard', deviceCode)"
                @derive-template="(templateId: string) => emits('deriveTemplate', templateId)"
              />
              <DeviceCreateDialog
                v-model="showDeviceCreate"
                @created="onDeviceCreated"
              />
            </div>
          </v-window-item>

          <!-- STEP 2: DATA -->
          <v-window-item :value="2">
            <div class="pa-1">
              <ImportPanel
                v-if="selectedTemplateId"
                :imported-file="importedFile"
                :imported-structure="importedStructure"
                :import-busy="importBusy"
                :import-error="importError"
                :import-compatibility="importCompatibility"
                :is-import-compatible="isImportCompatible"
                :unmapped-fields-count="unmappedFieldsCount"
                :row-offset="importRowOffset"
                :data-applied="records.length > 0 && records.some(r => r.fields.some(f => f.value !== null && f.value !== '' && f.value !== 0))"
                :mapping-applied="mappingApplied"
                @pick-file="onImportFilePicked"
                @analyze="analyzeImport"
                @analyze-text="handlePastedText"
                @apply="applyImportedRecords"
                @reset="resetImport"
                @open-mapping="openMappingWizard"
                @clear-all="() => { console.log('[TEMPLATE] clear-all received'); clearAll() }"
                @update:rowOffset="(offset: number) => importRowOffset = offset"
                :mapping-auto-applied="mappingAutoApplied"
                :learned-mappings-available="learnedMappingsAvailable"
              />

              <!-- Removed: Mapovat data ručně button (user request) -->
              <v-divider v-if="selectedTemplateId" class="my-4" />

              <BlocksNavigation
                :template-blocks="templateBlocks"
                :current-block-index="currentBlockIndex"
                :current-block-title="currentBlock?.title || ''"
                @prev="prevBlock"
                @next="nextBlock"
                @set-index="i => currentBlockIndex = i"
              />

              <!-- Record Data Container - groups toolbar, values and series for current record -->
              <div class="record-data-section">
                <RecordsToolbar
                  :records="records"
                  :current-record-index="currentRecordIndex"
                  :selected-record-indexes="selectedRecordIndexes"
                  :can-duplicate="!!records.find(r => r.recordIndex === currentRecordIndex)"
                  @add="addRecord"
                  @duplicate="duplicateCurrentRecord"
                  @delete="deleteCurrentRecord"
                  @prev="toPrevRecord"
                  @next="toNextRecord"
                  @toggle="toggleRecordSelection"
                  @select="(idx: number) => { currentRecordIndex = idx; currentBlockIndex = 0 }"
                />

                <FieldsGrid
                  :fields="currentBlockFields"
                  :type-label-map="{
                    float: 'Float', int: 'Integer', text: 'Text', file: 'Image', bool: 'Boolean', date: 'Date'
                  }"
                  :get-text-model="textModel"
                  :get-date-model="dateModel"
                  :get-time-model="timeModel"
                  :get-file-model="fileModel"
                  :is-required-empty="requiredEmptyPristine"
                  :field-error="fieldError"
                  :has-imported-data="!!importedStructure"
                  :current-record-index="records.findIndex(r => r.recordIndex === currentRecordIndex) + 1"
                  @visit="markFieldVisited"
                  @update="updateField"
                  @update-time="updateTimeField"
                  @touch="markFieldTouched"
                  @open-picker="openGridPicker"
                />

                <v-divider class="my-4" />

                <SeriesSection
                  v-model:series="currentRecordSeriesData"
                  :editable="true"
                  :record-options="recordOptions"
                  :current-record-index="currentRecordIndex"
                  :series-field-definitions="seriesFieldDefinitions"
                  :raw-imported-data="seriesRawDataForPicker"
                  :show-validation="showSeriesValidation"
                  @add-series="addEmptySeriesForCurrentRecord"
                  @remove-series="removeSeries"
                />
              </div>

              <!-- NOTES SECTION -->
              <div class="notes-section-wrapper">
                <!-- Header -->
                <div class="notes-header">
                  <div class="notes-title">
                    <div class="notes-icon">
                      <v-icon size="15" color="white">mdi-notebook-outline</v-icon>
                    </div>
                    <span>Poznámky</span>
                  </div>
                  <!-- Chip: Markdown indicator -->
                  <span class="markdown-chip">
                    <v-icon size="12">mdi-language-markdown</v-icon>
                    Markdown
                  </span>
                </div>

                <!-- Markdown Editor Wrapper -->
                <div class="notes-editor-wrapper">
                  <MarkdownEditor
                    v-model="measurementNote"
                    placeholder="Pište poznámky k měření... (podporuje Markdown formátování)"
                    min-height="180px"
                  />
                </div>
              </div>


              <MappingWizardDialog
                v-model="mappingOpen"
                :mapping-model="mappingModel"
                @apply-mapping="onApplyMapping"
                @derive-template="onDeriveTemplate"
              />

              <ManualGridPickerDialog
                v-model="gridPickerOpen"
                :grid-data="gridPickerData"
                :target-field-name="gridPickerTargetField"
                :record-count="records.length"
                @apply="applyGridPickerValues"
              />
            </div>
          </v-window-item>

          <!-- STEP 3: REVIEW / FINISH -->
          <v-window-item :value="3">
            <div class="review-step">
              <!-- Warning header -->
              <div class="review-alert">
                <v-icon size="24" color="warning">mdi-alert-circle-outline</v-icon>
                <div>
                  <strong>Zkontrolujte údaje před uložením</strong>
                  <p class="text-caption text-medium-emphasis mb-0">Ujistěte se, že jsou všechny hodnoty správně.</p>
                </div>
              </div>

              <!-- Meta summary -->
              <div class="review-meta">
                <div class="meta-chip">
                  <v-icon size="16">mdi-microscope</v-icon>
                  {{ props.devices.find(d => d.code === selectedDeviceId)?.name || selectedDeviceId }}
                </div>
                <div class="meta-chip">
                  <v-icon size="16">mdi-file-document-outline</v-icon>
                  {{ selectedTemplate?.name || '—' }}
                </div>
                <div class="meta-chip">
                  <v-icon size="16">mdi-format-list-numbered</v-icon>
                  {{ records.length }} {{ records.length === 1 ? 'záznam' : 'záznamů' }}
                </div>
                <div v-if="seriesData.length > 0" class="meta-chip">
                  <v-icon size="16">mdi-chart-line</v-icon>
                  {{ seriesData.length }} {{ seriesData.length === 1 ? 'série' : 'sérií' }}
                </div>
              </div>

              <!-- Data preview table -->
              <div class="preview-container">
                <h4 class="preview-title">Náhled dat</h4>

                <div class="preview-scroll">
                  <table class="preview-data-table">
                    <thead>
                      <tr>
                        <th class="sticky-col">#</th>
                        <th v-for="field in (records[0]?.fields ?? [])" :key="field.name">
                          {{ field.name }}
                          <span class="field-type-badge">{{ field.type }}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="record in records" :key="record.recordIndex">
                        <td class="sticky-col record-num">{{ record.recordIndex }}</td>
                        <td v-for="field in record.fields" :key="field.name" :class="{ 'empty-cell': field.value == null || String(field.value).trim() === '' }">
                          <template v-if="field.type === 'bool'">
                            <v-icon v-if="field.value === true" size="18" color="success">mdi-check-circle</v-icon>
                            <v-icon v-else-if="field.value === false" size="18" color="grey">mdi-close-circle</v-icon>
                            <span v-else class="text-medium-emphasis">—</span>
                          </template>
                          <template v-else-if="field.type === 'date'">
                            {{ field.value ? new Date(field.value as number).toLocaleString('cs-CZ') : '—' }}
                          </template>
                          <template v-else-if="field.type === 'file'">
                            <span v-if="field.value" class="file-indicator">📎 {{ typeof field.value === 'string' ? field.value.split('/').pop() : (field.value as File)?.name }}</span>
                            <span v-else class="text-medium-emphasis">—</span>
                          </template>
                          <template v-else>
                            {{ field.value ?? '—' }}
                          </template>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- Series summary if any -->
                <div v-if="seriesData.length > 0" class="series-summary">
                  <h5 class="series-title">Datové série</h5>
                  <div v-for="(series, idx) in seriesData" :key="idx" class="series-preview-block">
                    <div class="series-preview-header">
                      <v-icon size="18" color="primary">mdi-chart-line</v-icon>
                      <span class="font-weight-medium">{{ series.seriesName }}</span>
                      <v-chip size="x-small" variant="tonal" color="primary" class="ml-2">
                        {{ series.data.length }} {{ series.data.length === 1 ? 'bod' : 'bodů' }}
                      </v-chip>
                    </div>
                    <div class="series-preview-scroll">
                      <table class="preview-data-table series-data-table">
                        <thead>
                          <tr>
                            <th class="sticky-col">#</th>
                            <th v-for="col in (series.columns || [{name: 'X'}, {name: 'Y'}])" :key="col.name">
                              {{ col.name }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(row, rowIdx) in series.data" :key="rowIdx">
                            <td class="sticky-col record-num">{{ rowIdx + 1 }}</td>
                            <td v-for="col in (series.columns || [{name: 'X'}, {name: 'Y'}])" :key="col.name">
                              {{ row[col.name] ?? '—' }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Note Preview -->
              <div v-if="measurementNote.trim()" class="notes-preview mt-4">
                <div class="d-flex align-center mb-2">
                  <v-icon size="18" color="deep-purple" class="mr-2">mdi-notebook-outline</v-icon>
                  <span class="text-subtitle-2">Poznámky</span>
                </div>
                <MarkdownEditor
                  :model-value="measurementNote"
                  readonly
                  min-height="80px"
                />
              </div>
            </div>
          </v-window-item>
        </v-window>
      </div>
    </template>

    <template #footer>
      <div class="wizard-footer">
        <v-btn
          variant="text"
          color="medium-emphasis"
          @click="requestCancel"
        >
          Zrušit
        </v-btn>

        <v-spacer/>

        <v-btn
          v-if="wizardStep > 1"
          variant="text"
          class="ml-2"
          prepend-icon="mdi-arrow-left"
          @click="requestGoBack"
        >
          Zpět
        </v-btn>

        <v-spacer />

        <v-btn
          v-if="wizardStep < 3"
          color="primary"
          variant="flat"
          :disabled="wizardStep === 1 && !canProceedToData"
          @click="goToNextStep"
        >
          Pokračovat
        </v-btn>

        <v-btn
          v-else
          color="primary"
          variant="flat"
          :loading="saving"
          @click="onSave"
        >
          Uložit měření
        </v-btn>
      </div>
    </template>

    <!-- success toast -->
    <v-snackbar
      v-model="showSuccessToast"
      timeout="2500"
      color="success"
      location="top"
    >
      <div class="d-flex align-center justify-center w-100">
        <v-icon start>mdi-check-circle</v-icon>
        Měření bylo úspěšně vytvořeno
      </div>
    </v-snackbar>

    <!-- validation error toast -->
    <v-snackbar
      v-model="showValidationError"
      timeout="5000"
      color="error"
      location="bottom right"
    >
      <div class="d-flex align-center" style="gap: 8px;">
        <v-icon>mdi-alert-circle</v-icon>
        <span>{{ validationErrorMessage }}</span>
      </div>
      <template #actions>
        <v-btn size="small" variant="text" @click="showValidationError=false">Zavřít</v-btn>
      </template>
    </v-snackbar>

    <!-- Manual Header Picker Dialog -->
    <ManualHeaderPickerDialog
      v-model="showDataMappingGrid"
      :raw-grid="rawGridData"
      @apply="onManualHeaderPickerApply"
    />



    <!-- Clear All Warning Dialog -->
    <teleport to="body">
      <v-dialog v-model="showClearAllWarning" max-width="420" persistent>
        <v-card>
          <v-card-title class="d-flex align-center" style="gap: 8px;">
            <v-icon color="warning">mdi-alert</v-icon>
            Vyčistit vše?
          </v-card-title>
          <v-card-text>
            Máte vyplněná data ve formuláři. Vyčištěním smažete veškerá zadaná data včetně vybraného souboru.
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="showClearAllWarning = false">Zrušit</v-btn>
            <v-btn color="error" variant="flat" @click="doClearAll">Vyčistit</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </teleport>

    <!-- Apply Data Warning Dialog -->
    <v-dialog v-model="showApplyDataWarning" max-width="420" persistent>
      <v-card>
        <v-card-title class="d-flex align-center" style="gap: 8px;">
          <v-icon color="warning">mdi-alert</v-icon>
          Přepsat data?
        </v-card-title>
        <v-card-text>
          Máte vyplněná data ve formuláři. Použitím importovaných dat přepíšete všechna stávající data.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showApplyDataWarning = false">Zrušit</v-btn>
          <v-btn color="primary" variant="flat" @click="doApplyImport">Použít data</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Empty Series Warning Dialog -->
    <v-dialog v-model="showEmptySeriesWarning" max-width="460" persistent>
      <v-card>
        <v-card-title class="d-flex align-center" style="gap: 8px;">
          <v-icon color="warning">mdi-chart-line</v-icon>
          Datová série není vyplněna
        </v-card-title>
        <v-card-text>
          Šablona obsahuje datovou sérii, ale nezadali jste žádná data.
          Chcete pokračovat bez datové série, nebo se vrátit a vyplnit hodnoty?
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showEmptySeriesWarning = false">Zpět k vyplnění</v-btn>
          <v-btn color="warning" variant="flat" @click="confirmSaveWithoutSeries">Pokračovat bez série</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Draft Load Dialog -->
    <v-dialog v-model="showDraftDialog" max-width="420" persistent>
      <v-card>
        <v-card-title class="d-flex align-center" style="gap: 8px;">
          <v-icon color="primary">mdi-content-save-outline</v-icon>
          Uložený koncept
        </v-card-title>
        <v-card-text>
          Máte uložený koncept měření. Chcete ho načíst a pokračovat v práci, nebo začít znovu?
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dismissDraftDialog">Začít znovu</v-btn>
          <v-btn color="primary" variant="flat" @click="loadDraft">Načíst koncept</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </Dialog>

  <!-- Go Back Warning Dialog - OUTSIDE of Dialog component -->
  <v-dialog
    v-model="showGoBackWarning"
    max-width="420"
    persistent
  >
    <v-card>
      <v-card-title class="d-flex align-center" style="gap: 8px;">
        <v-icon color="warning">mdi-alert</v-icon>
        Neuložené změny
      </v-card-title>
      <v-card-text>
        Máte rozpracovaná data ve formuláři. Pokud se vrátíte zpět, všechny změny budou zahozeny.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="showGoBackWarning = false">Zůstat</v-btn>
        <v-btn color="error" variant="flat" @click="confirmGoBack">Zahodit změny</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>


<style scoped>
/* ============================================
   WIZARD UI STYLES - Clean & Elegant
   ============================================ */

/* Header */
.wizard-header {
  padding: 20px 24px 16px;
}

.wizard-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 20px 0;
  letter-spacing: -0.01em;
}

/* Step Navigation */
.wizard-nav {
  display: flex;
  align-items: center;
  gap: 0;
}

.wizard-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0.4;
  transition: opacity 0.25s ease;
}

.wizard-step.is-active {
  opacity: 1;
}

.wizard-step-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #e8e8e8;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.25s ease;
}

.wizard-step.is-active .wizard-step-number {
  background: #1867c0;
  color: white;
}

.wizard-step.is-current .wizard-step-number {
  box-shadow: 0 0 0 4px rgba(24, 103, 192, 0.15);
}

.wizard-step-text {
  font-size: 12px;
  font-weight: 500;
  transition: color 0.25s ease;
}

.wizard-step.is-active .wizard-step-text {
  font-weight: 600;
}

.wizard-connector {
  flex: 1;
  height: 2px;
  background: #e0e0e0;
  margin: 0 12px;
  margin-bottom: 24px;
  transition: background 0.3s ease;
}

.wizard-connector.is-active {
  background: #1867c0;
}

/* Footer */
.wizard-footer {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
}

/* Review Step */
.review-step {
  padding: 24px;
  max-height: 70vh;
  overflow-y: auto;
}

.review-alert {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 10px;
  margin-bottom: 20px;
}

.review-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
}

.meta-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #f1f5f9;
  border-radius: 20px;
  font-size: 13px;
  color: #475569;
}

.preview-container {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px;
}

.preview-title {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin: 0 0 12px 0;
}

.preview-scroll {
  max-height: 300px;
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.preview-data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.preview-data-table th,
.preview-data-table td {
  padding: 8px 12px;
  border: 1px solid #f0f0f0;
  text-align: left;
  white-space: nowrap;
}

.preview-data-table th {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
  position: sticky;
  top: 0;
  z-index: 1;
}

.preview-data-table .sticky-col {
  position: sticky;
  left: 0;
  background: #f8fafc;
  z-index: 2;
  width: 40px;
  text-align: center;
}

.preview-data-table tbody .sticky-col {
  background: white;
}

.preview-data-table .record-num {
  font-weight: 600;
  color: #1976d2;
}

.preview-data-table .empty-cell {
  color: #9ca3af;
  font-style: italic;
}

.field-type-badge {
  display: inline-block;
  font-size: 9px;
  text-transform: uppercase;
  background: #e0f2fe;
  color: #0369a1;
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 4px;
  vertical-align: middle;
}

.file-indicator {
  color: #059669;
  font-size: 11px;
}

.series-summary {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}

.series-title {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  margin: 0 0 10px 0;
}

.series-preview-block {
  margin-bottom: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.series-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #e5e7eb;
}

.series-preview-scroll {
  max-height: 200px;
  overflow: auto;
}

.series-data-table {
  font-size: 11px;
}

/* Field highlight animation */
@keyframes fieldHighlightFlash {
  0% { background-color: rgba(24, 103, 192, 0.1); }
  50% { background-color: rgba(24, 103, 192, 0.2); }
  100% { background-color: transparent; }
}

:deep(.field-highlight-error) {
  animation: fieldHighlightFlash 1.5s ease-out forwards;
  border-radius: 8px;
}

/* Utility */
.text-medium-emphasis {
  opacity: 0.7;
}
/* Record Data Section - groups values and series visually */
.record-data-section {
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 12px;
  padding: 16px;
  background: rgba(var(--v-theme-primary), 0.02);
  margin-top: 12px;
}

/* Notes Section - visually distinct */
.notes-section-wrapper {
  border: 1px solid rgba(103, 58, 183, 0.2);
  border-radius: 12px;
  padding: 16px;
  background: rgba(103, 58, 183, 0.02);
  margin-top: 20px;
}

.notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.notes-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

.notes-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #7c3aed;
  border-radius: 6px;
}

.markdown-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #ede9fe;
  color: #7c3aed;
  padding: 4px 10px;
  border-radius: 16px;
  font-size: 0.75rem;
  font-weight: 500;
}

.notes-editor-wrapper {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

/* Unified section title styling */
.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

</style>
