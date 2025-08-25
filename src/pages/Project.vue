<script setup lang="ts">
import {onMounted, ref} from "vue";
import {useProjectStore} from "@/stores/project/project";
import Dialog from "@/components/Dialog.vue";
import {auth} from "@/stores/auth";

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
  const projectMember = await projectStore.saveProject(projectStore.blankProjectMembers, auth.getUserInfo())
  openCreateProjectDialog.value = false
  await projectStore.clearProjectMember()
  await router.push({name:'Board',params: {projectId: projectMember.projectId}})
}

function navigate(projectId){
  router.push({name:'Board',params: {projectId: projectId}})
}

</script>

<template>
  <Dialog
    :hide-footer="false"
    :is-open="openCreateProjectDialog"
    :width="null">
    <template v-slot:header>
      Vytvoření projektu
    </template>
    <template v-slot:content>
      <ProjectForm
        :is-new="true"
      />
    </template>
    <template v-slot:footer>
      <v-btn @click="cancelCreateProject" variant="text">Zrušit</v-btn>
      <v-btn
        :disabled="!projectStore.isProjectFormValid"
        color="primary"
        variant="flat"
        @click="submitCreateProject">
          Vytvořit
      </v-btn>
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
    <v-card :link="true" @click="navigate(project.id)" :title="project.name" :color="project.color" :subtitle="project.description">
    </v-card>
  </v-col>
</v-row>
</template>

<style scoped lang="sass">

</style>
