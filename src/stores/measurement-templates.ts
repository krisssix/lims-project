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

export interface TemplateBlockResponse {
  id: number
  blockIndex: number
  kind?: 'table' | 'stats' | 'series' | 'kv'
  title: string | null
  fields: TemplateFieldResponse[]
}

export interface MeasurementTemplateResponse {
  id: number
  name: string
  projectId: number
  deviceId: number
  deviceCode: string
  deviceName: string
  deviceColor: string | null
  fields: TemplateFieldResponse[]
  blocks: TemplateBlockResponse[]
}

/* ===== Request DTO ===== */

export interface TemplateFieldRequest {
  orderIndex: number
  type: ValueType
  required: boolean
  name: string
}

export interface TemplateBlockRequest {
  blockIndex: number
  kind?: 'table' | 'stats' | 'series' | 'kv'
  title: string
  fields: TemplateFieldRequest[]
}

export interface MeasurementTemplateRequest {
  name: string
  deviceCode: string
  blocks: TemplateBlockRequest[]
}

/* ===== Wizard payload ===== */

export interface WizardBlockPayload {
  blockIndex?: number
  kind?: 'table' | 'stats' | 'series' | 'kv'
  title?: string
  fields?: TemplateFieldRequest[]
}

export interface WizardTemplatePayload {
  templateName?: string
  name?: string
  deviceCode: string
  blocks?: WizardBlockPayload[]
  fields?: TemplateFieldRequest[]
  templateId?: string
}

/* API wrappers */
interface ApiList<T> { items: T[] }
interface ApiObject<T> { content: T }
interface ApiResponse<T> { data: T }

export const useMeasurementTemplatesStore = defineStore('measurement-templates', () => {
  const items = ref<MeasurementTemplateResponse[]>([])
  const selected = ref<MeasurementTemplateResponse | null>(null)

  function normalizeTemplate(t: MeasurementTemplateResponse): MeasurementTemplateResponse {
    return {
      ...t,
      fields: Array.isArray(t.fields) ? t.fields : [],
      blocks: Array.isArray(t.blocks) ? t.blocks : [],
    }
  }

  function normalizeDeviceCode(code: string): string {
    return code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
  }

  function toRequestFromWizard(p: WizardTemplatePayload): MeasurementTemplateRequest {
    const deviceCode = normalizeDeviceCode(p.deviceCode || '')
    const nameRaw = (p.templateName ?? p.name ?? 'Šablona').trim()
    const name = nameRaw.length ? nameRaw : 'Šablona'

    const incomingBlocks = Array.isArray(p.blocks)
      ? p.blocks.filter(b => b && typeof b === 'object')
      : []

    const fallbackFields = Array.isArray(p.fields)
      ? p.fields.filter(f => f && typeof f === 'object')
      : []

    const effectiveBlocks: WizardBlockPayload[] =
      incomingBlocks.length
        ? incomingBlocks
        : (fallbackFields.length
          ? [{ blockIndex: 1, title: 'Blok 1', fields: fallbackFields }]
          : [])

    if (!effectiveBlocks.length) {
      return {
        name,
        deviceCode,
        blocks: [{
          blockIndex: 1,
          title: 'Blok 1',
          fields: [{
            orderIndex: 1,
            type: 'text',
            required: false,
            name: 'Pole 1',
          }],
        }],
      }
    }

    const blocks: TemplateBlockRequest[] = effectiveBlocks.map((b, rawIndex) => {
      const blockIndex = typeof b.blockIndex === 'number' && b.blockIndex > 0
        ? b.blockIndex
        : rawIndex + 1

      const titleRaw = (b.title ?? `Blok ${blockIndex}`).toString().trim()
      const title = titleRaw.length ? titleRaw : `Blok ${blockIndex}`

      const rawFields = Array.isArray(b.fields) ? b.fields : []
      const seen = new Set<string>()
      const fields: TemplateFieldRequest[] = []
      let ord = 1

      for (const f of rawFields) {
        const nameField = (f.name ?? '').toString().trim()
        if (!nameField) continue
        const key = nameField.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        fields.push({
          orderIndex: ord++,
          type: f.type,
          required: f.required,
          name: nameField,
        })
      }

      if (!fields.length) {
        fields.push({
          orderIndex: 1,
          type: 'text',
          required: false,
          name: 'Pole 1',
        })
      }

      return { blockIndex, kind: b.kind, title, fields }
    })

    return { name, deviceCode, blocks }
  }

  async function fetchByProject(projectId: number): Promise<MeasurementTemplateResponse[]> {
    const resp = await get(`measurement-templates/project/${projectId}`, undefined)
    const typed = resp as ApiResponse<ApiList<MeasurementTemplateResponse>> | undefined
    const list = typed?.data?.items ?? []
    items.value = list.map(normalizeTemplate)
    return items.value
  }

  async function create(projectId: number, payload: MeasurementTemplateRequest): Promise<MeasurementTemplateResponse> {
    const resp = await post(`measurement-templates/project/${projectId}`, payload, undefined)
    const typed = resp as ApiResponse<ApiObject<MeasurementTemplateResponse>> | undefined
    const saved = typed?.data?.content
      ? normalizeTemplate(typed.data.content)
      : (null as unknown as MeasurementTemplateResponse)
    items.value.push(saved)
    return saved
  }

  async function createFromWizard(projectId: number, wizard: WizardTemplatePayload): Promise<MeasurementTemplateResponse> {
    const req = toRequestFromWizard(wizard)
    return create(projectId, req)
  }

  async function update(projectId: number | null, id: number, payload: MeasurementTemplateRequest): Promise<MeasurementTemplateResponse> {
    const resp = await patch(`measurement-templates/${id}`, payload, undefined)
    const typed = resp as ApiResponse<ApiObject<MeasurementTemplateResponse>> | undefined
    const saved = typed?.data?.content
      ? normalizeTemplate(typed.data.content)
      : (null as unknown as MeasurementTemplateResponse)

    const idx = items.value.findIndex(t => t.id === id)
    if (idx !== -1) items.value[idx] = saved
    if (selected.value?.id === id) selected.value = saved
    return saved
  }

  async function updateFromWizard(projectId: number | null, id: number, wizard: WizardTemplatePayload): Promise<MeasurementTemplateResponse> {
    const req = toRequestFromWizard(wizard)
    return update(projectId, id, req)
  }

  async function remove(id: number): Promise<void> {
    await del(`measurement-templates/${id}`, undefined)
    items.value = items.value.filter(t => t.id !== id)
    if (selected.value?.id === id) selected.value = null
  }

  return {
    items,
    selected,
    fetchByProject,
    create,
    createFromWizard,
    update,
    updateFromWizard,
    remove,
  }
})
