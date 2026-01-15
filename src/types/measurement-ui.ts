export type ValueType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'

export type TemplateFieldRow = {
  orderIndex: number
  type: ValueType
  required: boolean
  name: string
}

export type TemplateBlockRow = {
  id?: number
  blockIndex: number
  kind?: 'table' | 'stats' | 'series' | 'kv'
  title: string
  fields: TemplateFieldRow[]
}

export type UiFieldRow = {
  id: string
  type: ValueType
  required: boolean
  name: string
}

export type DeviceItem = {
  id: string
  code?: string
  name: string
  color: string
}

export type TemplateStatus = 'DRAFT' | 'ACTIVE' | 'DEPRECATED'

export type TemplateItem = {
  id: string
  name: string
  deviceId: string
  deviceColor: string
  fields: TemplateFieldRow[]
  blocks?: TemplateBlockRow[]
  createdAt?: string
  updatedAt?: string
  status?: TemplateStatus
  version?: string
  parentVersionId?: number
  changeDescription?: string
}

export type ValueRow = {
  id: string
  order: number
  name: string
  type: ValueType
  required: boolean
  value: unknown
}

export type TableHeader = { title: string; key: string; width?: number; align?: 'start' | 'center' | 'end'; sortable?: boolean }
export type TableRow = { id: number; type: string; device: string; date: string; count: number }
