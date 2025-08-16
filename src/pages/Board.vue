<script setup lang="ts">
import {VueDraggableNext as draggable} from 'vue-draggable-next'
import {useBoardStore} from "@/stores/board/board";
import {computed} from "vue";
import router from "@/router";
import {useProjectStore} from "@/stores/project/project";
import {auth} from "@/stores/auth";
import BoardLists from "@/components/board/BoardLists.vue";

const boardStore = useBoardStore()
const projectStore = useProjectStore()
const route = useRoute()

const loading = ref(true)
const listName = ref('')
const isCardOpen = ref(false)
const isMyCardsOnly = ref(false)
const isSideFilterOpen = ref(false)

const projectId = computed(()=>{
  return route.params.projectId;
})

onMounted(async () => {
  await boardStore.fetchLists(projectId.value)
  await projectStore.fetchProjectMembers(projectId.value)
  loading.value = false
  const openedCardId = await route.query.cardId
  if(openedCardId !== null && !isNaN(openedCardId)){
    await openCard(parseInt(openedCardId))
  }
  if(isNaN(openedCardId)){
    await router.replace({name: 'Board', query: {}})
    isCardOpen.value = false
  }
})

async function addList(){
  if(listName.value.trim() !== ''){
    await boardStore.saveList(projectId.value, listName.value, boardStore.lists.length)
    listName.value = ''
  }
}

async function openCard(cardId, boardListId){
  if(cardId === null){
    // new
    boardStore.openedCard.boardListId = boardListId
    isCardOpen.value = true
    const list = boardStore.lists.find(l => l.id === boardListId)
    boardStore.openedCard.order = list.cards.length
  } else {
    // fetch card
    isCardOpen.value = true
    await boardStore.fetchCard(cardId)
    await router.replace({name: 'Board', query: {cardId: cardId }})
  }
}

async function saveCard(){
  await boardStore.saveCard(projectId.value)
  boardStore.copyLists()
  boardStore.refreshOpenedCard()
  isCardOpen.value = false
}

function cancelCard(){
  isCardOpen.value = false
  setTimeout(() => {
    boardStore.refreshOpenedCard()
  },200)
  router.replace({name: 'Board', query: {}})
}

function listMoved(event) {
  let changedLists = []
  boardStore.lists.forEach((list,index) => {
    if(list.listOrder !== index){
      list.listOrder = index
      changedLists.push(list)
    }
  })

  if(changedLists.length > 0){
    boardStore.listsOrderChanged(changedLists)
    boardStore.copyLists()
  }
}

function toggleFilterMyCards(value){
  if(value){
    isMyCardsOnly.value = true
    boardStore.filterCardsByMemberUsername([auth.getUserInfo().preferredUsername])
  } else {
    isMyCardsOnly.value = false
    boardStore.returnOriginalLists()
  }
}

</script>

<template>
  <div class="d-flex flex-column container-height">
    <v-toolbar
      color="white"
      class="border-b-sm pl-3 pr-3"
      density="comfortable"
    >
      <v-btn
        color="primary"
        variant="tonal"
        @click="isSideFilterOpen = !isSideFilterOpen"
      >
        Procházet
      </v-btn>
      <v-checkbox-btn
        color="primary"
        :model-value="isMyCardsOnly"
        class="pl-2"
        label="Přiřazené mě"
        @update:model-value="value => toggleFilterMyCards(value)"
      />
    </v-toolbar>
    <v-container v-if="loading">
      <div class="text-center">
        <v-progress-circular
          :size="50"
          color="primary"
          indeterminate
        />
      </div>
    </v-container>
    <v-container
      v-else
      fluid
      class="overflow-x-scroll overflow-y-hidden flex flex-grow-1"
    >
      <OpenedCard
        :is-open="isCardOpen"
        :project-members="projectStore.projectMembers"
        @cancel-card="cancelCard"
        @save-card="saveCard"
      />
      <div class="fill-height d-flex">
        <v-slide-x-transition>
          <side-filter
            v-if="isSideFilterOpen"
            :members="projectStore.projectMembers"
            class="mr-7"
            @close="isSideFilterOpen = false"
          />
        </v-slide-x-transition>
        <draggable
          v-model="boardStore.lists"
          :options="{ group: 'lists' }"
          group="lists"
          ghost-class="ghost"
          class="list-draggable fill-height"
          @end="listMoved"
        >
          <board-lists />
        </draggable>
        <input
          v-model="listName"
          type="text"
          class="input-new-list"
          placeholder="Přidat sloupec"
          @keyup.enter="addList"
        >
      </div>
    </v-container>
  </div>
</template>

<style>
.ghost {
  opacity: 0.5;
}
</style>

<style scoped>

.container-height {
  height: calc(100vh - 64px) /* 64 px is navbar height*/
}

.list-draggable {
  display: flex;
  gap: 8px;
}

.input-new-list {
  display: flex;
  height: 50px;
  padding: 10px;
  border-radius: 10px;
  background-color: #EDEDED;
  min-width: 260px;
  border: 2px solid #EDEDED;
  outline: none;
  transition: border-color 0.2s ease;
}

.input-new-list::placeholder {
  color: #5C5C5C;
}
.input-new-list:focus {
  border-color: #5C5C5C !important;
}

</style>
