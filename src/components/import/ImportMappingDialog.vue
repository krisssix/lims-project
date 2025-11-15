<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import Dialog from '@/components/Dialog.vue'
import { useImportStore } from '@/stores/import'
import type { TemplateItem } from '@/types/measurement-ui'

type ImportStartRequest = {
  sourceType: 'text' | 'csv' | 'xlsx'
  rawText?: string
  fileBase64?: string
  delimiter?: string
  decimal?: string
  headerRowIndex?: number
}

type ImportPreviewResponse = {
  sessionId: number
  rawHeaders: string[]
  normalizedHeaders: string[]
  sampleRows: Array<Record<string, string>>
  suggestedTemplateId?: number | null
  suggestedMapping?: Record<string, string> | null
  summaryRowIndexes: number[]
  state: string
}

type ImportCommitRequest = {
  mapping: Record<string, string>
  templateId: number
  selectedRowIndexes: number[]
}

const props = defineProps<{
  modelValue: boolean
  projectId: number
  templates: TemplateItem[]
  onCommitted?: (r: { sessionId: number; persistedMeasurements: number; persistedValues: number }) => void
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const importStore = useImportStore()

// Input
const rawText = ref<string>('')
const fileDataUrl = ref<string | null>(null)
const delimiter = ref<string | null>(null)
const headerRowIndex = ref<number>(0)
const loading = ref(false)
const errorText = ref<string | null>(null)

// Preview + mapping
const preview = ref<ImportPreviewResponse | null>(null)
const selectedTemplateId = ref<number | null>(null)
const mapping = ref<Record<string, string>>({})
const selectedRowIndexes = ref<number[]>([])

// Helpers
function normalizeLabel(s: string): string {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
}
const selectedTemplate = computed(() => {
  const id = selectedTemplateId.value
  return id == null ? null : props.templates.find(t => Number(t.id) === id) ?? null
})
const templateFieldNames = computed(() => (selectedTemplate.value?.fields ?? []).map(f => f.name))

function autoMapHeaders() {
  const fields = templateFieldNames.value
  const fieldsNorm = fields.map(normalizeLabel)
  const map: Record<string, string> = {}
  for (const h of (preview.value?.rawHeaders ?? [])) {
    const hn = normalizeLabel(h)
    const idx = fieldsNorm.indexOf(hn)
    if (idx >= 0) map[h] = fields[idx]!
  }
  mapping.value = map
}

async function aiSuggestMapping() {
  if (!preview.value || selectedTemplateId.value == null) return
  try {
    loading.value = true
    const resp = await importStore.suggestMapping({
      templateId: selectedTemplateId.value,
      headers: preview.value.rawHeaders,
      threshold: 0.55
    })
    // Merge: prefer AI, fallback to existing
    const merged: Record<string, string> = { ...mapping.value }
    for (const h of preview.value.rawHeaders) {
      if (resp.mapping[h]) merged[h] = resp.mapping[h]!
    }
    mapping.value = merged
  } catch (e: unknown) {
    errorText.value = (e as { message?: string })?.message || 'AI návrh mapování selhal.'
  } finally {
    loading.value = false
  }
}

function buildDefaultSelectedRows() {
  // Použijeme rozsah dle sampleRows (náhled) a vynecháme summary
  const n = preview.value?.sampleRows?.length ?? 0
  const summary = new Set(preview.value?.summaryRowIndexes ?? [])
  const rows: number[] = []
  for (let i = 0; i < n; i++) {
    if (!summary.has(i)) rows.push(i)
  }
  selectedRowIndexes.value = rows
}

async function pasteFromClipboard() {
  try {
    const txt = await navigator.clipboard.readText()
    rawText.value = txt
  } catch { /* ignore */ }
}

function onFileChange(files: File[] | File | null) {
  const f = Array.isArray(files) ? files[0] : files
  if (!f) { fileDataUrl.value = null; return }
  const reader = new FileReader()
  reader.onload = () => {
    const result = reader.result
    if (typeof result === 'string') {
      // data URL → oddělíme base64 část, nebo vezmeme celé data URL (BE očekává base64)
      const base64 = result.includes(',') ? result.split(',')[1] : result
      fileDataUrl.value = base64
    }
  }
  reader.readAsDataURL(f)
}

async function runPreview() {
  if (!props.projectId) return
  errorText.value = null
  preview.value = null
  mapping.value = {}
  loading.value = true
  try {
    const req: ImportStartRequest = fileDataUrl.value
      ? { sourceType: 'csv', fileBase64: fileDataUrl.value, delimiter: delimiter.value ?? undefined, headerRowIndex: headerRowIndex.value }
      : { sourceType: 'text', rawText: rawText.value, delimiter: delimiter.value ?? undefined, headerRowIndex: headerRowIndex.value }
    const p = await importStore.startImport(props.projectId, req)
    preview.value = p
    // default template suggestion
    selectedTemplateId.value = (p.suggestedTemplateId != null) ? Number(p.suggestedTemplateId) : (props.templates[0] ? Number(props.templates[0].id) : null)
    await nextTick()
    autoMapHeaders()
    buildDefaultSelectedRows()
  } catch (e: unknown) {
    errorText.value = (e as { message?: string })?.message || 'Načtení náhledu selhalo.'
  } finally {
    loading.value = false
  }
}

const isMappingComplete = computed(() =>
  !!selectedTemplateId.value &&
  !!preview.value &&
  (preview.value.rawHeaders ?? []).every(h => !!mapping.value[h])
)

async function commitImport() {
  if (!preview.value || !selectedTemplateId.value || !isMappingComplete.value) return
  loading.value = true
  errorText.value = null
  try {
    const payload: ImportCommitRequest = {
      mapping: mapping.value,
      templateId: selectedTemplateId.value,
      selectedRowIndexes: selectedRowIndexes.value
    }
    const resp = await importStore.commitImport(preview.value.sessionId, payload)
    // Success → zavřít a notif
    if (typeof props.onCommitted === 'function') {
      props.onCommitted({
        sessionId: resp.sessionId,
        persistedMeasurements: resp.persistedMeasurements,
        persistedValues: resp.persistedValues
      })
    }
    open.value = false
  } catch (e: unknown) {
    errorText.value = (e as { message?: string })?.message || 'Commit importu selhal.'
  } finally {
    loading.value = false
  }
}

// Hotkeys
function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  const key = e.key.toLowerCase()
  if (key === 'escape') { e.preventDefault(); open.value = false; return }
  if ((e.ctrlKey || e.metaKey) && key === 'v') { e.preventDefault(); void pasteFromClipboard(); return }
  if ((e.ctrlKey || e.metaKey) && key === 'enter') { e.preventDefault(); void runPreview(); return }
  if ((e.ctrlKey || e.metaKey) && key === 'r') { e.preventDefault(); void aiSuggestMapping(); return }
  if ((e.ctrlKey || e.metaKey) && key === 's') { e.preventDefault(); void commitImport(); return }
}

watch(open, v => {
  if (v) {
    rawText.value = ''
    fileDataUrl.value = null
    delimiter.value = null
    headerRowIndex.value = 0
    preview.value = null
    mapping.value = {}
    selectedRowIndexes.value = []
    errorText.value = null
    window.addEventListener('keydown', onKeydown)
    nextTick(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-raw-input]')
      ta?.focus()
    })
  } else {
    window.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <Dialog
    v-model:is-open="open"
    width="1000px"
    :hide-footer="true"
  >
    <template #content>
      <div class="pa-4">
        <div class="text-h6 mb-3">
          Import a mapování měření
        </div>

        <v-alert
          v-if="errorText"
          type="error"
          class="mb-3"
          border="start"
          density="comfortable"
        >
          {{ errorText }}
        </v-alert>

        <!-- Input -->
        <v-sheet
          class="pa-3 mb-3"
          color="grey-lighten-5"
          elevation="0"
        >
          <div class="d-flex align-center ga-3">
            <v-textarea
              v-model="rawText"
              data-raw-input
              label="Vložit data (Ctrl+V)"
              rows="4"
              auto-grow
              variant="outlined"
              density="comfortable"
              hide-details
              class="flex-grow-1"
            />
            <div style="min-width: 280px">
              <v-file-input
                label="Soubor (CSV/XLSX)"
                show-size
                accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                variant="outlined"
                density="comfortable"
                hide-details
                @update:model-value="onFileChange"
              />
              <div class="d-flex ga-2 mt-2">
                <v-text-field
                  v-model="delimiter"
                  label="Oddělovač (; , tab)"
                  density="comfortable"
                  hide-details
                />
                <v-text-field
                  v-model.number="headerRowIndex"
                  label="Řádek hlavičky"
                  type="number"
                  density="comfortable"
                  hide-details
                />
              </div>
            </div>
          </div>
          <div class="d-flex mt-2 ga-2">
            <v-btn
              color="primary"
              :loading="loading"
              title="Načíst preview (Ctrl+Enter)"
              @click="runPreview"
            >
              NAČÍST PREVIEW
            </v-btn>
            <v-spacer />
            <v-btn
              variant="text"
              @click="open = false"
            >
              Zavřít (Esc)
            </v-btn>
          </div>
        </v-sheet>

        <!-- Preview + Mapping -->
        <div v-if="preview">
          <div class="d-flex align-center mb-2 ga-3">
            <v-select
              v-model="selectedTemplateId"
              :items="props.templates"
              item-title="name"
              item-value="id"
              label="Šablona"
              variant="outlined"
              density="comfortable"
              hide-details
              style="max-width: 360px"
              @update:model-value="autoMapHeaders"
            />
            <v-btn
              variant="tonal"
              color="primary"
              @click="autoMapHeaders"
            >
              AUTO MAP
            </v-btn>
            <v-btn
              variant="tonal"
              color="primary"
              title="AI navrhni (Ctrl+R)"
              @click="aiSuggestMapping"
            >
              AI NAVRHNI
            </v-btn>
            <v-spacer />
            <v-btn
              color="primary"
              :disabled="!isMappingComplete"
              :loading="loading"
              title="Commit (Ctrl+S)"
              @click="commitImport"
            >
              COMMIT
            </v-btn>
          </div>

          <v-row>
            <v-col
              cols="12"
              md="7"
            >
              <v-data-table
                :headers="[
                  { title: 'Hlavička', key: 'header', sortable: false },
                  { title: 'Mapovat na pole šablony', key: 'map', sortable: false }
                ]"
                :items="(preview.rawHeaders || []).map(h => ({ header: h }))"
                class="elevation-1"
                density="comfortable"
                hide-default-footer
              >
                <template #[`item.header`]="{ item }">
                  <div class="d-flex align-center ga-2">
                    <v-chip
                      size="small"
                      color="deep-purple"
                      text-color="white"
                      variant="flat"
                    >
                      {{ item.header }}
                    </v-chip>
                    <span class="text-medium-emphasis">{{ normalizeLabel(item.header) }}</span>
                  </div>
                </template>
                <template #[`item.map`]="{ item }">
                  <v-autocomplete
                    :model-value="mapping[item.header] ?? ''"
                    :items="templateFieldNames"
                    label="Pole šablony"
                    density="comfortable"
                    hide-details
                    @update:model-value="(v: string) => { mapping[item.header] = v }"
                  />
                </template>
              </v-data-table>
            </v-col>

            <v-col
              cols="12"
              md="5"
            >
              <v-card elevation="1">
                <v-card-title class="text-subtitle-1">
                  Ukázka řádků
                </v-card-title>
                <v-card-text>
                  <div class="text-caption mb-2">
                    Zaškrtněte řádky k importu (summary vynechány)
                  </div>
                  <v-list
                    density="compact"
                    lines="one"
                  >
                    <v-list-item
                      v-for="(row, idx) in (preview.sampleRows || [])"
                      :key="idx"
                    >
                      <template #prepend>
                        <v-checkbox
                          :model-value="selectedRowIndexes.includes(idx)"
                          hide-details
                          density="compact"
                          :disabled="(preview.summaryRowIndexes || []).includes(idx)"
                          @update:model-value="(v: boolean | null) => {
                            const checked = v === true
                            const pos = selectedRowIndexes.indexOf(idx)
                            if (checked && pos === -1) selectedRowIndexes.push(idx)
                            if (!checked && pos >= 0) selectedRowIndexes.splice(pos, 1)
                          }"
                        />
                      </template>
                      <v-list-item-title
                        class="text-mono"
                        style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;"
                      >
                        {{ Object.values(row).join(' | ') }}
                      </v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.text-mono { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
