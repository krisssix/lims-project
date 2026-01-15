export type TemplateFieldExport = {
  orderIndex: number
  name: string
  type: 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
  required: boolean
  blockIndex: number
  blockTitle?: string | null
}

export type TemplateExportModel = {
  templateName: string
  deviceId: string
  fields: TemplateFieldExport[]
}

/**
 * Exportuje šablonu do CSV ve formátu:
 * blockIndex;blockTitle;orderIndex;name;type;required
 * - Oddělovač: středník (;) – Excel-friendly v CS lokalizaci.
 */
export function exportTemplateCSV(model: TemplateExportModel, filename?: string): void {
  const header = ['blockIndex', 'blockTitle', 'orderIndex', 'name', 'type', 'required']
  const lines: string[] = []
  lines.push(header.join(';'))
  for (const f of model.fields) {
    const row = [
      String(f.blockIndex),
      String((f.blockTitle ?? '').replace(/[\r\n;]+/g, ' ').trim()),
      String(f.orderIndex),
      String(f.name.replace(/[\r\n;]+/g, ' ').trim()),
      f.type,
      f.required ? 'true' : 'false'
    ]
    lines.push(row.join(';'))
  }
  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const file = (filename || `${slugify(model.templateName)}.csv`)
  downloadBlob(blob, file)
}

/**
 * Exportuje šablonu do XLSX přes window.XLSX (SheetJS), pokud je dostupná.
 * - Vytvoří 1 sheet "Template" s hlavičkami shodnými s CSV.
 * - Pokud XLSX není k dispozici, vyhodí Error – UI má zobrazit upozornění, nabídnout CSV.
 */
export function exportTemplateXLSX(model: TemplateExportModel, filename?: string): void {
  const XLSX = (globalThis as unknown as { XLSX?: unknown }).XLSX as
    | {
    utils: {
      book_new: () => unknown
      aoa_to_sheet: (rows: unknown[][]) => unknown
      book_append_sheet: (wb: unknown, ws: unknown, name: string) => void
    }
    writeFile: (wb: unknown, name: string) => void
  }
    | undefined

  if (!XLSX) {
    throw new Error('XLSX knihovna není k dispozici. Nainstalujte SheetJS nebo použijte export do CSV.')
  }

  const rows: unknown[][] = [
    ['blockIndex', 'blockTitle', 'orderIndex', 'name', 'type', 'required']
  ]
  for (const f of model.fields) {
    rows.push([
      f.blockIndex,
      (f.blockTitle ?? ''),
      f.orderIndex,
      f.name,
      f.type,
      f.required ? 'true' : 'false'
    ])
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Template')
  const file = (filename || `${slugify(model.templateName)}.xlsx`)
  XLSX.writeFile(wb, file)
}

/* ---------- helpers ---------- */

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
