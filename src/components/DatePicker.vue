<script setup lang="ts">
import {formatDateFromTimestamp} from "@/utils/timeFormat";

const props = defineProps(['textFieldLabel','min','max'])
const emit = defineEmits(['update'])

const time = ref(null)
const dateFormated = ref('')
const showMenu = ref(false)

function update(value){
  time.value = value
  const timestamp = new Date(time.value).getTime()
  dateFormated.value = formatDateFromTimestamp(timestamp)
  emit('update',{
    value: time.value,
    timestamp: timestamp,
    dateFormated: dateFormated.value
  })
  showMenu.value = false
}

function today(){
  update(new Date())
}

</script>

<template>
  <v-text-field
    :model-value="dateFormated"
    variant="outlined"
    :label="props.textFieldLabel"
    prepend-icon="mdi-calendar-month-outline"
    readonly
  >
    <v-menu
      v-model="showMenu"
      :close-on-content-click="false"
      activator="parent"
      min-width="0"
    >
      <v-card>
        <v-date-picker
          :model-value="time"
          hide-header
          :max="props.max"
          :min="props.min"
          @update:model-value="update"
        />
        <div
          class="w-100 d-flex justify-end px-5 pb-2"
        >
          <v-btn
            variant="outlined"
            color="primary"
            @click="today"
          >
            Dnes
          </v-btn>
        </div>
      </v-card>
    </v-menu>
  </v-text-field>
</template>

<style scoped>

</style>
