// src/stores/measurement.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, post } from '@/services/api/api-requests'

export const useMeasurementStore = defineStore('measurement', () => {
  // Stav
  const allMeasurements = ref<any[]>([])
  const selectedMeasurement = ref<any | null>(null)

  // Akce
  /**
   * Načte všechna měření pro daný projekt
   * GET /measurements/project/{projectId}
   */
  async function fetchAllMeasurements(projectId: number) {
    try {
      const response = await get(`measurements/project/${projectId}`)
      // API vrací ArrayResponse<MeasurementResponse>
      allMeasurements.value = response.data.items
      return response.data.items
    } catch (e) {
      console.error('Chyba při načítání měření:', e)
      return []
    }
  }

  /**
   * Načte jedno měření podle ID
   * GET /measurements/project/{projectId}/{measurementId}
   */
  async function fetchMeasurement(projectId: number, measurementId: number) {
    try {
      const response = await get(`measurements/project/${projectId}/${measurementId}`)
      // API vrací ObjectResponse<MeasurementResponse>
      selectedMeasurement.value = response.data.content
      return response.data.content
    } catch (e) {
      console.error('Chyba při načítání jednoho měření:', e)
      return null
    }
  }

  /**
   * Uloží nové měření
   * POST /measurements/project/{projectId}
   */
  async function saveMeasurement(projectId: number, measurement: any) {
    try {
      console.log('Sending measurement:', measurement)
      const response = await post(`measurements/project/${projectId}`, measurement)
      console.log('Response received:', response.data.content)
      return response.data.content
    } catch (e) {
      console.error('Chyba při ukládání měření:', e)
      throw e
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
