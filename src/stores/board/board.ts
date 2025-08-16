import {defineStore} from "pinia";
import {ref} from "vue";
import {get, post, patch} from "@/services/api/api-requests";

export const useBoardStore = defineStore('board', ()=>{
  const lists = ref([])
  const listsCopy = ref([])
  const openedCard = ref({
    id: null,
    name: '',
    member: null,
    measurements: [],
    description: '',
    comments: [],
    events: [],
    boardListId: null,
    cardOrder: null
  })
  const clearOpenedCard = ref({
    id: null,
    name: '',
    member: null,
    measurements: [],
    description: '',
    comments: [],
    events: [],
    boardListId: null,
    cardOrder: null
  })
  const openedCardCopy = ref({
    id: null,
    name: '',
    member: null,
    measurements: [],
    description: '',
    comments: [],
    events: [],
    boardListId: null,
    cardOrder: null
  })
  const cardFetchLoading = ref(false)
  const listNameCopy = ref('')

  async function fetchLists(projectId){
    try {
      const data = await get('boardList/allByProject/'+projectId)
      lists.value = data.data.items
      listsCopy.value = JSON.parse(JSON.stringify(data.data.items))
    } catch (e) {
      console.error(e)
    }
  }

  async function saveList(projectId, name, listOrder){
    try {
      const data = await post('boardList/',{
        name: name,
        projectId: Number(projectId),
        listOrder: listOrder
      })
      lists.value.push({...data.data.content})
      listsCopy.value = JSON.parse(JSON.stringify(lists.value))
    } catch (e) {
      console.error(e)
    }
  }

  async function fetchCard(cardId){
    cardFetchLoading.value = true
    const response = await get(`boardCard/${cardId}`)

    Object.assign(openedCard.value, {...response.data.content})
    Object.assign(openedCardCopy.value, {...response.data.content})
    cardFetchLoading.value = false
  }

  async function saveCard(projectId){
    try {
      const data = await post('boardCard/', {
        name: openedCard.value.name,
        description: openedCard.value.description,
        cardOrder: Number(openedCard.value.cardOrder),
        projectId: Number(projectId),
        boardListId: Number(openedCard.value.boardListId),
        memberUsername: openedCard.value.member ? openedCard.value.member.username : "",
      })

      addCardToList(data.data.content.boardListId, {
        id: data.data.content.id,
        name: data.data.content.name,
        cardOrder: data.data.content.cardOrder,
        memberUsername: data.data.content.member ? data.data.content.member.username : null,
        measurements: [],
        description: '',
        comments: [],
        events: [],
        boardListId: data.data.content.boardListId,
        cardTimerGroupedByUsernameList: []
      })
    } catch (e) {
      console.error(e)
    }
  }

  function addCardToList(boardListId, card){
    const listIndex = lists.value.findIndex(list => list.id === boardListId)
    lists.value.at(listIndex).cards.push(card)
  }

  function refreshOpenedCard(){
    Object.assign(openedCard.value, clearOpenedCard.value)
  }

  async function listsOrderChanged(changedLists){
    let data = changedLists.map(list => {
      return {
        boardListId: list.id,
        newOrder: list.listOrder
      }
    })

    try{
      const response = await patch('boardList/listsOrder/', {
        listOrderRequests: data
      })
    } catch (e) {
      console.error(e)
    }
  }

  async function cardsOrderChanged(changedCards){
    let data = changedCards.map(card => {
      return {
        cardId: card.id,
        boardListId: card.boardListId,
        newOrder: card.cardOrder
      }
    })
    try {
      const response = await patch('boardCard/cardsOrder/', {
        cardOrderRequests: data
      })
    } catch (e) {
      console.error(e)
    }
  }

  function replaceCards(listIndex, cards){
    lists.value[listIndex] = {
      ...lists.value[listIndex],
      cards: [...cards]
    }
  }

  async function changeCardName(newName, cardId, boardListId){
    try {
      const response = await patch(`boardCard/name/${cardId}`,{
        name: newName
      })
      const listIndex = lists.value.findIndex(list => list.id === boardListId)
      const cardIndex = lists.value.at(listIndex).cards.findIndex(card => card.id === cardId)
      lists.value.at(listIndex).cards.at(cardIndex).name = response.data.content.name
    } catch (e) {
      console.error(e)
    }
  }

  async function changeCardDescription(newDescription, cardId){
    try {
      const response = await patch(`boardCard/description/${cardId}`, {
        description: newDescription
      })
    } catch (e) {
      console.error(e)
    }
  }

  async function changeCardMember(newMemberUsername, cardId, boardListId){
    try {
      const response = await patch(`boardCard/memberUsername/${cardId}`, {
        memberUsername: newMemberUsername !== undefined ? newMemberUsername : null
      }, {'Content-Type': 'application/json'})
      changeCardMemberInList(response.data.content.memberUsername, cardId, boardListId)
    } catch (e) {
      console.error(e)
    }
  }

  function changeCardMemberInList(newMemberUsername, cardId, boardListId){
    const listIndex = lists.value.findIndex(list => list.id === boardListId)
    const cardIndex = lists.value.at(listIndex).cards.findIndex(card => card.id === cardId)
    lists.value.at(listIndex).cards.at(cardIndex).memberUsername = newMemberUsername
  }

  async function createComment(message, username, cardId){
    try {
      const response = await post("boardCardComment", {
        message: message,
        username: username,
        cardId: cardId
      })
      return response.data.content
    } catch (e) {
      console.error(e)
    }
  }

  async function fetchComments(cardId){
    try {
      const response = await get(`boardCardComment/${cardId}`)
      return response.data.items
    } catch (e) {
      console.error(e)
    }
  }

  function filterCardsByMemberUsername(usernameList) {
    lists.value = listsCopy.value.map(list => ({
      ...list,
      cards: list.cards.filter(card => usernameList.includes(card.memberUsername))
    }))
  }
  function returnOriginalLists(){
    lists.value = JSON.parse(JSON.stringify(listsCopy.value))
  }

  function copyLists(){
    listsCopy.value = JSON.parse(JSON.stringify(lists.value))
  }

  function setListName(listId, name){
    const listIndex = lists.value.findIndex(list => list.id === listId)
    lists.value.at(listIndex).name = name
    copyLists()
  }

  async function changeColumnName(listId, name){
    try {
      await patch(`boardList/name/${listId}`, {
        name: name
      })
    } catch (e) {
      console.error(e)
    }
  }

  return {
    lists,
    openedCard,
    fetchLists,
    saveList,
    fetchCard,
    saveCard,
    refreshOpenedCard,
    listsOrderChanged,
    cardsOrderChanged,
    replaceCards,
    cardFetchLoading,
    openedCardCopy,
    changeCardName,
    changeCardDescription,
    changeCardMember,
    createComment,
    fetchComments,
    filterCardsByMemberUsername,
    returnOriginalLists,
    copyLists,
    listsCopy,
    listNameCopy,
    setListName,
    changeColumnName
  }

})
