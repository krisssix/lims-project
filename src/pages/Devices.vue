<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useDeviceStore, type Device } from '@/stores/devices'
import DeviceCreateDialog from '@/components/device/DeviceCreateDialog.vue'
import DeviceDetailDialog from '@/components/device/DeviceDetailDialog.vue'

const store = useDeviceStore()
const errorText = computed(() => store.errorText)

// Přepínač aktivních
const showOnlyActive = ref(true)
const filterText = ref<string>('')

// Využij kompletní seznam a filtruj dle přepínače
const baseList = computed<Device[]>(() => store.allDevices.length ?  store.allDevices : store.devices)
const filtered = computed<Device[]>(() => {
  const base = showOnlyActive.value ? baseList.value.filter(d => d.active) : baseList.value
  const q = filterText.value.trim().toLowerCase()
  if (! q) return base
  return base.filter(d => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q))
})

// Multi-select s Ctrl a Shift
const selectedIds = ref<Set<number>>(new Set())
const lastClickedId = ref<number | null>(null)

// Shift key state tracking
const shiftPressed = ref(false)

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Shift') shiftPressed.value = true
}

function handleKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Shift') shiftPressed.value = false
}

// Range select helper function
function selectRange(fromId: number | null, toId: number): void {
  if (fromId === null) {
    const newSet = new Set(selectedIds.value)
    newSet.add(toId)
    selectedIds.value = newSet
    return
  }

  const fromIndex = filtered.value.findIndex(d => d.id === fromId)
  const toIndex = filtered.value.findIndex(d => d.id === toId)

  if (fromIndex !== -1 && toIndex !== -1) {
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    const newSet = new Set(selectedIds.value)
    for (let i = start; i <= end; i++) {
      const d = filtered.value[i]
      if (d) newSet.add(d.id)
    }
    selectedIds.value = newSet
  }
}

function handleRowClick(device: Device, event: MouseEvent): void {
  if (event.shiftKey && lastClickedId.value !== null) {
    selectRange(lastClickedId.value, device.id)
  } else if (event.ctrlKey || event.metaKey) {
    const newSet = new Set(selectedIds.value)
    if (newSet.has(device.id)) {
      newSet.delete(device.id)
    } else {
      newSet.add(device.id)
    }
    selectedIds.value = newSet
    lastClickedId.value = device.id
  } else {
    openDetail(device)
    lastClickedId.value = device.id
  }
}

function handleCheckboxClick(device: Device, checked: boolean, event: MouseEvent): void {
  if (event.shiftKey && lastClickedId.value !== null) {
    selectRange(lastClickedId.value, device.id)
  } else {
    const newSet = new Set(selectedIds.value)
    if (checked) {
      newSet.add(device.id)
    } else {
      newSet.delete(device.id)
    }
    selectedIds.value = newSet
  }
  lastClickedId.value = device.id
}

function isSelected(id: number): boolean {
  return selectedIds.value.has(id)
}

function clearSelection(): void {
  selectedIds.value = new Set()
  lastClickedId.value = null
}

function selectAll(): void {
  selectedIds.value = new Set(filtered.value.map(d => d.id))
}

// Table headers for v-data-table
const tableHeaders = [
  { title: 'Název přístroje', key: 'name', sortable: true },
  { title: 'Kód přístroje', key: 'code', width: '220px', sortable: true },
]

// Two-way binding for v-data-table selection
const selectedIdsArray = computed({
  get: () => Array.from(selectedIds.value),
  set: (val: number[]) => {
    selectedIds.value = new Set(val)
  }
})

// Create dialog
const createDialogOpen = ref(false)
function openCreate(): void {
  createDialogOpen.value = true
}
function handleCreated(): void {
  createDialogOpen.value = false
}

// Detail dialog
const detailOpen = ref(false)
const detailDevice = ref<Device | null>(null)

function openDetail(device: Device): void {
  detailDevice.value = device
  detailOpen.value = true
}

function handleDetailClosed(): void {
  detailOpen.value = false
}

// Hromadné akce
const bulkLoading = ref(false)

async function bulkDeactivate(): Promise<void> {
  if (selectedIds.value.size === 0 || bulkLoading.value) return
  bulkLoading.value = true
  try {
    for (const id of selectedIds.value) {
      await store.deactivateDevice(id)
    }
    clearSelection()
  } finally {
    bulkLoading.value = false
  }
}

async function bulkReactivate(): Promise<void> {
  if (selectedIds.value.size === 0 || bulkLoading.value) return
  bulkLoading.value = true
  try {
    for (const id of selectedIds.value) {
      await store.reactivateDevice(id)
    }
    clearSelection()
  } finally {
    bulkLoading.value = false
  }
}

// Computed for bulk actions
const selectedDevices = computed(() =>
  filtered.value.filter(d => selectedIds.value.has(d.id))
)
const canDeactivate = computed(() =>
  selectedDevices.value.some(d => d.active)
)
const canReactivate = computed(() =>
  selectedDevices.value.some(d => ! d.active)
)

// Hotkeys
function handleKey(e: KeyboardEvent): void {
  handleKeyDown(e)

  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey

  if (key === 'n' && ! ctrl) {
    e.preventDefault()
    openCreate()
    return
  }
  if (ctrl && key === 'a') {
    e.preventDefault()
    selectAll()
    return
  }
  if (key === 'escape') {
    e.preventDefault()
    clearSelection()
    return
  }
  if (key === 'a' && ! ctrl && selectedIds.value.size > 0) {
    e.preventDefault()
    void bulkDeactivate()
    return
  }
  if (key === 'r' && !ctrl && selectedIds.value.size > 0) {
    e.preventDefault()
    void bulkReactivate()
    return
  }
}

onMounted(() => {
  void store.fetchAll()
  window.addEventListener('keydown', handleKey)
  window.addEventListener('keyup', handleKeyUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKey)
  window.removeEventListener('keyup', handleKeyUp)
})
</script>

<template>
  <v-container fluid class="pa-0">
    <!-- Unified top toolbar like Measurements/Reservations -->
    <v-toolbar color="white" class="border-b-sm pl-3 pr-3" density="comfortable">
      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-plus"
        title="Vytvořit nový přístroj (N)"
        @click="openCreate"
      >
        NOVÝ PŘÍSTROJ
      </v-btn>

      <v-divider vertical class="mx-3" />

      <!-- Bulk actions (visible when items selected) -->
      <template v-if="selectedIds.size > 0">
        <v-chip
          color="primary"
          variant="tonal"
          closable
          class="mr-2"
          @click:close="clearSelection"
        >
          Vybráno: {{ selectedIds.size }}
        </v-chip>
        <v-btn
          variant="tonal"
          color="error"
          size="small"
          :disabled="!canDeactivate"
          :loading="bulkLoading"
          prepend-icon="mdi-close-circle-outline"
          title="Deaktivovat vybrané (A)"
          class="mr-2"
          @click="bulkDeactivate"
        >
          Deaktivovat
        </v-btn>
        <v-btn
          variant="tonal"
          color="success"
          size="small"
          :disabled="!canReactivate"
          :loading="bulkLoading"
          prepend-icon="mdi-check-circle-outline"
          title="Reaktivovat vybrané (R)"
          @click="bulkReactivate"
        >
          Reaktivovat
        </v-btn>
        <v-divider vertical class="mx-3" />
      </template>

      <!-- Selection mode indicator -->
      <v-fade-transition>
        <v-chip
          v-if="shiftPressed"
          color="deep-purple"
          variant="flat"
          size="small"
          prepend-icon="mdi-select-multiple"
        >
          Režim výběru rozsahu
        </v-chip>
      </v-fade-transition>

      <v-spacer />
    </v-toolbar>

    <v-container fluid class="pa-4">

    <!-- Error alert -->
    <v-alert
      v-if="errorText"
      type="error"
      variant="tonal"
      class="mb-3"
    >
      {{ errorText }}
    </v-alert>

    <!-- Info about selection -->
    <v-alert
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      <template #prepend>
        <v-icon>mdi-keyboard</v-icon>
      </template>
      <strong>Tip:</strong> Kliknutím otevřete detail.
      <kbd>Ctrl</kbd>+klik pro výběr více přístrojů,
      <kbd>Shift</kbd>+klik pro výběr rozsahu.
    </v-alert>

    <!-- Table Card -->
    <v-sheet elevation="1" class="pa-4 rounded-xl">
      <!-- Table Toolbar with Search and Filter -->
      <div class="table-toolbar">
        <!-- Search Bar -->
        <v-text-field
          v-model="filterText"
          placeholder="Hledat podle názvu přístroje nebo kódu"
          variant="solo-filled"
          density="comfortable"
          hide-details
          bg-color="grey-lighten-4"
          prepend-inner-icon="mdi-magnify"
          clearable
          class="search-bar"
          @click:clear="filterText = ''"
        />
        
        <!-- Active Toggle -->
        <div class="filter-toggle">
          <v-switch
            v-model="showOnlyActive"
            color="primary"
            density="comfortable"
            hide-details
          >
            <template #label>
              <span class="text-body-2">Pouze aktivní</span>
            </template>
          </v-switch>
        </div>
      </div>

      <!-- Data Table -->
      <v-data-table
        :items="filtered"
        :headers="tableHeaders"
        :items-per-page="15"
        hover
        class="modern-table elevation-0"
        :class="{ 'shift-mode': shiftPressed }"
        show-select
        item-value="id"
        v-model="selectedIdsArray"
      >
        <!-- Device name with status chip -->
        <template #item.name="{ item }">
          <div 
            class="d-flex align-center ga-2 device-row-content"
            @click="openDetail(item)"
          >
            <span class="font-weight-medium">{{ item.name }}</span>
            <v-chip
              size="small"
              :color="item.active ? 'success' : 'grey'"
              variant="flat"
            >
              <v-icon size="14" start>
                {{ item.active ? 'mdi-check-circle' : 'mdi-close-circle' }}
              </v-icon>
              {{ item.active ? 'Aktivní' : 'Neaktivní' }}
            </v-chip>
          </div>
        </template>

        <!-- Code chip with color -->
        <template #item.code="{ item }">
          <div class="d-flex justify-start">
            <v-chip
              size="small"
              variant="flat"
              :style="{ backgroundColor: item.color || '#1976D2', color: '#fff' }"
            >
              {{ item.code }}
            </v-chip>
          </div>
        </template>
      </v-data-table>
    </v-sheet>

    <!-- Empty state -->
    <v-alert
      v-if="filtered.length === 0"
      type="info"
      variant="tonal"
      class="mt-4"
    >
      Žádné přístroje nenalezeny.
    </v-alert>

    <!-- Create Dialog -->
    <DeviceCreateDialog
      v-model="createDialogOpen"
      @created="handleCreated"
    />

    <!-- Detail Dialog -->
    <DeviceDetailDialog
      v-model="detailOpen"
      :device="detailDevice"
      @updated="handleDetailClosed"
      @deactivated="handleDetailClosed"
      @reactivated="handleDetailClosed"
    />
    </v-container>
  </v-container>
</template>

<style scoped>
/* Table Toolbar */
.table-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 12px;
  margin-bottom: 16px;
}

.search-bar {
  flex: 1;
  min-width: 240px;
}

.search-bar :deep(.v-field) {
  border-radius: 12px;
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

/* Modern Table */
.modern-table {
  border-radius: 8px;
  overflow: hidden;
}

.modern-table :deep(th) {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: #64748b;
}

.device-row-content {
  cursor: pointer;
}

.device-row-content:hover {
  color: #1976d2;
}

kbd {
  display: inline-block;
  padding: 2px 6px;
  font-size: 0.75rem;
  font-family: ui-monospace, monospace;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
}

/* Shift mode - fialové podbarvení */
.shift-mode {
  background-color: rgba(103, 58, 183, 0.04);
}

.shift-mode :deep(tr:hover) {
  background-color: rgba(103, 58, 183, 0.08) !important;
}

.shift-mode :deep(.v-data-table__selected) {
  background-color: rgba(103, 58, 183, 0.15) !important;
}
</style>
