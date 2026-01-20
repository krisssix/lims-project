<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { type DeviceItem } from '@/types/measurement-ui'
import SearchBar from '@/components/ui/SearchBar.vue'

import { contrastText } from '@/utils/colorContrast'

type TableHeader = { title: string; key: string; width?: number; align?: 'start'|'center'|'end'; sortable?: boolean }
type TableRow = {
  id: number
  type: string
  device: string
  user?: string
  date: string | number        // datum měření
  createdAt?: string | number  // datum vložení (systémový čas)
  updatedAt?: string | number  // datum změny
  count: number
  note?: string | null
  status?: 'DRAFT' | 'PUBLISHED'
  zenodoDoi?: string | null  // zenodo doi pokud je publikováno
  _raw?: unknown
}

type DateFilter = {
  field: 'date' | 'createdAt' | 'updatedAt'
  preset: string | null
  from: Date | null
  to: Date | null
}
const props = defineProps<{
  headers: TableHeader[]
  items: TableRow[]
  devicesById: Map<string, DeviceItem>
  highlightedRowIds?: number[] | null
  activeDateField?: 'date' | 'createdAt' | 'updatedAt'

  devices?: Array<{ id: string; name: string; color?: string }>
  templates?: Array<{ id: string; name: string }>
  members?: string[]
}>()


const selected = defineModel<TableRow[]>('selected', { default: () => [] })


const search = ref<string>('')


const pickedDevices = ref<string[]>([])
const pickedTemplates = ref<string[]>([])
const pickedMembers = ref<string[]>([])


const dateFilter = ref<DateFilter>({
  field: 'date',
  preset: null,
  from: null,
  to: null
})

const deviceItems = computed(() => {
  if (props.devices?.length) return props.devices
  // extrakce unikátních zařízení z položek a získání barev z devicesById
  const unique = [...new Set(props.items.map(i => i.device).filter(Boolean))]
  return unique.map(code => {
    const device = props.devicesById.get(code)
    return { id: code, name: device?.name ?? code, color: device?.color }
  })
})
const templateItems = computed(() => {
  if (props.templates?.length) return props.templates
  // extrakce unikátních šablon z položek
  const unique = [...new Set(props.items.map(i => i.type))]
  return unique.map(t => ({ id: t, name: t }))
})
const memberItems = computed(() => {
  if (props.members?.length) return props.members.map(m => ({ id: m, name: m }))
  // extrakce unikátních uživatelů z položek
  const unique = [...new Set(props.items.map(i => i.user).filter(Boolean) as string[])]
  return unique.map(m => ({ id: m, name: m }))
})

const filteredItems = computed<TableRow[]>(() => {
  let result = props.items

  // Apply device filter
  if (pickedDevices.value.length > 0) {
    result = result.filter(item => pickedDevices.value.includes(item.device))
  }

  // Apply template filter
  if (pickedTemplates.value.length > 0) {
    result = result.filter(item => pickedTemplates.value.includes(item.type))
  }

  // Apply member filter
  if (pickedMembers.value.length > 0) {
    result = result.filter(item => item.user && pickedMembers.value.includes(item.user))
  }

  // Apply date filter
  if (dateFilter.value.from && dateFilter.value.to) {
    const field = dateFilter.value.field as keyof TableRow
    const from = dateFilter.value.from.getTime()
    const to = dateFilter.value.to.getTime()
    result = result.filter(item => {
      const itemDateValue = item[field]
      if (!itemDateValue) return false
      const itemDate = new Date(typeof itemDateValue === 'number' ? itemDateValue : Date.parse(String(itemDateValue)))
      if (isNaN(itemDate.getTime())) return false
      const ts = itemDate.getTime()
      return ts >= from && ts <= to
    })
  }

  // textové vyhledávání
  const q = search.value.trim().toLowerCase()
  if (q) {
    result = result.filter(item =>
      item.type.toLowerCase().includes(q) ||
      item.device.toLowerCase().includes(q) ||
      (item.user?.toLowerCase().includes(q)) ||
      (item.note?.toLowerCase().includes(q))
    )
  }

  // Default sort: Datum vložení (createdAt) descending
  result = [...result].sort((a, b) => {
    const aDate = a.createdAt ? (typeof a.createdAt === 'number' ? a.createdAt : Date.parse(String(a.createdAt))) : 0
    const bDate = b.createdAt ? (typeof b.createdAt === 'number' ? b.createdAt : Date.parse(String(b.createdAt))) : 0
    return bDate - aDate
  })

  return result
})


const animatingRowIds = ref<Set<number>>(new Set())
const sortBy = ref([{ key: 'createdAt', order: 'desc' as const }])

watch(() => props.highlightedRowIds, (newIds) => {
  if (newIds && newIds.length > 0) {
    newIds.forEach(id => animatingRowIds.value.add(id))
    // ukončení animace po dokončení
    setTimeout(() => {
      newIds.forEach(id => animatingRowIds.value.delete(id))
    }, 2500)
  }
}, { deep: true, immediate: true })

const emits = defineEmits<{
  (e: 'row-click', id: number): void
  (e: 'create-measurement'): void
  (e: 'delete-selected', ids: number[]): void
  (e: 'export-selected', ids: number[]): void
  (e: 'publish-zenodo', ids: number[]): void
  (e: 'compare-selected', ids: number[]): void
}>()

function exportSelected(): void {
  const ids = selected.value.map(r => r.id)
  if (ids.length) emits('export-selected', ids)
}

function compareSelected(): void {
  const ids = selected.value.map(r => r.id)
  if (ids.length >= 2) emits('compare-selected', ids)
}

function publishZenodo(): void {
  const ids = selected.value.map(r => r.id)
  if (ids.length) emits('publish-zenodo', ids)
}

function deleteSelected(): void {
  const ids = selected.value.map(r => r.id)
  if (ids.length) emits('delete-selected', ids)
}

function clearSelection(): void {
  selected.value = []
}
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
// získání barvy zařízení s fallbackem
function deviceColor(deviceId: string): string {
  return props.devicesById.get(deviceId)?.color || '#9E9E9E'
}

// Helper: get correct Zenodo URL (sandbox vs production)
function getZenodoUrl(doi: string): string {
  // sandbox doi mají prefix 10.5072/zenodo.{id}
  if (doi.startsWith('10.5072/')) {
    const recordId = doi.replace('10.5072/zenodo.', '')
    return `https://sandbox.zenodo.org/records/${recordId}`
  }
  // produkční doi fungují s doi.org
  return `https://doi.org/${doi}`
}
// formátování data
function formatDate(dateInput: string | number): { date: string; time: string } {
  try {
    let ms: number
    if (typeof dateInput === 'number') {
      // If timestamp is in seconds (Unix timestamp), convert to ms
      // Timestamps less than 10 billion are likely in seconds
      ms = dateInput < 10000000000 ? dateInput * 1000 : dateInput
    } else {
      // parsování textového data
      ms = Date.parse(dateInput)
    }

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
      minute: '2-digit',
      second: '2-digit'
    })
    return { date, time }
  } catch {
    return { date: String(dateInput), time: '' }
  }
}
</script>
<template>
  <div class="measurement-table-wrapper">
    <div class="table-toolbar">
      <SearchBar
        v-model="search"
        placeholder="Hledat..."
        class="toolbar-search"
      />
      <!--
      <div class="toolbar-filters">
        &lt;!&ndash; Date Filter Dropdown &ndash;&gt;
        <FilterMultiSelect
          v-model="pickedDevices"
          :items="deviceItems"
          label="Přístroje"
          all-label="Všechny"
          icon="mdi-flask"
        />
        <FilterMultiSelect
          v-model="pickedTemplates"
          :items="templateItems"
          label="Šablony"
          all-label="Všechny"
          icon="mdi-file-document-outline"
        />
        <FilterMultiSelect
          v-model="pickedMembers"
          :items="memberItems"
          label="Členové"
          all-label="Všichni"
          icon="mdi-account"
        />
      </div>-->
    </div>


    <Transition name="slide-fade">
      <div
        v-if="selected.length > 0"
        class="bulk-actions-toolbar"
      >
        <div class="bulk-info">
          <v-icon
            size="18"
            color="primary"
          >
            mdi-checkbox-marked-circle
          </v-icon>
          <span class="bulk-count">{{ selected.length }} vybráno</span>
        </div>
        <div class="bulk-actions">
          <v-btn
            size="small"
            variant="tonal"
            color="primary"
            prepend-icon="mdi-export"
            @click="exportSelected"
          >
            Export
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            color="secondary"
            prepend-icon="mdi-compare"
            :disabled="selected.length < 2"
            @click="compareSelected"
          >
            Porovnat
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            color="deep-purple"
            prepend-icon="mdi-cloud-upload"
            @click="publishZenodo"
          >
            Zenodo
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            color="error"
            prepend-icon="mdi-delete"
            @click="deleteSelected"
          >
            Smazat
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            @click="clearSelection"
          >
            Zrušit výběr
          </v-btn>
        </div>
      </div>
    </Transition>
    <v-data-table
      v-model="selected"
      v-model:sort-by="sortBy"
      :headers="props.headers"
      :items="filteredItems"
      :items-per-page="15"
      class="modern-table elevation-0"
      density="comfortable"
      hover
      show-select
      item-value="id"
      return-object
      :show-expand="hasNotes"
      :expand-on-click="false"
      :row-props="({ item }) => ({
        class: animatingRowIds.has(item.id) ? 'row-highlight-success' : ''
      })"
      @click:row="onRowClick"
    >
      <template #[`item.type`]="{ item }">
        <div class="type-cell">
          <span class="type-label">{{ item.type }}</span>
          <v-chip
            v-if="item.status === 'DRAFT'"
            size="small"
            color="warning"
            variant="flat"
            class="ml-2"
          >
            KONCEPT
          </v-chip>
          <v-chip
            v-if="item.zenodoDoi"
            size="small"
            color="deep-purple"
            variant="tonal"
            class="ml-2 zenodo-chip"
            :href="getZenodoUrl(item.zenodoDoi)"
            target="_blank"
            @click.stop
          >
            <v-icon
              size="14"
              start
            >
              mdi-cloud-check
            </v-icon>
            Zenodo
          </v-chip>
        </div>
      </template>

      <template #[`item.device`]="{ item }">
        <div
          class="device-pill"
          :style="{ '--device-color': deviceColor(item.device), '--device-text-color': contrastText(deviceColor(item.device)) }"
        >
          {{ item.device || '—' }}
        </div>
      </template>

      <template #[`item.user`]="{ item }">
        <div class="user-cell">
          <div class="user-avatar">
            {{ initials(item.user) }}
          </div>
          <span class="user-name">{{ item.user || '—' }}</span>
        </div>
      </template>

      <template #[`item.date`]="{ item }">
        <div :class="['date-cell', { 'date-cell-active': activeDateField === 'date' }]">
          <span class="date-primary">{{ formatDate(item.date).date }}</span>
          <span class="date-secondary">{{ formatDate(item.date).time }}</span>
        </div>
      </template>

      <template #[`item.createdAt`]="{ item }">
        <div
          v-if="item.createdAt"
          :class="['date-cell', { 'date-cell-active': activeDateField === 'createdAt' }]"
        >
          <span class="date-primary">{{ formatDate(item.createdAt).date }}</span>
          <span class="date-secondary">{{ formatDate(item.createdAt).time }}</span>
        </div>
        <span
          v-else
          class="text-medium-emphasis"
        >—</span>
      </template>

      <template #[`item.updatedAt`]="{ item }">
        <div
          v-if="item.updatedAt"
          :class="['date-cell', { 'date-cell-active': activeDateField === 'updatedAt' }]"
        >
          <span class="date-primary">{{ formatDate(item.updatedAt).date }}</span>
          <span class="date-secondary">{{ formatDate(item.updatedAt).time }}</span>
        </div>
        <span
          v-else
          class="text-medium-emphasis"
        >—</span>
      </template>

      <template #[`item.count`]="{ item }">
        <div class="count-badge">
          {{ item.count }}
        </div>
      </template>

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

      <template #[`item.data-table-expand`]="{ item, internalItem, toggleExpand, isExpanded }">
        <button
          v-if="item.note && item.note.trim().length"
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
/* ========== Table Toolbar ========== */
.table-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  background: #fafafa;
}
.toolbar-search {
  flex: 1 1 auto;
  min-width: 180px;
}
.toolbar-filters {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
/* Date Filter Styles */
.date-filter-btn {
  text-transform: none;
  font-weight: 500;
}
.date-filter-menu {
  max-width: 340px;
}
.date-filter-menu :deep(.v-date-picker) {
  width: 100%;
}
.date-filter-menu :deep(.v-date-picker-header) {
  padding: 4px 8px;
}
.date-filter-menu :deep(.v-date-picker-month) {
  padding: 0;
}
.date-picker-compact {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
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
  border-radius: 20px;
  font-size: 0.8125rem;
  font-weight: 600;
  background: var(--device-color, #2688e8);
  color: var(--device-text-color, white);
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
.date-cell-secondary .date-primary,
.date-cell-secondary .date-secondary {
  opacity: 0.7;
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
/* Active date field - highlighted */
.date-cell-active .date-primary {
  font-weight: 700;
  color: #1e40af;
}
.date-cell-active .date-secondary {
  color: #3b82f6;
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
/* ========== Success Highlight Animation ========== */
@keyframes highlightPulse {
  0% {
    background-color: rgba(103, 58, 183, 0.15);
    box-shadow: inset 0 0 0 2px rgb(103, 58, 183);
  }
  50% {
    background-color: rgba(103, 58, 183, 0.25);
    box-shadow: inset 0 0 0 3px rgb(103, 58, 183);
  }
  100% {
    background-color: transparent;
    box-shadow: none;
  }
}
.modern-table :deep(.row-highlight-success) {
  animation: highlightPulse 2.5s ease-out forwards;
  position: relative;
}
.modern-table :deep(.row-highlight-success td:first-child::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgb(103, 58, 183);
  animation: fadeOut 2.5s ease-out forwards;
}
@keyframes fadeOut {
  0% { opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

/* ========== Bulk Actions Toolbar ========== */
.bulk-actions-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: linear-gradient(135deg, rgba(var(--v-theme-primary), 0.08), rgba(var(--v-theme-primary), 0.04));
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.15);
  gap: 16px;
}

.bulk-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bulk-count {
  font-weight: 600;
  font-size: 0.875rem;
  color: rgba(0, 0, 0, 0.87);
}

.bulk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Slide-fade transition */
.slide-fade-enter-active {
  transition: all 0.25s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}
</style>
