<template>
  <div class="file-uploader">
    <!-- oblast pro nahrávání (drop zone) -->
    <div
      class="drop-zone"
      :class="{ 'drop-zone--active': isDragging, 'drop-zone--disabled': disabled }"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
      @click="openFileDialog"
    >
      <input
        ref="fileInput"
        type="file"
        :accept="acceptedTypes"
        :multiple="multiple"
        style="display: none"
        @change="onFileSelect"
      />

      <div class="drop-zone__content">
        <v-icon size="48" :color="isDragging ? 'primary' : 'grey-darken-1'">
          {{ isDragging ? 'mdi-cloud-upload' : 'mdi-file-upload-outline' }}
        </v-icon>
        <p class="drop-zone__text mt-2">
          <span v-if="isDragging">Pusťte soubor zde</span>
          <span v-else>
            Přetáhněte soubor sem nebo <span class="text-primary">klikněte pro výběr</span>
          </span>
        </p>
        <p class="drop-zone__hint text-grey">
          Povolené typy: PDF, PNG, JPG, XLSX, CSV, TXT • Max. 50 MB
        </p>
      </div>
    </div>

    <!-- průběh nahrávání (upload progress) -->
    <div v-if="isUploading" class="upload-progress mt-3">
      <div class="d-flex align-center gap-2 mb-1">
        <v-icon size="20" color="primary">mdi-file-upload</v-icon>
        <span class="text-body-2">{{ uploadingFileName }}</span>
        <v-spacer />
        <span class="text-body-2 text-grey">{{ uploadProgress }}%</span>
      </div>
      <v-progress-linear
        :model-value="uploadProgress"
        color="primary"
        height="6"
        rounded
      />
    </div>

    <!-- chybová zpráva (error message) -->
    <v-alert
      v-if="errorMessage"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="mt-3"
      @click:close="errorMessage = null"
    >
      {{ errorMessage }}
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  useAttachments,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  type FileAttachment
} from '@/composables/useAttachments'

const props = defineProps<{
  measurementId: number
  disabled?: boolean
  multiple?: boolean
}>()

const emit = defineEmits<{
  (e: 'uploaded', file: FileAttachment): void
  (e: 'error', message: string): void
}>()

const { uploadFile } = useAttachments()

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const isUploading = ref(false)
const uploadProgress = ref(0)
const uploadingFileName = ref('')
const errorMessage = ref<string | null>(null)

const acceptedTypes = computed(() => ALLOWED_MIME_TYPES.join(','))

function openFileDialog() {
  if (!props.disabled) {
    fileInput.value?.click()
  }
}

function onDragEnter(e: DragEvent) {
  if (props.disabled) return
  isDragging.value = true
}

function onDragOver(e: DragEvent) {
  if (props.disabled) return
  isDragging.value = true
}

function onDragLeave(e: DragEvent) {
  isDragging.value = false
}

async function onDrop(e: DragEvent) {
  isDragging.value = false
  if (props.disabled) return

  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    await handleFiles(files)
  }
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    handleFiles(input.files)
  }
  // reset vstupu, aby bylo možné vybrat stejný soubor znovu (reset input)
  input.value = ''
}

async function handleFiles(files: FileList) {
  const filesToUpload = props.multiple ? Array.from(files) : [files[0]]

  for (const file of filesToUpload) {
    await uploadSingleFile(file)
  }
}

async function uploadSingleFile(file: File) {
  // validace na straně klienta (client-side validation)
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    errorMessage.value = `Nepodporovaný typ souboru: ${file.name}. Povolené typy: PDF, PNG, JPG, XLSX, CSV, TXT`
    emit('error', errorMessage.value)
    return
  }

  if (file.size > MAX_FILE_SIZE) {
    errorMessage.value = `Soubor ${file.name} je příliš velký. Maximální velikost je 50 MB`
    emit('error', errorMessage.value)
    return
  }

  errorMessage.value = null
  isUploading.value = true
  uploadProgress.value = 0
  uploadingFileName.value = file.name

  try {
    const uploaded = await uploadFile(
      props.measurementId,
      file,
      (percent) => {
        uploadProgress.value = percent
      }
    )
    emit('uploaded', uploaded)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Nahrávání selhalo'
    errorMessage.value = message
    emit('error', message)
  } finally {
    isUploading.value = false
    uploadProgress.value = 0
    uploadingFileName.value = ''
  }
}
</script>

<style scoped>
.file-uploader {
  width: 100%;
}

.drop-zone {
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 12px;
  padding: 32px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #2196f30d;
}

.drop-zone:hover:not(.drop-zone--disabled) {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.05);
}

.drop-zone--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  transform: scale(1.01);
}

.drop-zone--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.drop-zone__content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.drop-zone__text {
  font-size: 0.95rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin: 0;
}

.drop-zone__hint {
  font-size: 0.8rem;
  margin: 8px 0 0;
}

.upload-progress {
  padding: 12px;
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border-radius: 8px;
}
</style>
