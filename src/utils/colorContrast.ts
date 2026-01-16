/**
 * nástroje pro kontrast barev zajišťující čitelnost textu na barevném pozadí.
 * tyto funkce slouží k určení, zda použít bílý nebo černý text na základě
 * barvy pozadí.
 */

/**
 * rozklad řetězce barvy (hex nebo rgb) na rgb komponenty.
 * v případě chyby parsování se použije výchozí modrá barva.
 */
export function parseColorToRGB(color: string): { r: number; g: number; b: number } {
    const c = color.trim()

    // zpracování barev v hex formátu
    if (c.startsWith('#')) {
        const hex = c.slice(1)
        const full = hex.length === 3 ? hex.split('').map(h => h + h).join('') : hex
        const r = parseInt(full.slice(0, 2), 16)
        const g = parseInt(full.slice(2, 4), 16)
        const b = parseInt(full.slice(4, 6), 16)
        return { r, g, b }
    }

    // zpracování formátu rgb()
    const m = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i)
    if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }

    // výchozí stav - základní modrá
    return { r: 30, g: 136, b: 229 }
}

/**
 * výpočet relativní svítivosti barvy (wcag vzorec).
 * vrací hodnotu mezi 0 (černá) a 1 (bílá).
 */
export function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
    const srgb = [r, g, b].map(v => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

/**
 * rozhodnutí, zda použít černý nebo bílý text na daném pozadí.
 * vrací 'black' pro světlá pozadí a 'white' pro tmavá pozadí.
 */
export function contrastText(color: string): 'black' | 'white' {
    const lum = luminance(parseColorToRGB(color))
    return lum > 0.5 ? 'black' : 'white'
}

/**
 * získání vhodné barvy textu pro pozadí, vrací skutečnou css hodnotu barvy.
 * @param bgcolor - barva pozadí v hex nebo rgb formátu
 * @returns '#000000' nebo '#ffffff'
 */
export function getContrastTextColor(bgColor: string): string {
    return contrastText(bgColor) === 'black' ? '#000000' : '#ffffff'
}
