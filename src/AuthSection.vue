<script setup lang="ts">
// import {useAuth} from "@/composables/useAuth";
// const auth = useAuth()

// const isAuthenticated = computed(() => auth.isAuthenticated)

</script>

<template>
  <div>
<!--    <unauthorized-state v-if="!isAuthenticated" />-->
    <router-view />
  </div>
</template>

<style scoped>

</style>
