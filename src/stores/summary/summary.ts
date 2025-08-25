import {defineStore} from "pinia";
import {get} from "@/services/api/api-requests";

export const useSummaryStore = defineStore('summary', ()=>{
  const graphData = ref([])

  async function fetchTimeRecordsFromDay(startDay, projectId){
    try {
      const response = await get(`boardCardTimer/byProject/${projectId}?startDay=${startDay}`)
      console.log('response ', response.data)
        let labels = []
        let data = []
        response.data.items.forEach(item => {
          labels.push(item.username)
          data.push(item.sumTime)
        })
        graphData.value = {
          labels: labels,
          datasets: [{
            label: "Celý projekt",
            data: data,
            borderWidth: 1
          }]
        }
    } catch (e) {
      console.error(e)
    }
  }

  return {
    fetchTimeRecordsFromDay,
    graphData
  }
})
