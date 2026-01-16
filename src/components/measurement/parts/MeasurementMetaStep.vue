<script setup lang="ts">
import { ref, watch } from 'vue'
import DeviceSelect from '@/components/device/DeviceSelect.vue'
import TemplateSelect from '@/components/measurement/TemplateSelect.vue'
import { type TemplateItem } from '@/types/measurement-ui'

type DeviceOption = { code?: string; id?: string | number; name: string; color?: string | null }

const props = defineProps<{
  devices: DeviceOption[]
  selectedDeviceId: string
  templates: TemplateItem[]
  selectedTemplateId: string | null
  showHelp: boolean
}>()
const emits = defineEmits<{
  (e: 'update:selectedDeviceId', v: string): void
  (e: 'update:selectedTemplateId', v: string | null): void
  (e: 'createDevice'): void
  (e: 'createTemplate', deviceCode: string): void
  (e: 'createTemplateFromClipboard', deviceCode: string): void
  (e: 'deriveTemplate', templateId: string): void
}>()

// Highlight device card when user tries to interact with template without device selected
const deviceCardHighlight = ref(false)
let highlightTimeout: ReturnType<typeof setTimeout> | null = null

function triggerDeviceHighlight(): void {
  if (props.selectedDeviceId) return // Already has device selected
  deviceCardHighlight.value = true
  if (highlightTimeout) clearTimeout(highlightTimeout)
  highlightTimeout = setTimeout(() => {
    deviceCardHighlight.value = false
  }, 2500)
}

// Clear highlight when device is selected
watch(() => props.selectedDeviceId, (newVal) => {
  if (newVal) {
    deviceCardHighlight.value = false
    if (highlightTimeout) clearTimeout(highlightTimeout)
  }
})

function updateDevice(v: string | null): void {
  const newDev = v ?? ''
  emits('update:selectedDeviceId', newDev)
  // Clear template if it doesn't belong to the selected device
  if (props.selectedTemplateId) {
    const tpl = props.templates.find(t => t.id === props.selectedTemplateId)
    if (tpl && tpl.deviceId !== newDev) {
      emits('update:selectedTemplateId', null)
    }
  }
}

function updateTemplate(v: unknown): void {
  emits('update:selectedTemplateId', (typeof v === 'string' || v === null) ? (v as string | null) : null)
}

// Filter templates strictly by selected device - now handled by TemplateSelect
</script>

<template>
  <div class="d-flex flex-column" style="gap: 24px; max-width: 800px; margin: 0 auto;">
    <!-- Device Selection -->
    <div class="meta-group">
      <div class="d-flex align-center justify-space-between mb-3 px-1">
         <div class="d-flex align-center" style="gap: 8px;">
            <v-icon color="primary" class="opacity-80">mdi-monitor-dashboard</v-icon>
            <span class="text-subtitle-1 font-weight-medium text-high-emphasis">Výběr přístroje</span>
         </div>
      </div>

      <div
        class="selection-area"
        :class="{ 'highlight-pulse': deviceCardHighlight }"
        @click.capture="triggerDeviceHighlight"
      >
        <DeviceSelect
          :items="props.devices"
          :model-value="props.selectedDeviceId || null"
          value-key="code"
          label="Měřicí přístroj"
          variant="outlined"
          bg-color="white"
          hide-details="auto"
          @update:model-value="updateDevice"
          @create-device="$emit('createDevice')"
        />
      </div>
    </div>

    <!-- Template Selection -->
    <div class="meta-group" :class="{ 'opacity-50': !props.selectedDeviceId }">
       <div class="d-flex align-center justify-space-between mb-3 px-1">
         <div class="d-flex align-center" style="gap: 8px;">
            <v-icon color="secondary" class="opacity-80">mdi-file-document-multiple-outline</v-icon>
            <span class="text-subtitle-1 font-weight-medium text-high-emphasis">Šablona měření</span>
         </div>
         <!-- Keep only the Derive button -->
<!--         <v-btn
           v-if="props.selectedTemplateId"
           size="small"
           variant="tonal"
           color="secondary"
           class="px-2"
           @click="$emit('deriveTemplate', props.selectedTemplateId!)"
         >
           Odvodit novou z této šablony
         </v-btn>-->
      </div>

      <TemplateSelect
        :model-value="props.selectedTemplateId"
        :items="props.templates"
        :device-id="props.selectedDeviceId"
        placeholder="Vyberte šablonu..."
        variant="outlined"
        bg-color="white"
        hide-details="auto"
        :disabled="!props.selectedDeviceId"
        @update:model-value="updateTemplate"
        @create-template="$emit('createTemplate', props.selectedDeviceId)"
      />
    </div>

    <!-- Help / Context -->
    <div v-if="!props.selectedDeviceId" class="d-flex align-center justify-center py-4 text-medium-emphasis">
      <v-icon size="small" start>mdi-information-outline</v-icon>
      <span class="text-caption">Tato volba určí dostupné šablony a strukturu dat.</span>
    </div>
  </div>
</template>

<style scoped>
.selection-area {
  transition: all 0.3s ease;
  border-radius: 8px;
}

.highlight-pulse {
  animation: pulseWarning 0.8s ease-in-out;
  box-shadow: 0 0 0 4px rgba(var(--v-theme-error), 0.2);
}

@keyframes pulseWarning {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--v-theme-error), 0.0); }
  50% { box-shadow: 0 0 0 6px rgba(var(--v-theme-error), 0.25); }
}

.meta-group {
  transition: opacity 0.3s ease;
}
.opacity-50 {
  opacity: 0.5;
}
.opacity-80 {
  opacity: 0.8;
}
</style>

