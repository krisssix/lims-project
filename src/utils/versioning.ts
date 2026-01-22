/**
 * nástroje pro správu verzí šablon
 * podporuje sémantické verzování (major.minor.patch)
 */

import { type TemplateItem } from '@/types/measurement-ui'

// typy
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

// konstanty životního cyklu verzí
export const VersionLifecycle = {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    DEPRECATED: 'DEPRECATED'
} as const

/**
 * rozdělení řetězce verze na komponenty
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
 * formátování verze do řetězce
 */
export function formatVersion(version: string | undefined): string {
    if (!version) return 'v1.0'
    const v = version.replace(/^v/, '')
    const parts = v.split('.')
    if (parts.length === 1) return `${parts[0]}.0`
    if (parts.length === 2) return `${parts[0]}.${parts[1]}`
    return `v${parts[0]}.${parts[1]}.${parts[2]}`
}

/**
 * získání další verze na základě typu verze
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
 * porovnání dvou verzí
 * vrací: -1 pokud a < b, 0 pokud a === b, 1 pokud a > b
 */
export function compareVersions(a: string, b: string): number {
    const av = parseVersion(a)
    const bv = parseVersion(b)

    if (av.major !== bv.major) return av.major - bv.major
    if (av.minor !== bv.minor) return av.minor - bv.minor
    return av.patch - bv.patch
}

/**
 * získání barvy stavu pro stav šablony
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
 * získání ikony stavu pro stav šablony
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
 * získání popisku a metadat pro typ verze
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
 * získání relativního časového řetězce (např. "před 2 dny", "před hodinou")
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
 * seskupení šablon podle základního názvu (bez přípony verze)
 */
export function groupTemplatesByName(templates: TemplateItem[]): VersionGroup[] {
    const groups = new Map<string, VersionGroup>()

    for (const template of templates) {
        // extrakce základního názvu (odstranění přípony verze, pokud je přítomna)
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

        // sledování aktivní verze
        if (template.status === 'ACTIVE') {
            group.activeVersion = template
        }

        // sledování nejnovější verze
        if (compareVersions(template.version || '1.0', group.latestVersion.version || '1.0') > 0) {
            group.latestVersion = template
        }
    }

    // seřazení verzí v každé skupině (nejnovější první)
    for (const group of groups.values()) {
        group.versions.sort((a, b) => compareVersions(b.version || '1.0', a.version || '1.0'))
    }

    return Array.from(groups.values())
}

/**
 * pravidla verzování a validace
 */
export const VersioningRules = {
    /**
     * kontrola, zda lze vytvořit novou verzi
     */
    canCreateVersion(
        existingVersions: TemplateItem[],
        newVersion: string
    ): { valid: boolean; error?: string } {
        // kontrola, zda verze již existuje
        const exists = existingVersions.some(
            v => parseVersion(v.version || '1.0').major === parseVersion(newVersion).major &&
                parseVersion(v.version || '1.0').minor === parseVersion(newVersion).minor &&
                parseVersion(v.version || '1.0').patch === parseVersion(newVersion).patch
        )

        if (exists) {
            return { valid: false, error: `Verze ${formatVersion(newVersion)} již existuje` }
        }

        // kontrola, zda existuje vyšší verze
        const hasHigher = existingVersions.some(
            v => compareVersions(v.version || '1.0', newVersion) > 0
        )

        if (hasHigher) {
            return { valid: false, error: 'Existuje již vyšší verze' }
        }

        return { valid: true }
    },

    /**
     * kontrola, zda lze verzi publikovat
     */
    canPublish(
        template: TemplateItem,
        allVersions: TemplateItem[]
    ): { valid: boolean; error?: string } {
        if (template.status !== 'DRAFT') {
            return { valid: false, error: 'Pouze draft verze mohou být publikovány' }
        }

        // kontrola, zda již existuje aktivní verze s vyšším číslem verze
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
     * kontrola, zda lze verzi označit jako deprecated
     */
    canDeprecate(
        template: TemplateItem,
        allVersions: TemplateItem[]
    ): { valid: boolean; error?: string } {
        if (template.status !== 'ACTIVE') {
            return { valid: false, error: 'Pouze aktivní verze mohou být označeny jako deprecated' }
        }

        // kontrola, zda existuje jiná aktivní verze
        const otherActive = allVersions.find(
            v => v.id !== template.id && v.status === 'ACTIVE'
        )

        if (!otherActive) {
            // kontrola, zda existují verze typu draft, které by mohly být publikovány
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
     * kontrola, zda lze verzi smazat
     */
    canDelete(
        template: TemplateItem,
        allVersions: TemplateItem[]
    ): { valid: boolean; error?: string } {
        if (template.status === 'ACTIVE') {
            return { valid: false, error: 'Aktivní verze nemůže být smazána. Nejdříve jí označte jako deprecated.' }
        }

        // kontrola, zda jde o poslední verzi
        if (allVersions.length <= 1) {
            return { valid: false, error: 'Nelze smazat poslední verzi šablony' }
        }

        return { valid: true }
    }
}
