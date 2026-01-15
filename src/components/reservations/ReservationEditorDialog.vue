<script setup lang="ts">
import { computed } from 'vue'
import Dialog from '@/components/Dialog.vue'
import RecurrenceEditor from '@/components/reservations/RecurrenceEditor.vue'
import type { RecurrenceRequest } from '@/stores/reservations'

const props = defineProps<{
  modelValue: boolean
  mode: 'create' | 'edit'
  saving: boolean
  title: string
  deviceCode: string
  username: string | null
  dateYmd: string
  startHM: string
  endHM: string
  note: string | null
  recurrence: RecurrenceRequest | null
  seriesId?: string | null
  seriesIndex?: number
  isException?: boolean
  devices: Array<{ id: string; name: string; color: string }>
  members: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'update:title', v: string): void
  (e: 'update:deviceCode', v: string): void
  (e: 'update:username', v: string | null): void
  (e: 'update:dateYmd', v: string): void
  (e: 'update:startHM', v: string): void
  (e: 'update:endHM', v: string): void
  (e: 'update:note', v: string | null): void
  (e: 'update:recurrence', v: RecurrenceRequest | null): void
  (e: 'save'): void
  (e: 'delete'): void
  (e: 'cancel'): void
}>()

// Computed date object for RecurrenceEditor
const parsedDate = computed(() => {
  if (!props.dateYmd) return new Date()
  const [y, m, d] = props.dateYmd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
})

const isSeries = computed(() => !!props.seriesId)

function onSave() {
  emit('save')
}

function onDelete() {
  emit('delete')
}

function onClose() {
  emit('update:modelValue', false)
  emit('cancel')
}
</script>

<template>
  <Dialog
    :is-open="modelValue"
    :width="550"
    :title="mode === 'create' ? 'Nová rezervace' : 'Upravit rezervaci'"
    @update:is-open="v => { if(!v) onClose() }"
    :hide-footer="true"
  >
    <template #content>
      <div class="pa-4 d-flex flex-column gap-4">
        
        <!-- Header / Title -->
        <v-text-field
          :model-value="title"
          @update:model-value="v => emit('update:title', v)"
          label="Název rezervace"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
          autofocus
        />

        <!-- Device & User Row -->
        <div class="d-flex gap-3">
          <v-select
            :model-value="deviceCode"
            @update:model-value="v => emit('update:deviceCode', v)"
            :items="devices"
            item-title="name"
            item-value="id"
            label="Zařízení"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="flex-grow-1"
          >
            <template #selection="{ item }">
              <div class="d-flex align-center">
                <v-icon
                  size="12"
                  class="mr-2"
                  :color="item.raw.color || 'primary'"
                >mdi-circle</v-icon>
                {{ item.title }}
              </div>
            </template>
            <template #item="{ props, item }">
              <v-list-item v-bind="props">
                <template #prepend>
                   <v-icon
                    size="12"
                    :color="item.raw.color || 'primary'"
                    class="mr-2"
                   >mdi-circle</v-icon>
                </template>
              </v-list-item>
            </template>
          </v-select>

           <!-- Username (Admin/Self) - Assuming simple select or text -->
           <!-- If members list is provided, use select/autocomplete -->
          <v-autocomplete
            :model-value="username"
            @update:model-value="v => emit('update:username', v)"
            :items="members"
            label="Uživatel"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="flex-grow-1"
            clearable
          />
        </div>

        <!-- Date & Time Row -->
        <div class="d-flex gap-3 align-start">
          <div class="flex-grow-1">
             <v-text-field
                :model-value="dateYmd"
                @update:model-value="v => emit('update:dateYmd', v)"
                type="date"
                label="Datum"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
             />
          </div>
          <div style="width: 110px;">
              <v-text-field
                :model-value="startHM"
                @update:model-value="v => emit('update:startHM', v)"
                type="time"
                label="Od"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
             />
          </div>
          <div style="width: 110px;">
              <v-text-field
                :model-value="endHM"
                @update:model-value="v => emit('update:endHM', v)"
                type="time"
                label="Do"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
             />
          </div>
        </div>

        <!-- Recurrence Editor -->
        <div class="d-flex align-center justify-space-between pt-1">
          <div class="text-subtitle-2 text-medium-emphasis">Opakování</div>
          <RecurrenceEditor
            :model-value="recurrence"
            @update:model-value="v => emit('update:recurrence', v)"
            :start-date="parsedDate"
          />
        </div>
        
        <!-- Info about series series/exception -->
        <v-alert
           v-if="isSeries && isException"
           type="info"
           variant="tonal"
           density="compact"
           class="mb-0"
        >
          Toto je výjimka z existující série.
        </v-alert>
         <v-alert
           v-else-if="isSeries"
           type="info"
           variant="tonal"
           density="compact"
           class="mb-0"
           icon="mdi-repeat"
        >
          Součást série rezervací.
        </v-alert>


        <!-- Note -->
        <v-textarea
          :model-value="note"
          @update:model-value="v => emit('update:note', v)"
          label="Poznámka"
          variant="outlined"
          density="comfortable"
          rows="3"
          hide-details="auto"
          auto-grow
        />

        <!-- Actions -->
        <div class="d-flex align-center pt-2">
           <v-btn
             v-if="mode === 'edit'"
             color="error"
             variant="text"
             prepend-icon="mdi-delete"
             @click="onDelete"
           >
             Smazat
           </v-btn>
           
           <v-spacer />
           
           <v-btn
             variant="text"
             class="mr-2"
             @click="onClose"
           >
             Zrušit
           </v-btn>
           
           <v-btn
             color="primary"
             variant="flat"
             prepend-icon="mdi-content-save"
             :loading="saving"
             :disabled="!title"
             @click="onSave"
           >
             {{ mode === 'create' ? 'Vytvořit' : 'Uložit' }}
           </v-btn>
        </div>

      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.gap-3 { gap: 12px; }
.gap-4 { gap: 16px; }
</style>
