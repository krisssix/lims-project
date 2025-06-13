<template>
  <v-app>
    <div v-if="userIsLoading">Loading user..</div>
    <div v-else>
      User loaded
    </div>
    <button @click="auth.login('/auth/projects')">Log in</button>

    <RouterLink to="/auth/projects">projects</RouterLink>

    <router-view />
  </v-app>
</template>

<script lang="ts" setup>

import {authInstance, userIsLoading} from "@/auth";

const auth = authInstance;


</script>
