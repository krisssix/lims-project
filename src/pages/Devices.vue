<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useDeviceStore, type Device } from '@/stores/devices'
import DeviceCreateDialog from '@/components/device/DeviceCreateDialog.vue'
import DeviceDetailDialog from '@/components/device/DeviceDetailDialog.vue'
import SearchBar from '@/components/ui/SearchBar.vue'
import ModernSwitch from '@/components/ui/ModernSwitch.vue'

const store = useDeviceStore()
const errorText = computed(() => store.errorText)

// View mode: 'grid' or 'table'
const viewMode = ref<'grid' | 'table'>('table')

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

// Statistics
const stats = computed(() => ({
  total: baseList.value.length,
  active: baseList.value.filter(d => d.active).length,
  inactive: baseList.value.filter(d => !d.active).length,
  filtered: filtered.value.length
}))

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

function handleCardClick(device: Device, event: MouseEvent): void {
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

function toggleSelection(device: Device): void {
  const newSet = new Set(selectedIds.value)
  if (newSet.has(device.id)) {
    newSet.delete(device.id)
  } else {
    newSet.add(device.id)
  }
  selectedIds.value = newSet
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
  { title: 'Kód přístroje', key: 'code', width: '150px', sortable: true },
  { title: 'Název přístroje', key: 'name', sortable: true },
  { title: 'Stav', key: 'active', width: '120px', sortable: true },
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
    await store.bulkDeactivate(Array.from(selectedIds.value))
    clearSelection()
  } finally {
    bulkLoading.value = false
  }
}

async function bulkReactivate(): Promise<void> {
  if (selectedIds.value.size === 0 || bulkLoading.value) return
  bulkLoading.value = true
  try {
    await store.bulkReactivate(Array.from(selectedIds.value))
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

// Helper to darken color for gradient
function adjustColor(color: string): string {
  // Simple darkening by reducing lightness
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    const darken = (val: number) => Math.max(0, Math.floor(val * 0.8))
    return `#${darken(r).toString(16).padStart(2, '0')}${darken(g).toString(16).padStart(2, '0')}${darken(b).toString(16).padStart(2, '0')}`
  }
  return color
}
</script>

<template>
  <v-container
    fluid
    class="pa-0"
    style="background: linear-gradient(to bottom, #f8fafc 0%, #f1f5f9 100%);"
  >
    <!-- Top Toolbar -->
    <div class="top-toolbar">
      <!-- Primary Action -->
      <button
        class="btn-primary"
        @click="openCreate"
      >
        <i class="mdi mdi-plus" />
        Nový přístroj
      </button>

      <div
        class="view-selector-modern"
        style="margin-left: auto;"
      >
        <button
          :class="['view-option-modern', { active: viewMode === 'table' }]"
          @click="viewMode = 'table'"
        >
          <i class="mdi mdi-view-list" />
          Tabulka
        </button>
        <button
          :class="['view-option-modern', { active: viewMode === 'grid' }]"
          @click="viewMode = 'grid'"
        >
          <i class="mdi mdi-view-grid" />
          Karty
        </button>
      </div>
    </div>

    <v-container
      fluid
      class="pa-6"
    >
      <!-- Error Alert -->
      <v-scroll-y-transition>
        <v-alert
          v-if="errorText"
          type="error"
          variant="tonal"
          closable
          rounded="lg"
          class="mb-6"
        >
          {{ errorText }}
        </v-alert>
      </v-scroll-y-transition>
       
      <!-- Statistics Cards -->
      <v-row class="mb-6">
        <v-col
          cols="12"
          sm="6"
          md="4"
        >
          <v-card
            flat
            class="pa-4 rounded-xl border"
            style="background: #eff6ff;"
          >
            <div
              class="text-h3 font-weight-bold"
              style="color: #3b82f6;"
            >
              {{ stats.total }}
            </div>
            <div
              class="text-caption"
              style="color: #64748b;"
            >
              Celkem přístrojů
            </div>
          </v-card>
        </v-col>
          
        <v-col
          cols="12"
          sm="6"
          md="4"
        >
          <v-card
            flat
            class="pa-4 rounded-xl border"
            style="background: #f0fdf4;"
          >
            <div
              class="text-h3 font-weight-bold"
              style="color: #10b981;"
            >
              {{ stats.active }}
            </div>
            <div
              class="text-caption"
              style="color: #64748b;"
            >
              Aktivních
            </div>
          </v-card>
        </v-col>
          
        <v-col
          cols="12"
          sm="6"
          md="4"
        >
          <v-card
            flat
            class="pa-4 rounded-xl border"
            style="background: #fef2f2;"
          >
            <div
              class="text-h3 font-weight-bold"
              style="color: #ef4444;"
            >
              {{ stats.inactive }}
            </div>
            <div
              class="text-caption"
              style="color: #64748b;"
            >
              Neaktivních
            </div>
          </v-card>
        </v-col>
      </v-row>
       
      <!-- Content Card -->
      <v-card
        flat
        class="rounded-xl overflow-hidden elevation-2"
        style="border: 1px solid #e2e8f0;"
      >
        <!-- Filter Toolbar -->
        <div class="filter-toolbar-modern">
          <div class="search-field-modern">
            <SearchBar
              v-model="filterText"
              placeholder="Hledat přístroje..."
            />
          </div>
              
          <ModernSwitch
            v-model="showOnlyActive"
            label="Pouze aktivní"
            class="ml-auto"
          />
        </div>
          
        <!-- Bulk Actions Header -->
        <v-expand-transition>
          <div
            v-if="selectedIds.size > 0"
            class="px-4 py-3 d-flex align-center"
            style="background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-bottom: 1px solid #93c5fd;"
          >
            <v-icon
              color="primary"
              class="mr-2"
            >
              mdi-checkbox-marked-circle
            </v-icon>
            <span class="text-subtitle-2 text-primary font-weight-bold mr-4">
              {{ selectedIds.size }} {{ selectedIds.size === 1 ? 'přístroj vybrán' : selectedIds.size < 5 ? 'přístroje vybrány' : 'přístrojů vybráno' }}
            </span>
            <v-divider
              vertical
              class="mx-2"
            />
                 
            <v-btn
              size="small"
              variant="flat"
              color="error"
              prepend-icon="mdi-close-circle"
              rounded="lg"
              :loading="bulkLoading"
              :disabled="!canDeactivate"
              class="mr-2"
              @click="bulkDeactivate"
            >
              Deaktivovat
            </v-btn>
                 
            <v-btn
              size="small"
              variant="flat"
              color="success"
              prepend-icon="mdi-check-circle"
              rounded="lg"
              :loading="bulkLoading"
              :disabled="!canReactivate"
              @click="bulkReactivate"
            >
              Aktivovat
            </v-btn>
                 
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              rounded="lg"
              @click="clearSelection"
            >
              <v-icon class="mr-1">
                mdi-close
              </v-icon>
              Zrušit výběr
            </v-btn>
          </div>
        </v-expand-transition>
          
        <!-- Grid View Content -->
        <div
          v-if="viewMode === 'grid'"
          class="pa-4"
          style="min-height: 400px; background: #fafbfc;"
        >
          <div
            v-if="shiftPressed"
            class="text-center mb-4"
          >
            <v-chip
              color="secondary"
              size="small"
              prepend-icon="mdi-select-drag"
              rounded="lg"
            >
              Režim výběru rozsahu (Shift)
            </v-chip>
          </div>
             
          <v-row>
            <v-col
              v-for="device in filtered"
              :key="device.id"
              cols="12"
              sm="6"
              md="4"
              lg="3"
              xl="2"
            >
              <v-card
                flat
                class="device-card-modern"
                :class="{ 'device-card-selected': isSelected(device.id) }"
                @click="handleCardClick(device, $event)"
              >
                <div class="d-flex justify-space-between align-center px-3 pt-3">
                  <v-checkbox-btn
                    :model-value="isSelected(device.id)"
                    density="compact"
                    color="primary"
                    @click.stop="toggleSelection(device)"
                  />
                        
                  <v-chip
                    size="x-small"
                    :color="device.active ? 'success' : 'grey'"
                    variant="flat"
                    rounded="lg"
                  >
                    {{ device.active ? 'Aktivní' : 'Neaktivní' }}
                  </v-chip>
                </div>
                     
                <v-card-text class="text-center pt-2 pb-4">
                  <v-avatar
                    :style="{ background: `linear-gradient(135deg, ${device.color || '#3b82f6'} 0%, ${adjustColor(device.color || '#3b82f6')} 100%)` }"
                    size="64"
                    class="mb-3 elevation-4"
                  >
                    <span class="text-h5 font-weight-bold text-white">{{ device.code }}</span>
                  </v-avatar>
                         
                  <div class="text-subtitle-1 font-weight-bold text-truncate px-2">
                    {{ device.name }}
                  </div>
                  <div class="text-caption text-medium-emphasis">
                    {{ device.code }}
                  </div>
                </v-card-text>
                     
                <v-divider />
                <v-card-actions>
                  <v-btn
                    block
                    variant="text"
                    size="small"
                    color="primary"
                    rounded="lg"
                    @click.stop="openDetail(device)"
                  >
                    <v-icon class="mr-1">
                      mdi-eye
                    </v-icon>
                    Detail
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>
                
            <v-col
              v-if="filtered.length === 0"
              cols="12"
            >
              <div class="text-center py-16">
                <v-avatar
                  size="80"
                  color="grey-lighten-3"
                  class="mb-4"
                >
                  <v-icon
                    size="48"
                    color="grey-darken-1"
                  >
                    mdi-flask-off
                  </v-icon>
                </v-avatar>
                <div class="text-h6 text-grey-darken-2 mb-2">
                  Žádné přístroje nenalezeny
                </div>
                <div class="text-body-2 text-grey">
                  Zkuste upravit filtry nebo přidat nový přístroj
                </div>
              </div>
            </v-col>
          </v-row>
        </div>
          
        <!-- Table View Content -->
        <v-data-table
          v-else
          v-model="selectedIdsArray"
          :items="filtered"
          :headers="tableHeaders"
          :items-per-page="15"
          show-select
          hover
          item-value="id"
          density="comfortable"
          class="device-data-table"
        >
          <template #item.name="{ item }">
            <div
              class="d-flex align-center cursor-pointer font-weight-medium py-2"
              @click="openDetail(item)"
            >
              {{ item.name }}
            </div>
          </template>
          <template #item.active="{ item }">
            <v-chip
              size="x-small"
              :color="item.active ? 'success' : 'grey'"
              variant="flat"
              rounded="lg"
            >
              {{ item.active ? 'Aktivní' : 'Neaktivní' }}
            </v-chip>
          </template>
          <template #item.code="{ item }">
            <v-chip
              size="small"
              :color="item.color || 'blue'"
              variant="flat"
              class="font-weight-bold"
              rounded="lg"
            >
              {{ item.code }}
            </v-chip>
          </template>
          <template #no-data>
            <div class="text-center py-12">
              <v-avatar
                size="64"
                color="grey-lighten-3"
                class="mb-3"
              >
                <v-icon
                  size="36"
                  color="grey-darken-1"
                >
                  mdi-flask-off
                </v-icon>
              </v-avatar>
              <div class="text-h6 text-grey-darken-2">
                Žádné přístroje
              </div>
            </div>
          </template>
        </v-data-table>
      </v-card>
    </v-container>

    <!-- Dialogs -->
    <DeviceCreateDialog
      v-model="createDialogOpen"
      @created="handleCreated"
    />
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
/* Top Toolbar */
.top-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 40px;
  background: white;
  border-bottom: 1px solid #e9ecef;
}

/* Modern Primary Button */
.btn-primary-modern {
  min-width: 140px;
  height: 40px;
  padding: 10px 24px;
  border: none;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.btn-primary-modern:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);
}

.btn-primary-modern i {
  font-size: 18px;
}

/* Modern View Selector */
.view-selector-modern {
  display: inline-flex;
  background: #f8f9fa;
  border-radius: 10px;
  padding: 4px;
  gap: 4px;
}

.view-option-modern {
  height: 36px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: #6c757d;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600; /* Use consistent weight */
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;
}

.view-option-modern:hover {
  background: #e9ecef;
  color: #495057;
}

.view-option-modern.active {
  background: white;
  color: #667eea;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.view-option-modern i {
  font-size: 18px;
}

/* Modern Filter Toolbar */
.filter-toolbar-modern {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
}

.search-field-modern {
  flex: 1;
  max-width: 400px;
}

/* Modern Device Cards */
.device-card-modern {
  border: 2px solid #e2e8f0;
  border-radius: 16px;
  background: white;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  height: 100%;
}

.device-card-modern:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.12) !important;
  border-color: #cbd5e1;
}

.device-card-selected {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%) !important;
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1), 0 8px 16px rgba(59, 130, 246, 0.15) !important;
}

/* Responsive */
@media (max-width: 1200px) {
  .top-toolbar {
    padding: 20px 24px;
  }
  
  .filter-toolbar-modern {
    padding: 16px 20px;
  }
}

@media (max-width: 768px) {
  .top-toolbar {
    padding: 16px 20px;
    flex-wrap: wrap;
  }
  
  .filter-toolbar-modern {
    padding: 16px 20px;
    flex-direction: column;
    align-items: stretch;
  }
  
  .search-field-modern {
    max-width: 100%;
  }
  
  .toggle-switch-wrapper {
    margin-left: 0;
    justify-content: flex-start;
  }
}
</style>
