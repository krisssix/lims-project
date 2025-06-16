<script setup lang="ts">

import {useProjectStore} from "@/stores/project/project";
import {computed} from "vue";
import {auth} from "@/stores/auth";

const props = defineProps(['isProjectsScreen'])
const router = useRouter()
const route = useRoute()
const {fetchProject, selectProject, selectedProject} = useProjectStore()

function navigate(){
  router.push({name: "Projects"})
}


onMounted(async () => {
  const id = route.params.projectId
  if(id !== null && !isNaN(id)){
    const project = await fetchProject(parseInt(id))
    selectProject(project)
  }
})

const name = computed(() => {
  if(selectedProject){
    return selectedProject.name
  } else{
    return ''
  }
})

const logout = () => {
  auth.logout()
}

</script>

<template>
  <v-app-bar
    elevation="0"
    color="primary"
  >
    <v-app-bar-title v-if="props.isProjectsScreen">
      CENAGRIVET
    </v-app-bar-title>
    <v-app-bar-title v-else>
      <v-btn
        prepend-icon="mdi-arrow-left"
        variant="text"
        @click="navigate"
      >
        {{ name }}
      </v-btn>
    </v-app-bar-title>

    <template #append>
      <v-menu>
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-account"
          />
        </template>
        <v-list>
          <v-list-item
            nav
            @click="logout"
          >
            Odhlásit se
          </v-list-item>
        </v-list>
      </v-menu>
    </template>
  </v-app-bar>
</template>

<style scoped lang="sass">

</style>
