<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useDeviceStore } from '@/stores/devices'
import ColorPickerInput from '@/components/ColorPickerInput.vue'


/**
 * Inline vytvoření nového přístroje (Device) přímo ve formuláři šablony / měření.
 */

const props = defineProps<{
  open: boolean
  autofocus?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', device: { id: number; code: string; name: string; color?: string | null; active: boolean }): void
}>()

const store = useDeviceStore()

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
  if (!touched.value || !formName.value) return null
  if (formName.value.trim().length < 3) return 'Minimálně 3 znaky'
  return null
})

function reset() {
  formCode.value = ''
  formName.value = ''
  formColor.value = '#3f51b5'
  active.value = true
  errorText.value = null
  touched.value = false
}

async function save() {
  if (!isValid.value || saving.value) return
  saving.value = true
  errorText.value = null
  try {
    const dev = await store.createDevice({
      code: normalizedCode.value,
      name: formName.value.trim(),
      color: formColor.value.trim(),
      active: active.value
    })
    if (!dev) throw new Error('Server nevrátil přístroj')
    emit('created', dev)  // emit celý objekt
    emit('close')
  } catch (e: unknown) {
    errorText.value = (e as { message?: string })?.message || 'Vytvoření selhalo'
  } finally {
    saving.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  const k = e.key.toLowerCase()
  const ctrlMeta = e.ctrlKey || e.metaKey
  if (k === 'escape') { e.preventDefault(); emit('close'); return }
  if (ctrlMeta && k === 's') { e.preventDefault(); void save(); return }
  /*
  if (e.altKey && e.shiftKey && k === 'r') {
    e.preventDefault()
    void store.refreshDevices(true)
    return
  }
  */

}

watch(() => props.open, v => {
  if (v) {
    reset()
    window.addEventListener('keydown', onKey)
    nextTick(() => {
      if (props.autofocus) {
        document.querySelector<HTMLInputElement>('[data-device-code]')?.focus()
      }
    })
  } else {
    window.removeEventListener('keydown', onKey)
  }
})

onMounted(() => { if (props.open) window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <transition name="slide-fade">
    <div
      v-if="open"
      class="device-inline-create"
    >
      <div class="create-header">
        <div
          class="d-flex align-center"
          style="gap: 10px;"
        >
          <v-avatar
            size="32"
            color="primary"
            variant="tonal"
          >
            <v-icon size="18">
              mdi-plus-circle
            </v-icon>
          </v-avatar>
          <div>
            <div class="text-subtitle-2 font-weight-bold">
              Nový přístroj
            </div>
            <div class="text-caption text-medium-emphasis">
              Vytvořte nový měřicí přístroj
            </div>
          </div>
        </div>
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          class="close-btn"
          title="Zavřít (Esc)"
          @click="emit('close')"
        />
      </div>

      <div class="create-content">
        <v-expand-transition>
          <v-alert
            v-if="errorText"
            type="error"
            variant="tonal"
            density="compact"
            closable
            class="mb-4"
            @click:close="errorText = null"
          >
            <template #prepend>
              <v-icon>mdi-alert-circle</v-icon>
            </template>
            {{ errorText }}
          </v-alert>
        </v-expand-transition>

        <div class="form-grid">
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
              :error="!!codeError"
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
              Min.3 znaky (A-Z, 0-9, _) : automaticky převedeno na UPPERCASE
            </div>
          </div>

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
              placeholder="např.Difrakční spektrometr DLS"
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
                  <span class="switch-label">
                    {{ active ? 'Aktivní' : 'Neaktivní' }}
                  </span>
                </template>
              </v-switch>
            </div>
          </div>

          <v-expand-transition>
            <v-card
              v-if="normalizedCode || formName"
              variant="tonal"
              color="primary"
              class="preview-card"
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
                    v-if="active"
                    size="small"
                    color="success"
                    variant="flat"
                  >
                    Aktivní
                  </v-chip>
                  <v-chip
                    v-if="!active"
                    size="small"
                    color="grey"
                    variant="flat"
                  >
                    Neaktivní
                  </v-chip>
                </div>
              </v-card-text>
            </v-card>
          </v-expand-transition>
        </div>
      </div>

      <div class="create-footer">
        <div class="footer-actions">
          <v-btn
            variant="text"
            @click="emit('close')"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!isValid"
            :loading="saving"
            prepend-icon="mdi-check"
            @click="save"
          >
            Uložit přístroj
          </v-btn>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.device-inline-create {
  background: linear-gradient(to bottom, #ffffff 0%, #fafbfc 100%);
  border: 2px solid rgb(var(--v-theme-primary));
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.create-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: rgb(var(--v-theme-primary), 0.04);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
}

.close-btn {
  opacity: 0.7;
  transition: opacity 0.2s;
}

.close-btn:hover {
  opacity: 1;
}

.create-content {
  padding: 20px;
}

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
  margin-bottom: 4px;
}

.field-hint {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.6);
  margin-top: -4px;
}

/* odstraněny staré barvy (old color-input) */

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 2px solid rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: transform 0.2s;
  /* zajištění z-indexu (ensure z-index) */
  z-index: 1;
}

.color-preview:hover {
  transform: scale(1.1);
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.2);
}

.switch-label {
  font-size: 0.875rem;
  font-weight: 500;
}

.preview-card {
  margin-top: 8px;
}

.device-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background: white;
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

.create-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(0, 0, 0, 0.02);
  border-top: 1px solid rgba(var(--v-border-color), 0.12);
}

.footer-actions {
  display: flex;
  gap: 8px;
}

.text-medium-emphasis {
  opacity: 0.7;
}

/* animace (animations) */
.slide-fade-enter-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

@media (max-width: 768px) {
  .form-row {
    flex-direction: column;
  }

  .create-footer {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .footer-actions {
    width: 100%;
    justify-content: stretch;
  }

  .footer-actions .v-btn {
    flex: 1;
  }
}
</style>
