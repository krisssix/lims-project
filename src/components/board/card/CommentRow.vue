<script setup lang="ts">
import {computed} from "vue";

const props = defineProps(['comment'])

const comm = computed(() => props.comment )
</script>

<template>
  <div class="d-flex flex-column ga-1 pt-1">
    <div class="font-weight-medium text-grey-darken-3">
      {{ comm.username }}
    </div>
    <div class="py-1 px-2 border-sm rounded">
      {{ comment.message }}
    </div>
  </div>
</template>

<style scoped>

</style>
