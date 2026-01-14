<script setup lang="ts">
import { type RecordField } from '@/utils/measurement-record-helpers'
import { nextTick } from 'vue'

const props = defineProps<{
  fields: RecordField[]
  typeLabelMap: Record<'float' | 'int' | 'text' | 'file' | 'bool' | 'date', string>
  getTextModel: (f: RecordField) => string | number | null
  getDateModel: (f: RecordField) => string | null
  getTimeModel: (f: RecordField) => string | null
  getFileModel: (f: RecordField) => File | null
  isRequiredEmpty: (f: RecordField) => boolean
  fieldError: (f: RecordField) => string | null
  hasImportedData?: boolean
  currentRecordIndex?: number
}>()

const emits = defineEmits<{
  (e: 'visit', f: RecordField): void
  (e: 'update', f: RecordField, raw: unknown): void
  (e: 'update-time', f: RecordField, time: string): void
  (e: 'touch', f: RecordField): void
  (e: 'open-picker', fieldName: string): void
}>()

// Enter key navigation - focus next field
function focusNextField(currentIdx: number): void {
  nextTick(() => {
    const inputs = document.querySelectorAll('[data-field-input] input, [data-field-input] textarea')
    const nextInput = inputs[currentIdx + 1] as HTMLElement | undefined
    if (nextInput) {
      nextInput.focus()
    }
  })
}
</script>

<template>
  <div class="fields-wrapper">
    <div
      v-for="(field, idx) in props.fields"
      :key="field.name"
      class="field-row"
      :class="{
        'has-error': !!props.fieldError(field),
        'is-required-empty': props.isRequiredEmpty(field)
      }"
    >
      <!-- Label -->
      <label class="field-label">
        {{ field.name }}
        <span class="field-type-badge">{{ props.typeLabelMap[field.type] }}</span>
      </label>

      <!-- Input -->
      <div class="field-input">
        <v-switch
          v-if="field.type === 'bool'"
          :model-value="props.getTextModel(field)"
          color="primary"
          hide-details
          inset
          density="compact"
          data-field-input
          @focus="emits('visit', field)"
          @update:model-value="val => emits('update', field, val)"
          @blur="emits('touch', field)"
        />
        
        <input
          v-else-if="field.type === 'int'"
          :value="props.getTextModel(field)"
          type="text"
          inputmode="numeric"
          placeholder="0"
          class="text-input"
          data-field-input
          @focus="emits('visit', field)"
          @input="e => emits('update', field, (e.target as HTMLInputElement).value)"
          @blur="emits('touch', field)"
          @keydown.enter.prevent="focusNextField(idx)"
        >
        
        <input
          v-else-if="field.type === 'float'"
          :value="props.getTextModel(field)"
          type="text"
          inputmode="decimal"
          placeholder="0.00"
          class="text-input"
          data-field-input
          @focus="emits('visit', field)"
          @input="e => emits('update', field, (e.target as HTMLInputElement).value)"
          @blur="emits('touch', field)"
          @keydown.enter.prevent="focusNextField(idx)"
        >
        
        <div v-else-if="field.type === 'date'" class="date-time-inputs">
          <input
            :value="props.getDateModel(field)"
            type="date"
            class="text-input date-input"
            data-field-input
            @focus="emits('visit', field)"
            @input="e => emits('update', field, (e.target as HTMLInputElement).value)"
            @blur="emits('touch', field)"
          >
          <input
            :value="props.getTimeModel(field)"
            type="time"
            step="1"
            class="text-input time-input"
            data-field-input
            @focus="emits('visit', field)"
            @input="e => emits('update-time', field, (e.target as HTMLInputElement).value)"
            @blur="emits('touch', field)"
          >
        </div>
        
        <v-file-input
          v-else-if="field.type === 'file'"
          :model-value="props.getFileModel(field)"
          density="compact"
          hide-details="auto"
          variant="outlined"
          accept="image/*,.csv,.txt,.pdf"
          show-size
          data-field-input
          @focus="emits('visit', field)"
          @update:model-value="val => emits('update', field, (Array.isArray(val) ? val[0] : val))"
          @blur="emits('touch', field)"
        />
        
        <input
          v-else
          :value="props.getTextModel(field)"
          type="text"
          class="text-input"
          data-field-input
          @focus="emits('visit', field)"
          @input="e => emits('update', field, (e.target as HTMLInputElement).value)"
          @blur="emits('touch', field)"
          @keydown.enter.prevent="focusNextField(idx)"
        >
      </div>

      <!-- Pick from grid button -->
      <div class="field-action">
        <button
          v-if="props.hasImportedData"
          type="button"
          class="pick-btn"
          title="Vybrat z importovaných dat"
          @click="emits('open-picker', field.name)"
        >
          <v-icon size="18">mdi-table-arrow-left</v-icon>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fields-wrapper {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  align-items: stretch;
  border-bottom: 1px solid #f1f5f9;
}

.field-row:last-child {
  border-bottom: none;
}

.field-row.is-required-empty {
  background: #fffdf8;
}

.field-row.has-error {
  background: #fef2f2;
}

.field-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 14px 16px;
  background: #f8fafc;
  display: flex;
  align-items: center;
  gap: 6px;
  border-right: 1px solid #f1f5f9;
}

.field-type-badge {
  font-size: 0.625rem;
  color: #ffffff;
  font-weight: 400;
  background: #1976d2;
  padding: 2px 6px;
  border-radius: 8px;
  text-transform: none;
}

.field-input {
  padding: 14px 16px;
  display: flex;
  align-items: center;
}

.text-input {
  flex: 1;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 0.875rem;
  color: #1e293b;
  background: white;
  transition: border-color 0.15s ease;
}

.text-input:focus {
  outline: none;
  border-color: #1976d2;
}

.text-input::placeholder {
  color: #94a3b8;
}

.date-time-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.date-input {
  flex: 1;
}

.time-input {
  width: 120px;
}

.field-action {
  padding: 14px 8px;
  display: flex;
  align-items: center;
}

.pick-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: #64748b;
  opacity: 0.5;
  transition: all 0.15s ease;
}

.field-row:hover .pick-btn {
  opacity: 1;
}

.pick-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}
</style>
