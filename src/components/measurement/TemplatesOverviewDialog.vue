<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import SearchBar from '@/components/ui/SearchBar.vue'
import { type TemplateItem } from '@/types/measurement-ui'
import { contrastText } from '@/utils/colorContrast'
import { getRelativeTime, formatVersion } from '@/utils/versioning'

// Generate light background color from device color
function lightBg(color: string | undefined | null): string {
  if (!color) return '#f9fafb'
  const hex = color.replace('#', '')
  if (hex.length < 6) return '#f9fafb'
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#f9fafb'
  const lr = Math.round(r * 0.15 + 255 * 0.85)
  const lg = Math.round(g * 0.15 + 255 * 0.85)
  const lb = Math.round(b * 0.15 + 255 * 0.85)
  return `rgb(${lr}, ${lg}, ${lb})`
}

// Format ISO timestamp to localized date string
function formatDate(isoString: string | undefined): string {
  if (!isoString) return '—'
  const d = new Date(isoString)
  return d.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const props = defineProps<{
  modelValue: boolean
  templates: TemplateItem[]
  selectedTemplateId: string | null
  loading?: boolean
}>()

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
  'create': []
  'edit': [item: TemplateItem]
  'createBlank': []
  'createFromFile': []
  'requestEditTemplate': [id: string]
  'delete': [templateId: string]
  'bulkDelete': [ids: string[]]
  'bulkStatusUpdate': [ids: string[], status: 'ACTIVE' | 'DRAFT' | 'DEPRECATED']
}>()

const search = ref<string>('')
const sortKey = ref<'device' | 'name'>('device')
const sortDir = ref<'asc' | 'desc'>('asc')

// Delete confirmation dialog
const showDeleteDialog = ref(false)
const deleteTarget = ref<TemplateItem | null>(null)

// Bulk delete state
const selection = ref<Set<string>>(new Set())
const showBulkDeleteDialog = ref(false)

// Notification state
const notification = ref<{
  show: boolean
  type: 'success' | 'error' | 'warning'
  message: string
} | null>(null)

function toggleSort(key: 'device' | 'name'): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

// Filter and search
const filtered = computed<TemplateItem[]>(() => {
  const q = search.value.trim().toLowerCase()
  return q
    ? props.templates.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.deviceId.toLowerCase().includes(q)
    )
    : props.templates
})

const includeDrafts = ref(false)

// Filter to show active templates (or all if drafts included)
const activeTemplates = computed<TemplateItem[]>(() => {
  const mult = sortDir.value === 'asc' ? 1 : -1

  let result = filtered.value

  // If NOT including drafts, filter only ACTIVE
  if (!includeDrafts.value) {
    result = result.filter(t => !t.status || t.status === 'ACTIVE')
  }

  // Sort by device/name
  return result.sort((a, b) => {
    if (sortKey.value === 'device') {
      const cmp = a.deviceId.localeCompare(b.deviceId, 'cs')
      if (cmp !== 0) return cmp * mult
      return a.name.localeCompare(b.name, 'cs') * mult
    } else {
      const cmp = a.name.localeCompare(b.name, 'cs')
      if (cmp !== 0) return cmp * mult
      return a.deviceId.localeCompare(b.deviceId, 'cs') * mult
    }
  })
})

/* Selection Logic */
const selectedCount = computed(() => selection.value.size)
const allSelected = computed(() => activeTemplates.value.length > 0 && selection.value.size === activeTemplates.value.length)
const someSelected = computed(() => selection.value.size > 0)

const selectedItems = computed(() => 
  props.templates.filter(t => selection.value.has(t.id))
)

const canSetToActive = computed(() => {
  if (selection.value.size === 0) return false
  return selectedItems.value.some(t => { 
    // Is NOT Active? (Active = explicitly ACTIVE or undefined/null)
    const isActive = !t.status || t.status === 'ACTIVE'
    return !isActive
  })
})

const canSetToDraft = computed(() => {
  if (selection.value.size === 0) return false
  return selectedItems.value.some(t => t.status !== 'DRAFT')
})

const canSetToDeprecated = computed(() => {
  if (selection.value.size === 0) return false
  return selectedItems.value.some(t => t.status !== 'DEPRECATED')
})

function toggleSelect(id: string) {
  if (selection.value.has(id)) {
    selection.value.delete(id)
  } else {
    selection.value.add(id)
  }
}

function toggleAll() {
  if (allSelected.value) {
    selection.value.clear()
  } else {
    activeTemplates.value.forEach(t => selection.value.add(t.id))
  }
}

function openBulkDeleteDialog() {
  if (selection.value.size === 0) return
  showBulkDeleteDialog.value = true
}

function confirmBulkDelete() {
  const ids = Array.from(selection.value)
  emits('bulkDelete', ids)
  showNotification('success', `Smazáno ${ids.length} šablon`)
  selection.value.clear()
  showBulkDeleteDialog.value = false
}

function bulkSetStatus(status: 'ACTIVE' | 'DRAFT' | 'DEPRECATED') {
  if (selection.value.size === 0) return
  const ids = Array.from(selection.value)
  emits('bulkStatusUpdate', ids, status)
  
  const statusLabels: Record<string, string> = {
    'ACTIVE': 'Aktivní',
    'DRAFT': 'Koncept',
    'DEPRECATED': 'Zastaralé'
  }
  showNotification('success', `${ids.length} šablon označeno jako "${statusLabels[status]}"`)
  selection.value.clear()
}

function showNotification(type: 'success' | 'error' | 'warning', message: string): void {
  notification.value = { show: true, type, message }
  setTimeout(() => {
    notification.value = null
  }, 4000)
}

function openDeleteDialog(template: TemplateItem): void {
  deleteTarget.value = template
  showDeleteDialog.value = true
}

function confirmDelete(): void {
  if (!deleteTarget.value) return

  emits('delete', deleteTarget.value.id)
  showNotification('success', `Šablona "${deleteTarget.value.name}" byla smazána`)

  showDeleteDialog.value = false
  deleteTarget.value = null
}

const itemRefs = new Map<string, HTMLElement>()
function setItemRef(id: string, el: Element | { $el?: Element } | null): void {
  const dom: HTMLElement | null =
    el && typeof el === 'object' && '$el' in el && el.$el instanceof HTMLElement
      ? (el.$el as HTMLElement)
      : el instanceof HTMLElement
        ? el
        : null
  if (dom) itemRefs.set(id, dom)
  else itemRefs.delete(id)
}

async function focusSelected(): Promise<void> {
  if (!props.selectedTemplateId) return
  await nextTick()
  const el = itemRefs.get(props.selectedTemplateId)
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  el?.focus()
}

function close(): void {
  emits('update:modelValue', false)
  selection.value.clear()
}

function triggerEdit(tpl: TemplateItem): void {
  emits('edit', tpl)
  emits('requestEditTemplate', tpl.id)
}

function onRowKey(e: KeyboardEvent, tpl: TemplateItem): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    triggerEdit(tpl)
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.modelValue) return

  if (e.key === 'Escape') {
    e.preventDefault()
    if (showDeleteDialog.value) {
      showDeleteDialog.value = false
    } else {
      close()
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

watch(() => props.modelValue, v => {
  if (v) void focusSelected()
  else selection.value.clear()
})
watch(() => props.selectedTemplateId, () => {
  if (props.modelValue) void focusSelected()
})
watch(() => props.templates, () => {
  // Prune selection of items that no longer exist
  const existingIds = new Set(props.templates.map(t => t.id))
  for (const id of selection.value) {
    if (!existingIds.has(id)) {
      selection.value.delete(id)
    }
  }

  if (props.modelValue && props.selectedTemplateId) void focusSelected()
})
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="1200px"
    :persistent="false"
    @update:model-value="v => emits('update:modelValue', v)"
  >
    <div class="templates-dialog-card">
      <!-- Notification Snackbar -->
      <v-snackbar
        v-if="notification"
        v-model="notification.show"
        :color="notification.type"
        location="top"
        :timeout="4000"
      >
        {{ notification.message }}
      </v-snackbar>

      <!-- Header -->
      <div class="templates-header">
        <div class="header-row">
          <div class="header-left">
            <div class="header-icon">
              <v-icon
                size="24"
                color="white"
              >
                mdi-file-document-multiple
              </v-icon>
            </div>
            <div class="header-text">
              <div class="header-title">
                Přehled šablon
              </div>
              <div class="header-subtitle">
                <v-icon
                  size="14"
                  class="mr-1"
                >
                  mdi-format-list-bulleted
                </v-icon>
                {{ activeTemplates.length }}
                {{ activeTemplates.length === 1 ? 'šablona' : 'šablon' }}
              </div>
            </div>
          </div>
          <button
            type="button"
            class="close-btn"
            @click="close"
          >
            <v-icon size="18">
              mdi-close
            </v-icon>
          </button>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="templates-toolbar">
         <v-progress-linear
            v-if="loading"
            indeterminate
            absolute
            bottom
            color="primary"
            height="3"
            style="z-index: 10;"
         />
        <SearchBar
          v-model="search"
          placeholder="Hledat šablony podle názvu, zařízení nebo verze..."
          style="flex: 1; max-width: 500px"
        />
        <div class="toolbar-actions">
           <!-- DRAFT TOGGLE -->
           <div class="filter-toggle">
              <v-switch
                v-model="includeDrafts"
                label="Včetně konceptů"
                color="primary"
                density="compact"
                hide-details
                inset
              />
           </div>

          <button
            type="button"
            class="sort-btn"
            :class="{ active: sortKey === 'device' }"
            @click="toggleSort('device')"
          >
            <v-icon size="16">
              mdi-devices
            </v-icon>
            Přístroj
            <v-icon
              v-if="sortKey === 'device'"
              size="14"
            >
              {{ sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
            </v-icon>
          </button>
          <button
            type="button"
            class="sort-btn"
            :class="{ active: sortKey === 'name' }"
            @click="toggleSort('name')"
          >
            <v-icon size="16">
              mdi-tag-text
            </v-icon>
            Název
            <v-icon
              v-if="sortKey === 'name'"
              size="14"
            >
              {{ sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
            </v-icon>
          </button>
        </div>
      </div>

      <!-- HEADER ACTIONS (Bulk Operations) -->
      <div class="header-actions" v-if="selectedCount > 0">
         <div class="selected-count">
           Vybráno {{ selectedCount }}
         </div>
         <div class="bulk-actions-group">
             <button 
                class="bulk-action-btn btn-active" 
                @click="bulkSetStatus('ACTIVE')" 
                title="Nastavit jako Aktivní"
                :disabled="loading || !canSetToActive"
              >
                <v-icon size="18">mdi-check-circle-outline</v-icon>
                Aktivní
             </button>
             <button 
                class="bulk-action-btn btn-draft" 
                @click="bulkSetStatus('DRAFT')" 
                title="Nastavit jako Koncept"
                :disabled="loading || !canSetToDraft"
              >
                <v-icon size="18">mdi-pencil-outline</v-icon>
                Koncept
             </button>
              <button 
                class="bulk-action-btn btn-deprecated" 
                @click="bulkSetStatus('DEPRECATED')" 
                title="Nastavit jako Zastaralé"
                :disabled="loading || !canSetToDeprecated"
              >
                <v-icon size="18">mdi-archive-outline</v-icon>
                Zastaralé
             </button>
             <div class="divider-vertical"></div>
             <button 
               class="bulk-action-btn btn-delete"
               @click="openBulkDeleteDialog"
               title="Smazat vybrané"
               :disabled="loading"
             >
               <v-icon size="18">mdi-delete</v-icon>
               Smazat
             </button>
         </div>
      </div>

      <!-- TABLE HEADER -->
      <div class="table-header-row">
        <div class="th-col col-check">
           <v-checkbox 
             :model-value="allSelected"
             :indeterminate="someSelected && !allSelected"
             density="compact" 
             hide-details
             @update:model-value="toggleAll" 
           />
        </div>
        <div class="th-col col-name" @click="toggleSort('name')">
          Název šablony
          <v-icon size="14" v-if="sortKey === 'name'">
             {{ sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
          </v-icon>
        </div>
        <div class="th-col col-device" @click="toggleSort('device')">
          Kód přístroje
          <v-icon size="14" v-if="sortKey === 'device'">
             {{ sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
          </v-icon>
        </div>
        <div class="th-col col-updated">
           Poslední verze
        </div>
        <div class="th-col col-actions">
           <!-- Actions placeholder -->
        </div>
      </div>

      <!-- TABLE BODY -->
      <div class="templates-content">
        <div
          v-for="tpl in activeTemplates"
          :key="tpl.id"
          :ref="el => setItemRef(tpl.id, el)"
          class="template-table-row"
          :class="{ 'row-selected': selection.has(tpl.id) }"
          @click="triggerEdit(tpl)"
        >
           <!-- CHECKBOX -->
           <div class="td-col col-check" @click.stop>
              <v-checkbox 
                :model-value="selection.has(tpl.id)"
                density="compact" 
                hide-details
                @update:model-value="toggleSelect(tpl.id)"
              />
           </div>

           <!-- NAME -->
           <div class="td-col col-name">
              <div 
                class="template-icon-box mr-3"
                :style="{ backgroundColor: lightBg(tpl.deviceColor) }"
              >
                <v-icon 
                  size="18" 
                  :style="{ color: tpl.deviceColor || '#6b7280' }"
                >
                  mdi-file-document-outline
                </v-icon>
              </div>
              <span class="text-body-2 font-weight-bold text-high-emphasis">
                {{ tpl.name }}
              </span>
           </div>

           <!-- DEVICE -->
           <div class="td-col col-device">
              <div 
                class="device-badge"
                :style="{ 
                  background: tpl.deviceColor || '#6b7280', 
                  color: contrastText(tpl.deviceColor || '#6b7280') 
                }"
              >
                {{ tpl.deviceId }}
              </div>
           </div>

           <!-- UPDATED -->
           <div class="td-col col-updated">
               <div class="d-flex align-center">
                 <v-chip
                   size="x-small"
                   color="success"
                   variant="flat"
                   class="mr-2"
                 >
                   v{{ formatVersion(tpl.version) }}
                 </v-chip>
                 <span class="text-caption text-medium-emphasis">
                   {{ getRelativeTime(tpl.updatedAt || new Date().toISOString()) }}
                 </span>
               </div>
           </div>

           <!-- ACTIONS -->
           <div class="td-col col-actions" @click.stop>
              <v-btn 
                icon 
                variant="text" 
                size="small" 
                color="error"
                @click="openDeleteDialog(tpl)"
              >
                 <v-icon>mdi-delete-outline</v-icon>
              </v-btn>
           </div>

        </div>

        <!-- Empty State -->
        <div
          v-if="activeTemplates.length === 0"
          class="empty-state"
        >
          <v-icon
            size="64"
            color="#e5e7eb"
          >
            mdi-file-document-multiple-outline
          </v-icon>
          <div class="empty-title">
            Žádné šablony
          </div>
          <div class="empty-subtitle">
            {{ search ? 'Zkuste upravit vyhledávací dotaz' : 'Vytvořte první šablonu' }}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="templates-footer">
        <button
          type="button"
          class="footer-btn secondary"
          @click="close"
        >
          Zavřít
        </button>

        <div style="flex: 1" />

        <button
          type="button"
          class="footer-btn primary"
          @click="emits('createBlank')"
        >
          <v-icon size="18">
            mdi-plus
          </v-icon>
          Vytvořit šablonu
        </button>
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <v-dialog
      v-model="showDeleteDialog"
      max-width="400px"
    >
      <v-card>
        <v-card-title class="d-flex align-center text-error">
          <v-icon class="mr-2">mdi-delete-alert</v-icon>
          Smazat šablonu
        </v-card-title>
        <v-card-text>
          <p>Opravdu chcete smazat šablonu <strong>"{{ deleteTarget?.name }}"</strong>?</p>
          <p class="text-medium-emphasis text-caption mt-2">Tato akce je nevratná.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="showDeleteDialog = false"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            @click="confirmDelete"
          >
            Smazat
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- BULK DELETE DIALOG -->
    <v-dialog
      v-model="showBulkDeleteDialog"
      max-width="400px"
    >
      <v-card>
        <v-card-title class="d-flex align-center text-error">
          <v-icon class="mr-2">mdi-delete-sweep</v-icon>
          Smazat vybrané šablony?
        </v-card-title>
        <v-card-text>
          <p>Chystáte se smazat <strong>{{ selection.size }}</strong> šablon.</p>
          <p class="text-medium-emphasis text-caption mt-2">Tato akce je nevratná.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="showBulkDeleteDialog = false"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            @click="confirmBulkDelete"
          >
            Smazat vše
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<style scoped>
/* Card */
.templates-dialog-card {
  border-radius:16px;
  overflow:hidden;
  background:#ffffff;
  box-shadow:0 12px 40px rgba(0, 0, 0, 0.15);
  display:flex;
  flex-direction:column;
  max-height:90vh;
}

/* Header */
.templates-header {
  background:linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  padding:20px 24px;
  color:white;
  flex-shrink:0;
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
  background:rgba(255, 255, 255, 0.25);
}

/* Toolbar */
.templates-toolbar {
  padding:16px 24px;
  background:#f9fafb;
  border-bottom:1px solid #e5e7eb;
  display:flex;
  align-items:center;
  gap: 12px;
  flex-shrink:0;
}

.toolbar-actions {
  display:flex;
  gap:8px;
  align-items: center; 
}

.filter-toggle {
  flex: 0 0 auto;
  height: 44px;
  padding: 0 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
}
/* Reduce internal padding of v-switch to fit nicely */
.filter-toggle :deep(.v-switch .v-label) {
  font-size: 13px;
  white-space: nowrap;
  margin-inline-start: 8px;
}

.sort-btn {
  height:36px;
  padding:0 12px;
  border:1px solid #e5e7eb;
  border-radius: 8px;
  background:white;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:6px;
  font-size:13px;
  font-weight:500;
  color:#6b7280;
  transition:all 0.15s;
}

.sort-btn:hover {
  border-color:#d1d5db;
  background:#f9fafb;
}

.sort-btn.active {
  border-color:#1976d2;
  background: #eff6ff;
  color: #1976d2;
}

/* Header Actions (Bulk Operations) */
.header-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: white;
  padding: 8px 16px; 
  margin: 0 24px 8px 24px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.selected-count {
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1976d2; 
}
.selected-count::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #1976d2;
  margin-right: 8px;
}

.bulk-actions-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.divider-vertical {
  width: 1px;
  height: 24px;
  background-color: #e5e7eb;
  margin: 0 4px;
}

.bulk-action-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
  background: transparent;
}
.bulk-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(100%);
}

/* Active Status Button */
.btn-active {
  color: #059669; /* emerald-600 */
  background: #ecfdf5; /* emerald-50 */
  border-color: #a7f3d0;
}
.btn-active:hover {
  background: #d1fae5;
  border-color: #34d399;
}

/* Draft Status Button */
.btn-draft {
  color: #d97706; /* amber-600 */
  background: #fffbeb; /* amber-50 */
  border-color: #fde68a;
}
.btn-draft:hover {
  background: #fef3c7;
  border-color: #fcd34d;
}

/* Deprecated Status Button */
.btn-deprecated {
  color: #4b5563; /* gray-600 */
  background: #f3f4f6; /* gray-100 */
  border-color: #e5e7eb;
}
.btn-deprecated:hover {
  background: #e5e7eb;
  border-color: #d1d5db;
}

/* Delete Button */
.btn-delete {
  color: #dc2626; /* red-600 */
  background: #fef2f2; /* red-50 */
  border-color: #fecaca;
}
.btn-delete:hover {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #b91c1c;
}

/* Table Header */
.table-header-row {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: #f3f4f6;
  border-bottom: 2px solid #e5e7eb;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: #6b7280;
  letter-spacing: 0.03em;
}

.th-col {
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}
.th-col:hover {
  color: #374151;
}

.col-check { width: 40px; flex-shrink: 0; justify-content: center; cursor: default; }
.col-name { flex: 1; min-width: 0; }
.col-device { width: 140px; flex-shrink: 0; }
.col-updated { width: 180px; flex-shrink: 0; }
.col-actions { width: 60px; flex-shrink: 0; justify-content: flex-end; cursor: default; }

/* Content */
.templates-content {
  flex:1;
  overflow-y:auto;
  min-height:0;
  background: white;
}

.template-table-row {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
  cursor: pointer;
  transition: background 0.1s ease-in-out;
}

.template-table-row:hover {
  background: #f9fafb;
}

.template-table-row.row-selected {
  background: #eff6ff;
  border-bottom-color: #dbeafe;
}

.td-col {
  padding: 0 8px;
  display: flex;
  align-items: center;
}

.col-check { display: flex; justify-content: center; }

.template-icon-box {
  width:32px;
  height:32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink:0;
}

.device-badge {
  padding:4px 10px;
  border-radius:6px;
  font-size:11px;
  font-weight: 700;
  letter-spacing:0.5px;
  flex-shrink:0;
}

/* Empty State */
.empty-state {
  padding: 64px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.empty-title {
  margin-top: 16px;
  font-size: 18px;
  font-weight: 600;
  color: #374151;
}

.empty-subtitle {
  margin-top: 6px;
  font-size: 14px;
  color: #9ca3af;
}

/* Footer */
.templates-footer {
  padding: 16px 24px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.footer-btn {
  height: 40px;
  padding: 0 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.footer-btn.secondary {
  background: white;
  border-color: #d1d5db;
  color: #374151;
}

.footer-btn.secondary:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.footer-btn.primary {
  background: #1976d2;
  color: white;
  box-shadow: 0 2px 4px rgba(25, 118, 210, 0.2);
}

.footer-btn.primary:hover {
  background: #1565c0;
  box-shadow: 0 4px 8px rgba(25, 118, 210, 0.3);
  transform: translateY(-1px);
}

/* Responsive */
@media (max-width:900px) {
  .templates-toolbar {
    flex-direction:column;
    align-items:stretch;
  }

  .toolbar-actions {
    width:100%;
    justify-content:space-between;
  }

  .sort-btn {
    flex:1;
  }
}

@media (max-width:600px) {
  .templates-header {
    padding:16px 20px;
  }

  .templates-toolbar {
    padding:12px 20px;
  }

  .table-header-row {
    display: none; /* Hide header on mobile if needed, or adapt */
  }

  .templates-footer {
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
