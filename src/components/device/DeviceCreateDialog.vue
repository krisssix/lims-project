<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useDeviceStore } from '@/stores/devices'
import ColorPickerInput from '@/components/ColorPickerInput.vue'

const props = defineProps<{
  modelValue:boolean
}>()

const emit = defineEmits<{
  'update:modelValue':[value:boolean]
  'created': [device:{ id:number; code:string; name:string; color?:string | null; active: boolean }]
}>()

const store = useDeviceStore()

const codeInputRef = ref<HTMLInputElement | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)

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

const isDuplicateCode = computed(() => {
  if (!normalizedCode.value) return false
  return store.allDevices.some(d => d.code === normalizedCode.value)
})

const isValid = computed(() =>
  /^[A-Z0-9_]{3,}$/.test(normalizedCode.value) &&
  formName.value.trim().length >= 3 &&
  !isDuplicateCode.value
)

const codeError = computed(() => {
  if (!touched.value || !formCode.value) return false
  if (normalizedCode.value.length < 3) return true
  if (!/^[A-Z0-9_]+$/.test(normalizedCode.value)) return true
  if (isDuplicateCode.value) return true
  return false
})

const codeErrorMessage = computed(() => {
  if (!codeError.value) return ''
  if (normalizedCode.value.length < 3) return 'minimálně 3 znaky'
  if (!/^[A-Z0-9_]+$/.test(normalizedCode.value)) return 'pouze A-Z, 0-9 a _'
  if (isDuplicateCode.value) return 'Tento kód je již obsazen'
  return ''
})

const nameError = computed(() => {
  if (!touched.value || !formName.value) return false
  if (formName.value.trim().length < 3) return true
  return false
})

const codeIsValid = computed(() =>
  touched.value && 
  normalizedCode.value.length >= 3 && 
  /^[A-Z0-9_]+$/.test(normalizedCode.value) &&
  !isDuplicateCode.value
)

const nameIsValid = computed(() =>
  touched.value && formName.value.trim().length >= 3
)

function reset():void {
  formCode.value = ''
  formName.value = ''
  formColor.value = '#3f51b5'
  active.value = true
  errorText.value = null
  touched.value = false
}

async function save():Promise<void> {
  touched.value = true

  if (!isValid.value) {
    if (codeError.value) {
      nextTick(() => codeInputRef.value?.focus())
    } else if (nameError.value) {
      nextTick(() => nameInputRef.value?.focus())
    }
    return
  }

  if (saving.value) return

  saving.value = true
  errorText.value = null

  try {
    const dev = await store.createDevice({
      code:normalizedCode.value,
      name:formName.value.trim(),
      color:formColor.value.trim(),
      active:active.value
    })
    if (! dev) throw new Error('Server nevrátil přístroj')
    emit('created', dev)
    emit('update:modelValue', false)
  } catch (e:unknown) {
    errorText.value = (e as { message?:string })?.message || 'Vytvoření selhalo'
  } finally {
    saving.value = false
  }
}

function close():void {
  emit('update:modelValue', false)
}

// reset formuláře při otevření dialogu (reset form)
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    reset()
    nextTick(() => codeInputRef.value?.focus())
  }
})

// klávesové zkratky (keyboard shortcuts)
function onKeydown(e:KeyboardEvent):void {
  if (!props.modelValue) return

  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (! saving.value) save()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// automatické označení jako "touched", když uživatel začne psát (auto-mark touched)
watch(formCode, () => {
  if (formCode.value && !touched.value) touched.value = true
})

watch(formName, () => {
  if (formName.value && !touched.value) touched.value = true
})
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="v => emit('update:modelValue', v)"
    max-width="560px"
    :persistent="false"
  >
    <div class="device-editor-card">

      <!-- záhlaví (header) -->
      <div class="device-header">
        <div class="header-row">
          <div class="header-left">
            <div class="header-icon">
              <v-icon size="24" color="white">mdi-devices</v-icon>
            </div>
            <div class="header-text">
              <div class="header-title">Vytvořit nový přístroj</div>
              <div class="header-subtitle">
                <v-icon size="14" class="mr-1">mdi-plus-circle-outline</v-icon>
                Přidejte nový měřicí přístroj do systému
              </div>
            </div>
          </div>
          <button type="button" class="close-btn" @click="close">
            <v-icon size="18">mdi-close</v-icon>
          </button>
        </div>
      </div>

      <!-- obsah formuláře (form content) -->
      <div class="device-content">

        <!-- upozornění na chybu (error alert) -->
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

        <!-- kód přístroje (device code) -->
        <div class="form-group">
          <label class="form-label" :class="{ 'label-error':codeError }">
            Kód přístroje
            <span v-if="codeError" class="label-error-text">: {{ codeErrorMessage }}</span>
          </label>
          <div class="input-wrapper">
            <v-icon size="18" class="input-icon" :class="{ 'icon-error':codeError, 'icon-success':codeIsValid }">
              {{ codeIsValid ? 'mdi-check-circle' :'mdi-code-tags' }}
            </v-icon>
            <input
              ref="codeInputRef"
              v-model="formCode"
              type="text"
              placeholder="např.DLS_01, SPEKTRO_A"
              class="custom-input"
              :class="{ 'input-error':codeError, 'input-success':codeIsValid }"
            >
          </div>
          <div class="field-hint">
            <v-icon size="14" class="mr-1">mdi-information-outline</v-icon>
            Min. 3 znaky (A-Z, 0-9, _) : automaticky převedeno na UPPERCASE
          </div>
        </div>

        <!-- název přístroje (device name) -->
        <div class="form-group">
          <label class="form-label" :class="{ 'label-error':nameError }">
            Název přístroje
            <span v-if="nameError" class="label-error-text">: minimálně 3 znaky</span>
          </label>
          <div class="input-wrapper">
            <v-icon size="18" class="input-icon" :class="{ 'icon-error':nameError, 'icon-success':nameIsValid }">
              {{ nameIsValid ?  'mdi-check-circle' :'mdi-tag-text' }}
            </v-icon>
            <input
              ref="nameInputRef"
              v-model="formName"
              type="text"
              placeholder="např.Difrakční spektrometr DLS"
              class="custom-input"
              :class="{ 'input-error':nameError, 'input-success':nameIsValid }"
            >
          </div>
          <div class="field-hint">
            <v-icon size="14" class="mr-1">mdi-information-outline</v-icon>
            Popisný název přístroje (min.3 znaky)
          </div>
        </div>

        <!-- barva a stav (color & status) -->
        <div class="form-row-2">

          <!-- barva (color) -->
          <div class="form-group">
            <label class="form-label">
              <v-icon size="16" class="mr-1">mdi-palette</v-icon>
              Barva
            </label>
            <ColorPickerInput
              v-model="formColor"
              placeholder="#3f51b5"
            />
          </div>

          <!-- stav (status) -->
          <div class="form-group">
            <label class="form-label">
              <v-icon size="16" class="mr-1">mdi-power</v-icon>
              Stav
            </label>
            <div class="status-toggle">
              <button
                type="button"
                class="status-btn"
                :class="{ active:active }"
                @click="active = !active"
              >
                <v-icon size="18" :color="active ? '#22c55e' :'#9ca3af'">
                  {{ active ? 'mdi-check-circle' :'mdi-circle-outline' }}
                </v-icon>
                <span>{{ active ? 'Aktivní' :'Neaktivní' }}</span>
              </button>
            </div>
          </div>

        </div>

        <!-- náhled (preview) -->
        <v-expand-transition>
          <div v-if="normalizedCode || formName" class="preview-section">
            <div class="preview-header">
              <v-icon size="16" class="mr-1">mdi-eye-outline</v-icon>
              <span>Náhled přístroje</span>
            </div>
            <div class="preview-content">
              <div
                class="preview-badge"
                :style="{ background:formColor || '#3f51b5' }"
              >
                {{ normalizedCode || 'KÓD' }}
              </div>
              <span class="preview-name">{{ formName || 'Název přístroje' }}</span>
              <div
                class="preview-status"
                :class="{ 'status-active':active, 'status-inactive':!active }"
              >
                <v-icon size="12">{{ active ? 'mdi-check-circle' :'mdi-circle-outline' }}</v-icon>
                {{ active ? 'Aktivní' :'Neaktivní' }}
              </div>
            </div>
          </div>
        </v-expand-transition>

      </div>

      <!-- patička (footer) -->
      <div class="device-footer">
        <div style="flex:1;"></div>

        <button type="button" class="footer-btn secondary" @click="close">
          Zrušit
        </button>

        <button
          type="button"
          class="footer-btn primary"
          :disabled="saving || !isValid"
          @click="save"
        >
          <v-progress-circular v-if="saving" indeterminate size="16" width="2" color="white" class="mr-2" />
          <v-icon v-else size="18">mdi-check</v-icon>
          Vytvořit přístroj
        </button>
      </div>

    </div>
  </v-dialog>
</template>

<style scoped>
/* karta (card) */
.device-editor-card {
  border-radius:16px;
  overflow:hidden;
  background:#ffffff;
  box-shadow:0 12px 40px rgba(0, 0, 0, 0.15);
}

/* záhlaví (header) */
.device-header {
  background:linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  padding:20px 24px;
  color:white;
}

.header-row {
  display:flex;
  align-items:center;
  justify-content:space-between;
}

.header-left {
  display:flex;
  align-items:center;
  gap:12px;
}

.header-icon {
  width:44px;
  height:44px;
  background:rgba(255, 255, 255, 0.2);
  border-radius:12px;
  display:flex;
  align-items:center;
  justify-content:center;
}

.header-text {
  display:flex;
  flex-direction:column;
}

.header-title {
  font-size:18px;
  font-weight: 600;
}

.header-subtitle {
  font-size:13px;
  opacity:0.9;
  display:flex;
  align-items:center;
  margin-top:2px;
}

.close-btn {
  width:32px;
  height:32px;
  border:none;
  border-radius:8px;
  background:rgba(255, 255, 255, 0.15);
  color:white;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  transition:background 0.15s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* obsah (content) */
.device-content {
  padding:20px 24px;
}

.form-group {
  margin-bottom:16px;
}

.form-label {
  display:flex;
  align-items:center;
  font-size:12px;
  font-weight:600;
  color:#6b7280;
  text-transform:uppercase;
  letter-spacing:0.5px;
  margin-bottom:6px;
}

.label-optional {
  font-weight:400;
  color: #9ca3af;
  text-transform:none;
}

/* vstupy (inputs) */
.input-wrapper {
  position:relative;
}

.input-icon {
  position:absolute;
  left:12px;
  top:50%;
  transform: translateY(-50%);
  color:#9ca3af;
  pointer-events:none;
  transition:color 0.15s;
}

.icon-success {
  color:#22c55e ! important;
}

.custom-input {
  width:100%;
  height:44px;
  padding:0 12px 0 40px;
  border:1px solid #e5e7eb;
  border-radius:10px;
  font-size: 14px;
  background:#f9fafb;
  color:#374151;
  outline:none;
  transition:all 0.15s;
}

.custom-input:focus {
  border-color:#1976d2;
  background:white;
  box-shadow:0 0 0 3px rgba(25, 118, 210, 0.1);
}

.input-success {
  border-color:#22c55e ! important;
  background:#f0fdf4 !important;
}

.input-success:focus {
  box-shadow:0 0 0 3px rgba(34, 197, 94, 0.1) !important;
}

/* nápověda pole (field hint) */
.field-hint {
  display:flex;
  align-items:center;
  font-size:11px;
  color:#9ca3af;
  margin-top:4px;
}

/* dvou sloupcové rozložení (two column layout) */
.form-row-2 {
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
  margin-bottom:16px;
}

/* přepínač stavu (status toggle) */
.status-toggle {
  height:44px;
  display:flex;
  align-items:center;
}

.status-btn {
  width:100%;
  height:44px;
  padding:0 14px;
  border:1px solid #e5e7eb;
  border-radius:10px;
  background:#f9fafb;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:8px;
  font-size:14px;
  font-weight:500;
  color:#374151;
  transition:all 0.15s;
}

.status-btn:hover {
  border-color:#d1d5db;
  background:#f3f4f6;
}

.status-btn.active {
  border-color:#22c55e;
  background: #f0fdf4;
  color:#16a34a;
}

/* sekce náhledu (preview section) */
.preview-section {
  margin-top:16px;
  padding:12px;
  background:#f9fafb;
  border: 1px solid #e5e7eb;
  border-radius:12px;
}

.preview-header {
  display:flex;
  align-items:center;
  font-size:12px;
  font-weight: 600;
  color:#6b7280;
  text-transform:uppercase;
  letter-spacing:0.5px;
  margin-bottom:10px;
}

.preview-content {
  display:flex;
  align-items:center;
  gap:10px;
  padding:10px;
  background:white;
  border-radius:8px;
  border:1px solid #e5e7eb;
}

.preview-badge {
  padding:6px 12px;
  border-radius:6px;
  color:white;
  font-size:11px;
  font-weight: 700;
  letter-spacing:0.5px;
}

.preview-name {
  flex:1;
  font-size:14px;
  font-weight:500;
  color:#374151;
}

.preview-status {
  display:flex;
  align-items:center;
  gap:4px;
  padding:4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:0.5px;
}

.status-active {
  background:#dcfce7;
  color: #16a34a;
}

.status-inactive {
  background:#f3f4f6;
  color:#6b7280;
}

/* patička (footer) */
.device-footer {
  padding: 16px 24px;
  background:#f9fafb;
  border-top:1px solid #e5e7eb;
  display:flex;
  align-items:center;
  gap: 12px;
}

.footer-btn {
  height:40px;
  padding:0 20px;
  border:none;
  border-radius:8px;
  font-size:14px;
  font-weight:500;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:8px;
  transition:all 0.15s;
}

.footer-btn.secondary {
  background:#e5e7eb;
  color:#6b7280;
}

.footer-btn.secondary:hover {
  background:#d1d5db;
}

.footer-btn.primary {
  background:#1976d2;
  color: white;
  font-weight:600;
  box-shadow:0 4px 12px rgba(25, 118, 210, 0.4);
}

.footer-btn.primary:hover:not(:disabled) {
  transform:translateY(-1px);
  box-shadow:0 6px 16px rgba(25, 118, 210, 0.5);
}

.footer-btn.primary:disabled {
  opacity:0.5;
  cursor:not-allowed;
  transform:none ! important;
  box-shadow:0 4px 12px rgba(25, 118, 210, 0.2);
}

/* chybové stavy (error states) */
.label-error {
  color:#dc2626;
}

.label-error-text {
  font-weight:400;
  color:#dc2626;
  text-transform:none;
  margin-left:4px;
}

.icon-error {
  color:#dc2626 !important;
}

.input-error {
  border-color:#dc2626 !important;
  background:#fef2f2 !important;
}

.input-error:focus {
  box-shadow:0 0 0 3px rgba(220, 38, 38, 0.15) !important;
}

/* responzivita (responsive) */
@media (max-width:600px) {
  .form-row-2 {
    grid-template-columns:1fr;
  }

  .device-header {
    padding:16px 20px;
  }

  .device-content {
    padding:16px 20px;
  }

  .device-footer {
    padding:12px 20px;
  }

  .header-title {
    font-size:16px;
  }

  .header-subtitle {
    font-size:12px;
  }
}
</style>
