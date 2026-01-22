<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Dialog from '@/components/Dialog.vue'

const props = defineProps<{
  isOpen:boolean
  mode:'edit' | 'delete' | 'copy'
  isFirstInSeries?: boolean
  eventTitle?:string
  seriesCount?:number
}>()

const emit = defineEmits<{
  'update:isOpen':[value:boolean]
  'confirm':[scope:'single' | 'following' | 'series']
  'cancel':[]
}>()

const scope = ref<'single' | 'following' | 'series'>('single')

// Reset scope when dialog opens
watch(() => props.isOpen, (v) => {
  if (v) scope.value = 'single'
})

const isDelete = computed(() => props.mode === 'delete')
const isCopy = computed(() => props.mode === 'copy')

const dialogIcon = computed(() => {
  if (isDelete.value) return 'mdi-delete-alert'
  if (isCopy.value) return 'mdi-content-copy'
  return 'mdi-calendar-edit'
})
const dialogColor = computed(() => {
  if (isDelete.value) return 'error'
  if (isCopy.value) return 'success'
  return 'primary'
})

function confirm() {
  emit('confirm', scope.value)
  emit('update:isOpen', false)
}

function cancel() {
  emit('cancel')
  emit('update:isOpen', false)
}
</script>

<template>
  <Dialog
    :is-open="isOpen"
    width="480px"
    :hide-footer="true"
    @update:is-open="v => emit('update:isOpen', v)"
  >
    <template #content>
      <div class="recurrence-dialog">
        <!-- Header -->
        <div
          class="dialog-header"
          :class="{ 'header-delete':isDelete }"
        >
          <div
            class="header-icon"
            :class="{ 'icon-delete':isDelete }"
          >
            <v-icon
              :icon="dialogIcon"
              size="24"
            />
          </div>
          <div class="header-text">
            <div class="header-title">
              {{ isDelete ? 'Smazat opakovanou událost' : isCopy ? 'Kopírovat opakovanou událost' : 'Upravit opakovanou událost' }}
            </div>
            <div
              v-if="eventTitle"
              class="header-subtitle"
            >
              {{ eventTitle }}
            </div>
          </div>
        </div>

        <!-- Info banner -->
        <div class="info-banner">
          <v-icon
            icon="mdi-information-outline"
            size="18"
            color="primary"
          />
          <span>
            Tato událost je součástí série{{ seriesCount ? ` (${seriesCount} událostí)`:'' }}.
            {{ isCopy ? 'Vyberte rozsah kopírování.' : 'Vyberte rozsah změny.' }}
          </span>
        </div>

        <!-- Options -->
        <div class="options-container">
          <!-- Option 1:Single -->
          <label
            class="option-card"
            :class="{ 'option-selected':scope === 'single' }"
          >
            <input
              v-model="scope"
              type="radio"
              value="single"
              class="option-radio"
            >
            <div class="option-icon">
              <v-icon
                icon="mdi-calendar"
                size="20"
              />
            </div>
            <div class="option-content">
              <div class="option-title">Pouze tuto událost</div>
              <div class="option-desc">
                {{ isDelete ? 'Smaže pouze tuto jednu instanci' : isCopy ? 'Zkopíruje pouze tuto jednu událost' : 'Vytvoří výjimku, ostatní zůstanou beze změny' }}
              </div>
            </div>
            <div
              v-if="scope === 'single'"
              class="option-check"
            >
              <v-icon
                icon="mdi-check-circle"
                size="20"
                color="primary"
              />
            </div>
          </label>

          <!-- Option 2:Following (not for first in series) -->
          <label
            v-if="!isFirstInSeries"
            class="option-card"
            :class="{ 'option-selected':scope === 'following' }"
          >
            <input
              v-model="scope"
              type="radio"
              value="following"
              class="option-radio"
            >
            <div class="option-icon">
              <v-icon
                icon="mdi-calendar-arrow-right"
                size="20"
              />
            </div>
            <div class="option-content">
              <div class="option-title">Tuto a všechny následující</div>
              <div class="option-desc">
                {{ isDelete ? 'Smaže tuto a všechny budoucí události' : isCopy ? 'Zkopíruje tuto a všechny následující události' : 'Rozdělí sérii od tohoto data' }}
              </div>
            </div>
            <div
              v-if="scope === 'following'"
              class="option-check"
            >
              <v-icon
                icon="mdi-check-circle"
                size="20"
                color="primary"
              />
            </div>
          </label>

          <!-- Option 3:All in series -->
          <label
            class="option-card"
            :class="{
              'option-selected':scope === 'series',
              'option-danger':isDelete && scope === 'series'
            }"
          >
            <input
              v-model="scope"
              type="radio"
              value="series"
              class="option-radio"
            >
            <div
              class="option-icon"
              :class="{ 'icon-danger': isDelete }"
            >
              <v-icon
                icon="mdi-calendar-multiple"
                size="20"
              />
            </div>
            <div class="option-content">
              <div class="option-title">Všechny události v sérii</div>
              <div class="option-desc">
                {{ isDelete ? 'Trvale smaže celou sérii včetně historie' : isCopy ? 'Zkopíruje celou sérii událostí' : 'Změní všechny události v sérii' }}
              </div>
            </div>
            <div
              v-if="scope === 'series'"
              class="option-check"
            >
              <v-icon
                icon="mdi-check-circle"
                size="20"
                :color="isDelete ? 'error': 'primary'"
              />
            </div>
          </label>
        </div>

        <!-- Warning for delete all -->
        <v-expand-transition>
          <div
            v-if="isDelete && scope === 'series'"
            class="warning-banner"
          >
            <v-icon
              icon="mdi-alert"
              size="18"
            />
            <span>Tato akce je nevratná. Všechny události budou trvale smazány.</span>
          </div>
        </v-expand-transition>

        <!-- Actions -->
        <div class="dialog-actions">
          <v-btn
            variant="text"
            size="large"
            @click="cancel"
          >
            Zrušit
          </v-btn>
          <v-btn
            :color="isDelete ? 'error': 'primary'"
            variant="flat"
            size="large"
            @click="confirm"
          >
            <v-icon
              :icon="isDelete ? 'mdi-delete':'mdi-check'"
              size="18"
              start
            />
            {{ isDelete ? 'Smazat':'Potvrdit změnu' }}
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.recurrence-dialog {
  padding: 0;
}

/* Header */
.dialog-header {
  display:flex;
  align-items:flex-start;
  gap: 14px;
  padding:20px 24px 16px;
  background:linear-gradient(135deg, rgba(var(--v-theme-primary), 0.08) 0%, rgba(var(--v-theme-primary), 0.02) 100%);
  border-bottom:1px solid rgba(var(--v-theme-primary), 0.1);
}

.dialog-header.header-delete {
  background:linear-gradient(135deg, rgba(var(--v-theme-error), 0.08) 0%, rgba(var(--v-theme-error), 0.02) 100%);
  border-bottom-color:rgba(var(--v-theme-error), 0.1);
}

.header-icon {
  width:44px;
  height:44px;
  border-radius:12px;
  background:rgba(var(--v-theme-primary), 0.12);
  color:rgb(var(--v-theme-primary));
  display:flex;
  align-items:center;
  justify-content: center;
  flex-shrink:0;
}

.header-icon.icon-delete {
  background:rgba(var(--v-theme-error), 0.12);
  color:rgb(var(--v-theme-error));
}

.header-title {
  font-size:18px;
  font-weight:600;
  color:#1f2937;
  line-height:1.3;
}

.header-subtitle {
  font-size:13px;
  color:#6b7280;
  margin-top:2px;
}

/* Info banner */
.info-banner {
  display:flex;
  align-items:flex-start;
  gap:10px;
  padding:12px 16px;
  margin: 16px 24px 0;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  font-size:13px;
  color:#1e40af;
  line-height:1.4;
}

/* Options */
.options-container {
  padding:16px 24px;
  display:flex;
  flex-direction:column;
  gap: 10px;
}

.option-card {
  display:flex;
  align-items:flex-start;
  gap:12px;
  padding:14px 16px;
  border:2px solid #e5e7eb;
  border-radius: 12px;
  cursor:pointer;
  transition:all 0.15s ease;
  background:white;
}

.option-card:hover {
  border-color:#d1d5db;
  background: #f9fafb;
}

.option-card.option-selected {
  border-color:rgb(var(--v-theme-primary));
  background:rgba(var(--v-theme-primary), 0.04);
}

.option-card.option-danger.option-selected {
  border-color: rgb(var(--v-theme-error));
  background:rgba(var(--v-theme-error), 0.04);
}

.option-radio {
  position:absolute;
  opacity: 0;
  pointer-events:none;
}

.option-icon {
  width: 36px;
  height:36px;
  border-radius:10px;
  background:#f3f4f6;
  color:#6b7280;
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
  transition:all 0.15s ease;
}

.option-selected.option-icon {
  background:rgba(var(--v-theme-primary), 0.12);
  color:rgb(var(--v-theme-primary));
}

.option-danger.option-selected.option-icon,
.option-icon.icon-danger {
  background:rgba(var(--v-theme-error), 0.12);
  color:rgb(var(--v-theme-error));
}

.option-content {
  flex: 1;
  min-width:0;
}

.option-title {
  font-size:14px;
  font-weight:600;
  color: #1f2937;
  line-height:1.3;
}

.option-desc {
  font-size:12px;
  color:#6b7280;
  margin-top:2px;
  line-height:1.4;
}

.option-check {
  flex-shrink:0;
  margin-top:2px;
}

/* Warning banner */
.warning-banner {
  display:flex;
  align-items:flex-start;
  gap:10px;
  padding: 12px 16px;
  margin:0 24px;
  background:#fef2f2;
  border:1px solid #fecaca;
  border-radius:10px;
  font-size:13px;
  color:#991b1b;
  line-height: 1.4;
}

/* Actions */
.dialog-actions {
  display:flex;
  justify-content:flex-end;
  gap:12px;
  padding:16px 24px 20px;
  border-top:1px solid #f3f4f6;
  margin-top:8px;
}
</style>
