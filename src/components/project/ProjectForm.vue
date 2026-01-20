<script setup lang="ts">
import {computed, nextTick, onMounted} from "vue";
import {useUserStore} from "@/stores/user/user";
import {useProjectStore} from "@/stores/project/project";
import {formatDateFromTimestamp} from "@/utils/timeFormat";

const props = defineProps({
  isNew: Boolean
})

const userStore = useUserStore()
const { blankProjectMembers } = useProjectStore()
const projectStore = useProjectStore()

const usersSelector = ref(null)
const showDateStartPicker = ref(false)
const showDateEndPicker = ref(false)
const minEndDate = computed(() => startDateDatePicker.value && startDateDatePicker.value)
const maxStartDate = computed(() => endDateDatePicker.value && endDateDatePicker.value)
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
const hardCodedColors = ref([
  'bg-indigo-darken-2',
  'bg-red-darken-2',
  'bg-cyan-darken-2',
  'bg-orange-darken-2',
  'bg-deep-purple-darken-2',
  'bg-blue-darken-2',
  'bg-teal-darken-2',
  'bg-lime-darken-2'
])

const startDateTextField = ref('')
const endDateTextField = ref('')
const startDateDatePicker = ref(null)
const endDateDatePicker = ref(null)
const fetchedUsers = ref([])

const valid = ref(false)
const emptyRuleString = value => {
  if (typeof value === 'string' && value.trim()) return true
  return "Povinné"
}
const emptyRule = value => {
  if (value !== null && value !== undefined && value !== '') return true
  return "Povinné"
}
const ruleNumber = value => {
  if (value === null || value === undefined || value === '') {
    return "Povinné"
  }
  if (/^\d+$/.test(value)) {
    return true
  }
  return "Pouze čísla"
}

onMounted(async ()=>{
  const response = await userStore.getAllUsersExcept()
  fetchedUsers.value.push(...response.items)
})

function convertToTimestamp(timeFromDatePicker){
  return new Date(timeFromDatePicker).getTime()
}

function today(){
  blankProjectMembers.project.startDate = new Date().getTime()
  startDateDatePicker.value = new Date()
  startDateTextField.value = formatDateFromTimestamp(startDateDatePicker.value)
  showDateStartPicker.value = false
}

function isObject(value) {
  return value instanceof Object;
}

function userSelected(selected){
  fetchedUsers.value = [...fetchedUsers.value.filter(user => user.email !== selected.email)];

  const selectedColor = hardCodedColors.value[0]
  // selectedUsers.value.push({
  //   ...selected,
  //   salary: null,
  //   color: selectedColor
  // })
  blankProjectMembers.members.push({
    ...selected,
    salary: null,
    color: selectedColor
  })
  hardCodedColors.value = [...hardCodedColors.value.filter(col => col !== selectedColor)]

  // clear search
  search.value = null
  usersSelector.value.blur()
}

function userRemoved(removed){
  fetchedUsers.value.push({
    ...removed,
    color: null,
    salary: null
  })
  hardCodedColors.value.push(removed.color)
  //selectedUsers.value = [...selectedUsers.value.filter(user => user.email !== removed.email)]
  blankProjectMembers.members = [...blankProjectMembers.members.filter(user => user.username !== removed.username)]
}

function selectColor(name){
  blankProjectMembers.project.color = name
}

function isSelected(color){
  if (color === blankProjectMembers.project.color){
    return ' selectedProjectColorBorder'
  } else {
    return  ''
  }
}

function boardTemplateSelected(value){
  blankProjectMembers.project.boardTemplate = value
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
  <v-form v-model="projectStore.isProjectFormValid">
    <!-- NAME -->
    <v-text-field
      v-model="blankProjectMembers.project.name"
      hide-details
      :rules="[emptyRuleString]"
      color="primary"
      class="pt-5"
      label="Název"
      variant="outlined"
    />

    <!-- DESCRIPTION -->
    <v-textarea
      v-model="blankProjectMembers.project.description"
      hide-details
      :rules="[emptyRuleString]"
      color="primary"
      class="pt-5"
      label="Popis"
      variant="outlined"
    />

    <!-- START DATE -->
    <v-dialog
      v-model="showDateStartPicker"
      width="auto"
    >
      <v-card title="Datum zahájení">
        <v-date-picker
          v-model="startDateDatePicker"
          color="primary"
          show-adjacent-months
          hide-header
          first-day-of-week="1"
          :max="maxStartDate"
          @update:model-value="(value)=>{
            blankProjectMembers.project.startDate = convertToTimestamp(value)
            startDateTextField = formatDateFromTimestamp(value)
            showDateStartPicker = false
          }"
        />
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="outlined"
            color="primary"
            @click="today()"
          >
            Dnes
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-text-field
      :rules="[emptyRuleString]"
      hide-details
      class="pt-5"
      variant="outlined"
      readonly
      prepend-inner-icon="mdi-calendar-month-outline"
      label="Datum zahájení"
      color="primary"
      :model-value="startDateTextField"
      @click="showDateStartPicker = true"
    />

    <!-- END DATE -->

    <v-text-field
      :rules="[emptyRuleString]"
      hide-details
      class="pt-5"
      variant="outlined"
      readonly
      prepend-inner-icon="mdi-calendar-month-outline"
      label="Datum ukončení"
      color="primary"
      :model-value="endDateTextField"
      @click="showDateEndPicker = true"
    />

    <v-dialog
      v-model="showDateEndPicker"
      width="auto"
    >
      <v-card title="Datum ukončení">
        <v-date-picker
          v-model="endDateDatePicker"
          color="primary"
          show-adjacent-months
          hide-header
          first-day-of-week="1"
          :min="minEndDate"
          @update:model-value="(value)=>{
            blankProjectMembers.project.endDate = convertToTimestamp(value)
            endDateTextField = formatDateFromTimestamp(value)
            showDateEndPicker = false
          }"
        />
      </v-card>
    </v-dialog>

    <!-- USERS -->
    <h5 class="pt-5">
      Uživatelé
    </h5>
    <v-row class="pt-5">
      <v-col cols="6">
        <div v-if="blankProjectMembers.members.length > 0">
          <v-row
            v-for="member in blankProjectMembers.members"
            :key="member.username"
          >
            <v-col align-self="center">
              <div class="d-flex flex-row align-center">
                <v-icon
                  icon="mdi-account-circle"
                  size="x-large"
                  color="grey-darken-1"
                />
                <span class="pl-2 pr-2">{{ member.username }}</span>
                <div
                  style="width: 12px;height: 12px"
                  class="rounded-circle "
                  :class="member.color"
                />
              </div>
            </v-col>
            <v-col align-self="center">
              <div class="d-flex flex-row align-center">
                <v-text-field
                  v-model="member.salary"
                  hide-details
                  :rules="[ruleNumber]"
                  class="pr-2"
                  variant="outlined"
                  label="Plat"
                  suffix="Kč"
                />
                <v-btn
                  icon="mdi-close"
                  variant="text"
                  @click="userRemoved(member)"
                />
              </div>
            </v-col>
          </v-row>
        </div>

        <v-combobox
          ref="usersSelector"
          v-model="search"
          :class="blankProjectMembers.members.length > 0 ? 'pt-5' : ''"
          variant="outlined"
          label="Jméno uživatele"
          :items="fetchedUsers"
          item-title="username"
          return-object
          @update:model-value="selected => {
            userSelected(selected)
          }"
        />
      </v-col>
    </v-row>

    <!-- COLOR -->
    <h5>Barva</h5>
    <div class="d-flex flex-row ga-4 pt-5">
      <div
        class="circleSize rounded-circle bg-deep-orange-darken-3 "
        :class="isSelected('deep-orange-darken-3')"
        @click="selectColor('deep-orange-darken-3')"
      />
      <div
        class="circleSize rounded-circle bg-light-green-darken-3 "
        :class="isSelected('light-green-darken-3')"
        @click="selectColor('light-green-darken-3')"
      />
      <div
        class="circleSize rounded-circle bg-teal-darken-3 "
        :class="isSelected('teal-darken-3')"
        @click="selectColor('teal-darken-3')"
      />
      <div
        class="circleSize rounded-circle bg-deep-purple-darken-3 "
        :class="isSelected('deep-purple-darken-3')"
        @click="selectColor('deep-purple-darken-3')"
      />
      <div
        class="circleSize rounded-circle bg-purple-darken-3 "
        :class="isSelected('purple-darken-3')"
        @click="selectColor('purple-darken-3')"
      />
    </div>

    <!-- BOARD TEMPLATE -->
    <h5 class="pt-5">
      Šablona projektu
    </h5>
    <v-select
      :rules="[emptyRule]"
      :model-value="boardTemplate"
      class="pt-5"
      :items="boardTemplateVariants"
      item-title="title"
      item-value="value"
      variant="outlined"
      hide-details
      @update:model-value="(value) => {boardTemplateSelected(value)}"
    />
  </v-form>
</template>

<style scoped>

.selectedProjectColorBorder{
  border: #000000 solid 4px;
}

.circleSize {
  width: 38px;
  height: 38px
}

</style>
