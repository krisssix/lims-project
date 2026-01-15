<script setup lang="ts">
import { computed } from 'vue'
import { type MeasurementRecord } from '@/utils/measurement-record-helpers'

const props = defineProps<{
  records: MeasurementRecord[]
  currentRecordIndex: number
  selectedRecordIndexes: Set<number>
  canDuplicate: boolean
}>()

const emits = defineEmits<{
  (e: 'add'): void
  (e: 'duplicate'): void
  (e: 'delete'): void
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'toggle', idx: number, multi: boolean): void
  (e: 'paste-current'): void
  (e: 'paste-multiple'): void
  (e: 'open-grid-picker'): void
  (e: 'select', idx: number): void
}>()

// Computed properties
const currentPosition = computed(() => {
  const idx = props.records.findIndex(r => r.recordIndex === props.currentRecordIndex)
  return idx + 1
})

const canGoPrev = computed(() => currentPosition.value > 1)
const canGoNext = computed(() => currentPosition.value < props.records.length)
const canDelete = computed(() => props.records.length > 1)
</script>

<template>
  <!-- Empty state -->
  <div v-if="props.records.length === 0" class="empty-state">
    <v-icon size="48" color="grey-lighten-1" class="mb-3">mdi-file-document-plus-outline</v-icon>
    <p class="empty-text">Žádné záznamy</p>
    <button type="button" class="add-first-btn" @click="emits('add')">
      <v-icon size="16">mdi-plus</v-icon>
      Vytvořit první záznam
    </button>
  </div>

  <!-- Normal toolbar when records exist -->
  <div v-else class="records-toolbar">
    <!-- Left: Section title with icon -->
    <div class="toolbar-section-header">
      <div class="section-icon">
        <v-icon size="15" color="primary">mdi-table</v-icon>
      </div>
      <span class="section-title">Hodnoty záznamu</span>
    </div>

    <div class="toolbar-spacer"></div>

    <!-- Center: Navigation -->
    <div class="toolbar-nav">
      <button
        type="button"
        class="nav-btn"
        :disabled="!canGoPrev"
        @click="emits('prev')"
      >
        <v-icon size="20">mdi-chevron-left</v-icon>
      </button>

      <div class="record-counter">
        <span class="record-label">{{ currentPosition }} / {{ props.records.length }}</span>
      </div>

      <button
        type="button"
        class="nav-btn"
        :disabled="!canGoNext"
        @click="emits('next')"
      >
        <v-icon size="20">mdi-chevron-right</v-icon>
      </button>
    </div>

    <!-- Right: Actions -->
    <div class="toolbar-actions">
      <!-- Grid Picker Button -->
<!--      <v-tooltip location="top" text="Vybrat hodnoty z nahrané tabulky">
        <template #activator="{ props }">
          <button
            v-bind="props"
            type="button"
            class="action-btn tonal"
            @click="emits('open-grid-picker')"
          >
            <v-icon size="16">mdi-table-search</v-icon>
            <span class="d-none d-sm-inline">Z tabulky</span>
          </button>
        </template>
      </v-tooltip>-->

      <!-- Paste Menu -->
      <v-menu location="bottom end">
        <template #activator="{ props }">
<!--          <button
            v-bind="props"
            type="button"
            class="action-btn tonal"
          >
            <v-icon size="16">mdi-clipboard-text-outline</v-icon>
            <span class="d-none d-sm-inline">Vložit</span>
            <v-icon size="14">mdi-chevron-down</v-icon>
          </button>-->
        </template>
        <v-list density="compact">
          <v-list-item @click="emits('paste-current')">
            <template #prepend><v-icon size="small">mdi-content-paste</v-icon></template>
            <v-list-item-title>Vložit do aktuálního záznamu</v-list-item-title>
          </v-list-item>
          <v-list-item @click="emits('paste-multiple')">
            <template #prepend><v-icon size="small">mdi-table-row-plus-after</v-icon></template>
            <v-list-item-title>Vložit jako nové záznamy</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <div class="toolbar-divider"></div>

      <button
        type="button"
        class="action-btn tonal"
        :disabled="!props.canDuplicate"
        @click="emits('duplicate')"
      >
        <v-icon size="16">mdi-content-duplicate</v-icon>
        <span class="d-none d-md-inline">Duplikovat</span>
      </button>

      <button
        type="button"
        class="action-btn tonal-error"
        :disabled="!canDelete"
        @click="emits('delete')"
      >
        <v-icon size="16">mdi-delete-outline</v-icon>
        <span class="d-none d-md-inline">Smazat</span>
      </button>

      <div class="toolbar-divider"></div>

      <button
        type="button"
        class="action-btn primary"
        @click="emits('add')"
      >
        <v-icon size="16">mdi-plus</v-icon>
        Přidat záznam
      </button>
    </div>
  </div>
</template>

<style scoped>
.records-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}

.toolbar-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #e3f2fd;
  border-radius: 6px;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 16px;
}

.nav-btn {
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
  transition: background 0.15s ease;
}

.nav-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.04);
}

.nav-btn:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}

.record-counter {
  display: flex;
  align-items: center;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 12px;
  min-width: 60px;
  justify-content: center;
}

.record-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.action-btn.tonal {
  background: #f1f5f9;
  color: #64748b;
}

.action-btn.tonal:hover:not(:disabled) {
  background: #e2e8f0;
}

.action-btn.tonal-error {
  background: #fef2f2;
  color: #ef4444;
}

.action-btn.tonal-error:hover:not(:disabled) {
  background: #fee2e2;
}

.action-btn.primary {
  background: #1976d2;
  color: white;
}

.action-btn.primary:hover {
  background: #1565c0;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: #e2e8f0;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 12px;
  border: 2px dashed #e2e8f0;
}

.empty-text {
  font-size: 1rem;
  color: #64748b;
  margin-bottom: 16px;
}

.add-first-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.add-first-btn:hover {
  background: #1565c0;
}
</style>
