<script setup lang="ts">
import { type StatsObj, type OutliersMeta, fmt2 } from './types'
defineProps<{
  stats: StatsObj | null
  outliers?: OutliersMeta | null
  /** kompaktní režim pro zobrazení v postranním panelu (compact mode) */
  compact?: boolean
}>()
</script>
<template>
  <section
    class="modern-section stats-section"
    :class="{ 'stats-compact': compact }"
  >
    <div
      v-if="!compact"
      class="section-header"
    >
      <v-icon
        size="18"
        color="primary"
      >
        mdi-chart-box-outline
      </v-icon>
      <h3 class="section-title">
        Statistické ukazatele
      </h3>
    </div>
    <div
      v-if="compact"
      class="compact-header"
    >
      <v-icon
        size="14"
        color="primary"
      >
        mdi-chart-box-outline
      </v-icon>
      <span>Statistika</span>
    </div>
    <div
      v-if="stats"
      class="stats-content"
    >
      <div
        class="stats-grid"
        :class="{ 'stats-grid-compact': compact }"
      >
        <div class="stat-item">
          <div class="stat-label">
            <v-icon
              size="14"
              color="blue"
            >
              mdi-chart-bell-curve
            </v-icon>
            Průměr
          </div>
          <div class="stat-value text-blue">
            {{ fmt2(stats.mean) }}
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-label">
            <v-icon
              size="14"
              color="purple"
            >
              mdi-counter
            </v-icon>
            Medián
          </div>
          <div class="stat-value">
            {{ fmt2(stats.median) }}
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-label">
            <v-icon
              size="14"
              color="orange"
            >
              mdi-sigma
            </v-icon>
            Směr. odchylka
          </div>
          <div class="stat-value">
            {{ fmt2(stats.stdDev) }}
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-label">
            <v-icon
              size="14"
              color="red"
            >
              mdi-arrow-down-thin
            </v-icon>
            Minimum
          </div>
          <div class="stat-value">
            {{ fmt2(stats.min) }}
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-label">
            <v-icon
              size="14"
              color="green"
            >
              mdi-arrow-up-thin
            </v-icon>
            Maximum
          </div>
          <div class="stat-value">
            {{ fmt2(stats.max) }}
          </div>
        </div>
        <div class="stat-item">
          <div class="stat-label">
            <v-icon
              size="14"
              color="deep-purple"
            >
              mdi-pound
            </v-icon>
            Počet
          </div>
          <div class="stat-value">
            {{ stats.count }}
          </div>
        </div>
      </div>
      <!-- upozornění na odlehlé hodnoty (outliers alert) -->
      <v-expand-transition>
        <div
          v-if="outliers && outliers.outlierIndexes.length"
          class="outliers-alert"
        >
          <div class="alert-content">
            <v-icon
              color="warning"
              size="18"
            >
              mdi-alert-outline
            </v-icon>
            <div class="alert-text">
              <div class="alert-title">
                Detekováno {{ outliers.outlierIndexes.length }} outlierů
              </div>
              <div class="alert-details">
                <span class="detail-label">Indexy:</span>
                <span class="detail-value">{{ outliers.outlierIndexes.join(', ') }}</span>
              </div>
              <div class="alert-details">
                <v-icon size="12">
                  mdi-arrow-expand-vertical
                </v-icon>
                <span class="detail-label">Fence:</span>
                <span class="detail-value">{{ fmt2(outliers.lowerFence) }} — {{ fmt2(outliers.upperFence) }}</span>
              </div>
            </div>
          </div>
        </div>
      </v-expand-transition>
    </div>
    <div
      v-else
      class="empty-state"
    >
      <v-icon
        size="40"
        color="grey-lighten-2"
      >
        mdi-chart-box-outline
      </v-icon>
      <div class="empty-text">
        Vyberte data pro výpočet statistik
      </div>
    </div>
  </section>
</template>
<style scoped>
/* moderní sekce: styl modré karty (blue card style) */
.modern-section {
  background: #F4F7FB;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.modern-section:hover {
  background: #F0F4F9;
  border-color: rgba(var(--v-theme-primary), 0.3);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}
.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  min-height: 56px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.4);
}
.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
  letter-spacing: 0.01em;
  margin: 0;
}
.stats-content {
  background: white;
}
/* mřížka statistik (stats grid) */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
.stat-item {
  padding: 16px 20px;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: white;
  transition: background-color 0.2s;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 80px;
}
.stat-item:hover {
  background-color: #fafafa;
}
/* odstranění pravého ohraničení pro poslední sloupec */
.stat-item:nth-child(3n) {
  border-right: none;
}
/* odstranění spodního ohraničení pro poslední řádek */
.stat-item:nth-last-child(-n+3) {
  border-bottom: none;
}
.stat-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(0, 0, 0, 0.5);
  margin-bottom: 8px;
}
.stat-value {
  font-size: 1.25rem;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: rgba(0, 0, 0, 0.87);
}
.text-blue {
  color: #1976D2 !important;
}
/* upozornění na odlehlé hodnoty (outliers alert) */
.outliers-alert {
  padding: 16px;
  background: #fff8e1;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
.alert-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.alert-text {
  flex: 1;
  font-size: 0.75rem;
  line-height: 1.5;
}
.alert-title {
  font-weight: 700;
  color: rgba(0, 0, 0, 0.87);
  margin-bottom: 6px;
}
.alert-details {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(0, 0, 0, 0.6);
  margin-top: 4px;
}
.detail-label {
  font-weight: 600;
}
.detail-value {
  font-family: ui-monospace, monospace;
}
/* prázdný stav (empty state) */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
}
.empty-text {
  font-size: 0.875rem;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 8px;
}
/* responzivita (responsive) */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  /* reset ohraničení pro 2 sloupce */
  .stat-item:nth-child(3n) {
    border-right: 1px solid rgba(0, 0, 0, 0.06);
  }
  .stat-item:nth-child(2n) {
    border-right: none;
  }
  .stat-item:nth-last-child(-n+3) {
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }
  .stat-item:nth-last-child(-n+2) {
    border-bottom: none;
  }
  .stat-item {
    padding: 12px 16px;
    min-height: 70px;
  }
  .stat-value {
    font-size: 1.1rem;
  }
}

/* kompaktní režim pro postranní panel (compact mode) */
.stats-compact {
  background: transparent;
  border: none;
}
.stats-compact:hover {
  background: transparent;
  box-shadow: none;
}
.compact-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(0, 0, 0, 0.5);
  margin-bottom: 8px;
}
.stats-grid-compact {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.stats-grid-compact .stat-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  min-height: auto;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: transparent;
}
.stats-grid-compact .stat-item:last-child {
  border-bottom: none;
}
.stats-grid-compact .stat-label {
  margin-bottom: 0;
  font-size: 0.65rem;
}
.stats-grid-compact .stat-value {
  font-size: 0.85rem;
}
.stats-compact .stats-content {
  background: transparent;
}
.stats-compact .outliers-alert {
  display: none;
}
</style>
