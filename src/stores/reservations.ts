import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post, del, patch } from '@/services/api/api-requests'

export type ReservationItem = {
  id: number
  title: string
  deviceCode: string
  startTime: number
  endTime: number
  username: string | null
  projectId: number
  note: string | null
  seriesId?: string | null
}

export type RecurrenceRequest = {
  recurrenceType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  daysOfWeek?: number[]
  count?: number
  until?: number
}

export type DeviceItem = { id: number; code: string; name: string; color?: string }

type CreateReservationPayload = {
  title: string
  deviceCode: string
  startTime: number
  endTime: number
  projectId: number
  username: string

  note?: string | null
  recurrence?: RecurrenceRequest | null
  force?: boolean
}

type UpdateReservationPayload = {
  title?: string
  deviceCode?: string
  startTime?: number
  endTime?: number
  username?: string | null
  note?: string | null
  recurrence?: RecurrenceRequest | null
  force?: boolean
}

export const useReservationsStore = defineStore('reservations', () => {
  const devices = ref<DeviceItem[]>([])
  const items = ref<ReservationItem[]>([])

  async function fetchDevices() {
    const resp = await get<{ items: DeviceItem[] }>('reservations/devices')
    devices.value = resp.data.items
  }

  async function fetchByProject(projectId: number, from: number, to: number, deviceCodes: string[] = []) {
    const codes = deviceCodes.length ? `&deviceCodes=${encodeURIComponent(deviceCodes.join(','))}` : ''
    const resp = await get<{ items: ReservationItem[] }>(
      `reservations/by-project/${projectId}?from=${from}&to=${to}${codes}`
    )
    items.value = resp.data.items
    return items.value
  }

  async function createReservation(payload: CreateReservationPayload) {
    // payload.note už pošleme jako string | null (ne undefined)
    const resp = await post<{ content: ReservationItem }>('reservations', {
      ...payload,
      note: payload.note ?? null
    })
    items.value.push({
      ...resp.data.content,
      note: resp.data.content.note ?? null
    })
    return resp.data.content
  }

  async function updateReservation(id: number, payload: UpdateReservationPayload) {
    const resp = await patch<{ content: ReservationItem }>(`reservations/${id}`, {
      ...payload,
      note: payload.note === undefined ? undefined : (payload.note ?? null)
    })
    const idx = items.value.findIndex(i => i.id === id)
    const normalized = { ...resp.data.content, note: resp.data.content.note ?? null }
    if (idx !== -1) {
      items.value[idx] = { ...items.value[idx], ...normalized }
    } else {
      items.value.push(normalized)
    }
    return resp.data.content
  }

  async function updateReservationNote(id: number, note?: string | null) {
    const resp = await patch<{ content: ReservationItem }>(`reservations/${id}/note`, { note: note ?? null })
    const idx = items.value.findIndex(i => i.id === id)
    if (idx !== -1) {
      items.value[idx] = {
        ...items.value[idx],
        ...resp.data.content,
        note: resp.data.content.note ?? null
      }
    }
    return resp.data.content
  }

  async function deleteReservation(id: number) {
    await del(`reservations/${id}`)
    items.value = items.value.filter(i => i.id !== id)
  }

  async function fetchSeriesRecurrence(seriesId: string) {
    const resp = await get<{ content: RecurrenceRequest }>(`reservations/series/${seriesId}/recurrence`)
    return resp.data.content
  }

  async function updateSeries(id: number, payload: UpdateReservationPayload, scope: 'series' | 'following') {
    // This endpoint handles both 'series' and 'following' scopes based on query param or body
    // Assuming backend API: PATCH /reservations/{id}/series?scope=...
    const resp = await patch<{ items: ReservationItem[] }>(`reservations/${id}/series?scope=${scope}`, payload)
    // We should probably invalidate/reload data in the view because multiple items changed
    return resp.data.items
  }

  async function deleteSeriesReservations(seriesId: string) {
    await del(`reservations/series/${seriesId}`)
    items.value = items.value.filter(i => i.seriesId !== seriesId)
  }

  async function deleteSeriesFromDate(seriesId: string, fromDate: number) {
    await del(`reservations/series/${seriesId}/from/${fromDate}`)
    // Optimistic update difficult for 'from date', easier to reload
  }

  return {
    devices,
    items,
    fetchDevices,
    fetchByProject,
    createReservation,
    updateReservation,
    updateReservationNote,
    deleteReservation,
    fetchSeriesRecurrence,
    updateSeries,
    deleteSeriesReservations,
    deleteSeriesFromDate,
  }
})
