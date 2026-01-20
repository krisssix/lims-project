import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { type MeasuredValue } from '@/stores/measurement'

export interface ExportMeasurement {
    id: number
    type: string
    value: number
    unit: string
    timestamp: number | string
    measuredByUsername?: string | null
    note?: string | null
    zenodoDoi?: string | null
    values?: MeasuredValue[]
}

export interface ExportColumn {
    key: keyof ExportMeasurement | string
    label: string
    enabled: boolean
}

export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'type', label: 'Šablona', enabled: true },
    { key: 'unit', label: 'Jednotka', enabled: true },
    { key: 'timestamp', label: 'Datum', enabled: true },
    { key: 'measuredByUsername', label: 'Uživatel', enabled: true },
    { key: 'note', label: 'Poznámka', enabled: true },
    { key: 'values', label: 'Hodnoty (záznamy)', enabled: true },
    { key: 'zenodoDoi', label: 'Zenodo DOI', enabled: false }
]

export type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'json'

// Transliteration map for Czech diacritics to ASCII (for PDF compatibility)
const CZECH_TRANSLITERATION: Record<string, string> = {
    'á': 'a', 'Á': 'A', 'č': 'c', 'Č': 'C', 'ď': 'd', 'Ď': 'D',
    'é': 'e', 'É': 'E', 'ě': 'e', 'Ě': 'E', 'í': 'i', 'Í': 'I',
    'ň': 'n', 'Ň': 'N', 'ó': 'o', 'Ó': 'O', 'ř': 'r', 'Ř': 'R',
    'š': 's', 'Š': 'S', 'ť': 't', 'Ť': 'T', 'ú': 'u', 'Ú': 'U',
    'ů': 'u', 'Ů': 'U', 'ý': 'y', 'Ý': 'Y', 'ž': 'z', 'Ž': 'Z'
}

function transliterateCzech(text: string): string {
    return text.replace(/[áÁčČďĎéÉěĚíÍňŇóÓřŘšŠťŤúÚůŮýÝžŽ]/g, char => CZECH_TRANSLITERATION[char] || char)
}

function parseDateToMs(value: number | string): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }

    const str = String(value).trim()
    if (!str) return null

    const ms = Date.parse(str)
    if (!Number.isNaN(ms)) return ms

    const czechMatch = str.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
    if (czechMatch) {
        const [, day, month, year, hour = '0', minute = '0', second = '0'] = czechMatch
        const d = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(minute, 10),
            parseInt(second, 10)
        )
        if (!Number.isNaN(d.getTime())) return d.getTime()
    }

    const isoLikeMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (isoLikeMatch) {
        const [, year, month, day, hour = '0', minute = '0', second = '0'] = isoLikeMatch
        const d = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(minute, 10),
            parseInt(second, 10)
        )
        if (!Number.isNaN(d.getTime())) return d.getTime()
    }

    return null
}

function formatDate(timestamp: number | string): string {
    const ms = parseDateToMs(timestamp)
    if (ms === null) return String(timestamp)
    return new Date(ms).toLocaleString('cs-CZ')
}

function getValueDisplay(v: MeasuredValue): string {
    if (v.numberValue !== null && v.numberValue !== undefined) return String(v.numberValue)
    if (v.textValue !== null && v.textValue !== undefined) return v.textValue
    if (v.boolValue !== null && v.boolValue !== undefined) return v.boolValue ? 'Ano' : 'Ne'
    if (v.dateValue !== null && v.dateValue !== undefined) return formatDate(v.dateValue)
    if (v.fileUrl) return v.fileUrl
    return ''
}

function getUniqueFieldNames(measurements: ExportMeasurement[]): string[] {
    const fieldNames = new Set<string>()
    for (const m of measurements) {
        for (const v of m.values ?? []) {
            fieldNames.add(v.name)
        }
    }
    return Array.from(fieldNames).sort()
}

function getValue(measurement: ExportMeasurement, key: string): string {
    if (key === 'timestamp') {
        return formatDate(measurement.timestamp)
    }
    const val = (measurement as unknown as Record<string, unknown>)[key]
    if (val == null) return ''
    return String(val)
}

// Builds data with one row per record (expanded view)
function buildDataExpanded(
    measurements: ExportMeasurement[],
    columns: ExportColumn[]
): { headers: string[]; rows: string[][] } {
    const enabledCols = columns.filter(c => c.enabled)
    const includeValues = enabledCols.some(c => c.key === 'values')
    const fieldNames = includeValues ? getUniqueFieldNames(measurements) : []

    // Build headers
    const headers: string[] = []
    for (const col of enabledCols) {
        if (col.key === 'values') {
            headers.push(...fieldNames)
        } else {
            headers.push(col.label)
        }
    }

    // Build rows - one per record
    const rows: string[][] = []

    for (const m of measurements) {
        // Group values by recordIndex
        const recordsMap = new Map<number, MeasuredValue[]>()
        for (const v of m.values ?? []) {
            const ri = v.recordIndex ?? 1
            if (!recordsMap.has(ri)) recordsMap.set(ri, [])
            recordsMap.get(ri)!.push(v)
        }

        // If no values, still create one row
        if (recordsMap.size === 0) {
            recordsMap.set(1, [])
        }

        const recordIndexes = Array.from(recordsMap.keys()).sort((a, b) => a - b)

        for (const recordIndex of recordIndexes) {
            const recordValues = recordsMap.get(recordIndex) ?? []
            const row: string[] = []

            for (const col of enabledCols) {
                if (col.key === 'values') {
                    // Add value for each field name
                    for (const fieldName of fieldNames) {
                        const val = recordValues.find(v => v.name === fieldName)
                        row.push(val ? getValueDisplay(val) : '')
                    }
                } else {
                    row.push(getValue(m, col.key))
                }
            }

            rows.push(row)
        }
    }

    return { headers, rows }
}

// Simple data build (one row per measurement, no value expansion)
function buildDataSimple(measurements: ExportMeasurement[], columns: ExportColumn[]): { headers: string[]; rows: string[][] } {
    const enabledCols = columns.filter(c => c.enabled && c.key !== 'values')
    const headers = enabledCols.map(c => c.label)
    const rows = measurements.map(m => enabledCols.map(c => getValue(m, c.key)))
    return { headers, rows }
}

export function useExport() {

    function exportToCSV(measurements: ExportMeasurement[], columns: ExportColumn[], filename: string): void {
        const includeValues = columns.some(c => c.enabled && c.key === 'values')
        const { headers, rows } = includeValues
            ? buildDataExpanded(measurements, columns)
            : buildDataSimple(measurements, columns)

        const csvContent = [
            headers.join(';'),
            ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(';'))
        ].join('\n')

        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
        downloadBlob(blob, `${filename}.csv`)
    }

    function exportToXLSX(measurements: ExportMeasurement[], columns: ExportColumn[], filename: string): void {
        const includeValues = columns.some(c => c.enabled && c.key === 'values')
        const { headers, rows } = includeValues
            ? buildDataExpanded(measurements, columns)
            : buildDataSimple(measurements, columns)

        const wsData = [headers, ...rows]
        const ws = XLSX.utils.aoa_to_sheet(wsData)

        // Set column widths
        const colWidths = headers.map((h, i) => {
            const maxLen = Math.max(h.length, ...rows.map(r => (r[i] || '').length))
            return { wch: Math.min(maxLen + 2, 50) }
        })
        ws['!cols'] = colWidths

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Měření')
        XLSX.writeFile(wb, `${filename}.xlsx`)
    }

    function exportToPDF(measurements: ExportMeasurement[], columns: ExportColumn[], filename: string): void {
        const includeValues = columns.some(c => c.enabled && c.key === 'values')
        const { headers, rows } = includeValues
            ? buildDataExpanded(measurements, columns)
            : buildDataSimple(measurements, columns)

        // Transliterate all text for PDF compatibility with Czech characters
        const pdfHeaders = headers.map(h => transliterateCzech(h))
        const pdfRows = rows.map(row => row.map(cell => transliterateCzech(cell)))

        const doc = new jsPDF({ orientation: 'landscape' })

        // Title section
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.text('Export mereni', 14, 18)

        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        doc.text(`Datum exportu: ${transliterateCzech(new Date().toLocaleString('cs-CZ'))}`, 14, 26)
        doc.text(`Pocet zaznamu: ${pdfRows.length}`, 14, 32)

        // Table
        autoTable(doc, {
            head: [pdfHeaders],
            body: pdfRows,
            startY: 40,
            styles: {
                fontSize: 7,
                cellPadding: 2,
                overflow: 'linebreak',
                cellWidth: 'wrap'
            },
            headStyles: {
                fillColor: [103, 58, 183],
                textColor: 255,
                fontStyle: 'bold',
                halign: 'center'
            },
            alternateRowStyles: { fillColor: [248, 249, 251] },
            columnStyles: {
                // Limit note column width if present
                note: { cellWidth: 60 }
            },
            margin: { left: 10, right: 10 },
            tableWidth: 'auto'
        })

        doc.save(`${filename}.pdf`)
    }

    function exportToJSON(measurements: ExportMeasurement[], columns: ExportColumn[], filename: string): void {
        const enabledCols = columns.filter(c => c.enabled)


        const data = measurements.map(m => {
            const obj: Record<string, unknown> = {}
            enabledCols.forEach(col => {
                if (col.key === 'values') {
                    // Include full values array for JSON
                    obj['values'] = m.values ?? []
                } else {
                    obj[col.key] = (m as unknown as Record<string, unknown>)[col.key]
                }
            })
            return obj
        })

        const json = JSON.stringify(data, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        downloadBlob(blob, `${filename}.json`)
    }

    function downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        URL.revokeObjectURL(url)
    }

    function doExport(
        format: ExportFormat,
        measurements: ExportMeasurement[],
        columns: ExportColumn[],
        filename?: string
    ): void {
        const fname = filename || `mereni_export_${new Date().toISOString().split('T')[0]}`

        switch (format) {
            case 'csv':
                exportToCSV(measurements, columns, fname)
                break
            case 'xlsx':
                exportToXLSX(measurements, columns, fname)
                break
            case 'pdf':
                exportToPDF(measurements, columns, fname)
                break
            case 'json':
                exportToJSON(measurements, columns, fname)
                break
        }
    }

    return {
        doExport,
        exportToCSV,
        exportToXLSX,
        exportToPDF,
        exportToJSON,
        DEFAULT_EXPORT_COLUMNS
    }
}
