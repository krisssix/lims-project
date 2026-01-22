<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
  devices: Array<{ id: string; name: string; color: string; active?: boolean }>
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

const parsedDate = computed(() => {
  if (!props.dateYmd) return new Date()
  const [y, m, d] = props.dateYmd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
})

const formattedDateSubtitle = computed(() => {
  const d = parsedDate.value
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
})

const selectedDevice = computed(() => props.devices.find(d => d.id === props.deviceCode))
const selectedUserInitial = computed(() => (props.username?.[0] || '?').toUpperCase())
const selectedUserColor = '#673ab7' // Fixed color for user avatar as per design, or could be dynamic

// Duration calc
const durationStr = computed(() => {
  const [sh, sm] = props.startHM.split(':').map(Number)
  const [eh, em] = props.endHM.split(':').map(Number)
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  let diff = endMins - startMins
  if (diff < 0) diff += 24 * 60
  
  const h = Math.floor(diff / 60)
  const m = diff % 60
  if (h > 0 && m > 0) return `${h}h ${m}min`
  if (h > 0) return `${h}h`
  return `${m}min`
})



const errors = ref<Record<string, string>>({})

function validate(): boolean {
  errors.value = {}
  let isValid = true

  if (!props.title?.trim()) {
    errors.value.title = 'Název je povinný'
    isValid = false
  }
  if (!props.deviceCode) {
    errors.value.deviceCode = 'Vyberte přístroj'
    isValid = false
  }
  if (!props.username) {
    errors.value.username = 'Vyberte člena'
    isValid = false
  }
  if (!props.dateYmd) {
    errors.value.dateYmd = 'Vyberte datum'
    isValid = false
  }
  if (!props.startHM) {
    errors.value.startHM = 'Zadejte začátek'
    isValid = false
  }
  if (!props.endHM) {
    errors.value.endHM = 'Zadejte konec'
    isValid = false
  } else if (props.startHM && props.endHM <= props.startHM) {
    errors.value.endHM = 'Konec musí být po začátku'
    isValid = false
  }

  return isValid
}

function onSave() { 
  if (validate()) {
    emit('save') 
  }
}
function onDelete() { emit('delete') }
function onClose() {
  emit('update:modelValue', false)
  emit('cancel')
}

// Helpers for focus styles
function focusInput(e: Event) {
  const el = e.target as HTMLElement
  el.style.borderColor = '#818cf8'
  el.style.backgroundColor = 'white'
  el.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.1)'
}
function blurInput(e: Event) {
  const el = e.target as HTMLElement
  el.style.borderColor = '#e5e7eb'
  el.style.backgroundColor = '#f9fafb'
  el.style.boxShadow = 'none'
}

function setDuration(minutes: number) {
  const [sh, sm] = props.startHM.split(':').map(Number)
  const startMins = sh * 60 + sm
  let endMins = startMins + minutes
  
  // Simple wrap around 24h
  endMins = endMins % (24 * 60)
  
  const h = Math.floor(endMins / 60)
  const m = endMins % 60
  
  const hStr = h.toString().padStart(2, '0')
  const mStr = m.toString().padStart(2, '0')
  emit('update:endHM', `${hStr}:${mStr}`)
}

// Watch startHM and auto-adjust endHM if it becomes <= startHM
watch(() => props.startHM, (newStart) => {
  if (!newStart || !props.endHM) return
  
  // Parse times
  const [sh, sm] = newStart.split(':').map(Number)
  const [eh, em] = props.endHM.split(':').map(Number)
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  
  // If end is now <= start, set end to start + 1 hour
  if (endMins <= startMins) {
    let newEndMins = startMins + 60
    if (newEndMins >= 24 * 60) newEndMins = 24 * 60 - 1 // Cap at 23:59
    
    const h = Math.floor(newEndMins / 60)
    const m = newEndMins % 60
    emit('update:endHM', `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`)
  }
})
</script>

<template>
  <Dialog
    :is-open="modelValue"
    width="600"
    :title="mode === 'create' ? 'Vytvořit rezervaci' : 'Upravit rezervaci'"
    :subtitle="formattedDateSubtitle"
    :icon="mode === 'create' ? 'mdi-calendar-plus' : 'mdi-calendar-edit'"
    @update:is-open="v => { if(!v) onClose() }"
  >
    <template #content>
      <!-- NÁZEV -->
      <div style="margin-bottom: 16px;">
        <label class="field-label">Název rezervace</label>
        <div style="position: relative;">
          <v-icon class="field-icon-left">
            mdi-tag-outline
          </v-icon>
          <input 
            type="text" 
            :value="title" 
            placeholder="Název rezervace..."
            class="custom-input" 
            :class="{ 'input-error': errors.title }"
            autofocus
            @input="e => emit('update:title', (e.target as HTMLInputElement).value)"
            @focus="focusInput"
            @blur="blurInput"
          >
          <div
            v-if="errors.title"
            class="error-msg"
          >
            {{ errors.title }}
          </div>
        </div>
      </div>

      <!-- PŘÍSTROJ + ČLEN (2 columns) -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        <!-- PŘÍSTROJ -->
        <div>
          <label class="field-label">Přístroj</label>
          <v-menu>
            <template #activator="{ props }">
              <div
                class="custom-select"
                :class="{ 'input-error': errors.deviceCode }"
                v-bind="props"
              >
                <v-chip
                  v-if="selectedDevice"
                  :color="selectedDevice.color"
                  size="small"
                  variant="flat"
                  class="mr-2"
                >
                  {{ selectedDevice.id }}
                </v-chip>
                <v-icon
                  v-else
                  class="mr-2"
                  color="grey-lighten-1"
                >
                  mdi-flask-empty-outline
                </v-icon>
                <span class="select-text">
                  {{ selectedDevice?.name || 'Vyberte přístroj' }}
                  <span
                    v-if="selectedDevice?.active === false"
                    style="font-size: 11px; color: #ef4444; margin-left: 6px;"
                  >(Deaktivovaný)</span>
                </span>
                <v-icon color="#9ca3af">
                  mdi-chevron-down
                </v-icon>
              </div>
              <div
                v-if="errors.deviceCode"
                class="error-msg"
              >
                {{ errors.deviceCode }}
              </div>
            </template>
            <v-list
              density="compact"
              class="py-0"
            >
              <v-list-item
                v-for="d in devices"
                :key="d.id"
                :active="deviceCode === d.id"
                :disabled="d.active === false && deviceCode !== d.id"
                :style="{ opacity: (d.active === false && deviceCode !== d.id) ? 0.5 : 1 }"
                @click="emit('update:deviceCode', d.id)"
              >
                <template #prepend>
                  <v-icon
                    :color="d.color"
                    size="small"
                    class="mr-2"
                  >
                    mdi-circle
                  </v-icon>
                </template>
                <v-list-item-title>
                  {{ d.name }}
                  <span
                    v-if="d.active === false"
                    style="font-size:10px; color:#ef4444; margin-left: 4px;"
                  >(Deaktivovaný)</span>
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>

        <!-- ČLEN -->
        <div>
          <label class="field-label">Člen</label>
          <v-menu>
            <template #activator="{ props }">
              <div
                class="custom-select"
                :class="{ 'input-error': errors.username }"
                v-bind="props"
              >
                <div class="member-avatar">
                  {{ selectedUserInitial }}
                </div>
                <span class="select-text">{{ username || 'Vyberte uživatele' }}</span>
                <v-icon color="#9ca3af">
                  mdi-chevron-down
                </v-icon>
              </div>
              <div
                v-if="errors.username"
                class="error-msg"
              >
                {{ errors.username }}
              </div>
            </template>
            <v-list
              density="compact"
              class="py-0"
            >
              <v-list-item
                v-for="m in members"
                :key="m"
                :active="username === m"
                @click="emit('update:username', m)"
              >
                <template #prepend>
                  <v-avatar
                    size="24"
                    color="grey-lighten-3"
                    class="mr-2"
                  >
                    <span class="text-caption">{{ m[0].toUpperCase() }}</span>
                  </v-avatar>
                </template>
                <v-list-item-title>{{ m }}</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
      </div>

      <!-- DATUM + OPAKOVÁNÍ -->
      <div style="display: flex; align-items: flex-end; gap: 12px; margin-bottom: 16px;">
        <!-- DATUM -->
        <div style="flex: 1;">
          <label class="field-label">Datum</label>
          <div style="position: relative;">
            <v-icon class="field-icon-left">
              mdi-calendar
            </v-icon>
            <input 
              type="date" 
              :value="dateYmd"
              class="custom-input"
              :class="{ 'input-error': errors.dateYmd }"
              @input="e => emit('update:dateYmd', (e.target as HTMLInputElement).value)"
              @focus="focusInput"
              @blur="blurInput"
            >
            <div
              v-if="errors.dateYmd"
              class="error-msg"
            >
              {{ errors.dateYmd }}
            </div>
          </div>
        </div>

        <!-- OPAKOVÁNÍ BUTTON via RecurrenceEditor -->
        <RecurrenceEditor
          :model-value="recurrence"
          :start-date="parsedDate"
          @update:model-value="v => emit('update:recurrence', v)"
        >
          <template #activator="{ props }">
            <button 
              type="button" 
              class="custom-button-dashed"
              @click="props.onClick"
              @mouseover="(e: any) => { e.currentTarget.style.background='#f3f4f6'; e.currentTarget.style.borderColor='#9ca3af' }"
              @mouseout="(e: any) => { e.currentTarget.style.background='#f9fafb'; e.currentTarget.style.borderColor='#d1d5db' }"
            >
              <v-icon
                size="18"
                :color="props.hasValue ? 'primary' : undefined"
              >
                mdi-repeat
              </v-icon>
              <span :style="{ color: props.hasValue ? '#1976d2' : 'inherit', fontWeight: props.hasValue?600:400 }">
                {{ props.text }}
              </span>
            </button>
          </template>
        </RecurrenceEditor>
      </div>

      <!-- ČAS (ZAČÁTEK + KONEC) -->
      <div style="margin-bottom: 16px;">
        <label class="field-label">Čas rezervace</label>
        <div style="display: flex; align-items: center; gap: 12px;">
          <!-- ZAČÁTEK -->
          <div style="flex: 1; position: relative;">
            <v-icon class="field-icon-left">
              mdi-clock-start
            </v-icon>
            <input 
              type="time" 
              :value="startHM"
              class="custom-input"
              :class="{ 'input-error': errors.startHM }"
              @input="e => emit('update:startHM', (e.target as HTMLInputElement).value)"
              @focus="focusInput"
              @blur="blurInput"
            >
            <div
              v-if="errors.startHM"
              class="error-msg"
            >
              {{ errors.startHM }}
            </div>
          </div>

          <!-- SEPARATOR -->
          <div style="display: flex; align-items: center; gap: 4px; color: #9ca3af;">
            <v-icon size="20">
              mdi-arrow-right
            </v-icon>
          </div>

          <!-- KONEC -->
          <div style="flex: 1; position: relative;">
            <v-icon class="field-icon-left">
              mdi-clock-end
            </v-icon>
            <input 
              type="time" 
              :value="endHM"
              :min="startHM"
              class="custom-input"
              :class="{ 'input-error': errors.endHM }"
              @input="e => emit('update:endHM', (e.target as HTMLInputElement).value)"
              @focus="focusInput"
              @blur="blurInput"
            >
            <div
              v-if="errors.endHM"
              class="error-msg"
            >
              {{ errors.endHM }}
            </div>
          </div>

          <!-- DÉLKA BADGE / TOGGLE -->
          <v-menu location="bottom end">
            <template #activator="{ props }">
              <div 
                class="duration-badge interactive" 
                v-bind="props"
              >
                {{ durationStr }}
                <v-icon
                  size="14"
                  class="ml-1"
                >
                  mdi-menu-down
                </v-icon>
              </div>
            </template>
            <v-list
              density="compact"
              nav
            >
              <v-list-subheader>Rychlá volba délky</v-list-subheader>
              <v-list-item 
                v-for="mins in [15, 30, 45, 60, 90, 120, 180, 240, 300, 480]" 
                :key="mins"
                @click="setDuration(mins)"
              >
                <v-list-item-title>
                  {{ mins < 60 ? `${mins} min` : (mins % 60 === 0 ? `${mins/60} h` : `${Math.floor(mins/60)} h ${mins%60} min`) }}
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
      </div>

      <!-- POZNÁMKA -->
      <div>
        <label class="field-label">
          Poznámka
          <span style="font-weight: 400; color: #9ca3af; text-transform: none;">(volitelné)</span>
        </label>
        <div style="position: relative;">
          <v-icon
            class="field-icon-left"
            style="top: 14px; transform: none;"
          >
            mdi-text
          </v-icon>
          <textarea 
            :value="note || ''"
            placeholder="Doplňující informace k rezervaci..."
            rows="2" 
            class="custom-textarea" 
            @input="e => emit('update:note', (e.target as HTMLTextAreaElement).value)"
            @focus="focusInput"
            @blur="blurInput"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <!-- LEFT SIDE - Zrušit / Smazat -->
      <button 
        v-if="mode === 'edit'"
        type="button" 
        class="btn-secondary"
        style="color: #ef4444; background: #fee2e2;"
        @mouseover="(e:any) => e.target.style.background='#fecaca'"
        @mouseout="(e:any) => e.target.style.background='#fee2e2'"
        @click="onDelete"
      >
        Smazat
      </button>
      <button 
        v-else
        type="button" 
        class="btn-secondary"
        @click="onClose"
      >
        Zrušit
      </button>

      <!-- RIGHT SIDE - Uložit -->
      <div
        class="d-flex align-center"
        style="gap:12px; margin-left: auto;"
      >
        <button 
          v-if="mode === 'edit'"
          type="button" 
          class="btn-secondary"
          @click="onClose"
        >
          Zrušit
        </button>
        <button 
          type="button" 
          class="btn-primary"
          :disabled="saving"
          @click="onSave"
        >
          <v-icon
            size="18"
            class="mr-2"
          >
            mdi-content-save
          </v-icon>
          {{ mode === 'create' ? 'Vytvořit rezervaci' : 'Uložit změny' }}
        </button>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.field-label {
  display: block; 
  font-size: 12px; 
  font-weight: 600; 
  color: #6b7280; 
  text-transform: uppercase; 
  letter-spacing: 0.5px; 
  margin-bottom: 6px;
}

.custom-input {
  width: 100%; 
  height: 44px; 
  padding: 0px 12px 0px 40px; 
  border: 1px solid rgb(229, 231, 235); 
  border-radius: 10px; 
  font-size: 14px; 
  background: rgb(249, 250, 251); 
  color: rgb(55, 65, 81); 
  transition: 0.15s; 
  outline: none; 
  outline: none; 
  box-shadow: none;
}
.input-error {
  border-color: #ef4444 !important;
  background-color: #fef2f2 !important;
}
.error-msg {
  color: #ef4444;
  font-size: 11px;
  margin-top: 4px;
  margin-left: 4px;
}
.custom-textarea {
  width: 100%; 
  padding: 12px 12px 12px 40px; 
  border: 1px solid rgb(229, 231, 235); 
  border-radius: 10px; 
  font-size: 14px; 
  background: rgb(249, 250, 251); 
  color: rgb(55, 65, 81); 
  outline: none; 
  resize: none; 
  font-family: inherit; 
  line-height: 1.5;
  transition: 0.15s;
}

.field-icon-left {
  position: absolute; 
  left: 12px; 
  top: 50%; 
  transform: translateY(-50%); 
  font-size: 18px; 
  color: #9ca3af;
  pointer-events: none;
}

.custom-select {
  display: flex; 
  align-items: center; 
  height: 44px; 
  padding: 0 12px; 
  border: 1px solid #e5e7eb; 
  border-radius: 10px; 
  background: #f9fafb; 
  cursor: pointer; 
  gap: 10px;
  transition: 0.15s;
}
.custom-select:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}

.device-badge {
  width: 28px; 
  height: 28px; 
  border-radius: 6px; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  color: white; 
  font-size: 10px; 
  font-weight: 700;
}

.member-avatar {
  width: 28px;
  height: 28px;
  background: #673ab7;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 11px;
  font-weight: 600;
}

.select-text {
  flex: 1; 
  font-size: 14px; 
  color: #374151; 
  font-weight: 500;
   white-space: nowrap; 
  overflow: hidden; 
  text-overflow: ellipsis;
}

.custom-button-dashed {
  height: 44px; 
  padding: 0px 16px; 
  border: 1px dashed rgb(209, 213, 219); 
  border-radius: 10px; 
  background: rgb(249, 250, 251); 
  cursor: pointer; 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  font-size: 13px; 
  color: rgb(107, 114, 128); 
  transition: 0.15s;
  white-space: nowrap;
}

.duration-badge {
  padding: 8px 12px; 
  background: #eff6ff; 
  border-radius: 8px; 
  font-size: 12px; 
  font-weight: 600; 
  color: #3b82f6; 
  white-space: nowrap;
  display: flex;
  align-items: center;
}
.duration-badge.interactive {
  cursor: pointer;
  transition: all 0.2s;
}
.duration-badge.interactive:hover {
  background: #dbeafe;
}

.btn-secondary {
  height: 40px;
  padding: 0px 20px;
  border: none;
  background: #d4d4d4;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: rgb(107, 114, 128);
  border-radius: 8px;
  transition: 0.15s;
}
.btn-secondary:hover {
  background: #e5e7eb;
}

.btn-primary {
  height: 40px;
  padding: 0 24px;
  border: none;
  background: #1976d2;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: white;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  transition: all 0.15s;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
}
.btn-primary:active {
  transform: translateY(0);
}
.btn-primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}
</style>
