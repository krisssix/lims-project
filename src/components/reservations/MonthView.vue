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
  days: Date[]
  currentMonthDate: Date
  
  itemsForDay: (d: Date) => ResItem[]
  
  // Helpers
  fmtTime: (d: Date) => string
  deviceColorOf: (id: string) => string
  
  // Interactions
  onTrackClick: (evt: MouseEvent, ctx: { type: 'day', day: Date }) => void
  onEventClick: (id: number, e: MouseEvent) => void
}>()

const WEEKDAYS = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle']

function isSameMonth(d: Date) {
  return d.getMonth() === props.currentMonthDate.getMonth() && 
         d.getFullYear() === props.currentMonthDate.getFullYear()
}

function isToday(d: Date) {
  const now = new Date()
  return d.getDate() === now.getDate() && 
         d.getMonth() === now.getMonth() && 
         d.getFullYear() === now.getFullYear()
}



</script>

<template>
  <div class="month-view">
    <!-- Header -->
    <div class="month-header">
      <div
        v-for="dayName in WEEKDAYS"
        :key="dayName"
        class="month-header-cell"
      >
        {{ dayName }}
      </div>
    </div>
    
    <!-- Grid -->
    <div class="month-grid">
      <div 
        v-for="day in days" 
        :key="day.toISOString()" 
        class="month-day"
        :class="{
          'outside-month': !isSameMonth(day),
          'is-today': isToday(day),
          'is-weekend': day.getDay() === 0 || day.getDay() === 6
        }"
        @click="(e) => onTrackClick(e, { type: 'day', day })"
      >
        <div class="day-label">
          {{ day.getDate() }}
        </div>
        
        <div class="day-events">
          <div 
            v-for="ev in itemsForDay(day)" 
            :key="ev.id" 
            class="month-event"
            :style="{
              borderLeft: `3px solid ${deviceColorOf(ev.deviceId)}`,
              background: `var(--v-theme-${deviceColorOf(ev.deviceId)}-lighten-5, #f0f0f0)`
            }"
            @click.stop="(e) => onEventClick(ev.id, e)"
          >
            <div class="event-time">
              {{ fmtTime(new Date(ev.start)) }}
            </div>
            <div class="event-title">
              {{ ev.title }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.month-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid #e0e0e0;
}

.month-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid #e0e0e0;
  background: #f9fafb;
}

.month-header-cell {
  padding: 12px;
  text-align: center;
  font-weight: 600;
  color: #6b7280;
  font-size: 13px;
  text-transform: uppercase;
  border-right: 1px solid #f3f4f6;
}
.month-header-cell:last-child {
  border-right: none;
}

.month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(auto-fill, minmax(120px, 1fr)); /* flexible rows */
  flex: 1;
  overflow-y: auto;
}

.month-day {
  border-right: 1px solid #f3f4f6;
  border-bottom: 1px solid #f3f4f6;
  min-height: 120px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: background 0.15s;
}

.month-day:hover {
  background: #fafafa;
}

.month-day.outside-month {
  background: #fcfcfc;
  color: #9ca3af;
}

.month-day.is-weekend {
  background: #fafbff;
}

.month-day.is-today {
  background: #eff6ff;
}

.month-day.is-today .day-label {
  background: #1976d2;
  color: white;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.day-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
  padding: 2px 6px;
  align-self: flex-end;
}

.day-events {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.month-event {
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  background: #eee;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer; /* fallback if drag not supported */
  display: flex;
  align-items: center;
  gap: 4px;
}

.event-time {
  font-size: 10px;
  font-weight: 500;
  opacity: 0.8;
}

.event-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
