/**
 * Excel file parser using SheetJS (xlsx)
 * Converts .xlsx/.xls files to 2D string arrays for import
 */
import * as XLSX from 'xlsx'

export interface ExcelParseResult {
    success: boolean
    sheets: Array<{
        name: string
        grid: (string | number)[][]
    }>
    error?: string
}

/**
 * Parse Excel file (.xlsx, .xls) to grid data
 */
export async function parseExcelFile(file: File): Promise<ExcelParseResult> {
    try {
        const arrayBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })

        const sheets = workbook.SheetNames.map(sheetName => {
            const worksheet = workbook.Sheets[sheetName]
            if (!worksheet) {
                return { name: sheetName, grid: [] as (string | number)[][] }
            }

            // Convert to 2D array
            const grid = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
                header: 1, // Return array of arrays
                defval: '', // Default value for empty cells
                blankrows: true // Include blank rows
            }) as (string | number)[][]

            return { name: sheetName, grid }
        })

        return { success: true, sheets }
    } catch (err) {
        return {
            success: false,
            sheets: [],
            error: err instanceof Error ? err.message : 'Nepodařilo se načíst Excel soubor'
        }
    }
}

/**
 * Check if file is Excel format
 */
export function isExcelFile(file: File): boolean {
    const excelExtensions = ['.xlsx', '.xls', '.xlsm', '.xlsb']
    const excelMimeTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.ms-excel.sheet.macroEnabled.12',
        'application/vnd.ms-excel.sheet.binary.macroEnabled.12'
    ]

    const fileName = file.name.toLowerCase()
    const hasExcelExtension = excelExtensions.some(ext => fileName.endsWith(ext))
    const hasExcelMime = excelMimeTypes.includes(file.type)

    return hasExcelExtension || hasExcelMime
}

/**
 * Parse any supported file (CSV, TSV, TXT, Excel) to grid
 */
export async function parseFileToGrid(file: File): Promise<{
    success: boolean
    grid: (string | number)[][]
    sheetName?: string
    error?: string
}> {
    if (isExcelFile(file)) {
        const result = await parseExcelFile(file)
        if (!result.success) {
            return { success: false, grid: [], error: result.error }
        }
        // Return first sheet by default
        const firstSheet = result.sheets[0]
        return {
            success: true,
            grid: firstSheet?.grid ?? [],
            sheetName: firstSheet?.name
        }
    }

    // For text files, use simple parsing
    try {
        const text = await file.text()
        const grid = parseTextToGrid(text)
        return { success: true, grid }
    } catch (err) {
        return {
            success: false,
            grid: [],
            error: err instanceof Error ? err.message : 'Nepodařilo se načíst soubor'
        }
    }
}

/**
 * Parse text (CSV/TSV/TXT) to grid
 */
export function parseTextToGrid(text: string): (string | number)[][] {
    const lines = text.split(/\r?\n/)
    const grid: (string | number)[][] = []

    for (const line of lines) {
        // Detect delimiter
        const tabCount = (line.match(/\t/g) || []).length
        const commaCount = (line.match(/,/g) || []).length
        const semicolonCount = (line.match(/;/g) || []).length

        let delimiter = '\t'
        if (commaCount > tabCount && commaCount >= semicolonCount) delimiter = ','
        if (semicolonCount > tabCount && semicolonCount >= commaCount) delimiter = ';'

        const cells = line.split(delimiter).map(cell => {
            const trimmed = cell.trim()
            // Try to convert to number
            const num = parseFloat(trimmed.replace(',', '.'))
            if (!isNaN(num) && trimmed !== '') return num
            return trimmed
        })

        grid.push(cells)
    }

    return grid
}
