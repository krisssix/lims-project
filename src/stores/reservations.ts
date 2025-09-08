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
}

type UpdateReservationPayload = {
  title?: string
  deviceCode?: string
  startTime?: number
  endTime?: number
  username?: string | null
  note?: string | null
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

  return {
    devices,
    items,
    fetchDevices,
    fetchByProject,
    createReservation,
    updateReservation,
    updateReservationNote,
    deleteReservation
  }
})
