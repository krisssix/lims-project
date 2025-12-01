import { read, utils } from 'xlsx'
import type { RawFileKind } from '@/types/import'

export interface ExcelExtraction {
  kind: RawFileKind
  sheetName: string
  rows: string[][]
  warnings: string[]
}

export function extractExcel(arrayBuffer: ArrayBuffer, fileName: string): ExcelExtraction {
  const wb = read(arrayBuffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const json = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false }) as string[][]
  const rows = json.map(r => r.map(c => (c == null ? '' : String(c))))
  const warnings: string[] = []
  if (wb.SheetNames.length > 1) {
    warnings.push(`Soubor má více listů (${wb.SheetNames.length}), použit pouze: ${sheetName}`)
  }
  return {
    kind: fileName.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx',
    sheetName,
    rows,
    warnings
  }
}
