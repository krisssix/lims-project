<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Dialog from '@/components/Dialog.vue'
import type { MappingModel } from '@/utils/import/importMapping'
import { validateMapping, exportMapping } from '@/utils/import/importMapping'
import { isEditableElement } from '@/components/ui/hotkeyGuard'

const props = defineProps<{
  modelValue: boolean
  mappingModel: MappingModel | null
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'applyMapping', payload: ReturnType<typeof exportMapping>): void
}>()

const open = computed<boolean>({
  get: () => props.modelValue,
  set: v => emits('update:modelValue', v)
})

const activeBlockIndex = ref<number>(1)
const showUnmatchedOnly = ref<boolean>(false)
const validationErrors = ref<string[]>([])
const lastFocusedFieldPos = ref<number>(-1)

function currentBlock() {
  return props.mappingModel?.blocks.find(b => b.blockIndex === activeBlockIndex.value) || null
}

function recomputeValidation(): void {
  if (props.mappingModel) {
    validationErrors.value = validateMapping(props.mappingModel)
  } else {
    validationErrors.value = []
  }
}

watch(() => props.mappingModel, () => {
  if (props.mappingModel?.blocks.length) {
    activeBlockIndex.value = props.mappingModel.blocks[0]!.blockIndex
  }
  recomputeValidation()
}, { immediate: true })

function setFieldMapping(fieldId: string, sourceIndex: number | null): void {
  if (!props.mappingModel) return
  for (const b of props.mappingModel.blocks) {
    const f = b.fields.find(ff => ff.id === fieldId)
    if (f) {
      f.mappedSourceIndex = sourceIndex
      f.headerMatched = sourceIndex != null &&
        sourceIndex >= 0 &&
        sourceIndex < b.headers.length &&
        b.headers[sourceIndex].trim().toLowerCase() === f.fieldName.trim().toLowerCase()
      break
    }
  }
  recomputeValidation()
}

function cycleBlock(delta: number): void {
  if (!props.mappingModel) return
  const idxList = props.mappingModel.blocks.map(b => b.blockIndex).sort((a, b) => a - b)
  const pos = idxList.indexOf(activeBlockIndex.value)
  const nextPos = Math.min(idxList.length - 1, Math.max(0, pos + delta))
  activeBlockIndex.value = idxList[nextPos]
  lastFocusedFieldPos.value = -1
  nextTick(() => focusFieldByIndex(0))
}

function focusFieldByIndex(idx: number): void {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-map-field]')
    const el = els[idx]
    if (el) {
      el.focus()
      lastFocusedFieldPos.value = idx
    }
  })
}

function onApply(): void {
  if (!props.mappingModel) return
  recomputeValidation()
  if (validationErrors.value.length) return
  emits('applyMapping', exportMapping(props.mappingModel))
  open.value = false
}

function resetMappings(): void {
  if (!props.mappingModel) return
  for (const b of props.mappingModel.blocks) {
    for (const f of b.fields) {
      f.mappedSourceIndex = null
      f.headerMatched = false
    }
  }
  recomputeValidation()
}

function autoFillByName(): void {
  if (!props.mappingModel) return
  for (const b of props.mappingModel.blocks) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    b.fields.forEach((f, fi) => {
      const idx = b.headers.findIndex(h => h.trim().toLowerCase() === f.fieldName.trim().toLowerCase())
      if (idx >= 0) {
        f.mappedSourceIndex = idx
        f.headerMatched = true
      }
    })
  }
  recomputeValidation()
}

/* Hotkeys */

/*
function handleKey(e: KeyboardEvent): void {
  if (!open.value) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const shift = e.shiftKey

  if (key === 'escape') { e.preventDefault(); open.value = false; return }
  if (ctrl && key === 's') { e.preventDefault(); onApply(); return }
  if (ctrl && key === 'r') { e.preventDefault(); resetMappings(); return }
  if (alt && key === 'a') { e.preventDefault(); autoFillByName(); return }
  if (alt && key === 'u') { e.preventDefault(); showUnmatchedOnly.value = !showUnmatchedOnly.value; return }
  if (alt && key === 'arrowleft') { e.preventDefault(); cycleBlock(-1); return }
  if (alt && key === 'arrowright') { e.preventDefault(); cycleBlock(1); return }
  if (alt && (key === 'arrowdown' || key === 'arrowup')) {
    e.preventDefault()
    const block = currentBlock()
    if (!block) return
    const visibleFields = block.fields.filter(f => !showUnmatchedOnly.value || !f.headerMatched)
    if (!visibleFields.length) return
    if (lastFocusedFieldPos.value < 0) lastFocusedFieldPos.value = 0
    if (key === 'arrowdown') lastFocusedFieldPos.value = Math.min(visibleFields.length - 1, lastFocusedFieldPos.value + 1)
    else lastFocusedFieldPos.value = Math.max(0, lastFocusedFieldPos.value - 1)
    focusFieldByIndex(lastFocusedFieldPos.value)
    return
  }
}

watch(open, v => {
  if (v) {
    window.addEventListener('keydown', handleKey)
    nextTick(() => focusFieldByIndex(0))
  } else {
    window.removeEventListener('keydown', handleKey)
  }
})
onMounted(() => { if (open.value) window.addEventListener('keydown', handleKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))


 */
</script>

<template>
  <Dialog
    v-model:is-open="open"
    width="1000px"
    :hide-footer="true"
    class="mapping-wizard-dialog"
  >
    <template #content>
      <div class="pa-4">
        <div class="d-flex align-center mb-3" style="gap:12px;">
          <div class="text-h6">Mapping sloupců</div>
          <v-chip size="small" variant="tonal" color="primary">
            {{ mappingModel?.fileName || 'soubor' }}
          </v-chip>
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            :color="showUnmatchedOnly ? 'primary' : undefined"
            @click="showUnmatchedOnly = !showUnmatchedOnly"
            title="Unmatched toggle (Alt+U)"
          >
            Unmatched
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            @click="autoFillByName"
            title="Auto podle jména (Alt+A)"
          >
            Auto-fill
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            @click="resetMappings"
            title="Reset (Ctrl+R)"
          >
            Reset
          </v-btn>
          <v-btn
            size="small"
            color="primary"
            variant="flat"
            :disabled="validationErrors.length > 0"
            @click="onApply"
            title="Použít mapping (Ctrl+S)"
          >
            Použít
          </v-btn>
        </div>

        <v-alert
          v-if="validationErrors.length"
          type="warning"
          variant="tonal"
          class="mb-3"
        >
          <div class="text-caption">
            <strong>Neplatný mapping:</strong>
            <ul style="margin:4px 0 0 16px;">
              <li v-for="(e,i) in validationErrors" :key="i">{{ e }}</li>
            </ul>
          </div>
        </v-alert>

        <div v-if="!mappingModel" class="text-medium-emphasis">
          Žádná data k mapování.
        </div>

        <div v-else>
          <!-- Block tabs -->
          <div
            v-if="mappingModel.blocks.length > 1"
            class="d-flex flex-wrap mb-3"
            style="gap:6px;"
          >
            <v-chip
              v-for="b in mappingModel.blocks"
              :key="b.blockIndex"
              size="small"
              :color="b.blockIndex === activeBlockIndex ? 'primary' : undefined"
              :variant="b.blockIndex === activeBlockIndex ? 'flat' : 'tonal'"
              @click="activeBlockIndex = b.blockIndex"
            >
              Blok {{ b.blockIndex }}
            </v-chip>
          </div>

          <div
            v-for="b in mappingModel.blocks"
            :key="b.blockIndex"
            v-show="b.blockIndex === activeBlockIndex"
            class="block-section"
          >
            <div class="d-flex align-center mb-2" style="gap:8px;">
              <div class="text-subtitle-2">{{ b.title }} ({{ b.headers.length }} sloupců)</div>
              <v-spacer />
              <v-chip size="x-small" variant="tonal">
                Blok {{ b.blockIndex }}
              </v-chip>
            </div>

            <div class="mapping-grid header-row">
              <div class="cell muted">Pole</div>
              <div class="cell muted">Sloupec</div>
              <div class="cell muted">Preview</div>
              <div class="cell muted">Stav</div>
            </div>

            <transition-group name="fade-y" tag="div">
              <div
                v-for="(f,fi) in b.fields.filter(ff => !showUnmatchedOnly || !ff.headerMatched)"
                :key="f.id"
                class="mapping-grid data-row"
                :class="{'row-invalid': f.required && f.mappedSourceIndex === null}"
              >
                <div
                  class="cell field-name"
                  data-map-field
                  tabindex="0"
                >
                  <div class="d-flex align-center" style="gap:6px;">
                    <v-chip
                      size="x-small"
                      :color="f.required ? 'primary' : 'grey-darken-1'"
                      variant="tonal"
                    >
                      {{ fi + 1 }}
                    </v-chip>
                    <span class="field-label">{{ f.fieldName }}</span>
                    <v-chip
                      v-if="f.headerMatched"
                      size="x-small"
                      color="success"
                      variant="flat"
                    >
                      match
                    </v-chip>
                  </div>
                </div>

                <div class="cell select-cell">
                  <v-select
                    :model-value="f.mappedSourceIndex"
                    :items="b.headers.map((h,i) => ({ title: h, value: i }))"
                    item-title="title"
                    item-value="value"
                    variant="outlined"
                    density="compact"
                    hide-details="auto"
                    placeholder="--"
                    :disabled="!b.headers.length"
                    @update:model-value="val => setFieldMapping(f.id, typeof val === 'number' ? val : null)"
                  />
                </div>

                <div class="cell preview-cell">
                  <span class="text-caption">
                    {{
                      f.mappedSourceIndex != null
                        ? b.headers[f.mappedSourceIndex]
                        : '—'
                    }}
                  </span>
                </div>

                <div class="cell status-cell">
                  <v-icon
                    v-if="f.required && f.mappedSourceIndex === null"
                    size="18"
                    color="error"
                  >
                    mdi-alert-circle-outline
                  </v-icon>
                  <v-icon
                    v-else
                    size="18"
                    color="green-darken-2"
                  >
                    mdi-check-circle-outline
                  </v-icon>
                </div>
              </div>
            </transition-group>
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.mapping-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 64px;
  gap: 8px;
  align-items: center;
}
.header-row {
  padding: 4px 6px 6px;
  font-size: 0.7rem;
  letter-spacing: .03em;
  text-transform: uppercase;
  color: var(--v-theme-grey-darken-2);
}
.data-row {
  padding: 6px;
  border-radius: 6px;
  transition: background-color .15s;
}
.data-row:hover { background: #f9fafc; }
.row-invalid { background: #fff6f6; }
.field-label {
  font-weight: 500;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted { font-size: .7rem; }
</style>
