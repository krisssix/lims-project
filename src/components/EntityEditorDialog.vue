<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import Dialog from '@/components/Dialog.vue'

type Mode = 'create' | 'edit'

const props = withDefaults(defineProps<{
  isOpen: boolean
  width?: string | null
  entityLabel: string            // e.g. "rezervace"
  mode: Mode                     // 'create' | 'edit'
  saving?: boolean               // show loading on Save
  deletable?: boolean            // show Delete button (usually only in edit mode)
}>(), {
  width: null,
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

// Keyboard shortcuts inside the dialog:
// - Enter or Ctrl/Cmd+S → Save
// - Esc → Cancel/Close
// - Del (only in edit mode and deletable) → Delete
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

  if (key === 'enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
    // avoid submitting while focusing buttons (they already call save)
    const tgt = e.target as HTMLElement | null
    const tag = (tgt?.tagName || '').toLowerCase()
    // allow Enter from inputs and the dialog body
    if (['input', 'textarea', 'select', 'div'].includes(tag)) {
      e.preventDefault()
      if (!props.saving) save()
    }
    return
  }

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
    :hide-footer="false"
    @after-leave="() => emit('update:isOpen', false)"
  >
    <template #header>
      <div class="d-flex align-center justify-space-between w-100">
        <div class="text-h6">
          {{ mode === 'create' ? `Vytvořit ${entityLabel}` : `Upravit ${entityLabel}` }}
        </div>
        <div class="d-flex align-center" style="gap: 6px;">
          <!-- Optional right-side header slot (e.g., prev/next buttons) -->
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
      <!-- Consumer provides the form via default slot -->
      <slot />
    </template>

    <template #footer>
      <div class="d-flex w-100 align-center justify-end ga-2">
        <v-btn
          v-if="mode === 'edit' && deletable"
          color="red-darken-2"
          variant="text"
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
