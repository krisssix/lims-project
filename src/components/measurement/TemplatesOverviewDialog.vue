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
}>()

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
  'create': []
  'edit': [item: TemplateItem]
  'createBlank': []
  'createFromFile': []
  'requestEditTemplate': [id: string]
  'delete': [templateId: string]
}>()

const search = ref<string>('')
const sortKey = ref<'device' | 'name'>('device')
const sortDir = ref<'asc' | 'desc'>('asc')

// Delete confirmation dialog
const showDeleteDialog = ref(false)
const deleteTarget = ref<TemplateItem | null>(null)

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

// Filter to show only ACTIVE templates (flat list, no grouping)
const activeTemplates = computed<TemplateItem[]>(() => {
  const mult = sortDir.value === 'asc' ? 1 : -1
  
  // Filter only ACTIVE templates (or templates without status for backward compatibility)
  const active = filtered.value.filter(t => !t.status || t.status === 'ACTIVE')
  
  // Sort by device/name
  return active.sort((a, b) => {
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
})
watch(() => props.selectedTemplateId, () => {
  if (props.modelValue) void focusSelected()
})
watch(() => props.templates, () => {
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
        <SearchBar
          v-model="search"
          placeholder="Hledat šablony podle názvu, zařízení nebo verze..."
          style="flex: 1; max-width: 500px"
        />
        <div class="toolbar-actions">
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

      <!-- Content - Flat list of active templates -->
      <div class="templates-content">
        <div
          v-for="tpl in activeTemplates"
          :key="tpl.id"
          :ref="el => setItemRef(tpl.id, el)"
          class="template-row"
          :tabindex="0"
          role="button"
          :aria-label="'Upravit šablonu ' + tpl.name"
          @click="triggerEdit(tpl)"
          @keydown="onRowKey($event, tpl)"
        >
          <div class="template-row-left">
            <div
              class="device-badge"
              :style="{
                background: tpl.deviceColor || '#6b7280',
                color: contrastText(tpl.deviceColor || '#6b7280')
              }"
            >
              {{ tpl.deviceId }}
            </div>
            <div
              class="template-icon-box"
              :style="{ backgroundColor: lightBg(tpl.deviceColor) }"
            >
              <v-icon
                size="18"
                :style="{ color: tpl.deviceColor || '#6b7280' }"
              >
                mdi-file-document-outline
              </v-icon>
            </div>
            <span class="template-name" :title="tpl.name">{{ tpl.name }}</span>
            <v-chip
              v-if="tpl.version"
              size="x-small"
              color="success"
              variant="flat"
              class="ml-2"
            >
              <v-icon start size="12">mdi-check-circle</v-icon>
              {{ formatVersion(tpl.version) }}
            </v-chip>
          </div>
          <div class="template-row-right">
            <span
              class="template-date"
              :title="formatDate(tpl.updatedAt)"
            >
              {{ getRelativeTime(tpl.updatedAt || new Date().toISOString()) }}
            </span>
            <v-menu offset-y>
              <template #activator="{ props: menuProps }">
                <button
                  type="button"
                  class="icon-btn"
                  v-bind="menuProps"
                  @click.stop
                >
                  <v-icon size="18">
                    mdi-dots-vertical
                  </v-icon>
                </button>
              </template>
              <v-list density="compact">
                <v-list-item @click="triggerEdit(tpl)">
                  <template #prepend>
                    <v-icon size="18">
                      mdi-pencil
                    </v-icon>
                  </template>
                  <v-list-item-title>Upravit</v-list-item-title>
                </v-list-item>
                <v-divider />
                <v-list-item @click="openDeleteDialog(tpl)">
                  <template #prepend>
                    <v-icon
                      size="18"
                      color="error"
                    >
                      mdi-delete
                    </v-icon>
                  </template>
                  <v-list-item-title class="text-error">
                    Smazat šablonu
                  </v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
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
        <v-card-title class="d-flex align-center">
          <v-icon color="error" class="mr-2">mdi-delete-alert</v-icon>
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
  </v-dialog>
</template>

<style scoped>
.change-desc {
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
  margin-left: 8px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.icon-btn:hover {
  background: #f3f4f6;
}

/* Template Row (flat list) */
.template-row {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid #f3f4f6;
}

.template-row:last-child {
  border-bottom: none;
}

.template-row:hover {
  background: #f9fafb;
}

.template-row:focus-visible {
  outline: none;
  background: #eff6ff;
  box-shadow: inset 0 0 0 2px #1976d2;
}

.template-row-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.template-row-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.template-name {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-date {
  font-size: 12px;
  color: #9ca3af;
}


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

/* Content */
.templates-content {
  flex:1;
  overflow-y:auto;
  padding: 16px 24px;
  min-height:0;
}

.template-group {
  margin-bottom:12px;
  border:1px solid #e5e7eb;
  border-radius:12px;
  overflow:hidden;
  background:white;
}

/* Group Header */
.group-header {
  padding:14px 16px;
  background:#f9fafb;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:space-between;
  transition:background 0.15s;
}

.group-header:hover {
  background:#f3f4f6;
}

.group-header-left {
  display:flex;
  align-items:center;
  gap:10px;
  flex: 1;
  min-width:0;
}

.expand-icon {
  color:#9ca3af;
  transition:transform 0.2s;
  flex-shrink:0;
}

.expand-icon.expanded {
  transform:rotate(90deg);
}

.device-badge {
  padding:4px 10px;
  border-radius:6px;
  font-size:11px;
  font-weight: 700;
  letter-spacing:0.5px;
  flex-shrink:0;
}

.template-icon-box {
  width:32px;
  height:32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink:0;
}

.group-name {
  font-size:14px;
  font-weight:600;
  color: #374151;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.version-count-badge {
  padding:3px 8px;
  background:#e5e7eb;
  border-radius:6px;
  font-size: 11px;
  font-weight: 600;
  color:#6b7280;
  flex-shrink:0;
}

.group-header-right {
  display:flex;
  align-items:center;
  gap:8px;
  flex-shrink:0;
}

/* Action Buttons */
.action-btn {
  height:32px;
  padding:0 12px;
  border: none;
  border-radius:8px;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:6px;
  font-size: 13px;
  font-weight:500;
  transition:all 0.15s;
}

.primary-action {
  background:#1976d2;
  color:white;
  box-shadow:0 2px 8px rgba(25, 118, 210, 0.3);
}

.primary-action:hover {
  transform:translateY(-1px);
  box-shadow:0 4px 12px rgba(25, 118, 210, 0.4);
}

.success-action {
  background:#22c55e;
  color:white;
}

.success-action:hover {
  background:#16a34a;
}

/* Version Menu */
.version-menu {
  border-radius:10px ! important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12) !important;
}

/* Versions Container */
.versions-container {
  border-top:1px solid #e5e7eb;
}

/* Version Row */
.version-row {
  padding:12px 16px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  cursor:pointer;
  transition:background 0.15s;
  border-bottom:1px solid #f3f4f6;
}

.version-row:last-child {
  border-bottom:none;
}

.version-row:hover {
  background:#f9fafb;
}

.version-row:focus-visible {
  outline:none;
  background:#eff6ff;
  box-shadow:inset 0 0 0 2px #1976d2;
}

.version-row-left {
  display:flex;
  align-items:center;
  gap: 10px;
}

.version-indent {
  width:30px;
  flex-shrink:0;
}

.status-badge {
  display:flex;
  align-items:center;
  gap:4px;
  padding:4px 10px;
  border-radius: 6px;
  font-size:11px;
  font-weight:700;
  letter-spacing:0.5px;
}

.status-label {
  font-size:13px;
  font-weight: 500;
  color:#6b7280;
}

.version-row-right {
  display:flex;
  align-items:center;
  gap:12px;
}

.version-date {
  font-size:12px;
  color:#9ca3af;
}

.edit-icon {
  color:#9ca3af;
  transition: color 0.15s;
}

.version-row:hover .edit-icon {
  color:#1976d2;
}

/* Empty State */
.empty-state {
  padding:80px 20px;
  text-align: center;
}

.empty-title {
  margin-top:16px;
  font-size: 18px;
  font-weight:600;
  color:#374151;
}

.empty-subtitle {
  margin-top:8px;
  font-size:14px;
  color:#9ca3af;
}

/* Footer */
.templates-footer {
  padding:16px 24px;
  background:#f9fafb;
  border-top:1px solid #e5e7eb;
  display:flex;
  align-items:center;
  gap: 12px;
  flex-shrink:0;
}

.footer-btn {
  height:40px;
  padding:0 20px;
  border:none;
  border-radius:8px;
  font-size:14px;
  font-weight: 500;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:8px;
  transition:all 0.15s;
}

.footer-btn.secondary {
  background:#e5e7eb;
  color:#6b7280;
}

.footer-btn.secondary:hover {
  background: #d1d5db;
}

.footer-btn.primary {
  background:#1976d2;
  color:white;
  font-weight:600;
  box-shadow:0 4px 12px rgba(25, 118, 210, 0.4);
}

.footer-btn.primary:hover {
  transform:translateY(-1px);
  box-shadow:0 6px 16px rgba(25, 118, 210, 0.5);
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

  .group-header-left {
    flex-wrap:wrap;
  }

  .version-row-right {
    flex-direction:column;
    align-items:flex-end;
    gap:8px;
  }
}

@media (max-width:600px) {
  .templates-header {
    padding:16px 20px;
  }

  .templates-toolbar {
    padding:12px 20px;
  }

  .templates-content {
    padding:12px 20px;
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

  .group-name {
    font-size:13px;
  }

  .device-badge {
    font-size:10px;
  }
}
</style>
