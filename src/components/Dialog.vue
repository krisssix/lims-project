<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    isOpen: boolean,
    width?: string | number,
    hideFooter?: boolean,
    maxHeight?: string | number,
    
    // nové vzhledové vlastnosti (aesthetic props)
    title?: string,
    subtitle?: string,
    icon?: string
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean],
  'close': []
}>()

function close() {
  emit('update:isOpen', false)
  emit('close')
}
</script>

<template>
  <v-dialog
    :model-value="isOpen"
    :width="width || '500px'"
    scrollable
    persistent
    @update:model-value="v => emit('update:isOpen', v)"
  >
    <div
      class="dialog-card"
      :style="{ maxHeight: props.maxHeight || '90vh' }"
    >
      <!-- záhlaví (header) -->
      <div
        v-if="title || $slots.header || icon"
        class="dialog-header text-left"
      >
        <slot name="header">
          <div class="header-row">
            <div class="header-left">
              <div
                v-if="icon"
                class="header-icon"
              >
                <v-icon
                  size="24"
                  color="white"
                >
                  {{ icon }}
                </v-icon>
              </div>
              <div class="header-text">
                <div class="header-title">
                  {{ title }}
                </div>
                <div
                  v-if="subtitle"
                  class="header-subtitle"
                >
                  {{ subtitle }}
                </div>
              </div>
            </div>
            <button
              type="button"
              class="close-btn"
              @click="close"
            >
              <v-icon size="18">
                mdi-close
              </v-icon>
            </button>
          </div>
        </slot>
      </div>

      <!-- obsah (content) -->
      <div class="dialog-content text-left">
        <slot name="content" />
        <slot />
      </div>

      <!-- patička (footer) -->
      <div
        v-if="!hideFooter || $slots.footer"
        class="dialog-footer"
      >
        <slot name="footer" />
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
/* styly zkopírované z reservationeditordialog, přejmenováno .res-* na .dialog-* */
.dialog-card {
  border-radius: 16px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  /* maximální výška se ovládá vazbou na styl (style binding) */
}

/* záhlaví (header) */
.dialog-header {
  background: #1976d2;
  padding: 20px 24px;
  color: white;
  flex-shrink: 0;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  width: 44px;
  height: 44px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.header-title {
  font-size: 18px;
  font-weight: 600;
}

.header-subtitle {
  font-size: 13px;
  opacity: 0.9;
  display: flex;
  align-items: center;
  margin-top: 2px;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* obsah (content) */
.dialog-content {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  color: rgba(0, 0, 0, 0.87);
  background: #ffffff;
}

/* patička (footer) */
.dialog-footer {
  padding: 16px 24px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
</style>
