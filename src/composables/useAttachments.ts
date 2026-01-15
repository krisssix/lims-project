import { ref } from 'vue'
import { auth } from '@/stores/auth'
import { config } from '@/config'

const API_BASE_URL = config.serverUrl

export interface FileAttachment {
    id: number
    storageKey: string
    originalName: string
    contentType: string
    sizeBytes: number
    createdAt: number
    downloadUrl: string
    measurementId: number | null
    uploadedByUsername: string | null
}

interface ApiResponse<T> {
    content: T
}

interface ApiListResponse<T> {
    items: T[]
}

/**
 * Allowed MIME types for file uploads.
 */
export const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain'
]

/**
 * Maximum file size in bytes (50 MB).
 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024

/**
 * File type display configuration.
 */
export const FILE_TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
    'application/pdf': { icon: 'mdi-file-pdf-box', color: 'red' },
    'image/png': { icon: 'mdi-file-image', color: 'green' },
    'image/jpeg': { icon: 'mdi-file-image', color: 'green' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: 'mdi-file-excel', color: 'green-darken-2' },
    'application/vnd.ms-excel': { icon: 'mdi-file-excel', color: 'green-darken-2' },
    'text/csv': { icon: 'mdi-file-delimited', color: 'blue' },
    'text/plain': { icon: 'mdi-file-document-outline', color: 'grey' }
}

/**
 * Validates file MIME type.
 */
export function validateMimeType(contentType: string | undefined): boolean {
    if (!contentType) return false
    return ALLOWED_MIME_TYPES.includes(contentType.toLowerCase())
}

/**
 * Validates file size.
 */
export function validateFileSize(size: number): boolean {
    return size <= MAX_FILE_SIZE
}

/**
 * Formats file size for display.
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * Gets file icon configuration based on MIME type.
 */
export function getFileTypeConfig(contentType: string | undefined): { icon: string; color: string } {
    if (!contentType) return { icon: 'mdi-file-question', color: 'grey' }
    return FILE_TYPE_CONFIG[contentType] ?? { icon: 'mdi-file', color: 'grey' }
}

/**
 * Checks if file is an image (for preview).
 */
export function isImageType(contentType: string | undefined): boolean {
    if (!contentType) return false
    return contentType.startsWith('image/')
}

/**
 * Composable for managing file attachments.
 */
export function useAttachments() {
    const loading = ref(false)
    const error = ref<string | null>(null)
    const attachments = ref<FileAttachment[]>([])

    /**
     * Fetches attachments for a measurement.
     */
    async function fetchAttachments(measurementId: number): Promise<FileAttachment[]> {
        loading.value = true
        error.value = null

        try {
            const token = auth.getToken()
            const response = await fetch(`${API_BASE_URL}measurements/${measurementId}/attachments`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            })

            if (!response.ok) {
                throw new Error(`Failed to fetch attachments: ${response.statusText}`)
            }

            const data = await response.json() as ApiListResponse<FileAttachment>
            attachments.value = data.items ?? []
            return attachments.value
        } catch (e) {
            error.value = e instanceof Error ? e.message : 'Unknown error'
            throw e
        } finally {
            loading.value = false
        }
    }

    /**
     * Uploads a file to a measurement.
     * @param measurementId - The measurement to attach the file to
     * @param file - The file to upload
     * @param onProgress - Progress callback (0-100)
     */
    async function uploadFile(
        measurementId: number,
        file: File,
        onProgress?: (percent: number) => void
    ): Promise<FileAttachment> {
        // Client-side validation
        if (!validateMimeType(file.type)) {
            throw new Error('Nepodporovaný typ souboru. Povolené typy: PDF, PNG, JPG, XLSX, CSV, TXT')
        }
        if (!validateFileSize(file.size)) {
            throw new Error('Soubor je příliš velký. Maximální velikost je 50 MB')
        }

        loading.value = true
        error.value = null

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            const formData = new FormData()
            formData.append('file', file)

            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable && onProgress) {
                    const percent = Math.round((event.loaded / event.total) * 100)
                    onProgress(percent)
                }
            })

            xhr.addEventListener('load', async () => {
                loading.value = false
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText) as ApiResponse<FileAttachment>
                        const uploaded = data.content
                        attachments.value.push(uploaded)
                        resolve(uploaded)
                    } catch {
                        reject(new Error('Failed to parse response'))
                    }
                } else {
                    try {
                        const errorData = JSON.parse(xhr.responseText)
                        reject(new Error(errorData.message || 'Upload failed'))
                    } catch {
                        reject(new Error(`Upload failed: ${xhr.statusText}`))
                    }
                }
            })

            xhr.addEventListener('error', () => {
                loading.value = false
                reject(new Error('Network error during upload'))
            })

            xhr.addEventListener('abort', () => {
                loading.value = false
                reject(new Error('Upload cancelled'))
            })

            // Start upload
            const token = auth.getToken()
            if (!token) {
                loading.value = false
                reject(new Error('Chybí autentizační token. Přihlaste se prosím znovu.'))
                return
            }
            xhr.open('POST', `${API_BASE_URL}measurements/${measurementId}/attachments`)
            xhr.setRequestHeader('Authorization', `Bearer ${token}`)
            xhr.send(formData)
        })
    }

    /**
     * Deletes an attachment.
     */
    async function deleteAttachment(fileId: number): Promise<void> {
        loading.value = true
        error.value = null

        try {
            const token = auth.getToken()
            const response = await fetch(`${API_BASE_URL}files/${fileId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })

            if (!response.ok && response.status !== 204) {
                throw new Error(`Failed to delete file: ${response.statusText}`)
            }

            // Remove from local list
            attachments.value = attachments.value.filter(a => a.id !== fileId)
        } catch (e) {
            error.value = e instanceof Error ? e.message : 'Unknown error'
            throw e
        } finally {
            loading.value = false
        }
    }

    /**
     * Gets the download URL for a file.
     */
    function getDownloadUrl(attachment: FileAttachment): string {
        return `${API_BASE_URL}${attachment.downloadUrl}`
    }

    /**
     * Gets the view URL for a file (inline display).
     */
    function getViewUrl(attachment: FileAttachment): string {
        // Replace /download with /view for inline display
        const viewPath = attachment.downloadUrl.replace('/download', '/view')
        return `${API_BASE_URL}${viewPath}`
    }

    return {
        loading,
        error,
        attachments,
        fetchAttachments,
        uploadFile,
        deleteAttachment,
        getDownloadUrl,
        getViewUrl,
        // Utility exports
        validateMimeType,
        validateFileSize,
        formatFileSize,
        getFileTypeConfig,
        isImageType
    }
}
