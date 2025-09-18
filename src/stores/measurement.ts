// src/stores/measurement.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post } from '@/services/api/api-requests'

/** Tvar requestu pro uložení měření */
export interface MeasurementRequest {
    value: number
    type: string
    unit: string
    timestamp: number      // epoch millis
    boardCardId?: number | null
}

/** Tvar response z API */
export interface MeasurementResponse {
    id: number
    value: number
    type: string
    unit: string
    timestamp: string      // ISO‑8601 string z backendu
    boardCardId: number | null
}

export const useMeasurementStore = defineStore('measurement', () => {
    const allMeasurements = ref<MeasurementResponse[]>([])
    const selectedMeasurement = ref<MeasurementResponse | null>(null)

    /**
     * GET /measurements/project/{projectId}
     */
    async function fetchAllMeasurements(projectId: number): Promise<MeasurementResponse[]> {
        try {
            const resp = await get<{ items: MeasurementResponse[] }>(`measurements/project/${projectId}`)
            allMeasurements.value = resp.data.items
            return allMeasurements.value
        } catch (err) {
            console.error('Chyba při načítání měření:', err)
            return []
        }
    }

    /**
     * GET /measurements/project/{projectId}/{measurementId}
     */
    async function fetchMeasurement(
        projectId: number,
        measurementId: number
    ): Promise<MeasurementResponse | null> {
        try {
            const resp = await get<{ content: MeasurementResponse }>(
                `measurements/project/${projectId}/${measurementId}`
            )
            selectedMeasurement.value = resp.data.content
            return selectedMeasurement.value
        } catch (err) {
            console.error('Chyba při načítání jednoho měření:', err)
            return null
        }
    }

    /**
     * POST /measurements/project/{projectId}
     */
    async function saveMeasurement(
        projectId: number,
        measurement: MeasurementRequest
    ): Promise<MeasurementResponse> {
        try {
            console.log('Sending measurement payload:', measurement)
            const resp = await post<{ content: MeasurementResponse }>(
                `measurements/project/${projectId}`,
                measurement
            )
            return resp.data.content
        } catch (err) {
            console.error('Chyba při ukládání měření:', err)
            throw err
        }
    }

    return {
        allMeasurements,
        selectedMeasurement,
        fetchAllMeasurements,
        fetchMeasurement,
        saveMeasurement,
    }
})
