/**
 * parsování excel souborů pomocí sheetjs (xlsx)
 * převádí soubory .xlsx/.xls na 2d pole řetězců pro import
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
 * zparsování excel souboru (.xlsx, .xls) na data mřížky
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

            // převod na 2d pole
            const grid = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
                header: 1, // vrátit pole polí
                defval: '', // výchozí hodnota pro prázdné buňky
                blankrows: true // zahrnout prázdné řádky
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
 * kontrola, zda má soubor formát excelu
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
 * zparsování libovolného podporovaného souboru (csv, tsv, txt, excel) na mřížku
 */
export async function parseFileToGrid(file: File, options?: { delimiter?: string }): Promise<{
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
        // vrátit první list (sheet) jako výchozí
        const firstSheet = result.sheets[0]
        return {
            success: true,
            grid: firstSheet?.grid ?? [],
            sheetName: firstSheet?.name
        }
    }

    // pro textové soubory použít jednoduché parsování
    try {
        const text = await file.text()
        const grid = parseTextToGrid(text, options?.delimiter)
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
 * zparsování textu (csv/tsv/txt) na mřížku
 */
export function parseTextToGrid(text: string, forcedDelimiter?: string): (string | number)[][] {
    const lines = text.split(/\r?\n/)
    const grid: (string | number)[][] = []

    for (const line of lines) {
        let delimiter = forcedDelimiter

        if (!delimiter) {
            // detekce oddělovače
            const tabCount = (line.match(/\t/g) || []).length
            const commaCount = (line.match(/,/g) || []).length
            const semicolonCount = (line.match(/;/g) || []).length

            delimiter = '\t'
            if (commaCount > tabCount && commaCount >= semicolonCount) delimiter = ','
            if (semicolonCount > tabCount && semicolonCount >= commaCount) delimiter = ';'
        }

        const cells = line.split(delimiter).map(cell => {
            const trimmed = cell.trim()
            // pokus o převod na číslo
            const num = parseFloat(trimmed.replace(',', '.'))
            if (!isNaN(num) && trimmed !== '') return num
            return trimmed
        })

        grid.push(cells)
    }

    return grid
}
