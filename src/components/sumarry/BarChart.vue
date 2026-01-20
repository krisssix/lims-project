<script setup lang="ts">
import { Chart, registerables } from "chart.js";
import {useSummaryStore} from "@/stores/summary/summary";
import {storeToRefs} from "pinia";

const summaryStore = useSummaryStore()
const { graphData } = storeToRefs(summaryStore)
const bar = useTemplateRef('bar')
let chart = null

onMounted(() => {
  Chart.register(...registerables)
  chart = new Chart(bar.value, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: "",
        data: [],
        borderWidth: 1
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  })
})

watch(graphData, (newGraphData) => {
  console.log('new newGraphData', newGraphData)
  chart.data = newGraphData
  chart.update()
})

// setTimeout(()=>{
//   chart.data = {
//     labels: ['Red', 'Blue', 'Yellow'],
//     datasets: [{
//       label: 'bla bla',
//       data: [12, 19, 3],
//       borderWidth: 2
//     }]
//   }
//   chart.update()
// }, 2000)

</script>

<template>
  <div>
    <canvas ref="bar" />
  </div>
</template>

<style scoped>

</style>
