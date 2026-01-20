/**
 * Composable for measurement import functionality
 * Extracted from MeasurementCreateDialog.vue for better code organization
 */
import { ref, computed } from 'vue'
import {
    parseImportedMeasurementFile,
    checkTemplateCompatibility,
    type ImportedFileStructure,
    type TemplateLike
} from '@/utils/import/importCompatibility'
import type { MappingModel } from '@/utils/import/importMapping'

/**
 * Creates import-related state and basic functions
 * Complex functions that depend on template/records stay in parent component
 */
export function useMeasurementImport() {
    // === State ===
    const importedFile = ref<File | null>(null)
    const importedStructure = ref<ImportedFileStructure | null>(null)
    const importCompatibility = ref<{ compatible: boolean; reasons: string[] } | null>(null)
    const importBusy = ref(false)
    const importError = ref<string | null>(null)
    const importRowOffset = ref(0)

    // Mapping wizard state
    const mappingOpen = ref(false)
    const mappingModel = ref<MappingModel | null>(null)

    // === Computed ===
    const isImportCompatible = computed<boolean>(() =>
        importCompatibility.value?.compatible === true
    )

    // === Functions ===

    /**
     * Handle file selection from ImportPanel
     */
    function onImportFilePicked(f: File | null): void {
        importedFile.value = f
        importedStructure.value = null
        importCompatibility.value = null
        importError.value = null
    }

    /**
     * Reset all import state
     */
    function resetImport(): void {
        importedFile.value = null
        importedStructure.value = null
        importCompatibility.value = null
        importError.value = null
        importRowOffset.value = 0
        mappingOpen.value = false
        mappingModel.value = null
    }

    /**
     * Parse file and get structure (without template compatibility check)
     */
    async function parseImportFile(file: File, options: Record<string, unknown> = {}): Promise<ImportedFileStructure | null> {
        importBusy.value = true
        importError.value = null

        try {
            const structure = await parseImportedMeasurementFile(file, options)
            importedStructure.value = structure
            return structure
        } catch (e) {
            importError.value = e instanceof Error ? e.message : 'Neznámá chyba při parsování souboru.'
            return null
        } finally {
            importBusy.value = false
        }
    }

    /**
     * Check compatibility with a template
     */
    function checkCompatibility(template: TemplateLike): void {
        if (!importedStructure.value) return

        const compat = checkTemplateCompatibility(template, importedStructure.value)
        importCompatibility.value = { compatible: compat.compatible, reasons: compat.reasons }
    }

    return {
        // State (reactive)
        importedFile,
        importedStructure,
        importCompatibility,
        importBusy,
        importError,
        importRowOffset,
        mappingOpen,
        mappingModel,

        // Computed
        isImportCompatible,

        // Functions
        onImportFilePicked,
        resetImport,
        parseImportFile,
        checkCompatibility
    }
}
