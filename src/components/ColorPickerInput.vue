<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  label?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

// stav pro otevření nebo zavření menu
const menuOpen = ref(false)

// dočasná barva během výběru (před potvrzením) (temporary color)
const tempColor = ref(props.modelValue)

// původní barva před otevřením výběru barvy (pro možnost zrušení) (original color)
const originalColor = ref(props.modelValue)

// vypočtená vlastnost pro obousměrnou vazbu (v-model wrapper) (computed)
const internalColor = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// při otevření menu uložíme původní barvu
watch(menuOpen, (isOpen) => {
  if (isOpen) {
    originalColor.value = props.modelValue
    tempColor.value = props.modelValue
  }
})

// potvrdit výběr barvy (confirm color)
function confirmColor(): void {
  internalColor.value = tempColor.value
  menuOpen.value = false
}

// zrušit výběr a vrátit původní barvu (cancel color)
function cancelColor(): void {
  tempColor.value = originalColor.value
  menuOpen.value = false
}

// obsluha klávesových zkratek (hotkey handler)
function onKeydown(e: KeyboardEvent): void {
  if (! menuOpen.value) return

  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    confirmColor()
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    cancelColor()
  }
}
</script>

<template>
  <div
    class="color-picker-input"
    @keydown="onKeydown"
  >
    <label
      v-if="label"
      class="field-label"
    >
      <v-icon
        size="16"
        class="mr-1"
      >mdi-palette</v-icon>
      {{ label }}
    </label>

    <v-menu
      v-model="menuOpen"
      :close-on-content-click="false"
      location="top start"
    >
      <template #activator="{ props: menuProps }">
        <v-text-field
          v-model="internalColor"
          :placeholder="placeholder || '#000000'"
          variant="outlined"
          density="comfortable"
          hide-details
          maxlength="9"
          @click:prepend-inner="menuOpen = true"
        >
          <template #prepend-inner>
            <div
              class="color-preview"
              :style="{ backgroundColor: internalColor }"
              v-bind="menuProps"
            />
          </template>
        </v-text-field>
      </template>

      <v-card
        min-width="300"
        class="pa-2"
      >
        <!-- porovnání barev: původní proti nové (vedle sebe) (color comparison) -->
        <div class="color-comparison">
          <div class="comparison-item">
            <span class="comparison-label">Původní</span>
            <div
              class="comparison-swatch"
              :style="{ backgroundColor: originalColor }"
            />
          </div>
          <v-icon
            size="20"
            color="grey"
          >
            mdi-arrow-right
          </v-icon>
          <div class="comparison-item">
            <span class="comparison-label">Nová</span>
            <div
              class="comparison-swatch comparison-swatch-new"
              :style="{ backgroundColor: tempColor }"
            />
          </div>
        </div>

        <v-color-picker
          v-model="tempColor"
          mode="hex"
          show-swatches
          elevation="0"
        />

        <!-- potvrzovací tlačítka (confirm buttons) -->
        <v-divider class="my-2" />
        <div class="d-flex justify-end pa-2 pt-0">
          <v-btn
            variant="text"
            size="small"
            @click="cancelColor"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            size="small"
            class="ml-2"
            @click="confirmColor"
          >
            Potvrdit
          </v-btn>
        </div>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped>
.field-label {
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
  margin-bottom: 4px;
}

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 2px solid rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: transform 0.2s;
  z-index: 1;
}

.color-preview:hover {
  transform: scale(1.1);
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.2);
}

/* porovnání barev: vodorovné uspořádání (horizontal layout) */
.color-comparison {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 12px;
  margin-bottom: 8px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
}

.comparison-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.comparison-swatch {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.comparison-swatch-new {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 2px 12px rgba(var(--v-theme-primary), 0.3);
}

.comparison-label {
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.6);
  font-weight: 500;
}
</style>
