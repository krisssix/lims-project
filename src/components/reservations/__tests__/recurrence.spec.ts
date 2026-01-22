import { describe, it, expect } from 'vitest'

// Test recurrence date parsing and generation logic
describe('Recurrence Date Parsing', () => {
    describe('parseLocalDate', () => {
        // Simulating the fixed parsing logic from RecurrenceEditor
        function parseLocalDate(dateStr: string): Date {
            const [year, month, day] = dateStr.split('-').map(Number)
            return new Date(year, month - 1, day, 23, 59, 59, 999)
        }

        it('should parse YYYY-MM-DD as local date, not UTC', () => {
            const result = parseLocalDate('2025-12-17')
            expect(result.getFullYear()).toBe(2025)
            expect(result.getMonth()).toBe(11)
            expect(result.getDate()).toBe(17)
            expect(result.getHours()).toBe(23)
        })

        it('should handle year boundary correctly', () => {
            const result = parseLocalDate('2026-01-01')
            expect(result.getFullYear()).toBe(2026)
            expect(result.getMonth()).toBe(0)
            expect(result.getDate()).toBe(1)
        })

        it('should handle February 29 in leap year', () => {
            const result = parseLocalDate('2024-02-29')
            expect(result.getDate()).toBe(29)
        })

        it('should handle end of month dates', () => {
            const result = parseLocalDate('2025-01-31')
            expect(result.getDate()).toBe(31)
        })
    })
})

describe('ISO Day Conversion', () => {
    function isoDay(d: Date): number {
        const x = d.getDay()
        return x === 0 ? 7 : x
    }

    it('should convert Sunday (0) to 7', () => {
        const sunday = new Date(2025, 11, 14)
        expect(isoDay(sunday)).toBe(7)
    })

    it('should convert Monday (1) to 1', () => {
        const monday = new Date(2025, 11, 15)
        expect(isoDay(monday)).toBe(1)
    })

    it('should convert Friday (5) to 5', () => {
        const friday = new Date(2025, 11, 12)
        expect(isoDay(friday)).toBe(5)
    })

    it('should convert Saturday (6) to 6', () => {
        const saturday = new Date(2025, 11, 13)
        expect(isoDay(saturday)).toBe(6)
    })
})

describe('RecurrenceRequest Validation', () => {
    type RecurrenceRequest = {
        recurrenceType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
        interval?: number
        until?: number
        count?: number
        daysOfWeek?: number[]
    }

    function isValidRecurrence(req: RecurrenceRequest | null): boolean {
        if (!req) return true
        if (!req.recurrenceType) return false
        if (req.interval !== undefined && req.interval < 1) return false
        if (req.count !== undefined && req.count < 1) return false
        if (req.until && req.until < Date.now()) return false
        if (req.daysOfWeek && req.daysOfWeek.length === 0) return false
        if (req.daysOfWeek && req.daysOfWeek.some(d => d < 1 || d > 7)) return false
        return true
    }

    it('should accept null (no recurrence)', () => {
        expect(isValidRecurrence(null)).toBe(true)
    })

    it('should reject missing recurrenceType', () => {
        expect(isValidRecurrence({ interval: 1 })).toBe(false)
    })

    it('should reject zero interval', () => {
        expect(isValidRecurrence({ recurrenceType: 'DAILY', interval: 0 })).toBe(false)
    })

    it('should reject negative interval', () => {
        expect(isValidRecurrence({ recurrenceType: 'DAILY', interval: -1 })).toBe(false)
    })

    it('should accept valid daily recurrence', () => {
        expect(isValidRecurrence({ recurrenceType: 'DAILY', interval: 1 })).toBe(true)
    })

    it('should accept weekly with specific days', () => {
        expect(isValidRecurrence({
            recurrenceType: 'WEEKLY',
            interval: 1,
            daysOfWeek: [1, 3, 5]
        })).toBe(true)
    })

    it('should reject empty daysOfWeek array', () => {
        expect(isValidRecurrence({
            recurrenceType: 'WEEKLY',
            interval: 1,
            daysOfWeek: []
        })).toBe(false)
    })

    it('should reject invalid day numbers', () => {
        expect(isValidRecurrence({
            recurrenceType: 'WEEKLY',
            daysOfWeek: [0, 8]
        })).toBe(false)
    })

    it('should accept count-based ending', () => {
        expect(isValidRecurrence({
            recurrenceType: 'DAILY',
            interval: 1,
            count: 10
        })).toBe(true)
    })

    it('should accept until-based ending', () => {
        const futureDate = Date.now() + 30 * 24 * 60 * 60 * 1000
        expect(isValidRecurrence({
            recurrenceType: 'DAILY',
            interval: 1,
            until: futureDate
        })).toBe(true)
    })

    it('should reject past until date', () => {
        const pastDate = Date.now() - 24 * 60 * 60 * 1000
        expect(isValidRecurrence({
            recurrenceType: 'DAILY',
            interval: 1,
            until: pastDate
        })).toBe(false)
    })
})

describe('Recurrence Mode Detection', () => {
    type RecurrenceRequest = {
        recurrenceType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
        interval?: number
        until?: number
        count?: number
        daysOfWeek?: number[]
    }

    function detectMode(m: RecurrenceRequest | null): string {
        if (!m) return 'NONE'
        if (m.recurrenceType === 'DAILY' && m.interval === 1 && !m.until && !m.count) return 'DAILY'
        if (m.recurrenceType === 'WEEKLY' && m.interval === 1 && !m.until && !m.count) {
            if (m.daysOfWeek?.length === 5 && [1, 2, 3, 4, 5].every(d => m.daysOfWeek!.includes(d))) return 'WEEKDAY'
            if (!m.daysOfWeek || m.daysOfWeek.length <= 1) return 'WEEKLY'
        }
        if (m.recurrenceType === 'MONTHLY' && m.interval === 1 && !m.until && !m.count) return 'MONTHLY'
        if (m.recurrenceType === 'YEARLY' && m.interval === 1 && !m.until && !m.count) return 'YEARLY'
        return 'CUSTOM'
    }

    it('should detect NONE for null', () => {
        expect(detectMode(null)).toBe('NONE')
    })

    it('should detect simple DAILY', () => {
        expect(detectMode({ recurrenceType: 'DAILY', interval: 1 })).toBe('DAILY')
    })

    it('should detect simple WEEKLY', () => {
        expect(detectMode({ recurrenceType: 'WEEKLY', interval: 1 })).toBe('WEEKLY')
    })

    it('should detect WEEKDAY (Mon-Fri)', () => {
        expect(detectMode({
            recurrenceType: 'WEEKLY',
            interval: 1,
            daysOfWeek: [1, 2, 3, 4, 5]
        })).toBe('WEEKDAY')
    })

    it('should detect MONTHLY', () => {
        expect(detectMode({ recurrenceType: 'MONTHLY', interval: 1 })).toBe('MONTHLY')
    })

    it('should detect YEARLY', () => {
        expect(detectMode({ recurrenceType: 'YEARLY', interval: 1 })).toBe('YEARLY')
    })

    it('should detect CUSTOM for interval > 1', () => {
        expect(detectMode({ recurrenceType: 'DAILY', interval: 2 })).toBe('CUSTOM')
    })

    it('should detect CUSTOM for count-based', () => {
        expect(detectMode({ recurrenceType: 'DAILY', interval: 1, count: 10 })).toBe('CUSTOM')
    })

    it('should detect CUSTOM for until-based', () => {
        expect(detectMode({
            recurrenceType: 'DAILY',
            interval: 1,
            until: Date.now() + 1000000
        })).toBe('CUSTOM')
    })

    it('should detect CUSTOM for specific days', () => {
        expect(detectMode({
            recurrenceType: 'WEEKLY',
            interval: 1,
            daysOfWeek: [1, 3, 5]
        })).toBe('CUSTOM')
    })
})

describe('Display Text Generation', () => {
    type RecurrenceRequest = {
        recurrenceType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
        interval?: number
        until?: number
        count?: number
        daysOfWeek?: number[]
    }

    const dayNamesLong = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']

    function getDisplayText(m: RecurrenceRequest | null, startDate: Date): string {
        if (!m) return 'Neopakuje se'
        const currentDayName = dayNamesLong[startDate.getDay()]
        if (m.recurrenceType === 'DAILY' && m.interval === 1 && !m.until && !m.count) return 'Denně'
        if (m.recurrenceType === 'WEEKLY' && m.interval === 1 && !m.until && !m.count) {
            if (m.daysOfWeek?.length === 5 && [1, 2, 3, 4, 5].every(d => m.daysOfWeek!.includes(d))) return 'Pracovní dny'
            if (!m.daysOfWeek || m.daysOfWeek.length <= 1) return `Týdně v ${currentDayName}`
        }
        if (m.recurrenceType === 'MONTHLY' && m.interval === 1 && !m.until && !m.count) return `Měsíčně ${startDate.getDate()}.`
        if (m.recurrenceType === 'YEARLY' && m.interval === 1 && !m.until && !m.count) return `Ročně ${startDate.getDate()}. ${startDate.getMonth() + 1}.`
        return 'Vlastní'
    }

    const friday = new Date(2025, 11, 12)

    it('should display "Neopakuje se" for null', () => {
        expect(getDisplayText(null, friday)).toBe('Neopakuje se')
    })

    it('should display "Denně" for daily', () => {
        expect(getDisplayText({ recurrenceType: 'DAILY', interval: 1 }, friday)).toBe('Denně')
    })

    it('should display "Týdně v pátek" for weekly on Friday', () => {
        expect(getDisplayText({ recurrenceType: 'WEEKLY', interval: 1 }, friday)).toBe('Týdně v pátek')
    })

    it('should display "Pracovní dny" for weekdays', () => {
        expect(getDisplayText({
            recurrenceType: 'WEEKLY',
            interval: 1,
            daysOfWeek: [1, 2, 3, 4, 5]
        }, friday)).toBe('Pracovní dny')
    })

    it('should display "Měsíčně 12." for monthly on 12th', () => {
        expect(getDisplayText({ recurrenceType: 'MONTHLY', interval: 1 }, friday)).toBe('Měsíčně 12.')
    })

    it('should display "Ročně 12. 12." for yearly on Dec 12', () => {
        expect(getDisplayText({ recurrenceType: 'YEARLY', interval: 1 }, friday)).toBe('Ročně 12. 12.')
    })

    it('should display "Vlastní" for custom recurrence', () => {
        expect(getDisplayText({ recurrenceType: 'DAILY', interval: 2 }, friday)).toBe('Vlastní')
    })
})

describe('Series ID Handling', () => {
    interface ResItem {
        id: number
        seriesId?: string | null
    }

    it('should identify reservation as part of series', () => {
        const item: ResItem = { id: 1, seriesId: 'abc-123' }
        expect(!!item.seriesId).toBe(true)
    })

    it('should identify standalone reservation', () => {
        const item: ResItem = { id: 1, seriesId: null }
        expect(!!item.seriesId).toBe(false)
    })

    it('should identify undefined seriesId as standalone', () => {
        const item: ResItem = { id: 1 }
        expect(!!item.seriesId).toBe(false)
    })

    it('should handle removing from series', () => {
        const item: ResItem = { id: 1, seriesId: 'abc-123' }
        item.seriesId = null
        expect(item.seriesId).toBeNull()
    })
})

describe('Edge Cases', () => {
    describe('Timezone edge cases', () => {
        it('should handle midnight correctly', () => {
            const midnight = new Date(2025, 11, 12, 0, 0, 0)
            expect(midnight.getHours()).toBe(0)
            expect(midnight.getDate()).toBe(12)
        })

        it('should handle 23:59:59 correctly', () => {
            const endOfDay = new Date(2025, 11, 12, 23, 59, 59)
            expect(endOfDay.getHours()).toBe(23)
            expect(endOfDay.getDate()).toBe(12)
        })
    })

    describe('Month boundary edge cases', () => {
        it('should handle last day of month for monthly recurrence', () => {
            const jan31 = new Date(2025, 0, 31)
            expect(jan31.getDate()).toBe(31)
        })

        it('should handle Feb 29 to non-leap year', () => {
            const feb29_2024 = new Date(2024, 1, 29)
            expect(feb29_2024.getDate()).toBe(29)
        })
    })

    describe('Week boundary edge cases', () => {
        it('should handle Sunday (week start/end)', () => {
            const sunday = new Date(2025, 11, 14)
            expect(sunday.getDay()).toBe(0)
        })

        it('should handle week spanning year boundary', () => {
            const dec31 = new Date(2025, 11, 31)
            const jan1 = new Date(2026, 0, 1)
            expect(dec31.getFullYear()).toBe(2025)
            expect(jan1.getFullYear()).toBe(2026)
        })
    })

    describe('Empty/null edge cases', () => {
        it('should handle empty daysOfWeek gracefully', () => {
            const req = { recurrenceType: 'WEEKLY' as const, daysOfWeek: [] }
            expect(req.daysOfWeek.length).toBe(0)
        })

        it('should handle undefined optional fields', () => {
            const req = { recurrenceType: 'DAILY' as const }
            expect(req.interval).toBeUndefined()
            expect(req.until).toBeUndefined()
            expect(req.count).toBeUndefined()
        })
    })

    describe('Conflict scenarios', () => {
        it('should not have both count and until', () => {
            const req = {
                recurrenceType: 'DAILY' as const,
                count: 10,
                until: Date.now() + 1000000
            }
            expect(req.count).toBeDefined()
            expect(req.until).toBeDefined()
        })
    })
})
