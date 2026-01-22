/**
 * Composable for measurement records management
 * Extracted from MeasurementCreateDialog.vue for better code organization
 */
import { ref, computed, nextTick, type Ref, type ComputedRef } from 'vue'
import {
    newRecordFromTemplateFields,
    duplicateRecord as duplicateRecordHelper,
    type MeasurementRecord,
    type RecordField
} from '@/utils/measurement-record-helpers'
import type { ValueType } from '@/types/measurement-ui'

export interface TemplateField {
    name: string
    type: ValueType
    required: boolean
    blockIndex?: number
    blockTitle?: string
    orderIndex: number
}

/**
 * Creates records-related state and functions
 */
export function useMeasurementRecords() {
    // === State ===
    const records = ref<MeasurementRecord[]>([])
    const currentRecordIndex = ref<number>(1)
    const selectedRecordIndexes = ref<Set<number>>(new Set())
    const currentBlockIndex = ref<number>(0)

    // Validation state
    const visitedFields = ref<Set<string>>(new Set())
    const touchedFields = ref<Set<string>>(new Set())

    // === Computed ===
    const sortedRecordIndexes = computed(() =>
        records.value.map(r => r.recordIndex).sort((a, b) => a - b)
    )

    const currentRecord = computed(() =>
        records.value.find(r => r.recordIndex === currentRecordIndex.value) ?? null
    )

    const recordOptions = computed(() =>
        records.value.map(r => ({
            title: `Záznam ${r.recordIndex}`,
            value: r.recordIndex
        }))
    )

    // === Functions ===

    /**
     * Add a new empty record
     */
    function addRecord(templateFields: TemplateField[]): void {
        const nextIdx = records.value.length
            ? Math.max(...records.value.map(r => r.recordIndex)) + 1
            : 1
        const rec = newRecordFromTemplateFields(nextIdx, templateFields)
        records.value.push(rec)
        currentRecordIndex.value = rec.recordIndex
        currentBlockIndex.value = 0
        selectedRecordIndexes.value.add(rec.recordIndex)
        clearValidation()
        focusFirstField()
    }

    /**
     * Duplicate the current record
     */
    function duplicateCurrentRecord(): void {
        const curr = records.value.find(r => r.recordIndex === currentRecordIndex.value)
        if (!curr) return

        const nextIdx = Math.max(...records.value.map(r => r.recordIndex)) + 1
        const dup = duplicateRecordHelper(curr, nextIdx)
        records.value.push(dup)
        currentRecordIndex.value = dup.recordIndex
        currentBlockIndex.value = 0
        selectedRecordIndexes.value.add(dup.recordIndex)
        clearValidation()
        focusFirstField()
    }

    /**
     * Delete the current record
     */
    function deleteCurrentRecord(): void {
        if (records.value.length <= 1) return

        const idx = records.value.findIndex(r => r.recordIndex === currentRecordIndex.value)
        if (idx === -1) return

        const sorted = sortedRecordIndexes.value
        const posInSorted = sorted.indexOf(currentRecordIndex.value)

        // Remove the record
        records.value.splice(idx, 1)

        // Select next record
        const newSorted = records.value.map(r => r.recordIndex).sort((a, b) => a - b)
        if (posInSorted < newSorted.length) {
            currentRecordIndex.value = newSorted[posInSorted]!
        } else {
            currentRecordIndex.value = newSorted[newSorted.length - 1]!
        }

        currentBlockIndex.value = 0
        if (!selectedRecordIndexes.value.size) {
            selectedRecordIndexes.value = new Set(records.value.map(r => r.recordIndex))
        }
        clearValidation()
    }

    /**
     * Navigate to previous record
     */
    function toPrevRecord(): void {
        const sorted = sortedRecordIndexes.value
        const pos = sorted.indexOf(currentRecordIndex.value)
        if (pos > 0) {
            currentRecordIndex.value = sorted[pos - 1]!
            currentBlockIndex.value = 0
            clearValidation()
        }
    }

    /**
     * Navigate to next record
     */
    function toNextRecord(): void {
        const sorted = sortedRecordIndexes.value
        const pos = sorted.indexOf(currentRecordIndex.value)
        if (pos < sorted.length - 1) {
            currentRecordIndex.value = sorted[pos + 1]!
            currentBlockIndex.value = 0
            clearValidation()
        }
    }

    /**
     * Toggle record selection for export
     */
    function toggleRecordSelection(idx: number): void {
        if (selectedRecordIndexes.value.has(idx)) {
            selectedRecordIndexes.value.delete(idx)
        } else {
            selectedRecordIndexes.value.add(idx)
        }
        selectedRecordIndexes.value = new Set(selectedRecordIndexes.value) // trigger reactivity
    }

    /**
     * Select a specific record
     */
    function selectRecord(idx: number): void {
        currentRecordIndex.value = idx
        currentBlockIndex.value = 0
    }

    /**
     * Clear validation state
     */
    function clearValidation(): void {
        visitedFields.value.clear()
        touchedFields.value.clear()
    }

    /**
     * Reset all records state
     */
    function resetRecords(): void {
        records.value = []
        currentRecordIndex.value = 1
        currentBlockIndex.value = 0
        selectedRecordIndexes.value = new Set()
        clearValidation()
    }

    /**
     * Initialize with template fields
     */
    function initializeRecords(templateFields: TemplateField[]): void {
        if (records.value.length === 0) {
            const rec = newRecordFromTemplateFields(1, templateFields)
            records.value = [rec]
            currentRecordIndex.value = 1
            currentBlockIndex.value = 0
            selectedRecordIndexes.value = new Set([1])
            clearValidation()
        }
    }

    // Helper
    function focusFirstField(): void {
        nextTick(() => {
            const el = document.querySelector<HTMLElement>('[data-field-input]')
            el?.focus()
        })
    }

    return {
        // State
        records,
        currentRecordIndex,
        selectedRecordIndexes,
        currentBlockIndex,
        visitedFields,
        touchedFields,

        // Computed
        sortedRecordIndexes,
        currentRecord,
        recordOptions,

        // Functions
        addRecord,
        duplicateCurrentRecord,
        deleteCurrentRecord,
        toPrevRecord,
        toNextRecord,
        toggleRecordSelection,
        selectRecord,
        clearValidation,
        resetRecords,
        initializeRecords,
        focusFirstField
    }
}
