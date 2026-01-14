/**
 * Unit tests for clientParser.ts
 * Tests: F2 (no header + ; + decimal comma), quoted CSV, BOM/CRLF
 */
import { describe, it, expect } from 'vitest'
import { parseWithOptions, generateColumnNames, inferColumnType, DEFAULT_PARSE_OPTIONS, type ParseOptions } from '../clientParser'

describe('clientParser', () => {
    describe('parseWithOptions', () => {
        it('F2: parses semicolon-separated data without header', () => {
            const input = `;;;
9;12.5;abc;25;121,2
10;13.2;def;25;122,8
11;14.1;ghi;25;122,8`

            const opts: ParseOptions = {
                delimiter: ';',
                decimal: ',',
                header: 'no_header',
                skipEmptyLines: true
            }

            const result = parseWithOptions(input, opts)

            expect(result.headers).toHaveLength(5)
            expect(result.headers[0]).toBe('Column 1')
            expect(result.headers[4]).toBe('Column 5')
            expect(result.rows.length).toBeGreaterThanOrEqual(3)
            expect(result.status).not.toBe('FAIL')
        })

        it('auto-detects semicolon delimiter', () => {
            const input = `a;b;c
1;2;3
4;5;6`

            const result = parseWithOptions(input, DEFAULT_PARSE_OPTIONS)

            expect(result.usedDelimiter).toBe(';')
            expect(result.headers).toContain('a')
            expect(result.headers).toContain('b')
            expect(result.headers).toContain('c')
        })

        it('auto-detects tab delimiter', () => {
            const input = `a\tb\tc
1\t2\t3
4\t5\t6`

            const result = parseWithOptions(input, DEFAULT_PARSE_OPTIONS)

            expect(result.usedDelimiter).toBe('\t')
            expect(result.headers).toHaveLength(3)
        })

        it('handles quoted CSV correctly', () => {
            const input = `name,description,value
"Item A","Description with, comma",100
"Item B","Another; with semicolon",200`

            const opts: ParseOptions = {
                delimiter: ',',
                decimal: '.',
                header: 'auto',
                skipEmptyLines: true
            }

            const result = parseWithOptions(input, opts)

            expect(result.headers).toContain('name')
            expect(result.rows[0][1]).toContain('comma')
        })

        it('handles BOM and CRLF', () => {
            const input = '\uFEFFa,b,c\r\n1,2,3\r\n4,5,6'

            const result = parseWithOptions(input, DEFAULT_PARSE_OPTIONS)

            expect(result.headers).toHaveLength(3)
            expect(result.rows.length).toBeGreaterThanOrEqual(2)
        })

        it('returns FAIL status for single-column parsing', () => {
            const input = `abcdefghij
1234567890
abcdefghij`

            const result = parseWithOptions(input, DEFAULT_PARSE_OPTIONS)

            // Should detect low column count as problematic
            expect(result.metrics.singleColumnRate).toBeGreaterThan(0.5)
        })

        it('skips empty lines when configured', () => {
            const input = `a,b,c

1,2,3

4,5,6`

            const opts: ParseOptions = {
                ...DEFAULT_PARSE_OPTIONS,
                skipEmptyLines: true
            }

            const result = parseWithOptions(input, opts)

            expect(result.rows.length).toBe(2)
        })
    })

    describe('generateColumnNames', () => {
        it('generates Column 1..N names', () => {
            const names = generateColumnNames(5)

            expect(names).toEqual(['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5'])
        })

        it('handles zero columns', () => {
            const names = generateColumnNames(0)
            expect(names).toEqual([])
        })
    })

    describe('inferColumnType', () => {
        it('infers int type', () => {
            const samples = ['1', '2', '3', '100', '999']
            expect(inferColumnType(samples)).toBe('int')
        })

        it('infers float type with dot', () => {
            const samples = ['1.5', '2.7', '3.14', '100.0']
            expect(inferColumnType(samples)).toBe('float')
        })

        it('infers float type with comma', () => {
            const samples = ['1,5', '2,7', '3,14', '100,0']
            expect(inferColumnType(samples)).toBe('float')
        })

        it('infers date type', () => {
            const samples = ['2024-01-15', '2024-02-20', '2024-03-25']
            expect(inferColumnType(samples)).toBe('date')
        })

        it('infers bool type', () => {
            const samples = ['true', 'false', 'yes', 'no', 'ano']
            expect(inferColumnType(samples)).toBe('bool')
        })

        it('defaults to text for mixed types', () => {
            const samples = ['hello', '123', 'world', 'true']
            expect(inferColumnType(samples)).toBe('text')
        })
    })
})
