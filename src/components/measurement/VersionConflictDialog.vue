<template>
  <Dialog
    :is-open="model"
    @update:is-open="(v: boolean) => model = v"
    width="500px"
    :hide-footer="false"
  >
    <template #header>
      {{ existingDrafts.length > 0 ? 'Již existuje rozpracovaná verze' : 'Vytvořit novou verzi?' }}
    </template>

    <template #content>
      <!-- Existing drafts warning -->
      <template v-if="existingDrafts.length > 0">
        <v-alert type="warning" variant="tonal" class="mb-4">
          Pro šablonu "{{ templateName }}" již existuje:
        </v-alert>
        
        <v-list density="compact" class="mb-4">
          <v-list-item v-for="draft in existingDrafts" :key="draft.id">
            <template #prepend>
              <v-icon color="warning">mdi-pencil-box-outline</v-icon>
            </template>
            <v-list-item-title>v{{ draft.version }} Draft</v-list-item-title>
            <v-list-item-subtitle>
              vytvořil: {{ draft.createdAt ? formatDate(draft.createdAt) : 'nedávno' }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>

        <div class="text-body-2 mb-4">Co chcete udělat?</div>
        
        <v-radio-group v-model="selectedAction" hide-details>
          <v-radio value="continue" color="primary">
            <template #label>
              <div>
                <div class="font-weight-medium">Pokračovat v úpravě v{{ existingDrafts[0]?.version }}</div>
                <div class="text-caption text-medium-emphasis">Otevřít existující draft</div>
              </div>
            </template>
          </v-radio>
          <v-radio value="discard" color="warning">
            <template #label>
              <div>
                <div class="font-weight-medium">Zahodit a vytvořit novou v{{ targetVersion }}</div>
                <div class="text-caption text-medium-emphasis">Smazat existující draft, vytvořit nový</div>
              </div>
            </template>
          </v-radio>
          <v-radio value="higher" color="success">
            <template #label>
              <div>
                <div class="font-weight-medium">Vytvořit v{{ higherVersion }} (ponechat v{{ existingDrafts[0]?.version }})</div>
                <div class="text-caption text-medium-emphasis">Vytvořit další verzi vedle existující</div>
              </div>
            </template>
          </v-radio>
        </v-radio-group>
      </template>

      <!-- Normal confirmation -->
      <template v-else>
        <div class="mb-4">
          <div class="text-body-2 mb-2">
            <strong>Šablona:</strong> {{ templateName }}
          </div>
          <div class="text-body-2 mb-2">
            <strong>Zdrojová:</strong> v{{ sourceVersion }} ({{ sourceStatus }})
          </div>
          <div class="text-body-2">
            <strong>Nová verze:</strong> v{{ targetVersion }}
          </div>
        </div>

        <v-textarea
          v-model="description"
          label="Popis změn (volitelné)"
          placeholder="Přidáno pole pro teplotu vzorku..."
          rows="2"
          variant="outlined"
          density="compact"
          hide-details
        />
      </template>
    </template>

    <template #footer>
      <v-spacer />
      <v-btn variant="text" @click="cancel">Zrušit</v-btn>
      <v-btn 
        v-if="existingDrafts.length > 0"
        color="primary" 
        variant="flat"
        :disabled="!selectedAction"
        @click="confirmAction"
      >
        Pokračovat
      </v-btn>
      <v-btn 
        v-else
        color="primary" 
        variant="flat"
        @click="createDraft"
      >
        Vytvořit draft
      </v-btn>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Dialog from '@/components/Dialog.vue'

interface DraftInfo {
  id: string
  version: string
  createdAt?: string
}

const props = defineProps<{
  modelValue: boolean
  templateName: string
  sourceVersion: string
  sourceStatus: string
  targetVersion: string
  higherVersion: string
  existingDrafts: DraftInfo[]
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'create', description: string): void
  (e: 'continue', draftId: string): void
  (e: 'discard-and-create', draftIds: string[]): void
  (e: 'create-higher'): void
}>()

const model = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emits('update:modelValue', v)
})

const selectedAction = ref<'continue' | 'discard' | 'higher'>('continue')
const description = ref('')

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('cs-CZ')
  } catch {
    return dateStr
  }
}

function cancel(): void {
  model.value = false
}

function createDraft(): void {
  emits('create', description.value)
  model.value = false
}

function confirmAction(): void {
  if (selectedAction.value === 'continue') {
    emits('continue', props.existingDrafts[0]?.id ?? '')
  } else if (selectedAction.value === 'discard') {
    emits('discard-and-create', props.existingDrafts.map(d => d.id))
  } else if (selectedAction.value === 'higher') {
    emits('create-higher')
  }
  model.value = false
}
</script>
