/**
 * Versioning utilities for template management
 * Supports semantic versioning (major.minor.patch)
 */

import { type TemplateItem } from '@/types/measurement-ui'

// Types
export type VersionType = 'major' | 'minor' | 'patch'
export type VersionStatus = 'DRAFT' | 'ACTIVE' | 'DEPRECATED'

export interface VersionGroup {
    key: string
    baseName: string
    deviceId: string
    deviceColor: string
    versions: TemplateItem[]
    activeVersion: TemplateItem | null
    latestVersion: TemplateItem
}

// Version Lifecycle constants
export const VersionLifecycle = {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    DEPRECATED: 'DEPRECATED'
} as const

/**
 * Parse version string to components
 */
export function parseVersion(version: string): { major: number; minor: number; patch: number } {
    const parts = version.replace(/^v/, '').split('.').map(Number)
    return {
        major: parts[0] || 1,
        minor: parts[1] || 0,
        patch: parts[2] || 0
    }
}

/**
 * Format version to string
 */
export function formatVersion(version: string | undefined): string {
    if (!version) return 'v1.0'
    const v = version.replace(/^v/, '')
    const parts = v.split('.')
    if (parts.length === 1) return `v${parts[0]}.0`
    if (parts.length === 2) return `v${parts[0]}.${parts[1]}`
    return `v${parts[0]}.${parts[1]}.${parts[2]}`
}

/**
 * Get the next version based on version type
 */
export function getNextVersion(currentVersion: string, type: VersionType): string {
    const { major, minor, patch } = parseVersion(currentVersion)

    switch (type) {
        case 'major':
            return `${major + 1}.0.0`
        case 'minor':
            return `${major}.${minor + 1}.0`
        case 'patch':
            return `${major}.${minor}.${patch + 1}`
        default:
            return `${major}.${minor}.${patch + 1}`
    }
}

/**
 * Compare two versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
    const av = parseVersion(a)
    const bv = parseVersion(b)

    if (av.major !== bv.major) return av.major - bv.major
    if (av.minor !== bv.minor) return av.minor - bv.minor
    return av.patch - bv.patch
}

/**
 * Get status color for template status
 */
export function getStatusColor(status: string | undefined): string {
    switch (status) {
        case 'DRAFT':
            return '#f59e0b' // amber
        case 'ACTIVE':
            return '#22c55e' // green
        case 'DEPRECATED':
            return '#9ca3af' // gray
        default:
            return '#22c55e'
    }
}

/**
 * Get status icon for template status
 */
export function getStatusIcon(status: string | undefined): string {
    switch (status) {
        case 'DRAFT':
            return 'mdi-pencil-outline'
        case 'ACTIVE':
            return 'mdi-check-circle'
        case 'DEPRECATED':
            return 'mdi-archive-outline'
        default:
            return 'mdi-check-circle'
    }
}

/**
 * Get version type label and metadata
 */
export function getVersionTypeLabel(type: VersionType): {
    label: string
    icon: string
    color: string
    description: string
} {
    switch (type) {
        case 'major':
            return {
                label: 'Major',
                icon: 'mdi-arrow-up-bold',
                color: '#ef4444', // red
                description: 'Zásadní změny, nekompatibilní s předchozí verzí'
            }
        case 'minor':
            return {
                label: 'Minor',
                icon: 'mdi-arrow-up',
                color: '#f59e0b', // amber
                description: 'Nové funkce, zpětně kompatibilní'
            }
        case 'patch':
            return {
                label: 'Patch',
                icon: 'mdi-wrench',
                color: '#22c55e', // green
                description: 'Opravy chyb a drobné úpravy'
            }
        default:
            return {
                label: 'Patch',
                icon: 'mdi-wrench',
                color: '#22c55e',
                description: 'Opravy chyb a drobné úpravy'
            }
    }
}

/**
 * Get relative time string (e.g., "před 2 dny", "před hodinou")
 */
export function getRelativeTime(isoString: string): string {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)
    const diffWeek = Math.floor(diffDay / 7)
    const diffMonth = Math.floor(diffDay / 30)

    if (diffSec < 60) return 'právě teď'
    if (diffMin < 60) return `před ${diffMin} ${diffMin === 1 ? 'minutou' : diffMin < 5 ? 'minutami' : 'minutami'}`
    if (diffHour < 24) return `před ${diffHour} ${diffHour === 1 ? 'hodinou' : diffHour < 5 ? 'hodinami' : 'hodinami'}`
    if (diffDay < 7) return `před ${diffDay} ${diffDay === 1 ? 'dnem' : diffDay < 5 ? 'dny' : 'dny'}`
    if (diffWeek < 4) return `před ${diffWeek} ${diffWeek === 1 ? 'týdnem' : diffWeek < 5 ? 'týdny' : 'týdny'}`
    if (diffMonth < 12) return `před ${diffMonth} ${diffMonth === 1 ? 'měsícem' : diffMonth < 5 ? 'měsíci' : 'měsíci'}`

    return date.toLocaleDateString('cs-CZ')
}

/**
 * Group templates by base name (without version suffix)
 */
export function groupTemplatesByName(templates: TemplateItem[]): VersionGroup[] {
    const groups = new Map<string, VersionGroup>()

    for (const template of templates) {
        // Extract base name (remove version suffix if present)
        const baseName = template.name.replace(/\s*v?\d+(\.\d+)*\s*$/, '').trim() || template.name
        const key = `${template.deviceId}:${baseName}`

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                baseName,
                deviceId: template.deviceId,
                deviceColor: template.deviceColor || '#6b7280',
                versions: [],
                activeVersion: null,
                latestVersion: template
            })
        }

        const group = groups.get(key)!
        group.versions.push(template)

        // Track active version
        if (template.status === 'ACTIVE') {
            group.activeVersion = template
        }

        // Track latest version
        if (compareVersions(template.version || '1.0', group.latestVersion.version || '1.0') > 0) {
            group.latestVersion = template
        }
    }

    // Sort versions within each group (newest first)
    for (const group of groups.values()) {
        group.versions.sort((a, b) => compareVersions(b.version || '1.0', a.version || '1.0'))
    }

    return Array.from(groups.values())
}

/**
 * Versioning rules and validation
 */
export const VersioningRules = {
    /**
     * Check if a new version can be created
     */
    canCreateVersion(
        existingVersions: TemplateItem[],
        newVersion: string
    ): { valid: boolean; error?: string } {
        // Check if version already exists
        const exists = existingVersions.some(
            v => parseVersion(v.version || '1.0').major === parseVersion(newVersion).major &&
                parseVersion(v.version || '1.0').minor === parseVersion(newVersion).minor &&
                parseVersion(v.version || '1.0').patch === parseVersion(newVersion).patch
        )

        if (exists) {
            return { valid: false, error: `Verze ${formatVersion(newVersion)} již existuje` }
        }

        // Check if there's a higher version
        const hasHigher = existingVersions.some(
            v => compareVersions(v.version || '1.0', newVersion) > 0
        )

        if (hasHigher) {
            return { valid: false, error: 'Existuje již vyšší verze' }
        }

        return { valid: true }
    },

    /**
     * Check if a version can be published
     */
    canPublish(
        template: TemplateItem,
        allVersions: TemplateItem[]
    ): { valid: boolean; error?: string } {
        if (template.status !== 'DRAFT') {
            return { valid: false, error: 'Pouze draft verze mohou být publikovány' }
        }

        // Check if there's already an active version with higher version number
        const activeHigher = allVersions.find(
            v => v.status === 'ACTIVE' &&
                compareVersions(v.version || '1.0', template.version || '1.0') > 0
        )

        if (activeHigher) {
            return {
                valid: false,
                error: `Nelze publikovat starší verzi, aktivní je ${formatVersion(activeHigher.version)}`
            }
        }

        return { valid: true }
    },

    /**
     * Check if a version can be deprecated
     */
    canDeprecate(
        template: TemplateItem,
        allVersions: TemplateItem[]
    ): { valid: boolean; error?: string } {
        if (template.status !== 'ACTIVE') {
            return { valid: false, error: 'Pouze aktivní verze mohou být označeny jako deprecated' }
        }

        // Check if there's another active version
        const otherActive = allVersions.find(
            v => v.id !== template.id && v.status === 'ACTIVE'
        )

        if (!otherActive) {
            // Check if there are draft versions that could be published
            const hasDraft = allVersions.some(v => v.status === 'DRAFT')
            if (!hasDraft) {
                return {
                    valid: false,
                    error: 'Toto je jediná aktivní verze. Nejdříve publikujte jinou verzi.'
                }
            }
        }

        return { valid: true }
    },

    /**
     * Check if a version can be deleted
     */
    canDelete(
        template: TemplateItem,
        allVersions: TemplateItem[]
    ): { valid: boolean; error?: string } {
        if (template.status === 'ACTIVE') {
            return { valid: false, error: 'Aktivní verze nemůže být smazána. Nejdříve jí označte jako deprecated.' }
        }

        // Check if this is the last version
        if (allVersions.length <= 1) {
            return { valid: false, error: 'Nelze smazat poslední verzi šablony' }
        }

        return { valid: true }
    }
}
