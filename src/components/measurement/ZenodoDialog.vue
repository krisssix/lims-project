<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { type MeasurementResponse } from '@/stores/measurement'
import { 
  getDefaultColumns, 
  buildCSV,
  type ExportColumn 
} from '@/utils/export-measurements'
import {
  saveZenodoToken,
  loadZenodoToken,
  removeZenodoToken,
  validateToken,
  createDeposition,
  createNewVersion,
  uploadFile,
  updateMetadata,
  publishDeposition,
  ZENODO_LICENSES,
  type ZenodoConfig,
  type ZenodoMetadata,
  type ZenodoCreator,
  type ZenodoDeposition
} from '@/services/zenodo'

const props = defineProps<{
  modelValue: boolean
  measurements: MeasurementResponse[]
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'published', payload: { doi: string; recordId: number; measurementIds: number[] }): void
}>()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emits('update:modelValue', v)
})


const currentStep = ref(1)
const totalSteps = 4


const accessToken = ref('')
const tokenValid = ref<boolean | null>(null)
const tokenValidating = ref(false)
const useSandbox = ref(false)  // Production by default
const tokenSaved = ref(false)


const title = ref('')
const description = ref('')
const creators = ref<ZenodoCreator[]>([{ name: '', affiliation: '' }])
const keywords = ref<string[]>([])
const keywordInput = ref('')
const license = ref('cc-by-4.0')
const community = ref('')  // Zenodo community identifier


const columns = ref<ExportColumn[]>(getDefaultColumns())
const includeSeries = ref(true)


const isPublishing = ref(false)
const publishProgress = ref(0)
const publishStatus = ref('')
const publishedDeposition = ref<ZenodoDeposition | null>(null)
const publishError = ref<string | null>(null)


const isUpdateMode = ref(false) // true = aktualizace existujícího, false = nová publikace

// kontrola, zda některé měření již má zenodo id
const existingZenodoId = computed<number | null>(() => {
  for (const m of props.measurements) {
    if (m.zenodoRecordId) return m.zenodoRecordId
  }
  return null
})

const hasExistingZenodo = computed(() => existingZenodoId.value !== null)

// Computed
const config = computed<ZenodoConfig>(() => ({
  accessToken: accessToken.value,
  useSandbox: useSandbox.value
}))

const canProceedStep1 = computed(() => tokenValid.value === true)
const canProceedStep2 = computed(() => 
  title.value.trim().length > 0 &&
  description.value.trim().length > 0 &&
  creators.value.some(c => c.name.trim().length > 0)
)
const canProceedStep3 = computed(() => columns.value.some(c => c.enabled))


function onDialogOpen(): void {
  currentStep.value = 1
  publishedDeposition.value = null
  publishError.value = null
  publishProgress.value = 0
  
  // načtení uloženého tokenu
  const savedToken = loadZenodoToken()
  if (savedToken) {
    accessToken.value = savedToken
    tokenSaved.value = true
  }
  
  // reset metadat
  title.value = `Měření - Export ${new Date().toLocaleDateString('cs-CZ')}`
  description.value = ''
  creators.value = [{ name: '', affiliation: '' }]
  keywords.value = ['measurement', 'laboratory']
  columns.value = getDefaultColumns()
  
  // přepnutí do režimu aktualizace, pokud existuje zenodo id
  isUpdateMode.value = hasExistingZenodo.value
}


async function validateAccessToken(): Promise<void> {
  if (!accessToken.value.trim()) {
    tokenValid.value = false
    return
  }
  
  tokenValidating.value = true
  tokenValid.value = null
  
  try {
    tokenValid.value = await validateToken(config.value)
    if (tokenValid.value && tokenSaved.value) {
      saveZenodoToken(accessToken.value)
    }
  } catch {
    tokenValid.value = false
  } finally {
    tokenValidating.value = false
  }
}

function saveToken(): void {
  saveZenodoToken(accessToken.value)
  tokenSaved.value = true
}

function forgetToken(): void {
  removeZenodoToken()
  accessToken.value = ''
  tokenSaved.value = false
  tokenValid.value = null
}


function addCreator(): void {
  creators.value.push({ name: '', affiliation: '' })
}

function removeCreator(index: number): void {
  if (creators.value.length > 1) {
    creators.value.splice(index, 1)
  }
}


function addKeyword(): void {
  const kw = keywordInput.value.trim()
  if (kw && !keywords.value.includes(kw)) {
    keywords.value.push(kw)
    keywordInput.value = ''
  }
}

function removeKeyword(index: number): void {
  keywords.value.splice(index, 1)
}


function nextStep(): void {
  if (currentStep.value < totalSteps) {
    currentStep.value++
  }
}

function prevStep(): void {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}


async function doPublish(): Promise<void> {
  isPublishing.value = true
  publishError.value = null
  publishProgress.value = 0
  
  try {
    let deposition: ZenodoDeposition
    
    const metadata: ZenodoMetadata = {
      title: title.value,
      description: description.value,
      upload_type: 'dataset',
      creators: creators.value.filter(c => c.name.trim()),
      keywords: keywords.value.length ? keywords.value : undefined,
      license: license.value,
      access_right: 'open',
      publication_date: new Date().toISOString().slice(0, 10),
      communities: community.value.trim() ? [{ identifier: community.value.trim() }] : undefined
    }
    
    // vytvoření deposition nebo nové verze
    if (isUpdateMode.value && existingZenodoId.value) {
      publishStatus.value = 'Vytvářím novou verzi...'
      publishProgress.value = 10
      deposition = await createNewVersion(config.value, existingZenodoId.value)
    } else {
      publishStatus.value = 'Vytvářím deposition...'
      publishProgress.value = 10
      deposition = await createDeposition(config.value, metadata)
    }
    publishProgress.value = 30
    
    // vygenerování csv
    publishStatus.value = 'Generuji CSV soubor...'
    const csvContent = buildCSV({
      columns: columns.value,
      includeSeries: includeSeries.value,
      measurements: props.measurements
    })
    
    const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
    const filename = `${title.value.replace(/[^a-zA-Z0-9-_]/g, '_')}.csv`
    publishProgress.value = 50
    
    // nahrání souboru
    publishStatus.value = 'Nahrávám soubor...'
    await uploadFile(config.value, deposition.links.bucket, filename, csvBlob)
    publishProgress.value = 70
    
    // aktualizace metadat
    publishStatus.value = 'Aktualizuji metadata...'
    await updateMetadata(config.value, deposition.id, metadata)
    publishProgress.value = 85
    
    // publikování
    publishStatus.value = 'Publikuji...'
    const published = await publishDeposition(config.value, deposition.id)
    publishProgress.value = 100
    
    publishedDeposition.value = published
    publishStatus.value = isUpdateMode.value ? 'Nová verze publikována!' : 'Publikováno!'
    
    // emitování záznamu s id pro uložení do měření
    emits('published', { 
      doi: published.doi, 
      recordId: published.id,
      measurementIds: props.measurements.map(m => m.id)
    })
    
  } catch (err) {
    publishError.value = err instanceof Error ? err.message : 'Neznámá chyba'
    publishProgress.value = 0
  } finally {
    isPublishing.value = false
  }
}

function cancel(): void {
  open.value = false
}

// Watchers
watch(() => props.modelValue, (v) => {
  if (v) onDialogOpen()
})
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="700"
    persistent
  >
    <v-card class="zenodo-dialog">
      <v-card-title class="dialog-header">
        <v-icon color="deep-purple" class="mr-2">mdi-cloud-upload</v-icon>
        Publikovat do Zenodo
        <v-chip 
          v-if="useSandbox" 
          size="small" 
          color="warning" 
          variant="flat"
          class="ml-2"
        >
          SANDBOX
        </v-chip>
      </v-card-title>


      <div class="stepper-header">
        <div 
          v-for="step in totalSteps" 
          :key="step"
          class="step-indicator"
          :class="{ 
            'step-active': step === currentStep,
            'step-completed': step < currentStep
          }"
        >
          <div class="step-number">
            <v-icon v-if="step < currentStep" size="16">mdi-check</v-icon>
            <span v-else>{{ step }}</span>
          </div>
          <span class="step-label">
            {{ ['Autentizace', 'Metadata', 'Export', 'Publikace'][step - 1] }}
          </span>
        </div>
      </div>

      <v-card-text class="dialog-content">

        <div v-if="currentStep === 1" class="step-content">
          <p class="text-body-2 text-medium-emphasis mb-4">
            Pro publikaci do Zenodo potřebujete Access Token. 
            <a 
              :href="useSandbox 
                ? 'https://sandbox.zenodo.org/account/settings/applications/tokens/new/' 
                : 'https://zenodo.org/account/settings/applications/tokens/new/'"
              target="_blank"
              class="text-decoration-none"
            >
              Vytvořit nový token →
            </a>
          </p>

          <v-switch
            v-model="useSandbox"
            label="Použít Sandbox (pro testování)"
            color="warning"
            hide-details
            class="mb-4"
          />

          <v-text-field
            v-model="accessToken"
            label="Zenodo Access Token"
            type="password"
            variant="outlined"
            density="comfortable"
            :error="tokenValid === false"
            :success="tokenValid === true"
            :loading="tokenValidating"
            :hint="tokenValid === false ? 'Token je neplatný' : (tokenValid === true ? 'Token je platný' : '')"
            persistent-hint
          >
            <template #append-inner>
              <v-btn
                size="small"
                variant="tonal"
                :loading="tokenValidating"
                @click="validateAccessToken"
              >
                Ověřit
              </v-btn>
            </template>
          </v-text-field>

          <div class="d-flex align-center ga-2 mt-2">
            <v-checkbox
              v-model="tokenSaved"
              label="Zapamatovat token"
              density="compact"
              hide-details
              @update:model-value="$event ? saveToken() : forgetToken()"
            />
          </div>
        </div>


        <div v-if="currentStep === 2" class="step-content">
          <v-text-field
            v-model="title"
            label="Název datasetu *"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />

          <v-textarea
            v-model="description"
            label="Popis *"
            variant="outlined"
            density="comfortable"
            rows="3"
            class="mb-3"
          />

          <div class="creators-section mb-3">
            <span class="text-subtitle-2 mb-2 d-block">Autoři *</span>
            <div 
              v-for="(creator, idx) in creators" 
              :key="idx"
              class="d-flex align-center ga-2 mb-2"
            >
              <v-text-field
                v-model="creator.name"
                label="Jméno (Příjmení, Jméno)"
                variant="outlined"
                density="compact"
                hide-details
                class="flex-grow-1"
              />
              <v-text-field
                v-model="creator.affiliation"
                label="Afiliace"
                variant="outlined"
                density="compact"
                hide-details
                style="max-width: 200px;"
              />
              <v-btn
                icon="mdi-minus"
                size="small"
                variant="text"
                color="error"
                :disabled="creators.length <= 1"
                @click="removeCreator(idx)"
              />
            </div>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-plus"
              @click="addCreator"
            >
              Přidat autora
            </v-btn>
          </div>

          <div class="keywords-section mb-3">
            <span class="text-subtitle-2 mb-2 d-block">Klíčová slova</span>
            <div class="d-flex align-center ga-2 mb-2">
              <v-text-field
                v-model="keywordInput"
                label="Přidat klíčové slovo"
                variant="outlined"
                density="compact"
                hide-details
                @keyup.enter="addKeyword"
              />
              <v-btn
                icon="mdi-plus"
                size="small"
                variant="tonal"
                @click="addKeyword"
              />
            </div>
            <div class="d-flex flex-wrap ga-1">
              <v-chip
                v-for="(kw, idx) in keywords"
                :key="kw"
                size="small"
                closable
                @click:close="removeKeyword(idx)"
              >
                {{ kw }}
              </v-chip>
            </div>
          </div>

          <v-select
            v-model="license"
            :items="ZENODO_LICENSES"
            item-title="label"
            item-value="value"
            label="Licence"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />

          <v-text-field
            v-model="community"
            label="Zenodo Community (volitelné)"
            variant="outlined"
            density="comfortable"
            hint="ID komunity pro seskupení datasetů (např. 'vase-laborator')"
            persistent-hint
          />
        </div>


        <div v-if="currentStep === 3" class="step-content">
          <p class="text-body-2 text-medium-emphasis mb-4">
            Vyberte, které sloupce chcete zahrnout do exportovaného CSV souboru.
          </p>

          <div class="columns-grid">
            <v-checkbox
              v-for="col in columns"
              :key="col.key"
              v-model="col.enabled"
              :label="col.label"
              density="compact"
              hide-details
              color="primary"
            />
          </div>

          <v-checkbox
            v-model="includeSeries"
            label="Zahrnout datové série"
            density="compact"
            hide-details
            color="deep-purple"
            class="mt-4"
          />

          <v-alert type="info" variant="tonal" class="mt-4" density="compact">
            Export bude obsahovat {{ props.measurements.length }} měření.
          </v-alert>
        </div>


        <div v-if="currentStep === 4" class="step-content">
          <!-- výběr verze při detekci existujícího zenodo id -->
          <v-alert 
            v-if="hasExistingZenodo && !publishedDeposition && !isPublishing" 
            type="info" 
            variant="tonal" 
            class="mb-4"
          >
            <div class="d-flex align-center justify-space-between">
              <div>
                <strong>Detekován existující Zenodo záznam</strong>
                <div class="text-body-2">
                  Měření již bylo publikováno. Můžete vytvořit novou verzi nebo nový záznam.
                </div>
              </div>
            </div>
            <div class="d-flex ga-2 mt-3">
              <v-btn-toggle
                v-model="isUpdateMode"
                mandatory
                color="deep-purple"
                variant="outlined"
                density="compact"
              >
                <v-btn :value="true">
                  <v-icon start>mdi-update</v-icon>
                  Nová verze (v2)
                </v-btn>
                <v-btn :value="false">
                  <v-icon start>mdi-plus</v-icon>
                  Nový záznam
                </v-btn>
              </v-btn-toggle>
            </div>
          </v-alert>

          <div v-if="!publishedDeposition && !isPublishing" class="publish-preview">
            <h4 class="text-subtitle-1 mb-3">Náhled publikace</h4>
            
            <div class="preview-item">
              <strong>Název:</strong> {{ title }}
            </div>
            <div class="preview-item">
              <strong>Autoři:</strong> {{ creators.filter(c => c.name).map(c => c.name).join(', ') }}
            </div>
            <div class="preview-item">
              <strong>Licence:</strong> {{ ZENODO_LICENSES.find(l => l.value === license)?.label }}
            </div>
            <div class="preview-item">
              <strong>Počet měření:</strong> {{ props.measurements.length }}
            </div>
            <div class="preview-item">
              <strong>Prostředí:</strong> 
              <v-chip :color="useSandbox ? 'warning' : 'success'" size="small">
                {{ useSandbox ? 'Sandbox' : 'Produkce' }}
              </v-chip>
            </div>

            <v-alert 
              v-if="useSandbox" 
              type="warning" 
              variant="tonal" 
              class="mt-4"
              density="compact"
            >
              Publikujete do <strong>sandbox</strong> prostředí. Data nebudou veřejně dostupná.
            </v-alert>
          </div>

          <div v-if="isPublishing" class="publishing-progress">
            <v-progress-linear
              :model-value="publishProgress"
              color="deep-purple"
              height="8"
              rounded
              class="mb-3"
            />
            <p class="text-center text-body-2">{{ publishStatus }}</p>
          </div>

          <div v-if="publishedDeposition" class="publish-success">
            <v-icon size="64" color="success" class="mb-3">mdi-check-circle</v-icon>
            <h4 class="text-h6 mb-2">Úspěšně publikováno!</h4>
            <p class="text-body-2 text-medium-emphasis mb-3">
              Váš dataset byl publikován do Zenodo.
            </p>
            
            <div class="doi-display">
              <strong>DOI:</strong>
              <a 
                :href="publishedDeposition.doi_url || `https://doi.org/${publishedDeposition.doi}`" 
                target="_blank"
                class="text-decoration-none"
              >
                {{ publishedDeposition.doi }}
              </a>
            </div>

            <v-btn
              :href="publishedDeposition.links?.html || publishedDeposition.doi_url"
              target="_blank"
              color="deep-purple"
              variant="tonal"
              prepend-icon="mdi-open-in-new"
              class="mt-4"
            >
              Otevřít v Zenodo
            </v-btn>
          </div>

          <v-alert 
            v-if="publishError" 
            type="error" 
            variant="tonal" 
            class="mt-4"
          >
            {{ publishError }}
          </v-alert>
        </div>
      </v-card-text>

      <v-card-actions class="dialog-actions">
        <v-btn variant="text" @click="cancel">
          {{ publishedDeposition ? 'Zavřít' : 'Zrušit' }}
        </v-btn>
        <v-spacer />
        
        <v-btn
          v-if="currentStep > 1 && !publishedDeposition"
          variant="text"
          :disabled="isPublishing"
          @click="prevStep"
        >
          Zpět
        </v-btn>
        
        <v-btn
          v-if="currentStep < totalSteps"
          color="primary"
          variant="flat"
          :disabled="
            (currentStep === 1 && !canProceedStep1) ||
            (currentStep === 2 && !canProceedStep2) ||
            (currentStep === 3 && !canProceedStep3)
          "
          @click="nextStep"
        >
          Pokračovat
        </v-btn>
        
        <v-btn
          v-if="currentStep === totalSteps && !publishedDeposition"
          color="deep-purple"
          variant="flat"
          prepend-icon="mdi-cloud-upload"
          :loading="isPublishing"
          @click="doPublish"
        >
          Publikovat
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.zenodo-dialog {
  border-radius: 12px;
}

.dialog-header {
  display: flex;
  align-items: center;
  padding: 20px 24px 16px;
  font-size: 1.1rem;
  font-weight: 600;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.stepper-header {
  display: flex;
  justify-content: space-between;
  padding: 16px 24px;
  background: #f8f9fb;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.step-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  opacity: 0.5;
  transition: opacity 0.2s;
}

.step-indicator.step-active,
.step-indicator.step-completed {
  opacity: 1;
}

.step-number {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  transition: all 0.2s;
}

.step-active .step-number {
  background: rgb(103, 58, 183);
  color: white;
}

.step-completed .step-number {
  background: rgb(76, 175, 80);
  color: white;
}

.step-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.dialog-content {
  padding: 24px;
  min-height: 300px;
}

.step-content {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.columns-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  background: #f8f9fb;
  padding: 12px 16px;
  border-radius: 8px;
}

.publish-preview {
  background: #f8f9fb;
  padding: 16px;
  border-radius: 8px;
}

.preview-item {
  padding: 8px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.preview-item:last-child {
  border-bottom: none;
}

.publishing-progress {
  text-align: center;
  padding: 32px;
}

.publish-success {
  text-align: center;
  padding: 24px;
}

.doi-display {
  background: rgba(103, 58, 183, 0.08);
  padding: 12px 16px;
  border-radius: 8px;
  font-family: monospace;
}

.dialog-actions {
  padding: 16px 24px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
</style>
