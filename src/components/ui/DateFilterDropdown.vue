<script setup lang="ts">
import { ref, computed } from 'vue'
import DateFilterPanel, { type DateFilter } from './DateFilterPanel.vue'

const props = defineProps<{
  modelValue: DateFilter
}>()

const emit = defineEmits<{
  'update:modelValue': [value: DateFilter]
}>()

const menuOpen = ref(false)

// Label pro tlačítko
const buttonLabel = computed(() => {
  const f = props.modelValue
  if (!f.preset && !f.from) return 'Vše'
  
  if (f.preset === 'today') return 'Dnes'
  if (f.preset === 'thisWeek') return 'Tento týden'
  if (f.preset === 'thisMonth' && f.from) {
    return new Intl.DateTimeFormat('cs-CZ', { month: 'long' }).format(f.from)
  }
  
  if (f.from) {
    return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short' }).format(f.from)
  }
  
  return 'Vše'
})

function onUpdate(val: DateFilter) {
  emit('update:modelValue', val)
}

function onClose() {
  menuOpen.value = false
}
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="bottom start"
    transition="scale-transition"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        variant="flat"
        class="bg-grey-lighten-3 filter-btn text-body-2 px-3"
        style="height: 40px;"
      >
        <v-icon class="mr-2" size="18">mdi-calendar</v-icon>
        <span class="mr-1 font-weight-regular">Datum:</span>
        <span class="font-weight-bold">{{ buttonLabel }}</span>
        <v-icon class="ml-2" size="20">mdi-menu-down</v-icon>
      </v-btn>
    </template>
    
    <div style="box-shadow: 0 10px 40px rgba(0,0,0,0.15); border-radius: 12px; overflow: hidden;">
      <DateFilterPanel
        :model-value="modelValue"
        @update:model-value="onUpdate"
        @close="onClose"
      />
    </div>
  </v-menu>
</template>

<style scoped>
.filter-btn {
  border: 1px solid rgba(0,0,0,0.06);
  text-transform: none;
  letter-spacing: 0;
}
</style>
