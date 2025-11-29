<template>
  <Dialog
    v-model:is-open="open"
    width="1000px"
    :hide-footer="true"
    class="template-wizard"
  >
    <template #content>
      <div class="pa-4">
        <!-- Header -->
        <div class="d-flex align-center justify-space-between mb-3">
          <div class="text-h6">
            {{ props.operation === 'edit' ? 'Úprava šablony' : 'Vytvoření šablony' }}
          </div>
        </div>

        <!-- Název + Přístroj -->
        <div class="d-flex align-center ga-3 mb-4">
          <v-text-field
            v-model="templateName"
            label="Název šablony"
            density="comfortable"
            variant="outlined"
            hide-details
            class="flex-grow-1"
          />
          <v-select
            v-model="deviceCode"
            :items="devices"
            item-title="name"
            item-value="id"
            label="Přístroj"
            density="comfortable"
            variant="outlined"
            hide-details
            style="max-width: 220px"
          >
            <template #selection="{ item }">
              <v-chip
                size="small"
                :color="item.raw?. color"
                text-color="white"
              >
                {{ item.raw?. name ?? item.raw?.id }}
              </v-chip>
            </template>
          </v-select>
        </div>

        <!-- Mode toggle -->
        <v-btn-toggle
          v-model="mode"
          mandatory
          class="mb-4"
        >
          <v-btn value="empty">
            Prázdná šablona
          </v-btn>
          <v-btn value="import">
            Import ze souboru / schránky
          </v-btn>
        </v-btn-toggle>

        <!-- EMPTY MODE -->
        <div v-if="mode === 'empty'">
          <div
            class="d-flex align-center mb-2"
            style="gap:12px; flex-wrap:wrap;"
          >
            <div class="preview-header">
              Struktura šablony
            </div>
            <v-spacer />
            <div
              v-if="pickedBlocks.length"
              class="d-flex align-center"
              style="gap:6px;"
            >
              <v-btn
                size="x-small"
                variant="text"
                :disabled="currentBlockIndex === 0"
                @click="prevBlock"
              >
                ◀
              </v-btn>
              <div class="text-caption">
                Blok {{ currentBlockIndex + 1 }} / {{ pickedBlocks.length }}
              </div>
              <v-btn
                size="x-small"
                variant="text"
                :disabled="currentBlockIndex === pickedBlocks.length - 1"
                @click="nextBlock"
              >
                ▶
              </v-btn>
            </div>
            <v-btn
              color="primary"
              variant="tonal"
              @click="addEmptyBlockAndGo"
            >
              NOVÝ BLOK
            </v-btn>
          </div>

          <div
            v-if="pickedBlocks.length === 0"
            class="text-medium-emphasis mb-3"
          >
            Zatím žádné bloky.  Přidej první blok tlačítkem „NOVÝ BLOK".
          </div>

          <!-- Block editor -->
          <div
            v-for="(pb, pbi) in pickedBlocks"
            v-show="pbi === currentBlockIndex"
            :key="pb. id"
            class="picked-block"
          >
            <div class="d-flex align-center ga-2 mb-2">
              <v-text-field
                v-model="pb.title"
                label="Název sady hodnot"
                density="comfortable"
                hide-details
                variant="outlined"
                class="flex-grow-1"
              />
              <v-spacer />
              <v-btn
                icon="mdi-chevron-up"
                variant="text"
                :disabled="pbi === 0"
                @click="movePickedBlock(pb.id, -1)"
              />
              <v-btn
                icon="mdi-chevron-down"
                variant="text"
                :disabled="pbi === pickedBlocks. length - 1"
                @click="movePickedBlock(pb.id, 1)"
              />
              <v-btn
                icon="mdi-delete-outline"
                variant="text"
                color="error"
                @click="removePickedBlock(pb. id)"
              />
            </div>

            <v-data-table
              :items="pb.fieldRows"
              :headers="tableHeaders"
              class="elevation-1"
              density="comfortable"
              hide-default-footer
              item-key="orderIndex"
            >
              <template #[`item.orderIndex`]="{ item }">
                <span class="text-body-2">{{ item.orderIndex }}</span>
              </template>

              <template #[`item.type`]="{ item }">
                <v-select
                  v-model="item.type"
                  :items="typeOptions"
                  item-title="label"
                  item-value="value"
                  density="compact"
                  hide-details
                  variant="plain"
                />
              </template>

              <template #[`item.required`]="{ item }">
                <v-checkbox
                  v-model="item.required"
                  density="compact"
                  hide-details
                />
              </template>

              <template #[`item.name`]="{ item, index }">
                <v-text-field
                  v-model="item.name"
                  density="compact"
                  hide-details
                  variant="plain"
                  :placeholder="`Pole ${item.orderIndex}`"
                  @keydown.enter.prevent="addFieldTo(pb.id, index + 1)"
                />
              </template>

              <template #[`item.actions`]="{ index }">
                <div class="d-flex ga-1">
                  <v-btn
                    icon="mdi-chevron-up"
                    size="x-small"
                    variant="text"
                    @click="moveFieldIn(pb.id, index, -1)"
                  />
                  <v-btn
                    icon="mdi-chevron-down"
                    size="x-small"
                    variant="text"
                    @click="moveFieldIn(pb. id, index, 1)"
                  />
                  <v-btn
                    icon="mdi-delete-outline"
                    size="x-small"
                    variant="text"
                    color="error"
                    @click="removeFieldIn(pb.id, index)"
                  />
                </div>
              </template>
            </v-data-table>

            <div class="d-flex align-center ga-2 mt-2">
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                @click="addFieldTo(pb.id)"
              >
                PŘIDAT POLE (Enter)
              </v-btn>
            </div>
          </div>
        </div>

        <!-- IMPORT MODE -->
        <div v-else>
          <div class="d-flex align-center ga-3 mb-3">
            <input
              ref="fileInput"
              type="file"
              accept=".csv,. tsv,.txt"
              style="display:none"
              @change="onFilePicked"
            >
            <v-select
              v-model="delimiter"
              :items="delimiterOptions"
              item-title="label"
              item-value="value"
              label="Oddělovač"
              density="comfortable"
              variant="outlined"
              hide-details
              style="max-width: 220px"
            />
            <v-btn
              variant="tonal"
              color="primary"
              @click="triggerFilePick"
            >
              VYBRAT SOUBOR
            </v-btn>
            <v-btn
              variant="text"
              @click="runAnalysis"
            >
              ANALYZOVAT
            </v-btn>
          </div>

          <v-textarea
            v-model="rawText"
            label="Schránka (tab/CSV; první řádek hlavička)"
            :rows="6"
            variant="outlined"
            density="comfortable"
            hide-details
            class="mb-3"
          />

          <v-alert
            v-if="! parsedHeaders. length"
            type="info"
            density="comfortable"
            variant="tonal"
            class="mb-3"
          >
            Vlož hlavičky a klikni "ANALYZOVAT".
          </v-alert>

          <div
            v-else
            class="mb-3"
          >
            <div class="preview-header mb-2">
              Nalezené sloupce
            </div>
            <div class="d-flex flex-wrap ga-2 mb-3">
              <v-chip
                v-for="(h, i) in parsedHeaders"
                :key="i"
                size="small"
              >
                {{ h }}
              </v-chip>
            </div>
            <v-btn
              color="primary"
              variant="tonal"
              @click="createBlockFromParsed"
            >
              VYTVOŘIT BLOK Z HLAVIČEK
            </v-btn>
          </div>

          <!-- Picked blocks in import mode -->
          <div
            v-if="pickedBlocks.length"
            class="mb-3"
          >
            <div class="preview-header mb-2">
              Bloky šablony
            </div>
            <div
              class="d-flex align-center mb-2"
              style="gap:6px;"
            >
              <v-btn
                size="x-small"
                variant="text"
                :disabled="currentBlockIndex === 0"
                @click="prevBlock"
              >
                ◀
              </v-btn>
              <div class="text-caption">
                Blok {{ currentBlockIndex + 1 }} / {{ pickedBlocks.length }}
              </div>
              <v-btn
                size="x-small"
                variant="text"
                :disabled="currentBlockIndex === pickedBlocks.length - 1"
                @click="nextBlock"
              >
                ▶
              </v-btn>
              <v-spacer />
              <v-btn
                color="primary"
                variant="tonal"
                @click="addEmptyBlockAndGo"
              >
                NOVÝ BLOK
              </v-btn>
            </div>

            <div
              v-for="(pb, pbi) in pickedBlocks"
              v-show="pbi === currentBlockIndex"
              :key="pb.id"
              class="picked-block"
            >
              <div class="d-flex align-center ga-2 mb-2">
                <v-text-field
                  v-model="pb.title"
                  density="comfortable"
                  hide-details
                  variant="outlined"
                  class="flex-grow-1"
                />
                <v-btn
                  icon="mdi-delete-outline"
                  size="small"
                  color="error"
                  variant="text"
                  @click="removePickedBlock(pb.id)"
                />
              </div>

              <v-data-table
                :items="pb.fieldRows"
                :headers="tableHeaders"
                class="elevation-1 mb-2"
                density="comfortable"
                hide-default-footer
                item-key="orderIndex"
              >
                <template #[`item.orderIndex`]="{ item }">
                  {{ item.orderIndex }}
                </template>
                <template #[`item.type`]="{ item }">
                  <v-select
                    v-model="item.type"
                    :items="typeOptions"
                    item-title="label"
                    item-value="value"
                    density="compact"
                    hide-details
                    variant="plain"
                  />
                </template>
                <template #[`item.required`]="{ item }">
                  <v-checkbox
                    v-model="item.required"
                    density="compact"
                    hide-details
                  />
                </template>
                <template #[`item.name`]="{ item, index }">
                  <v-text-field
                    v-model="item.name"
                    density="compact"
                    hide-details
                    variant="plain"
                    :placeholder="`Pole ${item.orderIndex}`"
                    @keydown.enter.prevent="addFieldTo(pb.id, index + 1)"
                  />
                </template>
                <template #[`item.actions`]="{ index }">
                  <v-btn
                    icon="mdi-delete-outline"
                    size="x-small"
                    variant="text"
                    color="error"
                    @click="removeFieldIn(pb. id, index)"
                  />
                </template>
              </v-data-table>

              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                @click="addFieldTo(pb.id)"
              >
                PŘIDAT POLE
              </v-btn>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn
            v-if="canDelete"
            color="error"
            variant="flat"
            :loading="deleteLoading"
            @click="askDelete"
          >
            Smazat šablonu
          </v-btn>
          <v-spacer />
          <v-btn
            variant="text"
            @click="cancel"
          >
            Zrušit (Esc)
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!deviceCode || !pickedBlocks.length || ! hasAnyFields"
            :loading="loading"
            @click="confirmSave"
          >
            {{ confirmLabel }}
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Dialog from '@/components/Dialog.vue'
import type { WizardTemplatePayload } from '@/stores/measurement-templates'

/* ===== Types ===== */
type DeviceItem = { id: string; name: string; color?: string }
type FieldType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
type FieldRow = { orderIndex: number; type: FieldType; required: boolean; name: string }

interface PickedBlock {
  id: string
  title: string
  fieldRows: FieldRow[]
}

interface InitialTemplate {
  templateId: string
  name: string
  deviceCode: string
  fields: Array<{ orderIndex: number; type: FieldType; required: boolean; name: string }>
  blocks?: Array<{
    blockIndex: number
    title: string
    fields: Array<{ orderIndex: number; type: FieldType; required: boolean; name: string }>
  }>
}

/* ===== Props & Emits ===== */
const props = defineProps<{
  modelValue: boolean
  devices: DeviceItem[]
  onConfirm?: (payload: WizardTemplatePayload) => Promise<void> | void
  deleteLoading?: boolean
  operation?: 'create' | 'edit'
  initialTemplate?: InitialTemplate | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', p: WizardTemplatePayload): void
  (e: 'delete'): void
}>()

/* ===== Computed v-model ===== */
const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/* ===== State ===== */
const deviceCode = ref<string>('')
const templateName = ref<string>('Nová šablona')
const loading = ref(false)
const mode = ref<'empty' | 'import'>('empty')

const pickedBlocks = ref<PickedBlock[]>([])
const currentBlockIndex = ref(0)

// Import mode
const rawText = ref('')
const delimiter = ref<string>('auto')
const parsedHeaders = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

/* ===== Computed ===== */
const confirmLabel = computed(() => props.operation === 'edit' ? 'Upravit šablonu' : 'Vytvořit šablonu')
const canDelete = computed(() => props.operation === 'edit' && !!props.initialTemplate)
const hasAnyFields = computed(() => pickedBlocks.value.some(pb => pb.fieldRows.length > 0))
const deleteLoading = computed(() => props.deleteLoading ??  false)

/* ===== Options ===== */
const typeOptions: Array<{ label: string; value: FieldType }> = [
  { label: 'Float', value: 'float' },
  { label: 'Integer', value: 'int' },
  { label: 'Text', value: 'text' },
  { label: 'Soubor', value: 'file' },
  { label: 'Bool', value: 'bool' },
  { label: 'Datum', value: 'date' },
]

const delimiterOptions = [
  { label: 'Auto', value: 'auto' },
  { label: 'Tab', value: 'tab' },
  { label: 'Středník', value: 'semicolon' },
  { label: 'Čárka', value: 'comma' },
]

const tableHeaders = [
  { title: 'Poř. ', key: 'orderIndex', sortable: false, width: 70 },
  { title: 'Typ', key: 'type', sortable: false, width: 160 },
  { title: 'Povinné', key: 'required', sortable: false, width: 120 },
  { title: 'Název pole', key: 'name', sortable: false },
  { title: '', key: 'actions', sortable: false, width: 112 },
]

/* ===== Block management ===== */
function generateId(): string {
  return `blk-${Date. now()}-${Math.floor(Math.random() * 10000)}`
}

function addEmptyBlock(): void {
  pickedBlocks.value.push({
    id: generateId(),
    title: `Blok ${pickedBlocks.value.length + 1}`,
    fieldRows: [
      { orderIndex: 1, name: '', required: true, type: 'float' },
      { orderIndex: 2, name: '', required: true, type: 'float' },
      { orderIndex: 3, name: '', required: true, type: 'float' },
    ],
  })
}

function addEmptyBlockAndGo(): void {
  addEmptyBlock()
  currentBlockIndex.value = pickedBlocks. value.length - 1
}

function removePickedBlock(id: string): void {
  pickedBlocks.value = pickedBlocks.value.filter(b => b.id !== id)
  if (currentBlockIndex.value >= pickedBlocks.value.length) {
    currentBlockIndex. value = Math.max(0, pickedBlocks.value.length - 1)
  }
}

function movePickedBlock(id: string, delta: number): void {
  const idx = pickedBlocks.value.findIndex(b => b. id === id)
  const target = idx + delta
  if (idx < 0 || target < 0 || target >= pickedBlocks.value.length) return
  const arr = [...pickedBlocks.value]
  const [item] = arr. splice(idx, 1)
  arr.splice(target, 0, item)
  pickedBlocks.value = arr
  currentBlockIndex.value = target
}

function prevBlock(): void {
  currentBlockIndex.value = Math.max(0, currentBlockIndex. value - 1)
}

function nextBlock(): void {
  currentBlockIndex. value = Math.min(pickedBlocks.value.length - 1, currentBlockIndex.value + 1)
}

/* ===== Field management ===== */
function addFieldTo(blockId: string, atIndex?: number): void {
  const block = pickedBlocks.value.find(b => b.id === blockId)
  if (!block) return
  const idx = typeof atIndex === 'number' ? atIndex : block.fieldRows.length
  const newField: FieldRow = { orderIndex: 0, name: '', required: false, type: 'text' }
  block.fieldRows.splice(idx, 0, newField)
  reindexFields(block)
}

function removeFieldIn(blockId: string, index: number): void {
  const block = pickedBlocks. value.find(b => b.id === blockId)
  if (!block) return
  block.fieldRows.splice(index, 1)
  reindexFields(block)
}

function moveFieldIn(blockId: string, index: number, delta: number): void {
  const block = pickedBlocks.value. find(b => b.id === blockId)
  if (! block) return
  const target = index + delta
  if (target < 0 || target >= block.fieldRows.length) return
  const [item] = block. fieldRows.splice(index, 1)
  block.fieldRows.splice(target, 0, item)
  reindexFields(block)
}

function reindexFields(block: PickedBlock): void {
  block.fieldRows.forEach((f, i) => { f.orderIndex = i + 1 })
}

/* ===== Import mode ===== */
function triggerFilePick(): void {
  fileInput. value?.click()
}

async function onFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (! file) return
  rawText.value = await file.text()
  runAnalysis()
  input.value = ''
}

function runAnalysis(): void {
  const text = rawText.value. trim()
  if (!text) {
    parsedHeaders.value = []
    return
  }
  const lines = text.split(/\r?\n/)
  const firstLine = lines[0] || ''

  let sep = '\t'
  if (delimiter.value === 'comma') sep = ','
  else if (delimiter.value === 'semicolon') sep = ';'
  else if (delimiter.value === 'auto') {
    if (firstLine.includes('\t')) sep = '\t'
    else if (firstLine. includes(';')) sep = ';'
    else if (firstLine.includes(',')) sep = ','
  }

  parsedHeaders.value = firstLine.split(sep).map(h => h.trim()). filter(Boolean)
}

function inferFieldType(header: string): FieldType {
  const h = header.toLowerCase()
  if (/datum|date|time|čas/.test(h)) return 'date'
  if (/bool|ano|ne|yes|no/.test(h)) return 'bool'
  if (/soubor|file|image|foto/.test(h)) return 'file'
  if (/počet|count|int|id/.test(h)) return 'int'
  if (/hodnota|value|měření|num|float|%|°/. test(h)) return 'float'
  return 'text'
}

function createBlockFromParsed(): void {
  if (! parsedHeaders.value.length) return
  const block: PickedBlock = {
    id: generateId(),
    title: `Blok ${pickedBlocks.value.length + 1}`,
    fieldRows: parsedHeaders.value. map((h, i) => ({
      orderIndex: i + 1,
      name: h,
      required: true,
      type: inferFieldType(h),
    })),
  }
  pickedBlocks. value.push(block)
  currentBlockIndex.value = pickedBlocks.value.length - 1
  parsedHeaders.value = []
}

/* ===== Confirm / Cancel / Delete ===== */
function normalizeDeviceCode(code: string): string {
  return code. trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'). replace(/_+/g, '_')
}

async function confirmSave(): Promise<void> {
  if (!deviceCode.value || ! pickedBlocks. value.length) return

  const blocks = pickedBlocks.value. map((pb, bi) => {
    const seen = new Set<string>()
    const fields: FieldRow[] = []
    let ord = 1
    for (const f of pb.fieldRows) {
      const name = (f.name ??  '').trim()
      if (! name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      fields.push({ orderIndex: ord++, type: f.type, required: !!f.required, name })
    }
    if (! fields.length) {
      fields.push({ orderIndex: 1, type: 'text', required: false, name: 'Pole 1' })
    }
    return {
      blockIndex: bi + 1,
      title: pb.title. trim() || `Blok ${bi + 1}`,
      fields,
    }
  })

  const payload: WizardTemplatePayload = {
    deviceCode: normalizeDeviceCode(deviceCode.value),
    templateName: (templateName.value || '').trim() || 'Šablona',
    blocks,
    templateId: props.operation === 'edit' && props.initialTemplate
      ? props.initialTemplate.templateId
      : undefined,
  }

  loading.value = true
  try {
    if (typeof props.onConfirm === 'function') {
      await props.onConfirm(payload)
    } else {
      emit('confirm', payload)
    }
    open.value = false
  } finally {
    loading. value = false
  }
}

function cancel(): void {
  open.value = false
}

function askDelete(): void {
  emit('delete')
}

/* ===== Watch open for initialization ===== */
watch(open, async (isOpen) => {
  if (!isOpen) return

  loading.value = false
  pickedBlocks.value = []
  rawText.value = ''
  parsedHeaders.value = []
  currentBlockIndex. value = 0
  mode.value = 'empty'

  if (props.operation === 'edit' && props.initialTemplate) {
    templateName.value = props.initialTemplate.name
    deviceCode. value = props.initialTemplate.deviceCode

    const incomingBlocks = props.initialTemplate.blocks ??  []

    if (incomingBlocks.length > 0) {
      pickedBlocks.value = incomingBlocks.map((b) => ({
        id: generateId(),
        title: b.title ??  `Blok ${b.blockIndex}`,
        fieldRows: (b.fields ?? []).map((f, fi) => ({
          orderIndex: fi + 1,
          name: f.name,
          required: !!f.required,
          type: f.type as FieldType,
        })),
      }))
    } else if (props.initialTemplate.fields?. length) {
      // Fallback: flat fields → jeden blok
      pickedBlocks.value = [{
        id: generateId(),
        title: 'Blok 1',
        fieldRows: props.initialTemplate.fields.map((f, i) => ({
          orderIndex: i + 1,
          name: f.name,
          required: f.required,
          type: f.type,
        })),
      }]
    }
  } else {
    templateName.value = 'Nová šablona'
    deviceCode. value = props.devices[0]?.id ??  ''
  }

  await nextTick()
})

/* ===== Keyboard shortcuts ===== */
function onKeydown(e: KeyboardEvent): void {
  if (! open.value) return

  if (e. key === 'Escape') {
    e.preventDefault()
    cancel()
    return
  }

  if ((e.ctrlKey || e. metaKey) && e.key. toLowerCase() === 's') {
    e.preventDefault()
    void confirmSave()
    return
  }

  if (e.altKey && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    addEmptyBlockAndGo()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.preview-header {
  font-weight: 600;
}
.picked-block {
  border: 1px solid #ececec;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
  margin-bottom: 12px;
}
</style>
