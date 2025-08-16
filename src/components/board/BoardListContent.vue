<script setup lang="ts">
import { VueDraggableNext as draggable } from 'vue-draggable-next'
import {computed, ref} from "vue";
import {useBoardStore} from "@/stores/board/board";
import {formatMs} from "../../utils/timeFormat";

const boardStore = useBoardStore()

const props = defineProps({
  cards: Array,
  isFiltered: Boolean
})

const emit = defineEmits(['openCard'])

const cards_ref = ref([])

watch(() => props.cards, (newCards) => {
  cards_ref.value = newCards
}, { immediate: true })

function cardMoved(event){
  const fromListId = parseInt(event.from.getAttribute('list-id'))
  const toListId = parseInt(event.to.getAttribute('list-id'))

  if(fromListId === toListId){
    changeInOneList()
  } else {
    let changedCards = []

    changeOrderFromCurrentList(changedCards)

    const movedCardNewIndex = parseInt(event.newIndex)
    let movedCard = findAndSetMovedCard(movedCardNewIndex, toListId)
    changedCards.push(movedCard)

    const { toListIndex, fromListIndex, toList } = findListsInfo(toListId, fromListId)

    let toListCards = []
    // if the list is empty, the only card id the moved one
    if (toList.cards.length === 0){
      toListCards.push(movedCard)
    } else {
      toList.cards.forEach((card,index) => {
        if(index >= movedCardNewIndex){
          if(index === movedCardNewIndex){
            toListCards.push(movedCard)
          }
          // cards after the moved one
          card.cardOrder = index + 1
          changedCards.push(card)
          toListCards.push(card)
        } else {
          // cards before the moved one
          toListCards.push(card)
        }
      })
      // if the card is moved to the end of list
      if((toList.cards.length - 1) < movedCardNewIndex){
        toListCards.push(movedCard)
      }
    }

    // send to backend
    boardStore.cardsOrderChanged(changedCards)

    // update lists frontend
    boardStore.replaceCards(fromListIndex, cards_ref.value)
    boardStore.replaceCards(toListIndex, toListCards)

  }
}

function findListsInfo(toListId, fromListId){
  let toListIndex, fromListIndex, toList  = null
  boardStore.lists.forEach((list, index) => {
    if(list.id === toListId){
      toListIndex = index
      toList = list
    }
    if (list.id === fromListId){
      fromListIndex = index
    }
  })
  return {toListIndex, fromListIndex, toList}
}

function changeInOneList(){
    let changedCards = []
    cards_ref.value.forEach((card, index) => {
      if (card.cardOrder !== index){
        card.cardOrder = index
        changedCards.push(card)
      }
    })
    if (changedCards.length > 0){
      boardStore.cardsOrderChanged(changedCards)
    }
}

function changeOrderFromCurrentList(changedCards){
  cards_ref.value.forEach((card, index) => {
    if (card.cardOrder !== index){
      card.cardOrder = index
      changedCards.push(card)
    }
  })
}

function findAndSetMovedCard(movedCardNewIndex, toListId){
  let movedCard = props.cards.find(card => !cards_ref.value.some(card_ref => card.id === card_ref.id))
  movedCard.cardOrder = movedCardNewIndex
  movedCard.boardListId = toListId
  return movedCard
}

function initials(name){
  return name[0].toUpperCase()
}

function getMembers(card) {
  let members = []
  if(card.memberUsername){
    card.cardTimerGroupedByUsernameList.forEach(timerGrouped => {
      if(timerGrouped.username === card.memberUsername){
        members.unshift(timerGrouped ? timerGrouped : {username: card.memberUsername, sumTime: null})
      } else {
        members.push(timerGrouped)
      }
    })
    if(card.cardTimerGroupedByUsernameList.findIndex(timerGrouped => timerGrouped.username === card.memberUsername) === -1){
      members.unshift({username: card.memberUsername, sumTime: null})
    }
  } else {
    members.push(...card.cardTimerGroupedByUsernameList)
  }
  return members
}

</script>

<template>
  <draggable
    v-model="cards_ref"
    :options="{ group: 'cards' }"
    group="cards"
    ghostClass="ghost"
    @end="cardMoved">
    <span
      class="element-card"
      v-for="(card, index) in cards_ref"
      :key="index"
      :id="card.id"
      @click="emit('openCard',{id: card.id})"
    >
      {{ card.name }}
      <div :key="m.username" v-for="m in getMembers(card)" class="d-flex w-100 align-center justify-space-between mt-1">
        <div class="font-weight-light">
          {{ m.sumTime ? formatMs(m.sumTime) : null }}
        </div>
        <div :class="`background-circle d-flex align-center justify-center bg-grey-lighten-2 ${m.username === card.memberUsername && 'circle-border' }`">
          {{ initials(m.username) }}
        </div>
      </div>
    </span>
  </draggable>
</template>

<style scoped>
.element-card {
  position: relative;
  background-color: white;
  height: auto;
  display: flex;
  flex-direction: column;
  align-items: start;
  padding: 10px;
  border-radius: 5px;
  min-height: 30px;
  margin-bottom: 10px;
  word-break: break-all;
  text-align: left;
  border: solid 1px #cfcfcf;
}

.element-card:hover {
  border: solid 1px #5C5C5C;
}

.background-circle {
  height: 1.8em;
  width: 1.8em;
  border-radius: 100%;
}

.circle-border {
  border: 2px solid #0277BD;
}

</style>
