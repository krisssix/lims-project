<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import Dialog from '@/components/Dialog.vue'

type Mode = 'create' | 'edit'

const props = withDefaults(defineProps<{
  isOpen: boolean
  width?: string
  maxHeight?: string
  entityLabel: string            // např. "rezervace" (entity label)
  mode: Mode                     // 'create' | 'edit' (režim: vytvořit nebo upravit)
  saving?: boolean               // zobrazit indikátor načítání při ukládání (saving)
  deletable?: boolean            // zobrazit tlačítko smazat (obvykle jen v režimu úprav) (deletable)
  titleExtra?: string            // doplňkový text za titulkem (volition text)
}>(), {
  saving: false,
  deletable: false,
})

const emit = defineEmits<{
  (e: 'update:isOpen', v: boolean): void
  (e: 'save'): void
  (e: 'delete'): void
  (e: 'cancel'): void
}>()

function close() {
  emit('update:isOpen', false)
  emit('cancel')
}

function save() {
  emit('save')
}

function del() {
  emit('delete')
}

// klávesové zkratky uvnitř dialogu:
// - ctrl/cmd + s: uložit (save)
// - esc: zrušit nebo zavřít (cancel/close)
// - del: smazat (pouze v režimu úprav a pokud je smazání povoleno) (delete)
function onKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase()

  if (key === 'escape') {
    e.preventDefault()
    close()
    return
  }

  if ((e.ctrlKey || e.metaKey) && key === 's') {
    e.preventDefault()
    if (!props.saving) save()
    return
  }

  // poznámka: klávesa enter již nespouští uložení, aby bylo možné víceřádkové zadávání v textových polích (text areas)

  if (key === 'delete' && props.mode === 'edit' && props.deletable) {
    e.preventDefault()
    del()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Dialog
    :is-open="isOpen"
    :width="width"
    :max-height="maxHeight"
    :hide-footer="false"
    @after-leave="() => emit('update:isOpen', false)"
  >
    <template #header>
      <div class="d-flex align-center justify-space-between w-100">
        <div class="text-h6">
          {{ mode === 'create' ? `Vytvořit ${entityLabel}` : `Upravit ${entityLabel}` }}
          <span
            v-if="titleExtra"
            class="ml-2 text-medium-emphasis"
          >· {{ titleExtra }}</span>
        </div>
        <div
          class="d-flex align-center"
          style="gap: 6px;"
        >
          <!-- volitelný slot pro pravou část záhlaví (např. tlačítka zpět a vpřed) (header-right) -->
          <slot name="header-right" />
          <v-btn
            icon="mdi-close"
            variant="text"
            @click="close"
          />
        </div>
      </div>
    </template>

    <template #content>
      <slot />
    </template>

    <template #footer>
      <div class="d-flex w-100 align-center justify-end ga-2">
        <v-btn
          v-if="mode === 'edit' && deletable"
          color="red-darken-2"
          variant="flat"
          prepend-icon="mdi-delete-outline"
          @click="del"
        >
          Smazat
        </v-btn>

        <v-spacer />

        <v-btn
          variant="text"
          @click="close"
        >
          Zrušit
        </v-btn>

        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="saving"
          prepend-icon="mdi-content-save"
          @click="save"
        >
          Uložit
        </v-btn>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
</style>
