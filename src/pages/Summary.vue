<script setup lang="ts">

import BarChart from "@/components/sumarry/BarChart.vue";
import {useSummaryStore} from "@/stores/summary/summary";

const summaryStore = useSummaryStore()
const route = useRoute()

onMounted(async () => {
  const projectId = route.params.projectId
  console.log('project id ', projectId)
  await summaryStore.fetchTimeRecordsFromDay(0, projectId)
})

const intervalItems = ['Vše', 'Poslední týden', 'Poslední měsíc']
const byItems = ['Podle dnů', 'Podle osob']
const interval = ref('Vše')
const by = ref('Podle osob')

async function intervalChanged(value){
  interval.value = value
  const projectId = route.params.projectId
  if(value === 'Vše'){
    await summaryStore.fetchTimeRecordsFromDay(0, projectId)
  } else if(value === 'Poslední týden'){
    await summaryStore.fetchTimeRecordsFromDay(calculateLastWeekStartDay(), projectId)
  } else if(value === 'Poslední měsíc'){
    await summaryStore.fetchTimeRecordsFromDay(calculateLastMonthStartDay(), projectId)
  }
}
function byChanged(value){
  by.value = value
}

function calculateLastWeekStartDay(){
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return date.getTime()
}

function calculateLastMonthStartDay(){
  const date = new Date()
  date.setMonth(date.getMonth() - 1)
  return date.getTime()
}
</script>

<template>
  <h2>Celková práce na projektu</h2>
  <div
    class="d-flex ga-4 pt-5 w-50"
  >
    <v-combobox @update:model-value="value => intervalChanged(value)" :model-value="interval" :items="intervalItems" variant="outlined"></v-combobox>
    <v-combobox @update:model-value="value => byChanged(value)" :model-value="by" :items="byItems" variant="outlined"></v-combobox>
  </div>
  <bar-chart class="w-50" />
</template>

<style scoped>

</style>
