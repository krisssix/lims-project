<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import FilterMultiSelect from '@/components/ui/FilterMultiSelect.vue'

// Types
export type DateFilterField = 'date' | 'createdAt' | 'updatedAt'
export type DateRangePreset = 'today' | 'thisWeek' | 'nextWeek' | 'thisMonth' | 'custom' | null

function toggleMember(m: string) {
  const current = props.pickedMembers || []
  const newVal = current.includes(m)
    ? current.filter(x => x !== m)
    : [...current, m]
  emit('update:pickedMembers', newVal)
}
function toggleDevice(id: string) {
  const current = props.pickedDevices || []
  const newVal = current.includes(id)
    ? current.filter(x => x !== id)
    : [...current, id]
  emit('update:pickedDevices', newVal)
}

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
  showDateLabel?: boolean
  headerLabel?: string
  headerIcon?: string
  showRangePresets?: boolean
  viewMode?: 'daily-machines' | 'week-work' | 'week-all' | 'daily-list'
  devices?: Array<{ id: string; name: string; color?: string }>
  members?: string[]
  templates?: Array<{ id: string; name: string }>
  pickedDevices?: string[]
  pickedMembers?: string[]
  pickedTemplates?: string[]
  includeWeekends?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: DateFilter]
  'update:pickedDevices': [value: string[]]
  'update:pickedMembers': [value: string[]]
  'update:pickedTemplates': [value: string[]]
  'update:includeWeekends': [value: boolean]
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
const memberSearch = ref('')
const showMemberDropdown = ref(false)
const showDeviceDropdown = ref(false)

watch(() => props.modelValue.field, (val) => {
  localField.value = val
})

// Auto-select today if current date matches
watch(() => props.modelValue.from, (newFrom) => {
  if (newFrom) {
    const today = new Date()
    const isToday = newFrom.toDateString() === today.toDateString()

    if (isToday && props.modelValue.preset !== 'today') {
      // Only update preset, keep the dates
      emit('update:modelValue', {
        ...props.modelValue,
        preset: 'today'
      })
    } else if (!isToday && props.modelValue.preset === 'today') {
      // If date changed away from today, change preset to custom
      emit('update:modelValue', {
        ...props.modelValue,
        preset: 'custom'
      })
    }
  }
}, { immediate: true })

watch(() => props.includeWeekends, () => {
  if (props.modelValue.preset === 'thisWeek') selectThisWeek()
  if (props.modelValue.preset === 'nextWeek') selectNextWeek()
})

// Dynamic header label based on current selection
const dynamicHeaderLabel = computed(() => {
  if (!props.modelValue.from) {
    return 'Všechna měření'
  }

  // Format the date nicely for any selection (including today)
  const from = props.modelValue.from
  const to = props.modelValue.to
  const d1 = from.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // For week presets, show range
  if (props.modelValue.preset === 'thisWeek' || props.modelValue.preset === 'thisMonth') {
    if (to && from.toDateString() !== to.toDateString()) {
      const d2 = to.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
      return `${d1} – ${d2}`
    }
  }

  // For single day (today or custom) - just show the formatted date
  return d1
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
  if (!deviceSearch.value.trim()) return props.devices

  const search = deviceSearch.value.toLowerCase()
  return props.devices.filter(d =>
    d.name.toLowerCase().includes(search)
  )
})

const filteredMembers = computed(() => {
  if (!props.members) return []
  if (!memberSearch.value.trim()) return props.members

  const search = memberSearch.value.toLowerCase()
  return props.members.filter(m =>
    m.toLowerCase().includes(search)
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
  const isWeekView = props.viewMode === 'week-work' || props.viewMode === 'week-all'
  const isWeekPreset = props.modelValue.preset === 'thisWeek' || props.modelValue.preset === 'nextWeek'

  if (selectedDate && (isWeekView || isWeekPreset)) {
    // Get Monday of selected week
    const dayOfWeek = selectedDate.getDay()
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    weekStart = new Date(selectedDate)
    weekStart.setDate(selectedDate.getDate() + diffToMonday)
    weekStart.setHours(0, 0, 0, 0)

    // Get end of week - respects includeWeekends
    weekEnd = new Date(weekStart)
    if (props.includeWeekends || props.viewMode === 'week-all') {
      weekEnd.setDate(weekStart.getDate() + 6) // Sunday (full week)
    } else {
      weekEnd.setDate(weekStart.getDate() + 4) // Friday (work week)
    }
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

  const days: Array<{ day: number; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean; isWeekend: boolean; isInWeek: boolean; isInMonth: boolean; date: Date }> = []

  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i
    const date = new Date(year, month - 1, d)
    const isInWeek = weekStart && weekEnd ? date >= weekStart && date <= weekEnd : false
    const isInMonth = monthStart && monthEnd ? date >= monthStart && date <= monthEnd : false
    days.push({
      day: d,
      isCurrentMonth: false,
      isToday: false,
      isSelected: false,
      isWeekend: false,
      isInWeek,
      isInMonth,
      date
    })
  }

  const today = new Date()
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    const dayOfWeek = date.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const isToday = date.toDateString() === today.toDateString()
    const isSelected = props.modelValue.from && date.toDateString() === props.modelValue.from.toDateString()
    const isInWeek = weekStart && weekEnd ? date >= weekStart && date <= weekEnd : false
    const isInMonth = monthStart && monthEnd ? date >= monthStart && date <= monthEnd : false

    days.push({
      day: d,
      isCurrentMonth: true,
      isToday,
      isSelected: !!isSelected,
      isWeekend,
      isInWeek,
      isInMonth,
      date
    })
  }

  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const date = new Date(year, month + 1, d)
    const isInWeek = weekStart && weekEnd ? date >= weekStart && date <= weekEnd : false
    const isInMonth = monthStart && monthEnd ? date >= monthStart && date <= monthEnd : false
    days.push({
      day: d,
      isCurrentMonth: false,
      isToday: false,
      isSelected: false,
      isWeekend: false,
      isInWeek,
      isInMonth,
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
  viewDate.value = new Date(viewDate.value.getFullYear(), viewDate.value.getMonth() - 1, 1)
}

function nextMonth() {
  viewDate.value = new Date(viewDate.value.getFullYear(), viewDate.value.getMonth() + 1, 1)
}

function selectToday() {
  const today = new Date()
  emit('update:modelValue', {
    field: localField.value,
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
  // If includeWeekends is true (or undefined/null -> careful, check prop default logic if needed, but here boolean)
  // OR if viewMode is 'week-all', add 6 days. Else add 4 days.
  const addDays = (props.includeWeekends || props.viewMode === 'week-all') ? 6 : 4
  end.setDate(start.getDate() + addDays)

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
  const addDays = (props.includeWeekends || props.viewMode === 'week-all') ? 6 : 4
  end.setDate(start.getDate() + addDays)

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
  emit('update:modelValue', {
    field: localField.value,
    preset: 'thisMonth',
    from: startOfMonth(today),
    to: endOfMonth(today)
  })
  emit('close')
}

function selectDay(date: Date) {
  emit('update:modelValue', {
    field: localField.value,
    preset: 'custom',
    from: startOfDay(date),
    to: endOfDay(date)
  })
  emit('close')
}

function clearFilter() {
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
      <div class="header-label">
        <v-icon
          size="20"
          class="header-icon"
        >
          mdi-flask
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
              'in-week': day.isInWeek && day.isCurrentMonth,
              'in-month': day.isInMonth && day.isCurrentMonth
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
        @click="selectToday"
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
    <div v-if="!hideFieldToggle" class="filter-type-section">
      <div class="filter-section-title">
        <v-icon size="14" class="mr-1">mdi-filter-variant</v-icon>
        <span>Filtrovat podle</span>
      </div>
      <div class="field-toggle-light">
        <v-tooltip text="Filtrování podle data měření." location="top">
          <template #activator="{props:tooltipProps}">
            <button
              v-bind="tooltipProps"
              type="button"
              :class="['toggle-btn-light',{active:localField==='date'}]"
              @click="setField('date')"
            >
              <v-icon size="16">mdi-flask</v-icon>
              <span>Data měření</span>
            </button>
          </template>
        </v-tooltip>
        <v-tooltip text="Filtrování podle data vložení." location="top">
          <template #activator="{props:tooltipProps}">
            <button
              v-bind="tooltipProps"
              type="button"
              :class="['toggle-btn-light',{active:localField==='createdAt'}]"
              @click="setField('createdAt')"
            >
              <v-icon size="16">mdi-plus</v-icon>
              <span>Data vložení</span>
            </button>
          </template>
        </v-tooltip>
        <v-tooltip text="Filtrování podle data změny." location="top">
          <template #activator="{props:tooltipProps}">
            <button
              v-bind="tooltipProps"
              type="button"
              :class="['toggle-btn-light',{active:localField==='updatedAt'}]"
              @click="setField('updatedAt')"
            >
              <v-icon size="16">mdi-pencil</v-icon>
              <span>Data změny</span>
            </button>
          </template>
        </v-tooltip>
      </div>
    </div>

    <div>
      <!-- Weekends Toggle (for week views) -->
      <label
        v-if="showWeekendToggle"
        class="weekends-toggle-panel"
      >
        <input
          type="checkbox"
          :checked="includeWeekends"
          @change="emit('update:includeWeekends', ($event.target as HTMLInputElement).checked)"
        >
        <span>Včetně víkendů</span>
      </label>
    </div>
    <!-- MANUAL RANGE -->
    <div
      v-if="!hidePresets"
      class="manual-range-section"
    >
      <div class="range-label">
        Časové rozmezí
      </div>
      <div class="range-inputs">
        <div class="range-field">
          <label>Od</label>
          <input
            v-model="dateFromInput"
            type="date"
            class="date-input"
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
        <v-icon size="16">mdi-filter-variant</v-icon>
        <span>Filtry</span>
      </div>

      <!-- Device filter -->
      <div v-if="devices?.length" class="filter-row">
        <FilterMultiSelect
          :model-value="pickedDevices || []"
          :items="devices"
          label="Přístroje"
          item-title="name"
          item-value="id"
          icon="mdi-flask-outline"
          all-label="Všechny"
          @update:model-value="v => emit('update:pickedDevices', v)"
        />
      </div>

      <!-- Templates filter (for measurements) -->
      <div v-if="templates?.length" class="filter-row">
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
      <div v-if="members?.length" class="filter-row">
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
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.3px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
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
  background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
  color: white !important;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
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
  background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
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
  background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
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
</style>
