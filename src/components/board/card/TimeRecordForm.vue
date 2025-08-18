<script setup lang="ts">
const timeFrom = ref(null)
const dateFrom = ref(null)
const timeTo = ref(null)
const dateTo = ref(null)

const maxDateFrom = computed(() => dateTo.value && dateTo.value.value)
const maxTimeFrom = computed(() => timeTo.value && timeTo.value.value)
const minDateTo = computed(() => dateFrom.value && dateFrom.value.value)
const minTimeTo = computed(() => timeFrom.value && timeFrom.value.value)

const isValid = computed(() => timeFrom.value && timeTo.value && dateFrom.value && dateTo.value)

function update(updatedItem, args){
  switch (updatedItem) {
    case 'timeFrom': timeFrom.value = args
      break;
    case 'timeTo': timeTo.value = args
      break;
    case 'dateFrom': dateFrom.value = args
      break;
    case 'dateTo': dateTo.value = args
      break;
  }
}

</script>

<template>
  <v-dialog
    width="800"
  >
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        class="me-2"
        text="Přidat čas"
        variant="text"
        color="primary"
      />
    </template>
    <template #default="{ isActive }">
      <v-card title="Nový časový záznam">
        <h4 class="px-5">
          Start
        </h4>
        <v-row class="px-5 pt-3">
          <v-col cols="6">
            <date-picker
              text-field-label="Datum od"
              :max="maxDateFrom"
              @update="args => update('dateFrom', args)"
            />
          </v-col>
          <v-col cols="6">
            <time-picker
              text-field-label="Čas od"
              :max="maxTimeFrom"
              @update="args => update('timeFrom', args)"
            />
          </v-col>
        </v-row>
        <h4 class="px-5">
          Konec
        </h4>
        <v-row class="px-5 pt-3">
          <v-col cols="6">
            <date-picker
              text-field-label="Datum do"
              :min="minDateTo"
              @update="args => update('dateTo', args)"
            />
          </v-col>
          <v-col cols="6">
            <time-picker
              text-field-label="Čas do"
              :min="minTimeTo"
              @update="args => update('timeTo', args)"
            />
          </v-col>
        </v-row>
        <v-card-actions>
          <v-btn
            text="Zrušit"
          />
          <v-btn
            :disabled="!isValid"
            variant="flat"
            text="Uložit"
            color="primary"
          />
        </v-card-actions>
      </v-card>
    </template>
  </v-dialog>
</template>

<style scoped>

</style>
