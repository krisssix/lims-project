import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post, patch, del } from '@/services/api/api-requests'

export type ValueType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'

export interface TemplateFieldResponse {
  id: number
  orderIndex: number
  type: ValueType
  required: boolean
  name: string
}

export interface MeasurementTemplateResponse {
  id: number
  name: string
  deviceId: number
  deviceCode: string
  deviceName: string
  deviceColor?: string | null
  projectId: number
  fields: TemplateFieldResponse[]
}

export interface TemplateFieldRequest {
  orderIndex: number
  type: ValueType
  required: boolean
  name: string
}

export interface MeasurementTemplateRequest {
  name: string
  deviceCode?: string
  deviceId?: number
  fields: TemplateFieldRequest[]
}

export const useMeasurementTemplatesStore = defineStore('measurement-templates', () => {
  const items = ref<MeasurementTemplateResponse[]>([])
  const selected = ref<MeasurementTemplateResponse | null>(null)

  async function fetchByProject(projectId: number) {
    const resp = await get<{ items: MeasurementTemplateResponse[] }>(`measurement-templates/project/${projectId}`)
    items.value = resp.data.items ?? []
    return items.value
  }

  async function create(projectId: number, payload: MeasurementTemplateRequest) {
    const resp = await post<{ content: MeasurementTemplateResponse }>(
      `measurement-templates/project/${projectId}`,
      payload
    )
    return resp.data.content
  }

  async function update(id: number, payload: MeasurementTemplateRequest) {
    const resp = await patch<{ content: MeasurementTemplateResponse }>(
      `measurement-templates/${id}`,
      payload
    )
    return resp.data.content
  }

  async function remove(id: number) {
    await del(`measurement-templates/${id}`)
    items.value = items.value.filter(t => t.id !== id)
    if (selected.value?.id === id) selected.value = null
  }

  return {
    items,
    selected,
    fetchByProject,
    create,
    update,
    remove,
  }
})
