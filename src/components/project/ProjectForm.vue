<script setup lang="ts">
import {computed, nextTick, onMounted} from "vue";

const props = defineProps({
  isNew: Boolean,
  project: Object
})

const usersSelector = ref(null)

const showDateStartPicker = ref(false)
const showDateEndPicker = ref(false)

const maxStartDate= new Date().toISOString().substr(0, 10)
const minEndDate = new Date().toISOString().substr(0, 10)

const search = ref(null)

const boardTemplate = ref(null)
const boardTemplateVariants = [
  {
    title: 'Prázdné',
    value: 'EMPTY'
  },
  {
    title: 'Kanban',
    value: 'KANBAN'
  },]

const hardcodedUsers = ref([
  {
    id: 0,
    name: 'Frank Flores',
  },
  {
    id: 1,
    name: 'Jimmy Fermin',
  },
  {
    id: 2,
    name: 'Phillip Martin',
  },
  {
    id: 3,
    name: 'Albert Dera',
  },
])

const hardCodedColors = ref([
  'bg-indigo-darken-2',
  'bg-red-darken-2',
  'bg-cyan-darken-2',
  'bg-orange-darken-2'
])

const startDateTextField = ref('')
const endDateTextField = ref('')

const startDateDatePicker = ref(null)
const endDateDatePicker = ref(null)

const users = ref([])


function convertToTimestamp(timeFromDatePicker){
  return new Date(timeFromDatePicker).getTime()
}

function formatDate(timeFromDatePicker){
  const date = new Date(timeFromDatePicker);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}. ${year}`;
}

function today(){
  props.project.startDate = new Date().getTime()
  startDateDatePicker.value = new Date()
  startDateTextField.value = formatDate(startDateDatePicker.value)
  showDateStartPicker.value = false
}

function isObject(value) {
  return value instanceof Object;
}

function userSelected(selected){
  if(isObject(selected)){
    // remove from hardcoded users

    hardcodedUsers.value = [...hardcodedUsers.value.filter(user => user.id !== selected.id)];

    // add to users
    const selectedColor = hardCodedColors.value[0]
    users.value.push({
      ...selected,
      color: selectedColor,
      salary: null
    })
    hardCodedColors.value = [...hardCodedColors.value.filter(col => col !== selectedColor)]
    // clear search
    search.value = null
    usersSelector.value.blur()
  }
}

function userRemoved(removed){
  hardcodedUsers.value.push({
    id: removed.id,
    name: removed.name,
  })
  hardCodedColors.value.push(removed.color)
  users.value = [...users.value.filter(user => user.id !== removed.id)]
}

function selectColor(name){
  props.project.color = name
}

function isSelected(color){
  if (color === props.project.color){
    return ' selectedProjectColorBorder'
  } else {
    return  ''
  }
}

function boardTemplateSelected(value){
  props.project.boardTemplate = value
  if(value === 'KANBAN'){
    boardTemplate.value = {
      title: 'Kanban',
      value: 'KANBAN'
    }
  } else {
    boardTemplate.value = {
      title: 'Prázdné',
      value: 'EMPTY'
    }
  }
}
</script>

<template>
  <v-form>

  <!-- NAME -->
  <v-text-field v-model="props.project.name" color="primary" class="pt-5" label="Název" variant="outlined"></v-text-field>

  <!-- DESCRIPTION -->
  <v-textarea v-model="props.project.description" color="primary" label="Popis" variant="outlined"></v-textarea>

  <!-- START DATE -->
  <v-dialog
    v-model="showDateStartPicker"
    width="auto"
  >
    <v-card title="Datum zahájení">

    <v-date-picker
      color="primary"
      show-adjacent-months
      hide-header
      first-day-of-week="1"
      :max="maxStartDate"
      v-model="startDateDatePicker"
      @update:modelValue="(value)=>{
          props.project.startDate = convertToTimestamp(value)
          startDateTextField = formatDate(value)
          showDateStartPicker = false
        }"
    />
      <v-card-actions>
        <v-spacer/>
        <v-btn @click="today()" variant="outlined" color="primary">
          Dnes
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-text-field
    @click="showDateStartPicker = true"
    variant="outlined"
    readonly
    prepend-inner-icon="mdi-calendar-month-outline"
    label="Datum zahájení"
    color="primary"
    :model-value="startDateTextField"
  />

  <!-- END DATE -->

  <v-text-field
    @click="showDateEndPicker = true"
    variant="outlined"
    readonly
    prepend-inner-icon="mdi-calendar-month-outline"
    label="Datum ukončení"
    color="primary"
    :model-value="endDateTextField"
  />

  <v-dialog
    v-model="showDateEndPicker"
    width="auto"

  >
    <v-card title="Datum ukončení">
      <v-date-picker
        color="primary"
        show-adjacent-months
        hide-header
        first-day-of-week="1"
        :min="minEndDate"
        v-model="endDateDatePicker"
        @update:modelValue="(value)=>{
          props.project.endDate = convertToTimestamp(value)
          endDateTextField = formatDate(value)
          showDateEndPicker = false
        }"
      />
    </v-card>
  </v-dialog>

  <!-- USERS -->
  <h5>Uživatelé</h5>
  <v-row class="pt-5">
    <v-col cols="6">
        <v-row v-if="users.length > 0" v-for="user in users" :key="user.id">
          <v-col align-self="center">
                <div class="d-flex flex-row align-center">
                  <v-icon icon="mdi-account-circle" size="x-large" color="grey-darken-1" />
                  <span class="pl-2 pr-2">{{user.name}}</span>
                  <div style="width: 12px;height: 12px" class="rounded-circle " :class="user.color"  />
                </div>
          </v-col>
          <v-col align-self="center">
            <div class="d-flex flex-row align-center">
              <v-text-field class="pr-2" hide-details variant="outlined" v-model="user.salary" label="Plat" suffix="Kč"></v-text-field>
              <v-btn @click="userRemoved(user)" icon="mdi-close"  variant="text" />
            </div>
          </v-col>
        </v-row>
        <v-combobox
          ref="usersSelector"
          :class="users.length > 0 ? 'pt-5' : ''"
          variant="outlined"
          label="Jméno uživatele"
          :items="hardcodedUsers"
          item-title="name"
          v-model="search"
          return-object
          @update:modelValue="selected => {
          userSelected(selected)
        }"
        />

    </v-col>
  </v-row>
  <!-- COLOR -->
  <h5>Barva</h5>
  <div class="d-flex flex-row ga-4 pt-5">
    <div @click="selectColor('deep-orange-darken-3')" class="circleSize rounded-circle bg-deep-orange-darken-3 " :class="isSelected('deep-orange-darken-3')" />
    <div @click="selectColor('light-green-darken-3')" class="circleSize rounded-circle bg-light-green-darken-3 " :class="isSelected('light-green-darken-3')"/>
    <div @click="selectColor('teal-darken-3')" class="circleSize rounded-circle bg-teal-darken-3 " :class="isSelected('teal-darken-3')"/>
    <div @click="selectColor('deep-purple-darken-3')" class="circleSize rounded-circle bg-deep-purple-darken-3 " :class="isSelected('deep-purple-darken-3')"/>
    <div @click="selectColor('purple-darken-3')" class="circleSize rounded-circle bg-purple-darken-3 " :class="isSelected('purple-darken-3')"/>
  </div>

    <!-- BOARD TEMPLATE -->
    <h5 class="pt-5">Šablona projektu</h5>
    <v-select
      :model-value="boardTemplate"
      class="pt-5"
      :items="boardTemplateVariants"
      @update:model-value="(value) => {boardTemplateSelected(value)}"
      item-title="title"
      item-value="value"
      variant="outlined"
      hide-details
    ></v-select>
</v-form>
</template>

<style scoped >

.selectedProjectColorBorder{
  border: #000000 solid 4px;
}

.circleSize {
  width: 38px;
  height: 38px
}

</style>
