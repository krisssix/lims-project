<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useDeviceStore } from '@/stores/devices'
import Dialog from '@/components/Dialog.vue'
import ColorPickerInput from '@/components/ColorPickerInput.vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'created', device: { id: number; code: string; name: string; color?: string | null; active: boolean }): void
}>()

const store = useDeviceStore()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const formCode = ref('')
const formName = ref('')
const formColor = ref('#3f51b5')
const active = ref(true)
const saving = ref(false)
const errorText = ref<string | null>(null)
const touched = ref(false)

const normalizedCode = computed(() =>
  formCode.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_')
)

const isValid = computed(() =>
  /^[A-Z0-9_]{3,}$/.test(normalizedCode.value) &&
  formName.value.trim().length >= 3
)

const codeError = computed(() => {
  if (!touched.value || !formCode.value) return null
  if (normalizedCode.value.length < 3) return 'Minimálně 3 znaky'
  if (!/^[A-Z0-9_]+$/.test(normalizedCode.value)) return 'Pouze A-Z, 0-9 a _'
  return null
})

const nameError = computed(() => {
  if (! touched.value || ! formName.value) return null
  if (formName.value.trim().length < 3) return 'Minimálně 3 znaky'
  return null
})

function reset(): void {
  formCode.value = ''
  formName.value = ''
  formColor.value = '#3f51b5'
  active.value = true
  errorText.value = null
  touched.value = false
}

async function save(): Promise<void> {
  if (! isValid.value || saving.value) return
  saving.value = true
  errorText.value = null
  try {
    const dev = await store.createDevice({
      code: normalizedCode.value,
      name: formName.value.trim(),
      color: formColor.value.trim(),
      active: active.value
    })
    if (! dev) throw new Error('Server nevrátil přístroj')
    emit('created', dev)
    open.value = false
  } catch (e: unknown) {
    errorText.value = (e as { message?: string })?.message || 'Vytvoření selhalo'
  } finally {
    saving.value = false
  }
}

function close(): void {
  open.value = false
}

// Reset form when dialog opens
watch(open, (isOpen) => {
  if (isOpen) {
    reset()
    nextTick(() => {
      document.querySelector<HTMLInputElement>('[data-device-code]')?.focus()
    })
  }
})

// Hotkeys
function onKeydown(e: KeyboardEvent): void {
  if (! open.value) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey

  if (key === 'escape') {
    e.preventDefault()
    close()
    return
  }
  if (ctrl && key === 's') {
    e.preventDefault()
    void save()
    return
  }
}
</script>

<template>
  <Dialog
    v-model:is-open="open"
    width="560px"
    :hide-footer="true"
    @keydown="onKeydown"
  >
    <template #content>
      <div class="pa-4">
        <!-- Header -->
        <div class="d-flex align-center mb-4">
          <v-avatar
            size="48"
            color="primary"
            variant="tonal"
          >
            <v-icon size="24">
              mdi-plus-circle
            </v-icon>
          </v-avatar>
          <div class="ml-3">
            <div class="text-h6">
              Nový přístroj
            </div>
            <div class="text-caption text-medium-emphasis">
              Vytvořte nový měřicí přístroj
            </div>
          </div>
        </div>

        <!-- Error alert -->
        <v-alert
          v-if="errorText"
          type="error"
          variant="tonal"
          density="compact"
          closable
          class="mb-4"
          @click:close="errorText = null"
        >
          {{ errorText }}
        </v-alert>

        <!-- Form -->
        <div class="form-grid">
          <!-- Code -->
          <div class="form-field">
            <label class="field-label">
              <v-icon
                size="16"
                class="mr-1"
              >mdi-identifier</v-icon>
              Kód přístroje
            </label>
            <v-text-field
              v-model="formCode"
              data-device-code
              placeholder="např.DLS_01, SPEKTRO_A"
              variant="outlined"
              density="comfortable"
              :error="!! codeError"
              :error-messages="codeError || undefined"
              hide-details="auto"
              @blur="touched = true"
            >
              <template #prepend-inner>
                <v-icon
                  size="18"
                  :color="codeError ? 'error' : 'grey-darken-1'"
                >
                  mdi-code-tags
                </v-icon>
              </template>
              <template
                v-if="normalizedCode && !codeError"
                #append-inner
              >
                <v-icon
                  size="18"
                  color="success"
                >
                  mdi-check-circle
                </v-icon>
              </template>
            </v-text-field>
            <div class="field-hint">
              <v-icon
                size="14"
                class="mr-1"
              >
                mdi-information-outline
              </v-icon>
              Min.  3 znaky (A-Z, 0-9, _) – automaticky převedeno na UPPERCASE
            </div>
          </div>

          <!-- Name -->
          <div class="form-field">
            <label class="field-label">
              <v-icon
                size="16"
                class="mr-1"
              >mdi-format-text</v-icon>
              Název přístroje
            </label>
            <v-text-field
              v-model="formName"
              placeholder="např.  Difrakční spektrometr DLS"
              variant="outlined"
              density="comfortable"
              :error="!!nameError"
              :error-messages="nameError || undefined"
              hide-details="auto"
              @blur="touched = true"
            >
              <template #prepend-inner>
                <v-icon
                  size="18"
                  :color="nameError ? 'error' : 'grey-darken-1'"
                >
                  mdi-tag-text
                </v-icon>
              </template>
              <template
                v-if="formName.trim().length >= 3 && !nameError"
                #append-inner
              >
                <v-icon
                  size="18"
                  color="success"
                >
                  mdi-check-circle
                </v-icon>
              </template>
            </v-text-field>
            <div class="field-hint">
              <v-icon
                size="14"
                class="mr-1"
              >
                mdi-information-outline
              </v-icon>
              Popisný název přístroje (min.3 znaky)
            </div>
          </div>

          <!-- Color + Active -->
          <div class="form-row">
            <div style="flex: 1;">
              <ColorPickerInput
                v-model="formColor"
                label="Barva"
                placeholder="#3f51b5"
              />
            </div>
            <div
              class="form-field"
              style="flex: 0 0 auto;"
            >
              <label class="field-label">
                <v-icon
                  size="16"
                  class="mr-1"
                >mdi-power</v-icon>
                Stav
              </label>
              <v-switch
                v-model="active"
                color="success"
                inset
                hide-details
                density="comfortable"
              >
                <template #label>
                  <span class="switch-label">{{ active ? 'Aktivní' : 'Neaktivní' }}</span>
                </template>
              </v-switch>
            </div>
          </div>

          <!-- Preview -->
          <v-expand-transition>
            <v-card
              v-if="normalizedCode || formName"
              variant="outlined"
              class="mt-2"
            >
              <v-card-title
                class="text-subtitle-2 d-flex align-center"
                style="gap: 8px;"
              >
                <v-icon size="18">
                  mdi-eye-outline
                </v-icon>
                Náhled přístroje
              </v-card-title>
              <v-card-text>
                <div class="device-preview">
                  <v-chip
                    :color="formColor"
                    variant="flat"
                    size="small"
                    class="preview-chip"
                  >
                    {{ normalizedCode || 'KÓD' }}
                  </v-chip>
                  <span class="preview-name">{{ formName || 'Název přístroje' }}</span>
                  <v-chip
                    size="x-small"
                    :color="active ? 'success' : 'grey'"
                    variant="flat"
                  >
                    {{ active ? 'Aktivní' : 'Neaktivní' }}
                  </v-chip>
                </div>
              </v-card-text>
            </v-card>
          </v-expand-transition>
        </div>

        <!-- Actions -->
        <v-divider class="my-4" />
        <div
          class="d-flex justify-end"
          style="gap: 12px;"
        >
          <v-btn
            variant="text"
            @click="close"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="! isValid"
            :loading="saving"
            prepend-icon="mdi-check"
            @click="save"
          >
            Vytvořit přístroj
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.form-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.field-label {
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
}

.field-hint {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.6);
  margin-top: -4px;
}

.switch-label {
  font-size: 0.875rem;
  font-weight: 500;
}

.device-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background: #fafbfc;
  border-radius: 8px;
}

.preview-chip {
  font-weight: 600;
  letter-spacing: 0.025em;
}

.preview-name {
  flex: 1;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.87);
}

@media (max-width: 600px) {
  .form-row {
    flex-direction: column;
  }
}
</style>
