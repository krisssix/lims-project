<script setup lang="ts">
/**
 * Modern premium toggle switch component
 * Unifies the look of feature toggles across the application.
 */
defineProps<{
  modelValue: boolean
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()
</script>

<template>
  <div
    class="modern-toggle-wrapper"
    :class="{ 'is-disabled': disabled }"
  >
    <label class="modern-toggle">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        @change="!disabled && emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      >
      <span class="toggle-slider" />
    </label>
    <span 
      v-if="label" 
      class="toggle-label"
      @click="!disabled && emit('update:modelValue', !modelValue)"
    >
      {{ label }}
    </span>
  </div>
</template>

<style scoped>
.modern-toggle-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modern-toggle-wrapper.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modern-toggle-wrapper.is-disabled .modern-toggle,
.modern-toggle-wrapper.is-disabled .toggle-label {
  cursor: not-allowed;
  pointer-events: none;
}

.modern-toggle {
  position: relative;
  width: 48px;
  height: 26px;
  display: inline-block;
  cursor: pointer;
  user-select: none;
}

.modern-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #e2e8f0;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 26px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 0;
  top: 3px;
  background-color: white;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

input:checked + .toggle-slider {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

input:checked + .toggle-slider:before {
  transform: translateX(22px);
}

.modern-toggle:hover .toggle-slider {
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
}

.modern-toggle-wrapper.is-disabled .modern-toggle:hover .toggle-slider {
  box-shadow: none;
}

.toggle-label {
  font-size: 13px;
  color: #495057;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.2s;
}

input:checked ~ .toggle-label {
  color: #1f2937;
  font-weight: 600;
}
</style>
