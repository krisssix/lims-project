<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import FilterMultiSelect from '@/components/ui/FilterMultiSelect.vue'
import ModernSwitch from '@/components/ui/ModernSwitch.vue'

// Types
export type DateFilterField = 'date' | 'createdAt' | 'updatedAt'
export type DateRangePreset = 'today' | 'thisWeek' | 'nextWeek' | 'thisMonth' | 'custom' | null

export interface DateFilter {
  field: DateFilterField
  preset: DateRangePreset
  from: Date | null
  to: Date | null
}

const props = defineProps<{
  modelValue: DateFilter
  hidePresets?: boolean
  hideFieldToggle?: boolean
  hideFilterTypeButtons?: boolean
  showDateLabel?: boolean
  headerLabel?: string
  headerIcon?: string
  showRangePresets?: boolean
  viewMode?: 'daily-machines' | 'week-work' | 'week-all' | 'daily-list'
  devices?: Array<{ id: string; name: string; color?: string; active?: boolean }>
  members?: string[]
  templates?: Array<{ id: string; name: string }>
  pickedDevices?: string[]
  pickedMembers?: string[]
  pickedTemplates?: string[]
  includeWeekends?: boolean
  showTwoWeeks?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: DateFilter]
  'update:pickedDevices': [value: string[]]
  'update:pickedMembers': [value: string[]]
  'update:pickedTemplates': [value: string[]]
  'update:includeWeekends': [value: boolean]
  'update:showTwoWeeks': [value: boolean]
  'close': []
}>()

// Computed for showing weekend toggle
const showWeekendToggle = computed(() =>
  props.viewMode === 'week-work' ||
  props.viewMode === 'week-all' ||
  props.modelValue.preset === 'thisWeek' ||
  props.modelValue.preset === 'nextWeek'
)

// Lokální stav
const localField = ref<DateFilterField>(props.modelValue.field)
const viewDate = ref(new Date())
const deviceSearch = ref('')
const showInactiveDevices = ref(false)
const isRangeSelectMode = ref(false)

// --- Sync & Watchers ---

watch(() => props.modelValue.field, (val) => {
  localField.value = val
})

// Consolidated watcher for modelValue changes
watch(() => props.modelValue, (newVal) => {
  if (newVal.from) {
    // 1. Sync calendar viewDate if month/year changed
    const vY = viewDate.value.getFullYear()
    const vM = viewDate.value.getMonth()
    const dY = newVal.from.getFullYear()
    const dM = newVal.from.getMonth()
    if (vY !== dY || vM !== dM) {
      viewDate.value = new Date(dY, dM, 1)
    }

    // 2. Auto-select today if current date matches (for immediate sync)
    const today = new Date()
    const isToday = newVal.from.toDateString() === today.toDateString()
    // Check if it's a single day selection (to is null or same as from)
    // NOTE: This check must be robust. If preset is 'thisWeek' or 'nextWeek', 'to' will differ from 'from', so isSingleDay is false.
    // If preset is 'custom' and user selected range, isSingleDay is false.
    // Only if user clicked single day or reset to today, isSingleDay is true.
    const isSingleDay = !newVal.to || newVal.to.toDateString() === newVal.from.toDateString()

    if (isToday && isSingleDay && newVal.preset !== 'today') {
      emit('update:modelValue', { ...newVal, preset: 'today' })
    } else if (!isToday && newVal.preset === 'today') {
      emit('update:modelValue', { ...newVal, preset: 'custom' })
    }
  }
}, { deep: true, immediate: true })

watch(() => props.includeWeekends, () => {
   if (props.modelValue.preset === 'thisWeek') selectThisWeek()
   if (props.modelValue.preset === 'nextWeek') selectNextWeek()
 })
 
 // Reset range selection mode if switching to daily-machines
 watch(() => props.viewMode, (val) => {
   if (val === 'daily-machines') {
     isRangeSelectMode.value = false
     pendingStart.value = null
   }
 })
 
 // Mutual exclusion: when showTwoWeeks is enabled, disable range mode
 watch(() => props.showTwoWeeks, (val) => {
   if (val && isRangeSelectMode.value) {
     isRangeSelectMode.value = false
     pendingStart.value = null
   }
 })

const dynamicHeaderLabel = computed(() => {
  if (!props.modelValue.from) {
    return 'Všechna měření'
  }

  const from = props.modelValue.from
  const to = props.modelValue.to

  // Single day vs Range detection
  const isSingleDay = !to || from.toDateString() === to.toDateString()

  if (isSingleDay) {
    return from.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  // Range formatting
  const sameMonth = to && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()

  if (sameMonth) {
    // pondělí 19. – neděle 25. ledna 2026
    const start = from.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric' })
    const end = to.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return `${start} – ${end}`
  } else {
    // 19. ledna – 2. února 2026
    const start = from.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' })
    const end = to.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
    return `${start} – ${end}`
  }
})

const headerFontSize = computed(() => {
  return dynamicHeaderLabel.value.length > 30 ? '14px' : '18px'
})

// No auto-set on mount - show all measurements by default

const isActive = computed(() =>
  props.modelValue.preset !== null || props.modelValue.from !== null
)

// Check if any filter is active (date, devices, members, templates)
const hasAnyFilter = computed(() =>
  isActive.value ||
  (props.pickedDevices && props.pickedDevices.length > 0) ||
  (props.pickedMembers && props.pickedMembers.length > 0) ||
  (props.pickedTemplates && props.pickedTemplates.length > 0)
)

const filteredDevices = computed(() => {
  if (!props.devices) return []
  
  // Filter out inactive devices unless toggle is on
  const devicesToShow = showInactiveDevices.value 
    ? props.devices 
    : props.devices.filter(d => d.active !== false)
  
  if (!deviceSearch.value.trim()) return devicesToShow

  const search = deviceSearch.value.toLowerCase()
  return devicesToShow.filter(d =>
    d.name.toLowerCase().includes(search)
  )
})

const monthName = computed(() => {
  return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(viewDate.value)
})

const weekDays = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

const calendarDays = computed(() => {
  const year = viewDate.value.getFullYear()
  const month = viewDate.value.getMonth()
  const firstDay = new Date(year, month, 1)
  let startDayOfWeek = firstDay.getDay()
  startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const prevMonthLastDay = new Date(year, month, 0).getDate()

  // Calculate week range for highlighting
  const selectedDate = props.modelValue.from
  let weekStart: Date | null = null
  let weekEnd: Date | null = null

  // Highlight week in week views OR when 'thisWeek' or 'nextWeek' preset is selected
  // BUT NOT if we are in 'custom' mode (user manually selected range)
  const isWeekView = (props.viewMode === 'week-work' || props.viewMode === 'week-all') && props.modelValue.preset !== 'custom'
  const isWeekPreset = props.modelValue.preset === 'thisWeek' || props.modelValue.preset === 'nextWeek'

  if (selectedDate && (isWeekView || isWeekPreset)) {
    // Get Monday of selected week
    const dayOfWeek = selectedDate.getDay()
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    weekStart = new Date(selectedDate)
    weekStart.setDate(selectedDate.getDate() + diffToMonday)
    weekStart.setHours(0, 0, 0, 0)

    // Get end of week - respects includeWeekends and showTwoWeeks
    weekEnd = new Date(weekStart)
    const baseDiff = (props.includeWeekends || props.viewMode === 'week-all') ? 6 : 4
    const totalDiff = props.showTwoWeeks ? baseDiff + 7 : baseDiff
    weekEnd.setDate(weekStart.getDate() + totalDiff)
    weekEnd.setHours(23, 59, 59, 999)
  }

  // Calculate month range for highlighting when 'thisMonth' preset is selected
  const isThisMonthPreset = props.modelValue.preset === 'thisMonth'
  let monthStart: Date | null = null
  let monthEnd: Date | null = null

  if (selectedDate && isThisMonthPreset) {
    monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
    monthStart.setHours(0, 0, 0, 0)
    monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)
    monthEnd.setHours(23, 59, 59, 999)
  }

  // Calculate custom range for highlighting (any date range selection)
  let rangeStart: Date | null = null
  let rangeEnd: Date | null = null
  
  if (props.modelValue.from && props.modelValue.to) {
    rangeStart = new Date(props.modelValue.from)
    rangeStart.setHours(0, 0, 0, 0)
    rangeEnd = new Date(props.modelValue.to)
    rangeEnd.setHours(23, 59, 59, 999)
  }

  // Helper to determine if a date should be highlighted
  const shouldHighlight = (d: Date, start: Date | null, end: Date | null) => {
    if (!start || !end) return false
    if (d < start || d > end) return false
    
    // Check weekend exclusion
    // If includeWeekends is FALSE, and we are NOT in week-all view, then weekends are NOT highlighted
    const dDay = d.getDay()
    const isWeekend = dDay === 0 || dDay === 6
    const weekendsIncluded = props.includeWeekends || props.viewMode === 'week-all'
    
    if (isWeekend && !weekendsIncluded) return false
    return true 
  }

  const days: Array<{ day: number; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean; isWeekend: boolean; isInWeek: boolean; isInMonth: boolean; isInRange: boolean; isPendingStart: boolean; date: Date }> = []

  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i
    const date = new Date(year, month - 1, d)
    const isInWeek = shouldHighlight(date, weekStart, weekEnd)
    const isInMonth = monthStart && monthEnd ? date >= monthStart && date <= monthEnd : false
    const isInRange = shouldHighlight(date, rangeStart, rangeEnd)
    
    const dDay = date.getDay()
    const isWeekend = dDay === 0 || dDay === 6
    
    days.push({
      day: d,
      isCurrentMonth: false,
      isToday: false,
      isSelected: false,
      isWeekend,
      isInWeek,
      isInMonth,
      isInRange,
      isPendingStart: false,
      date
    })
  }

  const today = new Date()
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    const dayOfWeek = date.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const isToday = date.toDateString() === today.toDateString()
    // Highlight both From and To dates as specifically "selected" (dark blue)
    const isSelected = (props.modelValue.from && date.toDateString() === props.modelValue.from.toDateString()) || (props.modelValue.to && date.toDateString() === props.modelValue.to.toDateString())
    const isInWeek = shouldHighlight(date, weekStart, weekEnd)
    const isInMonth = monthStart && monthEnd ? date >= monthStart && date <= monthEnd : false
    const isInRange = shouldHighlight(date, rangeStart, rangeEnd)
    const isPendingStart = pendingStart.value ? date.toDateString() === pendingStart.value.toDateString() : false

    days.push({
      day: d,
      isCurrentMonth: true,
      isToday,
      isSelected: !!isSelected,
      isWeekend,
      isInWeek,
      isInMonth,
      isInRange,
      isPendingStart,
      date
    })
  }

  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const date = new Date(year, month + 1, d)
    const isInWeek = shouldHighlight(date, weekStart, weekEnd)
    const isInMonth = monthStart && monthEnd ? date >= monthStart && date <= monthEnd : false
    const isInRange = shouldHighlight(date, rangeStart, rangeEnd)
    
    const dDay = date.getDay()
    const isWeekend = dDay === 0 || dDay === 6

    days.push({
      day: d,
      isCurrentMonth: false,
      isToday: false,
      isSelected: false,
      isWeekend: false,
      isInWeek,
      isInMonth,
      isInRange,
      isPendingStart: false,
      date
    })
  }

  return days
})

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7
  const start = new Date(d)
  start.setDate(d.getDate() - day)
  return startOfDay(start)
}

function endOfWeek(d: Date): Date {
  const start = startOfWeek(d)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return endOfDay(end)
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

function prevMonth() {
  const newDate = new Date(viewDate.value.getFullYear(), viewDate.value.getMonth() - 1, 1)
  viewDate.value = newDate
  
  // If in month mode, update selection too
  if (props.modelValue.preset === 'thisMonth') {
    emit('update:modelValue', {
      ...props.modelValue,
      from: startOfMonth(newDate),
      to: endOfMonth(newDate),
      preset: 'thisMonth'
    })
  }
}

function nextMonth() {
  const newDate = new Date(viewDate.value.getFullYear(), viewDate.value.getMonth() + 1, 1)
  viewDate.value = newDate
  
  // If in month mode, update selection too
  if (props.modelValue.preset === 'thisMonth') {
    emit('update:modelValue', {
      ...props.modelValue,
      from: startOfMonth(newDate),
      to: endOfMonth(newDate),
      preset: 'thisMonth'
    })
  }
}

// State for smart selection (1st click = start, 2nd click = end)
const pendingStart = ref<Date | null>(null)

function selectToday() {
  const today = new Date()
  pendingStart.value = null // Clear pending on preset usage
  
  // Update local field to reflect the change visually immediately
  localField.value = 'createdAt'

  emit('update:modelValue', {
    field: 'createdAt',
    preset: 'today',
    from: startOfDay(today),
    to: endOfDay(today)
  })
  emit('close')
}

function selectThisWeek() {
  const today = new Date()
  const start = startOfWeek(today)
  const end = new Date(start)
  
  const baseAdd = (props.includeWeekends || props.viewMode === 'week-all') ? 6 : 4
  const finalAdd = props.showTwoWeeks ? baseAdd + 7 : baseAdd
  end.setDate(start.getDate() + finalAdd)

  pendingStart.value = null // Clear pending
  emit('update:modelValue', {
    field: localField.value,
    preset: 'thisWeek',
    from: start,
    to: endOfDay(end)
  })
  emit('close')
}

function selectNextWeek() {
  const today = new Date()
  const nextWeekDate = new Date(today)
  nextWeekDate.setDate(today.getDate() + 7)
  const start = startOfWeek(nextWeekDate)
  const end = new Date(start)
  
  const baseAdd = (props.includeWeekends || props.viewMode === 'week-all') ? 6 : 4
  const finalAdd = props.showTwoWeeks ? baseAdd + 7 : baseAdd
  end.setDate(start.getDate() + finalAdd)

  pendingStart.value = null // Clear pending
  emit('update:modelValue', {
    field: localField.value,
    preset: 'nextWeek',
    from: start,
    to: endOfDay(end)
  })
  emit('close')
}

function selectThisMonth() {
  const today = new Date()
  pendingStart.value = null
  emit('update:modelValue', {
    field: localField.value,
    preset: 'thisMonth',
    from: startOfMonth(today),
    to: endOfMonth(today)
  })
  emit('close')
}

function selectWeekOf(date: Date) {
     const start = startOfWeek(date)
     const end = new Date(start)
     const baseAdd = (props.includeWeekends || props.viewMode === 'week-all') ? 6 : 4
     const finalAdd = props.showTwoWeeks ? baseAdd + 7 : baseAdd
     end.setDate(start.getDate() + finalAdd)
 
     pendingStart.value = null
     emit('update:modelValue', {
       field: localField.value,
       preset: 'custom',
       from: start,
       to: endOfDay(end)
     })
     emit('close')
 }
 
 function selectDay(date: Date) {
  if (!isRangeSelectMode.value) {
    // If explicitly in a week view, selecting a day selects the whole week
    if (props.viewMode === 'week-work' || props.viewMode === 'week-all') {
      selectWeekOf(date)
      return
    }

    // Otherwise (daily views, lists, or undefined/default), select just the single day
    pendingStart.value = null
    emit('update:modelValue', {
      field: localField.value,
      preset: 'custom',
      from: startOfDay(date),
      to: endOfDay(date)
    })
    emit('close')
    return
  }

   // Manual Range Mode (Smart selection logic)
   if (pendingStart.value === null) {
       // First click: Select start
       pendingStart.value = date
       // Visual feedback: select just this day temporarily
       emit('update:modelValue', {
         field: localField.value,
         preset: 'custom',
         from: startOfDay(date),
         to: endOfDay(date)
       })
   } else {
       // Second click
       if (date >= pendingStart.value) {
           // Valid range: Start -> End
           emit('update:modelValue', {
             field: localField.value,
             preset: 'custom',
             from: startOfDay(pendingStart.value),
             to: endOfDay(date)
           })
           pendingStart.value = null // Reset after range completion
           emit('close')
       } else {
           // Clicked before start: Treat as new start
           pendingStart.value = date
           emit('update:modelValue', {
             field: localField.value,
             preset: 'custom',
             from: startOfDay(date),
             to: endOfDay(date)
           })
       }
   }
 }

function clearFilter() {
  pendingStart.value = null
  emit('update:modelValue', {
    field: localField.value,
    preset: null,
    from: null,
    to: null
  })
  // Also clear device, member and template filters
  emit('update:pickedDevices', [])
  emit('update:pickedMembers', [])
  emit('update:pickedTemplates', [])
  emit('close')
}

function setField(newField: DateFilterField) {
  localField.value = newField
  if (props.modelValue.from) {
    emit('update:modelValue', {
      ...props.modelValue,
      field: newField
    })
  }
}

const dateFromInput = computed({
  get: () => {
    const d = props.modelValue.from
    if (!d) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  },
  set: (v) => {
    if (!v) {
      emit('update:modelValue', { ...props.modelValue, from: null, preset: 'custom' })
      return
    }
    const [y, m, d] = v.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    emit('update:modelValue', {
      ...props.modelValue,
      from: startOfDay(date),
      preset: 'custom'
    })
  }
})

const dateToInput = computed({
  get: () => {
    const d = props.modelValue.to
    if (!d) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  },
  set: (v) => {
    if (!v) {
      emit('update:modelValue', { ...props.modelValue, to: null, preset: 'custom' })
      return
    }
    const [y, m, d] = v.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    emit('update:modelValue', {
      ...props.modelValue,
      to: endOfDay(date),
      preset: 'custom'
    })
  }
})
</script>

<template>
  <div class="date-filter-card">
    <!-- HEADER -->
    <div class="date-filter-header">
      <div
        class="header-label"
        :style="{ fontSize: headerFontSize }"
      >
        <v-icon
          size="20"
          :class="['header-icon', { 'mr-1': true }]"
          :style="{ fontSize: headerFontSize === '14px' ? '18px' : '20px' }"
        >
          {{ headerIcon || 'mdi-flask' }}
        </v-icon>
        {{ dynamicHeaderLabel }}
      </div>

      <div
        v-if="false"
        class="field-toggle"
      >
        <v-tooltip
          text="Filtrování podle data měření."
          location="top"
        >
          <template #activator="{props:tooltipProps}">
            <button
              v-bind="tooltipProps"
              type="button"
              :class="['toggle-btn',{active:localField==='date'}]"
              @click="setField('date')"
            >
              <v-icon size="16">
                mdi-flask
              </v-icon>
              <span>Data měření</span>
            </button>
          </template>
        </v-tooltip>

        <v-tooltip
          text="Filtrování podle data vložení záznamu."
          location="top"
        >
          <template #activator="{props:tooltipProps}">
            <button
              v-bind="tooltipProps"
              type="button"
              :class="['toggle-btn',{active:localField==='createdAt'}]"
              @click="setField('createdAt')"
            >
              <v-icon size="16">
                mdi-plus
              </v-icon>
              <span>Data vložení</span>
            </button>
          </template>
        </v-tooltip>

        <v-tooltip
          text="Filtrování podle data poslední změny."
          location="top"
        >
          <template #activator="{props:tooltipProps}">
            <button
              v-bind="tooltipProps"
              type="button"
              :class="['toggle-btn',{active:localField==='updatedAt'}]"
              @click="setField('updatedAt')"
            >
              <v-icon size="16">
                mdi-pencil
              </v-icon>
              <span>Data změny</span>
            </button>
          </template>
        </v-tooltip>
      </div>
    </div>

    <!-- KALENDÁŘ -->
    <div class="calendar-section">
      <div class="calendar-header">
        <button
          type="button"
          class="nav-btn"
          aria-label="Předchozí měsíc"
          @click="prevMonth"
        >
          <v-icon size="20">
            mdi-chevron-left
          </v-icon>
        </button>
        <div class="month-label">
          {{ monthName }}
        </div>
        <button
          type="button"
          class="nav-btn"
          aria-label="Další měsíc"
          @click="nextMonth"
        >
          <v-icon size="20">
            mdi-chevron-right
          </v-icon>
        </button>
      </div>

      <div class="weekdays">
        <div
          v-for="(day, i) in weekDays"
          :key="day"
          :class="['weekday', { weekend: i >= 5 }]"
        >
          {{ day }}
        </div>
      </div>

      <div class="days-grid">
        <button
          v-for="(day, i) in calendarDays"
          :key="i"
          type="button"
          :class="[
            'day-btn',
            {
              'other-month': !day.isCurrentMonth,
              'weekend': day.isWeekend && day.isCurrentMonth,
              'today': day.isToday,
              'selected': day.isSelected,
              'in-week': day.isInWeek,
              'in-month': day.isInMonth && day.isCurrentMonth,
              'in-range': day.isInRange,
              'pending-start': day.isPendingStart && day.isCurrentMonth
            }
          ]"
          @click="selectDay(day.date)"
        >
          {{ day.day }}
        </button>
      </div>
    </div>


    <!-- DNES + PRESETS -->
    <div class="quick-actions">
      <button
        type="button"
        :class="['action-btn primary', { active: (viewMode === 'week-work' || viewMode === 'week-all') ? (modelValue.preset === 'today' || modelValue.preset === 'thisWeek') : (modelValue.preset === 'today') }]"
        @click="(viewMode === 'week-work' || viewMode === 'week-all') ? selectThisWeek() : selectToday()"
      >
        <v-icon size="18">
          {{ viewMode === 'week-work' || viewMode === 'week-all' ? 'mdi-calendar-week' : 'mdi-calendar-today' }}
        </v-icon>
        <span>{{ viewMode === 'week-work' || viewMode === 'week-all' ? 'Tento týden' : 'Dnes' }}</span>
      </button>

      <!-- Next week button for week views -->
      <button
        v-if="viewMode === 'week-work' || viewMode === 'week-all'"
        type="button"
        :class="['action-btn', { active: modelValue.preset === 'nextWeek' }]"
        @click="selectNextWeek"
      >
        <v-icon size="18">
          mdi-calendar-arrow-right
        </v-icon>
        <span>Příští týden</span>
      </button>

      <template v-if="showRangePresets">
        <button
          type="button"
          :class="['action-btn', { active: modelValue.preset === 'thisWeek' }]"
          @click="selectThisWeek"
        >
          <v-icon size="18">
            mdi-calendar-week
          </v-icon>
          <span>Tento týden</span>
        </button>
        <button
          type="button"
          :class="['action-btn', { active: modelValue.preset === 'thisMonth' }]"
          @click="selectThisMonth"
        >
          <v-icon size="18">
            mdi-calendar-month
          </v-icon>
          <span>Tento měsíc</span>
        </button>
      </template>
    </div>


    <!-- FILTER TOGGLE -->
    <div
      v-if="!hideFieldToggle"
      class="filter-type-section"
    >
      <!-- Hint when custom range mode is active -->
      <div
        v-if="isRangeSelectMode"
        class="filter-hint-banner range-mode-hint"
      >
        <div class="hint-icon">
          <v-icon
            size="18"
            color="white"
          >
            mdi-cursor-pointer
          </v-icon>
        </div>
        <div class="hint-content">
          <div class="hint-title">
            {{ pendingStart ? 'Nyní vyberte konec rozmezí' : 'Vyberte časové rozmezí' }}
          </div>
          <div class="hint-text">
            {{ pendingStart ? 'Klikněte na koncové datum v kalendáři' : 'Klikněte na počáteční datum v kalendáři' }}
          </div>
        </div>
      </div>

      <!-- Hint when no date selected -->
      <div
        v-else-if="!modelValue.from"
        class="filter-hint-banner"
      >
        <div class="hint-icon">
          <v-icon
            size="18"
            color="white"
          >
            mdi-information-outline
          </v-icon>
        </div>
        <div class="hint-content">
          <div class="hint-title">
            Nejprve vyberte datum
          </div>
          <div class="hint-text">
            Pro aktivaci filtrování klikněte na datum v kalendáři výše
          </div>
        </div>
      </div>
      
      <template v-if="!hideFilterTypeButtons">
        <div class="filter-section-title">
          <v-icon
            size="14"
            class="mr-1"
          >
            mdi-filter-variant
          </v-icon>
          <span>Filtrovat podle</span>
        </div>
        <div class="field-toggle-light">
          <v-tooltip
            text="Filtrování podle data vložení."
            location="top"
          >
            <template #activator="{props:tooltipProps}">
              <button
                v-bind="tooltipProps"
                type="button"
                :class="['toggle-btn-light',{active:localField==='createdAt', disabled: !modelValue.from}]"
                :disabled="!modelValue.from"
                @click="setField('createdAt')"
              >
                <v-icon size="16">
                  mdi-plus
                </v-icon>
                <span>Data vložení</span>
              </button>
            </template>
          </v-tooltip>
          <v-tooltip
            text="Filtrování podle data měření."
            location="top"
          >
            <template #activator="{props:tooltipProps}">
              <button
                v-bind="tooltipProps"
                type="button"
                :class="['toggle-btn-light',{active:localField==='date', disabled: !modelValue.from}]"
                :disabled="!modelValue.from"
                @click="setField('date')"
              >
                <v-icon size="16">
                  mdi-flask
                </v-icon>
                <span>Data měření</span>
              </button>
            </template>
          </v-tooltip>
          <v-tooltip
            text="Filtrování podle data změny."
            location="top"
          >
            <template #activator="{props:tooltipProps}">
              <button
                v-bind="tooltipProps"
                type="button"
                :class="['toggle-btn-light',{active:localField==='updatedAt', disabled: !modelValue.from}]"
                :disabled="!modelValue.from"
                @click="setField('updatedAt')"
              >
                <v-icon size="16">
                  mdi-pencil
                </v-icon>
                <span>Data změny</span>
              </button>
            </template>
          </v-tooltip>
        </div>
      </template>
    </div>

    <div class="toggles-section">
      <!-- Weekends Toggle (for week views) -->
      <v-tooltip
        v-if="showWeekendToggle"
        text="Zobrazí v kalendáři i sobotu a neděli"
        location="top"
      >
        <template #activator="{ props: tooltipProps }">
          <div v-bind="tooltipProps">
            <ModernSwitch
              :model-value="includeWeekends"
              label="Včetně víkendů"
              @update:model-value="v => emit('update:includeWeekends', v)"
            />
          </div>
        </template>
      </v-tooltip>

      <!-- CUSTOM RANGE SELECT MODE -->
      <v-tooltip
        v-if="viewMode !== 'daily-machines'"
        text="Umožní vybrat libovolný rozsah dat kliknutím na začátek a konec v kalendáři"
        location="top"
      >
        <template #activator="{ props: tooltipProps }">
          <div v-bind="tooltipProps">
            <ModernSwitch
              :model-value="isRangeSelectMode"
              label="Vlastní časové rozmezí"
              @update:model-value="v => { 
                isRangeSelectMode = v; 
                pendingStart = null; 
                // Mutual exclusion: disable 2-weeks when enabling custom range
                if (v && showTwoWeeks) emit('update:showTwoWeeks', false);
              }"
            />
          </div>
        </template>
      </v-tooltip>

      <!-- Two Weeks Toggle (for week views) -->
      <v-tooltip
        v-if="showWeekendToggle"
        :text="isRangeSelectMode ? 'Nejprve vypněte Vlastní rozmezí' : 'Zobrazí dva týdny najednou pod sebou'"
        location="top"
      >
        <template #activator="{ props: tooltipProps }">
          <div v-bind="tooltipProps">
            <ModernSwitch
              :model-value="showTwoWeeks"
              label="Dva týdny"
              :disabled="isRangeSelectMode"
              @update:model-value="v => {
                emit('update:showTwoWeeks', v);
                // Adjust current range if one is selected
                if (props.modelValue.from && props.modelValue.preset && props.modelValue.preset !== 'custom') {
                   if (props.modelValue.preset === 'today') selectToday();
                   else if (props.modelValue.preset === 'thisWeek') selectThisWeek();
                   else if (props.modelValue.preset === 'nextWeek') selectNextWeek();
                }
              }"
            />
          </div>
        </template>
      </v-tooltip>
    </div>
    <!-- MANUAL RANGE -->
    <div
      v-if="!hidePresets"
      class="manual-range-section"
    >
      <div
        class="range-labels-row"
        style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"
      >
        <div
          class="range-label"
          style="margin-bottom: 0;"
        >
          Časové rozmezí
        </div>
        <button
          v-if="modelValue.from || modelValue.to"
          type="button"
          class="clear-filter-btn"
          @click="clearFilter"
        >
          Vymazat filtr
        </button>
      </div>
      <div class="range-inputs">
        <div class="range-field">
          <label>Od</label>
          <input
            v-model="dateFromInput"
            type="date"
            class="date-input"
            :max="dateToInput"
          >
        </div>
        <div class="range-separator">
          <v-icon size="16">
            mdi-arrow-right
          </v-icon>
        </div>
        <div class="range-field">
          <label>Do</label>
          <input
            v-model="dateToInput"
            type="date"
            class="date-input"
            :min="dateFromInput"
          >
        </div>
      </div>
    </div>

    <!-- FILTERS SECTION (Devices, Templates & Members) -->
    <div
      v-if="devices?.length || members?.length || templates?.length"
      class="filters-section"
    >
      <div class="filter-section-title">
        <v-icon size="16">
          mdi-filter-variant
        </v-icon>
        <span>Filtry</span>
      </div>

      <!-- Device filter -->
      <div
        v-if="devices?.length"
        class="filter-row"
      >
        <FilterMultiSelect
          :model-value="pickedDevices || []"
          :items="filteredDevices"
          label="Přístroje"
          item-title="name"
          item-value="id"
          icon="mdi-flask-outline"
          all-label="Všechny"
          @update:model-value="v => emit('update:pickedDevices', v)"
        >
          <template #extra-actions>
            <div class="px-2 py-2 border-t">
              <v-checkbox
                v-model="showInactiveDevices"
                density="compact"
                hide-details
                label="Zobrazit i neaktivní"
              />
            </div>
          </template>
        </FilterMultiSelect>
      </div>

      <!-- Templates filter (for measurements) -->
      <div
        v-if="templates?.length"
        class="filter-row"
      >
        <FilterMultiSelect
          :model-value="pickedTemplates || []"
          :items="templates"
          label="Šablony"
          item-title="name"
          item-value="id"
          icon="mdi-file-document-outline"
          all-label="Všechny"
          @update:model-value="v => emit('update:pickedTemplates', v)"
        />
      </div>

      <!-- Member filter -->
      <div
        v-if="members?.length"
        class="filter-row"
      >
        <FilterMultiSelect
          :model-value="pickedMembers || []"
          :items="members.map(m => ({ id: m, name: m }))"
          label="Členové"
          item-title="name"
          item-value="id"
          icon="mdi-account-multiple-outline"
          all-label="Všichni"
          @update:model-value="v => emit('update:pickedMembers', v)"
        />
      </div>
    </div>

    <!-- CLEAR FILTER -->
    <div
      v-if="hasAnyFilter"
      class="clear-section"
    >
      <button
        type="button"
        class="clear-btn"
        @click="clearFilter"
      >
        <v-icon size="18">
          mdi-filter-off
        </v-icon>
        <span>Vymazat filtr</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}

.date-filter-card {
  width: 100%;
  max-width: 360px;
  border-radius: 16px;
  overflow: visible;
  background: linear-gradient(to bottom, #ffffff, #fafbfc);
  border: 1px solid #e5e7eb;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
}

@media (max-width: 400px) {
  .date-filter-card {
    width: 100%;
    max-width: 100%;
  }
}

/* Header */
.date-filter-header {
  padding: 16px;
  background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
  color: white;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
}

.header-label {
  font-weight: 600;
  letter-spacing: 0.3px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: font-size 0.2s ease;
  min-height: 28px;
}

.header-icon {
  opacity: 0.9;
}

.field-toggle {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 3px;
  backdrop-filter: blur(10px);
}

.toggle-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 4px;
  border: none;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.2px;
}

.toggle-btn span {
  line-height: 1;
}

.toggle-btn.active {
  background: white;
  color: #1e40af;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.action-btn:active {
  transform: translateY(0);
}

/* Manual Range */
.manual-range-section {
  padding: 16px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

.range-label {
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.range-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.range-field label {
  font-size: 10px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.date-input {
  width: 100%;
  padding: 8px 10px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #111827;
  outline: none;
  font-family: inherit;
  transition: all 0.2s ease;
  background: white;
}

.date-input:hover {
  border-color: #d1d5db;
}

.date-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.range-separator {
  color: #d1d5db;
  padding-top: 18px;
}

/* Filters Section (Devices & Members) */
.filters-section {
  padding: 16px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

.filter-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.filter-row {
  margin-bottom: 8px;
}

.filter-row:last-child {
  margin-bottom: 0;
}

.filter-row :deep(.btn-secondary) {
  width: 100%;
  justify-content: flex-start;
}

.filter-group {
  margin-bottom: 12px;
}

.filter-group:last-child {
  margin-bottom: 0;
}

.filter-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}

.filter-count {
  background: #3b82f6;
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 10px;
  margin-left: auto;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.filter-chip {
  padding: 4px 10px;
  border: 1px solid #d1d5db;
  border-radius: 16px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  background: white;
  color: #4b5563;
  transition: all 0.15s ease;
}

.filter-chip:hover {
  border-color: #9ca3af;
  background: #f3f4f6;
}

.filter-chip.active {
  border-color: transparent;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

/* Filter Section */
.filter-section {
  padding: 16px 16px 0;
  border-top: 1px solid #e5e7eb;
  background: white;
}

.filter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.filter-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: #111827;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.link-btn {
  font-size: 10px;
  font-weight: 600;
  color: #3b82f6;
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s ease;
  padding: 3px 0;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.link-btn:hover {
  color: #2563eb;
  text-decoration: underline;
}

/* Dropdown Container */
.dropdown-container {
  position: relative;
  margin-bottom: 16px;
}

/* Outlined Dropdown Button - matching the reference style */
.outlined-dropdown-btn {
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background-color: #fafafa;
  color: #424242;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
}

.outlined-dropdown-btn:hover {
  background-color: #f5f5f5;
  border-color: #d0d0d0;
}

.outlined-dropdown-btn .btn-icon {
  color: #757575;
  flex-shrink: 0;
}

.outlined-dropdown-btn .btn-label {
  color: #757575;
  flex-shrink: 0;
}

.outlined-dropdown-btn .btn-value {
  font-weight: 600;
  color: #424242;
  flex-shrink: 0;
}

.outlined-dropdown-btn .btn-arrow {
  color: #757575;
  margin-left: auto;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.outlined-dropdown-btn .btn-arrow.open {
  transform: rotate(180deg);
}

/* Dropdown Menu - floating below button */
.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-height: none;
  overflow: visible;
  display: flex;
  flex-direction: column;
}

/* Dropdown Actions Bar */
.dropdown-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #fafafa;
}

.action-link {
  font-size: 12px;
  font-weight: 600;
  color: #3b82f6;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.action-link:hover:not(:disabled) {
  background: #eff6ff;
}

.action-link.danger {
  color: rgb(68, 71, 239);
}

.action-link.danger:hover:not(:disabled) {
  background: #a1b0f7;
}

.action-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dropdown-search {
  padding: 10px;
  border-bottom: 1px solid #f3f4f6;
  flex-shrink: 0;
  position: relative;
}

.dropdown-search .search-icon {
  position: absolute;
  left: 20px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
}

.dropdown-search .search-input {
  width: 100%;
  padding: 7px 12px 7px 36px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  color: #111827;
  outline: none;
  font-family: inherit;
  transition: all 0.2s ease;
}

.dropdown-search .search-input::placeholder {
  color: #9ca3af;
}

.dropdown-search .search-input:focus {
  border-color: #3b82f6;
}

.dropdown-list {
  overflow-y: auto;
  max-height: 240px;
  padding: 4px;
}

.dropdown-list::-webkit-scrollbar {
  width: 6px;
}

.dropdown-list::-webkit-scrollbar-track {
  background: transparent;
}

.dropdown-list::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 3px;
}

.dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.dropdown-item:hover {
  background: #f3f4f6;
}

.dropdown-item.selected {
  background: #eff6ff;
}

.dropdown-item.selected:hover {
  background: #dbeafe;
}

.item-avatar-small {
  width: 28px;
  height: 28px;
  background: #e5e7eb;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  flex-shrink: 0;
}

.dropdown-item.selected .item-avatar-small {
  background: #3b82f6;
  color: white;
}

.item-indicator-small {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d1d5db;
  flex-shrink: 0;
}

.dropdown-item.selected .item-indicator-small {
  width: 10px;
  height: 10px;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.dropdown-item .item-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.dropdown-item.selected .item-name {
  color: #1e40af;
  font-weight: 600;
}

.dropdown-item .check-icon {
  color: #3b82f6;
  flex-shrink: 0;
}

/* Checkbox icon */
.checkbox-icon {
  color: #9ca3af;
  flex-shrink: 0;
}

.dropdown-item.selected .checkbox-icon {
  color: #3b82f6;
}

/* Device chip */
.device-chip {
  font-weight: 600 !important;
  height: 24px !important;
}

.no-results-small {
  padding: 20px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}

/* Clear Section */
.clear-section {
  padding: 12px 16px;
  background: #2196f317;
  border-top: 1px solid #fee2e2;
}

.clear-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 14px;
  border: 2px solid #1867c05e;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: white;
  color: #1867c0;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.clear-btn:hover {
  background: #b1aaff;
  border-color: rgb(69, 44, 116);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(53, 38, 220, 0.15);
}

.clear-btn:active {
  transform: translateY(0);
}

.toggle-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

/* Calendar */
.calendar-section {
  padding: 16px;
  background: white;
}

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 0 2px;
}

.month-label {
  font-size: 15px;
  font-weight: 700;
  color: #111827;
  text-transform: capitalize;
  letter-spacing: -0.02em;
}

.nav-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  transition: all 0.2s ease;
}

.nav-btn:hover {
  background: #e5e7eb;
  color: #374151;
  transform: scale(1.05);
}

.nav-btn:active {
  transform: scale(0.98);
}

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 6px;
  padding: 0 2px;
}

.weekday {
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  color: #9ca3af;
  padding: 6px 2px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.weekday.weekend {
  color: #d1d5db;
}

.days-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  padding: 0 2px;
}

.day-btn {
  aspect-ratio: 1;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: #111827;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.day-btn:hover:not(.selected):not(.other-month) {
  background: #f3f4f6;
  transform: scale(1.08);
}

.day-btn.other-month {
  color: #d1d5db;
  cursor: default;
}

.day-btn.weekend:not(.other-month) {
  color: #6b7280;
}

.day-btn.today {
  color: #2563eb;
  font-weight: 700;
}

.day-btn.today::after {
  content: '';
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #2563eb;
}

.day-btn.selected {
  /* Use a Violet/Purple gradient to distinguish from the Blue "Today" color */
  background: linear-gradient(135deg, #3b82f6 0%, #1751af 100%);
  color: white !important;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  transform: scale(1.05);
}

.day-btn.selected::after {
  display: none;
}

/* Week range highlighting */
.day-btn.in-week {
  background: #dbeafe;
  color: #1e40af;
  font-weight: 600;
  border-radius: 4px;
}

.day-btn.in-week:hover {
  background: #bfdbfe;
}

.day-btn.in-week.today {
  background: #93c5fd;
}

.day-btn.in-week.selected {
  background: linear-gradient(135deg, #3b82f6 0%, #1751af 100%);
  color: white !important;
}

/* Month range highlighting (for thisMonth preset) */
.day-btn.in-month {
  background: #dbeafe;
  color: #1e40af;
  font-weight: 600;
  border-radius: 6px;
}

.day-btn.in-month:hover {
  background: #bfdbfe;
}

.day-btn.in-month.today {
  background: #93c5fd;
}

.day-btn.in-month.selected {
  background: linear-gradient(135deg, #3b82f6 0%, #1751af 100%);
  color: white !important;
}

/* Custom range highlighting (any date range) */
.day-btn.in-range {
  background: #dbeafe;
  color: #1e40af;
  font-weight: 600;
  border-radius: 4px;
}

.day-btn.in-range:hover {
  background: #bfdbfe;
}

.day-btn.in-range.today {
  background: #93c5fd;
}

.day-btn.in-range.selected {
  background: linear-gradient(135deg, #3b82f6 0%, #3b82f6 100%);
  color: white !important;
}

/* Weekends toggle in panel */
.weekends-toggle-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px 16px;
  background: white;
  cursor: pointer;
  font-size: 13px;
  color: #475569;
}

.weekends-toggle-panel input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #3b82f6;
  cursor: pointer;
}

.weekends-toggle-panel span {
  user-select: none;
}

/* Quick Actions */
.quick-actions {
  display: flex;
  gap: 6px;
  padding: 0 16px 16px;
  background: white;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 8px;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: white;
  color: #6b7280;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.action-btn:hover:not(.active) {
  border-color: #d1d5db;
  background: #f9fafb;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.06);
}

.action-btn.active {
  background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
  border-color: #2563eb;
  color: white;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
  transform: translateY(-1px);
}
/* Filter Switch Section */
.filter-type-section {
  padding: 8px 16px;
  background: white;
}

.filter-section-title {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.field-toggle-light {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 4px;
  background: #f3f4f6;
  border-radius: 8px;
}

.toggle-btn-light {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 4px;
  border: none;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background: transparent;
  color: #6b7280;
  letter-spacing: 0.2px;
}

.toggle-btn-light:hover:not(.active) {
    background: rgba(255,255,255,0.5);
    color: #374151;
}

.toggle-btn-light.active {
  background: white;
  color: #1e40af;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

/* Filter hint banner */
.filter-hint-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  margin-bottom: 12px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
  animation: fadeInSlide 0.3s ease-out;
}

@keyframes fadeInSlide {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hint-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 8px;
}

.hint-content {
  flex: 1;
}

.hint-title {
  font-size: 12px;
  font-weight: 700;
  color: white;
  margin-bottom: 2px;
  letter-spacing: 0.2px;
}

.hint-text {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.4;
}

/* Range mode hint - purple gradient to differentiate from info hint */
.filter-hint-banner.range-mode-hint {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.25);
}

/* Disabled state for toggle buttons */
.toggle-btn-light.disabled,
.toggle-btn-light:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: transparent !important;
  color: #9ca3af !important;
  transform: none !important;
  box-shadow: none !important;
}

.clear-filter-btn {
  font-size: 11px;
  font-weight: 600;
  color: #3b82f6; 
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.2s;
}

.clear-filter-btn:hover {
  background: rgba(239, 68, 68, 0.1);
}

.day-btn.pending-start {
  background: var(--v-theme-primary);
  color: white;
  opacity: 0.6; /* Distinct from fully selected */
  border: 2px dashed rgba(255,255,255,0.5);
}

.toggle-btn-light.disabled:hover,
.toggle-btn-light:disabled:hover {
  background: transparent !important;
  color: #9ca3af !important;
  transform: none !important;
}

/* Modern Toggle Switches */
.toggles-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px;
  background: white;
}

</style>
