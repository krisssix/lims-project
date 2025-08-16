<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useBoardStore} from "@/stores/board/board";
import BoardListContent from "@/components/board/BoardListContent.vue";

const boardStore = useBoardStore()
const { listNameCopy } = storeToRefs(boardStore)

async function changeColumnName(event, listId){
  const name = event.target.value
  if(name.trim()){
    await boardStore.changeColumnName(listId, name)
  } else {
    boardStore.setListName(listId, listNameCopy.value)
  }
}

function onFocus(event){
  listNameCopy.value = event.target.value
}
</script>

<template>
  <div
    v-for="(list, index) in boardStore.lists"
    :key="index"
    class="list-card"
  >
    <div class="list-header py-2 ga-2 cursor-pointer text-black">
      <div class="py-1 px-1 rounded-lg options-dots d-flex">
        <v-icon icon="mdi-dots-horizontal" />
      </div>
      <input
        v-model="list.name"
        class="list-name-input"
        @focus="onFocus"
        @blur="event => changeColumnName(event, list.id)"
      >
    </div>
    <div class="list-content cursor-pointer text-black">
      <board-list-content
        :is-filtered="isMyCardsOnly"
        :cards="list.cards"
        :list-id="list.id"
        :list-name="list.name"
        @open-card="args => openCard(args.id, list.id)"
      />
    </div>
    <div class="list-footer cursor-pointer px-2 py-2">
      <div
        class="d-flex ga-2 cursor-pointer px-2 py-2 rounded-lg add-card"
        @click="openCard(null, list.id)"
      >
        <v-icon icon="mdi-plus" />
        <span>Přidat kartu</span>
      </div>
    </div>
  </div>
</template>

<style>
.ghost {
  opacity: 0.5;
}
</style>

<style scoped>
.list-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 300px;
}

.list-header {
  position: relative;
  display: flex;
  justify-content: start;
  word-break: break-all;
  align-items: center;
  min-width: 280px;
  max-width: 280px;
  line-height: 50px;
  font-weight: 700;
  background-color: #EDEDED;
  padding: 0px 10px 0px 10px;
  border-radius: 10px 10px 0px 0px;
  user-select: none;
}

.list-content {
  overflow-y: scroll;
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 280px;
  max-width: 280px;
  height: auto;
  padding: 0px 10px 0px 10px;
  background-color: #EDEDED;
  box-shadow: 1.5px 1.5px 1.5px 0.1px rgba(255, 255, 255, 0.1);
}

.list-footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: start;
  width: 280px;
  border-radius: 0px 0px 10px 10px;
  color: black;
  background-color: #EDEDED;
}

.add-card:hover {
  background-color: #cfcfcf;
}

.options-dots:hover {
  background-color: #cfcfcf;
}

.list-name-input {
  border: 1px solid transparent;
  border-radius: 4px;
  outline: none;
  padding: 4px 8px;
  line-height: 0.2;
}

.list-name-input:focus {
  border: 1px solid #ffffff;
}
</style>
