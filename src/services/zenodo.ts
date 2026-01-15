/**
 * Zenodo API Service for publishing datasets
 * Documentation: https://developers.zenodo.org/
 */

// Storage key for encrypted token
const ZENODO_TOKEN_KEY = 'zenodo_access_token'

export interface ZenodoConfig {
    accessToken: string
    useSandbox: boolean
}

export interface ZenodoCreator {
    name: string  // Format: "Family name, Given names"
    affiliation?: string
    orcid?: string
}

export interface ZenodoMetadata {
    title: string
    description: string
    upload_type: 'dataset' | 'publication' | 'poster' | 'presentation' | 'software' | 'other'
    creators: ZenodoCreator[]
    keywords?: string[]
    license?: string  // e.g., 'cc-by-4.0', 'cc-zero', 'mit'
    access_right?: 'open' | 'embargoed' | 'restricted' | 'closed'
    publication_date?: string  // ISO format YYYY-MM-DD
    communities?: Array<{ identifier: string }>  // Zenodo communities
}

export interface ZenodoDeposition {
    id: number
    doi: string
    doi_url: string
    metadata: ZenodoMetadata
    state: 'unsubmitted' | 'done'
    submitted: boolean
    links: {
        bucket: string
        html: string
        publish: string
        self: string
    }
}

export interface ZenodoFile {
    id: string
    filename: string
    filesize: number
    checksum: string
}

export interface ZenodoError {
    status: number
    message: string
    errors?: { field: string; message: string }[]
}

// Get base URL based on sandbox setting
function getBaseUrl(useSandbox: boolean): string {
    return useSandbox
        ? 'https://sandbox.zenodo.org/api'
        : 'https://zenodo.org/api'
}

// Simple XOR encryption for localStorage (not truly secure, but better than plaintext)
function simpleEncrypt(text: string, key: string): string {
    let result = ''
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return btoa(result)
}

function simpleDecrypt(encoded: string, key: string): string {
    try {
        const text = atob(encoded)
        let result = ''
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
        }
        return result
    } catch {
        return ''
    }
}

// Encryption key (should ideally be more secure in production)
const ENCRYPTION_KEY = 'cenagrivet-zenodo-2024'

// Save token to localStorage (encrypted)
export function saveZenodoToken(token: string): void {
    const encrypted = simpleEncrypt(token, ENCRYPTION_KEY)
    localStorage.setItem(ZENODO_TOKEN_KEY, encrypted)
}

// Load token from localStorage
export function loadZenodoToken(): string | null {
    const encrypted = localStorage.getItem(ZENODO_TOKEN_KEY)
    if (!encrypted) return null
    return simpleDecrypt(encrypted, ENCRYPTION_KEY) || null
}

// Remove token from localStorage
export function removeZenodoToken(): void {
    localStorage.removeItem(ZENODO_TOKEN_KEY)
}

// Check if token exists
export function hasZenodoToken(): boolean {
    return !!loadZenodoToken()
}

// Create a new empty deposition
export async function createDeposition(
    config: ZenodoConfig,
    metadata?: Partial<ZenodoMetadata>
): Promise<ZenodoDeposition> {
    const baseUrl = getBaseUrl(config.useSandbox)

    const body = metadata
        ? { metadata: { ...metadata, upload_type: metadata.upload_type || 'dataset' } }
        : {}

    const response = await fetch(`${baseUrl}/deposit/depositions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.accessToken}`
        },
        body: JSON.stringify(body)
    })

    if (!response.ok) {
        const error = await response.json() as ZenodoError
        throw new Error(`Zenodo API error: ${error.message || response.statusText}`)
    }

    return response.json()
}

// Upload a file to a deposition
export async function uploadFile(
    config: ZenodoConfig,
    bucketUrl: string,
    filename: string,
    fileContent: Blob
): Promise<ZenodoFile> {
    // PUT to bucket URL with filename
    const response = await fetch(`${bucketUrl}/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream',
            'Authorization': `Bearer ${config.accessToken}`
        },
        body: fileContent
    })

    if (!response.ok) {
        const error = await response.json() as ZenodoError
        throw new Error(`Zenodo upload error: ${error.message || response.statusText}`)
    }

    return response.json()
}

// Update deposition metadata
export async function updateMetadata(
    config: ZenodoConfig,
    depositionId: number,
    metadata: ZenodoMetadata
): Promise<ZenodoDeposition> {
    const baseUrl = getBaseUrl(config.useSandbox)

    const response = await fetch(`${baseUrl}/deposit/depositions/${depositionId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.accessToken}`
        },
        body: JSON.stringify({ metadata })
    })

    if (!response.ok) {
        const error = await response.json() as ZenodoError
        throw new Error(`Zenodo metadata error: ${error.message || response.statusText}`)
    }

    return response.json()
}

// Publish the deposition
export async function publishDeposition(
    config: ZenodoConfig,
    depositionId: number
): Promise<ZenodoDeposition> {
    const baseUrl = getBaseUrl(config.useSandbox)

    const response = await fetch(`${baseUrl}/deposit/depositions/${depositionId}/actions/publish`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.accessToken}`
        }
    })

    if (!response.ok) {
        const error = await response.json() as ZenodoError
        throw new Error(`Zenodo publish error: ${error.message || response.statusText}`)
    }

    return response.json()
}

// Create a new version of an existing published deposition
export async function createNewVersion(
    config: ZenodoConfig,
    depositionId: number
): Promise<ZenodoDeposition> {
    const baseUrl = getBaseUrl(config.useSandbox)

    const response = await fetch(`${baseUrl}/deposit/depositions/${depositionId}/actions/newversion`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.accessToken}`
        }
    })

    if (!response.ok) {
        const error = await response.json() as ZenodoError
        throw new Error(`Zenodo new version error: ${error.message || response.statusText}`)
    }

    // The response contains the original record with a 'latest_draft' link
    const result = await response.json()

    // Fetch the new draft version
    if (result.links?.latest_draft) {
        const draftResponse = await fetch(result.links.latest_draft, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.accessToken}`
            }
        })
        if (draftResponse.ok) {
            return draftResponse.json()
        }
    }

    return result
}

// Delete an unpublished deposition
export async function deleteDeposition(
    config: ZenodoConfig,
    depositionId: number
): Promise<void> {
    const baseUrl = getBaseUrl(config.useSandbox)

    const response = await fetch(`${baseUrl}/deposit/depositions/${depositionId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${config.accessToken}`
        }
    })

    if (!response.ok && response.status !== 204) {
        const error = await response.json() as ZenodoError
        throw new Error(`Zenodo delete error: ${error.message || response.statusText}`)
    }
}

// Test if the token is valid
export async function validateToken(config: ZenodoConfig): Promise<boolean> {
    const baseUrl = getBaseUrl(config.useSandbox)

    try {
        const response = await fetch(`${baseUrl}/deposit/depositions`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.accessToken}`
            }
        })
        return response.ok
    } catch {
        return false
    }
}

// Get list of user's depositions
export async function listDepositions(config: ZenodoConfig): Promise<ZenodoDeposition[]> {
    const baseUrl = getBaseUrl(config.useSandbox)

    const response = await fetch(`${baseUrl}/deposit/depositions`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${config.accessToken}`
        }
    })

    if (!response.ok) {
        const error = await response.json() as ZenodoError
        throw new Error(`Zenodo list error: ${error.message || response.statusText}`)
    }

    return response.json()
}

// Available licenses
export const ZENODO_LICENSES = [
    { value: 'cc-by-4.0', label: 'Creative Commons Attribution 4.0' },
    { value: 'cc-by-sa-4.0', label: 'Creative Commons Attribution ShareAlike 4.0' },
    { value: 'cc-zero', label: 'Creative Commons Zero (Public Domain)' },
    { value: 'mit', label: 'MIT License' },
    { value: 'apache-2.0', label: 'Apache License 2.0' },
    { value: 'gpl-3.0', label: 'GNU General Public License v3.0' }
]

// Upload types
export const ZENODO_UPLOAD_TYPES = [
    { value: 'dataset', label: 'Dataset' },
    { value: 'publication', label: 'Publication' },
    { value: 'software', label: 'Software' },
    { value: 'poster', label: 'Poster' },
    { value: 'presentation', label: 'Presentation' },
    { value: 'other', label: 'Other' }
]
