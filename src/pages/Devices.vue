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

function handleRowClick(device: Device, event: MouseEvent): void {
  const deviceIndex = filtered.value.findIndex(d => d.id === device.id)

  if (event.shiftKey && lastClickedId.value !== null) {
    // Shift+click: range select
    const lastIndex = filtered.value.findIndex(d => d.id === lastClickedId.value)
    if (lastIndex !== -1 && deviceIndex !== -1) {
      const start = Math.min(lastIndex, deviceIndex)
      const end = Math.max(lastIndex, deviceIndex)
      const newSet = new Set(selectedIds.value)
      for (let i = start; i <= end; i++) {
        const d = filtered.value[i]
        if (d) newSet.add(d.id)
      }
      selectedIds.value = newSet
    }
  } else if (event.ctrlKey || event.metaKey) {
    // Ctrl+click: toggle selection
    const newSet = new Set(selectedIds.value)
    if (newSet.has(device.id)) {
      newSet.delete(device.id)
    } else {
      newSet.add(device.id)
    }
    selectedIds.value = newSet
    lastClickedId.value = device.id
  } else {
    // Normal click: open detail dialog
    openDetail(device)
    lastClickedId.value = device.id
  }
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
  // Skip if in input
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
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKey)
})
</script>

<template>
  <v-container fluid class="pa-4">
    <!-- Header -->
    <div class="d-flex align-center mb-3" style="gap: 12px;">
      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-plus"
        title="Vytvořit nový přístroj (N)"
        @click="openCreate"
      >
        Nový přístroj
      </v-btn>

      <v-spacer />

      <!-- Selection info -->
      <v-fade-transition>
        <v-chip
          v-if="selectedIds.size > 0"
          color="primary"
          variant="tonal"
          closable
          @click:close="clearSelection"
        >
          Vybráno: {{ selectedIds.size }}
        </v-chip>
      </v-fade-transition>

      <!-- Bulk actions -->
      <v-btn
        variant="tonal"
        color="error"
        :disabled="selectedIds.size === 0 || ! canDeactivate"
        :loading="bulkLoading"
        prepend-icon="mdi-close-circle-outline"
        title="Deaktivovat vybrané (A)"
        @click="bulkDeactivate"
      >
        Deaktivovat
      </v-btn>
      <v-btn
        variant="tonal"
        color="success"
        :disabled="selectedIds.size === 0 || !canReactivate"
        :loading="bulkLoading"
        prepend-icon="mdi-check-circle-outline"
        title="Reaktivovat vybrané (R)"
        @click="bulkReactivate"
      >
        Reaktivovat
      </v-btn>

      <v-divider vertical class="mx-2" />

      <v-switch
        v-model="showOnlyActive"
        inset
        density="comfortable"
        hide-details
        color="primary"
        label="Pouze aktivní"
      />
      <v-text-field
        v-model="filterText"
        label="Filtrovat"
        variant="outlined"
        density="comfortable"
        hide-details="auto"
        style="max-width: 260px"
        prepend-inner-icon="mdi-magnify"
        clearable
        title="Filtrovat"
      />
    </div>

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

    <!-- Table -->
    <v-table class="elevation-1 devices-table">
      <thead>
      <tr>
        <th style="width: 48px;">
          <v-checkbox
            :model-value="selectedIds.size > 0 && selectedIds.size === filtered.length"
            :indeterminate="selectedIds.size > 0 && selectedIds.size < filtered.length"
            hide-details
            density="compact"
            @update:model-value="v => v ?  selectAll() : clearSelection()"
          />
        </th>
        <th style="width: 140px;">Kód</th>
        <th>Název</th>
        <th style="width: 100px;">Barva</th>
        <th style="width: 100px;">Stav</th>
      </tr>
      </thead>
      <tbody>
      <tr
        v-for="d in filtered"
        :key="d.id"
        class="device-row"
        :class="{
            'row-selected': isSelected(d.id),
            'row-inactive': !d.active
          }"
        @click="handleRowClick(d, $event)"
      >
        <td @click.stop>
          <v-checkbox
            :model-value="isSelected(d.id)"
            hide-details
            density="compact"
            @update:model-value="v => {
                const newSet = new Set(selectedIds)
                v ?  newSet.add(d.id) : newSet.delete(d.id)
                selectedIds = newSet
                lastClickedId = d.id
              }"
          />
        </td>
        <td>
          <v-chip
            size="small"
            :color="d.color || 'primary'"
            variant="flat"
          >
            {{ d.code }}
          </v-chip>
        </td>
        <td class="font-weight-medium">{{ d.name }}</td>
        <td>
          <div
            v-if="d.color"
            class="color-swatch"
            :style="{ backgroundColor: d.color }"
            :title="d.color"
          />
          <span v-else class="text-medium-emphasis">—</span>
        </td>
        <td>
          <v-chip
            size="small"
            :color="d.active ? 'success' : 'grey'"
            :variant="d.active ? 'flat' : 'tonal'"
          >
            <v-icon size="14" start>
              {{ d.active ? 'mdi-check-circle' : 'mdi-close-circle' }}
            </v-icon>
            {{ d.active ? 'Aktivní' : 'Neaktivní' }}
          </v-chip>
        </td>
      </tr>
      </tbody>
    </v-table>

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
</template>

<style scoped>
.devices-table {
  border-radius: 8px;
  overflow: hidden;
}

.device-row {
  cursor: pointer;
  transition: background-color 0.15s;
}

.device-row:hover {
  background-color: #f5f5f5;
}

.row-selected {
  background-color: #e3f2fd ! important;
}

.row-inactive {
  opacity: 0.7;
}

.row-inactive td {
  color: rgba(0, 0, 0, 0.5);
}

.color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
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
</style>
