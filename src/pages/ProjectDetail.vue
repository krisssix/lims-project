<script setup lang="ts">
import {useRoute} from "vue-router";
import {onBeforeMount} from "vue";
import {useProjectStore} from "@/stores/project/project";

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()

onBeforeMount(()=>{
  setIdFromProps()
})

const props = defineProps({
  id: String|Number
})

function onReturn(){
  projectStore.clearProject()
}

async function onSubmit(){
  await projectStore.saveProject(projectStore.blankProject)
  await projectStore.clearProject()

}

function setIdFromProps(){
  const id = route.params.id
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
        :project="projectStore.projectId === 'new' ? projectStore.blankProject : projectStore.blankProject"
        @onReturn="onReturn()"
        @onSubmit="onSubmit()"
      />
</template>

<style scoped>

</style>
