<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from "@/components/Dialog.vue";
import MeasurementForm from '@/components/measurement/MeasurementForm.vue'
import { useMeasurementStore } from '@/stores/measurement'

const route = useRoute()

const measurements = ref([
  {
    type: 'Teplota DLS',
    device: 'M1',
    date: '2024-02-16',
    count: 6
  },
  {
    type: 'Teplota DLS',
    device: 'M2',
    date: '2024-02-12',
    count: 4
  },
  {
    type: 'Kalibrace',
    device: 'M2',
    date: '2024-02-10',
    count: 4
  }
])

const headers = [
  { text: 'Typ měření', value: 'type' },
  { text: 'Přístroj', value: 'device' },
  { text: 'Datum měření', value: 'date' },
  { text: 'Počet naměřených hodnot', value: 'count' }
]

const selectedDate = ref(null)
const selectedMember = ref(null)
const selectedDevice = ref(null)

const dialogOpen = ref(false)
const templatesDialogOpen = ref(false)

function openDialog() {
  dialogOpen.value = true
}
function closeDialog() {
  dialogOpen.value = false
}
function openTemplatesDialog() {
  templatesDialogOpen.value = true
}
function closeTemplatesDialog() {
  templatesDialogOpen.value = false
}

const measurementStore = useMeasurementStore()
const newMeasurement = ref({
  value: 0,
})



const projectId = computed(() => {
  return Number((route.params as { projectId: string }).projectId)
})

</script>

<template>

</template>

<style scoped>

</style>
