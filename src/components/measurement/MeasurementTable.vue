<script setup lang="ts">
import { computed } from 'vue'
import { type DeviceItem } from '@/types/measurement-ui'
type TableHeader = { title: string; key: string; width?: number; align?: 'start'|'center'|'end'; sortable?: boolean }
type TableRow = {
  id: number
  type: string
  device: string
  user?: string
  date: string | number
  count: number
  note?: string | null
  _raw?: unknown
}
const props = defineProps<{
  headers: TableHeader[]
  items: TableRow[]
  devicesById: Map<string, DeviceItem>
}>()
const emits = defineEmits<{
  (e: 'row-click', id: number): void
  (e: 'create-measurement'): void
}>()
function onRowClick(_ev: MouseEvent, payload: { item: TableRow }) {
  if (!payload?.item) return
  const id = payload.item.id
  if (Number.isFinite(id)) emits('row-click', id)
}
function initials(u?: string | null): string {
  const s = (u ?? '').trim()
  return s.length ? s[0]!.toUpperCase() : '—'
}
const hasNotes = computed<boolean>(() =>
  props.items.some(i => typeof i.note === 'string' && i.note.trim().length > 0)
)
// Helper: získat barvu zařízení s fallback
function deviceColor(deviceId: string): string {
  return props.devicesById.get(deviceId)?.color || '#9E9E9E'
}
// Helper: formátovat datum čitelněji
function formatDate(dateInput: string | number): { date: string; time: string } {
  try {
    // Convert to timestamp if string
    const ms = typeof dateInput === 'number'
      ? dateInput
      : Date.parse(dateInput)
    if (Number.isNaN(ms)) {
      return { date: String(dateInput), time: '' }
    }
    const d = new Date(ms)
    const date = d.toLocaleDateString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
    const time = d.toLocaleTimeString('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit'
    })
    return { date, time }
  } catch {
    return { date: String(dateInput), time: '' }
  }
}
</script>
<template>
  <div class="measurement-table-wrapper">
    <v-data-table
      :headers="props.headers"
      :items="props.items"
      :items-per-page="15"
      class="modern-table elevation-0"
      density="comfortable"
      hover
      :show-expand="hasNotes"
      :expand-on-click="false"
      @click:row="onRowClick"
    >
      <!-- Type column - clean text with subtle badge -->
      <template #[`item.type`]="{ item }">
        <div class="type-cell">
          <span class="type-label">{{ item.type }}</span>
        </div>
      </template>
      <!-- Device - minimal pill design -->
      <template #[`item.device`]="{ item }">
        <div
          class="device-pill"
          :style="{ '--device-color': deviceColor(item.device) }"
        >
          {{ item.device || '—' }}
        </div>
      </template>
      <!-- User - clean avatar + name -->
      <template #[`item.user`]="{ item }">
        <div class="user-cell">
          <div class="user-avatar">
            {{ initials(item.user) }}
          </div>
          <span class="user-name">{{ item.user || '—' }}</span>
        </div>
      </template>
      <!-- Date - split date and time for better readability -->
      <template #[`item.date`]="{ item }">
        <div class="date-cell">
          <span class="date-primary">{{ formatDate(item.date).date }}</span>
          <span class="date-secondary">{{ formatDate(item.date).time }}</span>
        </div>
      </template>
      <!-- Count - minimal number badge -->
      <template #[`item.count`]="{ item }">
        <div class="count-badge">
          {{ item.count }}
        </div>
      </template>
      <!-- Expanded note row -->
      <template #expanded-row="{ columns, item }">
        <tr class="expanded-note-row">
          <td
            :colspan="columns.length"
            class="note-cell"
          >
            <div
              v-if="item.note && item.note.trim().length"
              class="note-content"
            >
              <div class="note-icon">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line
                    x1="16"
                    y1="13"
                    x2="8"
                    y2="13"
                  />
                  <line
                    x1="16"
                    y1="17"
                    x2="8"
                    y2="17"
                  />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <p class="note-text">
                {{ item.note }}
              </p>
            </div>
            <div
              v-else
              class="note-empty"
            >
              Žádná poznámka
            </div>
          </td>
        </tr>
      </template>
      <!-- Empty state -->
      <template #no-data>
        <div class="empty-state">
          <div class="empty-icon">
            <v-icon
              size="48"
              color="grey-lighten-1"
            >
              mdi-flask-empty-outline
            </v-icon>
          </div>
          <p class="empty-text">
            Žádná měření pro zadané filtry.
          </p>
          <p class="empty-hint">
            <strong>TIP:</strong> Zkuste upravit filtry nebo vytvořte nové měření.
          </p>
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-plus"
            class="mt-4"
            @click="emits('create-measurement')"
          >
            Vytvořit měření
          </v-btn>
        </div>
      </template>
      <!-- Custom expand toggle -->
      <template #[`item.data-table-expand`]="{ item, internalItem, toggleExpand, isExpanded }">
        <button
          v-if="item.note && item.note. trim().length"
          class="expand-button"
          :class="{ 'expand-button-active': isExpanded(internalItem) }"
          :aria-label="isExpanded(internalItem) ? 'Skrýt poznámku' : 'Zobrazit poznámku'"
          @click.stop="toggleExpand(internalItem)"
        >
          <v-icon size="16">
            mdi-chevron-down
          </v-icon>
        </button>
      </template>
    </v-data-table>
  </div>
</template>

<style scoped>
/* ========== Wrapper & Base Table ========== */
.measurement-table-wrapper {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: #ffffff;
}
.modern-table {
  background: transparent;
}
/* Clean header styling */
.modern-table :deep(thead) {
  background: #fafafa;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.modern-table :deep(th) {
  font-size: 0.75rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.03em !important;
  text-transform: uppercase !important;
  color: rgba(0, 0, 0, 0.6) !important;
  padding: 12px 16px !important;
  border: none !important;
}
/* Row styling */
.modern-table :deep(tbody tr) {
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.modern-table :deep(tbody tr:hover) {
  background: rgba(0, 0, 0, 0.02) !important;
}
.modern-table :deep(tbody tr:last-child) {
  border-bottom: none;
}
.modern-table :deep(td) {
  padding: 14px 16px !important;
  border: none !important;
  color: rgba(0, 0, 0, 0.87);
}
/* ========== Type Cell ========== */
.type-cell {
  display: flex;
  align-items: center;
}
.type-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.87);
}
/* ========== Device Pill ========== */
.device-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
  background: var(--device-color, #2688e8);
  color: white;
  letter-spacing: 0.02em;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
/* ========== User Cell ========== */
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}
.user-name {
  font-size: 0.875rem;
  color: rgba(0, 0, 0, 0.87);
  font-weight: 500;
}
/* ========== Date Cell ========== */
.date-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.date-primary {
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.87);
}
.date-secondary {
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.5);
}
/* ========== Count Badge ========== */
.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 24px;
  padding: 0 8px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.04);
  font-size: 0.8125rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.7);
}
/* ========== Expand Button ========== */
.expand-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: rgba(0, 0, 0, 0.4);
}
.expand-button:hover {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.7);
}
.expand-button svg {
  transition: transform 0.2s ease;
}
.expand-button-active svg {
  transform: rotate(180deg);
}
/* ========== Expanded Note Row ========== */
.expanded-note-row {
  background: #fafafa !important;
}
.note-cell {
  padding: 16px 20px !important;
}
.note-content {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.note-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.5);
  flex-shrink: 0;
}
.note-text {
  margin: 0;
  padding: 6px 0;
  font-size: 0.875rem;
  line-height: 1.6;
  color: rgba(0, 0, 0, 0.7);
  white-space: pre-wrap;
  word-break: break-word;
}
.note-empty {
  padding: 8px 0;
  font-size: 0.875rem;
  color: rgba(0, 0, 0, 0.4);
  font-style: italic;
}
/* ========== Empty State ========== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}
.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  margin-bottom: 16px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.02);
  color: rgba(0, 0, 0, 0.2);
}
.empty-text {
  margin: 0 0 8px 0;
  font-size: 1rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.6);
}
.empty-hint {
  margin: 0;
  font-size: 0.875rem;
  color: rgba(0, 0, 0, 0.4);
  max-width: 320px;
}
/* ========== Responsive ========== */
@media (max-width: 768px) {
  .modern-table :deep(th),
  .modern-table :deep(td) {
    padding: 10px 12px !important;
  }
  .user-cell {
    gap: 8px;
  }
  .user-avatar {
    width: 24px;
    height: 24px;
    font-size: 0.6875rem;
  }
  .device-pill {
    padding: 3px 10px;
    font-size: 0.75rem;
  }
  .date-cell {
    gap: 1px;
  }
  .date-primary,
  .user-name,
  .type-label {
    font-size: 0.8125rem;
  }
  .date-secondary {
    font-size: 0.6875rem;
  }
  .note-content {
    gap: 10px;
  }
  .note-icon {
    width: 28px;
    height: 28px;
  }
  .note-text {
    font-size: 0.8125rem;
  }
}
/* ========== Accessibility ========== */
@media (prefers-reduced-motion: reduce) {
  .expand-button svg,
  .modern-table :deep(tbody tr) {
    transition: none !important;
  }
}
/* Focus states for keyboard navigation */
.expand-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.modern-table :deep(tbody tr:focus-within) {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
</style>
