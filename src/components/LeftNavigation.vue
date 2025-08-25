<script setup lang="ts">
import {computed} from "vue";

const route = useRoute()
const router = useRouter()

const projectId = computed(()=>{
  return route.params.projectId
})

const links = [
  {
  title: 'Board',
  componentName: 'Board',
  },
  {
    title: 'Měření',
    componentName: 'Measurements',
  },
  {
    title: 'Rezervace',
    componentName: 'Reservations',
  },
  {
    title: 'Lidé a práce',
    componentName: 'PeopleWork',
  },
  {
    title: 'Souhrn',
    componentName: 'Summary',
  }
]

function isActive(componentName){
  return componentName === route.name
}

function navigate(componentName){
  router.push({name: componentName, params: {projectId: projectId.value}})
}


</script>

<template>
  <v-navigation-drawer
    permanent
  >
    <v-list density="compact" nav>
      <v-list-item
        active-color=""
        @click="navigate(link.componentName)"
        :active="isActive(link.componentName)"
        v-for="link in links"
        link
        :title="link.title"
        :key="link.componentName">

      </v-list-item>
    </v-list>
  </v-navigation-drawer>
</template>

<style scoped>

</style>
