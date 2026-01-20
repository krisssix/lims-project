<script setup lang="ts">
</script>

<template>
  <AppToolbar :is-projects-screen="false" />
  <LeftNavigation />
  <v-main>
    <v-container :fluid="true">
      <router-view />
    </v-container>
  </v-main>
</template>

<style scoped>

</style>
