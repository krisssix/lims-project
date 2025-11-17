<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Dialog from '@/components/Dialog.vue'
import { type TemplateItem } from '@/types/measurement-ui'

const props = defineProps<{
  modelValue: boolean
  templates: TemplateItem[]
  selectedTemplateId: string | null
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'create'): void
  (e: 'edit', item: TemplateItem): void
  (e: 'createBlank'): void
  (e: 'createFromFile'): void
}>()

const search = ref<string>('')

const filtered = computed<TemplateItem[]>(() => {
  const q = search.value.trim().toLowerCase()
  const src = props.templates
  const base = q
    ? src.filter(t => t.name.toLowerCase().includes(q) || t.deviceId.toLowerCase().includes(q))
    : src
  return [...base].sort((a, b) => a.name.localeCompare(b.name, 'cs'))
})

const itemRefs = new Map<string, HTMLElement>()
function setItemRef(id: string, el: Element | { $el?: Element } | null): void {
  const dom: HTMLElement | null =
    el && typeof el === 'object' && '$el' in el && el.$el instanceof HTMLElement
      ? (el.$el as HTMLElement)
      : (el instanceof HTMLElement ? el : null)
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
function close(): void { emits('update:modelValue', false) }
watch(() => props.modelValue, (v) => { if (v) void focusSelected() })
</script>

<template>
  <Dialog
    :is-open="props.modelValue"
    width="920px"
    height="808px"
    :hide-footer="false"
    class="templates-overview-dialog"
    @update:is-open="v => emits('update:modelValue', v)"
  >
    <template #header>
      <div class="templates-header">
        <div class="text-h6">
          Přehled šablon
        </div>
        <div class="templates-header-right">
          <v-text-field
            v-model="search"
            data-templates-search
            type="search"
            prepend-inner-icon="mdi-magnify"
            placeholder="Vyhledávání..."
            variant="outlined"
            density="comfortable"
            hide-details
            class="search flex-grow-1"
            clearable
          />
          <!-- Split create button with actions -->
          <v-menu location="bottom end" offset="6">
            <template #activator="{ props: menuProps }">
              <v-btn
                color="primary"
                class="ml-3"
                v-bind="menuProps"
                title="Nová šablona (Alt+B prázdná, Alt+I import)"
              >
                VYTVOŘIT ŠABLONU
                <v-icon end icon="mdi-menu-down" class="ml-1" />
              </v-btn>
            </template>
            <v-list density="comfortable">
              <v-list-item
                title="Prázdná šablona"
                subtitle="Ruční definice polí"
                @click="emits('createBlank')"
              >
                <template #prepend><v-icon icon="mdi-file-plus-outline" /></template>
                <template #append><span class="text-caption text-medium-emphasis">Alt+B</span></template>
              </v-list-item>
              <v-divider class="my-1" />
              <v-list-item
                title="Import šablony ze souboru"
                subtitle="CSV / TSV / TXT / Schránka"
                @click="emits('createFromFile')"
              >
                <template #prepend><v-icon icon="mdi-file-import" /></template>
                <template #append><span class="text-caption text-medium-emphasis">Alt+I</span></template>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
      </div>

      <div class="table-header mt-3">
        <div class="col-device text-caption text-medium-emphasis">Přístroj</div>
        <div class="col-name text-caption text-medium-emphasis">Název šablony</div>
      </div>
    </template>

    <template #content>
      <div class="table-body">
        <template
          v-for="tpl in filtered"
          :key="tpl.id"
        >
          <div
            :ref="el => setItemRef(tpl.id, el)"
            class="row template-row"
            :tabindex="0"
            :class="{ 'is-selected': tpl.id === props.selectedTemplateId }"
            @click="emits('edit', tpl)"
          >
            <div class="col-device d-flex align-center">
              <v-chip
                size="small"
                :color="tpl.deviceColor"
                text-color="white"
                class="device-chip"
              >
                {{ tpl.deviceId }}
              </v-chip>
            </div>
            <div class="col-name truncate">
              {{ tpl.name }}
            </div>
          </div>
          <v-divider />
        </template>
      </div>
    </template>

    <template #footer>
      <v-spacer />
      <v-btn
        variant="text"
        @click="close"
      >
        Zavřít
      </v-btn>
    </template>
  </Dialog>
</template>

<style scoped>
.templates-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.templates-header-right { display: flex; align-items: center; gap: 12px; width: 60%; }
.search { min-width: 240px; flex: 1 1 280px; max-width: 360px; }
.table-header { display: grid; grid-template-columns: 120px 1fr; padding: 4px 10px 6px 10px; }
.table-body { max-height: 420px; overflow-y: auto; }
.row.template-row { display: grid; grid-template-columns: 120px 1fr; align-items: center; padding: 8px 10px; border-radius: 10px; border: 2px solid transparent; transition: border-color .15s, background-color .15s; }
.row.template-row:hover { background: #f7f7fb; }
.row.template-row.is-selected, .row.template-row:focus-visible { border-color: var(--v-theme-deep-purple); outline: none; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
