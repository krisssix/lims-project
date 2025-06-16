<script setup lang="ts">

</script>

<template>
  <v-container class="fill-height d-flex flex-column align-center justify-center text-center">
    <v-icon size="128" color="primary">mdi-alert-circle-outline</v-icon>
    <h1 class="text-h3 mt-4">404 - Stránka nenalezena</h1>
    <p class="text-subtitle-1">Omlouváme se, ale požadovaná stránka neexistuje.</p>
    <v-btn color="primary" class="mt-6" @click="$router.push('/')">
      Zpět na úvod
    </v-btn>
  </v-container>
</template>

<style scoped>

</style>
