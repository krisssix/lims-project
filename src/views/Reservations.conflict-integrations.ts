import { ref } from 'vue'
import ConflictDialog from '@/components/reservations/ConflictDialog.vue'
import { buildDayGaps, proposeSlotsAround, firstGapNextDays, type ResItem } from '@/utils/calendar/calendarSlotHelpers'

// Stav pro konflikt dialog
export const conflictOpen = ref(false)
export const conflictDeviceName = ref<string>('Zařízení')
export const conflictRequested = ref<{ start: Date; end: Date }>({ start: new Date(), end: new Date() })
export const conflictProposals = ref<Array<{ slot: { start: Date; end: Date }; label: string }>>([])
export const conflictFallbackNext = ref<{ day: Date; slot: { start: Date; end: Date } } | null>(null)

// Pomocné funkce pro rodiče
export function makeConflictFor(
  deviceId: string,
  deviceName: string,
  requested: { start: Date; end: Date },
  getEventsForDayDevice: (day: Date, deviceId: string) => ResItem[]
): void {
  conflictDeviceName.value = deviceName
  conflictRequested.value = requested

  const dayBase = new Date(requested.start.getFullYear(), requested.start.getMonth(), requested.start.getDate(), 0, 0, 0, 0)
  const events = getEventsForDayDevice(dayBase, deviceId)
  const gaps = buildDayGaps(events, dayBase)
  const props = proposeSlotsAround(requested, gaps)
  conflictProposals.value = props.map((s, idx) => ({
    slot: s,
    label: idx === 0 ? 'Nejbližší po' : 'Nejbližší před'
  }))

  const next = firstGapNextDays(getEventsForDayDevice, dayBase, deviceId, requested.end.getTime() - requested.start.getTime(), 30)
  conflictFallbackNext.value = next

  conflictOpen.value = true
}
