<script setup lang="ts">
import Dialog from "@/components/Dialog.vue";
import {useBoardStore} from "@/stores/board/board";
import {computed, ref} from "vue";

const props = defineProps(['isOpen'])
const emit = defineEmits(['cancelCard','saveCard'])

const {openedCard, cardFetchLoading, openedCardCopy, changeCardDescription, changeCardName } = useBoardStore()

function onCancel(){
  emit('cancelCard')
}

function onSave(){
  emit('saveCard')
}

const isNew = computed(() => {
  return openedCard.id === null;
})

const loading = computed(()=>{
  return cardFetchLoading
})

function updateDescription(){
  if(!isNew.value && openedCardCopy.description !== openedCard.description){
    changeCardDescription(openedCard.description, openedCard.id)
  }
}

function updateName(){
  if(!isNew.value && openedCardCopy.name !== openedCard.name){
    changeCardName(openedCard.name, openedCard.id, openedCard.boardListId)
  }
}


</script>

<template>
  <Dialog :hide-footer="true" :is-open="props.isOpen" :width="null" v-if="loading">
    <template v-slot:content>
      <v-row align-content="center" style="height: calc(100vh - 200px)">
        <v-col class="d-flex justify-center" cols="12">
            <v-progress-circular
              :size="50"
              color="primary"
              indeterminate
            ></v-progress-circular>
        </v-col>
      </v-row>
    </template>
  </Dialog>

  <Dialog
    v-else
    :hide-footer="!isNew"
    :is-open="props.isOpen"
    :width="null">
    <template v-slot:header>
      <div class="w-100 d-flex align-center justify-space-between">
        <input
          type="text"
          class="card-name-input pl-0 py-2 ml-3"
          placeholder="Název karty"
          v-model="openedCard.name"
          @blur="updateName"
        />
        <v-btn v-if="!isNew" @click="onCancel" icon="mdi-close" variant="text">
        </v-btn>
      </div>
    </template>
    <template v-slot:content>
      <v-row>
        <v-col cols="6" >
          <div class="text-subtitle-1 font-weight-bold ">Člen</div>
          <v-combobox
            class="pt-2"
            variant="outlined"
            hide-details
          >
          </v-combobox>
          <div class="text-subtitle-1 font-weight-bold pb-2 pt-5">Měření</div>
          <v-btn variant="tonal" color="primary">Přidat měření</v-btn>
          <div class="text-subtitle-1 font-weight-bold pt-5">Popis</div>
          <v-textarea @blur="updateDescription" v-model="openedCard.description" class="pt-2" color="primary" variant="outlined"></v-textarea>

          <div class="text-subtitle-1 font-weight-bold pb-2 pt-5">Komentáře</div>
          <div class="d-flex ga-2">
            <v-btn variant="outlined" color="primary" prepend-icon="mdi-at">Zmínit</v-btn>
            <v-btn variant="outlined" color="primary" prepend-icon="mdi-link-variant">Odkaz</v-btn>
          </div>
          <div class="d-flex pt-3 ga-2">
            <v-avatar color="#f1f1f1">
              <span>CJ</span>
            </v-avatar>
            <v-text-field placeholder="Napsat komentář" variant="outlined" density="compact"></v-text-field>
          </div>
          <div class="text-subtitle-1 font-weight-bold pt-5 pb-2"> Záznam aktivit</div>
          <v-tabs color="primary">
            <v-tab :value="1">Události</v-tab>
            <v-tab :value="2">Odpracované hodiny</v-tab>
          </v-tabs>

        </v-col>
        <v-col cols="6">

        </v-col>
      </v-row>
    </template>
    <template v-slot:footer>
      <v-btn @click="onCancel" variant="text">Zrušit</v-btn>
      <v-btn @click="onSave" color="primary" variant="flat">Uložit</v-btn>
    </template>
  </Dialog>
</template>



<style scoped>

.card-name-input {
  border: 1px solid transparent;
  border-radius: 4px;
  outline: none;
  width: calc(50% - 30px);
}

.card-name-input:focus {
  border: 1px solid #EDEDED;
}
</style>
