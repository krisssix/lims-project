<script setup lang="ts">
/**
 * measurementimportdialog: import csv/txt/excel + detekce headers, bloky, jednotky, statistika.
 * připravuje draft šablony a preview záznamů.
 * klávesové zkratky: ctrl+enter (parsovat), alt+d (delimiter), alt+u (unit řádek), alt+t (vytvořit šablonu), alt+s (import).
 */

import { ref, watch, nextTick } from 'vue'
import Dialog from '@/components/Dialog.vue'
import { parseMeasurementFile, buildTemplateDraft, buildMeasurementPreview } from '@/utils/import/parseMeasurementFile'
import type { FileParseResult, MeasurementImportPreview, TemplateDraft } from '@/types/import'

const props = defineProps<{
  modelValue: boolean
  deviceIdOptions: { id: string; name: string }[]
  defaultDeviceId?: string
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'importMeasurement', payload: MeasurementImportPreview): void
  (e: 'createTemplate', draft: TemplateDraft): void
}>()

const step = ref<1 | 2 | 3>(1)
const rawFile = ref<File | null>(null)
const clipboardText = ref<string>('')
const parseResult = ref<FileParseResult | null>(null)
const templateDraft = ref<TemplateDraft | null>(null)
const preview = ref<MeasurementImportPreview | null>(null)
const deviceId = ref<string>(props.defaultDeviceId || (props.deviceIdOptions[0]?.id ?? ''))
const loading = ref(false)
const delimiterOverride = ref<string | null>(null)
const useSecondLineUnits = ref(true)
const errorMessage = ref<string | null>(null)

function resetAll(): void {
  step.value = 1
  rawFile.value = null
  clipboardText.value = ''
  parseResult.value = null
  templateDraft.value = null
  preview.value = null
  delimiterOverride.value = null
  useSecondLineUnits.value = true
  errorMessage.value = null
}
function close(): void { emits('update:modelValue', false) }

function onFileSelected(file: File | null): void {
  rawFile.value = file
}

async function parseNow(): Promise<void> {
  if (!rawFile.value && !clipboardText.value.trim()) return
  loading.value = true
  errorMessage.value = null
  try {
    const source = rawFile.value ?? clipboardText.value
    const result = await parseMeasurementFile(source, {
      explicitDelimiter: delimiterOverride.value || undefined,
      assumeSecondLineUnits: useSecondLineUnits.value
    })
    parseResult.value = result
    templateDraft.value = buildTemplateDraft(result, result.fileName.replace(/\.(csv|tsv|txt|xlsx?|unknown)$/i, ''), deviceId.value)
    preview.value = buildMeasurementPreview(result, templateDraft.value)
    step.value = 2
    nextTick(() => focusPrimary())
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Neznámá chyba při parsování.'
  } finally {
    loading.value = false
  }
}

function cycleDelimiter(): void {
  const options = [',', ';', '\t', '|']
  const current = delimiterOverride.value
  if (!current) delimiterOverride.value = options[0]
  else {
    const idx = options.indexOf(current)
    delimiterOverride.value = options[(idx + 1) % options.length]
  }
}
function toggleUnits(): void {
  useSecondLineUnits.value = !useSecondLineUnits.value
  if (parseResult.value) void parseNow()
}
function acceptTemplate(): void {
  if (templateDraft.value) emits('createTemplate', templateDraft.value)
}
function importMeasurement(): void {
  if (preview.value) emits('importMeasurement', preview.value)
}
function focusPrimary(): void {
  const el = document.querySelector<HTMLElement>('[data-import-primary]')
  el?.focus()
}


function handleKey(e: KeyboardEvent): void {
  if (!props.modelValue) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey

  if (key === 'escape') { e.preventDefault(); close(); return }
  if (ctrl && key === 'enter') { e.preventDefault(); void parseNow(); return }
  if (ctrl && key === 'v' && step.value === 1) {
    e.preventDefault()
    void navigator.clipboard.readText().then(t => { clipboardText.value = t })
    return
  }
  if (alt && key === 'd') { e.preventDefault(); cycleDelimiter(); return }
  if (alt && key === 'u') { e.preventDefault(); toggleUnits(); return }
  if (alt && key === 't') { e.preventDefault(); acceptTemplate(); return }
  if (alt && key === 's') { e.preventDefault(); importMeasurement(); return }
}

watch(() => props.modelValue, v => {
  if (v) {
    resetAll()
    window.addEventListener('keydown', handleKey)
    nextTick(() => focusPrimary())
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="1080px"
    :hide-footer="false"
    class="measurement-import-dialog"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div class="text-h6">
        Import měření
        <span
          v-if="parseResult?.fileName"
          class="text-caption ml-3"
        >
          {{ parseResult.fileName }}
        </span>
      </div>
    </template>

    <template #content>
      <div v-if="step === 1">
        <div class="text-subtitle-2 mb-2">
          Zdroj dat
        </div>
        <v-row class="g-4">
          <v-col
            cols="12"
            md="6"
          >
            <v-file-input
              :model-value="rawFile"
              label="Soubor (.csv / .tsv / .txt / .xlsx)"
              variant="outlined"
              density="comfortable"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              hide-details="auto"
              prepend-icon="mdi-upload"
              :disabled="loading"
              data-import-primary
              @update:model-value="f => onFileSelected((Array.isArray(f) ? f[0] : f) as File | null)"
            />
          </v-col>
          <v-col
            cols="12"
            md="6"
          >
            <v-select
              v-model="deviceId"
              :items="props.deviceIdOptions"
              item-title="name"
              item-value="id"
              label="Přístroj"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12">
            <v-textarea
              v-model="clipboardText"
              label="Vložený obsah ze schránky (Ctrl+V)"
              variant="outlined"
              density="comfortable"
              rows="5"
              hide-details="auto"
              placeholder="Můžete vložit text přímo sem..."
              :disabled="!!rawFile || loading"
            />
          </v-col>
        </v-row>
        <div
          class="d-flex align-center mt-3"
          style="gap:12px;"
        >
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!rawFile && !clipboardText.trim()"
            :loading="loading"
            @click="parseNow"
          >
            Parsovat (Ctrl+Enter)
          </v-btn>
          <v-btn
            variant="tonal"
            :color="delimiterOverride ? 'deep-purple' : undefined"
            title="Cyklus delimiteru (Alt+D)"
            @click="cycleDelimiter"
          >
            Delimiter: {{ delimiterOverride || 'AUTO' }}
          </v-btn>
          <v-btn
            variant="tonal"
            :color="useSecondLineUnits ? 'primary' : undefined"
            title="Použít 2. řádek jako jednotky (Alt+U)"
            @click="toggleUnits"
          >
            Jednotky: {{ useSecondLineUnits ? 'ANO' : 'NE' }}
          </v-btn>
        </div>
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          class="mt-3"
        >
          {{ errorMessage }}
        </v-alert>
      </div>

      
      <div v-else-if="step === 2">
        <div class="text-subtitle-2 mb-2">
          Náhled dat (bloky: {{ parseResult?.blocks.length || 0 }})
        </div>
        <v-alert
          v-if="parseResult?.warnings.length"
          type="warning"
          variant="tonal"
          class="mb-3"
        >
          {{ parseResult.warnings.join(' | ') }}
        </v-alert>
        <div
          v-for="block in parseResult?.blocks || []"
          :key="block.blockIndex"
          class="mb-4 block-preview"
        >
          <div
            class="d-flex align-center mb-1"
            style="gap:8px;"
          >
            <v-chip
              size="small"
              color="primary"
              variant="tonal"
            >
              Tabulka hodnot {{ block.blockIndex }}
            </v-chip>
            <span class="text-medium-emphasis text-caption">
              Řádků: {{ block.rows.length }} | Sloupců: {{ block.header.length }}
            </span>
            <v-spacer />
          </div>
          <v-table
            density="compact"
            class="mb-2"
          >
            <thead>
              <tr>
                <th
                  v-for="(h,i) in block.header"
                  :key="i"
                  class="text-caption"
                >
                  {{ h }}<span
                    v-if="block.unitRow?.[i]"
                    class="text-medium-emphasis"
                  > ({{ block.unitRow[i] }})</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row,ri) in block.rows.slice(0,10)"
                :key="ri"
              >
                <td
                  v-for="(cell,ci) in row"
                  :key="ci"
                >
                  {{ cell }}
                </td>
              </tr>
              <tr v-if="block.rows.length > 10">
                <td
                  :colspan="block.header.length"
                  class="text-center text-caption text-medium-emphasis"
                >
                  + {{ block.rows.length - 10 }} dalších…
                </td>
              </tr>
            </tbody>
          </v-table>
          <div
            v-if="block.stats && Object.keys(block.stats).length"
            class="text-caption stats-row"
          >
            <span
              v-for="(st,name) in block.stats"
              :key="name"
              class="mr-2"
            >
              {{ name }}: μ={{ st.mean.toFixed(2) }} σ={{ st.stdDev.toFixed(2) }}
            </span>
          </div>
          <v-divider class="mt-2" />
        </div>

        <div class="mt-4">
          <v-btn
            color="deep-purple"
            variant="flat"
            :disabled="!templateDraft"
            title="Vytvořit šablonu (Alt+T)"
            @click="acceptTemplate"
          >
            Vytvořit šablonu
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            class="ml-2"
            :disabled="!preview"
            title="Importovat (Alt+S)"
            @click="importMeasurement"
          >
            Importovat měření
          </v-btn>
          <v-btn
            variant="text"
            class="ml-2"
            @click="step = 1"
          >
            Zpět
          </v-btn>
        </div>

        <div
          v-if="preview"
          class="mt-6"
        >
          <div class="text-subtitle-2 mb-1">
            Náhled záznamů (prvních 5)
          </div>
          <v-table density="compact">
            <thead>
              <tr>
                <th>Record</th>
                <th>Fields</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="rec in preview.records.slice(0,5)"
                :key="rec.recordIndex"
              >
                <td class="text-caption">
                  {{ rec.recordIndex }}
                </td>
                <td>
                  <div class="text-caption">
                    <span
                      v-for="f in rec.fields.slice(0,6)"
                      :key="f.name + f.blockIndex"
                      class="mr-2"
                    >
                      {{ f.name }}={{ String(f.value ?? '')?.slice(0,16) }}
                    </span>
                    <span
                      v-if="rec.fields.length > 6"
                      class="text-medium-emphasis"
                    >
                      +{{ rec.fields.length - 6 }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </div>

      <div v-else>
        Future step…
      </div>
    </template>

    <template #footer>
      <v-btn
        variant="text"
        @click="close"
      >
        Zavřít
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="step === 1"
        color="primary"
        variant="flat"
        :disabled="!rawFile && !clipboardText.trim()"
        :loading="loading"
        @click="parseNow"
      >
        Parsovat
      </v-btn>
      <v-btn
        v-else-if="step === 2"
        color="primary"
        variant="flat"
        :disabled="!preview"
        @click="importMeasurement"
      >
        Importovat
      </v-btn>
    </template>
  </Dialog>
</template>

<style scoped>
.block-preview { border: 1px solid #e0e0e0; padding: 12px 12px 8px; border-radius: 8px; background: #fafbfc; }
.stats-row { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
