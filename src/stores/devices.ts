import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post, patch, del } from '@/services/api/api-requests'

export interface Device {
  id: number
  code: string
  name: string
  color?: string | null
  active: boolean
}

export interface DeviceRequest {
  code: string
  name: string
  color?: string | null
  active?: boolean
}

type ApiList<T> = { items: T[] }
type ApiObj<T> = { content: T }

function isApiList<T>(obj: unknown): obj is ApiList<T> {
  return typeof obj === 'object' && obj !== null &&
    Array.isArray((obj as { items?: unknown }).items)
}
function isApiObj<T>(obj: unknown): obj is ApiObj<T> {
  return typeof obj === 'object' && obj !== null &&
    Object.prototype.hasOwnProperty.call(obj as Record<string, unknown>, 'content')
}

function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
}

export const useDeviceStore = defineStore('devices', () => {
  // aktuálně používaný aktivní seznam (pro výběry v měření apod.)
  const devices = ref<Device[]>([])
  // úplný seznam (aktivní i neaktivní): pro stránku přístroje
  const allDevices = ref<Device[]>([])

  const loading = ref(false)
  const errorText = ref<string | null>(null)
  const lastLoadedAt = ref<number | null>(null)

  function sortByNameCs(a: Device, b: Device): number {
    return a.name.localeCompare(b.name, 'cs')
  }
  function setDevicesActive(list: Device[]): void {
    devices.value = list.filter(d => d.active).slice().sort(sortByNameCs)
  }
  function setAllDevices(list: Device[]): void {
    allDevices.value = list.slice().sort(sortByNameCs)
  }
  function upsertInto(list: Device[], d: Device): Device[] {
    const idx = list.findIndex(x => x.id === d.id)
    if (idx >= 0) {
      const next = list.slice()
      next[idx] = d
      return next.sort(sortByNameCs)
    }
    return [...list, d].sort(sortByNameCs)
  }

  async function fetchDevices(): Promise<Device[]> {
    // načti jen aktivní ze /devices
    loading.value = true
    errorText.value = null
    try {
      const resp = await get('devices', undefined)
      const data = resp?.data
      const items = isApiList<Device>(data) ? data.items : []
      setDevicesActive(items) // devices : aktivní
      // pokud alldevices zatím není naplněný, synchronizuj aspoň aktivní
      if (!allDevices.value.length) setAllDevices(items)
      lastLoadedAt.value = Date.now()
      return devices.value
    } catch (e: unknown) {
      errorText.value = (e as { message?: string })?.message || 'Načtení zařízení selhalo'
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchAll(): Promise<Device[]> {
    // načti všechny ze /devices/all
    loading.value = true
    errorText.value = null
    try {
      const resp = await get('devices/all', undefined)
      const data = resp?.data
      const items = isApiList<Device>(data) ? data.items : []
      setAllDevices(items)
      setDevicesActive(items) // devices : aktivní subset
      lastLoadedAt.value = Date.now()
      return allDevices.value
    } catch (e: unknown) {
      errorText.value = (e as { message?: string })?.message || 'Načtení zařízení (všech) selhalo'
      return []
    } finally {
      loading.value = false
    }
  }

  async function refreshDevices(force = false): Promise<Device[]> {
    const now = Date.now()
    if (!force && lastLoadedAt.value && (now - lastLoadedAt.value) < 10_000) {
      return devices.value
    }
    return fetchDevices()
  }

  async function createDevice(req: DeviceRequest): Promise<Device | null> {
    errorText.value = null
    try {
      const payload: DeviceRequest = {
        code: normalizeCode(req.code),
        name: req.name.trim(),
        color: (req.color ?? '').trim() || undefined,
        active: req.active !== false
      }
      const resp = await post('devices', payload, undefined)
      const data = resp?.data

      let dev: Device | null = null
      if (isApiObj<Device>(data) && data.content) dev = data.content
      else if (typeof data === 'object' && data !== null && 'id' in (data as Record<string, unknown>)) {
        dev = data as Device
      }

      if (!dev) throw new Error('Neplatná odpověď při vytváření zařízení')

      // upsert do alldevices vždy
      setAllDevices(upsertInto(allDevices.value, dev))
      // do devices pouze aktivní
      if (dev.active) setDevicesActive(upsertInto(allDevices.value, dev))
      return dev
    } catch (e: unknown) {
      errorText.value = (e as { message?: string })?.message || 'Vytvoření zařízení selhalo'
      return null
    }
  }

  async function updateDevice(id: number, patchPayload: Partial<DeviceRequest>): Promise<Device | null> {
    errorText.value = null
    try {
      const resp = await patch(`devices/${id}`, patchPayload, undefined)
      const data = resp?.data
      let dev: Device | null = null
      if (isApiObj<Device>(data) && data.content) dev = data.content
      else if (typeof data === 'object' && data !== null && 'id' in (data as Record<string, unknown>)) {
        dev = data as Device
      }
      if (!dev) throw new Error('Neplatná odpověď při update zařízení')

      setAllDevices(upsertInto(allDevices.value, dev))
      // rebuild aktivních ze všech
      setDevicesActive(allDevices.value)
      return dev
    } catch (e: unknown) {
      errorText.value = (e as { message?: string })?.message || 'Update zařízení selhal'
      return null
    }
  }

  async function deactivateDevice(id: number): Promise<void> {
    errorText.value = null
    try {
      await del(`devices/${id}`, undefined)
      // uprav lokální stav: v alldevices nastav active=false, v devices odstraň
      const idxAll = allDevices.value.findIndex(d => d.id === id)
      if (idxAll >= 0) {
        const dev = { ...allDevices.value[idxAll]!, active: false }
        setAllDevices(upsertInto(allDevices.value, dev))
      }
      setDevicesActive(allDevices.value)
    } catch (e: unknown) {
      errorText.value = (e as { message?: string })?.message || 'Deaktivace zařízení selhala'
    }
  }

  async function reactivateDevice(id: number): Promise<Device | null> {
    errorText.value = null
    try {
      const resp = await post(`devices/${id}/reactivate`, {}, undefined)
      const data = resp?.data
      let dev: Device | null = null
      if (isApiObj<Device>(data) && data.content) dev = data.content
      else if (typeof data === 'object' && data !== null && 'id' in (data as Record<string, unknown>)) {
        dev = data as Device
      }
      if (!dev) throw new Error('Neplatná odpověď při reaktivaci zařízení')

      setAllDevices(upsertInto(allDevices.value, dev))
      setDevicesActive(allDevices.value)
      return dev
    } catch (e: unknown) {
      errorText.value = (e as { message?: string })?.message || 'Reaktivace zařízení selhala'
      return null
    }
  }

  return {
    devices,        // aktivní
    allDevices,     // všichni
    loading,
    errorText,
    fetchDevices,   // aktivní
    fetchAll,       // všichni
    refreshDevices, // aktivní (light)
    createDevice,
    updateDevice,
    deactivateDevice,
    reactivateDevice
  }
})
