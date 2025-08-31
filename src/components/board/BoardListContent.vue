<script setup lang="ts">
import {VueDraggableNext as draggable} from 'vue-draggable-next'
import {ref} from "vue";
import {useBoardStore} from "@/stores/board/board";
import {formatMs} from "../../utils/timeFormat";

const boardStore = useBoardStore()

const props = defineProps({
  cards: Array
})

const emit = defineEmits(['openCard'])

const cards_ref = ref([])

watch(() => props.cards, (newCards) => {
  cards_ref.value = newCards
}, { immediate: true })

async function cardMoved(event){
  const fromListId = parseInt(event.from.getAttribute('list-id'))
  const toListId = parseInt(event.to.getAttribute('list-id'))

  let movedCard = event.item._underlying_vm_
  const movedCardNewIndex = event.newIndex


  if(fromListId === toListId){
    if(boardStore.isBoardFiltered){
      await changeInOneListFiltered(movedCard, movedCardNewIndex)
    } else {
      await changeInOneList()
    }
  } else {
    if(boardStore.isBoardFiltered){
      let changedCards = []
      const { toListIndex, fromListIndex, toList } = findListsInfo(toListId, fromListId)

      // from list - remove
      boardStore.listsCopy.at(fromListIndex).cards = boardStore.listsCopy.at(fromListIndex).cards.filter(card => card.id !== movedCard.id)
      boardStore.listsCopy.at(fromListIndex).cards.forEach((card, index) => {
        if(card.cardOrder !== index){
          card.cardOrder = index
          changedCards.push(card)
        }
      })
      // to list - add
      boardStore.lists.at(toListIndex).cards.splice(movedCardNewIndex, 0, movedCard)
      const filteredCards = boardStore.lists.at(toListIndex).cards

      const { neighbor, direction } = findNeighbor(movedCardNewIndex, filteredCards)

      if(neighbor){
        const listIndex = boardStore.listsCopy.findIndex(list => list.id === neighbor.boardListId);
        const list = boardStore.listsCopy[listIndex];
        const listCardsCopy = list.cards

        const neighborCardIndexInCopy = listCardsCopy.findIndex(card => card.id === neighbor.id)

        insertElementAt(movedCard, listIndex, neighborCardIndexInCopy)

        boardStore.listsCopy.at(toListIndex).cards.forEach((card, index) => {
          if(card.cardOrder !== index){
            card.cardOrder = index
            changedCards.push(card)
          }
        })
        await boardStore.cardsOrderChanged(changedCards)
      } else {
        // empty filtered list, new card is pushed in the end of the list of original list
        movedCard.cardOrder = boardStore.listsCopy.at(toListIndex).cards.length
        boardStore.listsCopy.at(toListIndex).cards.push(movedCard)
        await boardStore.cardsOrderChanged(changedCards)
      }
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
      await boardStore.cardsOrderChanged(changedCards)

      // update lists frontend
      boardStore.replaceCards(fromListIndex, cards_ref.value)
      boardStore.replaceCards(toListIndex, toListCards)
      boardStore.copyLists()
      boardStore.sortListCardsInCopy(fromListIndex)
      boardStore.sortListCardsInCopy(toListIndex)
    }
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

async function changeInOneList(){
      let changedCards = []
      cards_ref.value.forEach((card, index) => {
        if (card.cardOrder !== index){
          card.cardOrder = index
          changedCards.push(card)
        }
      })
      if (changedCards.length > 0){
        await boardStore.cardsOrderChanged(changedCards)
        boardStore.copyLists()
        const listIndex = boardStore.lists.findIndex(list=> list.id === changedCards.at(0).boardListId)
        boardStore.sortListCardsInCopy(listIndex)
      }
}

async function changeInOneListFiltered(movedCard, movedCardNewIndex){
  const { neighbor, direction } = findNeighbor(movedCardNewIndex, cards_ref.value)
  const listIndex = boardStore.listsCopy.findIndex(list => list.id === neighbor.boardListId);
  const list = boardStore.listsCopy[listIndex];
  const listCardsCopy = list.cards

  const movedCardIndexInCopy = listCardsCopy.findIndex(card => card.id === movedCard.id)
  const neighborCardIndexInCopy = listCardsCopy.findIndex(card => card.id === neighbor.id)

  moveElement(listIndex, movedCardIndexInCopy, neighborCardIndexInCopy)

  let changedCards = []
  boardStore.listsCopy.at(listIndex).cards.forEach((card, index) => {
    if(card.cardOrder !== index){
      card.cardOrder = index
      changedCards.push(card)
    }
  })
  if (changedCards.length > 0){
    await boardStore.cardsOrderChanged(changedCards)
  }
}

function moveElement(listIndex, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const element = boardStore.listsCopy.at(listIndex).cards.splice(fromIndex, 1)[0];
  boardStore.listsCopy.at(listIndex).cards.splice(toIndex, 0, element);
}

function insertElementAt(element, listIndex, toIndex){
  boardStore.listsCopy.at(listIndex).cards.splice(toIndex, 0, element)
}

function findNeighbor(index, filteredCards){
  if (filteredCards.length <= 1) {
    return { neighbor: null, direction: null }
  }

  const previous = index > 0 ? filteredCards[index - 1] : null
  const next = index < filteredCards.length - 1 ? filteredCards[index + 1] : null

  if (previous) return { neighbor: previous, direction: 'previous' }
  if (next) return { neighbor: next, direction: 'next' }

  return { neighbor: null, direction: null }
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
