<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import SearchBar from '@/components/ui/SearchBar.vue'
import ModernSwitch from '@/components/ui/ModernSwitch.vue'
import { type TemplateItem, type TemplateStatus } from '@/types/measurement-ui'
import { contrastText } from '@/utils/colorContrast'
import { getRelativeTime, formatVersion } from '@/utils/versioning'

// generování světlé barvy ze zadaného odstínu
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

// formátování iso timestampu na lokální datum
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

function getStatusColor(status?: TemplateStatus): string {
  switch (status) {
    case 'ACTIVE': return 'success'
    case 'DRAFT': return 'grey'
    case 'DEPRECATED': return 'error'
    default: return 'grey'
  }
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


const showDeleteDialog = ref(false)
const deleteTarget = ref<TemplateItem | null>(null)


const selection = ref<Set<string>>(new Set())
const showBulkDeleteDialog = ref(false)


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

const showVersions = ref(false)
const expandedGroups = ref<Set<string>>(new Set())

type TemplateGroup = {
  groupKey: string
  main: TemplateItem
  versions: TemplateItem[]
  activeVersion?: TemplateItem
}

// zobrazení aktivních šablon (nebo všech pokud jsou zahrnuty koncepty)
// Grouped logic
const groupedTemplates = computed<TemplateGroup[]>(() => {
  const groups = new Map<string, TemplateItem[]>()
  
  // 1. Group by deviceId + name
  filtered.value.forEach(t => {
     const key = `${t.deviceId}|${t.name}`
     if (!groups.has(key)) groups.set(key, [])
     groups.get(key)!.push(t)
  })

  const result: TemplateGroup[] = []

  groups.forEach((items, key) => {
    // Sort items by version desc (newest first) for internal consistency
    items.sort((a, b) => {
       // Simple string compare for semantic version validation is tricky, 
       // but assuming format x.y.z or date-based, simple string compare desc might approximate
       // ideally use semver compare. For now relying on CreatedAt or Version string.
       // Let's use UpdatedAt latest first.
       return (b.updatedAt || '').localeCompare(a.updatedAt || '')
    })

    const activeVersion = items.find(i => i.status === 'ACTIVE')
    // If we are NOT showing versions, we only want to show the 'main' item (Active preferred, else latest)
    // AND we must filter out draft/deprecated if they are the only ones, unless logic says otherwise.
    
    // Logic as per user request: "included grouped in folders".
    // If !showVersions: We mostly want to see active templates.
    
    let main: TemplateItem = activeVersion || items[0]
    
    if (!showVersions.value) {
       if (!activeVersion) {
         return 
       }
       main = activeVersion
       result.push({ groupKey: key, main, versions: [main], activeVersion })
    } else {
       // Show versions is ON. Show the group.
       result.push({ groupKey: key, main, versions: items, activeVersion })
    }
  })

  // Sort groups
  const mult = sortDir.value === 'asc' ? 1 : -1
  return result.sort((a, b) => {
    if (sortKey.value === 'device') {
      const cmp = a.main.deviceId.localeCompare(b.main.deviceId, 'cs')
      if (cmp !== 0) return cmp * mult
      return a.main.name.localeCompare(b.main.name, 'cs') * mult
    } else {
      const cmp = a.main.name.localeCompare(b.main.name, 'cs')
      if (cmp !== 0) return cmp * mult
      return a.main.deviceId.localeCompare(b.main.deviceId, 'cs') * mult
    }
  })
})

function toggleGroupExpanded(key: string) {
  if (expandedGroups.value.has(key)) expandedGroups.value.delete(key)
  else expandedGroups.value.add(key)
}

// Counts for "Select All"
const totalSelectableItems = computed(() => {
   let count = 0
   groupedTemplates.value.forEach(g => {
      if (showVersions.value) count += g.versions.length
      else count += 1
   })
   return count
})

const selectedCount = computed(() => selection.value.size)
const allSelected = computed(() => totalSelectableItems.value > 0 && selection.value.size === totalSelectableItems.value)
const someSelected = computed(() => selection.value.size > 0)

const selectedItems = computed(() => 
  props.templates.filter(t => selection.value.has(t.id))
)

const canSetToActive = computed(() => {
  if (selection.value.size === 0) return false
  return selectedItems.value.some(t => { 
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

function toggleGroupSelect(group: TemplateGroup) {
  const allIds = getAllGroupIds(group)
  const allSelected = isGroupFullySelected(group)
  
  if (allSelected) {
     allIds.forEach(id => selection.value.delete(id))
  } else {
     allIds.forEach(id => selection.value.add(id))
  }
}

function getAllGroupIds(group: TemplateGroup): string[] {
  if (showVersions.value) return group.versions.map(v => v.id)
  return [group.main.id]
}

function isGroupFullySelected(group: TemplateGroup): boolean {
  const ids = getAllGroupIds(group)
  return ids.every(id => selection.value.has(id))
}

function isGroupPartiallySelected(group: TemplateGroup): boolean {
  const ids = getAllGroupIds(group)
  const selected = ids.filter(id => selection.value.has(id))
  return selected.length > 0 && selected.length < ids.length
}

function toggleAll() {
  if (allSelected.value) {
    selection.value.clear()
  } else {
    groupedTemplates.value.forEach(g => {
       const ids = getAllGroupIds(g)
       ids.forEach(id => selection.value.add(id))
    })
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

const highlightedTemplateId = ref<string | null>(null)

function highlightTemplate(id: string) {
  highlightedTemplateId.value = id
  
  // Find group for this template
  // If it's a version inside a collapsed group, expand it
  const group = groupedTemplates.value.find(g => 
      g.main.id === id || g.versions.some(v => v.id === id)
  )
  if (group) {
      // If we are showing versions and the target is NOT the main one (or main is one of versions), expand
      // Actually simpler: just ensure the group is expanded if we are targeting something inside it
      // But only if versions view is active OR if we force it? 
      // User implies "TemplateOverviewDialog", usually versions are hidden by default unless toggled.
      // If target is inside a group that has multiple versions, we should probably toggle versions ON or just expand?
      // Let's just expand if we are in versions mode.
      if (showVersions.value && !expandedGroups.value.has(group.groupKey)) {
          expandedGroups.value.add(group.groupKey)
      }
  }

  // Focus
  nextTick(() => {
     focusSelected()
  })

  // Fade out
  setTimeout(() => {
      highlightedTemplateId.value = null
  }, 3500)
}

watch(() => props.modelValue, v => {
  if (v && props.selectedTemplateId) highlightTemplate(props.selectedTemplateId)
  else selection.value.clear()
})
watch(() => props.selectedTemplateId, (newId) => {
  if (props.modelValue && newId) highlightTemplate(newId)
})
watch(() => props.templates, () => {
   // existing logic
  const existingIds = new Set(props.templates.map(t => t.id))
  for (const id of selection.value) {
    if (!existingIds.has(id)) {
      selection.value.delete(id)
    }
  }
  // Try to re-highlight if reloaded
  if (props.modelValue && props.selectedTemplateId) highlightTemplate(props.selectedTemplateId)
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
                {{ totalSelectableItems }}
                {{ totalSelectableItems === 1 ? 'šablona' : 'šablon' }}
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
          style="flex: 1;"
        />
        <div class="toolbar-actions">
          <ModernSwitch
            v-model="showVersions"
            label="Včetně verzí"
          />

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


      <div
        v-if="selectedCount > 0"
        class="header-actions"
      >
        <div class="selected-count">
          Vybráno {{ selectedCount }}
        </div>
        <div class="bulk-actions-group">
          <button 
            class="bulk-action-btn btn-active" 
            title="Nastavit jako Aktivní" 
            :disabled="loading || !canSetToActive"
            @click="bulkSetStatus('ACTIVE')"
          >
            <v-icon size="18">
              mdi-check-circle-outline
            </v-icon>
            Aktivní
          </button>
          <button 
            class="bulk-action-btn btn-draft" 
            title="Nastavit jako Koncept" 
            :disabled="loading || !canSetToDraft"
            @click="bulkSetStatus('DRAFT')"
          >
            <v-icon size="18">
              mdi-pencil-outline
            </v-icon>
            Koncept
          </button>
          <button 
            class="bulk-action-btn btn-deprecated" 
            title="Nastavit jako Zastaralé" 
            :disabled="loading || !canSetToDeprecated"
            @click="bulkSetStatus('DEPRECATED')"
          >
            <v-icon size="18">
              mdi-archive-outline
            </v-icon>
            Zastaralé
          </button>
          <div class="divider-vertical" />
          <button 
            class="bulk-action-btn btn-delete"
            title="Smazat vybrané"
            :disabled="loading"
            @click="openBulkDeleteDialog"
          >
            <v-icon size="18">
              mdi-delete
            </v-icon>
            Smazat
          </button>
        </div>
      </div>


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
        <div
          class="th-col col-device"
          @click="toggleSort('device')"
        >
          Kód přístroje
          <v-icon
            v-if="sortKey === 'device'"
            size="14"
          >
            {{ sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
          </v-icon>
        </div>
        <div
          class="th-col col-name"
          @click="toggleSort('name')"
        >
          Název šablony & Verze
          <v-icon
            v-if="sortKey === 'name'"
            size="14"
          >
            {{ sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
          </v-icon>
        </div>
        <div class="th-col col-updated">
          Poslední změna
        </div>
      </div>


      <div class="templates-content">
        <template
          v-for="group in groupedTemplates"
          :key="group.groupKey"
        >
          <!-- Group Header (Main Folder Row) -->
          <div 
            class="template-group-row" 
            :class="{ 'group-expanded': group.versions.length > 1 && showVersions }"
          >
            <!-- Wrapper for the main row content -->
            <div 
              :ref="(el) => setItemRef(group.main.id, el)"
              class="template-table-row group-main-row"
              :class="{ 
                'row-selected': isGroupFullySelected(group),
                'row-partial': isGroupPartiallySelected(group),
                'row-highlight': highlightedTemplateId === group.main.id
              }"
              @click="showVersions && group.versions.length > 1 ? toggleGroupExpanded(group.groupKey) : triggerEdit(group.main)"
            >
              <div
                class="td-col col-check"
                @click.stop
              >
                <v-checkbox 
                  :model-value="isGroupFullySelected(group)"
                  :indeterminate="isGroupPartiallySelected(group)"
                  density="compact" 
                  hide-details
                  @update:model-value="toggleGroupSelect(group)"
                />
              </div>

              <div class="td-col col-device">
                <div 
                  class="device-badge"
                  :style="{ 
                    background: group.main.deviceColor || '#6b7280', 
                    color: contrastText(group.main.deviceColor || '#6b7280') 
                  }"
                >
                  {{ group.main.deviceId }}
                </div>
              </div>

              <div class="td-col col-name">
                <div
                  class="d-flex align-center"
                  style="width: 100%;"
                >
                  <div 
                    class="template-icon-box mr-3"
                    :style="{ backgroundColor: lightBg(group.main.deviceColor) }"
                  >
                    <!-- Folder icon if multiple versions and we are in version mode -->
                    <v-icon 
                      v-if="showVersions && group.versions.length > 1"
                      size="18" 
                      :class="{ 'rotate-90': expandedGroups.has(group.groupKey) }"
                      style="transition: transform 0.2s;"
                      :style="{ color: group.main.deviceColor || '#6b7280' }"
                    >
                      mdi-folder-outline
                    </v-icon>
                    <v-icon 
                      v-else
                      size="18" 
                      :style="{ color: group.main.deviceColor || '#6b7280' }"
                    >
                      mdi-file-document-outline
                    </v-icon>
                  </div>
                       
                  <div class="d-flex flex-column">
                    <span class="text-body-2 font-weight-bold text-high-emphasis">
                      {{ group.main.name }}
                    </span>
                    <!-- Show version badges summary if multiple -->
                    <div
                      v-if="group.versions.length > 1 && !expandedGroups.has(group.groupKey) && showVersions"
                      class="d-flex gap-1 mt-1"
                    >
                      <v-chip
                        size="x-small"
                        label
                        color="grey-lighten-2"
                        class="px-1"
                        style="height: 18px;"
                      >
                        {{ group.versions.length }} verzí
                      </v-chip>
                      <v-chip
                        v-if="group.activeVersion"
                        size="x-small"
                        color="success"
                        class="px-1"
                        style="height: 18px;"
                      >
                        Active v{{ formatVersion(group.activeVersion.version) }}
                      </v-chip>
                    </div>
                    <!-- Single version display -->
                    <div
                      v-else
                      class="d-flex align-center mt-1"
                    >
                      <v-chip
                        size="x-small"
                        :color="getStatusColor(group.main.status)"
                        class="mr-2"
                        style="height: 18px;"
                      >
                        v{{ formatVersion(group.main.version) }}
                      </v-chip>
                      <v-chip
                        v-if="group.main.status === 'ACTIVE'"
                        size="x-small"
                        color="success"
                        variant="text"
                        class="px-0 font-weight-bold"
                        style="height: 18px;"
                      >
                        (Aktivní)
                      </v-chip>
                    </div>
                  </div>
                  <!-- Expand indicator chevron -->
                  <v-icon 
                    v-if="showVersions && group.versions.length > 1"
                    class="ml-auto text-medium-emphasis"
                    size="20"
                  >
                    {{ expandedGroups.has(group.groupKey) ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
                  </v-icon>
                </div>
              </div>

              <div class="td-col col-updated">
                <span class="text-caption text-medium-emphasis">
                  {{ getRelativeTime(group.main.updatedAt || new Date().toISOString()) }}
                </span>
              </div>
            </div>

            <!-- Expanded Versions List -->
            <v-expand-transition>
              <div
                v-if="showVersions && group.versions.length > 1 && expandedGroups.has(group.groupKey)"
                class="group-versions-list"
              >
                <div 
                  v-for="ver in group.versions" 
                  :key="ver.id"
                  :ref="(el) => setItemRef(ver.id, el)"
                  class="version-row"
                  :class="{ 
                    'row-selected': selection.has(ver.id),
                    'row-highlight': highlightedTemplateId === ver.id
                  }"
                  @click.stop="triggerEdit(ver)"
                >
                  <div
                    class="td-col col-check"
                    @click.stop
                  >
                    <v-checkbox 
                      :model-value="selection.has(ver.id)"
                      density="compact" 
                      hide-details
                      @update:model-value="toggleSelect(ver.id)"
                    />
                  </div>
                  <div class="td-col col-device" /> <!-- Empty indent -->
                  <div class="td-col col-name pl-10">
                    <!-- Connecting line visual could go here -->
                    <div class="d-flex align-center">
                      <v-chip 
                        size="small" 
                        :color="getStatusColor(ver.status)" 
                        :variant="ver.status === 'ACTIVE' ? 'flat' : 'tonal'"
                        class="mr-2"
                      >
                        v{{ formatVersion(ver.version) }}
                        <v-icon
                          v-if="ver.status === 'ACTIVE'"
                          end
                          size="12"
                        >
                          mdi-check
                        </v-icon>
                      </v-chip>
                           
                      <span
                        v-if="ver.status === 'ACTIVE'"
                        class="text-caption font-weight-bold text-success mr-2"
                      >
                        Aktivní
                      </span>
                      <span
                        v-else-if="ver.status === 'DRAFT'"
                        class="text-caption text-grey mr-2"
                      >
                        Koncept
                      </span>
                      <span
                        v-else-if="ver.status === 'DEPRECATED'"
                        class="text-caption text-error mr-2"
                      >
                        Zastaralé
                      </span>

                      <span
                        v-if="ver.changeDescription"
                        class="text-caption text-medium-emphasis text-truncate"
                        style="max-width: 200px;"
                      >
                        {{ ver.changeDescription }}
                      </span>
                    </div>
                  </div>
                  <div class="td-col col-updated">
                    <span class="text-caption text-medium-emphasis">
                      {{ getRelativeTime(ver.updatedAt || new Date().toISOString()) }}
                    </span>
                  </div>
                </div>
              </div>
            </v-expand-transition>
          </div>
        </template>
        
        <div
          v-if="groupedTemplates.length === 0"
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


      <div class="templates-footer">
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


    <v-dialog
      v-model="showDeleteDialog"
      max-width="400px"
    >
      <v-card>
        <v-card-title class="d-flex align-center text-error">
          <v-icon class="mr-2">
            mdi-delete-alert
          </v-icon>
          Smazat šablonu
        </v-card-title>
        <v-card-text>
          <p>Opravdu chcete smazat šablonu <strong>"{{ deleteTarget?.name }}"</strong>?</p>
          <p class="text-medium-emphasis text-caption mt-2">
            Tato akce je nevratná.
          </p>
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


    <v-dialog
      v-model="showBulkDeleteDialog"
      max-width="400px"
    >
      <v-card>
        <v-card-title class="d-flex align-center text-error">
          <v-icon class="mr-2">
            mdi-delete-sweep
          </v-icon>
          Smazat vybrané šablony?
        </v-card-title>
        <v-card-text>
          <p>Chystáte se smazat <strong>{{ selection.size }}</strong> šablon.</p>
          <p class="text-medium-emphasis text-caption mt-2">
            Tato akce je nevratná.
          </p>
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
  flex-shrink: 0;
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
  border-radius:12px;
  background:white;
  border:1px solid #e5e7eb;
  color:#6b7280;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:6px;
  font-size:13px;
  font-weight:500;
  transition:all 0.15s;
}

.sort-btn:hover {
  background:#f9fafb;
  border-color:#d1d5db;
}

.sort-btn.active {
  background:#eff6ff;
  border-color:#bfdbfe;
  color:#1e40af;
}

/* Selected Header */
.header-actions {
  display:flex;
  align-items:center;
  padding:12px 24px;
  background:#ebf5ff;
  border-bottom:1px solid #d1e9ff;
  flex-shrink:0;
  justify-content:space-between;
}

.selected-count {
  font-weight:600;
  color:#1e40af;
  font-size:14px;
}

.bulk-actions-group {
  display:flex;
  align-items:center;
  gap: 8px;
}

.bulk-action-btn {
  display:flex;
  align-items:center;
  gap:6px;
  padding:6px 12px;
  border-radius:8px;
  font-size:13px;
  font-weight:500;
  cursor:pointer;
  transition:all 0.2s;
  background: white;
  border: 1px solid rgba(0,0,0,0.06);
}
.bulk-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(1);
}

.btn-active { color: #2e7d32; }
.btn-active:hover:not(:disabled) { background: #e8f5e9; }

.btn-draft { color: #616161; }
.btn-draft:hover:not(:disabled) { background: #f5f5f5; }

.btn-deprecated { color: #c62828; }
.btn-deprecated:hover:not(:disabled) { background: #ffebee; }

.btn-delete { color: #c62828; border-color: #ffcdd2; }
.btn-delete:hover:not(:disabled) { background: #ffebee; border-color: #ef9a9a; }

.divider-vertical {
  width: 1px;
  height: 24px;
  background: rgba(0,0,0,0.1);
  margin: 0 4px;
}

/* Table Header */
.table-header-row {
  display:flex;
  padding:10px 24px;
  background:#f9fafb;
  border-bottom:1px solid #e5e7eb;
  font-size:12px;
  font-weight:600;
  color:#6b7280;
  text-transform:uppercase;
  letter-spacing:0.04em;
  flex-shrink:0;
}

.th-col {
  display:flex;
  align-items:center;
  gap:4px;
  cursor:pointer;
}

.col-check { width: 40px; justify-content: center; cursor: default; }
.col-device { width: 140px; }
.col-name { flex:1; }
.col-updated { width: 160px; }

/* Table Content */
.templates-content {
  flex:1;
  overflow-y:auto;
  background:white;
}

.template-table-row {
  display:flex;
  padding:12px 24px;
  border-bottom:1px solid #f3f4f6;
  align-items:center;
  cursor:pointer;
  transition:background-color 0.15s;
}

.template-table-row:hover {
  background-color:#f9fafb;
}

.row-selected {
  background-color:#eff6ff !important;
}

.td-col {
  display:flex;
  align-items:center;
}

.device-badge {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:4px 8px;
  border-radius:6px;
  font-size:11px;
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:0.02em;
}

.template-icon-box {
  width:32px;
  height:32px;
  border-radius:8px;
  display:flex;
  align-items:center;
  justify-content:center;
}

.empty-state {
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  padding:60px 0;
  color:#9ca3af;
}

.empty-title {
  margin-top:16px;
  font-size:16px;
  font-weight:600;
  color:#374151;
}

.empty-subtitle {
  margin-top:4px;
  font-size:13px;
}

/* Footer */
.templates-footer {
  padding:16px 24px;
  background:white;
  border-top:1px solid #e5e7eb;
  display:flex;
  align-items:center;
  flex-shrink:0;
}

.footer-btn {
  height:40px;
  padding:0 16px;
  border-radius:10px;
  font-size:14px;
  font-weight:600;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:8px;
  border:none;
  transition:all 0.2s;
}

.footer-btn.primary {
  background:linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color:white;
  box-shadow:0 4px 12px rgba(37, 99, 235, 0.2);
}

.footer-btn.primary:hover {
  box-shadow:0 6px 16px rgba(37, 99, 235, 0.3);
  transform:translateY(-1px);
}

.footer-btn.secondary {
  background:#f3f4f6;
  color:#4b5563;
}

.footer-btn.secondary:hover {
  background:#e5e7eb;
  color:#111827;
}

/* Responsive */
@media (max-width: 600px) {
  .col-updated, .col-device {
    display:none;
  }
  
  .templates-header {
    padding:16px;
  }
  
  .header-left {
    gap: 8px;
  }
  
  .header-title {
    font-size:16px;
  }
}

@media (max-height: 700px) {
  .templates-dialog-card {
    height: 100vh;
    border-radius: 0;
  }
  
  .filter-toggle {
    display: none; /* Hide toggle on very small screens if needed, or adjust styling */
  }
  
  .filter-toggle :deep(.v-switch .v-label) {
    font-size:12px;
  }
}
/* Group / Version Styles */
.template-group-row {
  border-bottom: 1px solid #f3f4f6;
  transition: background-color 0.2s;
}
.template-group-row:last-child {
  border-bottom: none;
}
.template-group-row.group-expanded {
  background-color: #f9fafb;
}

.group-main-row {
  /* Inherits .template-table-row styles generally, but might need tweaks */
}
.row-partial {
  background-color: #f0f9ff !important;
}

.group-versions-list {
  background-color: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

.version-row {
  display: flex;
  align-items: center;
  padding: 8px 16px; /* slightly less padding than main row */
  cursor: pointer;
  transition: background-color 0.15s;
  border-bottom: 1px solid #f3f4f6;
}
.version-row:last-child {
  border-bottom: none;
}
.version-row:hover {
  background-color: #f3f4f6;
}
.version-row.row-selected {
  background-color: #eff6ff;
}

.rotate-90 {
  transform: rotate(90deg);
}

.gap-1 {
  gap: 4px;
}

@keyframes highlight-pulse-row {
  0% { background-color: rgba(37, 99, 235, 0.05); }
  20% { background-color: rgba(37, 99, 235, 0.2); }
  100% { background-color: transparent; }
}

.row-highlight {
  animation: highlight-pulse-row 3s ease-out forwards;
}

</style>
