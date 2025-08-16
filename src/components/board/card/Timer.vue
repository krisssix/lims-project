<script setup lang="ts">
import { ref, computed } from 'vue'
import {useCardTimerStore} from "@/stores/board/cardTimer";
import {auth} from "@/stores/auth";
import { storeToRefs } from 'pinia'
import {formatMs} from "@/utils/timeFormat";

const props = defineProps(['cardId'])

//const { createTimeRecord, time, setTime } = useCardTimerStore()
const cardTimerStore = useCardTimerStore()
const { time } = storeToRefs(cardTimerStore)

const running = ref(false)
//const time = ref(0)
const intervalMs = 200
let interval = null
let startTimestamp = 0
let startTime = null
let endTime = null


const formattedTime = computed(() => {
  return formatMs(time.value)
})

async function toggle() {
  if (running.value) {
    // STOP
    clearInterval(interval)
    running.value = false
    endTime = new Date()

    await cardTimerStore.createTimeRecord({
      username: auth.getUserInfo().preferredUsername,
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
      cardId: props.cardId
    })

  } else {
    // START
    running.value = true
    startTime = new Date()
    startTimestamp = Date.now() - time.value

    interval = setInterval(() => {
      cardTimerStore.setTime(Date.now() - startTimestamp)
    }, intervalMs)
  }
}
</script>

<template>
  <div
    class="d-flex flex-row ga-3 align-center"
    style="width: 10.5em"
  >
    <v-btn
      style="width: 50%"
      variant="tonal"
      :color="running ? 'red-darken-1' : 'light-green-darken-2' "
      @click="toggle"
    >
      {{ running ? 'STOP' : 'START' }}
    </v-btn>
    <div
      class="text-subtitle-1 font-weight-bold"
      style="width: 50%"
    >
      {{ formattedTime }}
    </div>
  </div>
</template>

<style scoped>

</style>
