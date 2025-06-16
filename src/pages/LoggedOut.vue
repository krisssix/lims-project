<script setup lang="ts">
import {auth} from "@/stores/auth";
</script>

<template>
  <v-container class="fill-height d-flex flex-column align-center justify-center text-center">
    <p class="text-h6">Byli jste odhlášeni.</p>
    <v-btn color="primary" class="mt-2" @click="auth.login('/auth/projects')">
      Přihlásit se
    </v-btn>
  </v-container>
</template>

<style scoped>

</style>
