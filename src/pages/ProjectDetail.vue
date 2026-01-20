<script setup lang="ts">
import {useRoute} from "vue-router";
import {onBeforeMount} from "vue";
import {useProjectStore} from "@/stores/project/project";

import { auth } from "@/stores/auth";

const route = useRoute()
const projectStore = useProjectStore()

onBeforeMount(()=>{
  setIdFromProps()
})

const props = defineProps({
  id: {
    type: [String, Number],
    default: 'new'
  }
})

function onReturn(){
  projectStore.clearProject()
}

async function onSubmit(){
  await projectStore.saveProject(projectStore.blankProjectMembers, auth.getUserInfo())
  projectStore.clearProject()

}

function setIdFromProps(){
  const id = route.params.id as string
  if(props.id !== "new"){
    projectStore.setProjectId(Number(id))
  } else {
    projectStore.setProjectId(id)
  }
}
</script>

<template>
  <!--  TODO: set existing project-->
  <project-form
    :is-new="projectStore.projectId === 'new'"
    :project="(projectStore.projectId === 'new' ? projectStore.blankProject : projectStore.blankProject) as any"
    @on-return="onReturn()"
    @on-submit="onSubmit()"
  />
</template>

<style scoped>

</style>
