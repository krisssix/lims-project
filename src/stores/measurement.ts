import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post, del, patch } from '@/services/api/api-requests'

export type ValueType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'

export interface MeasuredValue {
  orderIndex: number
  recordIndex?: number | null
  blockIndex?: number | null
  name: string
  type: ValueType
  numberValue?: number | null
  textValue?: string | null
  boolValue?: boolean | null
  dateValue?: number | null
  fileUrl?: string | null
}

/* ===== série měření (measurementseries) ===== */

export interface MeasurementSeriesRequest {
  seriesType: string  // 'X_INTENSITY', 'SIZE_DISTRIBUTION', 'VOLUME_DISTRIBUTION'
  seriesName?: string
  seriesScope?: 'record' | 'summary'  // 'record': propojeno s konkrétním záznamem, 'summary': průměr na úrovni měření
  linkedRecordIndex?: number | null
  linkedRecordDescription?: string | null
  xValues: number[]
  yValues: number[]
  xUnit?: string | null
  yUnit?: string | null
}

export interface MeasurementSeriesResponse {
  id: number
  seriesType: string
  seriesName?: string | null
  seriesScope?: 'record' | 'summary' | null
  linkedRecordIndex?: number | null
  linkedRecordDescription?: string | null
  xValues: number[]
  yValues: number[]
  xUnit?: string | null
  yUnit?: string | null
}

/* ===== měření: požadavek/odpověď (request/response) ===== */

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
  series?: MeasurementSeriesRequest[]
  status?: 'DRAFT' | 'PUBLISHED'
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
  series?: MeasurementSeriesResponse[]
  createdAt?: number | null  // epoch ms: kdy bylo měření vytvořeno
  updatedAt?: number | null  // epoch ms: kdy bylo měření naposledy upraveno
  status?: 'DRAFT' | 'PUBLISHED'
  zenodoRecordId?: number | null  // id záznamu zenodo pro verzování
  zenodoDoi?: string | null  // doi ve službě zenodo
  dataHash?: string | null  // hash sha-256 pro ověření integrity dat
}

type ApiList<T> = { items: T[] }
type ApiObject<T> = { content: T }

type MeasurementPatch = Partial<
  Pick<
    MeasurementRequest,
    | 'value'
    | 'type'
    | 'unit'
    | 'timestamp'
    | 'values'
    | 'templateId'
    | 'groupId'
    | 'note'
    | 'measuredByUsername'
  >
>

function normalizeResp(m: MeasurementResponse): MeasurementResponse {
  // pomocník pro normalizaci sérií: backend může vracet xvalues/yvalues (malá písmena)
  // ale frontend očekává xValues/yValues (camelCase)
  const normalizeSeries = (s: MeasurementSeriesResponse & {
    xvalues?: number[] | null
    yvalues?: number[] | null
    xunit?: string | null
    yunit?: string | null
    seriesscope?: string | null
  }): MeasurementSeriesResponse => ({
    id: s.id,
    seriesType: s.seriesType,
    seriesName: s.seriesName ?? null,
    seriesScope: (s.seriesScope ?? s.seriesscope ?? 'record') as 'record' | 'summary' | null,
    linkedRecordIndex: s.linkedRecordIndex ?? null,
    linkedRecordDescription: s.linkedRecordDescription ?? null,
    // ošetření obou konvencí pojmenování z backendu
    xValues: s.xValues ?? s.xvalues ?? [],
    yValues: s.yValues ?? s.yvalues ?? [],
    xUnit: s.xUnit ?? s.xunit ?? null,
    yUnit: s.yUnit ?? s.yunit ?? null
  })

  // pomocník pro normalizaci naměřených hodnot: backend může používat různé styly zápisu
  type BackendValue = MeasuredValue & {
    fileurl?: string | null  // backend může poslat malá písmena
    file_url?: string | null // nebo snake_case
  }

  return {
    ...m,
    note: m.note ?? null,
    groupId: m.groupId ?? null,
    templateId: m.templateId ?? null,
    measuredByUsername: m.measuredByUsername ?? null,
    values: Array.isArray(m.values)
      ? m.values.map((v: BackendValue) => ({
        ...v,
        orderIndex: v.orderIndex ?? 999,  // zachovat orderindex z backendu
        recordIndex: v.recordIndex ?? 1,
        blockIndex: v.blockIndex ?? 1,
        // normalizace fileurl: ošetření různých stylů zápisu z backendu
        fileUrl: v.fileUrl ?? v.fileurl ?? v.file_url ?? null
      }))
      : [],
    series: Array.isArray(m.series) ? m.series.map(normalizeSeries) : []
  }
}

export const useMeasurementStore = defineStore('measurement', () => {
  const allMeasurements = ref<MeasurementResponse[]>([])
  const selectedMeasurement = ref<MeasurementResponse | null>(null)

  async function fetchAllMeasurements(projectId: number): Promise<MeasurementResponse[]> {
    const resp = await get(`measurements/project/${projectId}`, undefined)
    const data = resp?.data as ApiList<MeasurementResponse> | undefined
    allMeasurements.value = (data?.items ?? []).map(normalizeResp)
    return allMeasurements.value
  }

  async function fetchMeasurement(
    projectId: number,
    measurementId: number
  ): Promise<MeasurementResponse | null> {
    const resp = await get(`measurements/project/${projectId}/${measurementId}`, undefined)
    const data = resp?.data as ApiObject<MeasurementResponse> | undefined
    selectedMeasurement.value = data?.content ? normalizeResp(data.content) : null
    return selectedMeasurement.value
  }

  async function saveMeasurement(
    projectId: number,
    measurement: MeasurementRequest
  ): Promise<MeasurementResponse> {
    const payload: MeasurementRequest = {
      ...measurement,
      templateId: measurement.templateId ?? null,
      groupId: measurement.groupId ?? null,
      note: measurement.note ?? null,
      measuredByUsername: measurement.measuredByUsername ?? null,
      values: (measurement.values ?? []).map(v => ({
        ...v,
        recordIndex: v.recordIndex ?? 1,
        blockIndex: v.blockIndex ?? 1
      })),
      series: measurement.series ?? []
    }
    const resp = await post(`measurements/project/${projectId}`, payload, undefined)
    const data = resp?.data as ApiObject<MeasurementResponse> | undefined
    const saved = data?.content
      ? normalizeResp(data.content)
      : (null as unknown as MeasurementResponse)
    return saved
  }

  async function updateMeasurement(
    id: number,
    patchPayload: MeasurementPatch
  ): Promise<MeasurementResponse> {
    const resp = await patch(
      `measurements/${id}`,
      {
        ...patchPayload,
        templateId:
          patchPayload.templateId === undefined ? undefined : patchPayload.templateId ?? null,
        groupId: patchPayload.groupId === undefined ? undefined : patchPayload.groupId ?? null,
        note: patchPayload.note === undefined ? undefined : patchPayload.note ?? null,
        measuredByUsername:
          patchPayload.measuredByUsername === undefined
            ? undefined
            : patchPayload.measuredByUsername ?? null,
        values: patchPayload.values
          ? patchPayload.values.map(v => ({
            ...v,
            recordIndex: v.recordIndex ?? 1,
            blockIndex: v.blockIndex ?? 1
          }))
          : undefined
      },
      undefined
    )
    const data = resp?.data as ApiObject<MeasurementResponse> | undefined
    const updated = data?.content
      ? normalizeResp(data.content)
      : (null as unknown as MeasurementResponse)
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

  async function deleteMeasurementsBulk(ids: number[]): Promise<void> {
    // použít post pro hromadné smazání: koncový bod backendu je /measurements/bulk-delete
    await post('measurements/bulk-delete', ids, undefined)
    const idSet = new Set(ids)
    allMeasurements.value = allMeasurements.value.filter(m => !idSet.has(m.id))
    if (selectedMeasurement.value && idSet.has(selectedMeasurement.value.id)) {
      selectedMeasurement.value = null
    }
  }

  return {
    allMeasurements,
    selectedMeasurement,
    fetchAllMeasurements,
    fetchMeasurement,
    saveMeasurement,
    updateMeasurement,
    deleteMeasurement,
    deleteMeasurementsBulk
  }
})
