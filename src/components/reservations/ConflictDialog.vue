<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import Dialog from '@/components/Dialog.vue'

type Slot = { start: Date; end: Date }

const props = defineProps<{
  open: boolean
  deviceName: string
  requested: Slot
  proposals: Array<{ slot: Slot; label: string }>
  fallbackNextDay?: { day: Date; slot: Slot } | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', slot: Slot): void
  (e: 'suggest-next-day'): void
  (e: 'cancel'): void
}>()

const selectedIdx = ref<number>(0)
const fmt = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' })
const fmtDay = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: '2-digit', month: '2-digit' })

const openComputed = computed({
  get: () => props.open,
  set: v => emit('update:open', v)
})

function labelOf(slot: Slot): string {
  return `${fmt.format(slot.start)} – ${fmt.format(slot.end)}`
}

function confirmSelected(): void {
  const item = props.proposals[selectedIdx.value]
  if (item) emit('confirm', item.slot)
}

function onKey(e: KeyboardEvent): void {
  if (!openComputed.value) return
  const k = e.key.toLowerCase()
  const alt = e.altKey
  if (k === 'escape') { e.preventDefault(); emit('cancel'); openComputed.value = false; return }
  if (k === 'enter') { e.preventDefault(); confirmSelected(); return }
  if (alt && (k === 'arrowdown' || k === 'arrowup')) {
    e.preventDefault()
    const next = k === 'arrowdown'
      ? Math.min(props.proposals.length - 1, selectedIdx.value + 1)
      : Math.max(0, selectedIdx.value - 1)
    selectedIdx.value = next
    nextTick(() => {
      const el = document.querySelector<HTMLElement>('[data-proposal-focus]')
      el?.focus()
    })
  }
  if (alt && k === 'j' && props.fallbackNextDay) { e.preventDefault(); emit('suggest-next-day') }
}

watch(openComputed, v => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Dialog
    v-model:is-open="openComputed"
    width="560px"
    :hide-footer="true"
  >
    <template #header>
      <div class="text-subtitle-1 font-weight-600">
        Kolize na {{ deviceName }}
      </div>
      <div class="text-caption text-medium-emphasis mt-1">
        Požadováno: {{ labelOf(requested) }}
      </div>
    </template>
    <template #content>
      <div class="pa-2">
        <div class="text-caption text-medium-emphasis mb-2">
          Vyberte nejbližší volný slot (Alt+↑/↓, Enter potvrdit)
        </div>
        <v-list density="comfortable">
          <v-list-item
            v-for="(p, i) in proposals"
            :key="i"
            :title="p.label"
            :subtitle="labelOf(p.slot)"
            :active="i === selectedIdx"
            data-proposal-focus
            role="button"
            tabindex="0"
            @click="selectedIdx = i"
            @dblclick="confirmSelected"
          />
        </v-list>

        <v-expand-transition>
          <v-alert
            v-if="fallbackNextDay"
            type="info"
            variant="tonal"
            class="mt-3"
          >
            <div>
              Nejbližší volný den: {{ fmtDay.format(fallbackNextDay.day) }},
              {{ labelOf(fallbackNextDay.slot) }}
            </div>
            <div class="mt-2">
              <v-btn
                color="primary"
                variant="flat"
                title="Navrhnout další den (Alt+J)"
                @click="$emit('suggest-next-day')"
              >
                Navrhnout další den
              </v-btn>
            </div>
          </v-alert>
        </v-expand-transition>

        <div class="mt-4 d-flex justify-end ga-2">
          <v-btn
            variant="text"
            @click="$emit('cancel')"
          >
            Zrušit
          </v-btn>
          <v-spacer />
          <v-btn
            color="primary"
            variant="flat"
            @click="confirmSelected"
          >
            Přesunout
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
</style>
