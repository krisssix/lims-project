<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import Dialog from '@/components/Dialog.vue'
import ColorPickerInput from '@/components/ColorPickerInput.vue'
import { useDeviceStore, type Device } from '@/stores/devices'

const props = defineProps<{
  modelValue: boolean
  device: Device | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'updated', device: Device): void
  (e: 'deactivated', id: number): void
  (e: 'reactivated', device: Device): void
}>()

const store = useDeviceStore()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

// Form state
const formName = ref('')
const formColor = ref('#3f51b5')
const saving = ref(false)
const errorText = ref<string | null>(null)

// Computed helpers
const isActive = computed(() => props.device?.active ??  false)
const hasChanges = computed(() => {
  if (! props.device) return false
  return formName.value.trim() !== props.device.name ||
    formColor.value !== (props.device.color || '#3f51b5')
})

// Initialize form when device changes or dialog opens
watch([() => props.modelValue, () => props.device], ([isOpen, dev]) => {
  if (isOpen && dev) {
    formName.value = dev.name
    formColor.value = dev.color || '#3f51b5'
    errorText.value = null
    nextTick(() => {
      document.querySelector<HTMLInputElement>('[data-device-detail-name]')?.focus()
    })
  }
}, { immediate: true })

// Actions
async function saveChanges(): Promise<void> {
  if (!props.device || saving.value || !hasChanges.value) return

  const trimmedName = formName.value.trim()
  if (trimmedName.length < 3) {
    errorText.value = 'Název musí mít alespoň 3 znaky'
    return
  }

  saving.value = true
  errorText.value = null

  try {
    const updated = await store.updateDevice(props.device.id, {
      name: trimmedName,
      color: formColor.value || undefined
    })
    if (updated) {
      emit('updated', updated)
      open.value = false
    }
  } catch (e) {
    errorText.value = (e as { message?: string })?.message || 'Uložení selhalo'
  } finally {
    saving.value = false
  }
}

async function deactivate(): Promise<void> {
  if (! props.device || saving.value) return
  saving.value = true
  errorText.value = null

  try {
    await store.deactivateDevice(props.device.id)
    emit('deactivated', props.device.id)
    open.value = false
  } catch (e) {
    errorText.value = (e as { message?: string })?.message || 'Deaktivace selhala'
  } finally {
    saving.value = false
  }
}

async function reactivate(): Promise<void> {
  if (!props.device || saving.value) return
  saving.value = true
  errorText.value = null

  try {
    const reactivated = await store.reactivateDevice(props.device.id)
    if (reactivated) {
      emit('reactivated', reactivated)
      open.value = false
    }
  } catch (e) {
    errorText.value = (e as { message?: string })?.message || 'Reaktivace selhala'
  } finally {
    saving.value = false
  }
}

function close(): void {
  open.value = false
}

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
    void saveChanges()
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
          <div
            class="d-flex align-center"
            style="gap: 12px;"
          >
            <v-avatar
              size="48"
              :color="formColor"
              variant="flat"
            >
              <v-icon
                size="24"
                color="white"
              >
                mdi-microscope
              </v-icon>
            </v-avatar>
            <div>
              <div class="text-h6">
                Detail přístroje
              </div>
              <div class="text-caption text-medium-emphasis">
                Kód: <strong>{{ device?.code }}</strong>
              </div>
            </div>
          </div>
          <v-spacer />
          <v-chip
            :color="isActive ? 'success' : 'grey'"
            variant="flat"
            size="small"
          >
            {{ isActive ? 'Aktivní' : 'Neaktivní' }}
          </v-chip>
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
              data-device-detail-name
              placeholder="např.Difrakční spektrometr DLS"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              :disabled="saving"
            >
              <template #prepend-inner>
                <v-icon
                  size="18"
                  color="grey-darken-1"
                >
                  mdi-tag-text
                </v-icon>
              </template>
            </v-text-field>
          </div>

          <!-- Color -->
          <div class="form-field">
            <ColorPickerInput
              v-model="formColor"
              label="Barva přístroje"
              placeholder="#3f51b5"
            />
          </div>

          <!-- Device info (read-only) -->
          <v-card
            variant="tonal"
            color="grey-lighten-4"
            class="mt-2"
          >
            <v-card-text class="py-3">
              <div
                class="d-flex align-center"
                style="gap: 16px;"
              >
                <div>
                  <div class="text-caption text-medium-emphasis">
                    ID
                  </div>
                  <div class="text-body-2 font-weight-medium">
                    {{ device?.id }}
                  </div>
                </div>
                <v-divider vertical />
                <div>
                  <div class="text-caption text-medium-emphasis">
                    Kód
                  </div>
                  <div class="text-body-2 font-weight-medium">
                    {{ device?.code }}
                  </div>
                </div>
                <v-divider vertical />
                <div>
                  <div class="text-caption text-medium-emphasis">
                    Barva
                  </div>
                  <div class="d-flex align-center" style="gap: 6px;">
                    <div
                      class="color-swatch-small"
                      :style="{ backgroundColor: formColor }"
                    />
                    <span class="text-body-2 font-weight-medium">{{ formColor }}</span>
                  </div>
                </div>
                <v-divider vertical />
                <div>
                  <div class="text-caption text-medium-emphasis">
                    Stav
                  </div>
                  <div class="text-body-2 font-weight-medium">
                    {{ isActive ? 'Aktivní' : 'Neaktivní' }}
                  </div>
                </div>
              </div>
            </v-card-text>
          </v-card>

          <!-- Preview -->
          <v-card
            v-if="formName || formColor"
            variant="outlined"
            class="mt-3"
          >
            <v-card-title
              class="text-subtitle-2 d-flex align-center"
              style="gap: 8px;"
            >
              <v-icon size="18">
                mdi-eye-outline
              </v-icon>
              Náhled
            </v-card-title>
            <v-card-text>
              <div class="device-preview">
                <v-chip
                  :color="formColor"
                  variant="flat"
                  size="small"
                  class="preview-chip"
                >
                  {{ device?.code }}
                </v-chip>
                <span class="preview-name">{{ formName || 'Název přístroje' }}</span>
              </div>
            </v-card-text>
          </v-card>
        </div>

        <!-- Actions -->
        <v-divider class="my-4" />

        <div
          class="d-flex align-center"
          style="gap: 12px;"
        >
          <!-- Deactivate / Reactivate -->
          <v-btn
            v-if="isActive"
            variant="tonal"
            color="error"
            :loading="saving"
            prepend-icon="mdi-close-circle-outline"
            @click="deactivate"
          >
            Deaktivovat
          </v-btn>
          <v-btn
            v-else
            variant="tonal"
            color="success"
            :loading="saving"
            prepend-icon="mdi-check-circle-outline"
            @click="reactivate"
          >
            Reaktivovat
          </v-btn>

          <v-spacer />

          <v-btn
            variant="text"
            :disabled="saving"
            @click="close"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="! hasChanges || saving"
            :loading="saving"
            prepend-icon="mdi-content-save"
            @click="saveChanges"
          >
            Uložit změny
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
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
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

.color-swatch-small {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
}
</style>
