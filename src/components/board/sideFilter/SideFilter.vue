<script setup lang="ts">
import {useBoardStore} from "@/stores/board/board";

const props = defineProps({
  members: Array,
})
const emit = defineEmits(['close'])

const boardStore = useBoardStore()

const isMultiple = ref(false)
const selectedMembers = ref([])
const selectedSet = computed(() => new Set(selectedMembers.value))

function selectMember(args){
  if(!isMultiple.value){
    selectedMembers.value = args.isSelected ? [args.username] : []
  } else if(args.isSelected){
    selectedMembers.value.push(args.username)
  } else {
    selectedMembers.value = selectedMembers.value.filter(username => username !== args.username)
  }
  filterCards()
}

function filterCards(){
  if(selectedSet.value.size === 0){
    boardStore.returnOriginalLists()
  } else {
    boardStore.filterCardsByMemberUsername([...selectedSet.value])
  }
}

function isSelected(username){
  return selectedSet.value.has(username)
}

function updateIsMultiple(value){
  isMultiple.value = value
  if(!value){
    selectedMembers.value = []
    boardStore.returnOriginalLists()
  }
}

</script>

<template>
  <div class="filter-column border">
    <div class="filter-header">
      <v-checkbox-btn
        color="primary"
        label="Vícenásobný výběr"
        :model-value="isMultiple"
        @update:model-value="value => updateIsMultiple(value)"
      />
      <v-btn
        variant="text"
        size="small"
        icon="mdi-close"
        @click="emit('close')"
      />
    </div>
    <div class="filter-body">
      <side-filter-row
        :key="member.name"
        :is-member-selected="isSelected(member.username)"
        :username="member.username"
        :is-multiple="isMultiple"
        @update:selected-member="args => selectMember(args)"
        v-for="member in props.members"
      />
    </div>
    <div class="filter-footer" />
  </div>
</template>

<style scoped>

.filter-column {
  display: flex;
  flex-direction: column;
  min-width: 280px;
  max-width: 280px;
  height: 100%;
  border-radius: 10px;
  //position: absolute;
  //z-index: 10;
  //left: 20%;
  //top: 0%;
  //background-color: white;
}

.filter-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding-inline: 10px;
}

.filter-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding: 10px;
}

.filter-footer {
  flex: 0 0 auto;
  padding: 10px;
}

</style>
