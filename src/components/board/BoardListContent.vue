<script setup lang="ts">
import { VueDraggableNext as draggable } from 'vue-draggable-next'
import {watch, ref} from "vue";
import {useBoardStore} from "@/stores/board/board";
import {formatMs} from "../../utils/timeFormat";

const boardStore = useBoardStore()

type MemberGroup = {
  username?: string
  sumTime?: number | null
}

type Card = {
  id: number | string
  name?: string
  cardOrder?: number
  boardListId?: number
  memberUsername?: string
  cardTimerGroupedByUsernameList?: MemberGroup[] | null
  // ... případně další pole, která v appce máte
}

const props = defineProps<{
  cards: Card[]
  isFiltered: boolean
}>()

const emit = defineEmits<{
  (e: 'openCard', payload: { id: Card['id'] }): void
}>()

const cards_ref = ref<Card[]>([])

watch(
  () => props.cards,
  (newCards) => {
    cards_ref.value = Array.isArray(newCards) ? [...newCards] : []
  },
  { immediate: true }
)

function cardMoved(event: any) {
  const fromListId = parseInt(event.from.getAttribute('list-id'))
  const toListId = parseInt(event.to.getAttribute('list-id'))

  if (fromListId === toListId) {
    changeInOneList()
    return
  }

  const changedCards: Card[] = []

  changeOrderFromCurrentList(changedCards)

  const movedCardNewIndex = parseInt(event.newIndex)
  const movedCard = findAndSetMovedCard(movedCardNewIndex, toListId)
  if (!movedCard) {
    // bezpečnostní pojistka – nic neposílej, když nevíme co se hýblo
    return
  }
  changedCards.push(movedCard)

  const { toListIndex, fromListIndex, toList } = findListsInfo(toListId, fromListId)

  if (
    typeof toListIndex === 'undefined' ||
    typeof fromListIndex === 'undefined' ||
    !toList
  ) {
    // když se nepodaří najít listy, nepokračuj
    return
  }

  const toListCards: Card[] = []
  if (toList.cards.length === 0) {
    // list byl prázdný
    toListCards.push(movedCard)
  } else {
    toList.cards.forEach((card: Card, index: number) => {
      if (index >= movedCardNewIndex) {
        if (index === movedCardNewIndex) {
          toListCards.push(movedCard)
        }
        // karty po přesunuté
        card.cardOrder = index + 1
        changedCards.push(card)
        toListCards.push(card)
      } else {
        // karty před přesunutou
        toListCards.push(card)
      }
    })

    // když se přesune na úplný konec
    if ((toList.cards.length - 1) < movedCardNewIndex) {
      toListCards.push(movedCard)
    }
  }

  // pošli změny do backendu
  boardStore.cardsOrderChanged(changedCards)

  // a aktualizuj store lokálně
  boardStore.replaceCards(fromListIndex, cards_ref.value)
  boardStore.replaceCards(toListIndex, toListCards)
}

function findListsInfo(toListId: number, fromListId: number) {
  let toListIndex: number | undefined
  let fromListIndex: number | undefined
  let toList: any = null

  boardStore.lists.forEach((list: any, index: number) => {
    if (list.id === toListId) {
      toListIndex = index
      toList = list
    }
    if (list.id === fromListId) {
      fromListIndex = index
    }
  })
  return { toListIndex, fromListIndex, toList }
}

function changeInOneList() {
  const changedCards: Card[] = []
  cards_ref.value.forEach((card, index) => {
    if (card.cardOrder !== index) {
      card.cardOrder = index
      changedCards.push(card)
    }
  })
  if (changedCards.length > 0) {
    boardStore.cardsOrderChanged(changedCards)
  }
}

function changeOrderFromCurrentList(changedCards: Card[]) {
  cards_ref.value.forEach((card, index) => {
    if (card.cardOrder !== index) {
      card.cardOrder = index
      changedCards.push(card)
    }
  })
}

function findAndSetMovedCard(movedCardNewIndex: number, toListId: number): Card | null {
  // karta, která chybí v cards_ref oproti props.cards, je ta přesunutá
  const moved = props.cards.find(
    (card) => !cards_ref.value.some((c) => c.id === card.id)
  )
  if (!moved) return null
  moved.cardOrder = movedCardNewIndex
  moved.boardListId = toListId
  return moved
}

function initials(name?: string) {
  const n = typeof name === 'string' && name.length ? name : '?'
  return n[0].toUpperCase()
}

function getMembers(card: Card): MemberGroup[] {
  const groups: MemberGroup[] = Array.isArray(card?.cardTimerGroupedByUsernameList)
    ? card.cardTimerGroupedByUsernameList.filter(Boolean)
    : []

  const members: MemberGroup[] = []
  const preferred = card?.memberUsername

  if (preferred) {
    const idx = groups.findIndex((g) => g?.username === preferred)
    if (idx >= 0) {
      // preferovaného dej dopředu
      members.push(groups[idx]!)
      groups.forEach((g, i) => {
        if (i !== idx) members.push(g)
      })
    } else {
      // preferovaný neexistuje v datech → doplň placeholder dopředu
      members.push({ username: preferred, sumTime: null })
      members.push(...groups)
    }
  } else {
    members.push(...groups)
  }
  return members
}
</script>

<template>
  <draggable
    v-model="cards_ref"
    :options="{ group: 'cards' }"
    group="cards"
    ghost-class="ghost"
    @end="cardMoved"
  >
    <span
      v-for="(card, index) in cards_ref"
      :id="card?.id"
      :key="card?.id ?? `card-${index}`"
      class="element-card"
      @click="emit('openCard', { id: card?.id })"
    >
      {{ card?.name }}

      <div
        v-for="(m, mIdx) in getMembers(card)"
        :key="m?.username ?? `u-${mIdx}`"
        class="d-flex w-100 align-center justify-space-between mt-1"
      >
        <div class="font-weight-light">
          {{ m?.sumTime ? formatMs(m.sumTime) : null }}
        </div>
        <div
          :class="[
            'background-circle','d-flex','align-center','justify-center','bg-grey-lighten-2',
            m?.username === card?.memberUsername ? 'circle-border' : ''
          ]"
        >
          {{ initials(m?.username) }}
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
