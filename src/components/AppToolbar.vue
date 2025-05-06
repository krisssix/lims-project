<script setup lang="ts">

import {useProjectStore} from "@/stores/project/project";
import {computed} from "vue";

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
    <v-btn prepend-icon="mdi-arrow-left" @click="navigate" variant="text">{{ name }}</v-btn>
  </v-app-bar-title>

  <template v-slot:append>
    <v-btn icon="mdi-account">
    </v-btn>
  </template>
</v-app-bar>
</template>

<style scoped lang="sass">

</style>
