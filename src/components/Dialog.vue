<script setup lang="ts">

import {computed} from "vue";

defineProps<{
    isOpen: boolean,
    width: string | null
}>()

const isAtTop = ref(true)
const isAtBottom = ref(false)

let scrollContainer: HTMLElement | null = null

function onScroll() {
  if (!scrollContainer) return
  const scrollTop = scrollContainer.scrollTop
  const scrollHeight = scrollContainer.scrollHeight
  const clientHeight = scrollContainer.clientHeight

  isAtTop.value = scrollTop === 0
  isAtBottom.value = scrollTop + clientHeight >= scrollHeight
}

function afterEnter(){
  scrollContainer = document.querySelector('.v-card-text')
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', onScroll)
    onScroll()
  }
}

function afterLeave(){
  if (scrollContainer) {
    scrollContainer.removeEventListener('scroll', onScroll)
  }
}

const isAtTopComp = computed(() => isAtTop.value )

const isAtBottomComp = computed(()=> isAtBottom.value )

</script>

<template>
  <v-dialog
    :width="width"
    persistent
    scrollable
    :model-value="isOpen"
    @after-enter="afterEnter"
    @after-leave="afterLeave"
  >
    <v-card>
      <v-card-title :class="isAtTopComp ? '' : 'card-title-shadow'">
        <slot name="header"></slot>
      </v-card-title>
      <v-card-text>
        <slot name="content"></slot>
      </v-card-text>
      <v-card-actions :class="isAtBottomComp ? '' : 'card-actions-shadow'">
        <slot name="footer"></slot>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.card-actions-shadow {
  box-shadow: 0 -4px 6px rgba(0,0,0,0.1)
}

.card-title-shadow {
  box-shadow: 0 4px 6px rgba(0,0,0,0.1)
}
</style>
