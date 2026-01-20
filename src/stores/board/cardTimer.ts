import { defineStore } from "pinia";
import { del, get, post } from "@/services/api/api-requests";
import { auth } from "@/stores/auth";

export const useCardTimerStore = defineStore('cardTimer', () => {

  const timeRecords = ref([])

  async function updateTimeRecord() {

  }

  async function createTimeRecord(requestData) {
    try {
      const response = await post('boardCardTimer', requestData)
      console.log('time response ', response.data.content)
      timeRecords.value.push(response.data.content)
    } catch (e) {
      console.error(e)
    }
  }

  async function fetchTimeRecords(cardId) {
    try {
      const response = await get(`boardCardTimer/${cardId}`)
      timeRecords.value = []
      timeRecords.value.push(...response.data.items)
    } catch (e) {
      console.error(e)
    }
  }

  function setTimeForTimer() {
    let duration = 0
    timeRecords.value.forEach(timeRecord => {
      if (timeRecord.username === auth.getUserInfo().preferredUsername) {
        duration += Math.floor(timeRecord.duration / 1000) * 1000
      }
    })
    time.value = duration
  }

  function setTime(newTime) {
    time.value = newTime
  }

  async function deleteTimeRecord(id) {
    try {
      await del(`boardCardTimer/${id}`)
    } catch (e) {
      console.error(e)
    }
  }

  function removeFromTimeRecords(id) {
    timeRecords.value = timeRecords.value.filter(timeRecord => timeRecord.id !== id)
  }

  return {
    createTimeRecord,
    timeRecords,
    updateTimeRecord,
    fetchTimeRecords,
    setTimeForTimer,
    time,
    setTime,
    deleteTimeRecord,
    removeFromTimeRecords
  }
})
