<script setup lang="ts">
import {useCardTimerStore} from "@/stores/board/cardTimer";
import {auth} from "@/stores/auth";
import {useBoardStore} from "@/stores/board/board";

const cardTimerStore = useCardTimerStore()
const boardStore = useBoardStore()

const dialog = ref(false)
const loading = ref(false)

const timeFrom = ref(null)
const dateFrom = ref(null)
const timeTo = ref(null)
const dateTo = ref(null)

const dateToRef = useTemplateRef('date-to')
const dateFromRef = useTemplateRef('date-from')

const maxDateFrom = computed(() => dateTo.value && dateTo.value.value)
const maxTimeFrom = computed(() => {
  const hasAllValues = dateTo.value && dateFrom.value && timeTo.value
  if (hasAllValues && dateTo.value.dateFormated === dateFrom.value.dateFormated) {
    return timeTo.value.value
  }
  return null
})
const minDateTo = computed(() => dateFrom.value && dateFrom.value.value)
const minTimeTo = computed(() => {
  const hasAllValues = dateTo.value && dateFrom.value && timeFrom.value
  if ( hasAllValues && dateTo.value.dateFormated === dateFrom.value.dateFormated) {
    return timeFrom.value.value
  }
  return null
})

const isValid = computed(() => timeFrom.value && timeTo.value && dateFrom.value && dateTo.value)

function update(updatedItem, args){
  switch (updatedItem) {
    case 'timeFrom': timeFrom.value = args
      break;
    case 'timeTo': timeTo.value = args
      break;
    case 'dateFrom':
        dateFrom.value = args
        if(!dateTo.value){
          dateToRef.value.update(dateFrom.value.value)
        }
      break;
    case 'dateTo':
        dateTo.value = args
        if(!dateFrom.value){
          dateFromRef.value.update(dateTo.value.value)
        }
      break;
  }
}

function getTimestamp(date, time){
  const [hours, minutes] = time.split(":").map(Number);
  const newDate = new Date(date);
  newDate.setHours(hours, minutes, 0, 0);
  return newDate.getTime()
}

async function save(){
  loading.value = true
  await cardTimerStore.createTimeRecord({
    username: auth.getUserInfo().preferredUsername,
    startTime: getTimestamp(dateFrom.value.value, timeFrom.value.value),
    endTime: getTimestamp(dateTo.value.value, timeTo.value.value),
    cardId: boardStore.openedCard.id
  })
  cardTimerStore.setTimeForTimer()
  dialog.value = false
  reset()
  loading.value = false
}

function close(){
  dialog.value = false
  reset()
}

function reset() {
  timeFrom.value = null
  dateFrom.value = null
  timeTo.value = null
  dateTo.value = null
}

</script>

<template>
  <v-dialog
    v-model="dialog"
    width="800"
  >
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        class="me-2"
        text="Přidat čas"
        variant="text"
        color="primary"
      />
    </template>
    <template #default="{ isActive }">
      <v-card title="Nový časový záznam">
        <h4 class="px-5">
          Start
        </h4>
        <v-row class="px-5 pt-3">
          <v-col cols="6">
            <date-picker
              ref="date-from"
              text-field-label="Datum od"
              :max="maxDateFrom"
              @update="args => update('dateFrom', args)"
            />
          </v-col>
          <v-col cols="6">
            <time-picker
              text-field-label="Čas od"
              :max="maxTimeFrom"
              @update="args => update('timeFrom', args)"
            />
          </v-col>
        </v-row>
        <h4 class="px-5">
          Konec
        </h4>
        <v-row class="px-5 pt-3">
          <v-col cols="6">
            <date-picker
              ref="date-to"
              text-field-label="Datum do"
              :min="minDateTo"
              @update="args => update('dateTo', args)"
            />
          </v-col>
          <v-col cols="6">
            <time-picker
              text-field-label="Čas do"
              :min="minTimeTo"
              @update="args => update('timeTo', args)"
            />
          </v-col>
        </v-row>
        <v-card-actions>
          <v-btn
            text="Zrušit"
            @click="close"
          />
          <v-btn
            :width="100"
            :disabled="!isValid"
            variant="flat"
            color="primary"
            @click="save"
          >
            <v-progress-circular
              v-if="loading"
              :size="20"
              :width="1"
              color="white"
              indeterminate
            />
            <div class="ml-1">
              Uložit
            </div>
          </v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-dialog>
</template>

<style scoped>

</style>
