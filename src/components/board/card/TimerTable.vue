<script setup lang="ts">
import {useCardTimerStore} from "@/stores/board/cardTimer";
import {computed} from "vue";
import {formatDateFromTimestamp, formatMs, formatTimeFromTimestamp} from "@/utils/timeFormat";
import {storeToRefs} from "pinia";
import TimeRecordForm from "@/components/board/card/TimeRecordForm.vue";

const cardTimerStore = useCardTimerStore()
const { timeRecords } = storeToRefs(cardTimerStore)
const timeRecordDialog = ref(false)

const headers = ref([
  { title: 'Uživatel', key: 'username', align: 'start' },
  { title: 'Datum', key: 'date', align: 'start' },
  { title: 'Start', key: 'startTime', align: 'start' },
  { title: 'Konec', key: 'endTime', align: 'start' },
  { title: 'Trvání', key: 'duration', align: 'start' },
  { title: 'Actions', key: 'actions', align: 'end', sortable: false, }
])

const items = computed(() => {
  return timeRecords.value.map(timeRecord => {
    return {
      id: timeRecord.id,
      username: timeRecord.username,
      date: formatDateFromTimestamp(timeRecord.startTime),
      startTime: formatTimeFromTimestamp(timeRecord.startTime),
      endTime: formatTimeFromTimestamp(timeRecord.endTime),
      duration: formatMs(timeRecord.duration),
    }
  })
})

function edit(value) {
  console.log('edit ', value)
}

function remove(value){
  console.log('remove ', value)
}

</script>

<template>
  <div class="d-flex flex-row w-100 justify-end">
    <time-record-form />
  </div>
  <v-data-table
    :items="items"
    :headers="headers"
  >
    <template #item.actions="{ item }">
      <div class="d-flex ga-2 justify-end">
        <v-icon
          color="medium-emphasis"
          icon="mdi-pencil"
          size="small"
          @click="edit(item)"
        />

        <v-icon
          color="medium-emphasis"
          icon="mdi-delete"
          size="small"
          @click="remove(item)"
        />
      </div>
    </template>

    <template #no-data>
      <div>Žádný naměřený čas</div>
    </template>
  </v-data-table>
</template>

<style scoped>

</style>
