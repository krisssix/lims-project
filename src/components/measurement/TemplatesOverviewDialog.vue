<script setup lang="ts">
import Dialog from '@/components/Dialog.vue'
import type { TemplateItem } from '@/stores/measurement'
import { computed } from 'vue'

const props = defineProps<{
  templates: TemplateItem[]
}>()

const isOpen = defineModel<boolean>('isOpen', { default: false })
const selectedId = defineModel<string | null>('selectedId', { default: null })
const search = defineModel<string>('search', { default: '' })

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'edit', item: TemplateItem): void
  (e: 'close'): void
}>()

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return [...props.templates]
    .filter(t => !q || t.name.toLowerCase().includes(q) || t.deviceId.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
})

function onClose() {
  isOpen.value = false
  emit('close')
}

function setItemRef(_id: string, _el: any) { /* noop (kept for API compatibility) */ }
</script>

<template>
  <Dialog v-model:is-open="isOpen" :hide-footer="false" width="920px" class="templates-overview-dialog">
    <template #header>
      <div class="templates-header">
        <div class="text-h6">Přehled šablon</div>
        <div class="templates-header-right">
          <v-text-field
            data-templates-search
            v-model="search"
            type="search"
            prepend-inner-icon="mdi-magnify"
            placeholder="Vyhledávání..."
            variant="outlined"
            density="comfortable"
            hide-details
            class="search flex-grow-1"
            clearable
          />
          <v-btn color="primary" class="ml-3" @click="$emit('create')">VYTVOŘIT ŠABLONU</v-btn>
        </div>
      </div>
      <div class="table-header mt-3">
        <div class="col-device text-caption text-medium-emphasis">Přístroj</div>
        <div class="col-name text-caption text-medium-emphasis">Název šablony</div>
      </div>
    </template>
    <template #content>
      <div class="table-body">
        <template v-for="tpl in filtered" :key="tpl.id">
          <div
            class="row template-row"
            :ref="el => setItemRef(tpl.id, el)"
            :tabindex="0"
            :class="{ 'is-selected': tpl.id === selectedId }"
            @click="$emit('edit', tpl)"
          >
            <div class="col-device d-flex align-center">
              <v-chip size="small" :color="tpl.deviceColor" text-color="white" class="device-chip">
                {{ tpl.deviceId }}
              </v-chip>
            </div>
            <div class="col-name truncate">{{ tpl.name }}</div>
          </div>
          <v-divider />
        </template>
      </div>
    </template>
    <template #footer>
      <v-spacer />
      <v-btn variant="text" @click="onClose">Zavřít</v-btn>
    </template>
  </Dialog>
</template>

<style scoped>
.templates-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.templates-header-right { display: flex; align-items: center; gap: 12px; width: 60%; }
.search { min-width: 240px; flex: 1 1 280px; max-width: 360px; }
.table-header { display: grid; grid-template-columns: 120px 1fr; padding: 4px 10px 6px 10px; }
.table-body { max-height: 420px; overflow-y: auto; }
.row.template-row { display: grid; grid-template-columns: 120px 1fr; align-items: center; padding: 8px 10px; border-radius: 10px; border: 2px solid transparent; transition: border-color .15s ease, background-color .15s ease; }
.row.template-row:hover { background: #f7f7fb; }
.row.template-row.is-selected, .row.template-row:focus-visible { border-color: var(--v-theme-deep-purple); background-color: transparent !important; outline: none; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
