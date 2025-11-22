<template>
  <Dialog
    v-model:is-open="open"
    width="1000px"
    :hide-footer="true"
    class="template-wizard"
  >
    <template #content>
      <div
        class="pa-4"
        @keydown="onGlobalKeydown"
      >
        <div class="d-flex align-center justify-space-between mb-3">
          <div class="text-h6">
            Vytvoření šablony
          </div>
          <v-btn
            variant="text"
            color="primary"
            @click="toggleMode"
          >
            {{ mode === 'empty' ? 'Import šablony ze souboru' : 'Prázdná šablona' }}
          </v-btn>
        </div>

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
                :color="item.raw?.color"
                text-color="white"
              >
                {{ item.raw?.name ?? item.raw?.id }}
              </v-chip>
            </template>
          </v-select>
        </div>

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

        <div v-if="mode === 'empty'">
          <div class="d-flex align-center mb-2" style="gap:12px; flex-wrap:wrap;">
            <div class="preview-header">Struktura šablony</div>
            <v-spacer />
            <div v-if="pickedBlocks.length" class="d-flex align-center" style="gap:6px;">
              <v-btn size="x-small" variant="text" :disabled="currentBlockIndex===0" @click="prevBlock" title="Předchozí blok">◀</v-btn>
              <div class="text-caption">Blok {{ currentBlockIndex + 1 }} / {{ pickedBlocks.length }}</div>
              <v-btn size="x-small" variant="text" :disabled="currentBlockIndex===pickedBlocks.length-1" @click="nextBlock" title="Další blok">▶</v-btn>
            </div>
            <v-btn
              color="primary"
              variant="tonal"
              @click="addEmptyBlockAndGo"
              title="Přidat nový blok (Nová sada)"
            >
              NOVÝ BLOK
            </v-btn>
          </div>

          <div
            v-if="pickedBlocks.length === 0"
            class="text-medium-emphasis mb-3"
          >
            Zatím žádné bloky. Přidej první blok tlačítkem „PŘIDAT BLOK“.
          </div>

          <div
            v-for="(pb, pbi) in pickedBlocks"
            :key="pb.id"
            v-show="pbi === currentBlockIndex"
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
                :disabled="pbi===0"
                @click="movePickedBlock(pb.id,-1)"
              />
              <v-btn
                icon="mdi-chevron-down"
                variant="text"
                :disabled="pbi===pickedBlocks.length-1"
                @click="movePickedBlock(pb.id,1)"
              />
              <v-btn
                icon="mdi-delete-outline"
                variant="text"
                color="error"
                @click="removePickedBlock(pb.id)"
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
                  @keydown.enter.prevent="addFieldTo(pb.id, index + 1, true)"
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
                    @click="moveFieldIn(pb.id, index, 1)"
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
              <v-spacer />
            </div>
          </div>
        </div>

        <div v-else>
          <div class="d-flex align-center ga-3 mb-3">
            <input
              ref="fileInput"
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              style="display:none"
              @change="onFilePicked"
            >
            <v-select
              v-model="delimiterOverrideModel"
              :items="delimiterSelectItems"
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
              title="Vybrat soubor (Ctrl+O)"
              @click="triggerFilePick"
            >
              VYBRAT SOUBOR
            </v-btn>
            <v-btn
              variant="text"
              class="ml-2"
              title="Analyzovat (Ctrl+Enter)"
              @click="runAnalysis"
            >
              ANALYZOVAT
            </v-btn>
          </div>

          <v-textarea
            v-model="rawText"
            data-clipboard-input
            label="Schránka (tab/CSV; první řádek hlavička)"
            :rows="6"
            :auto-grow="false"
            variant="outlined"
            density="comfortable"
            hide-details
            class="mb-3 clipboard-textarea"
          />

          <v-alert
            v-if="!blocks.length"
            type="info"
            density="comfortable"
            variant="tonal"
            class="mb-3"
          >
            Vlož hlavičky (případně i s daty) a klikni “ANALYZOVAT” nebo stiskni Ctrl+Enter.
          </v-alert>

          <div
            v-else
            class="mb-3"
          >
            <div class="d-flex align-center ga-3 mb-2">
              <div class="preview-header">
                Nalezené bloky vstupu
              </div>
              <v-spacer />
              <v-btn
                variant="text"
                title="Znovu analyzovat (Ctrl+Enter)"
                @click="runAnalysis"
              >
                ANALYZOVAT
              </v-btn>
            </div>

            <v-table
              density="compact"
              class="mb-3"
            >
              <thead>
              <tr>
                <th style="width:60px">
                  #
                </th>
                <th>Typ</th>
                <th>Náhled</th>
                <th style="width:160px" />
              </tr>
              </thead>
              <tbody>
              <tr
                v-for="(b,i) in blocks"
                :key="`src-${i}`"
              >
                <td>{{ i + 1 }}</td>
                <td>{{ kindLabel(b.kind) }}</td>
                <td>
                  <div v-if="b.kind==='table'">
                    <strong>Hlavičky:</strong>
                    <span
                      v-for="(h,hi) in (b.headersRaw.slice(0,6))"
                      :key="`h-${hi}`"
                      class="chip"
                    >{{ h }}</span>
                  </div>
                  <div v-else-if="b.kind==='kv'">
                    <strong>Metadata:</strong>
                    <span
                      v-for="(p,ki) in (b.pairs.slice(0,4))"
                      :key="`kv-${ki}`"
                      class="chip"
                    >{{ p.key }}</span>
                  </div>
                  <div v-else-if="b.kind==='stats'">
                    <strong>Statistika:</strong> {{ b.lines[0] }}
                  </div>
                  <div v-else-if="b.kind==='series'">
                    <strong>Řada:</strong> {{ b.header || 'Value' }} ({{ b.values.length }} položek)
                  </div>
                </td>
                <td class="text-right">
                  <v-btn
                    size="small"
                    color="primary"
                    variant="tonal"
                    :disabled="pickedBlocks.some(pb => pb.sourceIndex === i)"
                    @click="addBlockFromSource(i)"
                  >
                    PŘIDAT DO ŠABLONY
                  </v-btn>
                </td>
              </tr>
              </tbody>
            </v-table>
          </div>

          <div
            v-if="pickedBlocks.length"
            class="mb-3"
          >
            <div class="preview-header mb-2">
              Šablona se skládá z bloků
            </div>

            <div class="d-flex align-center mb-2" style="gap:12px; flex-wrap:wrap;">
              <div class="preview-header">Bloky šablony</div>
              <v-spacer />
              <div v-if="pickedBlocks.length" class="d-flex align-center" style="gap:6px;">
                <v-btn size="x-small" variant="text" :disabled="currentBlockIndex===0" @click="prevBlock" title="Předchozí blok">◀</v-btn>
                <div class="text-caption">Blok {{ currentBlockIndex + 1 }} / {{ pickedBlocks.length }}</div>
                <v-btn size="x-small" variant="text" :disabled="currentBlockIndex===pickedBlocks.length-1" @click="nextBlock" title="Další blok">▶</v-btn>
              </div>
              <v-btn
                color="primary"
                variant="tonal"
                @click="addEmptyBlockAndGo"
                title="Nový blok (Nová sada)"
              >
                NOVÝ BLOK
              </v-btn>
            </div>
            <div
              v-for="(pb,pbi) in pickedBlocks"
              :key="pb.id"
              v-show="pbi === currentBlockIndex"
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
                <v-chip
                  size="x-small"
                  class="ml-1"
                  color="grey"
                  variant="tonal"
                >
                  zdroj #{{ (pb.sourceIndex ?? pbi) + 1 }}
                </v-chip>
                <v-spacer />
                <v-btn
                  icon="mdi-chevron-up"
                  size="small"
                  variant="text"
                  :disabled="pbi===0"
                  @click="movePickedBlock(pb.id,-1)"
                />
                <v-btn
                  icon="mdi-chevron-down"
                  size="small"
                  variant="text"
                  :disabled="pbi===pickedBlocks.length-1"
                  @click="movePickedBlock(pb.id,1)"
                />
                <v-btn
                  icon="mdi-delete-outline"
                  size="small"
                  color="error"
                  variant="text"
                  @click="removePickedBlock(pb.id)"
                />
              </div>

              <div
                v-if="pb.sourceIndex !== null && blocks[pb.sourceIndex]?.kind === 'table'"
                class="mb-2"
              >
                <div class="d-flex align-center ga-3 mb-2">
                  <v-switch
                    v-model="pb.headerOverrideEnabled"
                    label="Vybrat jinou hlavičku"
                    density="comfortable"
                    @update:model-value="() => updatePickedBlockFields(pb.id)"
                  />
                  <v-select
                    v-if="pb.headerOverrideEnabled"
                    v-model="pb.headerOverrideIndex"
                    :items="headerOverrideOptionsFor(pb)"
                    item-title="label"
                    item-value="value"
                    label="Řádek pro hlavičku"
                    density="comfortable"
                    variant="outlined"
                    hide-details
                    style="min-width:260px"
                    @update:model-value="() => updatePickedBlockFields(pb.id)"
                  />
                  <v-switch
                    v-model="pb.includeRepeatSets"
                    label="Rozbalit opakované sady"
                    density="comfortable"
                    @update:model-value="() => updatePickedBlockFields(pb.id)"
                  />
                </div>

                <div class="preview-sample">
                  <div style="font-weight:700; margin-bottom:6px;">
                    Hlavičky
                  </div>
                  <div style="display:flex; gap:8px; flex-wrap:wrap">
                    <span
                      v-for="(h,idx) in effectiveHeadersFor(pb)"
                      :key="`eh-${pb.id}-${idx}`"
                      class="chip"
                    >{{ h }}</span>
                  </div>
                  <div style="margin-top:8px;">
                    <div
                      v-for="(r,ri) in ((blocks[pb.sourceIndex!] as TableBlock).rows.slice(0,6))"
                      :key="`row-${pb.id}-${ri}`"
                      class="mono-line"
                    >
                      {{ r.join(' | ') }}
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else-if="pb.sourceIndex !== null && blocks[pb.sourceIndex]?.kind === 'kv'"
                class="mb-2"
              >
                <div class="preview-header mb-1">
                  Metadata (key:value)
                </div>
                <v-list density="compact">
                  <v-list-item
                    v-for="(p,i) in ((blocks[pb.sourceIndex!] as KvBlock).pairs)"
                    :key="`kv-${pb.id}-${i}`"
                  >
                    <v-list-item-title><strong>{{ p.key }}</strong>: {{ p.value }}</v-list-item-title>
                  </v-list-item>
                </v-list>
                <div class="d-flex ga-2">
                  <v-btn
                    color="primary"
                    variant="tonal"
                    @click="addMetadataAsFieldsTo(pb.id)"
                  >
                    PŘIDAT METADATA JAKO POLE
                  </v-btn>
                </div>
              </div>

              <div
                v-else-if="pb.sourceIndex !== null && blocks[pb.sourceIndex]?.kind === 'stats'"
                class="mb-2"
              >
                <div class="preview-header mb-1">
                  Statistické řádky
                </div>
                <div class="mono-block">
                  <div
                    v-for="(l,i) in (blocks[pb.sourceIndex!] as StatsBlock).lines"
                    :key="`st-${pb.id}-${i}`"
                    class="mono-line"
                  >
                    {{ l }}
                  </div>
                </div>
              </div>

              <div
                v-else-if="pb.sourceIndex !== null && blocks[pb.sourceIndex]?.kind === 'series'"
                class="mb-2"
              >
                <div class="preview-header mb-1">
                  Řada hodnot
                </div>
                <div class="mono-block">
                  <div>{{ (blocks[pb.sourceIndex!] as SeriesBlock).header }}</div>
                  <div class="mono-line">
                    {{ (blocks[pb.sourceIndex!] as SeriesBlock).values.slice(0, 40).join(', ') }}{{ (blocks[pb.sourceIndex!] as SeriesBlock).values.length > 40 ? ' …' : '' }}
                  </div>
                </div>
              </div>

              <div class="d-flex align-center ga-2 mb-2">
                <v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  @click="addFieldTo(pb.id)"
                >
                  PŘIDAT POLE (Enter)
                </v-btn>
                <v-spacer />
              </div>

              <v-data-table
                v-if="pb.fieldRows.length"
                :items="pb.fieldRows"
                :headers="tableHeaders"
                class="elevation-1 mb-4"
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
                    @keydown.enter.prevent="addFieldTo(pb.id, index + 1, true)"
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
                      @click="moveFieldIn(pb.id, index, 1)"
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
            </div>
          </div>
        </div>

        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn
            variant="text"
            @click="cancel"
          >
            Zrušit (Esc)
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!deviceCode || !pickedBlocks.length || !hasAnyFields"
            :loading="loading"
            @click="confirm"
          >
            {{ confirmLabel }}
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>

  <Dialog
    v-model:is-open="showDelimiterModal"
    width="720px"
    :hide-footer="true"
  >
    <template #content>
      <div class="pa-4">
        <div class="text-h6 mb-3">
          CSV: vyber oddělovač
        </div>
        <div class="d-flex align-center ga-3 mb-3">
          <v-select
            v-model="modalDelimiter"
            :items="delimiterSelectItems"
            item-title="label"
            item-value="value"
            label="Oddělovač"
            density="comfortable"
            variant="outlined"
            hide-details
            style="max-width: 220px"
          />
          <div class="text-body-2">
            Doporučeno: <strong>{{ delimiterSelectItems.find(i => i.value === modalDelimiter)?.label }}</strong>
          </div>
        </div>
        <div class="preview-header mb-2">
          Náhled
        </div>
        <v-table
          density="compact"
          class="mb-4"
        >
          <tbody>
          <tr
            v-for="(r,ri) in previewRows"
            :key="`pv-${ri}`"
          >
            <td
              v-for="(c,ci) in r"
              :key="`pv-${ri}-${ci}`"
              style="white-space:nowrap"
            >
              {{ c }}
            </td>
          </tr>
          </tbody>
        </v-table>
        <div class="d-flex justify-end ga-2">
          <v-btn
            variant="text"
            @click="cancelDelimiterChoice"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="primary"
            @click="confirmDelimiterChoice"
          >
            Pokračovat
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import Dialog from '@/components/Dialog.vue'
import {
  analyzeClipboard,
  type ParserOptions,
  type ColumnType,
  type AnalyzeResult,
  type TableBlock,
  type StatsBlock,
  type SeriesBlock,
  type KvBlock,
  buildRepeatMetaFromHeaders,
  inferFieldType as inferFieldTypeFromParser
} from '@/utils/importParsing'

type DeviceItem = { id: string; name: string; color?: string }
type FieldType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
type FieldRow = { orderIndex: number; type: FieldType; required: boolean; name: string }

/** Blok v šabloně (společný pro oba režimy) */
type PickedBlock = {
  id: string
  sourceIndex: number | null    // null u prázdných bloků
  kind: 'table' | 'stats' | 'series' | 'kv'
  title: string
  includeRepeatSets: boolean
  headerOverrideEnabled: boolean
  headerOverrideIndex: number | null
  fieldRows: FieldRow[]
}

/** Payload ven */
type TemplateBlockPayload = { kind: PickedBlock['kind']; title: string; fields: FieldRow[] }
type TemplatePayload = { deviceCode: string; templateName: string; blocks: TemplateBlockPayload[]; fields: FieldRow[] }

/* --------- props/emits ---------- */
const props = defineProps<{
  modelValue: boolean
  devices: DeviceItem[]
  onConfirm?: (payload: TemplatePayload & { templateId?: string }) => Promise<void> | void
  operation?: 'create' | 'edit'
  initialTemplate?: {
    templateId: string
    name: string
    deviceCode: string
    fields: Array<{ orderIndex: number; type: FieldType; required: boolean; name: string }>
  } | null
}>()
const emit = defineEmits<{ (e:'update:modelValue', v:boolean):void; (e:'confirm', p:TemplatePayload):void }>()

/* --------- dialog state ---------- */
const open = computed({ get: () => props.modelValue, set: (v:boolean) => emit('update:modelValue', v) })
const deviceCode = ref<string>(''); const templateName = ref<string>('Nová šablona')
const loading = ref(false)

/* --------- mode ---------- */
type Mode = 'empty' | 'import'
const mode = ref<Mode>('empty')
const confirmLabel = computed(() => props.operation === 'edit' ? 'Upravit šablonu' : 'Vytvořit šablonu')

function toggleMode() { mode.value = (mode.value === 'empty' ? 'import' : 'empty') }

/* --------- shared types & table headers ---------- */
const typeOptions: Array<{ label: string; value: FieldType }> = [
  { label: 'Float', value: 'float' }, { label: 'Integer', value: 'int' }, { label: 'Text', value: 'text' },
  { label: 'Soubor', value: 'file' }, { label: 'Boolean', value: 'bool' }, { label: 'Date', value: 'date' },
]
const tableHeaders = [
  { title: 'Poř.', key: 'orderIndex', sortable: false, width: 70 },
  { title: 'Typ', key: 'type', sortable: false, width: 160 },
  { title: 'Povinné', key: 'required', sortable: false, width: 120 },
  { title: 'Název pole', key: 'name', sortable: false },
  { title: '', key: 'actions', sortable: false, width: 112 }
]

/* --------- blocks (common) ---------- */
const pickedBlocks = ref<PickedBlock[]>([])
const hasAnyFields = computed(() => pickedBlocks.value.some(pb => pb.fieldRows.length > 0))

// Pagination (jedna sada/blok na stránku)
const currentBlockIndex = ref<number>(0)
function prevBlock() { currentBlockIndex.value = Math.max(0, currentBlockIndex.value - 1) }
function nextBlock() { currentBlockIndex.value = Math.min(pickedBlocks.value.length - 1, currentBlockIndex.value + 1) }
function addEmptyBlockAndGo() { addEmptyBlock(); currentBlockIndex.value = pickedBlocks.value.length - 1 }
watch(pickedBlocks, (arr) => { if (currentBlockIndex.value > arr.length - 1) currentBlockIndex.value = Math.max(0, arr.length - 1) })

function addEmptyBlock() {
  const id = `blk-${Date.now()}-${Math.floor(Math.random()*1000)}`
  pickedBlocks.value.push({
    id,
    sourceIndex: null,
    kind: 'table',
    title: 'Nový prázdný blok',
    includeRepeatSets: false,
    headerOverrideEnabled: false,
    headerOverrideIndex: null,
    fieldRows: [1,2,3,4,5].map((i) => ({
      orderIndex: i, name: '', required: true, type: 'float'
    }))
  })
}
function removePickedBlock(id: string) { pickedBlocks.value = pickedBlocks.value.filter(x => x.id !== id) }
function movePickedBlock(id: string, delta: number) {
  const i = pickedBlocks.value.findIndex(x => x.id === id); const j = i + delta
  if (i < 0 || j < 0 || j >= pickedBlocks.value.length) return
  const arr = pickedBlocks.value.slice(); const [row] = arr.splice(i,1); arr.splice(j,0,row); pickedBlocks.value = arr
}

/* Field ops */
function addFieldTo(id: string, atIndex?: number, focus = false) {
  const pb = pickedBlocks.value.find(x => x.id === id); if (!pb) return
  const idx = (typeof atIndex === 'number' ? atIndex : pb.fieldRows.length)
  const row: FieldRow = { orderIndex: 0, name: '', required: false, type: 'text' }
  const arr = pb.fieldRows.slice(); arr.splice(idx, 0, row)
  pb.fieldRows = arr.map((f, i) => ({ ...f, orderIndex: i + 1 }))
  if (focus) nextTick(() => {
    const el = document.querySelector<HTMLInputElement>(`.template-wizard [data-focus="${pb.id}-${idx}"] input`)
    el?.focus()
  })
}
function removeFieldIn(id: string, index: number) {
  const pb = pickedBlocks.value.find(x => x.id === id); if (!pb) return
  pb.fieldRows.splice(index, 1); pb.fieldRows = pb.fieldRows.map((f,i)=>({ ...f, orderIndex: i+1 }))
}
function moveFieldIn(id: string, index: number, delta: number) {
  const pb = pickedBlocks.value.find(x => x.id === id); if (!pb) return
  const target = index + delta; if (target < 0 || target >= pb.fieldRows.length) return
  const arr = pb.fieldRows.slice(); const [row] = arr.splice(index, 1); arr.splice(target, 0, row)
  pb.fieldRows = arr.map((f,i)=>({ ...f, orderIndex: i+1 }))
}

/* Enter – přidat pole (fallback, když nejsme v inputu) */
function onGlobalKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase()
  const isEditable = (el: EventTarget | null): boolean => {
    if (!el || !(el instanceof Element)) {
      return false
    }
    const tag = el.tagName.toLowerCase()
    const contentEditable = (el as HTMLElement).isContentEditable

    return tag === 'input' || tag === 'textarea' || contentEditable === true
  }
  if (key === 'enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (!isEditable(e.target)) {
      const last = pickedBlocks.value[pickedBlocks.value.length-1]
      if (last) { e.preventDefault(); addFieldTo(last.id) }
    }
  }
}

/* --------- IMPORT MODE state & logic ---------- */
const rawText = ref<string>(''); const blocks = ref<Array<TableBlock | StatsBlock | SeriesBlock | KvBlock>>([])
type DelimiterOverride = 'auto' | 'tab' | 'semicolon' | 'comma' | 'pipe' | 'spaces'
const delimiterOverrideModel = ref<DelimiterOverride>('auto')
const delimiterSelectItems: Array<{ label: string; value: DelimiterOverride }> = [
  { label: 'Auto', value: 'auto' }, { label: 'Tab', value: 'tab' }, { label: 'Středník ;', value: 'semicolon' },
  { label: 'Čárka ,', value: 'comma' }, { label: 'Svislítko |', value: 'pipe' }, { label: 'Více mezer', value: 'spaces' },
]

watch(open, async (v) => {
  if (!v) return
  loading.value = false
  pickedBlocks.value = []
  blocks.value = []
  rawText.value = ''
  delimiterOverrideModel.value = 'auto'
  if (props.operation === 'edit' && props.initialTemplate) {
    // předvyplnit z existující šablony
    templateName.value = props.initialTemplate.name
    deviceCode.value = props.initialTemplate.deviceCode
    // jeden blok pro všechny fields
    const id = `edit-${Date.now()}`
    pickedBlocks.value = [{
      id,
      sourceIndex: null,
      kind: 'table',
      title: 'Upravit pole',
      includeRepeatSets: false,
      headerOverrideEnabled: false,
      headerOverrideIndex: null,
      fieldRows: props.initialTemplate.fields.map(f => ({
        orderIndex: f.orderIndex,
        name: f.name,
        required: !!f.required,
        type: f.type
      }))
    }]
    currentBlockIndex.value = 0
  } else {
    templateName.value = 'Nová šablona'
    deviceCode.value = props.devices[0]?.id ?? ''
  }
  await nextTick()
  if (mode.value === 'import') {
    document.querySelector<HTMLTextAreaElement>('[data-clipboard-input]')?.focus()
  }
})
watch(delimiterOverrideModel, () => { if (mode.value==='import' && rawText.value.trim()) runAnalysis() })

function kindLabel(k: PickedBlock['kind'] | TableBlock['kind'] | StatsBlock['kind'] | SeriesBlock['kind'] | KvBlock['kind']): string {
  return k === 'table' ? 'Tabulka' : k === 'kv' ? 'Metadata' : k === 'stats' ? 'Statistika' : 'Řada'
}
const FIELD_TYPE_VALUES = ['float', 'int', 'text', 'file', 'bool', 'date'] as const
function inferFieldTypeFromHeader(header: string): ColumnType { return inferFieldTypeFromParser(header) }
function toFieldType(t: ColumnType): FieldType {
  // Cast the array to a wider type for the .includes() check
  if ((FIELD_TYPE_VALUES as readonly string[]).includes(t)) {
    return t as FieldType // We've confirmed t is a valid FieldType
  }
  return 'text'
}
/* Build fields for imported block */
function buildFieldsForBlock(
  blk: TableBlock | StatsBlock | SeriesBlock | KvBlock,
  opts: { includeRepeatSets: boolean; headerOverrideEnabled: boolean; headerOverrideIndex: number | null }
): FieldRow[] {
  let headerNames: string[] = []
  if (blk.kind === 'table') {
    const tbl = blk as TableBlock
    const baseHeaders = opts.headerOverrideEnabled && opts.headerOverrideIndex != null
      ? (tbl.rows[opts.headerOverrideIndex] ?? [])
      : tbl.headersRaw
    const headers = baseHeaders.slice()
    if (!headers.length) return []
    if (!opts.includeRepeatSets) {
      const seen = new Set<string>()
      const baseOf = (h: string) => h.trim().replace(/\s+\d+$/u, '')
      const out: string[] = []
      for (const h of headers) {
        const base = baseOf(h) || h
        if (seen.has(base)) continue
        seen.add(base)
        out.push(base || h)
      }
      headerNames = out
    } else {
      const rep = buildRepeatMetaFromHeaders(headers)
      if (!rep.repeatDetected) headerNames = headers
      else {
        const counters: Record<string, number> = {}
        const baseOf = (h: string) => h.trim().replace(/\s+\d+$/u, '')
        headerNames = headers.map((h) => {
          const base = baseOf(h) || h
          counters[base] = (counters[base] ?? 0) + 1
          const idx = counters[base]
          return `${base} ${idx}`
        })
      }
    }
  } else if (blk.kind === 'series') {
    headerNames = [blk.header?.trim() || 'Value']
  } else if (blk.kind === 'kv') {
    headerNames = []
  } else {
    headerNames = ['Value']
  }

  return headerNames.map((h, i) => ({
    orderIndex: i + 1,
    name: h || `Col ${i + 1}`,
    required: false,
    type: toFieldType(inferFieldTypeFromHeader(h)),
  }))
}

/* Add imported block into pickedBlocks */
function addBlockFromSource(sourceIndex: number) {
  const b = blocks.value[sourceIndex]; if (!b) return
  if (pickedBlocks.value.some(pb => pb.sourceIndex === sourceIndex)) return
  const pb: PickedBlock = {
    id: `${sourceIndex}-${Date.now()}`,
    sourceIndex,
    kind: b.kind,
    title: `${kindLabel(b.kind)}`,
    includeRepeatSets: false,
    headerOverrideEnabled: false,
    headerOverrideIndex: null,
    fieldRows: buildFieldsForBlock(b, { includeRepeatSets: false, headerOverrideEnabled: false, headerOverrideIndex: null })
  }
  pickedBlocks.value = [...pickedBlocks.value, pb]
}
function headerOverrideOptionsFor(pb: PickedBlock) {
  const blk = blocks.value[pb.sourceIndex!]; if (!blk || blk.kind !== 'table') return []
  const rows = (blk as TableBlock).rows
  const items: Array<{ label: string; value: number | null }> = [{ label: 'Rozpoznaná hlavička', value: null }]
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const sample = (rows[i] ?? []).slice(0, 6).join(' | ')
    items.push({ label: `Řádek ${i + 1}: ${sample}`, value: i })
  }
  return items
}
function effectiveHeadersFor(pb: PickedBlock): string[] {
  const blk = blocks.value[pb.sourceIndex!]; if (!blk || blk.kind !== 'table') return []
  if (pb.headerOverrideEnabled && pb.headerOverrideIndex != null) {
    return ((blk as TableBlock).rows[pb.headerOverrideIndex] ?? []).map(s => (s ?? '').trim())
  }
  return (blk as TableBlock).headersRaw
}
function addMetadataAsFieldsTo(id: string) {
  const pb = pickedBlocks.value.find(x => x.id === id); if (!pb) return
  const blk = blocks.value[pb.sourceIndex!]; if (!blk || blk.kind !== 'kv') return
  const baseIndex = pb.fieldRows.length
  const rowsToAdd: FieldRow[] = (blk as KvBlock).pairs.map((p, i) => ({
    orderIndex: baseIndex + i + 1,
    name: p.key,
    required: false,
    type: inferTypeFromSample(p.value)
  }))
  pb.fieldRows = [...pb.fieldRows, ...rowsToAdd].map((f,i)=>({ ...f, orderIndex: i+1 }))
}
function inferTypeFromSample(sample: string): FieldType {
  const s = (sample ?? '').trim()
  if (!s) return 'text'
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(s) || /^\d{1,2}\.\d{1,2}\.\s*\d{4}(?:\s+\d{1,2}:\d{2}:\d{2})?$/.test(s)) return 'date'
  if (/^(true|false|1|0|yes|no|y|n|ano|ne|t|f)$/i.test(s)) return 'bool'
  if (/\.(png|jpg|jpeg|tif|tiff|gif|csv|tsv|txt|pdf|xlsx)$/i.test(s) || /^(https?|s3|file):\/\//i.test(s)) return 'file'
  const num = Number(s.replace(',', '.')); if (Number.isFinite(num)) return Number.isInteger(num) ? 'int' : 'float'
  return 'text'
}

/* File + delimiter modal */
const fileInput = ref<HTMLInputElement | null>(null)
function triggerFilePick() { fileInput.value?.click() }

const showDelimiterModal = ref(false)
const uploadBufferText = ref<string>(''); const modalDelimiter = ref<DelimiterOverride>('auto')
const previewRows = ref<string[][]>([]); const previewMaxRows = 8; const previewMaxCols = 12
watch(modalDelimiter, (d) => { if (!showDelimiterModal.value) return; previewRows.value = tokenizeForPreview(uploadBufferText.value, d) })

function confirmDelimiterChoice() { delimiterOverrideModel.value = modalDelimiter.value; rawText.value = uploadBufferText.value; showDelimiterModal.value = false; runAnalysis() }
function cancelDelimiterChoice() { showDelimiterModal.value = false; uploadBufferText.value = '' }

function guessDelimiterFast(s: string): DelimiterOverride {
  if (/\t/.test(s)) return 'tab'
  const semi = (s.match(/;/g) || []).length, comma = (s.match(/,/g) || []).length, pipe = (s.match(/\|/g) || []).length
  if (semi >= comma && semi >= pipe && semi > 0) return 'semicolon'
  if (comma >= semi && comma >= pipe && comma > 0) return 'comma'
  if (pipe > 0) return 'pipe'
  if (/\s{2,}/.test(s)) return 'spaces'
  return 'comma'
}
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []; let cur = ''; let inQ = false
  for (let i=0;i<line.length;i++) {
    const ch = line[i]
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++ } else inQ = !inQ; continue }
    if (!inQ && ch === sep) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur); return out
}
function tokenizeForPreview(text: string, delim: DelimiterOverride): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, previewMaxRows)
  const sep = delim==='semicolon'?';': delim==='comma'?',': delim==='pipe'?'|': delim==='tab'?'\t': null
  return lines.map(l => {
    if (delim==='spaces') return (/\s{2,}/.test(l)?l.split(/\s{2,}/):[l]).slice(0, previewMaxCols)
    if (sep) return splitCsvLine(l, sep).slice(0, previewMaxCols)
    return [l]
  })
}

/* Robust file read */
function normalizeNewlines(s: string): string { return s.replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ') }
function countReplacementChars(s: string): number { return (s.match(/\uFFFD/g) || []).length }
function isMostlyPrintable(s: string): boolean {
  const stripped = s.replace(/[\n\r\t ]+/g, ''); const nonPrintable = stripped.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g)?.length ?? 0
  return nonPrintable < Math.max(4, Math.floor(stripped.length * 0.01))
}
type CandidateEncoding = 'utf-8'|'windows-1250'|'windows-1252'|'iso-8859-2'
async function readFileSmart(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  if (buf.length>=2 && buf[0]===0xFF && buf[1]===0xFE) return normalizeNewlines(new TextDecoder('utf-16le').decode(buf))
  if (buf.length>=2 && buf[0]===0xFE && buf[1]===0xFF) return normalizeNewlines(new TextDecoder('utf-16be').decode(buf))
  if (buf.length>=3 && buf[0]===0xEF && buf[1]===0xBB && buf[2]===0xBF) return normalizeNewlines(new TextDecoder('utf-8').decode(buf))
  const zeroRatio = buf.filter(b => b===0).length / Math.max(1, buf.length)
  if (zeroRatio > 0.1) return normalizeNewlines(new TextDecoder('utf-16le').decode(buf))
  const candidates: ReadonlyArray<CandidateEncoding> = ['utf-8','windows-1250','windows-1252','iso-8859-2']
  let best = { text: '', score: Number.POSITIVE_INFINITY }
  for (const enc of candidates) {
    try {
      const dec = new TextDecoder(enc, { fatal: false })
      const text = normalizeNewlines(dec.decode(buf))
      const score = countReplacementChars(text) + (isMostlyPrintable(text) ? 0 : 1000)
      if (score < best.score) best = { text, score }
      if (score === 0) break
    } catch {}
  }
  return best.text || normalizeNewlines(new TextDecoder().decode(buf))
}
function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement; const f = input.files?.[0]; if (!f) return
  readFileSmart(f).then((text) => {
    const isCsv = /\.csv$/i.test(f.name) || /text\/csv/i.test(f.type)
    if (isCsv) {
      uploadBufferText.value = text; modalDelimiter.value = guessDelimiterFast(text)
      previewRows.value = tokenizeForPreview(text, modalDelimiter.value); showDelimiterModal.value = true
    } else { rawText.value = text; runAnalysis() }
  }).then(() => { if (input) input.value = '' }, () => { if (input) input.value = '' })
}

/* Analyze */
type ParserOptionsWithDelim = ParserOptions & { delimiterOverride?: Exclude<DelimiterOverride,'auto'> }
function runAnalysis() {
  const opts: ParserOptionsWithDelim = { preferDecimalComma: true, acceptMarkdownTables: true, mergeUnitsWithHeaders: true }
  if (delimiterOverrideModel.value !== 'auto') opts.delimiterOverride = delimiterOverrideModel.value
  const a: AnalyzeResult = analyzeClipboard(rawText.value, opts)
  blocks.value = a.blocks
  if (a.headersRaw?.length && templateName.value === 'Nová šablona') templateName.value = a.headersRaw[0] ?? templateName.value
}
function updatePickedBlockFields(id: string) {
  const pb = pickedBlocks.value.find(x => x.id === id); if (!pb) return
  const src = blocks.value[pb.sourceIndex!]; if (!src) return
  pb.fieldRows = buildFieldsForBlock(src, {
    includeRepeatSets: pb.includeRepeatSets, headerOverrideEnabled: pb.headerOverrideEnabled, headerOverrideIndex: pb.headerOverrideIndex
  }).map((f,i)=>({ ...f, orderIndex: i+1 }))
}

/* --------- confirm/cancel ---------- */
async function confirm() {
  if (!deviceCode.value || !pickedBlocks.value.length || !hasAnyFields.value) return
  loading.value = true
  try {
    const blocksPayload: TemplateBlockPayload[] = pickedBlocks.value.map(pb => ({
      kind: pb.kind,
      title: pb.title,
      fields: pb.fieldRows.map((f,i)=>({ orderIndex: i+1, name: f.name.trim() || `Pole ${i+1}`, required: !!f.required, type: f.type }))
    }))
    // flatMap kompatibilita pro starší target
    const mergedFields: FieldRow[] = []
    for (const b of blocksPayload) mergedFields.push(...b.fields)
    const payload: TemplatePayload & { templateId?: string } = {
      deviceCode: deviceCode.value,
      templateName: (templateName.value || '').trim() || 'Šablona',
      blocks: blocksPayload,
      fields: mergedFields,
      templateId: props.operation === 'edit' && props.initialTemplate ? props.initialTemplate.templateId : undefined
    }
    if (typeof props.onConfirm === 'function') await Promise.resolve(props.onConfirm(payload))
    else emit('confirm', payload)
    open.value = false
  } finally { loading.value = false }
}
function cancel() { open.value = false }
</script>

<style scoped>
.clipboard-textarea :deep(textarea){ max-height:240px; overflow:auto; white-space:pre-wrap; }
.preview-header { font-weight:600; }
.mono-block { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; background:#fff; padding:8px; border:1px solid #e3e3e3; border-radius:6px; max-height:160px; overflow:auto; }
.mono-line { font-family: inherit; white-space: nowrap; font-size: 12px; }
.chip { display:inline-block; padding:2px 6px; border-radius:12px; background:#f2f2f2; margin-right:6px; margin-bottom:6px; font-size:12px; }
.picked-block { border:1px solid #ececec; border-radius:8px; padding:10px; background:#fff; margin-bottom:12px; }
.preview-sample { max-height:220px; overflow:auto; border:1px solid #ececec; padding:8px; border-radius:6px; background:#fff }
</style>
