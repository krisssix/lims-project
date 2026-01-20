<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-unused-vars */
import { computed, ref, watch, onUnmounted } from 'vue'

// ===== TYPES =====
interface Slot {
  start:Date
  end:Date
}

interface ConflictItem {
  id:number
  title:string
  start:Date
  end:Date
  username?:string | null
}

interface Suggestion {
  id:string
  label:string
  sublabel:string
  slot:Slot
  icon:string
  offset:string
  type:'time-shift' | 'next-day' | 'custom'
}

// ===== PROPS & EMITS =====
const props = defineProps<{
  open:boolean
  deviceName:string
  requested:Slot
  proposals:Array<{ slot:Slot; label:string }>
  conflicts?:ConflictItem[]
  allReservations?:ConflictItem[]
  excludeReservationId?:number | null  // ID of reservation being moved (to exclude from overlap checks)
}>()

const emit = defineEmits<{
  'update:open':[value:boolean]
  'confirm':[slot:Slot]
  'suggest-next-day':[]
  'cancel':[]
  'force-create':[]
}>()

// ===== STATE =====
const selectedIdx = ref<number | null>(null)
const showCustomPicker = ref(false)
const customDate = ref('')
const customTime = ref('08:00')

// ===== COMPUTED =====
const isOpen = computed({
  get:() => props.open,
  set:(v) => emit('update:open', v)
})

const requestedDuration = computed(() =>
  props.requested.end.getTime() - props.requested.start.getTime()
)

const targetDay = computed(() => {
  const d = new Date(props.requested.start)
  d.setHours(0, 0, 0, 0)
  return d
})

// Konec cílového dne (23:59:59)
const targetDayEnd = computed(() => {
  const d = new Date(targetDay.value)
  d.setHours(23, 59, 59, 999)
  return d
})

// Rezervace POUZE pro cílový den (vyloučena přesouvaná rezervace)
const reservationsOnTargetDay = computed<ConflictItem[]>(() => {
const all = props.allReservations ?? []
  const dayStart = targetDay.value.getTime()
  const dayEnd = targetDayEnd.value.getTime()
  const excludeId = props.excludeReservationId

  return all.filter(r => {
    // Exclude the reservation being moved
    if (excludeId && r.id === excludeId) return false
    const rStart = r.start.getTime()
    const rEnd = r.end.getTime()
    return rStart < dayEnd && rEnd > dayStart
  }).sort((a, b) => a.start.getTime() - b.start.getTime())
})

// Najít SKUTEČNÉ konflikty (ověření)
const actualConflicts = computed<ConflictItem[]>(() => {
  const req = props.requested
  const conflicts = props.conflicts || []

  return conflicts.filter(c => {
    const cStart = c.start.getTime()
    const cEnd = c.end.getTime()
    const rStart = req.start.getTime()
    const rEnd = req.end.getTime()
    return rStart < cEnd && rEnd > cStart
  })
})

const mainConflict = computed(() => actualConflicts.value[0] ??  null)


// ===== SMART SLOT FINDING =====

// Helper: Get all gaps > 15min in a day
function getGapsForDay(day: Date, reservations: ConflictItem[], excludeId?: number | null): { start: number; end: number; duration: number }[] {
  const dayStart = new Date(day)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(day)
  dayEnd.setHours(23, 59, 59, 999)

  const dayStartMs = dayStart.getTime()
  const dayEndMs = dayEnd.getTime()

  // Filter reservations for this day (exclude the reservation being moved)
  const relevant = reservations
    .filter(r => {
      // Exclude the reservation being moved
      if (excludeId && r.id === excludeId) return false
      const rs = r.start.getTime()
      const re = r.end.getTime()
      return rs < dayEndMs && re > dayStartMs
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const gaps: { start: number; end: number; duration: number }[] = []
  let lastEnd = dayStartMs

  for (const r of relevant) {
    const rStart = Math.max(dayStartMs, r.start.getTime())
    const rEnd = Math.min(dayEndMs, r.end.getTime())

    if (rStart > lastEnd) {
      const duration = rStart - lastEnd
      if (duration >= 15 * 60000) { // Min valid gap 15min
        gaps.push({ start: lastEnd, end: rStart, duration })
      }
    }
    lastEnd = Math.max(lastEnd, rEnd)
  }

  // Final gap till end of day
  if (lastEnd < dayEndMs) {
    const duration = dayEndMs - lastEnd
    if (duration >= 15 * 60000) {
      gaps.push({ start: lastEnd, end: dayEndMs, duration })
    }
  }

  return gaps
}

const adaptiveSuggestions = computed<Suggestion[]>(() => {
  const reqStart = props.requested.start.getTime()
  const reqDuration = requestedDuration.value
  const targetDate = targetDay.value

  const suggestions: Suggestion[] = []

  // Identify the main conflict (closest to requested start)
  const mainC = mainConflict.value // Re-using existing computed from line 104

  let addedBefore = false
  let addedAfter = false

  // 1. Explicit MOVE BEFORE
  if (mainC) {
    const cStartTime = mainC.start.getTime()
    // Calculate potential end time = conflict start
    // potential start = conflict start - duration
    const potentialStart = cStartTime - reqDuration

    // Validate bounds (start of day)
    const dayStart = new Date(targetDate).setHours(0,0,0,0)
    if (potentialStart >= dayStart) {
       // Check for overlap in this new interval [potentialStart, cStartTime]
       const hasOverlap = reservationsOnTargetDay.value.some(r => {
          if (r.id === mainC.id) return false
          const rs = r.start.getTime()
          const re = r.end.getTime()
          return potentialStart < re && cStartTime > rs
       })

       if (!hasOverlap) {
         const s: Slot = { start: new Date(potentialStart), end: new Date(cStartTime) }
         suggestions.push({
            id: 'move_before',
            label: 'Posunout před konflikt',
            sublabel: `${formatTime(s.start)} – ${formatTime(s.end)}`,
            slot: s,
            icon: 'mdi-arrow-collapse-left',
            offset: getOffset(s.start),
            type: 'time-shift'
         })
         addedBefore = true
       }
    }
  }

  // 2. Explicit MOVE AFTER
  if (mainC) {
    const cEndTime = mainC.end.getTime()
    const potentialEnd = cEndTime + reqDuration

    // Validate bounds (end of day)
    const dayEnd = new Date(targetDate).setHours(23,59,59,999)
    if (potentialEnd <= dayEnd) {
       // Check for overlap
       const hasOverlap = reservationsOnTargetDay.value.some(r => {
          if (r.id === mainC.id) return false
          const rs = r.start.getTime()
          const re = r.end.getTime()
          return cEndTime < re && potentialEnd > rs
       })

       if (!hasOverlap) {
         const s: Slot = { start: new Date(cEndTime), end: new Date(potentialEnd) }
         suggestions.push({
            id: 'move_after',
            label: 'Posunout za konflikt',
            sublabel: `${formatTime(s.start)} – ${formatTime(s.end)}`,
            slot: s,
            icon: 'mdi-arrow-expand-right',
            offset: getOffset(s.start),
            type: 'time-shift'
         })
         addedAfter = true
       }
    }
  }

  // 3. Smart Gaps (Alternatives + Shortening)
  const gapsToday = getGapsForDay(targetDate, props.allReservations ?? [], props.excludeReservationId)

  for (const gap of gapsToday) {
    // Check if this gap is actually the space before/after main conflict we just handled
    // If we already added a "Move After" that perfectly fills this gap, we might duplicate it if not careful.
    // "Move After" uses specific start=conflict.end. "Gap" might be same.
    // We can filter by ID or time.

    const isFullFit = gap.duration >= reqDuration

    // Skip if we already added this EXACT slot via explicit Before/After
    const isBeforeSlot = mainC && gap.end === mainC.start.getTime() && addedBefore
    const isAfterSlot = mainC && gap.start === mainC.end.getTime() && addedAfter

    if (isFullFit) {
       // Only add as "Move to free time" if it wasn't the explicit neighbor we just added
       if (!isBeforeSlot && !isAfterSlot) {
          // Calculate best start in gap
          let proposedStart = Math.max(gap.start, Math.min(gap.end - reqDuration, reqStart))
          proposedStart = Math.max(gap.start, proposedStart)

          const s: Slot = { start: new Date(proposedStart), end: new Date(proposedStart + reqDuration) }

          suggestions.push({
            id: `today_fit_${gap.start}`,
            label: 'Posunout na jiný volný čas',
            sublabel: `${formatTime(s.start)} – ${formatTime(s.end)}`,
            slot: s,
            icon: 'mdi-clock-check-outline',
            offset: getOffset(s.start),
            type: 'time-shift'
          })
       }
    } else {
       // It's a SMALLER gap -> Offer Shorten
       // PRIORITIZE gaps immediately next to main conflict
       const isImmediateBefore = mainC && gap.end === mainC.start.getTime()
       const isImmediateAfter = mainC && gap.start === mainC.end.getTime()

       let label = 'Zkrátit do volného místa'
       let icon = 'mdi-arrow-collapse-horizontal'

       if (isImmediateBefore) {
          label = 'Zkrátit před konfliktem'
          icon = 'mdi-arrow-collapse-left'
       } else if (isImmediateAfter) {
          label = 'Zkrátit za konfliktem'
          icon = 'mdi-arrow-expand-right'
       }

       const s: Slot = { start: new Date(gap.start), end: new Date(gap.end) }
       suggestions.push({
         id: `today_short_${gap.start}`,
         label: `${label} (${formatDuration(s)})`,
         sublabel: `${formatTime(s.start)} – ${formatTime(s.end)}`,
         slot: s,
         icon: icon,
         offset: getOffset(s.start),
         type: 'custom'
       })
    }
  }

  // 4. Next Day
  const nextDay = new Date(targetDate)
  nextDay.setDate(nextDay.getDate() + 1)
  const gapsNextDay = getGapsForDay(nextDay, props.allReservations ?? [], props.excludeReservationId)

  // (Optional: keep next day logic simple)
  if (gapsNextDay.length > 0) {
      // Find best fit or just first
      // ... reuse existing logic lightly
      const reqTimeOfDay = reqStart - new Date(reqStart).setHours(0,0,0,0)
      let bestNext: { start: number, end: number } | null = null
      let minDiff = Infinity

      for (const gap of gapsNextDay) {
         if (gap.duration >= reqDuration) {
            const gapStartDay = new Date(gap.start).setHours(0,0,0,0)
            const ideal = gapStartDay + reqTimeOfDay
            const actual = Math.max(gap.start, Math.min(gap.end - reqDuration, ideal))
            const diff = Math.abs(actual - ideal)
            if (diff < minDiff) {
               minDiff = diff
               bestNext = { start: actual, end: actual + reqDuration }
            }
         }
      }

      if (bestNext) {
         suggestions.push({
            id: 'next_day_best',
            label: 'Další den ve stejný čas',
            sublabel: `${formatDayShort(new Date(bestNext.start))} ${formatTime(new Date(bestNext.start))} – ${formatTime(new Date(bestNext.end))}`,
            slot: { start: new Date(bestNext.start), end: new Date(bestNext.end) },
            icon: 'mdi-calendar-arrow-right',
            offset: 'další den',
            type: 'next-day'
         })
      } else {
         // Fallback first gap
          const g = gapsNextDay[0]
          const s = { start: new Date(g.start), end: new Date(g.start + Math.min(g.duration, reqDuration)) }
          suggestions.push({
            id: 'next_day_first',
            label: 'Další den ráno',
            sublabel: `${formatDayShort(s.start)} ${formatTime(s.start)} – ${formatTime(s.end)}`,
            slot: s,
            icon: 'mdi-weather-sunset-up',
            offset: 'další den',
            type: 'next-day'
         })
      }
  }

  return suggestions
})

// Use the new logic
const suggestions = computed(() => adaptiveSuggestions.value)
const availableSlotsOnTargetDay = computed<Slot[]>(() =>
  getGapsForDay(targetDay.value, props.allReservations ?? [], props.excludeReservationId)
    .filter(g => g.duration >= requestedDuration.value)
    .map(g => ({ start: new Date(g.start), end: new Date(g.end) }))
)
const selectedSuggestion = computed(() =>
  selectedIdx.value !== null ? suggestions.value[selectedIdx.value]:null
)

const customSlot = computed<Slot | null>(() => {
  if (!customDate.value) return null

  const [hours, minutes] = customTime.value.split(':').map(Number)
  const start = new Date(customDate.value)
  start.setHours(hours ?? 8, minutes ?? 0, 0, 0)

  if (start.getTime() < Date.now()) return null

  const end = new Date(start.getTime() + requestedDuration.value)
  return { start, end }
})


const activeSlot = computed<Slot | null>(() => {
  if (showCustomPicker.value && customSlot.value) return customSlot.value
  return selectedSuggestion.value?.slot ??  null
})

const canConfirm = computed(() => activeSlot.value !== null)

// ===== HELPERS =====
function isSameDay(d1:Date, d2:Date):boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
}

function getOffset(date:Date):string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.round(diffMs / 60000)

  if (diffMins < 0) {
    const absMins = Math.abs(diffMins)
    if (absMins < 60) return `před ${absMins}min`
    const absHours = Math.round(absMins / 60)
    if (absHours < 24) return `před ${absHours}h`
    const absDays = Math.round(absHours / 24)
    return `před ${absDays} dny`
  }

  if (diffMins < 60) return `za ${diffMins}min`

  const diffHours = Math.round(diffMins / 60)
  if (diffHours < 24) return `za ${diffHours}h`

  const diffDays = Math.round(diffHours / 24)
  return diffDays === 1 ? 'zítra':`za ${diffDays} dní`
}

// ===== FORMATTERS =====
const timeFormatter = new Intl.DateTimeFormat('cs-CZ', {
  hour:'2-digit',
  minute:'2-digit'
})

const dateFormatter = new Intl.DateTimeFormat('cs-CZ', {
  weekday:'long',
  day:'numeric',
  month:'long',
  year:'numeric'
})

const dayShortFormatter = new Intl.DateTimeFormat('cs-CZ', {
  weekday:'short',
  day:'numeric',
  month:'numeric'
})

function formatTime(date:Date):string {
  return timeFormatter.format(date)
}

function formatTimeRange(slot:Slot):string {
  return `${formatTime(slot.start)} – ${formatTime(slot.end)}`
}

function formatDuration(slot:Slot):string {
  const mins = Math.round((slot.end.getTime() - slot.start.getTime()) / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}h ${m}min`
  return h ? `${h}h`:`${m}min`
}

function formatDayShort(date:Date):string {
  return dayShortFormatter.format(date)
}

function formatFullDate(date:Date):string {
  return dateFormatter.format(date)
}

function getInitials(text:string):string {
  return (text?.[0] ??  'U').toUpperCase()
}

// ===== ACTIONS =====
function selectSuggestion(idx:number):void {
  selectedIdx.value = idx
  showCustomPicker.value = false
}

function toggleCustomPicker():void {
  showCustomPicker.value = !showCustomPicker.value
  if (showCustomPicker.value) {
    selectedIdx.value = null
    // Předvyplnit CÍLOVÝ den (ne zítra!)
    customDate.value = targetDay.value.toISOString().slice(0, 10)
    customTime.value = '08:00'
  }
}

function confirm():void {
  if (activeSlot.value) {
    emit('confirm', activeSlot.value)
  }
}

function cancel():void {
  emit('cancel')
  isOpen.value = false
}

function forceCreate():void {
  emit('force-create')
}

// ===== KEYBOARD =====
function handleKeydown(e:KeyboardEvent):void {
  if (! isOpen.value) return

  if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
  } else if (e.key === 'Enter' && canConfirm.value) {
    e.preventDefault()
    confirm()
  } else if (e.key === 'ArrowDown' && ! showCustomPicker.value) {
    e.preventDefault()
    const next = selectedIdx.value === null ? 0:Math.min(selectedIdx.value + 1, suggestions.value.length - 1)
    selectSuggestion(next)
  } else if (e.key === 'ArrowUp' && !showCustomPicker.value) {
    e.preventDefault()
    const prev = selectedIdx.value === null ? 0:Math.max(selectedIdx.value - 1, 0)
    selectSuggestion(prev)
  }
}

// ===== LIFECYCLE =====
watch(isOpen, (open) => {
  if (open) {
    selectedIdx.value = null
    showCustomPicker.value = false
    window.addEventListener('keydown', handleKeydown)
  } else {
    window.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <v-dialog
    v-model="isOpen"
    max-width="460"
    :persistent="false"
  >
    <v-card class="conflict-dialog">
      <!-- Header -->
      <header class="dialog-header">
        <div class="header-icon">
          <v-icon size="24">
            mdi-calendar-alert
          </v-icon>
        </div>
        <div class="header-content">
          <h2 class="header-title">
            Kolize rezervace
          </h2>
          <p class="header-subtitle">
            <v-icon size="14">
              mdi-flask-outline
            </v-icon>
            {{ deviceName }}
            <span class="header-divider">•</span>
            <v-icon size="14">
              mdi-calendar
            </v-icon>
            {{ formatDayShort(requested.start) }}
            <span class="header-divider">•</span>
            <v-icon size="14">
              mdi-clock-outline
            </v-icon>
            {{ formatTimeRange(requested) }}
            <span class="duration-chip">{{ formatDuration(requested) }}</span>
          </p>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          class="close-btn"
          @click="cancel"
        />
      </header>

      <!-- Conflict Info -->
      <div
        v-if="mainConflict"
        class="conflict-banner"
      >
        <div class="conflict-avatar">
          {{ getInitials(mainConflict.username || mainConflict.title) }}
        </div>
        <div class="conflict-info">
          <span class="conflict-label">Koliduje s rezervací</span>
          <span class="conflict-name">{{ mainConflict.username || mainConflict.title }}</span>
        </div>
        <div class="conflict-time">
          {{ formatTimeRange({ start:mainConflict.start, end:mainConflict.end }) }}
        </div>
      </div>

      <!-- Target day info -->
      <div class="target-day-info">
        <v-icon
          size="16"
          color="primary"
        >
          mdi-calendar-search
        </v-icon>
        <span>Volné sloty pro <strong>{{ formatDayShort(targetDay) }}</strong></span>
        <v-chip
          v-if="availableSlotsOnTargetDay.length === 0"
          size="x-small"
          color="warning"
          variant="tonal"
        >
          Žádné volné
        </v-chip>
        <v-chip
          v-else
          size="x-small"
          color="success"
          variant="tonal"
        >
          {{ availableSlotsOnTargetDay.length }} {{ availableSlotsOnTargetDay.length === 1 ? 'slot':'sloty' }}
        </v-chip>
      </div>

      <!-- No actual conflict warning -->
      <v-alert
        v-if="props.conflicts?.length && !actualConflicts.length"
        type="warning"
        variant="tonal"
        density="compact"
        class="ma-4"
      >
        Předané konflikty nekolidují s požadovaným časem.
      </v-alert>

      <!-- Suggestions -->
      <section class="suggestions-section">
        <h3 class="section-title">
          <v-icon
            size="16"
            color="amber"
          >
            mdi-lightbulb-on-outline
          </v-icon>
          Doporučené alternativy
        </h3>

        <div class="suggestions-list">
          <button
            v-for="(suggestion, idx) in suggestions"
            :key="suggestion.id"
            type="button"
            class="suggestion-card"
            :class="{
              'is-selected':idx === selectedIdx,
              'is-shortened':suggestion.id === 'shortened'
            }"
            @click="selectSuggestion(idx)"
          >
            <div
              class="suggestion-icon"
              :class="{ 'icon-warning': suggestion.id === 'shortened' }"
            >
              <v-icon size="20">
                {{ suggestion.icon }}
              </v-icon>
            </div>

            <div class="suggestion-content">
              <span class="suggestion-label">{{ suggestion.label }}</span>
              <span class="suggestion-sublabel">{{ suggestion.sublabel }}</span>
            </div>

            <div class="suggestion-meta">
              <span class="suggestion-time">{{ formatTime(suggestion.slot.start) }}</span>
              <span class="suggestion-offset">{{ suggestion.offset }}</span>
            </div>

            <v-icon
              v-if="idx === selectedIdx"
              size="20"
              color="primary"
              class="check-icon"
            >
              mdi-check-circle
            </v-icon>
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-if="suggestions.length === 0"
          class="empty-suggestions"
        >
          <v-icon
            size="32"
            color="grey-lighten-1"
          >
            mdi-calendar-remove
          </v-icon>
          <span>Na tento den nejsou žádné volné sloty</span>
        </div>

        <div class="section-divider" />

        <!-- Custom Date Picker Toggle -->
        <button
          type="button"
          class="suggestion-card custom-picker-toggle"
          :class="{ 'is-selected':showCustomPicker }"
          @click="toggleCustomPicker"
        >
          <div class="suggestion-icon custom">
            <v-icon size="20">
              mdi-calendar-edit
            </v-icon>
          </div>
          <div class="suggestion-content">
            <span class="suggestion-label">Vlastní datum a čas</span>
            <span class="suggestion-sublabel">Vybrat v kalendáři</span>
          </div>
          <v-icon
            size="18"
            :class="{ 'rotate-90' :showCustomPicker }"
          >
            mdi-chevron-right
          </v-icon>
        </button>

        <!-- Custom Picker Expanded -->
        <v-expand-transition>
          <div
            v-if="showCustomPicker"
            class="custom-picker-panel"
          >
            <div class="picker-inputs">
              <v-text-field
                v-model="customDate"
                type="date"
                label="Datum"
                density="compact"
                variant="outlined"
                hide-details
              />
              <v-text-field
                v-model="customTime"
                type="time"
                label="Čas"
                density="compact"
                variant="outlined"
                hide-details
              />
            </div>
            <div
              v-if="customSlot"
              class="picker-preview"
            >
              <v-icon size="16">
                mdi-calendar-check
              </v-icon>
              {{ formatFullDate(customSlot.start) }}, {{ formatTimeRange(customSlot) }}
            </div>
          </div>
        </v-expand-transition>
      </section>

      <!-- Summary -->
      <v-expand-transition>
        <div
          v-if="activeSlot"
          class="summary-banner"
        >
          <v-icon
            size="18"
            color="success"
          >
            mdi-check-circle
          </v-icon>
          <div class="summary-content">
            <span class="summary-title">Nová rezervace</span>
            <span class="summary-detail">
              {{ formatFullDate(activeSlot.start) }}, {{ formatTimeRange(activeSlot) }}
              <span class="summary-duration">({{ formatDuration(activeSlot) }})</span>
            </span>
          </div>
        </div>
      </v-expand-transition>

      <!-- Actions -->
      <footer class="dialog-footer">
        <v-btn
          variant="text"
          color="grey"
          @click="cancel"
        >
          Zrušit
        </v-btn>

        <div class="footer-actions">
          <v-btn
            variant="tonal"
            color="warning"
            size="small"
            prepend-icon="mdi-alert-outline"
            @click="forceCreate"
          >
            Vytvořit s kolizí
          </v-btn>

          <v-btn
            variant="flat"
            color="primary"
            :disabled="!canConfirm"
            prepend-icon="mdi-check"
            @click="confirm"
          >
            Potvrdit
            <template v-if="activeSlot">
              {{ formatTime(activeSlot.start) }}
            </template>
          </v-btn>
        </div>
      </footer>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* ===== DIALOG ===== */
.conflict-dialog {
  border-radius:16px ! important;
  overflow:hidden;
}

/* ===== HEADER ===== */
.dialog-header {
  display:flex;
  align-items:flex-start;
  gap:14px;
  padding:20px;
  background:linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color:white;
}

.header-icon {
  width:48px;
  height:48px;
  background:rgba(255, 255, 255, 0.2);
  border-radius:12px;
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
}

.header-content {
  flex:1;
  min-width:0;
}

.header-title {
  font-size:18px;
  font-weight:600;
  margin:0 0 4px;
}

.header-subtitle {
  font-size:13px;
  opacity:0.9;
  margin:0;
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}

.header-divider {
  opacity:0.5;
}

.duration-chip {
  background:rgba(255, 255, 255, 0.25);
  padding:2px 8px;
  border-radius:10px;
  font-size:11px;
  font-weight:600;
}

.close-btn {
  color:rgba(255, 255, 255, 0.8) !important;
  margin:-8px -8px 0 0;
}

/* ===== CONFLICT BANNER ===== */
.conflict-banner {
  display:flex;
  align-items:center;
  gap:12px;
  padding:14px 20px;
  background:#fef2f2;
  border-bottom:1px solid #fecaca;
}

.conflict-avatar {
  width:40px;
  height:40px;
  background:#ef4444;
  border-radius:50%;
  display:flex;
  align-items:center;
  justify-content:center;
  color:white;
  font-size:16px;
  font-weight:600;
  flex-shrink:0;
}

.conflict-info {
  flex:1;
  display:flex;
  flex-direction:column;
  gap:2px;
}

.conflict-label {
  font-size:11px;
  font-weight:600;
  color:#991b1b;
  text-transform:uppercase;
  letter-spacing:0.3px;
}

.conflict-name {
  font-size:14px;
  font-weight:600;
  color:#7f1d1d;
}

.conflict-time {
  font-size:14px;
  font-weight:700;
  color:#dc2626;
  white-space:nowrap;
}

/* ===== TARGET DAY INFO ===== */
.target-day-info {
  display:flex;
  align-items:center;
  gap:8px;
  padding:10px 20px;
  background:#eff6ff;
  border-bottom:1px solid #bfdbfe;
  font-size:13px;
  color:#1e40af;
}

.target-day-info strong {
  font-weight:600;
}

/* ===== SUGGESTIONS ===== */
.suggestions-section {
  padding:20px;
}

.section-title {
  display:flex;
  align-items:center;
  gap:8px;
  font-size:12px;
  font-weight:600;
  color:#6b7280;
  text-transform:uppercase;
  letter-spacing:0.5px;
  margin:0 0 14px;
}

.suggestions-list {
  display:flex;
  flex-direction:column;
  gap:8px;
}

.empty-suggestions {
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:8px;
  padding:24px;
  color:#9ca3af;
  font-size:13px;
}

.suggestion-card {
  display:flex;
  align-items:center;
  gap:12px;
  padding:12px 14px;
  background:#f9fafb;
  border:2px solid #e5e7eb;
  border-radius:12px;
  cursor:pointer;
  transition:all 0.15s ease;
  text-align:left;
  width:100%;
}

.suggestion-card:hover {
  background:#f3f4f6;
  border-color:#d1d5db;
}

.suggestion-card.is-selected {
  background:#eff6ff;
  border-color:#3b82f6;
}

.suggestion-card.is-shortened {
  background:#fffbeb;
  border-color:#fcd34d;
}

.suggestion-card.is-shortened.is-selected {
  background:#fef3c7;
  border-color:#f59e0b;
}

.suggestion-icon {
  width:40px;
  height:40px;
  background:#e5e7eb;
  border-radius:10px;
  display:flex;
  align-items:center;
  justify-content:center;
  color:#6b7280;
  flex-shrink:0;
  transition:all 0.15s;
}

.suggestion-icon.icon-warning {
  background:#fef3c7;
  color:#d97706;
}

.suggestion-card.is-selected.suggestion-icon:not(.icon-warning) {
  background:#3b82f6;
  color:white;
}

.suggestion-icon.custom {
  background:white;
  border:1px dashed #d1d5db;
}

.suggestion-content {
  flex:1;
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:0;
}

.suggestion-label {
  font-size:14px;
  font-weight:500;
  color:#374151;
}

.suggestion-card.is-selected.suggestion-label {
  font-weight:600;
  color:#1d4ed8;
}

.suggestion-sublabel {
  font-size:12px;
  color:#9ca3af;
}

.suggestion-card.is-selected.suggestion-sublabel {
  color:#60a5fa;
}

.suggestion-meta {
  text-align:right;
  flex-shrink:0;
}

.suggestion-time {
  display:block;
  font-size:15px;
  font-weight:600;
  color:#374151;
}

.suggestion-card.is-selected.suggestion-time {
  color:#1d4ed8;
}

.suggestion-offset {
  display:block;
  font-size:11px;
  color:#9ca3af;
}

.check-icon {
  flex-shrink:0;
}

.section-divider {
  height:1px;
  background:#e5e7eb;
  margin:16px 0;
}

/* Custom Picker */
.custom-picker-toggle {
  border-style:dashed;
}

.rotate-90 {
  transform:rotate(90deg);
  transition:transform 0.2s;
}

.custom-picker-panel {
  margin-top:12px;
  padding:16px;
  background:#f8fafc;
  border:1px solid #e5e7eb;
  border-radius:12px;
}

.picker-inputs {
  display:grid;
  grid-template-columns:1.5fr 1fr;
  gap:12px;
}

.picker-preview {
  margin-top:14px;
  padding:10px 14px;
  background:#eff6ff;
  border-radius:8px;
  display:flex;
  align-items:center;
  gap:8px;
  font-size:14px;
  font-weight:500;
  color:#1d4ed8;
}

/* ===== SUMMARY ===== */
.summary-banner {
  display:flex;
  align-items:center;
  gap:12px;
  margin:0 20px 16px;
  padding:14px 16px;
  background:linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
  border:1px solid #a7f3d0;
  border-radius:12px;
}

.summary-content {
  display:flex;
  flex-direction:column;
  gap:2px;
}

.summary-title {
  font-size:12px;
  font-weight:600;
  color:#059669;
  text-transform:uppercase;
  letter-spacing:0.3px;
}

.summary-detail {
  font-size:14px;
  font-weight:500;
  color:#065f46;
}

.summary-duration {
  color:#10b981;
  font-weight:600;
}

/* ===== FOOTER ===== */
.dialog-footer {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:16px 20px;
  background:#f9fafb;
  border-top:1px solid #e5e7eb;
}

.footer-actions {
  display:flex;
  gap:10px;
}
</style>
