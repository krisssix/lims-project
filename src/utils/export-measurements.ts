/**
 * nástroje pro export měření do csv
 */
import { type MeasurementResponse, type MeasuredValue } from '@/stores/measurement'

export interface ExportColumn {
    key: string
    label: string
    enabled: boolean
}

export interface ExportOptions {
    columns: ExportColumn[]
    includeSeries: boolean
    measurements: MeasurementResponse[]
    filename?: string
}

// výchozí dostupné sloupce
export function getDefaultColumns(): ExportColumn[] {
    return [
        { key: 'id', label: 'ID', enabled: true },
        { key: 'type', label: 'Typ (Šablona)', enabled: true },
        { key: 'unit', label: 'Zařízení', enabled: true },
        { key: 'timestamp', label: 'Datum měření', enabled: true },
        { key: 'createdAt', label: 'Datum vložení', enabled: true },
        { key: 'measuredByUsername', label: 'Uživatel', enabled: true },
        { key: 'note', label: 'Poznámka', enabled: true },
        { key: 'recordCount', label: 'Počet záznamů', enabled: true },
        { key: 'values', label: 'Hodnoty (dynamické sloupce)', enabled: true }
    ]
}

// formátování časového razítka na čitelný řetězec data
function formatTimestamp(ts: number | string | undefined): string {
    if (!ts) return ''
    const ms = typeof ts === 'number' ? ts : Date.parse(String(ts))
    if (Number.isNaN(ms)) return String(ts)
    const d = new Date(ms)
    return d.toLocaleString('cs-CZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })
}

// ošetření csv hodnoty (uvozovky a čárky)
function escapeCSV(value: unknown): string {
    if (value === null || value === undefined) return ''
    const str = String(value)
    // pokud obsahuje čárku, nový řádek nebo uvozovku, obalit do uvozovek a zdvojit vnitřní uvozovky
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`
    }
    return str
}

// získání unikátních názvů polí ze všech měření
function getUniqueFieldNames(measurements: MeasurementResponse[]): string[] {
    const fieldNames = new Set<string>()
    for (const m of measurements) {
        for (const v of m.values ?? []) {
            fieldNames.add(v.name)
        }
    }
    return Array.from(fieldNames).sort()
}

// získání zobrazení hodnoty z measuredvalue
function getValueDisplay(v: MeasuredValue): string {
    if (v.numberValue !== null && v.numberValue !== undefined) return String(v.numberValue)
    if (v.textValue !== null && v.textValue !== undefined) return v.textValue
    if (v.boolValue !== null && v.boolValue !== undefined) return v.boolValue ? 'Ano' : 'Ne'
    if (v.dateValue !== null && v.dateValue !== undefined) return formatTimestamp(v.dateValue)
    if (v.fileUrl) return v.fileUrl
    return ''
}

// sestavení obsahu csv z měření
export function buildCSV(options: ExportOptions): string {
    const { columns, measurements, includeSeries } = options
    const enabledColumns = columns.filter(c => c.enabled)

    // získání unikátních názvů polí pro dynamické sloupce hodnot
    const fieldNames = enabledColumns.some(c => c.key === 'values')
        ? getUniqueFieldNames(measurements)
        : []

    // sestavení řádku hlavičky
    const headers: string[] = []
    for (const col of enabledColumns) {
        if (col.key === 'values') {
            // přidat každý název pole jako samostatný sloupec
            headers.push(...fieldNames)
        } else {
            headers.push(col.label)
        }
    }

    // sestavení datových řádků (jeden řádek na záznam)
    const rows: string[][] = []

    for (const m of measurements) {
        // seskupení hodnot podle recordindex
        const recordsMap = new Map<number, MeasuredValue[]>()
        for (const v of m.values ?? []) {
            const ri = v.recordIndex ?? 1
            if (!recordsMap.has(ri)) recordsMap.set(ri, [])
            recordsMap.get(ri)!.push(v)
        }

        // pokud nejsou žádné hodnoty, i tak vytvořit jeden řádek
        if (recordsMap.size === 0) {
            recordsMap.set(1, [])
        }

        // vytvoření řádku pro každý záznam
        const recordIndexes = Array.from(recordsMap.keys()).sort((a, b) => a - b)
        for (const recordIndex of recordIndexes) {
            const recordValues = recordsMap.get(recordIndex) ?? []
            const row: string[] = []

            for (const col of enabledColumns) {
                switch (col.key) {
                    case 'id':
                        row.push(escapeCSV(m.id))
                        break
                    case 'type':
                        row.push(escapeCSV(m.type))
                        break
                    case 'unit':
                        row.push(escapeCSV(m.unit))
                        break
                    case 'timestamp':
                        row.push(escapeCSV(formatTimestamp(m.timestamp)))
                        break
                    case 'createdAt':
                        row.push(escapeCSV(formatTimestamp((m as { createdAt?: number }).createdAt)))
                        break
                    case 'measuredByUsername':
                        row.push(escapeCSV(m.measuredByUsername ?? ''))
                        break
                    case 'note':
                        row.push(escapeCSV(m.note ?? ''))
                        break
                    case 'recordCount':
                        row.push(escapeCSV(recordsMap.size))
                        break
                    case 'values':
                        // přidat hodnotu pro každý název pole
                        for (const fieldName of fieldNames) {
                            const val = recordValues.find(v => v.name === fieldName)
                            row.push(escapeCSV(val ? getValueDisplay(val) : ''))
                        }
                        break
                    default:
                        row.push('')
                }
            }

            rows.push(row)
        }
    }

    // pokud jsou zahrnuty série a existují, přidat je (oddělená sekce)
    if (includeSeries) {
        const seriesData = measurements.filter(m => m.series && m.series.length > 0)
        if (seriesData.length > 0) {
            rows.push([]) // prázdný řádek jako oddělovač
            rows.push(['📊 datové série'])
            rows.push(['id měření', 'typ série', 'název série', 'hodnoty x', 'hodnoty y'])

            for (const m of seriesData) {
                for (const s of m.series ?? []) {
                    rows.push([
                        escapeCSV(m.id),
                        escapeCSV(s.seriesType),
                        escapeCSV(s.seriesName ?? ''),
                        escapeCSV((s.xValues ?? []).join('; ')),
                        escapeCSV((s.yValues ?? []).join('; '))
                    ])
                }
            }
        }
    }

    // spojení hlaviček a řádků
    const lines = [headers.map(escapeCSV).join(','), ...rows.map(r => r.join(','))]

    // přidání utf-8 bom pro kompatibilitu s excelem
    return '\uFEFF' + lines.join('\r\n')
}

// stažení csv souboru
export function downloadCSV(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

// export měření do csv souboru
export function exportMeasurementsToCSV(options: ExportOptions): void {
    const csv = buildCSV(options)
    const filename = options.filename || `mereni_export_${new Date().toISOString().slice(0, 10)}.csv`
    downloadCSV(csv, filename)
}
