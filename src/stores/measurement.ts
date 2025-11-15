// src/stores/measurement.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post, del, patch } from '@/services/api/api-requests'

export type ValueType = 'float'|'int'|'text'|'file'|'bool'|'date'

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
  templateId?: number | null
  groupId?: string | null
  note?: string | null
  measuredByUsername?: string | null
  values?: MeasuredValue[]
}

export interface MeasurementResponse {
  id: number
  value: number
  type: string
  unit: string
  timestamp: number | string
  boardCardId: number | null
  templateId?: number | null
  groupId?: string | null
  note?: string | null
  measuredByUsername?: string | null
  values: MeasuredValue[]
}

type ApiList<T> = { items: T[] }
type ApiObject<T> = { content: T }

type MeasurementPatch = Partial<
  Pick<MeasurementRequest,
    'value'|'type'|'unit'|'timestamp'|'values'|'templateId'|'groupId'|'note'
  >
>

export const useMeasurementStore = defineStore('measurement', () => {
  const allMeasurements = ref<MeasurementResponse[]>([])
  const selectedMeasurement = ref<MeasurementResponse | null>(null)

  function normalizeResp(m: MeasurementResponse): MeasurementResponse {
    return {
      ...m,
      note: m.note ?? null,
      groupId: m.groupId ?? null,
      templateId: m.templateId ?? null,
      measuredByUsername: m.measuredByUsername ?? null
    }
  }

  async function fetchAllMeasurements(projectId: number): Promise<MeasurementResponse[]> {
    const resp = await get(`measurements/project/${projectId}`, undefined)
    const data = (resp?.data ?? {}) as ApiList<MeasurementResponse>
    allMeasurements.value = (Array.isArray(data.items) ? data.items : []).map(normalizeResp)
    return allMeasurements.value
  }

  async function fetchMeasurement(projectId: number, measurementId: number): Promise<MeasurementResponse | null> {
    const resp = await get(`measurements/project/${projectId}/${measurementId}`, undefined)
    const data = (resp?.data ?? {}) as ApiObject<MeasurementResponse>
    selectedMeasurement.value = data.content ? normalizeResp(data.content) : null
    return selectedMeasurement.value
  }

  async function saveMeasurement(projectId: number, measurement: MeasurementRequest): Promise<MeasurementResponse> {
    const payload: MeasurementRequest = {
      ...measurement,
      templateId: measurement.templateId ?? null,
      groupId: measurement.groupId ?? null,
      note: measurement.note ?? null,
      measuredByUsername: measurement.measuredByUsername ?? null
    }
    const resp = await post(`measurements/project/${projectId}`, payload, undefined)
    const data = (resp?.data ?? {}) as ApiObject<MeasurementResponse>
    const saved = data.content ? normalizeResp(data.content) : (null as unknown as MeasurementResponse)
    return saved
  }

  async function updateMeasurement(id: number, patchPayload: MeasurementPatch): Promise<MeasurementResponse> {
    const resp = await patch(`measurements/${id}`, {
      ...patchPayload,
      templateId: patchPayload.templateId === undefined ? undefined : (patchPayload.templateId ?? null),
      groupId: patchPayload.groupId === undefined ? undefined : (patchPayload.groupId ?? null),
      note: patchPayload.note === undefined ? undefined : (patchPayload.note ?? null)
    }, undefined)
    const data = (resp?.data ?? {}) as ApiObject<MeasurementResponse>
    const updated = data.content ? normalizeResp(data.content) : (null as unknown as MeasurementResponse)
    const idx = allMeasurements.value.findIndex(m => m.id === id)
    if (idx !== -1) allMeasurements.value[idx] = updated
    if (selectedMeasurement.value?.id === id) selectedMeasurement.value = updated
    return updated
  }

  async function deleteMeasurement(id: number): Promise<void> {
    await del(`measurements/${id}`, undefined)
    allMeasurements.value = allMeasurements.value.filter(m => m.id !== id)
    if (selectedMeasurement.value?.id === id) selectedMeasurement.value = null
  }

  return {
    allMeasurements,
    selectedMeasurement,
    fetchAllMeasurements,
    fetchMeasurement,
    saveMeasurement,
    updateMeasurement,
    deleteMeasurement,
  }
})
