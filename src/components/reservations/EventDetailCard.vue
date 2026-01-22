<script setup lang="ts">
type ResItem = {
  id: number
  title: string
  deviceId: string
  start: string
  end: string
  status: 'plan' | 'running' | 'done'
  username: string | null
  note: string | null
}

const props = defineProps<{
  item: ResItem
  color: string
  deviceName?: string
  isInactive?: boolean
  fmtDetailDate: (d: Date) => string
  fmtDetailTime: (d: Date) => string
  onEdit: (i: ResItem) => void
  onDelete: (i: ResItem) => void
  // Parent must close both: v-menu (isActive.value=false) and its own open map (setMenuOpen(id,false))
  onClose: () => void
}>()

function closeMenu() {
  props.onClose()
}

function onKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase()

  if (key === 'escape') {
    e.stopPropagation()
    e.preventDefault()
    closeMenu()
    return
  }

  if (key === 'delete') {
    e.stopPropagation()
    e.preventDefault()
    closeMenu()
    props.onDelete(props.item)
    return
  }

  if (key === 'enter') {
    e.stopPropagation()
    e.preventDefault()
    props.onEdit(props.item)
  }
}

// Close the menu on mousedown first to avoid "sticky" v-menu,
// then let the click handler perform the action.
function onCloseMouseDown(ev: MouseEvent) {
  ev.stopPropagation()
  ev.preventDefault()
  closeMenu()
}
</script>

<template>
  <v-card
    class="detail-card pa-3"
    tabindex="0"
    @keydown="onKeydown"
  >
    <div class="d-flex align-start">
      <v-icon
        :color="color"
        size="16"
        class="mr-3 mt-1"
      >
        mdi-checkbox-blank-circle
      </v-icon>

      <div class="flex-grow-1">
        <div class="d-flex align-center justify-space-between mb-1">
          <div class="text-subtitle-1 font-weight-medium">
            {{ item.title }}
          </div>
          <div class="d-flex align-center">
            <v-btn
              size="small"
              variant="text"
              title="Upravit (Enter)"
              @mousedown.stop.prevent="onCloseMouseDown"
              @click.stop.prevent="() => props.onEdit(item)"
            >
              <v-icon icon="mdi-pencil-outline" />
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              title="Smazat (Del)"
              color="red-darken-2"
              @mousedown.stop.prevent="onCloseMouseDown"
              @click.stop.prevent="() => props.onDelete(item)"
            >
              <v-icon icon="mdi-delete-outline" />
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              title="Zavřít (Esc)"
              @mousedown.stop.prevent="onCloseMouseDown"
              @click.stop.prevent="closeMenu"
            >
              <v-icon icon="mdi-close" />
            </v-btn>
          </div>
        </div>

        <div class="d-flex align-center text-medium-emphasis mt-1">
          <v-icon
            size="18"
            class="mr-2"
            icon="mdi-calendar-clock"
          />
          <div class="text-body-2">
            {{ fmtDetailDate(new Date(item.start)) }} ·
            {{ fmtDetailTime(new Date(item.start)) }} – {{ fmtDetailTime(new Date(item.end)) }}
          </div>
        </div>

        <div class="d-flex align-center text-medium-emphasis mt-2">
          <v-icon
            size="18"
            class="mr-2"
            icon="mdi-account-outline"
          />
          <div class="text-body-2">
            {{ item.username ?? '—' }}
          </div>
        </div>

        <!-- Inactive device indicator -->
        <div
          v-if="props.isInactive"
          class="d-flex align-center mt-2"
        >
          <v-chip
            size="small"
            color="grey"
            variant="tonal"
            prepend-icon="mdi-power-off"
          >
            Neaktivní zařízení
          </v-chip>
        </div>

        <div
          v-if="item.note && item.note.trim().length"
          class="d-flex align-center text-medium-emphasis mt-2"
        >
          <v-icon
            size="18"
            class="mr-2"
            icon="mdi-text"
          />
          <div
            class="text-body-2 text-ellipsis"
            :title="item.note"
          >
            {{ item.note }}
          </div>
        </div>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.detail-card { background: #eceff1; border-radius: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
.text-ellipsis { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
