<template>
  <Dialog
    v-model:is-open="open"
    width="880px"
    :hide-footer="true"
  >
    <template #content>
      <div
        class="pa-4"
        @keydown="onKeydown"
      >
        <div class="d-flex align-center ga-3 mb-3">
          <v-select
            v-model="deviceCode"
            :items="devices"
            item-title="name"
            item-value="id"
            label="Přístroj"
            density="comfortable"
            variant="outlined"
            hide-details
            style="max-width: 260px"
          />
          <v-text-field
            v-model="templateName"
            label="Název šablony"
            density="comfortable"
            variant="outlined"
            hide-details
            class="flex-grow-1"
          />
          <v-btn
            variant="tonal"
            color="primary"
            title="Vložit ze schránky (Ctrl+V)"
            @click="pasteFromClipboard"
          >
            VLOŽIT ZE SCHRÁNKY
          </v-btn>
          <v-btn
            variant="text"
            title="Analyzovat"
            @click="runAnalysis"
          >
            Analyzovat
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
          Vlož hlavičky (případně i s daty) a klikni “Analyzovat”.
        </v-alert>

        <div
          v-else
          class="mb-3"
        >
          <div
            class="d-flex align-center mb-2"
            style="gap:12px"
          >
            <v-select
              v-model="selectedBlockIndex"
              :items="blocks.map((b,i) => ({ label: `${i+1}. ${b.kind}`, value: i }))"
              item-title="label"
              item-value="value"
              label="Vybrat blok"
              density="comfortable"
              variant="outlined"
              style="min-width:200px"
            />
            <v-switch
              v-model="includeRepeatSets"
              label="Rozbalit opakované sady"
              density="comfortable"
            />
          </div>

          <div
            class="preview-sample"
            style="max-height:220px; overflow:auto; border:1px solid #ececec; padding:8px; border-radius:6px; background:#fff"
          >
            <div v-if="selectedBlock">
              <div v-if="selectedBlock.kind === 'table'">
                <div style="font-weight:700; margin-bottom:6px;">
                  Hlavičky
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap">
                  <v-chip
                    v-for="(h, idx) in selectedBlock.headersRaw"
                    :key="idx"
                    size="small"
                  >
                    {{ h }}
                  </v-chip>
                </div>
                <div style="margin-top:8px;">
                  <div
                    v-for="(r, ri) in selectedBlock.rows.slice(0,6)"
                    :key="ri"
                    style="font-family: monospace; white-space:pre;"
                  >
                    {{ r.join(' | ') }}
                  </div>
                </div>
              </div>
              <div v-else-if="selectedBlock.kind === 'stats'">
                <div
                  v-for="(l, i) in selectedBlock.lines"
                  :key="i"
                  style="font-family: monospace;"
                >
                  {{ l }}
                </div>
              </div>
              <div v-else-if="selectedBlock.kind === 'series'">
                <div style="font-weight:700;">
                  {{ selectedBlock.header }}
                </div>
                <div
                  v-for="(v, i) in selectedBlock.values.slice(0,20)"
                  :key="i"
                  style="font-family: monospace;"
                >
                  {{ v }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="d-flex justify-end ga-2">
          <v-btn
            variant="text"
            @click="cancel"
          >
            Zrušit (Esc)
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!deviceCode || !selectedBlock"
            :loading="loading"
            @click="confirm"
          >
            Vytvořit šablonu (Ctrl+Enter)
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import type { AnalyzeResult, TableBlock, StatsBlock, SeriesBlock } from '@/utils/importParsing'
import { analyzeClipboard, inferFieldType } from '@/utils/importParsing'

type DeviceItem = { id: string; name: string; color?: string }

const props = defineProps<{
  modelValue: boolean
  devices: DeviceItem[]
  onConfirm?: (payload: {
    deviceCode: string
    templateName: string
    fields: Array<{ orderIndex: number; type: 'float'|'int'|'text'|'file'|'bool'|'date'; required: boolean; name: string }>
  }) => Promise<void> | void
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', payload: {
    deviceCode: string
    templateName: string
    fields: Array<{ orderIndex: number; type: 'float'|'int'|'text'|'file'|'bool'|'date'; required: boolean; name: string }>
  }): void
}>()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const deviceCode = ref<string>('')
const templateName = ref<string>('Nová šablona')
const rawText = ref<string>('')
const blocks = ref<Array<TableBlock | StatsBlock | SeriesBlock>>([])
const selectedBlockIndex = ref<number | null>(null)
const includeRepeatSets = ref<boolean>(false)
const loading = ref(false)

watch(open, async (v) => {
  if (v) {
    deviceCode.value = props.devices[0]?.id ?? ''
    templateName.value = 'Nová šablona'
    rawText.value = ''
    blocks.value = []
    selectedBlockIndex.value = null
    await nextTick()
    const el = document.querySelector<HTMLTextAreaElement>('[data-clipboard-input]')
    el?.focus()
  }
})

async function pasteFromClipboard() {
  try {
    const txt = await navigator.clipboard.readText()
    rawText.value = txt
    runAnalysis()
  } catch {
    /* ignore */
  }
}

function runAnalysis() {
  const a: AnalyzeResult = analyzeClipboard(rawText.value)
  blocks.value = a.blocks as Array<TableBlock | StatsBlock | SeriesBlock>
  if (a.headersRaw && a.headersRaw.length && templateName.value === 'Nová šablona') {
    templateName.value = a.headersRaw[0] ?? templateName.value
  }
  selectedBlockIndex.value = blocks.value.length ? 0 : null
}

const selectedBlock = computed(() => {
  if (selectedBlockIndex.value == null) return null
  return blocks.value[selectedBlockIndex.value] ?? null
})

async function confirm() {
  if (!deviceCode.value || !selectedBlock.value) return
  loading.value = true
  try {
    // build fields depending on block kind
    const fields: Array<{ orderIndex: number; type: 'float'|'int'|'text'|'file'|'bool'|'date'; required: boolean; name: string }> = []
    if (selectedBlock.value.kind === 'table') {
      const tbl = selectedBlock.value as TableBlock
      for (let i = 0; i < tbl.headersRaw.length; i++) {
        fields.push({
          orderIndex: i + 1,
          name: tbl.headersRaw[i] || `Col ${i + 1}`,
          required: false,
          type: inferFieldType(tbl.headersRaw[i])
        })
      }
    } else if (selectedBlock.value.kind === 'series') {
      const s = selectedBlock.value as SeriesBlock
      fields.push({ orderIndex: 1, name: s.header || 'Value', required: false, type: 'float' })
    } else {
      // stats -> fallback single field for numeric stat
      fields.push({ orderIndex: 1, name: 'Value', required: false, type: 'float' })
    }

    const payload = { deviceCode: deviceCode.value, templateName: templateName.value.trim() || 'Šablona', fields }
    if (props.onConfirm && typeof props.onConfirm === 'function') {
      await Promise.resolve(props.onConfirm(payload))
    } else {
      await Promise.resolve(emit('confirm', payload))
    }
    open.value = false
  } finally {
    loading.value = false
  }
}
function cancel() { open.value = false }

function onKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase()
  if (key === 'escape') { e.preventDefault(); cancel(); return }
  if ((e.ctrlKey || e.metaKey) && key === 'v') { e.preventDefault(); pasteFromClipboard(); return }
  if ((e.ctrlKey || e.metaKey) && key === 'enter') { e.preventDefault(); void confirm(); return }
}
</script>

<style scoped>
.clipboard-textarea :deep(textarea) {
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
