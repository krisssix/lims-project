<script setup lang="ts">
import { onMounted, ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useDeviceStore, type Device } from '@/stores/devices'
import Dialog from '@/components/Dialog.vue'
import DeviceInlineCreate from '@/components/device/DeviceInlineCreate.vue'

const route = useRoute()
const projectId = Number((route.params as { projectId?: string }).projectId ?? 0)

const store = useDeviceStore()
const loading = computed(() => store.loading)
const errorText = computed(() => store.errorText)

// Přepínač aktivních
const showOnlyActive = ref(true)
const filterText = ref<string>('')

// Využij kompletní seznam a filtruj dle přepínače
const baseList = computed<Device[]>(() => store.allDevices.length ? store.allDevices : store.devices)
const filtered = computed<Device[]>(() => {
  const base = showOnlyActive.value ? baseList.value.filter(d => d.active) : baseList.value
  const q = filterText.value.trim().toLowerCase()
  if (!q) return base
  return base.filter(d => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q))
})

// Výběr řádku
const selectionId = ref<number | null>(null)
function selectRow(id: number): void { selectionId.value = id }

// Inline create
const inlineCreateOpen = ref(false)
function openCreate(): void { inlineCreateOpen.value = true }
function closeInlineCreate(): void { inlineCreateOpen.value = false }
function handleCreated(dev: { id: number; code: string; name: string; color?: string | null; active: boolean }): void {
  selectionId.value = dev.id
  inlineCreateOpen.value = false
  nextTick(() => document.querySelector<HTMLInputElement>('[data-device-filter]')?.focus())
}

// Edit dialog
const editOpen = ref(false)
const eName = ref<string>('')
const eColor = ref<string | null>(null)
const eSaving = ref(false)
function openEdit(): void {
  const sel = filtered.value.find(d => d.id === selectionId.value)
  if (!sel) return
  eName.value = sel.name
  eColor.value = sel.color ?? null
  editOpen.value = true
  nextTick(() => document.querySelector<HTMLInputElement>('[data-device-name]')?.focus())
}
async function confirmEdit(): Promise<void> {
  const sel = filtered.value.find(d => d.id === selectionId.value)
  if (!sel || eSaving.value) return
  eSaving.value = true
  try {
    await store.updateDevice(sel.id, { name: eName.value.trim() || sel.name, color: (eColor.value ?? undefined) })
    editOpen.value = false
  } finally {
    eSaving.value = false
  }
}

// Aktivace/Deaktivace
async function deactivateSelected(): Promise<void> {
  const sel = filtered.value.find(d => d.id === selectionId.value)
  if (!sel) return
  await store.deactivateDevice(sel.id)
}
async function reactivateSelected(): Promise<void> {
  const sel = filtered.value.find(d => d.id === selectionId.value)
  if (!sel) return
  await store.reactivateDevice(sel.id)
}

// Hotkeys
function focusFilter(): void {
  document.querySelector<HTMLInputElement>('[data-device-filter]')?.focus()
}
function handleKey(e: KeyboardEvent): void {
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey

  if (key === 'escape') {
    if (inlineCreateOpen.value) { inlineCreateOpen.value = false; return }
    if (editOpen.value) { editOpen.value = false; return }
    return
  }
  if (ctrl && key === 'f') { e.preventDefault(); focusFilter(); return }
  if (key === 'n') { e.preventDefault(); openCreate(); return }
 // if (key === 'e') { e.preventDefault(); openEdit(); return }
  if (key === 'a') { e.preventDefault(); deactivateSelected(); return }
 // if (key === 'r') { e.preventDefault(); reactivateSelected(); return }
  if (ctrl && key === 's') {
    e.preventDefault()
    if (editOpen.value) { void confirmEdit(); return }
  }
  if (alt && (key === 'arrowdown' || key === 'arrowup')) {
    e.preventDefault()
    const ids = filtered.value.map(d => d.id)
    if (!ids.length) return
    const idx = ids.indexOf(selectionId.value ?? ids[0]!)
    const nextIdx = key === 'arrowdown' ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1)
    selectionId.value = ids[nextIdx]!
    return
  }
}

onMounted(async () => {
  // Na stránce zařízení načítáme kompletní seznam
  await store.fetchAll()
  window.addEventListener('keydown', handleKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))
</script>

<template>
  <v-container
    fluid
    class="pa-4"
  >
    <div
      class="d-flex align-center mb-3"
      style="gap:12px;"
    >
      <v-btn
        color="primary"
        variant="flat"
        title="Vytvořit nový přístroj (N)"
        @click="openCreate"
      >
        Vytvoření přístroje
      </v-btn>

      <v-spacer />
      <v-switch
        v-model="showOnlyActive"
        inset
        density="comfortable"
        hide-details
        color="primary"
        label="Pouze aktivní"
        title="Toggle pouze aktivní"
      />
      <v-text-field
        v-model="filterText"
        label="Filtrovat"
        variant="outlined"
        density="comfortable"
        hide-details="auto"
        style="max-width:260px"
        data-device-filter
        title="Filtrovat (Ctrl+F)"
      />
      <v-btn
        variant="text"
        :disabled="selectionId == null"
        title="Upravit (E)"
        @click="openEdit"
      >
        Upravit (E)
      </v-btn>
      <v-btn
        variant="text"
        color="error"
        :disabled="selectionId == null"
        title="Deaktivovat (A)"
        @click="deactivateSelected"
      >
        Deaktivovat (A)
      </v-btn>
      <v-btn
        variant="text"
        color="green-darken-2"
        :disabled="selectionId == null"
        title="Reaktivovat (R)"
        @click="reactivateSelected"
      >
        Reaktivovat (R)
      </v-btn>
    </div>

    <v-alert
      v-if="errorText"
      type="error"
      variant="tonal"
      class="mb-3"
    >
      {{ errorText }}
    </v-alert>

    <!-- Inline Create Dialog (reuse) -->
    <DeviceInlineCreate
      :open="inlineCreateOpen"
      autofocus
      @close="closeInlineCreate"
      @created="handleCreated"
    />

    <v-table class="elevation-1">
      <thead>
        <tr>
          <th style="width:80px">
            ID
          </th>
          <th style="width:140px">
            Kód
          </th>
          <th>Název</th>
          <th style="width:120px">
            Barva
          </th>
          <th style="width:120px">
            Aktivní
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="d in filtered"
          :key="d.id"
          :class="{ 'row-selected': selectionId === d.id }"
          @click="selectRow(d.id)"
        >
          <td>{{ d.id }}</td>
          <td>
            <v-chip
              size="small"
              :color="d.color || 'primary'"
              variant="flat"
            >
              {{ d.code }}
            </v-chip>
          </td>
          <td>{{ d.name }}</td>
          <td>{{ d.color || '—' }}</td>
          <td>
            <v-icon :color="d.active ? 'green-darken-2' : 'error'">
              {{ d.active ? 'mdi-check-circle-outline' : 'mdi-close-circle-outline' }}
            </v-icon>
          </td>
        </tr>
      </tbody>
    </v-table>

    <!-- Edit dialog -->
    <Dialog
      :is-open="editOpen"
      width="520px"
      :hide-footer="true"
      @update:is-open="v => editOpen = v"
    >
      <template #content>
        <form
          class="pa-4"
          @submit.prevent="confirmEdit"
          @keydown.enter.prevent="confirmEdit"
        >
          <div class="text-h6 mb-3">
            Upravit přístroj
          </div>
          <v-text-field
            v-model="eName"
            label="Název"
            variant="outlined"
            density="comfortable"
            data-device-name
            hide-details="auto"
          />
          <v-text-field
            v-model="eColor"
            :model-value="(eColor ?? '').toString()"
            label="Barva"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
          />
          <div
            class="d-flex mt-3"
            style="gap:12px;"
          >
            <v-btn
              color="primary"
              variant="flat"
              :loading="eSaving"
              @click="confirmEdit"
            >
              Uložit (Ctrl+S)
            </v-btn>
            <v-spacer />
            <v-btn
              variant="text"
              @click="editOpen = false"
            >
              Zrušit (Esc)
            </v-btn>
          </div>
        </form>
      </template>
    </Dialog>
  </v-container>
</template>

<style scoped>
.row-selected { background: #f4f7fb; }
</style>
