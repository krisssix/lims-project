<script setup lang="ts">
import {onMounted, ref} from "vue";
import {useProjectStore} from "@/stores/project";
import {myCustomLightTheme} from "@/plugins/vuetify";
import Dialog from "@/components/Dialog.vue";

const projectStore = useProjectStore()
const router = useRouter()

const openCreateProjectDialog = ref(false)

onMounted(async ()=>{
  await projectStore.fetchAllProjects()
})

function cancelCreateProject(){
  openCreateProjectDialog.value = false
  projectStore.clearProject()
}

async function submitCreateProject(){
  openCreateProjectDialog.value = false
  await projectStore.saveProject(projectStore.blankProject)
  await projectStore.clearProject()
  await projectStore.fetchAllProjects()
}


</script>

<template>
  <Dialog
    :is-open="openCreateProjectDialog"
    :width="null">
    <template v-slot:header>
      Vytvoření projektu
    </template>
    <template v-slot:content>
      <ProjectForm
        :is-new="true"
        :project="projectStore.blankProject"
      />
    </template>
    <template v-slot:footer>
      <v-btn @click="cancelCreateProject" variant="text">Zrušit</v-btn>
      <v-btn @click="submitCreateProject" color="primary" variant="flat">Vytvořit</v-btn>
    </template>
  </Dialog>
  <v-row class="w-100" >
    <v-col cols="auto">
      <v-btn
        @click="openCreateProjectDialog = true"
        color="primary"
        variant="tonal"
      >
        Vytvořit nový projekt
      </v-btn>
    </v-col>
  </v-row>

<v-row >
  <v-col cols="3" v-for="project in projectStore.allProjects" :key="project.id">
    <v-card :title="project.name" :color="project.color" :subtitle="project.description">
    </v-card>
  </v-col>
</v-row>
</template>

<style scoped lang="sass">

</style>
