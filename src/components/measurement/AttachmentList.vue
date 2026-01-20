<template>
  <div class="attachment-list">
    <!-- prázdný stav (empty state) -->
    <div
      v-if="!loading && attachments.length === 0"
      class="empty-state"
    >
      <v-icon
        size="48"
        color="grey-lighten-1"
      >
        mdi-paperclip
      </v-icon>
      <p class="text-grey mt-2">
        Žádné přílohy
      </p>
    </div>

    <!-- stav načítání (loading state) -->
    <div
      v-else-if="loading"
      class="d-flex justify-center py-4"
    >
      <v-progress-circular
        indeterminate
        color="primary"
        size="32"
      />
    </div>

    <!-- položky příloh (attachment items) -->
    <div
      v-else
      class="attachment-items"
    >
      <div
        v-for="attachment in attachments"
        :key="attachment.id"
        class="attachment-item"
        @click="viewFile(attachment)"
      >
        <!-- náhled nebo ikona (preview / icon) -->
        <div class="attachment-item__preview">
          <img
            v-if="isImage(attachment.contentType)"
            :src="getDownloadUrl(attachment)"
            :alt="attachment.originalName"
            class="attachment-item__thumbnail"
          >
          <v-icon
            v-else
            :icon="getIcon(attachment.contentType)"
            :color="getIconColor(attachment.contentType)"
            size="32"
          />
        </div>

        <!-- informace (info) -->
        <div class="attachment-item__info">
          <p class="attachment-item__name text-truncate">
            {{ attachment.originalName }}
          </p>
          <p class="attachment-item__meta text-grey">
            {{ formatSize(attachment.sizeBytes) }}
            <span v-if="attachment.uploadedByUsername"> • {{ attachment.uploadedByUsername }}</span>
            <span v-if="attachment.createdAt"> • {{ formatDate(attachment.createdAt) }}</span>
          </p>
        </div>

        <!-- akce (actions) -->
        <div
          class="attachment-item__actions"
          @click.stop
        >
          <v-btn
            icon="mdi-download"
            size="small"
            variant="text"
            color="primary"
            title="Stáhnout"
            @click="downloadFile(attachment)"
          />
          <v-btn
            v-if="!readonly"
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            title="Smazat"
            :loading="deletingId === attachment.id"
            @click="confirmDelete(attachment)"
          />
        </div>
      </div>
    </div>

    <!-- dialog pro potvrzení smazání (delete confirmation) -->
    <v-dialog
      v-model="deleteDialog"
      max-width="400"
    >
      <v-card>
        <v-card-title>Smazat přílohu?</v-card-title>
        <v-card-text>
          Opravdu chcete smazat soubor <strong>{{ attachmentToDelete?.originalName }}</strong>?
          Tato akce je nevratná.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="deleteDialog = false"
          >
            Zrušit
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            @click="doDelete"
          >
            Smazat
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- dialog pro náhled (preview dialog) -->
    <v-dialog
      v-model="previewDialog.open"
      max-width="90vw"
      max-height="90vh"
    >
      <v-card
        class="bg-black"
        height="90vh"
      >
        <v-toolbar
          density="compact"
          color="black"
        >
          <v-toolbar-title class="text-white text-caption">
            {{ previewDialog.title }}
          </v-toolbar-title>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            color="white"
            @click="previewDialog.open = false"
          />
        </v-toolbar>

        <div
          class="d-flex align-center justify-center bg-grey-darken-4"
          style="height: calc(100% - 48px); overflow: hidden;"
        >
          <v-img
            v-if="previewDialog.type === 'image'"
            :src="previewDialog.src"
            max-height="100%"
            max-width="100%"
            contain
          />
          <iframe
            v-else
            :src="previewDialog.src"
            style="width:100%; height:100%; border:none; background:white;"
          />
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import {
  useAttachments,
  formatFileSize,
  getFileTypeConfig,
  isImageType,
  type FileAttachment
} from '@/composables/useAttachments'
import { auth } from '@/stores/auth'

const props = defineProps<{
  measurementId: number
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'deleted', fileId: number): void
}>()

const {
  loading,
  attachments,
  fetchAttachments,
  deleteAttachment,
  getDownloadUrl,
  //getViewUrl
} = useAttachments()

const deleteDialog = ref(false)
const attachmentToDelete = ref<FileAttachment | null>(null)
const deletingId = ref<number | null>(null)

// načtení při připojení a při změně id měření (fetch on mount)
onMounted(() => {
  if (props.measurementId) {
    fetchAttachments(props.measurementId)
  }
})

watch(() => props.measurementId, (newId) => {
  if (newId) {
    fetchAttachments(newId)
  }
})

function isImage(contentType: string | undefined): boolean {
  return isImageType(contentType)
}

function getIcon(contentType: string | undefined): string {
  return getFileTypeConfig(contentType).icon
}

function getIconColor(contentType: string | undefined): string {
  return getFileTypeConfig(contentType).color
}

function formatSize(bytes: number): string {
  return formatFileSize(bytes)
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

const previewDialog = ref({
  open: false,
  src: '',
  type: 'image',
  title: ''
})

function viewFile(attachment: FileAttachment) {
  // Use downloadUrl for fetching data (more reliable than viewUrl)
  const url = getDownloadUrl(attachment)

  // Try renew token first
  auth.renewToken().catch(() => {}).then(() => {
      const token = auth.getToken()
      if (!token) {
        // If no token, standard open (likely to fail if protected, but nothing else to do)
        window.open(url, '_blank')
        return
      }

      fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  .then(resp => {
    if (!resp.ok) throw new Error(`HTTP error ${resp.status}`)
    return resp.blob()
  })
  .then(blob => {
    const objectUrl = URL.createObjectURL(blob)

    previewDialog.value = {
      open: true,
      src: objectUrl,
      type: isImage(attachment.contentType) ? 'image' : 'other',
      title: attachment.originalName
    }
  })
  .catch(err => {
    console.error('Fetch error:', err)
    alert('Nepodařilo se načíst náhled souboru.\n' + err.message)
  })
  })
}

function downloadFile(attachment: FileAttachment) {
  const url = getDownloadUrl(attachment)

  auth.renewToken().catch(() => {}).then(() => {
      const token = auth.getToken()
      if (!token) {
         const link = document.createElement('a')
         link.href = url
         link.download = attachment.originalName
         link.target = '_blank'
         document.body.appendChild(link)
         link.click()
         document.body.removeChild(link)
         return
      }

      fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(r => {
      if (!r.ok) throw new Error('Download failed')
      return r.blob()
    })
    .then(blob => {
       const blobUrl = URL.createObjectURL(blob)
       const link = document.createElement('a')
       link.href = blobUrl
       link.download = attachment.originalName
       document.body.appendChild(link)
       link.click()
       document.body.removeChild(link)
       setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
    })
    .catch(e => {
        console.error('Download error', e)
        alert('Nepodařilo se stáhnout soubor.')
    })
  })
}

function confirmDelete(attachment: FileAttachment) {
  attachmentToDelete.value = attachment
  deleteDialog.value = true
}

async function doDelete() {
  if (!attachmentToDelete.value) return

  const id = attachmentToDelete.value.id
  deletingId.value = id
  deleteDialog.value = false

  try {
    await deleteAttachment(id)
    emit('deleted', id)
  } catch (e) {
    console.error('Failed to delete attachment:', e)
  } finally {
    deletingId.value = null
    attachmentToDelete.value = null
  }
}

/**
 * obnovení seznamu příloh (může být voláno externě po nahrání).
 */
function refresh() {
  if (props.measurementId) {
    fetchAttachments(props.measurementId)
  }
}

defineExpose({ refresh })
</script>

<style scoped>
.attachment-list {
  width: 100%;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.attachment-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: #2196f30d;
  cursor: pointer;
  transition: background 0.2s ease;
}

.attachment-item:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}

.attachment-item__preview {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  background: rgba(var(--v-theme-surface-variant), 0.5);
  overflow: hidden;
}

.attachment-item__thumbnail {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.attachment-item__info {
  flex: 1;
  min-width: 0;
}

.attachment-item__name {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
}

.attachment-item__meta {
  margin: 2px 0 0;
  font-size: 0.75rem;
}

.attachment-item__actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.attachment-item:hover .attachment-item__actions {
  opacity: 1;
}
</style>
