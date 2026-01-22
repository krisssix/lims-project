/**
 * Unit tests for vectorDetection.ts
 * Tests: F5 (vector cells with decimal comma and exponential notation)
 */
import { describe, it, expect } from 'vitest'
import { isVectorCell, parseVectorCell, detectVectorColumns, findPairedVectors } from '../vectorDetection'

describe('vectorDetection', () => {
    describe('isVectorCell', () => {
        it('detects vector cell with 5+ numbers', () => {
            const value = '0.4 0.463 0.536 0.621 0.719'
            expect(isVectorCell(value)).toBe(true)
        })

        it('detects vector with comma decimal separator', () => {
            const value = '0,4 0,463 0,536 0,621 0,719'
            expect(isVectorCell(value)).toBe(true)
        })

        it('detects vector with exponential notation', () => {
            const value = '1.5e+03 2.3e-02 4.5E+01 6.7E-03 8.9e+00'
            expect(isVectorCell(value)).toBe(true)
        })

        it('detects vector with negative numbers', () => {
            const value = '-0.5 0.463 -0.536 0.621 -0.719'
            expect(isVectorCell(value)).toBe(true)
        })

        it('rejects non-vector cell (too few numbers)', () => {
            const value = '1.5 2.3 3.4'
            expect(isVectorCell(value)).toBe(false)
        })

        it('rejects non-vector cell (text)', () => {
            const value = 'hello world'
            expect(isVectorCell(value)).toBe(false)
        })

        it('rejects empty string', () => {
            expect(isVectorCell('')).toBe(false)
        })
    })

    describe('parseVectorCell', () => {
        it('parses vector with dot decimal', () => {
            const result = parseVectorCell('0.4 0.463 0.536 0.621 0.719')

            expect(result.ok).toBe(true)
            expect(result.values).toHaveLength(5)
            expect(result.values[0]).toBeCloseTo(0.4)
            expect(result.values[1]).toBeCloseTo(0.463)
        })

        it('parses vector with comma decimal', () => {
            const result = parseVectorCell('0,4 0,463 0,536 0,621 0,719')

            expect(result.ok).toBe(true)
            expect(result.values).toHaveLength(5)
            expect(result.values[0]).toBeCloseTo(0.4)
        })

        it('parses vector with exponential notation', () => {
            const result = parseVectorCell('1.5e+03 2.3e-02 4.5E+01 6.7E-03 8.9e+00')

            expect(result.ok).toBe(true)
            expect(result.values[0]).toBeCloseTo(1500)
            expect(result.values[1]).toBeCloseTo(0.023)
        })

        it('returns ok=false for too few values', () => {
            const result = parseVectorCell('1 2 3')
            expect(result.ok).toBe(false)
        })

        it('never throws', () => {
            expect(() => parseVectorCell(null as any)).not.toThrow()
            expect(() => parseVectorCell(undefined as any)).not.toThrow()
            expect(() => parseVectorCell(123 as any)).not.toThrow()
        })
    })

    describe('detectVectorColumns', () => {
        it('detects vector columns in data', () => {
            const rows = [
                ['1', 'Example 1', '25', '0.4 0.463 0.536 0.621 0.719', '0 0 0.138 1.13 5.53'],
                ['2', 'Example 2', '25', '0.5 0.563 0.636 0.721 0.819', '0.1 0.2 0.3 0.4 0.5']
            ]

            const vectors = detectVectorColumns(rows)

            expect(vectors.length).toBe(2) // columns 3 and 4
            expect(vectors[0].columnIndex).toBe(3)
            expect(vectors[1].columnIndex).toBe(4)
        })

        it('returns empty for data without vectors', () => {
            const rows = [
                ['1', 'Example 1', '25', 'abc'],
                ['2', 'Example 2', '30', 'def']
            ]

            const vectors = detectVectorColumns(rows)
            expect(vectors).toHaveLength(0)
        })
    })

    describe('findPairedVectors', () => {
        it('finds paired vectors with same length', () => {
            const vectors = [
                { columnIndex: 3, vectorLength: 5, samples: [[0.4, 0.5, 0.6, 0.7, 0.8]] },
                { columnIndex: 4, vectorLength: 5, samples: [[0, 0, 0.1, 1.1, 5.5]] }
            ]

            const pair = findPairedVectors(vectors)

            expect(pair).toEqual([3, 4])
        })

        it('returns null for single vector', () => {
            const vectors = [
                { columnIndex: 3, vectorLength: 5, samples: [[0.4, 0.5, 0.6, 0.7, 0.8]] }
            ]

            expect(findPairedVectors(vectors)).toBeNull()
        })

        it('returns null for empty array', () => {
            expect(findPairedVectors([])).toBeNull()
        })
    })
})
