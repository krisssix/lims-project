<script setup lang="ts">

const props = defineProps(['textFieldLabel', 'max', 'min'])
const emit = defineEmits(['update'])

const time = ref(null)
const showMenu = ref(false)

function update(value){
  time.value = value
  emit('update',{
    value: value
  })
  //showMenu.value = false
}

</script>

<template>
  <v-text-field
    :model-value="time"
    variant="outlined"
    :label="props.textFieldLabel"
    prepend-icon="mdi-clock-time-four-outline"
    readonly
  >
    <v-menu
      v-model="showMenu"
      :close-on-content-click="false"
      activator="parent"
      min-width="0"
    >
      <v-time-picker
        :model-value="time"
        format="24hr"
        hide-header
        :max="props.max"
        :min="props.min"
        @update:model-value="update"
      />
    </v-menu>
  </v-text-field>
</template>

<style scoped>

</style>
