/**
 * File upload service for measurement files (images, documents, etc.)
 */
import { auth } from '@/stores/auth'
import { config } from '@/config'
import axios from 'axios'
import { toRaw } from 'vue'

/**
 * Maximum file size in bytes (50MB - should match backend configuration)
 * Update this if you change spring.servlet.multipart.max-file-size
 */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB
export const MAX_FILE_SIZE_MB = 50

/**
 * Formats file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Validates file size before upload
 */
export function validateFileSize(file: File): { valid: boolean; error?: string } {
    if (file.size > MAX_FILE_SIZE_BYTES) {
        return {
            valid: false,
            error: `Soubor "${file.name}" je příliš velký (${formatFileSize(file.size)}). Maximální velikost je ${MAX_FILE_SIZE_MB} MB.`
        }
    }
    return { valid: true }
}

export interface UploadResult {
    success: boolean
    fileUrl: string
    fileName: string
    fileSize: number
    error?: string
}

/**
 * Uploads a single file to the server.
 * Returns the server URL of the uploaded file.
 */
export async function uploadFile(file: File): Promise<UploadResult> {
    // Validate file size before upload
    const sizeValidation = validateFileSize(file)
    if (!sizeValidation.valid) {
        return {
            success: false,
            fileUrl: '',
            fileName: file.name,
            fileSize: file.size,
            error: sizeValidation.error
        }
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
        // Try renew
        try { await auth.renewToken() } catch (err) { console.warn('Token update failed', err) }

        const headers: Record<string, string> = {}
        if (auth.isAuthenticated && auth.token.value) {
            headers['Authorization'] = `Bearer ${auth.token.value}`
        }

        const response = await axios.post(
            `${config.serverUrl}files/upload`,
            formData,
            {
                headers: {
                    ...headers,
                    'Content-Type': 'multipart/form-data'
                },
                validateStatus: () => true
            }
        )

        if (response.status >= 200 && response.status < 300) {
            // Backend returns: { data: { fileUrl, originalName } }
            const responseData = response.data as {
                data?: { fileUrl?: string; originalName?: string }
                fileUrl?: string
                url?: string
                path?: string
            }
            // Try nested data.fileUrl first (new API format), then fallback to flat structure
            const fileUrl = responseData.data?.fileUrl || responseData.fileUrl || responseData.url || responseData.path || ''

            return {
                success: true,
                fileUrl,
                fileName: responseData.data?.originalName || file.name,
                fileSize: file.size
            }
        } else if (response.status === 413) {
            // Handle 413 Content Too Large specifically
            return {
                success: false,
                fileUrl: '',
                fileName: file.name,
                fileSize: file.size,
                error: `Soubor "${file.name}" je příliš velký (${formatFileSize(file.size)}). Server nepřijímá soubory větší než ${MAX_FILE_SIZE_MB} MB.`
            }
        } else {
            return {
                success: false,
                fileUrl: '',
                fileName: file.name,
                fileSize: file.size,
                error: `Nahrávání selhalo (status ${response.status})`
            }
        }
    } catch (err) {
        return {
            success: false,
            fileUrl: '',
            fileName: file.name,
            fileSize: file.size,
            error: err instanceof Error ? err.message : 'Neznámá chyba při nahrávání'
        }
    }
}

/**
 * Uploads multiple files in parallel.
 * Returns a map of original filename to server URL.
 */
export async function uploadFiles(files: File[]): Promise<Map<string, UploadResult>> {
    const results = new Map<string, UploadResult>()

    const uploads = files.map(async (file) => {
        const result = await uploadFile(file)
        return { file, result }
    })

    const completed = await Promise.all(uploads)
    for (const { file, result } of completed) {
        results.set(file.name, result)
    }

    return results
}

/**
 * Extracts all File objects from records' file fields.
 * Returns array of { fieldKey, file } for later mapping.
 */
export function extractFilesFromRecords(
    records: Array<{ recordIndex: number; fields: Array<{ name: string; type: string; value: unknown; blockIndex?: number | null }> }>
): Array<{ recordIndex: number; fieldName: string; blockIndex: number; file: File }> {
    const files: Array<{ recordIndex: number; fieldName: string; blockIndex: number; file: File }> = []

    for (const record of records) {
        for (const field of record.fields) {
            if (field.type === 'file' && toRaw(field.value) instanceof File) {
                files.push({
                    recordIndex: record.recordIndex,
                    fieldName: field.name,
                    blockIndex: field.blockIndex ?? 1,
                    file: toRaw(field.value) as File
                })
            }
        }
    }

    return files
}
