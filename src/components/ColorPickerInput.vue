<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  modelValue: string
  label?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

// Stav pro otevření/zavření menu
const menuOpen = ref(false)

// Computed property pro obousměrný binding (v-model wrapper)
const internalColor = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})
</script>

<template>
  <div class="color-picker-input">
    <label v-if="label" class="field-label">
      <v-icon size="16" class="mr-1">mdi-palette</v-icon>
      {{ label }}
    </label>

    <v-menu
      v-model="menuOpen"
      :close-on-content-click="false"
      location="bottom start"
    >
      <template v-slot:activator="{ props: menuProps }">
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

      <v-card min-width="300" class="pa-2">
        <v-color-picker
          v-model="internalColor"
          mode="hex"
          show-swatches
          elevation="0"
        ></v-color-picker>
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
</style>
