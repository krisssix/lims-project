<script setup lang="ts">
import { defineProps, defineEmits, ref, watch } from 'vue'

// modelValue
const props = defineProps<{
  modelValue: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()

// local copy
const localValue = ref(props.modelValue)

watch(localValue, (newVal) => {
  emit('update:modelValue', newVal)
})
</script>

<template>
  <v-form>
    <v-text-field
      v-model="localValue"
      label="Hodnota měření"
      type="number"
      variant="outlined"
      hide-details
      dense
      class="mb-4"
    />
  </v-form>
</template>
