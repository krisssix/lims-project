/**
 * Color contrast utilities for ensuring text readability on colored backgrounds.
 * Use these functions to determine whether to use white or black text based on
 * the background color.
 */

/**
 * Parse a color string (hex or rgb) to RGB components.
 * Falls back to a default blue color if parsing fails.
 */
export function parseColorToRGB(color: string): { r: number; g: number; b: number } {
    const c = color.trim()

    // Handle hex colors
    if (c.startsWith('#')) {
        const hex = c.slice(1)
        const full = hex.length === 3 ? hex.split('').map(h => h + h).join('') : hex
        const r = parseInt(full.slice(0, 2), 16)
        const g = parseInt(full.slice(2, 4), 16)
        const b = parseInt(full.slice(4, 6), 16)
        return { r, g, b }
    }

    // Handle rgb() format
    const m = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i)
    if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }

    // Default fallback - primary blue
    return { r: 30, g: 136, b: 229 }
}

/**
 * Calculate relative luminance of a color (WCAG formula).
 * Returns a value between 0 (black) and 1 (white).
 */
export function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
    const srgb = [r, g, b].map(v => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

/**
 * Determine whether to use black or white text on a given background color.
 * Returns 'black' for light backgrounds and 'white' for dark backgrounds.
 */
export function contrastText(color: string): 'black' | 'white' {
    const lum = luminance(parseColorToRGB(color))
    return lum > 0.5 ? 'black' : 'white'
}

/**
 * Get the appropriate text color for a background, returning the actual CSS color value.
 * @param bgColor - Background color in hex or rgb format
 * @returns '#000000' or '#ffffff'
 */
export function getContrastTextColor(bgColor: string): string {
    return contrastText(bgColor) === 'black' ? '#000000' : '#ffffff'
}
