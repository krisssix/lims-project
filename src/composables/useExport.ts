import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface ExportMeasurement {
    id: number
    type: string
    value: number
    unit: string
    timestamp: number | string
    measuredByUsername?: string | null
    note?: string | null
    zenodoDoi?: string | null
}

export interface ExportColumn {
    key: keyof ExportMeasurement | string
    label: string
    enabled: boolean
}

export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = [
    { key: 'id', label: 'ID', enabled: true },
    { key: 'type', label: 'Šablona', enabled: true },
    { key: 'value', label: 'Hodnota', enabled: true },
    { key: 'unit', label: 'Jednotka', enabled: true },
    { key: 'timestamp', label: 'Datum', enabled: true },
    { key: 'measuredByUsername', label: 'Uživatel', enabled: true },
    { key: 'note', label: 'Poznámka', enabled: false },
    { key: 'zenodoDoi', label: 'Zenodo DOI', enabled: false }
]

export type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'json'

function formatDate(timestamp: number | string): string {
    const ms = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)
    if (Number.isNaN(ms)) return String(timestamp)
    return new Date(ms).toLocaleString('cs-CZ')
}

function getValue(measurement: ExportMeasurement, key: string): string {
    if (key === 'timestamp') {
        return formatDate(measurement.timestamp)
    }
    const val = (measurement as Record<string, unknown>)[key]
    if (val == null) return ''
    return String(val)
}

function buildData(measurements: ExportMeasurement[], columns: ExportColumn[]): { headers: string[]; rows: string[][] } {
    const enabledCols = columns.filter(c => c.enabled)
    const headers = enabledCols.map(c => c.label)
    const rows = measurements.map(m => enabledCols.map(c => getValue(m, c.key)))
    return { headers, rows }
}

export function useExport() {

    function exportToCSV(measurements: ExportMeasurement[], columns: ExportColumn[], filename: string): void {
        const { headers, rows } = buildData(measurements, columns)

        const csvContent = [
            headers.join(';'),
            ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(';'))
        ].join('\n')

        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
        downloadBlob(blob, `${filename}.csv`)
    }

    function exportToXLSX(measurements: ExportMeasurement[], columns: ExportColumn[], filename: string): void {
        const { headers, rows } = buildData(measurements, columns)

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
        const { headers, rows } = buildData(measurements, columns)

        const doc = new jsPDF({ orientation: 'landscape' })

        // Title
        doc.setFontSize(16)
        doc.text('Export měření', 14, 15)
        doc.setFontSize(10)
        doc.text(`Datum exportu: ${new Date().toLocaleString('cs-CZ')}`, 14, 22)
        doc.text(`Počet záznamů: ${measurements.length}`, 14, 28)

        // Table
        autoTable(doc, {
            head: [headers],
            body: rows,
            startY: 35,
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [103, 58, 183], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 245, 245] }
        })

        doc.save(`${filename}.pdf`)
    }

    function exportToJSON(measurements: ExportMeasurement[], columns: ExportColumn[], filename: string): void {
        const enabledCols = columns.filter(c => c.enabled)

        const data = measurements.map(m => {
            const obj: Record<string, unknown> = {}
            enabledCols.forEach(col => {
                obj[col.key] = (m as Record<string, unknown>)[col.key]
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
