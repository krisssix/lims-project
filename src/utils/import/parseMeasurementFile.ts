/* eslint-disable @typescript-eslint/no-unused-vars */

import { detectDelimiter } from './detectDelimeter'
import { isProbableUnitRow } from './detectUnitRow'
import { extractKeyValueMeta } from './kvMeta'
import { splitIntoBlocks } from './splitBlocks'
import { inferType } from './inferType'
import { computeStats } from './stats'
import { normalizeHeader } from './normalizeHeader'
import { extractExcel } from './excelAdapter'
import { czechDateToEpoch } from '@/utils/czechDateParser'
import type {
  FileParseResult,
  RawFileKind,
  ParsedBlock,
  ColumnStatsMap,
  InferredColumn,
  TemplateDraft,
  MeasurementRecordDraft,
  MeasurementImportPreview,
  InferredValueType
} from '@/types/import'

function classifyKind(fileName: string): RawFileKind {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.tsv')) return 'tsv'
  if (lower.endsWith('.txt')) return 'txt'
  if (lower.endsWith('.xlsx')) return 'xlsx'
  if (lower.endsWith('.xls')) return 'xls'
  return 'unknown'
}

export interface ParseOptions {
  explicitDelimiter?: string
  assumeSecondLineUnits?: boolean
}

export async function parseMeasurementFile(input: File | string, opts: ParseOptions = {}): Promise<FileParseResult> {
  const fileName = typeof input === 'string' ? 'clipboard.txt' : input.name
  const kind = classifyKind(fileName)
  let rawText = ''
  let rows: string[][] = []

  if (typeof input === 'string') {
    rawText = input
    rows = rawText.split(/\r?\n/).map(l => l.split(/[\t;,|]+/))
  } else if (kind === 'xlsx' || kind === 'xls') {
    const buf = await input.arrayBuffer()
    const excel = extractExcel(buf, fileName)
    rows = excel.rows
    rawText = rows.map(r => r.join('\t')).join('\n')
  } else {
    rawText = await input.text()
    const lines = rawText.split(/\r?\n/)
    const { delimiter } = detectDelimiter(lines, opts.explicitDelimiter)
    rows = lines.filter(l => l.trim().length).map(l => l.split(delimiter))
  }

  const linesForMeta = rawText.split(/\r?\n/)
  const { meta, remaining } = extractKeyValueMeta(linesForMeta)

  // rozdělit do bloků na základě zbývajícího obsahu (remaining)
  const blocksRaw = splitIntoBlocks(remaining)
  const warnings: string[] = []
  const errors: string[] = []

  const parsedBlocks: ParsedBlock[] = []
  let globalBlockIndex = 1

  for (const blockLines of blocksRaw) {
    if (!blockLines.length) continue
    const firstLine = blockLines[0]
    const delimiterCandidate = opts.explicitDelimiter ?? detectDelimiter(blockLines).delimiter
    const splitted = blockLines.map(l => l.split(delimiterCandidate))

    if (splitted.length < 2) {
      warnings.push(`Tabulka hodnot ${globalBlockIndex} má méně než 2 řádky – přeskočeno`)
      continue
    }

    const headerCells = splitted[0]
    const secondCells = splitted[1]

    const useUnits = opts.assumeSecondLineUnits !== false && isProbableUnitRow(secondCells)
    const unitRow = useUnits ? secondCells : null
    const dataStartIndex = useUnits ? 2 : 1

    const dataRows = splitted.slice(dataStartIndex).filter(r => r.some(c => c.trim().length))

    // statistiky
    const numericCandidateColumns = headerCells.map((h, i) => ({
      name: h.trim(),
      samples: dataRows.slice(0, 50).map(r => r[i] ?? '').filter(s => s.trim().length)
    }))

    const statsMap: ColumnStatsMap = {}
    for (const col of numericCandidateColumns) {
      const type = inferType(col.samples)
      if (type === 'float' || type === 'int') {
        statsMap[col.name] = {
          ...computeStats(col.samples),
          numericRate: col.samples.length / Math.max(1, dataRows.length)
        }
      }
    }

    parsedBlocks.push({
      blockIndex: globalBlockIndex,
      title: null,
      header: headerCells.map(h => h.trim()),
      unitRow,
      rows: dataRows,
      stats: statsMap
    })
    globalBlockIndex++
  }

  // spolehlivost hlavičky (jednoduchá heuristika: počet sloupců > 1 a žádná čistě číselná hlavička)
  const headerConfidence = parsedBlocks.length
    ? Math.min(
      1,
      parsedBlocks[0].header.filter(h => !/^[+-]?\d+([.,]\d+)?$/.test(h)).length /
      Math.max(1, parsedBlocks[0].header.length)
    )
    : 0

  return {
    fileName,
    kind,
    delimiter: parsedBlocks[0]?.rows.length ? opts.explicitDelimiter ?? ',' : ',',
    originalText: rawText,
    blocks: parsedBlocks,
    meta,
    warnings,
    errors,
    headerConfidence,
    usedSecondLineAsUnits: parsedBlocks.some(b => b.unitRow != null)
  }
}

export function buildTemplateDraft(result: FileParseResult, proposedName: string, deviceId: string): TemplateDraft {
  const columns: InferredColumn[] = []
  const firstBlock = result.blocks[0]
  if (!firstBlock) {
    return { name: proposedName, deviceId, columns: [], blocks: [] }
  }
  firstBlock.header.forEach((h, i) => {
    const unit = firstBlock.unitRow?.[i]?.trim() || null
    const samples = firstBlock.rows.slice(0, 50).map(r => r[i] ?? '').filter(s => s.trim().length)
    const type = inferType(samples)
    columns.push({
      name: h,
      originalName: h,
      normalizedName: normalizeHeader(h),
      type,
      unit,
      index: i
    })
  })
  return {
    name: proposedName,
    deviceId,
    columns,
    blocks: result.blocks.map(b => ({
      blockIndex: b.blockIndex,
      title: b.title || `Tabulka hodnot ${b.blockIndex}`,
      fields: b.header.map((h, i) => {
        const unit = b.unitRow?.[i]?.trim() || null
        const samples = b.rows.slice(0, 50).map(r => r[i] ?? '').filter(s => s.trim().length)
        const type = inferType(samples)
        return {
          name: h,
          originalName: h,
          normalizedName: normalizeHeader(h),
          type,
          unit,
          index: i
        }
      })
    }))
  }
}

export function buildMeasurementPreview(result: FileParseResult, templateDraft: TemplateDraft): MeasurementImportPreview {
  const records: MeasurementRecordDraft[] = []

  // vytvořit záznamy z bloků: každý řádek: jeden záznam (může se sloučit později podle více bloků)
  for (const block of result.blocks) {
    block.rows.forEach((row, rowIdx) => {
      const recordIndex = rowIdx + 1
      let rec = records.find(r => r.recordIndex === recordIndex)
      if (!rec) {
        rec = { recordIndex, fields: [] }
        records.push(rec)
      }
      block.header.forEach((h, colIdx) => {
        const colDraft = templateDraft.blocks
          .find(tb => tb.blockIndex === block.blockIndex)?.fields
          .find(f => f.index === colIdx)
        const rawVal = row[colIdx] ?? ''
        rec.fields.push({
          name: h,
          type: colDraft?.type ?? 'text',
          value: convertValue(rawVal, colDraft?.type),
          blockIndex: block.blockIndex,
          blockTitle: templateDraft.blocks.find(b => b.blockIndex === block.blockIndex)?.title
        })
      })
    })
  }

  return {
    templateDraft,
    records: records.sort((a, b) => a.recordIndex - b.recordIndex),
    meta: result.meta,
    delimiter: result.delimiter,
    sourceFile: result.fileName
  }
}

function convertValue(raw: string, type: InferredValueType | undefined): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return null
  switch (type) {
    case 'int': {
      const n = parseInt(trimmed.replace(',', '.'), 10)
      return Number.isFinite(n) ? n : null
    }
    case 'float': {
      const n = parseFloat(trimmed.replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    case 'bool': {
      const t = trimmed.toLowerCase()
      if (['true', '1', 'yes', 'y', 'ano', 'a', 't'].includes(t)) return true
      if (['false', '0', 'no', 'n', 'ne', 'f'].includes(t)) return false
      return null
    }
    case 'date': {
      // nejdříve zkusit český parser data (zvládá např. „4. října 2022 16:58:51“)
      const czechMs = czechDateToEpoch(trimmed)
      if (czechMs !== null) return czechMs

      // pád zpět na standardní date.parse
      const ms = Date.parse(trimmed)
      return Number.isFinite(ms) ? ms : trimmed
    }
    case 'file':
      return trimmed
    case 'text':
    default:
      return trimmed
  }
}
