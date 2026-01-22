<script setup lang="ts">
import { ref, computed } from 'vue'
import type { RecurrenceRequest } from '@/stores/reservations'

const props = defineProps<{
  modelValue:RecurrenceRequest | null
  startDate:Date
}>()

const emit = defineEmits<{
  (e:'update:modelValue', val:RecurrenceRequest | null):void
}>()

const dialogOpen = ref(false)

const dayNamesLong = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']

const currentDayName = computed(() => {
  const d = props.startDate.getDay()
  return dayNamesLong[d]
})

function isoDay(d:Date):number {
  const x = d.getDay()
  return x === 0 ?  7 :x
}

// Czech pluralization helper
function pluralize(n:number, forms:[string, string, string]):string {
  if (n === 1) return forms[0]
  if (n >= 2 && n <= 4) return forms[1]
  return forms[2]
}

function getIntervalPrefix(n: number): string {
  if (n === 1) return 'každý'
  if (n >= 2 && n <= 4) return 'každé'
  return 'každých'
}

const dialogState = ref({
  mode:'NONE' as 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'WEEKDAY',
  interval:1,
  daysOfWeek: [] as number[],
  endMode:'NEVER' as 'NEVER' | 'UNTIL' | 'COUNT',
  untilDate:'',
  count:13
})

const displayText = computed(() => {
  const m = props.modelValue
  if (!m) return 'Neopakuje se'

  if (m.recurrenceType === 'DAILY' && m.interval === 1 && ! m.until && !m.count) {
    return 'Denně'
  }
  if (m.recurrenceType === 'WEEKLY' && m.interval === 1 && !m.until && !m.count) {
    if (m.daysOfWeek?.length === 5 && [1,2,3,4,5].every(d => m.daysOfWeek! .includes(d))) {
      return 'Pracovní dny'
    }
    if (! m.daysOfWeek || m.daysOfWeek.length <= 1) {
      return `Týdně v ${currentDayName.value}`
    }
    const dayLabels = ['', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
    return `Týdně: ${m.daysOfWeek.map(d => dayLabels[d]).join(', ')}`
  }
  if (m.recurrenceType === 'MONTHLY' && m.interval === 1 && !m.until && !m.count) {
    return `Měsíčně ${props.startDate.getDate()}.`
  }
  if (m.recurrenceType === 'YEARLY' && m.interval === 1 && !m.until && !m.count) {
    return `Ročně ${props.startDate.getDate()}. ${props.startDate.getMonth() + 1}.`
  }

  const typeCode = m.recurrenceType || 'WEEKLY'
  const forms: Record<string, [string, string, string]> = {
    DAILY:['den', 'dny', 'dní'],
    WEEKLY:['týden', 'týdny', 'týdnů'],
    MONTHLY: ['měsíc', 'měsíce', 'měsíců'],
    YEARLY:['rok', 'roky', 'let']
  }

  const n = m.interval || 1
  const unitTxt = pluralize(n, forms[typeCode] || forms.WEEKLY)
  const prefixWord = getIntervalPrefix(n)

  let endTxt = ''
  if (m.count) endTxt = `, ${m.count}×`
  else if (m.until) endTxt = `, do ${new Date(m.until).toLocaleDateString('cs-CZ')}`

  let mainText = ''
  if (n === 1 && typeCode === 'DAILY') {
    mainText = 'Denně'
  } else if (n === 1) {
    mainText = `Každý ${unitTxt}`
  } else {
    mainText = `${prefixWord} ${n} ${unitTxt}` // e.g. "každé 3 roky"
    // Capitalize first letter
    mainText = mainText.charAt(0).toUpperCase() + mainText.slice(1)
  }

  return `${mainText}${endTxt}`
})

const hasRecurrence = computed(() => props.modelValue !== null)

function openDialog() {
  const m = props.modelValue
  if (! m) {
    dialogState.value = {
      mode:'NONE',
      interval:1,
      daysOfWeek:[isoDay(props.startDate)],
      endMode: 'NEVER',
      untilDate:'',
      count:13
    }
  } else {
    let mode: typeof dialogState.value.mode = 'WEEKLY'
    if (m.recurrenceType === 'DAILY') mode = 'DAILY'
    else if (m.recurrenceType === 'MONTHLY') mode = 'MONTHLY'
    else if (m.recurrenceType === 'YEARLY') mode = 'YEARLY'
    else if (m.recurrenceType === 'WEEKLY' && m.daysOfWeek?.length === 5 && [1,2,3,4,5].every(d => m.daysOfWeek!.includes(d))) {
      mode = 'WEEKDAY'
    }

    dialogState.value = {
      mode,
      interval:m.interval || 1,
      daysOfWeek:m.daysOfWeek ?  [...m.daysOfWeek] :[isoDay(props.startDate)],
      endMode: m.count ? 'COUNT' :(m.until ? 'UNTIL' : 'NEVER'),
      untilDate:m.until ?  new Date(m.until).toISOString().substring(0, 10) :'',
      count:m.count || 13
    }
  }
  dialogOpen.value = true
}

function closeDialog() {
  dialogOpen.value = false
}

function saveRecurrence() {
  const s = dialogState.value

  if (s.mode === 'NONE') {
    emit('update:modelValue', null)
    dialogOpen.value = false
    return
  }

  let recurrenceType:'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  let daysOfWeek: number[] | undefined

  switch (s.mode) {
    case 'DAILY':
      recurrenceType = 'DAILY'
      break
    case 'WEEKLY':
      recurrenceType = 'WEEKLY'
      daysOfWeek = [...s.daysOfWeek].sort((a,b) => a-b)
      if (daysOfWeek.length === 0) daysOfWeek = [isoDay(props.startDate)]
      break
    case 'WEEKDAY':
      recurrenceType = 'WEEKLY'
      daysOfWeek = [1,2,3,4,5]
      break
    case 'MONTHLY':
      recurrenceType = 'MONTHLY'
      break
    case 'YEARLY':
      recurrenceType = 'YEARLY'
      break
    default:
      recurrenceType = 'WEEKLY'
  }

  const req:RecurrenceRequest = {
    recurrenceType,
    interval:s.interval
  }

  if (daysOfWeek) req.daysOfWeek = daysOfWeek

  if (s.endMode === 'COUNT' && s.count > 0) {
    req.count = s.count
  } else if (s.endMode === 'UNTIL' && s.untilDate) {
    const [year, month, day] = s.untilDate.split('-').map(Number)
    const d = new Date(year, month - 1, day, 23, 59, 59, 999)
    req.until = d.getTime()
  }

  emit('update:modelValue', req)
  dialogOpen.value = false
}

function toggleDay(d:number) {
  const list = dialogState.value.daysOfWeek
  if (list.includes(d)) {
    if (list.length > 1) {
      dialogState.value.daysOfWeek = list.filter(x => x !== d)
    }
  } else {
    dialogState.value.daysOfWeek.push(d)
  }
}

const unitLabel = computed(() => {
  const s = dialogState.value
  const forms:Record<string, [string, string, string]> = {
    DAILY: ['den', 'dny', 'dní'],
    WEEKLY:['týden', 'týdny', 'týdnů'],
    WEEKDAY:['týden', 'týdny', 'týdnů'],
    MONTHLY: ['měsíc', 'měsíce', 'měsíců'],
    YEARLY:['rok', 'roky', 'let']
  }
  return pluralize(s.interval, forms[s.mode] || forms.WEEKLY)
})

const weekDays = [
  { val:1, label:'Po' },
  { val:2, label:'Út' },
  { val:3, label:'St' },
  { val:4, label:'Čt' },
  { val:5, label:'Pá' },
  { val:6, label:'So', weekend:true },
  { val:7, label:'Ne', weekend:true },
]

const gridOptions = [
  { mode:'NONE', label:'Nikdy', icon:'mdi-close-circle-outline' },
  { mode:'DAILY', label: 'Denně', icon:'mdi-calendar-today' },
  { mode:'WEEKDAY', label:'Po–Pá', icon:'mdi-briefcase-outline' },
  { mode: 'WEEKLY', label:'Týdně', icon:'mdi-calendar-week' },
  { mode:'MONTHLY', label: 'Měsíčně', icon:'mdi-calendar-month' },
  { mode:'YEARLY', label:'Ročně', icon: 'mdi-calendar-star' },
] as const

// Výpočet počtu rezervací, které se vytvoří
const estimatedCount = computed(() => {
  const s = dialogState.value
  if (s.mode === 'NONE') return 0

  // Pokud je nastavený počet opakování, vrátit přímo
  if (s.endMode === 'COUNT' && s.count > 0) {
    return s.count
  }

  // Pokud je nastaveno datum ukončení
  if (s.endMode === 'UNTIL' && s.untilDate) {
    const start = props.startDate
    const [year, month, day] = s.untilDate.split('-').map(Number)
    const end = new Date(year, month - 1, day, 23, 59, 59)

    if (end <= start) return 0

    const diffMs = end.getTime() - start.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    const interval = s.interval || 1

    switch (s.mode) {
      case 'DAILY':
        return Math.ceil(diffDays / interval)
      case 'WEEKLY':
        const weeksCount = Math.ceil(diffDays / 7 / interval)
        const daysPerWeek = s.daysOfWeek.length || 1
        return weeksCount * daysPerWeek
      case 'WEEKDAY':
        // 5 pracovních dnů za týden
        return Math.ceil(diffDays / 7) * 5
      case 'MONTHLY':
        const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
        return Math.ceil(diffMonths / interval) + 1
      case 'YEARLY':
        const diffYears = end.getFullYear() - start.getFullYear()
        return Math.ceil(diffYears / interval) + 1
      default:
        return 0
    }
  }

  // Pro "nikdy nekončí" vrátit null (nekonečno)
  return null
})

// Text pro zobrazení počtu
const countDisplayText = computed(() => {
  const count = estimatedCount.value
  if (count === null) return '1000 rezervací'
  if (count === 0) return ''
  if (count === 1) return '1 rezervace'
  if (count >= 2 && count <= 4) return `${count} rezervace`
  return `${count} rezervací`
})
</script>

<template>
  <div class="recurrence-editor">
    <!-- Trigger Button -->
    <!-- Trigger Button (Slot or Default) -->
    <slot
      name="activator"
      :props="{
        onClick: openDialog,
        text: displayText,
        hasValue: hasRecurrence
      }"
    >
      <button
        type="button"
        class="trigger-btn"
        :class="{ 'has-value':hasRecurrence }"
        @click="openDialog"
      >
        <v-icon
          size="18"
          :color="hasRecurrence ? 'primary' :undefined"
        >
          mdi-repeat
        </v-icon>
        <span class="trigger-text">{{ displayText }}</span>
        <v-icon
          size="16"
          class="trigger-chevron"
        >
          mdi-chevron-down
        </v-icon>
      </button>
    </slot>

    <!-- Dialog -->
    <v-dialog
      v-model="dialogOpen"
      max-width="400"
      :persistent="false"
    >
      <v-card class="dialog-card">
        <!-- Header -->
        <div class="dialog-header">
          <div class="header-left">
            <div class="header-icon">
              <v-icon size="20">
                mdi-repeat
              </v-icon>
            </div>
            <div class="header-text">
              <div class="header-title">
                Opakování
              </div>
              <div class="header-subtitle">
                Nastavte pravidla opakování
              </div>
            </div>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            @click="closeDialog"
          />
        </div>

        <!-- Content -->
        <v-card-text class="dialog-content">
          <!-- Type Grid -->
          <div class="type-grid">
            <button
              v-for="opt in gridOptions"
              :key="opt.mode"
              type="button"
              class="type-card"
              :class="{ active:dialogState.mode === opt.mode }"
              @click="dialogState.mode = opt.mode"
            >
              <v-icon :size="22">
                {{ opt.icon }}
              </v-icon>
              <span>{{ opt.label }}</span>
            </button>
          </div>

          <!-- Weekly Days Selector -->
          <Transition name="fade">
            <div
              v-if="dialogState.mode === 'WEEKLY'"
              class="days-section"
            >
              <div class="section-label">
                Opakovat ve dnech
              </div>
              <div class="days-grid">
                <button
                  v-for="d in weekDays"
                  :key="d.val"
                  type="button"
                  class="day-btn"
                  :class="{
                    active:dialogState.daysOfWeek.includes(d.val),
                    weekend:d.weekend
                  }"
                  @click="toggleDay(d.val)"
                >
                  {{ d.label }}
                </button>
              </div>
            </div>
          </Transition>

          <!-- Interval -->
          <Transition name="fade">
            <div
              v-if="dialogState.mode !== 'NONE' && dialogState.mode !== 'WEEKDAY'"
              class="interval-section"
            >
              <span class="interval-label">Opakovat každý</span>
              <input
                v-model.number="dialogState.interval"
                type="number"
                min="1"
                max="99"
                class="interval-input"
              >
              <span class="interval-unit">{{ unitLabel }}</span>
            </div>
          </Transition>

          <!-- End Conditions -->
          <Transition name="fade">
            <div
              v-if="dialogState.mode !== 'NONE'"
              class="end-section"
            >
              <div class="section-divider">
                <span>Ukončení</span>
              </div>

              <div class="end-options">
                <!-- Never -->
<!--                <label
                  class="end-option"
                  :class="{ active: dialogState.endMode === 'NEVER' }"
                >
                  <input
                    v-model="dialogState.endMode"
                    type="radio"
                    value="NEVER"
                  >
                  <div class="radio-indicator">
                    <div class="radio-dot" />
                  </div>
                  <span class="end-label">Nikdy nekončí</span>

                </label>-->

                <!-- Count -->
                <label
                  class="end-option"
                  :class="{ active:dialogState.endMode === 'COUNT' }"
                >
                  <input
                    v-model="dialogState.endMode"
                    type="radio"
                    value="COUNT"
                  >
                  <div class="radio-indicator">
                    <div class="radio-dot" />
                  </div>
                  <span class="end-label">Po</span>
                  <input
                    v-model.number="dialogState.count"
                    type="number"
                    min="1"
                    max="999"
                    class="inline-input"
                    :disabled="dialogState.endMode !== 'COUNT'"
                    @focus="dialogState.endMode = 'COUNT'"
                  >
                  <span class="end-label">opakováních</span>
                </label>

                <!-- Until Date -->
                <label
                  class="end-option"
                  :class="{ active:dialogState.endMode === 'UNTIL' }"
                >
                  <input
                    v-model="dialogState.endMode"
                    type="radio"
                    value="UNTIL"
                  >
                  <div class="radio-indicator">
                    <div class="radio-dot" />
                  </div>
                  <span class="end-label">Dne</span>
                  <input
                    v-model="dialogState.untilDate"
                    type="date"
                    class="inline-input date-input"
                    :disabled="dialogState.endMode !== 'UNTIL'"
                    @focus="dialogState.endMode = 'UNTIL'"
                  >
                </label>
              </div>
            </div>
          </Transition>

          <!-- Info o počtu rezervací -->
          <Transition name="fade">
            <div
              v-if="dialogState.mode !== 'NONE' && countDisplayText"
              class="count-info"
            >
              <v-icon
                size="16"
                color="primary"
              >
                mdi-information-outline
              </v-icon>
              <span>Vytvoří se <strong>{{ countDisplayText }}</strong></span>
            </div>
          </Transition>
        </v-card-text>

        <!-- Footer -->
        <v-card-actions class="dialog-footer">
          <v-btn
            variant="text"
            @click="closeDialog"
          >
            Zrušit
          </v-btn>
          <v-spacer />
          <v-btn
            variant="flat"
            color="primary"
            prepend-icon="mdi-check"
            @click="saveRecurrence"
          >
            Uložit
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* ===== TRIGGER BUTTON ===== */
.trigger-btn {
  display:inline-flex;
  align-items:center;
  gap:8px;
  height:40px;
  padding:0 14px;
  background:#f8fafc;
  border:1.5px dashed #cbd5e1;
  border-radius:10px;
  cursor:pointer;
  transition:all 0.15s ease;
  color:#64748b;
  font-size:13px;
  font-weight:500;
}

.trigger-btn:hover {
  background:#f1f5f9;
  border-color:#94a3b8;
  color:#475569;
}

.trigger-btn.has-value {
  background:#eff6ff;
  border-color: #3b82f6;
  border-style:solid;
  color:#1d4ed8;
}

.trigger-text {
  flex:1;
  text-align: left;
}

.trigger-chevron {
  opacity:0.5;
}

/* ===== DIALOG ===== */
.dialog-card {
  border-radius:16px ! important;
  overflow:hidden;
}

/* Header */
.dialog-header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:16px 20px;
  background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color:white;
}

.header-left {
  display: flex;
  align-items:center;
  gap: 12px;
}

.header-icon {
  width:40px;
  height:40px;
  background:rgba(255, 255, 255, 0.2);
  border-radius:10px;
  display:flex;
  align-items:center;
  justify-content:center;
}

.header-title {
  font-size:16px;
  font-weight:600;
}

.header-subtitle {
  font-size:12px;
  opacity:0.85;
}

/* Content */
.dialog-content {
  padding:20px ! important;
}

/* Type Grid */
.type-grid {
  display:grid;
  grid-template-columns:repeat(3, 1fr);
  gap:10px;
  margin-bottom:20px;
}

.type-card {
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:6px;
  padding:14px 8px;
  background:#ffffff;
  border: 2px solid #e2e8f0;
  border-radius:12px;
  cursor:pointer;
  transition:all 0.15s ease;
  color:#64748b;
  font-size:12px;
  font-weight:500;
}

.type-card:hover {
  background: #f8fafc;
  border-color:#cbd5e1;
  color:#475569;
}

.type-card.active {
  background: #eff6ff;
  border-color: #3b82f6;
  color:#1d4ed8;
  box-shadow:0 0 0 3px rgba(59, 130, 246, 0.15);
}

/* Days Section */
.days-section {
  margin-bottom:16px;
}

.section-label {
  font-size:12px;
  font-weight:600;
  color:#64748b;
  text-transform:uppercase;
  letter-spacing:0.5px;
  margin-bottom:10px;
}

.days-grid {
  display:flex;
  gap:6px;
}

.day-btn {
  flex:1;
  height:40px;
  border:2px solid #e2e8f0;
  border-radius:8px;
  background:white;
  cursor:pointer;
  font-size:12px;
  font-weight:600;
  color:#64748b;
  transition: all 0.15s ease;
}

.day-btn:hover {
  border-color:#cbd5e1;
  background:#f8fafc;
}

.day-btn.weekend {
  color:#94a3b8;
  background:#f8fafc;
}

.day-btn.active {
  background:#3b82f6;
  border-color:#3b82f6;
  color:white;
}

.day-btn.active.weekend {
  background:#60a5fa;
  border-color: #60a5fa;
}

/* Interval Section */
.interval-section {
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px 14px;
  background:#f8fafc;
  border-radius:10px;
  margin-bottom:16px;
}

.interval-label,
.interval-unit {
  font-size:14px;
  color:#475569;
}

.interval-input {
  width: 56px;
  height:36px;
  padding:0 8px;
  text-align:center;
  border:2px solid #e2e8f0;
  border-radius:8px;
  font-size:14px;
  font-weight:600;
  color:#1e293b;
  background:white;
  transition:border-color 0.15s;
}

.interval-input:focus {
  outline:none;
  border-color:#3b82f6;
}

/* Section Divider */
.section-divider {
  display:flex;
  align-items:center;
  gap:12px;
  margin-bottom:14px;
}

.section-divider::before,
.section-divider::after {
  content:'';
  flex:1;
  height:1px;
  background:#e2e8f0;
}

.section-divider span {
  font-size:11px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:0.5px;
  color:#94a3b8;
}

/* End Options */
.end-options {
  display: flex;
  flex-direction:column;
  gap:8px;
}

.end-option {
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px 14px;
  background:white;
  border: 2px solid #e2e8f0;
  border-radius:10px;
  cursor:pointer;
  transition:all 0.15s ease;
}

.end-option:hover {
  border-color:#cbd5e1;
}

.end-option.active {
  border-color:#3b82f6;
  background:#f8fafc;
}

.end-option input[type="radio"] {
  display:none;
}

.radio-indicator {
  width:18px;
  height:18px;
  border: 2px solid #cbd5e1;
  border-radius: 50%;
  display:flex;
  align-items: center;
  justify-content:center;
  transition:border-color 0.15s;
  flex-shrink:0;
}

.end-option.active .radio-indicator {
  border-color:#3b82f6;
}

.radio-dot {
  width:10px;
  height:10px;
  background:#3b82f6;
  border-radius:50%;
  transform:scale(0);
  transition:transform 0.15s ease;
}

.end-option.active .radio-dot {
  transform:scale(1);
}

.end-label {
  font-size:14px;
  color:#475569;
}

.inline-input {
  width:56px;
  height:32px;
  padding:0 8px;
  text-align:center;
  border:1.5px solid #e2e8f0;
  border-radius:6px;
  font-size:14px;
  font-weight:500;
  color: #1e293b;
  background: white;
  transition:all 0.15s;
}

.inline-input:focus {
  outline:none;
  border-color:#3b82f6;
}

.inline-input:disabled {
  background:#f1f5f9;
  color:#94a3b8;
  border-color:#e2e8f0;
}

.inline-input.date-input {
  width:130px;
}

/* Count Info */
.count-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  margin-top: 16px;
  font-size: 13px;
  color: #1e40af;
}

.count-info strong {
  font-weight: 600;
}

/* Footer */
.dialog-footer {
  padding:12px 20px 16px ! important;
  background:#f8fafc;
  border-top:1px solid #e2e8f0;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition:all 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity:0;
  transform:translateY(-8px);
}
</style>
