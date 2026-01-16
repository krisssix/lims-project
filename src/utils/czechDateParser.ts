/**
 * parser pro česká data typu "4. října 2022 16:58:51" nebo "pátek 19. září 2025 12:18:32"
 */

// slovník českých měsíců (všechny varianty)
const CZECH_MONTHS: Record<string, number> = {
    // genitiv (nejčastější v datech)
    'ledna': 1, 'února': 2, 'března': 3, 'dubna': 4, 'května': 5, 'června': 6,
    'července': 7, 'srpna': 8, 'září': 9, 'října': 10, 'listopadu': 11, 'prosince': 12,
    // nominativ
    'leden': 1, 'únor': 2, 'březen': 3, 'duben': 4, 'květen': 5, 'červen': 6,
    'červenec': 7, 'srpen': 8, 'zaří': 9, 'říjen': 10, 'listopad': 11, 'prosinec': 12,
    // zkratky
    'led': 1, 'úno': 2, 'bře': 3, 'dub': 4, 'kvě': 5, 'čvn': 6,
    'čvc': 7, 'srp': 8, 'zář': 9, 'říj': 10, 'lis': 11, 'pro': 12,
}

// české dny v týdnu (pro odstranění z řetězce)
const CZECH_DAYS = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle']

export interface ParsedCzechDate {
    date: Date | null
    year: number | null
    month: number | null
    day: number | null
    hours: number | null
    minutes: number | null
    seconds: number | null
    original: string
    success: boolean
}

/**
 * parsuje český datumový řetězec do date objektu
 * podporované formáty:
 * - "4. října 2022 16:58:51"
 * - "pátek 19. září 2025 12:18:32"
 * - "19/09/2025 12:18:32" (fallback na standardní formát)
 * - "4/10/22 12:18:32"
 */
export function parseCzechDate(input: string): ParsedCzechDate {
    const original = input.trim()
    const result: ParsedCzechDate = {
        date: null,
        year: null,
        month: null,
        day: null,
        hours: null,
        minutes: null,
        seconds: null,
        original,
        success: false
    }

    if (!original) return result

    // odstranit den v týdnu (pokud je přítomen)
    let cleaned = original.toLowerCase()
    for (const day of CZECH_DAYS) {
        cleaned = cleaned.replace(day, '').trim()
    }

    // pokus 1: český formát "d. měsíc yyyy hh:mm:ss"
    const czechPattern = /(\d{1,2})\.\s*([a-záíéúůýčřšžňďť]+)\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i
    const czechMatch = cleaned.match(czechPattern)

    if (czechMatch) {
        const day = parseInt(czechMatch[1], 10)
        const monthName = czechMatch[2].toLowerCase()
        const year = parseInt(czechMatch[3], 10)
        const hours = czechMatch[4] ? parseInt(czechMatch[4], 10) : 0
        const minutes = czechMatch[5] ? parseInt(czechMatch[5], 10) : 0
        const seconds = czechMatch[6] ? parseInt(czechMatch[6], 10) : 0

        const month = CZECH_MONTHS[monthName]
        if (month) {
            const fullYear = year < 100 ? (year < 50 ? 2000 + year : 1900 + year) : year

            result.day = day
            result.month = month
            result.year = fullYear
            result.hours = hours
            result.minutes = minutes
            result.seconds = seconds
            result.date = new Date(fullYear, month - 1, day, hours, minutes, seconds)
            result.success = !isNaN(result.date.getTime())
            return result
        }
    }

    // pokus 2: formát "d/m/yyyy hh:mm:ss" nebo "d/m/yy hh:mm:ss"
    const slashPattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
    const slashMatch = cleaned.match(slashPattern)

    if (slashMatch) {
        const day = parseInt(slashMatch[1], 10)
        const month = parseInt(slashMatch[2], 10)
        const year = parseInt(slashMatch[3], 10)
        const hours = slashMatch[4] ? parseInt(slashMatch[4], 10) : 0
        const minutes = slashMatch[5] ? parseInt(slashMatch[5], 10) : 0
        const seconds = slashMatch[6] ? parseInt(slashMatch[6], 10) : 0

        const fullYear = year < 100 ? (year < 50 ? 2000 + year : 1900 + year) : year

        result.day = day
        result.month = month
        result.year = fullYear
        result.hours = hours
        result.minutes = minutes
        result.seconds = seconds
        result.date = new Date(fullYear, month - 1, day, hours, minutes, seconds)
        result.success = !isNaN(result.date.getTime())
        return result
    }

    // pokus 3: iso formát jako fallback
    const iso = Date.parse(original)
    if (!isNaN(iso)) {
        result.date = new Date(iso)
        result.year = result.date.getFullYear()
        result.month = result.date.getMonth() + 1
        result.day = result.date.getDate()
        result.hours = result.date.getHours()
        result.minutes = result.date.getMinutes()
        result.seconds = result.date.getSeconds()
        result.success = true
    }

    return result
}

/**
 * Konvertuje český datum string na epoch milliseconds
 */
export function czechDateToEpoch(input: string): number | null {
    const parsed = parseCzechDate(input)
    return parsed.success && parsed.date ? parsed.date.getTime() : null
}

/**
 * formátuje date na český formát "d. m. yyyy hh:mm"
 */
export function formatCzechDate(date: Date | number | null, includeTime = true): string {
    if (!date) return ''
    const d = typeof date === 'number' ? new Date(date) : date
    if (isNaN(d.getTime())) return ''

    const day = d.getDate()
    const month = d.getMonth() + 1
    const year = d.getFullYear()

    if (!includeTime) {
        return `${day}. ${month}. ${year}`
    }

    const hours = d.getHours().toString().padStart(2, '0')
    const minutes = d.getMinutes().toString().padStart(2, '0')
    return `${day}. ${month}. ${year} ${hours}:${minutes}`
}
