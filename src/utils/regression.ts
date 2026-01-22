/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * utility pro výpočet regrese
 * poskytuje lineární a logaritmické výpočty
 */

export interface RegressionResult {
    type: 'linear' | 'logarithmic'
    slope: number           // a v y = ax + b (lineární) nebo y = a*ln(x) + b (log)
    intercept: number       // b
    rSquared: number        // r na druhou koeficient determinace
    correlation: number     // pearsonův korelační koeficient
    equation: string        // rovnice v čitelném formátu
    predictY: (x: number) => number  // předpověď y pro dané x
    predictX: (y: number) => number  // předpověď x pro dané y (inverzní)
    residuals: number[]     // reziduální chyby pro každý bod
    standardError: number   // standardní chyba odhadu
}

export interface DataPoint {
    x: number
    y: number
}

/**
 * výpočet lineární regrese: y = ax + b
 */
export function linearRegression(data: DataPoint[]): RegressionResult {
    const n = data.length
    if (n < 2) {
        throw new Error('Potřeba alespoň 2 body pro regresi')
    }

    // výpočet sum
    let sumX = 0
    let sumY = 0
    let sumXY = 0
    let sumX2 = 0
    let sumY2 = 0

    for (const point of data) {
        sumX += point.x
        sumY += point.y
        sumXY += point.x * point.y
        sumX2 += point.x * point.x
        sumY2 += point.y * point.y
    }

    // výpočet sklonu (a) a průsečíku (b)
    const denominator = n * sumX2 - sumX * sumX
    if (Math.abs(denominator) < 1e-10) {
        throw new Error('Data jsou příliš lineárně závislá')
    }

    const slope = (n * sumXY - sumX * sumY) / denominator
    const intercept = (sumY - slope * sumX) / n

    // výpočet r² a korelace
    const meanY = sumY / n
    let ssTot = 0  // celkový součet čtverců
    let ssRes = 0  // reziduální součet čtverců
    const residuals: number[] = []

    for (const point of data) {
        const predicted = slope * point.x + intercept
        const residual = point.y - predicted
        residuals.push(residual)
        ssRes += residual * residual
        ssTot += (point.y - meanY) * (point.y - meanY)
    }

    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0
    const correlation = Math.sqrt(rSquared) * (slope >= 0 ? 1 : -1)

    // standard chyba
    const standardError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0

    // formátování rovnice
    const signB = intercept >= 0 ? '+' : ''
    const equation = `y = ${formatNumber(slope)}x ${signB} ${formatNumber(intercept)}`

    return {
        type: 'linear',
        slope,
        intercept,
        rSquared,
        correlation,
        equation,
        predictY: (x: number) => slope * x + intercept,
        predictX: (y: number) => slope !== 0 ? (y - intercept) / slope : NaN,
        residuals,
        standardError
    }
}

/**
 * výpočet logaritmické regrese: y = a*ln(x) + b
 */
export function logarithmicRegression(data: DataPoint[]): RegressionResult {
    const n = data.length
    if (n < 2) {
        throw new Error('Potřeba alespoň 2 body pro regresi')
    }

    // odfiltrování nekladných hodnot x (ln není definováno)
    const validData = data.filter(p => p.x > 0)
    if (validData.length < 2) {
        throw new Error('Potřeba alespoň 2 body s kladným X pro logaritmickou regresi')
    }

    // transformace x na ln(x) a aplikace lineární regrese
    const transformedData: DataPoint[] = validData.map(p => ({
        x: Math.log(p.x),
        y: p.y
    }))

    // výpočet sum s ln(x)
    let sumLnX = 0
    let sumY = 0
    let sumLnXY = 0
    let sumLnX2 = 0

    for (const point of transformedData) {
        sumLnX += point.x
        sumY += point.y
        sumLnXY += point.x * point.y
        sumLnX2 += point.x * point.x
    }

    const nValid = validData.length
    const denominator = nValid * sumLnX2 - sumLnX * sumLnX
    if (Math.abs(denominator) < 1e-10) {
        throw new Error('Data jsou příliš závislá')
    }

    const slope = (nValid * sumLnXY - sumLnX * sumY) / denominator
    const intercept = (sumY - slope * sumLnX) / nValid

    // výpočet r² s využitím původních dat
    const meanY = sumY / nValid
    let ssTot = 0
    let ssRes = 0
    const residuals: number[] = []

    for (const point of validData) {
        const predicted = slope * Math.log(point.x) + intercept
        const residual = point.y - predicted
        residuals.push(residual)
        ssRes += residual * residual
        ssTot += (point.y - meanY) * (point.y - meanY)
    }

    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0
    const correlation = Math.sqrt(rSquared) * (slope >= 0 ? 1 : -1)
    const standardError = nValid > 2 ? Math.sqrt(ssRes / (nValid - 2)) : 0

    // formátování rovnice
    const signB = intercept >= 0 ? '+' : ''
    const equation = `y = ${formatNumber(slope)}*ln(x) ${signB} ${formatNumber(intercept)}`

    return {
        type: 'logarithmic',
        slope,
        intercept,
        rSquared,
        correlation,
        equation,
        predictY: (x: number) => x > 0 ? slope * Math.log(x) + intercept : NaN,
        predictX: (y: number) => Math.exp((y - intercept) / slope),
        residuals,
        standardError
    }
}

/**
 * automatická detekce nejvhodnějšího typu regrese podle r²
 */
export function bestFitRegression(data: DataPoint[]): RegressionResult {
    const linear = linearRegression(data)

    try {
        const logarithmic = logarithmicRegression(data)
        return logarithmic.rSquared > linear.rSquared ? logarithmic : linear
    } catch {
        // pokud logaritmická regrese selže (záporné hodnoty x), použij lineární
        return linear
    }
}

/**
 * formátování čísla pro zobrazení
 */
function formatNumber(n: number, decimals = 4): string {
    if (Math.abs(n) < 0.0001 && n !== 0) {
        return n.toExponential(2)
    }
    return n.toFixed(decimals).replace(/\.?0+$/, '')
}

/**
 * parsování pole dvojic [x, y] nebo samostatných polí x a y
 */
export function parseRegressionData(
    input: number[][] | { xValues: number[]; yValues: number[] }
): DataPoint[] {
    if (Array.isArray(input) && input[0] && Array.isArray(input[0])) {
        // formát: [[x1, y1], [x2, y2], ...]
        return (input as number[][]).map(([x, y]) => ({ x, y }))
    }

    if ('xValues' in input && 'yValues' in input) {
        // formát: { xvalues: [...], yvalues: [...] }
        const len = Math.min(input.xValues.length, input.yValues.length)
        const points: DataPoint[] = []
        for (let i = 0; i < len; i++) {
            points.push({ x: input.xValues[i], y: input.yValues[i] })
        }
        return points
    }

    throw new Error('Nepodporovaný formát dat')
}
