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
import { useMeasurementTemplatesStore } from '@/stores/measurement-templates'
import { useProjectStore } from '@/stores/project/project'
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
  /** id boardcard pro propojení s měřením */
  boardCardId?: number | null
  /** při duplikování měření sem předejte zdrojové měření */
  duplicateFrom?: {
    type: string | null  // název šablony
    unit: string | null  // kód přístroje
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

/* vyskakovací okna */
const showSuccessToast = ref(false)
const showValidationError = ref(false)
const validationErrorMessage = ref('')
const lastCreatedMeasurementId = ref<number | null>(null)

/* varovné dialogy */
const showClearAllWarning = ref(false)
const showApplyDataWarning = ref(false)
const showEmptySeriesWarning = ref(false)
const showGoBackWarning = ref(false)
const pendingAction = ref<'back' | 'close'>('back')

/* stav validace sérií */
const showSeriesValidation = ref(false)

/* mřížka pro mapování dat */
const showDataMappingGrid = ref(false)
const rawGridData = ref<(string | number)[][]>([])




/* store + přístroje */
const deviceStore = useDeviceStore()
const storeDevices = computed(() => deviceStore.devices)
async function ensureDeviceStoreLoaded(): Promise<void> {
  if (!deviceStore.devices.length) {
    await deviceStore.fetchDevices().catch(() => {})
  }
}
void ensureDeviceStoreLoaded()

/* stav dialogu */
const wizardStep = ref<1 | 2 | 3>(1)
const saving = ref(false)
const importPanelOpen = ref(false)
const mappingApplied = ref(false)  // sledování, zda uživatel použil vlastní mapování
const mappingAutoApplied = ref(false)  // sledování, zda bylo mapování automaticky použito z naučených
const learnedMappingsAvailable = ref(false)  // sledování, zda pro aktuální import existují naučená mapování
const showHelp = ref(true)

/* výběry metadat */
const selectedMember = ref<string>('')
const selectedDeviceId = ref<string>('')
const selectedTemplateId = ref<string | null>(null)
const measurementNote = ref<string>('')
const membersList = computed<string[]>(() => (props.members ?? []).map(m => m.username))

/* obsluha režimu duplikace - předvyplnění ze zdrojového měření */
watch(() => props.duplicateFrom, (source) => {
  if (!source) return

  // předvyplnění přístroje
  if (source.unit) {
    selectedDeviceId.value = source.unit
  }

  // předvyplnění šablony podle názvu
  if (source.type) {
    const template = props.templates.find(t => t.name === source.type)
    if (template) {
      selectedTemplateId.value = template.id
    }
  }

  // předvyplnění poznámky
  if (source.note) {
    measurementNote.value = source.note
  }

  // předvyplnění člena
  if (source.measuredByUsername) {
    selectedMember.value = source.measuredByUsername
  }

  // počkat na výběr šablony a poté předvyplnit záznamy
  nextTick(() => {
    if (source.values && source.values.length > 0) {
      // seskupení hodnot podle čísla záznamu
      const recordMap = new Map<number, Array<{ fieldName: string; value: unknown; blockIndex?: number }>>()
      for (const v of source.values) {
        const recNum = v.recordNumber ?? 1
        if (!recordMap.has(recNum)) recordMap.set(recNum, [])
        recordMap.get(recNum)!.push({ fieldName: v.fieldName, value: v.value, blockIndex: v.blockIndex })
      }

      // nejdříve inicializace záznamů ze šablony
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

    // přechod na krok 2 (data)
    if (canProceedToData.value) {
      wizardStep.value = 2
    }
  })
}, { immediate: true })

/* validace kroku 1 */
const canProceedToData = computed(() => !!selectedDeviceId.value && !!selectedTemplateId.value)

/* dialog pro vytvoření přístroje */
const showDeviceCreate = ref(false)
function openDeviceCreate(): void { showDeviceCreate.value = true }
function onDeviceCreated(dev: { id: number; code: string; name: string; color?: string | null; active: boolean }): void {
  selectedDeviceId.value = dev.code
  showDeviceCreate.value = false
}

/* záznamy */
const records = ref<MeasurementRecord[]>([])
const currentRecordIndex = ref<number>(1)
const selectedRecordIndexes = ref<Set<number>>(new Set())

/* navigace mezi bloky */
const currentBlockIndex = ref<number>(0)

/* odvozená šablona */
const selectedTemplate = computed<TemplateItem | null>(() => {
  if (!selectedTemplateId.value) return null
  return props.templateById.get(selectedTemplateId.value) ?? null
})
const templateBlocks = computed<TemplateBlockRow[]>(() => {
  const tpl = selectedTemplate.value
  if (!tpl) return []
  if (tpl.blocks && tpl.blocks.length > 0) {
    // odfiltrování bloků sérií - ty patří do seriessection, ne do běžné navigace u bloků
    // kontrola typu (kind) i názvu (title), aby se série nezobrazovaly jako běžné bloky
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


/* bloky sérií ze šablony - zobrazeny v seriessection */
const templateSeriesBlocks = computed<TemplateBlockRow[]>(() => {
  const tpl = selectedTemplate.value
  if (!tpl || !tpl.blocks) return []

  // detekce bloků sérií podle:
  // 1. kind === 'series' (explicitní příznak z backendu)
  // 2. název obsahuje klíčová slova série/series
  // 3. název obsahuje běžné vzory pro série dat (size data, intensity, distribution)
  // 4. bloky s příponou "data" a více číselnými poli
  return tpl.blocks.filter(b => {
    const titleLower = b.title?.toLowerCase() || ''

    // explicitní typ série
    if (b.kind === 'series') return true

    // přímé klíčové slovo série/series
    if (titleLower.includes('série') || titleLower.includes('series')) return true

    // běžné vzory dls/měřicích sérií
    if (titleLower.includes('size') && titleLower.includes('data')) return true
    if (titleLower.includes('intensity')) return true
    if (titleLower.includes('distribution')) return true

    // bloky končící na "data", které mají alespoň 2 pole (pravděpodobně série)
    if (titleLower.endsWith('data') && b.fields && b.fields.length >= 2) {
      // kontrola, zda je většina polí číselných (float/int) - indikátor série
      const numericFields = b.fields.filter(f => f.type === 'float' || f.type === 'int')
      return numericFields.length >= Math.floor(b.fields.length * 0.7)
    }

    return false
  })
})

/* definice polí sérií ze šablony - předáno seriessection pro dynamické sloupce */
const seriesFieldDefinitions = computed<Array<{ name: string; type: 'float' | 'int' | 'text'; required: boolean }>>(() => {
  const blocks = templateSeriesBlocks.value
  if (!blocks.length) return []
  // získání polí z prvního bloku série jako definici sloupců
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
      // přeskočit bloky sérií - ty se řeší samostatně v seriessection
      // stejná filtrace jako u templateblocks
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

/* pole aktuálního bloku */
const currentBlockFields = computed<RecordField[]>(() => {
  const rec = records.value.find(r => r.recordIndex === currentRecordIndex.value)
  if (!rec || !currentBlock.value) return []
  const blockIdx = currentBlock.value.blockIndex
  return rec.fields.filter(f => (f.blockIndex ?? 1) === blockIdx)
})

/* pomocné funkce pro vazby šablony */
function textModel(field: RecordField): string | number | null {
  const val = field.value
  return (val === undefined ? null : (val as string | number | null))
}
function dateModel(field: RecordField): string | null {
  const val = field.value
  // pokud je to již číslo (epocha v ms), převod na yyyy-mm-dd
  if (typeof val === 'number') {
    return new Date(val).toISOString().slice(0, 10)
  }
  // pokud je to řetězec, zkusit zparsovat jako český datum (např. "4. října 2022 16:58:51")
  if (typeof val === 'string' && val.trim()) {
    const parsed = parseCzechDate(val)
    if (parsed.success && parsed.date) {
      return parsed.date.toISOString().slice(0, 10)
    }
    // pokud je to již ve formátu yyyy-mm-dd, vrátit jak je
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return val
    }
  }
  return null
}
function timeModel(field: RecordField): string | null {
  const val = field.value
  // pokud je to již číslo (epocha v ms), extrahovat čas jako hh:mm
  if (typeof val === 'number') {
    const d = new Date(val)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  // pokud je to řetězec, zkusit zparsovat jako český datum (např. "4. října 2022 16:58:51")
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

/* číselná pole + statistiky */
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

/* stav validace */
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

/* vypočítané vlastnosti pro validaci sérií */
// kontrola, zda má nějaká série alespoň jednu neprázdnou hodnotu
const seriesHasAnyData = computed<boolean>(() => {
  return seriesData.value.some(s =>
    s.data.some(row =>
      Object.values(row).some(val => val !== null && val !== '')
    )
  )
})

// kontrola, zda série obsahuje prázdná povinná pole, když existuje alespoň jedna hodnota
const seriesHasIncompleteData = computed<boolean>(() => {
  if (!seriesHasAnyData.value) return false

  return seriesData.value.some(s => {
    const columns = s.columns || []
    return s.data.some(row =>
      columns.some(col => col.required && (row[col.name] === null || row[col.name] === ''))
    )
  })
})

// kontrola, zda série existuje v šabloně, ale je zcela prázdná
const seriesIsEmpty = computed<boolean>(() => {
  return templateSeriesBlocks.value.length > 0 && !seriesHasAnyData.value
})

/* detekce "dirty" stavu - kontrola, zda uživatel provedl nějaké změny */
const hasAnyChanges = computed<boolean>(() => {
  // kontrola, zda má nějaký záznam data
  const hasRecordData = records.value.some(r =>
    r.fields.some(f => f.value !== null && f.value !== '' && f.value !== undefined)
  )
  // kontrola, zda mají série data
  const hasSeriesData = seriesHasAnyData.value
  // kontrola poznámek
  const hasNotes = !!measurementNote.value && measurementNote.value.trim() !== ''
  // kontrola importovaného souboru
  const hasImportedFile = !!importedFile.value

  return hasRecordData || hasSeriesData || hasNotes || hasImportedFile
})

/* pomocníci pro zaměření (focus) */
function focusFieldByIndex(idx: number, flashAnimation = false): void {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-field-input]')
    const el = els[idx]
    if (!el) return

    // nejdříve odrolovat na zobrazení
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // zaměření po odrolování
    setTimeout(() => {
      el.focus()

      // přidání animace bliknutí, pokud je vyžadována
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
 * najde první neplatné pole napříč všemi záznamy a bloky, přejde tam a zobrazí chybu.
 * vrací true, pokud bylo nalezeno neplatné pole, false, pokud jsou všechna platná.
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

        // zjištění, do kterého bloku toto pole patří
        const blockIdx = templateBlocks.value.findIndex(b => b.blockIndex === (field.blockIndex ?? 1))
        console.warn('[DEBUG goToFirstInvalidField] Block index for field:', blockIdx, 'Template blocks:', templateBlocks.value.map(b => ({ blockIndex: b.blockIndex, title: b.title })))

        // navigace na daný záznam a blok
        currentRecordIndex.value = record.recordIndex
        if (blockIdx >= 0) currentBlockIndex.value = blockIdx

        // zobrazení chybové zprávy
        validationErrorMessage.value = `Záznam ${record.recordIndex}: pole "${field.name}" - ${error}`
        showValidationError.value = true

        // zaměření pole po navigaci
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

/* navigace mezi bloky */
function prevBlock(): void { if (currentBlockIndex.value > 0) currentBlockIndex.value-- }
function nextBlock(): void { if (currentBlockIndex.value < templateBlocks.value.length - 1) currentBlockIndex.value++ }

/* sledování externího výběru šablony (např. po vytvoření nové šablony) */
watch(() => props.initialTemplateId, (newId) => {
  if (newId && props.modelValue) {
    selectedTemplateId.value = newId
  }
})

/* při změně vybrané šablony resetovat data sérií a stav importu */
watch(selectedTemplateId, (newVal, oldVal) => {
  // přeskočit, pokud je templateid nastavováno poprvé (z null) nebo se nezměnilo
  if (oldVal === null || newVal === oldVal) return

  // vymazat všechna data při změně šablony - čistý začátek pro novou šablonu
  seriesData.value = []
  resetImport()
  records.value = []
  currentBlockIndex.value = 0
  currentRecordIndex.value = 1
  selectedRecordIndexes.value = new Set()
  visitedFields.value.clear()
  touchedFields.value.clear()
})

/* inicializace */
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
  seriesData.value = [] // resetovat data sérií při otevření dialogu
  resetImport()
}

/* přechody mezi kroky */
function goToNextStep(): void {
  console.warn('[DEBUG goToNextStep] Current step:', wizardStep.value)
  console.warn('[DEBUG goToNextStep] Records count:', records.value.length)
  console.warn('[DEBUG goToNextStep] Series data:', JSON.stringify(seriesData.value, null, 2))

  if (wizardStep.value === 1) {
    if (!canProceedToData.value) return
    // inicializace záznamů, pokud jsou prázdné
    if (records.value.length === 0) {
      records.value = [newRecordFromTemplateFields(1, templateFields.value)]
      currentRecordIndex.value = 1
      currentBlockIndex.value = 0
      selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
      visitedFields.value.clear()
      touchedFields.value.clear()

      // inicializace dat sérií z bloků sérií v šabloně (pokud existují)
      // vytvoří prázdné položky sérií se správnou strukturou podle definice v šabloně
      const seriesBlocks = templateSeriesBlocks.value
      console.warn('[DEBUG goToNextStep] Series blocks from template:', seriesBlocks)
      if (seriesBlocks.length > 0) {
        seriesData.value = seriesBlocks.map((block, idx) => {
          // převod polí bloku na definice sloupců
          const columns = block.fields?.map(f => ({
            name: f.name,
            type: f.type as 'float' | 'int' | 'text',
            required: f.required
          })) || []

          // vytvoření 5 prázdných řádků s null hodnotami
          const emptyRows: Record<string, number | string | null>[] = []
          for (let i = 0; i < 5; i++) {
            const row: Record<string, number | string | null> = {}
            columns.forEach(col => {
              row[col.name] = null  // prázdná hodnota, uživatel vyplní
            })
            emptyRows.push(row)
          }

          return {
            seriesType: block.title || `Série ${idx + 1}`,
            seriesName: block.title || undefined,
            linkedRecordIndex: currentRecordIndex.value,
            linkedRecordDescription: `Záznam ${currentRecordIndex.value}`,
            columns: columns,  // zahrnutí definic sloupců
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
    // označení všech polí jako dotčených (touched) pro zobrazení validačních chyb
    records.value.forEach(r => r.fields.forEach(f => markFieldTouched(f)))

    // povolení zobrazení validace sérií
    showSeriesValidation.value = true

    console.warn('[DEBUG goToNextStep] Step 2 -> 3 validation')
    console.warn('[DEBUG goToNextStep] invalidTotal:', invalidTotal.value)
    console.warn('[DEBUG goToNextStep] seriesHasAnyData:', seriesHasAnyData.value)
    console.warn('[DEBUG goToNextStep] seriesHasIncompleteData:', seriesHasIncompleteData.value)
    console.warn('[DEBUG goToNextStep] seriesIsEmpty:', seriesIsEmpty.value)

    // kontrola validace - pokud je neplatná, přejít na první chybu
    if (invalidTotal.value > 0) {
      console.warn('[DEBUG goToNextStep] Validation failed, finding first invalid field...')
      goToFirstInvalidField()
      return
    }

    // kontrola, zda mají série neúplná povinná data
    if (seriesHasIncompleteData.value) {
      validationErrorMessage.value = 'Datová série obsahuje nezadaná povinná pole. Doplňte hodnoty nebo smažte prázdné řádky.'
      showValidationError.value = true
      return
    }

    // kontrola, zda je série zcela prázdná - zobrazit varovný dialog
    if (seriesIsEmpty.value) {
      showEmptySeriesWarning.value = true
      return
    }

    console.warn('[DEBUG goToNextStep] Validation passed, going to step 3')
    wizardStep.value = 3
  }
}


/* navigace s varováním o neuložených změnách */
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
  // z kroku 2: zkontrolovat, zda existují změny
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
  // resetovat všechna data
  doClearAll()

  if (pendingAction.value === 'close') {
    close()
  } else {
    goToPrevStep()
  }
}

function close(): void { emits('update:modelValue', false) }

/* potvrzení varování o sériích */
function confirmSaveWithoutSeries(): void {
  showEmptySeriesWarning.value = false
  // vymazat prázdná data sérií před pokračováním
  seriesData.value = []
  wizardStep.value = 3
}

/* ============================================
   KONCEPTY (DRAFTS) - localStorage
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

// kontrola, zda koncept existuje v localstorage
const hasDraft = computed<boolean>(() => {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
    return !!stored
  } catch {
    return false
  }
})

// získat informace o konceptu bez načítání
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

// uložit aktuální stav jako koncept
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
    // zobrazení úspěšné zpětné vazby
    validationErrorMessage.value = 'koncept byl uložen'
    showValidationError.value = true
  } catch (e) {
    console.error('Failed to save draft:', e)
  }
}

// načíst koncept z localstorage
function loadDraft(): void {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!stored) return

    const draft = JSON.parse(stored) as MeasurementDraft

    // obnovit stav - přetypování na očekávané typy
    if (draft.templateId != null) selectedTemplateId.value = draft.templateId as typeof selectedTemplateId.value
    if (draft.deviceId != null) selectedDeviceId.value = draft.deviceId as typeof selectedDeviceId.value
    if (draft.memberId) selectedMember.value = draft.memberId
    if (draft.measurementNote) measurementNote.value = draft.measurementNote
    if (draft.records) records.value = draft.records
    if (draft.seriesData) seriesData.value = draft.seriesData

    showDraftDialog.value = false

    // přejít na krok 2, pokud je vybraná šablona a přístroj
    if (draft.templateId && draft.deviceId) {
      wizardStep.value = 2
    }
  } catch (e) {
    console.error('Failed to load draft:', e)
  }
}

// vymazat koncept z localstorage
function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch (e) {
    console.error('Failed to clear draft:', e)
  }
}

// zavřít dialog konceptů bez načtení
function dismissDraftDialog(): void {
  showDraftDialog.value = false
  clearDraft()
}

/* operace se záznamem */
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

  // vyhledání dalšího záznamu k výběru po smazání
  const sorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  const posInSorted = sorted.indexOf(currentRecordIndex.value)

  // odstranění záznamu
  records.value.splice(idx, 1)

  // po smazání vybrat další záznam (nebo předchozí, pokud jsme smazali poslední)
  const newSorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
  if (posInSorted < newSorted.length) {
    // na této pozici je stále záznam (ten, který byl po smazaném)
    currentRecordIndex.value = newSorted[posInSorted]!
  } else {
    // smazali jsme poslední, přejít na nový poslední záznam
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

/* úprava pole */
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
  // získat existující datum z pole nebo použít dnešek jako fallback
  let datePart: string | null = dateModel(field)
  if (!datePart) {
    // použít dnešní datum, pokud není nastaveno žádné datum
    datePart = new Date().toISOString().slice(0, 10)
  }
  // spojení data a času do epoch milisekund
  const [hours, minutes] = (timeStr || '00:00').split(':').map(Number)
  const [year, month, day] = datePart.split('-').map(Number)
  const combined = new Date(year, month - 1, day, hours || 0, minutes || 0, 0)
  field.value = combined.getTime()
}

/* stav importu - z composable */
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

// spočítat, kolik polí šablony nemá odpovídající hlavičky v importovaných datech
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

/* ruční výběr z mřížky */
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
 * převod importovaných dat sérií na 2d pole řetězců pro seriesdatapicker
 * kombinuje všechny sloupce sérií do jedné tabulky: řádek hlavičky + datové řádky
 * pokud nejsou data sérií, použije řádky hlavního bloku
 */
const seriesRawDataForPicker = computed<string[][] | undefined>(() => {
  const structure = importedStructure.value
  if (!structure) return undefined

  // pokud máme data sérií, převést je na 2d pole
  if (structure.series && structure.series.length > 0) {
    // posbírat všechny unikátní názvy sloupců ze všech sérií
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
        // výchozí sloupce x/y
        if (!seenCols.has(s.xLabel)) { seenCols.add(s.xLabel); allColumns.push(s.xLabel) }
        if (!seenCols.has(s.yLabel)) { seenCols.add(s.yLabel); allColumns.push(s.yLabel) }
      }
    }

    if (allColumns.length === 0) return structure.blocks[0]?.originalRows

    // vytvoření řádku hlavičky
    const rows: string[][] = [allColumns]

    // nalezení maximální délky dat napříč všemi sériemi
    let maxDataLen = 0
    for (const s of structure.series) {
      if (Array.isArray(s.data)) {
        maxDataLen = Math.max(maxDataLen, s.data.length)
      }
    }

    // vytvoření datových řádků - sloučení všech dat sérií
    for (let i = 0; i < maxDataLen; i++) {
      const row: string[] = allColumns.map(() => '')

      for (const s of structure.series) {
        if (!Array.isArray(s.data) || !s.data[i]) continue
        const dataPoint = s.data[i]

        // obsluha formátu {x, y}
        if ('x' in dataPoint && 'y' in dataPoint) {
          const xColIdx = allColumns.indexOf(s.xLabel)
          const yColIdx = allColumns.indexOf(s.yLabel)
          if (xColIdx >= 0 && dataPoint.x != null) row[xColIdx] = String(dataPoint.x)
          if (yColIdx >= 0 && dataPoint.y != null) row[yColIdx] = String(dataPoint.y)
        }
        // obsluha formátu record<string, ...>
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

  // návrat k řádkům hlavního bloku
  return structure.blocks[0]?.originalRows
})

function openGridPicker(fieldName: string): void {
  gridPickerTargetField.value = fieldName
  gridPickerOpen.value = true
}

function applyGridPickerValues(values: (string | number)[]): void {
  // rozdělení hodnot napříč záznamy pro cílové pole
  const fieldName = gridPickerTargetField.value

  // automatické vytvoření záznamů, pokud jich potřebujeme více než existuje
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
      // parsování hodnoty na základě typu pole
      if (field.type === 'int') {
        field.value = parseInt(String(val), 10) || 0
      } else if (field.type === 'float') {
        const normalized = String(val).replace(',', '.')
        field.value = parseFloat(normalized) || 0
      } else if (field.type === 'date') {
        // pokus o parsování hodnot data
        const dateMs = toDateMs(String(val))
        field.value = dateMs ?? val
      } else {
        field.value = val
      }
    }
  })

  // navigace na první záznam pro zobrazení použitých hodnot
  if (sortedRecords[0]) {
    currentRecordIndex.value = sortedRecords[0].recordIndex
    currentBlockIndex.value = 0
  }
}

/* stav sérií */
const seriesData = ref<SeriesData[]>([])
const recordOptions = computed(() =>
  records.value.map(r => ({
    title: `Záznam ${r.recordIndex}`,
    value: r.recordIndex
  }))
)

/* filtrované série - zobrazit pouze série pro aktuální záznam nebo nepropojené série */
const currentRecordSeriesData = computed<SeriesData[]>({
  get: () => {
    return seriesData.value.filter(s =>
      s.linkedRecordIndex === null ||
      s.linkedRecordIndex === currentRecordIndex.value
    )
  },
  set: (newFiltered: SeriesData[]) => {
    // když se seriessection aktualizuje, sloučit změny zpět do úplného seznamu
    // toto je složitější - musíme aktualizovat pouze odpovídající položky
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
  // získat sérii z filtrovaného seznamu
  const filtered = currentRecordSeriesData.value
  const seriesToRemove = filtered[filteredIdx]
  if (!seriesToRemove) return

  // najít ji v úplném seznamu a odstranit
  const fullIdx = seriesData.value.findIndex(s =>
    s.seriesName === seriesToRemove.seriesName &&
    s.linkedRecordIndex === seriesToRemove.linkedRecordIndex &&
    s.seriesType === seriesToRemove.seriesType
  )
  if (fullIdx !== -1) {
    seriesData.value.splice(fullIdx, 1)
  }
}

/* obsluha vložení z lišty nástrojů */
async function onPasteCurrent(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) return

    const recordsFromPaste = await parsePasteAndBuildRecords(text)
    if (!recordsFromPaste.length) {
      validationErrorMessage.value = 'Ve schránce nebyla nalezena žádná platná data.'
      showValidationError.value = true
      return
    }

    // použít první záznam z vložení k vyplnění aktuálního záznamu
    const sourceRec = recordsFromPaste[0]
    const targetRec = records.value.find(r => r.recordIndex === currentRecordIndex.value)

    if (targetRec && sourceRec) {
      // aktualizace polí, která mají ve zdroji hodnoty
      for (const sourceField of sourceRec.fields) {
        if (sourceField.value !== null && sourceField.value !== '') {
          const targetField = targetRec.fields.find(f => f.name === sourceField.name)
          if (targetField) {
            targetField.value = sourceField.value
            markFieldTouched(targetField)
          }
        }
      }
      showSuccessToast.value = true
    }
  } catch (err) {
    console.error('Paste failed:', err)
    validationErrorMessage.value = 'Nepodařilo se načíst data ze schránky.'
    showValidationError.value = true
  }
}

async function onPasteMultiple(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) return

    const recordsFromPaste = await parsePasteAndBuildRecords(text)
    if (!recordsFromPaste.length) {
      validationErrorMessage.value = 'Ve schránce nebyla nalezena žádná platná data.'
      showValidationError.value = true
      return
    }

    // přidat jako nové záznamy
    const startIdx = records.value.length
      ? Math.max(...records.value.map(r => r.recordIndex)) + 1
      : 1

    // přeznačení indexů vložených záznamů (re-index)
    const newRecords = recordsFromPaste.map((r, i) => ({
      ...r,
      recordIndex: startIdx + i
    }))

    records.value.push(...newRecords)

    // výběr prvního nového záznamu
    currentRecordIndex.value = newRecords[0].recordIndex
    currentBlockIndex.value = 0
    selectedRecordIndexes.value.add(newRecords[0].recordIndex)

    showSuccessToast.value = true
  } catch (err) {
    console.error('Paste failed:', err)
    validationErrorMessage.value = 'Nepodařilo se načíst data ze schránky.'
    showValidationError.value = true
  }
}

// pomocná funkce pro parsování vloženého textu do záznamů kompatibilních s aktuální šablonou
async function parsePasteAndBuildRecords(text: string): Promise<MeasurementRecord[]> {
  const file = new File([text], 'paste.txt', { type: 'text/plain' })
  const structure = await parseImportedMeasurementFile(file)

  if (!structure || !structure.blocks.length) return []

  const tmpl = buildTemplateLike()
  if (!tmpl) return []

  // zajištění kompatibility parsování/mapování, pokud je to možné
  // u jednoduchého vložení spoléháme na shodu hlaviček (normalizace bez ohledu na velikost písmen)
  // nebudeme zde spouštět plného průvodce mapováním, pouze s nejlepším úsilím najdeme shodu

  const recs = buildRecordsFromImported(tmpl, structure)

  // převod do ui formátu (measurementrecord) pomocí existujícího pomocníka
  const uiFormat = recs.map(r => ({
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

  return normalizeImportedRecords(uiFormat)
}

/* pomocníci pro import */
function toggleImportPanel(): void {
  if (!selectedTemplate.value) return
  importPanelOpen.value = !importPanelOpen.value
}
function resetImport(): void {
  composableResetImport()
}

/** ruční změna datového typu */
const showTemplateUpdateDialog = ref(false)
const pendingTemplateUpdate = ref<{ 
  fieldName: string; 
  changeType: 'type' | 'required'; 
  oldValue: unknown; 
  newValue: unknown 
} | null>(null)

function onFieldTypeUpdate(field: RecordField, newType: string): void {
  console.log('DEBUG onFieldTypeUpdate:', field.type, newType)
  pendingTemplateUpdate.value = {
    fieldName: field.name,
    changeType: 'type',
    oldValue: field.type,
    newValue: newType
  }
  // showtemplateupdatedialog.value = true
  // přímo použít změnu pouze pro toto měření
  applyTemplateUpdate(false)
}

function onFieldRequiredUpdate(field: RecordField, required: boolean): void {
  pendingTemplateUpdate.value = {
    fieldName: field.name,
    changeType: 'required',
    oldValue: field.required,
    newValue: required
  }
  // showtemplateupdatedialog.value = true
  // přímo použít změnu pouze pro toto měření
  applyTemplateUpdate(false)
}

async function applyTemplateUpdate(updateTemplate: boolean): Promise<void> {
  if (!pendingTemplateUpdate.value) return
  showTemplateUpdateDialog.value = false

  const { fieldName, changeType, newValue } = pendingTemplateUpdate.value

  // 1. aktualizace všech existujících záznamů lokálně
  records.value.forEach(rec => {
    const f = rec.fields.find(f => f.name === fieldName)
    if (f) {
      if (changeType === 'type') {
        const newType = newValue as ValueType
        f.type = newType
        f.value = convertValueForField(String(f.value), newType)
      } else if (changeType === 'required') {
        f.required = newValue as boolean
      }
    }
  })

  // 2. také aktualizovat templatefields (což ovlivní nové záznamy)
  const tmplField = templateFields.value.find(f => f.name === fieldName)
  if (tmplField) {
    if (changeType === 'type') tmplField.type = newValue as ValueType
    else if (changeType === 'required') tmplField.required = newValue as boolean
  }

  // 3. pokud je požadováno, vytvořit novou verzi šablony
  if (updateTemplate && selectedTemplate.value) {
    try {
      const templatesStore = useMeasurementTemplatesStore()
      const projectStore = useProjectStore()
      
      // nejdříve se pokusit najít id projektu z načtených šablon, jinak použít ze storu
      const existingTpl = templatesStore.items.find(t => String(t.id) === String(selectedTemplate.value?.id))
      const projectId = existingTpl?.projectId || projectStore.projectId
      
      if (!projectId) {
        importError.value = 'Chybí ID projektu pro vytvoření šablony'
        return
      }

      const currentTpl = selectedTemplate.value

      const newBlocks = currentTpl.blocks?.map(b => ({
        blockIndex: b.blockIndex,
        title: b.title,
        kind: b.kind,
        fields: b.fields.map(f => {
          let type = f.type
          let required = f.required
          
          if (f.name === fieldName) {
            if (changeType === 'type') type = newValue as ValueType
            else if (changeType === 'required') required = newValue as boolean
          }
          
          return {
            name: f.name,
            type: type,
            required: required,
            orderIndex: f.orderIndex
          }
        })
      })) || []

      const newName = `${currentTpl.name} (v${new Date().toLocaleTimeString()})`

      const newTemplate = await templatesStore.create(Number(projectId), {
        name: newName,
        deviceCode: selectedDeviceId.value,
        blocks: newBlocks
      })

      if (newTemplate?.id) {
        await templatesStore.fetchByProject(Number(projectId))
        selectedTemplateId.value = String(newTemplate.id)
        showSuccessToast.value = true
        console.log('Created and selected new template version:', newTemplate.id)
      }
    } catch (e) {
      console.error('Failed to update template version:', e)
      importError.value = 'Nepodařilo se vytvořit novou verzi šablony.'
    }
  }
}

/**
 * otevře dialog mřížky pro mapování dat
 * převede importovaná data do formátu mřížky pro ruční mapování
 */
function openDataMappingGrid(): void {
  console.log('[openDataMappingGrid] Called', {
    hasBlocks: !!importedStructure.value?.blocks?.length,
    hasFile: !!importedFile.value,
    blocksCount: importedStructure.value?.blocks?.length
  })

  // pokus o sestavení mřížky z bloků importované struktury
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

  // pokud jsou bloky prázdné, zkusit zparsovat přímo soubor
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
 * použití výběrů z manualheaderpickerdialog
 * tableheaders -> stanou se hodnotami polí v záznamech
 * seriesheaders -> stanou se sloupci dat sérií
 */
function onManualHeaderPickerApply(result: { tableHeaders: string[], seriesHeaders: string[], headerRowIndex: number | null }): void {
  console.log('[onManualHeaderPickerApply] Received:', result)

  const { tableHeaders, seriesHeaders } = result

  // pokud jsme získali hlavičky tabulky, spárovat je s poli šablony a vytvořit záznamy
  if (tableHeaders.length > 0) {
    // pokus o nalezení odpovídajících polí šablony nebo použití hlaviček jako hodnot polí
    const rec = records.value.find(r => r.recordIndex === currentRecordIndex.value)
    if (rec) {
      // pro každou hlavičku tabulky se pokusit vyplnit odpovídající pole
      for (let i = 0; i < tableHeaders.length && i < rec.fields.length; i++) {
        rec.fields[i].value = tableHeaders[i]
      }
    }
    console.log('[onManualHeaderPickerApply] Applied', tableHeaders.length, 'table headers to current record')
  }

  // pokud jsme získali hlavičky sérií, vytvořit novou sérii s těmito sloupci
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
        // vytvoření prvního řádku s názvy sloupců jako počáteční strukturu
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
 * kontrola, zda má nějaké pole vyplněna smysluplná data (ignorujeme prázdné záznamy)
 */
function hasFilledData(): boolean {
  // pokud máme více než jeden záznam, považujeme to za přítomnost dat
  if (records.value.length > 1) return true
  // kontrola, zda má nějaké pole neprázdnou hodnotu
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
 * vymazat všechna data - není vyžadováno potvrzení
 */
function requestClearAll(): void {
  doClearAll()
}

/**
 * skutečné vymazání všech dat
 */
function doClearAll(): void {
  console.log('[doClearAll] Clearing all data')
  showClearAllWarning.value = false

  // vymazat stav importu
  resetImport()

  // resetovat záznamy na výchozí prázdný stav (1 prázdný záznam)
  records.value = [newRecordFromTemplateFields(1, templateFields.value)]
  currentRecordIndex.value = 1
  currentBlockIndex.value = 0
  selectedRecordIndexes.value = new Set([1])

  // vymazat data sérií
  seriesData.value = []

  // vymazat poznámky
  measurementNote.value = ''

  // vymazat stav validace
  visitedFields.value.clear()
  touchedFields.value.clear()
}

// funkce clearall - obal, který zobrazí varování, pokud existují data
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
  // odfiltrovat bloky typu series - ty patří do seriessection, ne do mapování
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

    // synchronizace importovaných sérií se sériemi definovanými v šabloně
    // strategie: vyplnit existující série šablony importovanými daty, nevytvářet nové série
    if (structure.series?.length && seriesData.value.length > 0) {
      // seskupení importovaných sérií podle indexu záznamu pro efektivní vyhledávání
      const importedByRecord = new Map<number, typeof structure.series>()
      for (const s of structure.series) {
        const recIdx = s.linkedRecordIndex || 0
        if (!importedByRecord.has(recIdx)) {
          importedByRecord.set(recIdx, [])
        }
        importedByRecord.get(recIdx)!.push(s)
      }

      // pro každou sérii šablony se pokusit vyplnit data z importu
      const updatedSeries = seriesData.value.map(templateSeries => {
        const columns = templateSeries.columns || []
        if (columns.length === 0) return templateSeries

        // nalezení importované série, která by mohla odpovídat sloupcům šablony
        // shoda podle názvu sloupce (např. sloupec šablony "sizes" -> importovaná série "sizes")
        const seriesForRecord = importedByRecord.get(templateSeries.linkedRecordIndex || 0)
          || importedByRecord.get(0)
          || Array.from(importedByRecord.values())[0]
          || []

        // sestavení dat řádků mapováním každého sloupce na jeho importovanou sérii
        let maxRows = 0
        const columnDataMap = new Map<string, (number | string | null)[]>()

        for (const col of columns) {
          // nalezení importované série odpovídající tomuto názvu sloupce
          const matchingSeries = seriesForRecord.find(s =>
            s.seriesName?.toLowerCase() === col.name.toLowerCase() ||
            s.yLabel?.toLowerCase() === col.name.toLowerCase() ||
            s.xLabel?.toLowerCase() === col.name.toLowerCase()
          )

          if (matchingSeries && Array.isArray(matchingSeries.data)) {
            // extrakce hodnot z dat sérií
            const values: (number | string | null)[] = []
            for (const row of matchingSeries.data as { x?: number; y?: number }[]) {
              // použít hodnotu y, pokud sloupec odpovídá ylabel, jinak x
              const val = col.name.toLowerCase() === matchingSeries.xLabel?.toLowerCase()
                ? row.x
                : row.y
              values.push(val ?? null)
            }
            columnDataMap.set(col.name, values)
            maxRows = Math.max(maxRows, values.length)
          }
        }

        // pokud nebyla namapována žádná data, ponechat původní data šablony
        if (columnDataMap.size === 0) return templateSeries

        // sestavení řádků z dat sloupců
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
      // žádné série v šabloně, použít importované série jak jsou
      seriesData.value = structure.series.map(s => ({
        seriesType: s.seriesType,
        seriesName: s.seriesName,
        linkedRecordIndex: s.linkedRecordIndex,
        linkedRecordDescription: s.linkedRecordDescription,
        data: s.data,
        columns: s.columns
      }))
    }
    // poznámka: pokud soubor nemá žádné série, ponechat stávající série ze šablony beze změny


    const tmpl = buildTemplateLike()
    if (!tmpl) {
      importError.value = 'Šablona není dostupná.'
      return
    }
    const compat = checkTemplateCompatibility(tmpl, structure)
    importCompatibility.value = { compatible: compat.compatible, reasons: compat.reasons }

    if (!compat.compatible) {
      // neodpovídá podle názvů hlaviček - zkontrolovat, zda existují naučená mapování
      importPanelOpen.value = true

      // kontrola naučených mapování
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
 * požadavek na použití importovaných dat - zobrazí varování, pokud data existují
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

  // již kompatibilní - použít přímo
  console.log('[requestApplyImport] Calling doApplyImport directly')
  doApplyImport()
}

/**
 * skutečné použití importovaných záznamů
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

  // použití posunu řádků (row offset) oříznutím řádků z každého bloku
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

  // === EXTRAKCE DAT SÉRIÍ Z PARSOVANÝCH SÉRIÍ ===
  // strategie: pokud máme série v šabloně, vyplnit jejich sloupce odpovídajícími importovanými daty
  // pokud v šabloně série nejsou, vytvořit série z importu (fallback)
  const importedSeries = adjustedStructure.series || []

  console.log('[doApplyImport] Imported series from parser:', importedSeries.length)
  console.log('[doApplyImport] Template series count BEFORE init:', seriesData.value.length)

  // inicializace sérií šablony, pokud ještě nebyla provedena (doapplyimport může být voláno před gootonextstep)
  if (seriesData.value.length === 0) {
    // debug: vypsat všechny bloky šablony pro pochopení detekce
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
    // získat sloupce šablony ze seriesdata nebo templateseriesblocks
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

      // vytvoření sérií pro každý záznam
      const allSeries: SeriesData[] = []

      for (const [recordIndex, recordSeriesList] of seriesByRecord) {
        // sestavení dat sloupců pro tento záznam
        let maxRows = 0
        const columnDataMap = new Map<string, (number | string | null)[]>()

        for (const col of templateColumns) {
          // nalezení importované série, která obsahuje data pro tento sloupec
          // importovaná série má nyní data ve více sloupcích ve formátu: { sizes: x, intensities: y1, ... }
          const values: (number | string | null)[] = []

          for (const importedS of recordSeriesList) {
            if (!Array.isArray(importedS.data) || importedS.data.length === 0) continue

            // kontrola, zda tato série má data pro tento sloupec
            const firstRow = importedS.data[0] as Record<string, unknown>
            if (col.name in firstRow) {
              // extrakce hodnot pro tento sloupec ze všech řádků
              for (const row of importedS.data as Record<string, number | string | null>[]) {
                values.push(row[col.name] ?? null)
              }
              break // data pro tento sloupec nalezena
            }

            // fallback: kontrola starého formátu x/y
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
      // žádné série v šabloně - vytvořit série z importu
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

    // výpis podrobností o první sérii pro ladění
    if (seriesData.value.length > 0) {
      const first = seriesData.value[0]
      console.log(`[doApplyImport] First series: "${first.seriesName}", ${first.data.length} rows`)
    }
  } else {
    console.log('[doApplyImport] No imported series found')
  }


  wizardStep.value = 2
}

// funkce applyimportedrecords - obal, který zobrazí varování, pokud existují data
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

  // sestavení počátečního modelu ze šablony a importované struktury
  let model = buildMappingModel(tmpl, {
    fileName: importedStructure.value.fileName,
    delimiter: importedStructure.value.delimiter,
    blocks: importedStructure.value.blocks.map(b => ({
      blockIndex: b.blockIndex,
      headers: b.headers
    }))
  })

  // načtení naučených návrhů z backendu
  const importStore = useImportStore()
  const headers = importedStructure.value.blocks.flatMap(b => b.headers)
  const templateFieldNames = tmpl.blocks.flatMap(b => b.fields.map(f => f.name))

  try {
    const suggestions = await importStore.suggestLearnedMappings(
      Number(selectedTemplate.value.id),
      headers,
      templateFieldNames
    )
    // aplikace naučených návrhů na model
    if (Object.keys(suggestions).length > 0) {
      model = applyLearnedSuggestions(model, suggestions)
      console.log('[openMappingWizard] Applied', Object.keys(suggestions).length, 'learned mappings')
    }
  } catch (e) {
    console.warn('[openMappingWizard] Failed to fetch learned mappings:', e)
    // pokračovat s původním modelem, pokud api selže
  }

  mappingModel.value = model
  mappingOpen.value = true
}
function onApplyMapping(payload: ReturnType<typeof exportMapping>): void {
  if (!importedStructure.value || !selectedTemplate.value || !mappingModel.value) return
  const base = buildTemplateLike()
  if (!base) return

  // obsluha nové struktury objektu { blockmappings, seriesmappings }
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

  // uložit mapování pro budoucí importy (učení - learning)
  console.log('[onApplyMapping] Checking save condition:', {
    hasTemplateId: !!selectedTemplate.value?.id,
    hasMappingModel: !!mappingModel.value
  })

  if (selectedTemplate.value?.id && mappingModel.value) {
    const importStore = useImportStore()

    // sestavení mapování: hlavička -> název pole (fieldname)
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
      mappingApplied.value = true  // označit, že uživatel použil vlastní mapování
    } else {
      console.warn('[onApplyMapping] No mappings to save!')
      mappingApplied.value = true  // stále označit jako použité i bez uložení
    }
  } else {
    console.warn('[onApplyMapping] Missing template or model - not saving')
  }
}

/**
 * pokus o automatické použití naučených mapování při analýze dat.
 * pokud naučená mapování existují, sestaví model mapování, použije jej a zobrazí úspěšnou zprávu.
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

    // automaticky použít pouze tehdy, pokud máme dostatek naučených mapování (alespoň 50 % polí)
    if (learnedCount >= threshold) {
      console.log('[tryAutoApply] Enough learned mappings - auto-applying!')

      // sestavení modelu mapování a aplikace návrhů
      const tplData = buildTemplateLike()
      if (!tplData) {
        console.log('[tryAutoApply] Could not build template - skipping')
        return
      }

      // sestavení objektu šablony pro buildmappingmodel
      const templateObj = {
        name: tplData.name,
        deviceId: '',
        blocks: tplData.blocks.map(b => ({
          blockIndex: b.blockIndex,
          title: b.title,
          fields: b.fields.map(f => ({ name: f.name, required: f.required, sourceIndex: f.sourceIndex, type: f.type }))
        }))
      }

      // sestavení importovaného objektu pro buildmappingmodel
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

      // sestavení záznamů z mapování (podobně jako v onapplymapping)
      const base = buildTemplateLike()
      if (!base) {
        console.log('[tryAutoApply] Could not build base template - skipping')
        return
      }

      // aplikace mapování na základní šablonu
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
      mappingAutoApplied.value = true  // označit jako automaticky použité

      // aktualizace kompatibility - data jsou nyní "kompatibilní", protože jsme použili naučená mapování
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
 * obsluha požadavku na odvození šablony - vyslání (emit) rodiči pro otevření templatewizarddialog s derivefrom
 */
function onDeriveTemplate(payload: {
  newTemplateName: string;
  extraColumns: Array<{ name: string; headerIndex: number }>
}): void {
  if (!selectedTemplate.value) return

  const currentTpl = selectedTemplate.value

  // sestavení extra polí s výchozím typem 'text'
  const extraFields = payload.extraColumns.map((col, idx) => ({
    orderIndex: (currentTpl.fields?.length ?? 0) + idx + 1,
    type: 'text' as const,
    required: false,
    name: col.name
  }))

  // použití existujícího emit k aktivaci rodiče pro otevření templatewizarddialog
  // rodič measurements.vue to obslouží a otevře templatewizarddialog s propem derivefrom
  emits('deriveTemplate', currentTpl.id)

  // zavřít dialog mapování
  mappingOpen.value = false
}

/* obsluha vložení textu - používá stejné parsování jako import souboru */
async function handlePastedText(text: string): Promise<void> {
  if (!text.trim()) return
  importBusy.value = true
  importError.value = null
  try {
    // použití stejné logiky parsování jako u importu souboru
    // vytvoření objektu file z textu (parseimportedmeasurementfile očekává file)
    const file = new File([text], 'pasted-data.txt', { type: 'text/plain' })
    const structure = await parseImportedMeasurementFile(file)

    if (!structure || !structure.blocks.length) {
      importError.value = 'Nepodařilo se rozpoznat data v textu'
      return
    }

    // uložení zparsované struktury
    importedStructure.value = structure

    // synchronizace importovaných sérií do stavu upravitelných sérií
    if (structure.series?.length) {
      seriesData.value = structure.series.map(s => ({
        seriesType: s.seriesType,
        seriesName: s.seriesName,
        linkedRecordIndex: s.linkedRecordIndex ?? null,
        linkedRecordDescription: '',
        data: s.data,
        columns: s.columns // zachovat definice sloupců, pokud jsou přítomny
      }))
    }

    // kontrola kompatibility s aktuální šablonou
    const tplLike = buildTemplateLike()
    if (tplLike) {
      const compat = checkTemplateCompatibility(tplLike, structure)
      importCompatibility.value = { compatible: compat.compatible, reasons: compat.reasons }

      if (compat.compatible) {
        // automatické použití, pokud je kompatibilní
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

/* klávesové zkratky */
function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  if (key === 'escape') {
    e.preventDefault()
    // pokud jsme v kroku 2 nebo 3, esc funguje jako zpět (back)
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
    // kontrola existujícího konceptu a nabídka jeho načtení
    if (hasDraft.value) {
      showDraftDialog.value = true
    }
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (props.modelValue) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))

/* uložení */
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
    // krok 1: nejprve nahrát všechna pole souborů (file fields)
    const filesToUpload = extractFilesFromRecords(records.value)
    if (filesToUpload.length > 0) {
      // Upload files and store their URLs back into records
      for (const fileInfo of filesToUpload) {
        const result = await uploadFile(fileInfo.file)
        if (result.success) {
          // vyhledat záznam a pole, aktualizovat hodnotu s url ze serveru
          const record = records.value.find(r => r.recordIndex === fileInfo.recordIndex)
          if (record) {
            const field = record.fields.find(
              f => f.name === fileInfo.fieldName && (f.blockIndex ?? 1) === fileInfo.blockIndex
            )
            if (field) {
              // nahradit objekt file adresou url ze serveru
              field.value = result.fileUrl
            }
          }
        } else {
          console.error(`Failed to upload file ${fileInfo.file.name}:`, result.error)
          // pokud nahrávání selže, ponechat název souboru jako fallback
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
    // data sérií mohou mít dynamické názvy sloupců ze šablony (např. xahojky, ybhjojky)
    // potřebujeme extrahovat hodnoty z prvních dvou sloupců (nebo x/y, pokud jsou přítomny)
    const seriesPayload: MeasurementSeriesRequest[] = seriesData.value.map(s => {
      // získat názvy sloupců - první dva sloupce se stanou x a y
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
        seriesScope: s.seriesScope ?? 'record',  // výchozí hodnota 'record', pokud není specifikováno
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
    // extrakce časového razítka měření z prvního pole typu datum (např. "datum a čas měření")
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

        <!-- minimální krokovník (stepper) -->
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
            <!-- krok 1: nastavení -->            <div class="pa-1">
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

          <!-- krok 2: data -->
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

              <!-- odstraněno: tlačítko "mapovat data ručně" (požadavek uživatele) -->
              <v-divider v-if="selectedTemplateId" class="my-4" />

              <BlocksNavigation
                :template-blocks="templateBlocks"
                :current-block-index="currentBlockIndex"
                :current-block-title="currentBlock?.title || ''"
                @prev="prevBlock"
                @next="nextBlock"
                @set-index="i => currentBlockIndex = i"
              />

              <!-- kontejner dat záznamu - seskupuje lištu, hodnoty a série pro aktuální záznam -->
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
                  @paste-current="onPasteCurrent"
                  @paste-multiple="onPasteMultiple"
                  @open-grid-picker="openDataMappingGrid"
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
                  @update-type="onFieldTypeUpdate"
                  @update-required="onFieldRequiredUpdate"
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

              <!-- sekce poznámek -->
              <div class="notes-section-wrapper">
                <!-- Header -->
                <div class="notes-header">
                  <div class="notes-title">
                    <div class="notes-icon">
                      <v-icon size="15" color="white">mdi-notebook-outline</v-icon>
                    </div>
                    <span>Poznámky</span>
                  </div>
                  <!-- čip: indikátor markdownu -->
                  <span class="markdown-chip">
                    <v-icon size="12">mdi-language-markdown</v-icon>
                    Markdown
                  </span>
                </div>

                <!-- obal markdown editoru -->
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

              <!-- Type Change Confirmation Dialog -->
              <!-- Template Change Confirmation Dialog -->
               <!--
              <v-dialog v-model="showTemplateUpdateDialog" max-width="500">
                <v-card>
                  <v-card-title class="d-flex align-center">
                    <v-icon color="primary" class="mr-2">mdi-alert-circle-outline</v-icon>
                    Úprava šablony
                  </v-card-title>
                  <v-card-text>
                    <template v-if="pendingTemplateUpdate?.changeType === 'type'">
                      Změnili jste datový typ pole <strong>{{ pendingTemplateUpdate?.fieldName }}</strong>
                      z <code>{{ pendingTemplateUpdate?.oldValue }}</code> na <code>{{ pendingTemplateUpdate?.newValue }}</code>.
                    </template>
                    <template v-else-if="pendingTemplateUpdate?.changeType === 'required'">
                      Změnili jste povinnost pole <strong>{{ pendingTemplateUpdate?.fieldName }}</strong>
                      na <strong>{{ pendingTemplateUpdate?.newValue ? 'Povinné' : 'Nepovinné' }}</strong>.
                    </template>
                    <br><br>
                    Chcete tuto změnu aplikovat jako novou verzi šablony a nastavit ji jako aktivní?
                  </v-card-text>
                  <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="applyTemplateUpdate(false)">Jen pro toto měření</v-btn>
                    <v-btn color="primary" variant="flat" @click="applyTemplateUpdate(true)">Vytvořit novou verzi</v-btn>
                  </v-card-actions>
                </v-card>
              </v-dialog>
              -->
            </div>
          </v-window-item>

          <!-- krok 3: revize / dokončení -->
          <v-window-item :value="3">
            <div class="review-step">
              <!-- varovná hlavička -->
              <div class="review-alert">
                <v-icon size="24" color="warning">mdi-alert-circle-outline</v-icon>
                <div>
                  <strong>Zkontrolujte údaje před uložením</strong>
                  <p class="text-caption text-medium-emphasis mb-0">Ujistěte se, že jsou všechny hodnoty správně.</p>
                </div>
              </div>

              <!-- souhrn metadat -->
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

              <!-- tabulka s náhledem dat -->
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

                <!-- souhrn sérií, pokud existují -->
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

              <!-- náhled poznámky -->
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

    <!-- oznámení o úspěchu -->
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

    <!-- oznámení o chybě validace -->
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



    <!-- dialog pro varování před vyčištěním všeho -->
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

    <!-- dialog pro varování před přepsáním dat -->
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

    <!-- dialog pro varování před prázdnými sériemi -->
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

    <!-- dialog pro načtení konceptu -->
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

  <!-- dialog pro varování při návratu zpět - mimo komponentu dialog -->
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

/* hlavička */
.wizard-header {
  padding: 20px 24px 16px;
}

.wizard-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 20px 0;
  letter-spacing: -0.01em;
}

/* navigace kroků */
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

/* patička */
.wizard-footer {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
}

/* revizní krok */
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

/* animace zvýraznění pole */
@keyframes fieldHighlightFlash {
  0% { background-color: rgba(24, 103, 192, 0.1); }
  50% { background-color: rgba(24, 103, 192, 0.2); }
  100% { background-color: transparent; }
}

:deep(.field-highlight-error) {
  animation: fieldHighlightFlash 1.5s ease-out forwards;
  border-radius: 8px;
}

/* pomocné třídy (utility) */
.text-medium-emphasis {
  opacity: 0.7;
}
/* sekce dat záznamu - vizuálně seskupuje hodnoty a série */
.record-data-section {
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 12px;
  padding: 16px;
  background: rgba(var(--v-theme-primary), 0.02);
  margin-top: 12px;
}

/* sekce poznámek - vizuálně odlišná */
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

/* sjednocený styl nadpisů sekcí */
.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

</style>
