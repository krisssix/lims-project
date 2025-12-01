<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, type RouteRecordName, type RouteLocationRaw } from 'vue-router'

type ProjectRouteName = 'Board' | 'Measurements' | 'Reservations' | 'PeopleWork' | 'Summary'

const route = useRoute()
const router = useRouter()

function hasProjectId(p: unknown): p is { projectId: string | number } {
  return typeof p === 'object' && p !== null && 'projectId' in p
}

const projectId = computed<string>(() => {
  const params = route.params as unknown
  return hasProjectId(params) ? String(params.projectId) : ''
})

const isRail = ref(localStorage.getItem('ui:navRail') === '1')
function toggleRail() {
  isRail.value = !isRail.value
  localStorage.setItem('ui:navRail', isRail.value ? '1' : '0')
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    toggleRail()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const links: Array<{ title: string; componentName: ProjectRouteName; icon: string }> = [
  { title: 'Board',        componentName: 'Board',        icon: 'mdi-bulletin-board' },
  { title: 'Měření',       componentName: 'Measurements', icon: 'mdi-flask-outline' },
  { title: 'Přístroje',    componentName: 'Devices',      icon: 'mdi-devices' },
  { title: 'Rezervace',    componentName: 'Reservations', icon: 'mdi-calendar' },
  { title: 'Lidé a práce', componentName: 'PeopleWork',   icon: 'mdi-account-group-outline' },
  { title: 'Souhrn',       componentName: 'Summary',      icon: 'mdi-chart-bar' },
]

function isActive(componentName: ProjectRouteName) {
  // route.name can be RouteRecordName | null | undefined. Compare string values safely.
  return String(route.name ?? '') === String(componentName)
}

function navigate(componentName: ProjectRouteName) {
  const location = {
    name: componentName as RouteRecordName,
    params: { projectId: projectId.value },
  } satisfies RouteLocationRaw

  router.push(location)
}
</script>

<template>
  <v-navigation-drawer
    permanent
    :rail="isRail"
    rail-width="64"
    width="280"
  >
    <template #prepend>
      <div class="d-flex justify-end pa-2">
        <v-btn
          size="small"
          variant="text"
          :icon="isRail ? 'mdi-chevron-double-right' : 'mdi-chevron-double-left'"
          :title="isRail ? 'Rozbalit (Ctrl+B)' : 'Sbalit (Ctrl+B)'"
          @click="toggleRail"
        />
      </div>
    </template>

    <v-list
      density="compact"
      nav
    >
      <template
        v-for="link in links"
        :key="link.componentName"
      >
        <v-tooltip
          v-if="isRail"
          location="end"
        >
          <template #activator="{ props }">
            <v-list-item
              v-bind="props"
              :prepend-icon="link.icon"
              :active="isActive(link.componentName)"
              @click="navigate(link.componentName)"
            />
          </template>
          <span>{{ link.title }}</span>
        </v-tooltip>

        <v-list-item
          v-else
          :prepend-icon="link.icon"
          :title="link.title"
          :active="isActive(link.componentName)"
          @click="navigate(link.componentName)"
        />
      </template>
    </v-list>
  </v-navigation-drawer>
</template>

<style scoped></style>
