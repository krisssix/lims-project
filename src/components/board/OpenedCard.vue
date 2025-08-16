<script setup lang="ts">
import Dialog from "@/components/Dialog.vue";
import {useBoardStore} from "@/stores/board/board";
import {computed, ref} from "vue";
import {auth} from "@/stores/auth";
import {useCardTimerStore} from "@/stores/board/cardTimer";

const props = defineProps(['isOpen','projectMembers'])
const emit = defineEmits(['cancelCard','saveCard'])

const {openedCard, cardFetchLoading, openedCardCopy, changeCardDescription, changeCardName, changeCardMember, fetchComments, createComment } = useBoardStore()
const {fetchTimeRecords, setTimeForTimer } = useCardTimerStore()

function onCancel(){
  emit('cancelCard')
}

function onSave(){
  emit('saveCard')
}

const comment = ref('')
const tab = ref(null)

const isNew = computed(() => {
  return openedCard.id === null;
})

const loading = computed(()=>{
  return cardFetchLoading
})

const members = computed(() => props.projectMembers)
const comments = computed(() => openedCard.comments)

watch(() => isNew.value,
  async (isNew) => {
    if (!isNew) {
      if(props.isOpen){
        const responseComments = await fetchComments(openedCard.id)
        openedCard.comments = [...responseComments]
        await setTimer()
      }
    }
  }
)

async function setTimer(){
  await fetchTimeRecords(openedCard.id)
  await setTimeForTimer()
}

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

function updateMember(member){
  openedCard.member = member
  if(!isNew.value && openedCardCopy.member !== openedCard.member){
    changeCardMember(member ? member.username : null, openedCard.id, openedCard.boardListId)
  }
}

async function submitComment(){
  if(comment.value.trim().length > 0 && !isNew.value){
    const response = await createComment(comment.value, auth.getUserInfo().preferredUsername, openedCard.id)
    comment.value = ''
    openedCard.comments.push(response)
  }
}

function initials(name){
  return name[0].toUpperCase()
}
</script>

<template>
  <Dialog
    v-if="loading"
    :hide-footer="true"
    :is-open="props.isOpen"
    :width="null"
  >
    <template #content>
      <v-row
        align-content="center"
        style="height: calc(100vh - 200px)"
      >
        <v-col
          class="d-flex justify-center"
          cols="12"
        >
          <v-progress-circular
            :size="50"
            color="primary"
            indeterminate
          />
        </v-col>
      </v-row>
    </template>
  </Dialog>

  <Dialog
    v-else
    :hide-footer="!isNew"
    :is-open="props.isOpen"
    :width="null"
  >
    <template #header>
      <div class="w-100 d-flex align-center justify-space-between">
        <input
          v-model="openedCard.name"
          type="text"
          class="card-name-input pl-0 py-2 ml-3"
          placeholder="Název karty"
          @blur="updateName"
        >
        <div class="d-flex ga-2 align-center">
          <Timer
            v-if="!isNew"
            :card-id="openedCard.id"
          />
          <v-btn
            v-if="!isNew"
            icon="mdi-close"
            variant="text"
            @click="onCancel"
          />
        </div>
      </div>
    </template>
    <template #content>
      <v-row>
        <v-col cols="6">
          <div class="text-subtitle-1 font-weight-bold ">
            Člen
          </div>
          <v-combobox
            class="pt-2"
            variant="outlined"
            :items="members"
            clearable
            item-title="username"
            return-object
            hide-details
            :model-value="openedCard.member"
            @update:model-value="value => updateMember(value)"
          />
          <div class="text-subtitle-1 font-weight-bold pb-2 pt-5">
            Měření
          </div>
          <v-btn
            variant="tonal"
            color="primary"
          >
            Přidat měření
          </v-btn>
          <div class="text-subtitle-1 font-weight-bold pt-5">
            Popis
          </div>
          <v-textarea
            v-model="openedCard.description"
            class="pt-2"
            color="primary"
            variant="outlined"
            @blur="updateDescription"
          />

          <div class="text-subtitle-1 font-weight-bold pb-2 pt-5">
            Komentáře
          </div>
          <div class="d-flex ga-2">
            <v-btn
              variant="outlined"
              color="primary"
              prepend-icon="mdi-at"
            >
              Zmínit
            </v-btn>
            <v-btn
              variant="outlined"
              color="primary"
              prepend-icon="mdi-link-variant"
            >
              Odkaz
            </v-btn>
          </div>
          <div class="d-flex pt-3 ga-2">
            <v-avatar color="#f1f1f1">
              <span>{{ initials(auth.getUserInfo().preferredUsername) }}</span>
            </v-avatar>
            <v-text-field
              v-model="comment"
              placeholder="Napsat komentář"
              variant="outlined"
              density="compact"
              @keydown.enter="submitComment"
            />
          </div>

          <comment-row
            v-for="comm in comments"
            :key="comm.id"
            :comment="comm"
          />
        </v-col>
        <v-col cols="6" />
      </v-row>
      <div class="text-subtitle-1 font-weight-bold pt-5 pb-2">
        Záznam aktivit
      </div>
      <v-tabs
        v-model="tab"
        color="primary"
      >
        <v-tab value="events">
          Události
        </v-tab>
        <v-tab value="hoursWorked">
          Odpracované hodiny
        </v-tab>
      </v-tabs>
      <v-tabs-window v-model="tab">
        <v-tabs-window-item value="events" />
        <v-tabs-window-item value="hoursWorked">
          <timer-table class="pt-2" />
        </v-tabs-window-item>
      </v-tabs-window>
    </template>
    <template #footer>
      <v-btn
        variant="text"
        @click="onCancel"
      >
        Zrušit
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        @click="onSave"
      >
        Uložit
      </v-btn>
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
