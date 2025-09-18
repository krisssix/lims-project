// src/stores/measurement.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post, del } from '@/services/api/api-requests'

export type ValueType = 'float'|'int'|'text'|'file'|'bool'|'date'

export type FieldRow = {
  id: string
  type: 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
  required: boolean
  name: string
}

export type TemplateItem = {
  id: string
  name: string
  deviceId: string        // např. 'M1' – kód přístroje
  deviceColor: string     // barva čipu v UI (např. 'primary', 'deep-purple')
  fields: FieldRow[]      // definice vstupních polí formuláře měření
}

export type DeviceItem = {
  id: string              // kód přístroje (např. 'M1')
  name: string            // zobrazovaný název (obvykle stejné jako kód)
  color: string           // barva pro UI (např. 'primary')
}

export interface MeasuredValue {
  orderIndex: number
  name: string
  type: ValueType
  numberValue?: number | null
  textValue?: string | null
  boolValue?: boolean | null
  dateValue?: number | null
  fileUrl?: string | null
}

export interface MeasurementRequest {
  value: number
  type: string
  unit: string
  timestamp: number
  boardCardId?: number | null
  values?: MeasuredValue[]
}

export interface MeasurementResponse {
  id: number
  value: number
  type: string
  unit: string
  timestamp: string | number
  boardCardId: number | null
  values: MeasuredValue[]
}

export const useMeasurementStore = defineStore('measurement', () => {
  const allMeasurements = ref<MeasurementResponse[]>([])
  const selectedMeasurement = ref<MeasurementResponse | null>(null)

  async function fetchAllMeasurements(projectId: number): Promise<MeasurementResponse[]> {
    try {
      const resp = await get<{ items: MeasurementResponse[] }>(`measurements/project/${projectId}`)
      allMeasurements.value = resp.data.items || []
      return allMeasurements.value
    } catch (err) {
      console.error('Chyba při načítání měření:', err)
      return []
    }
  }

  async function fetchMeasurement(projectId: number, measurementId: number): Promise<MeasurementResponse | null> {
    try {
      const resp = await get<{ content: MeasurementResponse }>(`measurements/project/${projectId}/${measurementId}`)
      selectedMeasurement.value = resp.data.content
      return selectedMeasurement.value
    } catch (err) {
      console.error('Chyba při načítání jednoho měření:', err)
      return null
    }
  }

  async function saveMeasurement(projectId: number, measurement: MeasurementRequest): Promise<MeasurementResponse> {
    try {
      const resp = await post<{ content: MeasurementResponse }>(`measurements/project/${projectId}`, measurement)
      return resp.data.content
    } catch (err) {
      console.error('Chyba při ukládání měření:', err)
      throw err
    }
  }

  async function deleteMeasurement(id: number): Promise<void> {
    try {
      await del(`measurements/${id}`)
      allMeasurements.value = allMeasurements.value.filter(m => m.id !== id)
      if (selectedMeasurement.value?.id === id) selectedMeasurement.value = null
    } catch (err) {
      console.error('Chyba při mazání měření:', err)
      throw err
    }
  }

  return {
    allMeasurements,
    selectedMeasurement,
    fetchAllMeasurements,
    fetchMeasurement,
    saveMeasurement,
    deleteMeasurement,
  }
})
