<script setup lang="ts">
const props = defineProps({
  isMemberSelected: Boolean,
  username: String,
  isMultiple: Boolean
})

const emit = defineEmits(['update:selectedMember'])

const initials = computed(() => {
  if(props.username){
    return props.username.at(0).toUpperCase()
  }
})

function selectMember(){
  emit('update:selectedMember',{'isSelected': !props.isMemberSelected, 'username': props.username})
}
</script>

<template>
  <div
    :class="`w-100 py-1 pl-2 mb-2 d-flex flex-row justify-space-between align-center cursor-pointer ${props.isMemberSelected && !props.isMultiple ? 'bg-grey-lighten-4 background-rounding' : ''}`"
    @click="selectMember"
  >
    <div class="d-flex ga-2 align-center">
      <div class="rounded-circle circle-size bg-grey-lighten-2 d-flex justify-center align-center">
        {{ initials }}
      </div>
      <div>
        {{ username }}
      </div>
    </div>
    <div v-if="props.isMultiple">
      <v-checkbox-btn
        :model-value="props.isMemberSelected"
        @click.stop
        @update:model-value="selectMember"
      />
    </div>
  </div>
</template>

<style scoped>

.circle-size {
  height: 2.5em;
  width: 2.5em;
}

.background-rounding {
  border-radius: 12px;
}

</style>
