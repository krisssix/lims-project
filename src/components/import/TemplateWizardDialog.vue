<template>
  <Dialog
    v-model:is-open="open"
    width="1800px"
    :hide-footer="true"
    class="template-wizard"
    :title="props.operation === 'edit' ? 'Úprava šablony' : 'Vytvoření šablony'"
    :icon="props.operation === 'edit' ? 'mdi-file-document-edit' : 'mdi-file-document-plus'"
  >
    <template #content>
      <div class="pa-4">

        <!-- upozornění na informace o verzi (pouze v režimu úprav) -->
        <v-alert
          v-if="versionInfoText"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          <div class="d-flex align-center">
            <span>
              Aktuální verze: <strong>{{ versionInfoText.version }}</strong>
              <span class="text-medium-emphasis ml-2">({{ versionInfoText.date }})</span>
            </span>
          </div>
        </v-alert>
        <!-- Název + Přístroj -->
        <div class="d-flex align-start ga-3 mb-4">
          <!-- prázdný stav: bez výběrového slotu (selection slot) -->
          <DeviceSelect
            v-if="!deviceCode"
            v-model="deviceCode"
            :items="devices"
            value-key="id"
            :max-width-px="220"
            :disabled="props.lockDevice"
            class="flex-shrink-0"
            style="min-width: 180px;"
          />
          <!-- vybraný stav: s výběrovým slotem (chip) -->
          <DeviceSelect
            v-else
            v-model="deviceCode"
            :items="devices"
            value-key="id"
            :max-width-px="220"
            :disabled="props.lockDevice"
            :readonly="props.lockDevice"
            class="flex-shrink-0"
            style="min-width: 180px;"
          />
          <v-text-field
            v-model="templateName"
            label="Název šablony"
            density="comfortable"
            variant="outlined"
            :error-messages="nameError || undefined"
            :class="{ 'validation-warn': formTouched && !templateName.trim() }"
            placeholder="Zadejte název šablony..."
            class="flex-grow-1"
            data-template-name-input
            @blur="formTouched = true"
          />
        </div>

        <!-- navigace v záložkách (tab navigation) -->
        <div class="main-tabs mb-4">
          <button
            type="button"
            class="main-tab"
            :class="{ 'main-tab-active': mainTab === 'structure' }"
            @click="mainTab = 'structure'"
          >
            <v-icon size="18">
              mdi-table
            </v-icon>
            Struktura šablony
          </button>
          <button
            v-if="props.operation === 'edit'"
            type="button"
            class="main-tab"
            :class="{ 'main-tab-active': mainTab === 'versions' }"
            @click="mainTab = 'versions'; loadVersionHistory()"
          >
            <v-icon size="18">
              mdi-history
            </v-icon>
            Přehled verzí
            <span
              v-if="versionHistory.length"
              class="tab-badge"
            >{{ versionHistory.length }}</span>
          </button>
          <button
            v-if="props.operation === 'edit'"
            type="button"
            class="main-tab"
            :class="{ 'main-tab-active': mainTab === 'mappings' }"
            @click="mainTab = 'mappings'"
          >
            <v-icon size="18">
              mdi-brain
            </v-icon>
            Naučená mapování
            <span
              v-if="learnedMappings.length"
              class="tab-badge"
            >{{ learnedMappings.length }}</span>
          </button>
        </div>

        <!-- obsah záložky: struktura šablony -->
        <div v-show="mainTab === 'structure'">
          <!-- sekce importu -->
          <div class="import-section mb-4">
            <div class="text-subtitle-2 mb-2">
              Import
            </div>
            <!-- panel nástrojů (neustále viditelný) -->
            <div class="import-toolbar d-flex ga-2 mb-2">
              <v-btn
                size="small"
                variant="tonal"
                color="secondary"
                prepend-icon="mdi-folder-open"
                @click="triggerFilePick"
              >
                {{ rawText.trim() ? 'Změnit soubor' : 'Vybrat soubor' }}
              </v-btn>
              <v-btn
                size="small"
                variant="outlined"
                prepend-icon="mdi-content-paste"
                @click="showTextareaInput = true"
              >
                Vložit text
              </v-btn>
              <v-btn
                v-if="rawText.trim()"
                size="small"
                variant="text"
                color="error"
                prepend-icon="mdi-close"
                @click="clearImport"
              >
                Vymazat
              </v-btn>
            </div>

            <!-- zóna pro přetažení (dropzone pro drag & drop) -->
            <div
              class="dropzone"
              :class="{ 'dropzone-active': isDragging, 'dropzone-compact': rawText.trim() }"
              @drop.prevent="onDropFile"
              @dragover.prevent="isDragging = true"
              @dragleave="isDragging = false"
              @paste="onPasteText"
            >
              <!-- prázdný stav -->
              <div
                v-if="!rawText.trim() && !showTextareaInput"
                class="dropzone-content"
              >
                <v-icon
                  size="32"
                  color="primary"
                >
                  mdi-cloud-upload-outline
                </v-icon>
                <div class="text-body-2 text-medium-emphasis mt-2">
                  Přetáhni soubor nebo vlož data (Ctrl+V)
                </div>
              </div>
              <!-- textová oblast pro manuální vložení -->
              <div
                v-if="showTextareaInput && !rawText.trim()"
                class="pa-2 w-100"
              >
                <v-textarea
                  v-model="rawText"
                  label="Vlož data ze schránky"
                  :rows="4"
                  variant="outlined"
                  density="compact"
                  hide-details
                  autofocus
                />
                <div class="d-flex ga-2 mt-2">
                  <v-btn
                    size="small"
                    variant="tonal"
                    color="primary"
                    :disabled="!rawText.trim()"
                    @click="parseFromRawText"
                  >
                    ANALYZOVAT
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="text"
                    @click="showTextareaInput = false; rawText = ''"
                  >
                    ZRUŠIT
                  </v-btn>
                </div>
              </div>
              <!-- ═══════════════════════════════════════════════════════════════ -->
              <!-- třívrstvá importní architektura (three-layer import architecture) -->
              <!-- vrstva 1: surová data | vrstva 2: návrhy | vrstva 3: šablona (autorita uživatele) -->
              <!-- ═══════════════════════════════════════════════════════════════ -->
              <div
                v-if="rawText.trim()"
                class="import-result-box"
              >
                <!-- 1: stavový řádek: „návrh připraven“, nikoliv „rozpoznáno“ -->
                <div
                  class="parse-status-bar"
                  :class="parseStatusClass"
                >
                  <div class="status-header d-flex align-center">
                    <v-icon
                      :color="parseStatusColor"
                      size="20"
                      class="mr-2"
                    >
                      {{ parseStatusIcon }}
                    </v-icon>
                    <span class="status-title">{{ parseStatusTitle }}</span>
                    <v-spacer />
                    <v-btn
                      size="small"
                      variant="text"
                      icon="mdi-close"
                      @click="clearImport"
                    />
                  </div>
                  <div class="status-subtitle text-medium-emphasis">
                    {{ parseStatusSubtitle }}
                  </div>
                </div>

                <!-- 2: hlavní akce (vždy viditelné) -->
                <div class="action-bar d-flex flex-wrap ga-2 py-3">
                  <v-btn
                    size="small"
                    color="primary"
                    variant="flat"
                    prepend-icon="mdi-check"
                    @click="applyProposal"
                  >
                    Použít návrh
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="outlined"
                    color="primary"
                    prepend-icon="mdi-cog"
                    @click="showFormatDialog = true"
                  >
                    Upravit formát
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="outlined"
                    color="primary"
                    prepend-icon="mdi-table-column-plus-after"
                    @click="createColumnsFromData"
                  >
                    Pole ze sloupců
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="outlined"
                    prepend-icon="mdi-hand-pointing-up"
                    @click="showManualHeaderPicker = true"
                  >
                    Ruční výběr
                  </v-btn>
                  <v-spacer />
                  <v-btn-group
                    variant="text"
                    density="compact"
                  >
                    <v-btn
                      size="small"
                      :color="activeTab === 'preview' ? 'primary' : undefined"
                      @click="activeTab = 'preview'"
                    >
                      Náhled
                    </v-btn>
                    <v-btn
                      size="small"
                      :color="activeTab === 'blocks' ? 'primary' : undefined"
                      @click="activeTab = 'blocks'"
                    >
                      Bloky
                    </v-btn>
                    <v-btn
                      size="small"
                      :color="activeTab === 'raw' ? 'primary' : undefined"
                      @click="activeTab = 'raw'"
                    >
                      Raw data
                    </v-btn>
                  </v-btn-group>
                </div>

                <!-- 3: záložky: bloky / surová data (raw) / náhled (preview) -->
                <v-window
                  v-model="activeTab"
                  class="mt-2"
                >
                  <!-- BLOCKS TAB -->
                  <v-window-item value="blocks">
                    <BlockSelector
                      :blocks="proposal.blocks"
                      :selected-block-id="selectedBlockId"
                      :included-block-ids="includedBlockIds"
                      @select="onBlockSelect"
                      @toggle-include="onToggleInclude"
                      @action="onBlockAction"
                      @change-type="onBlockTypeChange"
                      @update-description="onBlockDescriptionChange"
                      @confirm-blocks="onConfirmBlocks"
                    />
                  </v-window-item>

                  <!-- RAW DATA TAB -->
                  <v-window-item value="raw">
                    <RawDataPreview
                      :raw-lines="proposal.rawLines"
                      :raw-grid="proposal.rawGrid"
                      :blocks="proposal.blocks"
                      :selected-block-id="selectedBlockId"
                      @row-click="onRawRowClick"
                    />
                  </v-window-item>

                  <!-- PARSED PREVIEW TAB -->
                  <v-window-item value="preview">
                    <div class="preview-panel">
                      <!-- hlavička s panelem nástrojů pro určení řádků -->
                      <div class="preview-header d-flex align-center flex-wrap ga-2 mb-2">
                        <span class="text-subtitle-2">Náhled interpretace</span>
                        <v-chip
                          size="small"
                          variant="outlined"
                        >
                          {{ rawDataRows.length }} řádků × {{ mainHeader.length }} sloupců
                        </v-chip>
                        <v-spacer />
                        <!-- tlačítka pro určení typu řádku -->
                        <v-btn-group
                          variant="outlined"
                          density="compact"
                          divided
                        >
                          <v-btn
                            size="small"
                            :color="rowDesignationMode === 'header' ? 'orange' : undefined"
                            :variant="rowDesignationMode === 'header' ? 'flat' : 'outlined'"
                            @click="setRowDesignationMode('header')"
                          >
                            <v-icon
                              start
                              size="16"
                            >
                              mdi-format-header-1
                            </v-icon>
                            Hlavička
                          </v-btn>
                          <v-btn
                            size="small"
                            :color="rowDesignationMode === 'units' ? 'purple' : undefined"
                            :variant="rowDesignationMode === 'units' ? 'flat' : 'outlined'"
                            @click="setRowDesignationMode('units')"
                          >
                            <v-icon
                              start
                              size="16"
                            >
                              mdi-format-subscript
                            </v-icon>
                            Jednotky
                          </v-btn>
                          <v-btn
                            size="small"
                            :color="rowDesignationMode === 'data' ? 'blue' : undefined"
                            :variant="rowDesignationMode === 'data' ? 'flat' : 'outlined'"
                            @click="setRowDesignationMode('data')"
                          >
                            <v-icon
                              start
                              size="16"
                            >
                              mdi-table-row
                            </v-icon>
                            Data od
                          </v-btn>
                        </v-btn-group>
                        <v-btn
                          v-if="headerRowIdx !== null || unitsRowIdx !== null || dataStartRowIdx !== null"
                          size="small"
                          variant="text"
                          color="error"
                          @click="clearRowDesignations"
                        >
                          <v-icon size="16">
                            mdi-refresh
                          </v-icon>
                          Reset
                        </v-btn>
                      </div>
                      <!-- nápověda k režimu výběru -->
                      <v-alert
                        v-if="rowDesignationMode"
                        type="info"
                        density="compact"
                        variant="tonal"
                        class="mb-2"
                      >
                        Klikni na řádek pro označení jako
                        <strong>{{ rowDesignationMode === 'header' ? 'hlavička' : rowDesignationMode === 'units' ? 'jednotky' : 'začátek dat' }}</strong>
                      </v-alert>
                      <!-- tabulka náhledu s čísly řádků -->
                      <div class="preview-table-container">
                        <table class="preview-table">
                          <thead>
                            <tr>
                              <th class="row-num-th">
                                #
                              </th>
                              <th
                                v-for="(header, idx) in previewHeaders"
                                :key="'h-' + idx"
                                class="preview-th"
                                :class="{ 'highlighted': highlightedColumn === idx }"
                                @click="onPreviewColumnClick(idx)"
                              >
                                {{ header || `(${idx + 1})` }}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              v-for="(row, ri) in previewRows"
                              :key="'r-' + ri"
                              class="preview-row"
                              :class="{
                                'row-header': getRowType(effectiveDataStartRow + ri) === 'header',
                                'row-units': getRowType(effectiveDataStartRow + ri) === 'units',
                                'row-data': getRowType(effectiveDataStartRow + ri) === 'data',
                                'is-selectable': rowDesignationMode !== null
                              }"
                              @click="onPreviewRowClick(effectiveDataStartRow + ri, $event)"
                            >
                              <td class="row-num-td">
                                {{ effectiveDataStartRow + ri + 1 }}
                              </td>
                              <td
                                v-for="(cell, ci) in row"
                                :key="'c-' + ci"
                                class="preview-td"
                                :class="{ 'highlighted': highlightedColumn === ci }"
                              >
                                {{ truncateCell(cell) }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </v-window-item>
                </v-window>

                <!-- 4: shrnutí parsování (rozbalovací) -->
                <details class="parse-summary-details mt-3">
                  <summary class="text-caption text-medium-emphasis cursor-pointer">
                    <v-icon size="12">
                      mdi-information-outline
                    </v-icon>
                    Jak byl soubor interpretován
                  </summary>
                  <div class="d-flex flex-wrap ga-2 mt-2">
                    <v-chip
                      size="small"
                      variant="tonal"
                      color="primary"
                    >
                      Delimiter: {{ usedDelimiterLabel }}
                    </v-chip>
                    <v-chip
                      size="small"
                      variant="tonal"
                      color="primary"
                    >
                      Hlavička: {{ usedHeaderLabel }}
                    </v-chip>
                    <v-chip
                      v-if="unitRowDetected"
                      size="small"
                      variant="tonal"
                      color="success"
                    >
                      Jednotky: sloučeny
                    </v-chip>
                    <v-chip
                      v-if="seriesHeader.length"
                      size="small"
                      variant="tonal"
                      color="deep-purple"
                    >
                      Série: {{ seriesHeader.length }} sloupců
                    </v-chip>
                    <v-chip
                      size="small"
                      variant="outlined"
                    >
                      {{ proposal.blocks.length }} bloků nalezeno
                    </v-chip>
                  </div>
                </details>
              </div>
            </div>
            <input
              ref="fileInput"
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              style="display:none"
              @change="onFilePicked"
            >
            <!-- Format Dialog -->
            <ImportFormatDialog
              v-model="showFormatDialog"
              :raw-text="rawText"
              :has-user-edited-fields="hasUserEditedFields"
              @apply-format="onApplyFormat"
            />
          </div>

          <!-- Learned Mappings Section (Edit Mode Only) -->

          <!-- sekce bloků (blocks section) -->
          <div class="blocks-section">
            <div
              class="d-flex align-center mb-2"
              style="gap:12px; flex-wrap:wrap;"
            >
              <div class="preview-header">
                Struktura šablony
              </div>
              <v-spacer />
              <div
                v-if="pickedBlocks.length"
                class="d-flex align-center"
                style="gap:6px;"
              >
                <v-btn
                  size="small"
                  variant="text"
                  :disabled="currentBlockIndex === 0"
                  @click="prevBlock"
                >
                  ◀
                </v-btn>
                <div class="text-caption">
                  Tabulka hodnot {{ currentBlockIndex + 1 }} / {{ pickedBlocks.length }}
                </div>
                <v-btn
                  size="small"
                  variant="text"
                  :disabled="currentBlockIndex === pickedBlocks.length - 1"
                  @click="nextBlock"
                >
                  ▶
                </v-btn>
              </div>
              <v-btn
                color="primary"
                variant="tonal"
                @click="addEmptyBlockAndGo"
              >
                Přidat tabulku hodnot
              </v-btn>
              <v-btn
                color="secondary"
                variant="tonal"
                @click="addSeriesBlockEmpty"
              >
                <v-icon start>
                  mdi-chart-line
                </v-icon>
                Přidat datovou sérii
              </v-btn>
            </div>
            <div
              v-if="pickedBlocks.length === 0"
              class="text-medium-emphasis mb-3"
            >
              Zatím žádné sady hodnot. Přidej první sadu hodnot tlačítkem „Nová tabulka".
            </div>
            <!-- editor bloku -->
            <div
              v-for="(pb, pbi) in pickedBlocks"
              v-show="pbi === currentBlockIndex"
              :key="pb.id"
              class="picked-block"
            >
              <div class="d-flex align-center ga-2 mb-2">
                <v-text-field
                  v-model="pb.title"
                  label="Název sady hodnot"
                  density="comfortable"
                  hide-details
                  variant="outlined"
                  class="flex-grow-1"
                />
                <v-spacer />
                <v-btn
                  icon="mdi-chevron-up"
                  variant="text"
                  :disabled="pbi === 0"
                  @click="movePickedBlock(pb.id, -1)"
                />
                <v-btn
                  icon="mdi-chevron-down"
                  variant="text"
                  :disabled="pbi === pickedBlocks.length - 1"
                  @click="movePickedBlock(pb.id, 1)"
                />
                <v-btn
                  icon="mdi-delete-outline"
                  variant="text"
                  color="error"
                  @click="removePickedBlock(pb.id)"
                />
              </div>
              <div class="field-table-wrapper elevation-1">
                <table class="field-table">
                  <thead>
                    <tr>
                      <th style="width: 70px;">
                        Poř.
                      </th>
                      <th>Název pole</th>
                      <th style="width: 160px;">
                        Typ
                      </th>
                      <th style="width: 120px;">
                        Povinné
                      </th>
                      <th style="width: 112px;" />
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(item, index) in pb.fieldRows"
                      :key="item.id"
                      class="field-row"
                      :class="{
                        'drag-over': fieldDragOverIdx === index && fieldDragState?.blockId === pb.id,
                        'is-dragging': fieldDragState?.fromIdx === index && fieldDragState?.blockId === pb.id
                      }"
                      draggable="true"
                      @dragstart="e => onFieldDragStart(pb.id, index, e)"
                      @dragend="onFieldDragEnd"
                      @dragover="e => onFieldDragOver(index, e)"
                      @dragleave="onFieldDragLeave"
                      @drop="e => onFieldDrop(pb.id, index, e)"
                    >
                      <td
                        class="text-caption field-drag-handle"
                        style="cursor: grab;"
                      >
                        <v-icon
                          size="14"
                          class="mr-1"
                        >
                          mdi-drag
                        </v-icon>
                        {{ item.orderIndex }}
                      </td>
                      <td>
                        <v-text-field
                          v-model="item.name"
                          density="compact"
                          hide-details
                          variant="plain"
                          :placeholder="`Pole ${item.orderIndex}`"
                          data-field-input
                          @keydown.enter.prevent="addFieldTo(pb.id, index + 1)"
                        />
                      </td>
                      <td>
                        <v-select
                          v-model="item.type"
                          :items="typeOptions"
                          item-title="label"
                          item-value="value"
                          density="compact"
                          hide-details
                          variant="plain"
                        />
                      </td>
                      <td>
                        <v-checkbox
                          v-model="item.required"
                          density="compact"
                          hide-details
                        />
                      </td>
                      <td>
                        <div class="d-flex ga-1">
                          <v-btn
                            icon="mdi-delete-outline"
                            size="small"
                            variant="text"
                            color="error"
                            @click="removeFieldIn(pb.id, index)"
                          />
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="d-flex align-center ga-2 mt-2">
                <v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  @click="addFieldTo(pb.id)"
                >
                  PŘIDAT POLE (Enter)
                </v-btn>
              </div>
            </div>
          </div>
          <!-- poznámka: blok série se vykresluje v hlavní sekci bloků výše -->
          <!-- starý režim importu: vypnutý, lze smazat -->
          <div v-if="false">
            <div class="d-flex align-center ga-3 mb-3">
              <v-btn
                variant="tonal"
                color="primary"
                @click="triggerFilePick"
              >
                VYBRAT SOUBOR
              </v-btn>
              <input
                ref="fileInput"
                type="file"
                accept=".csv,.tsv,.txt"
                style="display:none"
                @change="onFilePicked"
              >
              <v-select
                v-model="delimiter"
                :items="delimiterOptions"
                item-title="label"
                item-value="value"
                label="Oddělovač"
                density="comfortable"
                variant="outlined"
                hide-details
                style="max-width: 220px"
              />
            </div>
            <v-textarea
              v-model="rawText"
              label="Schránka (tab/CSV; první řádek hlavička)"
              :rows="6"
              variant="outlined"
              density="comfortable"
              hide-details
              class="mb-3"
            />
            <v-alert
              v-if="!rawText.trim() && !mainHeader.length"
              type="info"
              density="comfortable"
              variant="tonal"
              class="mb-3"
            >
              Importuj data výběrem souboru výše, nebo je vlož přímo do textového pole.
            </v-alert>
            <!-- tlačítko analyzovat (zobrazí se při vložení dat, ale před parsováním) -->
            <v-btn
              v-if="rawText.trim() && !mainHeader.length"
              color="primary"
              variant="tonal"
              class="mb-3"
              @click="parseFromRawText"
            >
              ANALYZOVAT
            </v-btn>
            <div
              v-else
              class="mb-3"
            >
              <div
                class="d-flex align-center mb-2"
                style="gap: 8px;"
              >
                <span class="preview-header">Hlavičky (Tabulka hodnot 1)</span>
                <v-chip
                  v-if="unitRowDetected"
                  size="small"
                  color="success"
                  variant="tonal"
                >
                  <v-icon
                    start
                    size="12"
                  >
                    mdi-check-circle
                  </v-icon>
                  Jednotky rozpoznány
                </v-chip>
              </div>
              <div class="d-flex flex-wrap ga-2 mb-3">
                <v-chip
                  v-for="(h, i) in mainHeader"
                  :key="i"
                  size="small"
                  :color="h.includes('(') ? 'deep-purple' : undefined"
                  :variant="h.includes('(') ? 'tonal' : 'elevated'"
                >
                  {{ h }}
                </v-chip>
              </div>
              <div
                v-if="seriesHeader.length"
                class="mb-3"
              >
                <div class="preview-header mb-1">
                  <v-icon
                    size="16"
                    color="deep-purple"
                    class="mr-1"
                  >
                    mdi-chart-line
                  </v-icon>
                  Detekovaná datová série
                </div>
                <div class="d-flex ga-2 flex-wrap mb-1">
                  <v-chip
                    v-for="(h,i) in seriesHeader"
                    :key="'s-'+i"
                    size="small"
                    color="deep-purple"
                    variant="tonal"
                  >
                    {{ h }}
                  </v-chip>
                </div>
                <div class="text-caption text-medium-emphasis">
                  Série bude automaticky importována do sekce "Datové série" při vytvoření měření.
                </div>
              </div>
              <div
                v-if="statsLines.length"
                class="mb-3"
              >
                <div class="preview-header mb-1">
                  Ignorované statistické řádky
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ statsLines.join(' | ') }}
                </div>
              </div>
              <v-btn
                color="primary"
                variant="tonal"
                @click="createBlocksFromParsed"
              >
                VYTVOŘIT BLOKY
              </v-btn>
            </div>
            <!-- vybrané bloky po vytvoření -->
            <div
              v-if="pickedBlocks.length"
              class="mb-3"
            >
              <div class="preview-header mb-2">
                Bloky šablony
              </div>
              <div
                class="d-flex align-center mb-2"
                style="gap:6px;"
              >
                <v-btn
                  size="small"
                  variant="text"
                  :disabled="currentBlockIndex === 0"
                  @click="prevBlock"
                >
                  ◀
                </v-btn>
                <div class="text-caption">
                  Tabulka hodnot {{ currentBlockIndex + 1 }} / {{ pickedBlocks.length }}
                </div>
                <v-btn
                  size="small"
                  variant="text"
                  :disabled="currentBlockIndex === pickedBlocks.length - 1"
                  @click="nextBlock"
                >
                  ▶
                </v-btn>
                <v-spacer />
                <v-btn
                  color="primary"
                  variant="tonal"
                  @click="addEmptyBlockAndGo"
                >
                  NOVÁ TABULKA
                </v-btn>
              </div>
              <div
                v-for="(pb, pbi) in pickedBlocks"
                v-show="pbi === currentBlockIndex"
                :key="pb.id"
                class="picked-block"
              >
                <div class="d-flex align-center ga-2 mb-2">
                  <v-text-field
                    v-model="pb.title"
                    density="comfortable"
                    hide-details
                    variant="outlined"
                    class="flex-grow-1"
                  />
                  <v-btn
                    icon="mdi-delete-outline"
                    size="small"
                    color="error"
                    variant="text"
                    @click="removePickedBlock(pb.id)"
                  />
                </div>
                <div class="field-table-wrapper elevation-1 mb-2">
                  <table class="field-table">
                    <thead>
                      <tr>
                        <th style="width: 70px;">
                          Poř.
                        </th>
                        <th>Název pole</th>
                        <th style="width: 160px;">
                          Typ
                        </th>
                        <th style="width: 120px;">
                          Povinné
                        </th>
                        <th style="width: 60px;" />
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(item, index) in pb.fieldRows"
                        :key="item.id"
                        class="field-row"
                        :class="{
                          'drag-over': fieldDragOverIdx === index && fieldDragState?.blockId === pb.id,
                          'is-dragging': fieldDragState?.fromIdx === index && fieldDragState?.blockId === pb.id
                        }"
                        draggable="true"
                        @dragstart="e => onFieldDragStart(pb.id, index, e)"
                        @dragend="onFieldDragEnd"
                        @dragover="e => onFieldDragOver(index, e)"
                        @dragleave="onFieldDragLeave"
                        @drop="e => onFieldDrop(pb.id, index, e)"
                      >
                        <td
                          class="text-caption field-drag-handle"
                          style="cursor: grab;"
                        >
                          <v-icon
                            size="14"
                            class="mr-1"
                          >
                            mdi-drag
                          </v-icon>
                          {{ item.orderIndex }}
                        </td>
                        <td>
                          <v-text-field
                            v-model="item.name"
                            density="compact"
                            hide-details
                            variant="plain"
                            :placeholder="`Pole ${item.orderIndex}`"
                            @keydown.enter.prevent="addFieldTo(pb.id, index + 1)"
                          />
                        </td>
                        <td>
                          <v-select
                            v-model="item.type"
                            :items="typeOptions"
                            item-title="label"
                            item-value="value"
                            density="compact"
                            hide-details
                            variant="plain"
                          />
                        </td>
                        <td>
                          <v-checkbox
                            v-model="item.required"
                            density="compact"
                            hide-details
                          />
                        </td>
                        <td>
                          <v-btn
                            icon="mdi-delete-outline"
                            size="small"
                            variant="text"
                            color="error"
                            @click="removeFieldIn(pb.id, index)"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  @click="addFieldTo(pb.id)"
                >
                  PŘIDAT POLE
                </v-btn>
              </div>
            </div>
          </div>
          <!-- blok série (editovatelná tabulka jako hlavní bloky) -->
          <div
            v-if="seriesFieldRows.length && pickedBlocks.length"
            class="series-block mt-4"
          >
            <div class="block-card">
              <div class="d-flex align-center ga-2 mb-3">
                <v-icon
                  size="20"
                  color="deep-purple"
                >
                  mdi-chart-line
                </v-icon>
                <v-text-field
                  v-model="seriesBlockTitle"
                  density="compact"
                  hide-details
                  variant="outlined"
                  placeholder="Datová série"
                  class="block-title-input"
                  style="max-width: 400px;"
                />
                <v-chip
                  v-if="seriesDataLines.length"
                  size="small"
                  color="deep-purple"
                  variant="tonal"
                >
                  {{ seriesDataLines.length }} bodů dat
                </v-chip>
                <v-spacer />
                <v-btn
                  v-if="selectedSeriesRows.size > 0"
                  size="small"
                  variant="tonal"
                  color="error"
                  @click="deleteSelectedSeriesFields"
                >
                  SMAZAT VYBRANÉ ({{ selectedSeriesRows.size }})
                </v-btn>
              </div>
              <div class="table-wrapper">
                <table class="field-table">
                  <thead>
                    <tr>
                      <th style="width: 40px;" />
                      <th style="width: 70px;">
                        Poř.
                      </th>
                      <th>Název pole</th>
                      <th style="width: 160px;">
                        Typ
                      </th>
                      <th style="width: 120px;">
                        Povinné
                      </th>
                      <th style="width: 60px;" />
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(item, index) in seriesFieldRows"
                      :key="item.id"
                      class="field-row series-field-row"
                      :class="{
                        'selected': selectedSeriesRows.has(index)
                      }"
                    >
                      <td>
                        <v-checkbox
                          :model-value="selectedSeriesRows.has(index)"
                          density="compact"
                          hide-details
                          @click="onSeriesRowClick(index, $event)"
                        />
                      </td>
                      <td
                        class="text-caption"
                        style="cursor: default;"
                      >
                        <v-icon
                          size="14"
                          class="mr-1"
                        >
                          mdi-drag
                        </v-icon>
                        {{ item.orderIndex }}
                      </td>
                      <td>
                        <v-text-field
                          v-model="item.name"
                          density="compact"
                          hide-details
                          variant="plain"
                          :placeholder="`Pole ${item.orderIndex}`"
                          @keydown.enter.prevent="addSeriesField(index + 1)"
                          @click.stop
                        />
                      </td>
                      <td>
                        <v-select
                          v-model="item.type"
                          :items="typeOptions"
                          item-title="label"
                          item-value="value"
                          density="compact"
                          hide-details
                          variant="plain"
                          @click.stop
                        />
                      </td>
                      <td>
                        <v-checkbox
                          v-model="item.required"
                          density="compact"
                          hide-details
                          @click.stop
                        />
                      </td>
                      <td>
                        <v-btn
                          icon="mdi-delete-outline"
                          size="small"
                          variant="text"
                          color="error"
                          @click.stop="removeSeriesField(index)"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <v-btn
                size="small"
                color="deep-purple"
                variant="tonal"
                class="mt-2"
                @click="addSeriesField()"
              >
                PŘIDAT POLE
              </v-btn>
              <div class="text-caption text-medium-emphasis mt-2">
                <v-icon
                  size="14"
                  class="mr-1"
                >
                  mdi-information-outline
                </v-icon>
                Série bude importována do sekce "Datové série" při vytváření měření. Shift+klik pro výběr více řádků.
              </div>
            </div>
          </div>
        </div><!-- konec záložky struktura (structure tab) -->

        <!-- obsah záložky: přehled verzí -->
        <div
          v-show="mainTab === 'versions'"
          class="versions-tab"
        >
          <!-- Header -->
          <div class="versions-header">
            <div class="d-flex align-center">
              <v-checkbox
                v-if="versionHistory.some(v => v.status !== 'ACTIVE')"
                :model-value="allSelectableSelected"
                :indeterminate="someSelected && !allSelectableSelected"
                hide-details
                density="compact"
                class="mr-2"
                @update:model-value="toggleSelectAll"
              />
              <div>
                <div class="versions-title">
                  <v-icon
                    size="22"
                    color="blue"
                    class="mr-2"
                  >
                    mdi-history
                  </v-icon>
                  Přehled verzí
                </div>
                <div class="versions-subtitle text-medium-emphasis">
                  Přehled všech verzí této šablony
                </div>
              </div>
            </div>
            <v-btn
              v-if="selectedVersionIds.size > 0"
              color="error"
              variant="tonal"
              size="small"
              prepend-icon="mdi-delete"
              @click="showBulkDeleteDialog = true"
            >
              Smazat vybrané ({{ selectedVersionIds.size }})
            </v-btn>
          </div>

          <!-- stav načítání -->
          <div
            v-if="versionHistoryLoading"
            class="d-flex align-center justify-center pa-8"
          >
            <v-progress-circular
              indeterminate
              color="primary"
            />
            <span class="ml-3 text-medium-emphasis">Načítání verzí...</span>
          </div>

          <!-- seznam verzí -->
          <div
            v-else-if="versionHistory.length > 0"
            class="versions-list"
          >
            <div
              v-for="ver in versionHistory"
              :key="ver.id"
              class="version-row"
              :class="{ 'selected': selectedVersionIds.has(ver.id) }"
            >
              <div class="version-row-left">
                <div class="mr-2" style="width: 32px">
                  <v-checkbox
                    v-if="ver.status !== 'ACTIVE'"
                    :model-value="selectedVersionIds.has(ver.id)"
                    hide-details
                    density="compact"
                    @update:model-value="toggleVersionSelection(ver.id)"
                  />
                </div>
                <v-chip
                  size="small"
                  :color="ver.status === 'ACTIVE' ? 'success' : ver.status === 'DRAFT' ? 'warning' : 'grey'"
                  variant="flat"
                  class="mr-3"
                >
                  <v-icon
                    start
                    size="14"
                  >
                    {{ ver.status === 'ACTIVE' ? 'mdi-check-circle' : ver.status === 'DRAFT' ? 'mdi-pencil' : 'mdi-archive' }}
                  </v-icon>
                  v{{ ver.version }}
                </v-chip>
                <span
                  v-if="ver.status === 'ACTIVE'"
                  class="version-badge-active"
                >
                  Aktivní
                </span>
                <span class="version-date text-medium-emphasis">
                  {{ formatVersionDate(ver.updatedAt) }}
                </span>
                <span
                  v-if="ver.changeDescription"
                  class="version-desc text-medium-emphasis ml-3"
                >
                  {{ ver.changeDescription.length > 50 ? ver.changeDescription.slice(0, 50) + '...' : ver.changeDescription }}
                </span>
              </div>
              <div class="version-row-right">
                <v-menu
                  v-if="ver.status !== 'ACTIVE'"
                  offset-y
                >
                  <template #activator="{ props: menuProps }">
                    <v-btn
                      icon
                      variant="text"
                      size="small"
                      v-bind="menuProps"
                    >
                      <v-icon size="18">mdi-dots-vertical</v-icon>
                    </v-btn>
                  </template>
                  <v-list density="compact">
                    <v-list-item @click="openVersionPreview(ver)">
                      <template #prepend>
                        <v-icon size="18">mdi-eye</v-icon>
                      </template>
                      <v-list-item-title>Zobrazit</v-list-item-title>
                    </v-list-item>
                    <v-list-item @click="openRollbackDialog(ver)">
                      <template #prepend>
                        <v-icon
                          size="18"
                          color="warning"
                        >
                          mdi-backup-restore
                        </v-icon>
                      </template>
                      <v-list-item-title>Nastavit jako aktivní</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
                <v-chip
                  v-else
                  size="x-small"
                  color="success"
                  variant="tonal"
                >
                  Aktuální
                </v-chip>
              </div>
            </div>
          </div>

          <!-- prázdný stav -->
          <div
            v-else
            class="versions-empty"
          >
            <v-icon
              size="48"
              color="grey-lighten-1"
              class="mb-2"
            >
              mdi-history
            </v-icon>
            <div class="text-body-2">
              Žádná historie verzí
            </div>
            <div class="text-caption text-medium-emphasis">
              Tato šablona zatím nemá žádné předchozí verze.
            </div>
          </div>
        </div><!-- konec záložky verze (versions tab) -->

        <!-- obsah záložky: naučená mapování -->
        <div
          v-show="mainTab === 'mappings'"
          style="padding: 24px;"
        >
          <!-- hlavička -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
            <div>
              <div style="font-size: 16px; font-weight: 600; color: #374151; display: flex; align-items: center; gap: 10px;">
                <v-icon icon="mdi-brain" style="font-size: 22px; color: #7c3aed;" />
                Naučená mapování z importů
              </div>
              <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">
                Systém si pamatuje jak byly sloupce ze souborů mapovány na pole šablony
              </div>
            </div>
            <button
              v-if="learnedMappings.length > 0"
              type="button"
              style="height: 36px; padding: 0 14px; border: 1px solid #fecaca; background: #fef2f2; color: #dc2626; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: 8px; display: flex; align-items: center; gap: 6px; transition: all 0.15s;"
              @click="confirmClearAll = true"
              onmouseover="this.style.background='#fee2e2'"
              onmouseout="this.style.background='#fef2f2'"
            >
              <v-icon icon="mdi-delete-sweep" style="font-size: 16px;" />
              Vymazat vše
            </button>
          </div>

          <!-- statistiky -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
            <div style="background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 10px; padding: 14px 16px;">
              <div style="font-size: 24px; font-weight: 700; color: #7c3aed;">{{ learnedMappings.length }}</div>
              <div style="font-size: 12px; color: #6b7280;">Celkem mapování</div>
            </div>
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 14px 16px;">
              <div style="font-size: 24px; font-weight: 700; color: #059669;">{{ totalUsageCount }}</div>
              <div style="font-size: 12px; color: #6b7280;">Celkem použití</div>
            </div>
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 10px; padding: 14px 16px;">
              <div style="font-size: 24px; font-weight: 700; color: #d97706;">{{ groupedMappings.length }}</div>
              <div style="font-size: 12px; color: #6b7280;">Cílových polí</div>
            </div>
          </div>

          <!-- mapování seskupená podle cílového pole -->
          <div
            v-if="groupedMappings.length > 0"
            style="border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;"
          >
            <template v-for="(group, gIdx) in groupedMappings" :key="group.targetField">
              <!-- hlavička skupiny -->
              <div style="background: #f9fafb; padding: 10px 16px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <div class="d-flex align-center justify-center" :style="{ width: '28px', height: '28px', background: getGroupColor(gIdx), borderRadius: '6px' }">
                    <v-icon icon="mdi-target" size="16" color="white" />
                  </div>
                  <div>
                    <div style="font-size: 13px; font-weight: 600; color: #374151;">{{ group.targetField }}</div>
                    <div style="font-size: 11px; color: #9ca3af;">
                      {{ group.mappings.length }} {{ group.mappings.length === 1 ? 'alias' : 'aliasy' }}
                    </div>
                  </div>
                </div>
                <div class="d-flex align-center">
                   <v-btn
                    icon
                    variant="text"
                    size="x-small"
                    color="primary"
                    :title="addingAliasFor === group.targetField ? 'Zrušit' : 'Přidat alias'"
                    @click="toggleAddAliasRow(group.targetField)"
                    class="mr-2"
                  >
                    <v-icon size="18">
                      {{ addingAliasFor === group.targetField ? 'mdi-close' : 'mdi-plus' }}
                    </v-icon>
                  </v-btn>
                  <v-icon icon="mdi-chevron-down" style="font-size: 20px; color: #9ca3af; cursor: pointer;" />
                </div>
              </div>

              <!-- řádky mapování -->
              <div style="background: white;">
                <div
                  v-for="mapping in group.mappings"
                  :key="mapping.id"
                  style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; display: flex; align-items: center; justify-content: space-between;"
                >
                  <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <div style="width: 24px; height: 24px; background: #f3f4f6; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
                      <v-icon icon="mdi-file-outline" style="font-size: 14px; color: #6b7280;" />
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-size: 13px; color: #374151; font-family: monospace; background: #f9fafb; padding: 2px 8px; border-radius: 4px;">{{ mapping.sourceColumnRaw }}</span>
                      <v-icon icon="mdi-arrow-right" style="font-size: 16px; color: #9ca3af;" />
                      <span style="font-size: 13px; font-weight: 600; color: #7c3aed;">{{ mapping.targetFieldName }}</span>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 12px; color: #6b7280; background: #f3f4f6; padding: 2px 8px; border-radius: 10px;">{{ mapping.useCount }}×</span>
                    <button
                      style="width: 28px; height: 28px; border: none; background: transparent; cursor: pointer; border-radius: 6px; display: flex; align-items: center; justify-content: center;"
                      @click="askDeleteMapping(mapping)"
                      onmouseover="this.style.background='#fee2e2'"
                      onmouseout="this.style.background='transparent'"
                    >
                      <v-icon icon="mdi-delete-outline" style="font-size: 18px; color: #ef4444;" />
                    </button>
                  </div>
                </div>

                <!-- vložený řádek pro přidání aliasu (add alias inline row) -->
                <div
                  v-if="addingAliasFor === group.targetField"
                  style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; display: flex; align-items: center; gap: 12px;"
                >
                   <v-icon icon="mdi-plus-circle-outline" size="14" color="primary" />
                   <div style="flex: 1;">
                      <v-text-field
                        v-model="newAliasInput"
                        density="compact"
                        variant="outlined"
                        placeholder="Název sloupce v souboru..."
                        hide-details
                        autofocus
                        bg-color="white"
                        @keyup.enter="submitNewAlias(group.targetField)"
                        @keyup.escape="cancelAddAlias"
                      />
                   </div>
                   <v-btn
                      icon
                      variant="text"
                      size="x-small"
                      color="success"
                      :disabled="!newAliasInput.trim()"
                      @click="submitNewAlias(group.targetField)"
                    >
                      <v-icon size="20">mdi-check</v-icon>
                    </v-btn>
                </div>

              </div>
            </template>
          </div>

          <!-- prázdný stav / informace -->
          <div
             v-if="learnedMappings.length === 0"
             style="margin-top: 20px; text-align: center; padding: 40px; background: white; border: 1px solid #e5e7eb; border-radius: 12px;"
          >
             <v-icon icon="mdi-brain" size="48" color="grey-lighten-1" class="mb-3" />
             <div class="text-body-2 text-medium-emphasis">Žádná naučená mapování</div>
             <div class="text-caption text-medium-emphasis mt-2">Při importu se mapování uloží automaticky.</div>
          </div>

          <div v-else style="margin-top: 20px; padding: 16px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; display: flex; align-items: flex-start; gap: 12px;">
            <v-icon icon="mdi-information-outline" style="font-size: 20px; color: #3b82f6; margin-top: 2px;" />
            <div>
              <div style="font-size: 13px; font-weight: 600; color: #1e40af;">Jak to funguje?</div>
              <div style="font-size: 12px; color: #3b82f6; margin-top: 4px;">
                Při každém importu si systém zapamatuje, jak jste namapovali sloupce ze souboru na pole šablony.
                Příště se stejné sloupce namapují automaticky.
              </div>
            </div>
          </div>

        </div>

        <!-- potvrzovací dialog pro smazání mapování -->
        <v-dialog
          v-model="confirmDeleteMapping"
          width="400"
        >
          <v-card>
            <v-card-title>Smazat mapování?</v-card-title>
            <v-card-text>
              Opravdu chcete zapomenout mapování <strong>{{ mappingToDelete?.sourceColumnRaw }}</strong> → <strong>{{ mappingToDelete?.targetFieldName }}</strong>?
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn
                variant="text"
                @click="confirmDeleteMapping = false"
              >
                Zrušit
              </v-btn>
              <v-btn
                color="error"
                variant="flat"
                @click="confirmDeleteMappingAction"
              >
                Smazat
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- potvrzovací dialog pro vymazání všeho (clear all) -->
        <v-dialog
          v-model="confirmClearAll"
          width="400"
        >
          <v-card>
            <v-card-title>Vymazat všechna mapování?</v-card-title>
            <v-card-text>
              Opravdu chcete zapomenout všech <strong>{{ learnedMappings.length }}</strong> naučených mapování? Tato akce je nevratná.
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn
                variant="text"
                @click="confirmClearAll = false"
              >
                Zrušit
              </v-btn>
              <v-btn
                color="error"
                variant="flat"
                @click="confirmClearAllAction"
              >
                Vymazat vše
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- dialog pro přidání aliasu -->
        <v-dialog
          v-model="showAddMappingDialog"
          width="450"
        >
          <v-card>
            <v-card-title>Přidat alias pro {{ newMappingTarget }}</v-card-title>
            <v-card-text>
              <div class="text-caption text-medium-emphasis mb-3">
                Zadejte název sloupce ze souboru, který se má mapovat na pole "{{ newMappingTarget }}".
              </div>
              <v-text-field
                v-model="newMappingSource"
                label="Název sloupce v souboru"
                variant="outlined"
                density="compact"
                placeholder="např. Temperature (°C)"
                autofocus
              />
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn
                variant="text"
                @click="showAddMappingDialog = false"
              >
                Zrušit
              </v-btn>
              <v-btn
                color="primary"
                variant="flat"
                :disabled="!newMappingSource.trim()"
                @click="addMappingManually"
              >
                Přidat
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- dialog náhledu verze (pouze pro čtení – readonly) -->
        <v-dialog
          v-model="showVersionPreviewDialog"
          max-width="600px"
        >
          <v-card>
            <v-card-title class="d-flex align-center">
              <v-icon
                color="blue"
                class="mr-2"
              >
                mdi-eye
              </v-icon>
              Náhled verze {{ selectedVersionPreview?.version }}
            </v-card-title>
            <v-card-text>
              <div class="d-flex align-center mb-4">
                <v-chip
                  :color="selectedVersionPreview?.status === 'ACTIVE' ? 'success' : selectedVersionPreview?.status === 'DRAFT' ? 'warning' : 'grey'"
                  variant="flat"
                  class="mr-3"
                >
                  {{ selectedVersionPreview?.status === 'ACTIVE' ? 'Aktivní' : selectedVersionPreview?.status === 'DRAFT' ? 'Koncept' : 'Zastaralá' }}
                </v-chip>
                <span class="text-medium-emphasis">
                  {{ formatVersionDate(selectedVersionPreview?.updatedAt || '') }}
                </span>
              </div>
              <div
                v-if="selectedVersionPreview?.changeDescription"
                class="mb-4"
              >
                <div class="text-subtitle-2 mb-1">
                  Popis změny:
                </div>
                <div class="text-body-2 text-medium-emphasis">
                  {{ selectedVersionPreview.changeDescription }}
                </div>
              </div>
              <v-alert
                type="info"
                variant="tonal"
                density="compact"
              >
                Toto je pouze náhled. Pro úpravu vytvořte novou verzi.
              </v-alert>

              <!-- obsah náhledu (preview content) -->
              <div v-if="selectedVersionPreview?.blocks?.length" class="mt-4">
                <div v-for="block in selectedVersionPreview.blocks" :key="block.id" class="mb-4">
                  <div class="text-subtitle-1 font-weight-bold mb-2">{{ block.title || `Blok ${block.blockIndex}` }}</div>
                  <v-table density="compact" class="border rounded">
                    <tbody>
                      <tr v-for="field in block.fields" :key="field.id">
                        <td style="width: 40px" class="text-medium-emphasis">{{ field.orderIndex }}.</td>
                        <td>{{ field.name }}</td>
                        <td class="text-right text-caption text-medium-emphasis">{{ field.type }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </div>
              </div>
              <div v-else class="text-center text-medium-emphasis pa-4">
                Žádná data k zobrazení
              </div>

              <!-- obsah náhledu (preview content) -->
              <div v-if="selectedVersionPreview?.blocks?.length" class="mt-4">
                <div v-for="block in selectedVersionPreview.blocks" :key="block.id" class="mb-4">
                  <div class="text-subtitle-1 font-weight-bold mb-2">{{ block.title || `Blok ${block.blockIndex}` }}</div>
                  <v-table density="compact" class="border rounded">
                    <tbody>
                      <tr v-for="field in block.fields" :key="field.id">
                        <td style="width: 40px" class="text-medium-emphasis">{{ field.orderIndex }}.</td>
                        <td>{{ field.name }}</td>
                        <td class="text-right text-caption text-medium-emphasis">{{ field.type }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </div>
              </div>
              <div v-else class="text-center text-medium-emphasis pa-4">
                Žádná data k zobrazení
              </div>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn
                variant="text"
                @click="showVersionPreviewDialog = false"
              >
                Zavřít
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- dialog pro návrat k verzi (rollback) -->
        <v-dialog v-model="showRollbackDialog" max-width="450px">
          <v-card>
            <v-card-title>Nastavit jako aktivní?</v-card-title>
            <v-card-text>
              Tato akce archivuje současnou aktivní verzi a vytvoří novou aktivní verzi založenou na této historické verzi.
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showRollbackDialog = false">Zrušit</v-btn>
              <v-btn color="primary" variant="flat" :loading="loading" @click="confirmRollback">
                Nastavit jako aktivní
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- dialog pro hromadné smazání (bulk delete) -->
        <v-dialog v-model="showBulkDeleteDialog" max-width="450px">
          <v-card>
            <v-card-title class="text-error">Smazat vybrané verze?</v-card-title>
            <v-card-text>
              Chystáte se smazat <strong>{{ selectedVersionIds.size }}</strong> verzí šablony.
              <div class="mt-2 text-caption">Tato akce je nevratná.</div>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showBulkDeleteDialog = false">Zrušit</v-btn>
              <v-btn color="error" variant="flat" :loading="bulkDeleteLoading" @click="confirmBulkDelete">
                Smazat navždy
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- dialog pro uložení verze (save version) -->
        <v-dialog v-model="showSaveVersionDialog" max-width="550px">
          <v-card>
            <v-card-title>
              Uložit změny
            </v-card-title>
            <v-card-text>
              <div class="mb-4 d-flex align-center">
                <span class="text-body-1">Bude vytvořena nová verze:</span>
                <v-chip size="small" class="ml-3 mr-2" color="grey">v{{ currentVersionLabel }}</v-chip>
                <v-icon size="small" class="mr-2">mdi-arrow-right</v-icon>
                <v-chip size="small" color="primary">v{{ nextVersionLabel }}</v-chip>
              </div>

              <div class="mb-2 text-subtitle-2">Co jste změnili? (volitelné)</div>
              <v-textarea
                v-model="changeDescription"
                variant="outlined"
                rows="3"
                auto-grow
                placeholder="Např. přidáno pole pro teplotu vzorku..."
                hide-details
              />
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn
                variant="text"
                @click="showSaveVersionDialog = false"
              >
                Zrušit
              </v-btn>
              <v-btn
                color="primary"
                variant="flat"
                :loading="loading"
                @click="submitNewVersion"
              >
                Uložit jako v{{ nextVersionLabel }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- patička (footer) -->
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn
            v-if="canDelete"
            color="error"
            variant="flat"
            :loading="deleteLoading"
            @click="askDelete"
          >
            Smazat šablonu
          </v-btn>
<!--          <v-btn
            v-if="canDelete"
            variant="tonal"
            prepend-icon="mdi-content-copy"
            @click="deriveFromThis"
          >
            Odvodit novou šablonu
          </v-btn>-->
          <v-spacer />
          <v-btn
            variant="text"
            @click="cancel"
          >
            Zrušit (Esc)
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!deviceCode || (!pickedBlocks.length && !seriesFieldRows.length) || (!hasAnyFields && !seriesFieldRows.length)"
            :loading="loading"
            @click="confirmSave"
          >
            {{ confirmLabel }}
          </v-btn>
        </div>
      </div>
    </template>
  </Dialog>

  <!-- dialog pro manuální výběr hlavičky (manual header picker) -->
  <ManualHeaderPickerDialog
    v-model="showManualHeaderPicker"
    :raw-grid="rawDataRows"
    @apply="onManualHeadersApply"
  />
</template>
<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Dialog from '@/components/Dialog.vue'
import type { WizardTemplatePayload } from '@/stores/measurement-templates'
import { useMeasurementTemplatesStore } from '@/stores/measurement-templates'
import { useImportStore, type LearnedMapping } from '@/stores/import'
import { isEditableElement } from '@/components/ui/hotkeyGuard'
import ImportFormatDialog from './ImportFormatDialog.vue'
import RawDataPreview from './RawDataPreview.vue'
import BlockSelector from './BlockSelector.vue'
import ManualHeaderPickerDialog from './ManualHeaderPickerDialog.vue'
import { parseWithOptions, inferColumnTypes, generateColumnNames, type ParseOptions, type ParseResult, type ParseStatus, DEFAULT_PARSE_OPTIONS } from '@/utils/import/clientParser'
import { isVectorCell, detectVectorColumns, findPairedVectors, hasVectorCells as checkVectorCells } from '@/utils/import/vectorDetection'
import { buildProposal } from '@/utils/import/blockDetection'
import type { DetectedBlock, BlockAction, ParseProposal } from '@/types/import-blocks'
import * as XLSX from 'xlsx'
// třívrstvá architektura (3-layer architecture): surová data → návrhy parsování → šablona (autorita uživatele)
/* typy (types) */
type DeviceItem = { id: string; name: string; color?: string }
type FieldType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
type FieldRow = { id: string; orderIndex: number; type: FieldType; required: boolean; name: string }
interface PickedBlock {
  id: string
  title: string
  fieldRows: FieldRow[]
}
interface InitialTemplate {
  templateId: string
  name: string
  deviceCode: string
  fields: Array<{ orderIndex: number; type: FieldType; required: boolean; name: string }>
  blocks?: Array<{
    blockIndex: number
    title: string
    fields: Array<{ orderIndex: number; type: FieldType; required: boolean; name: string }>
  }>
  version?: string
  updatedAt?: string
}
/* vlastnosti a události (props a emits) */
const props = defineProps<{
  modelValue: boolean
  devices: DeviceItem[]
  onConfirm?: (payload: WizardTemplatePayload) => Promise<void> | void
  deleteLoading?: boolean
  operation?: 'create' | 'edit'
  initialTemplate?: InitialTemplate | null
  startMode?: 'empty' | 'import'
  /** šablona pro odvození: předvyplní formulář, ale vytvoří novou šablonu (derive from) */
  deriveFrom?: InitialTemplate | null
  /** uzamčení výběru zařízení (lock device): uživatel jej nemůže změnit */
  lockDevice?: boolean
  /** předvýběr zařízení při otevření průvodce (pre-select device) */
  preselectedDevice?: string | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', p: WizardTemplatePayload): void
  (e: 'delete'): void
  (e: 'deriveFromTemplate', templateId: string): void
}>()

/* logika pro naučená mapování (learned mappings) */
const importStore = useImportStore()
const templatesStore = useMeasurementTemplatesStore()
const learnedMappings = ref<LearnedMapping[]>([])

// hlavní navigace v záložkách (main tab navigation): 'structure' | 'versions' | 'mappings'
const mainTab = ref<'structure' | 'versions' | 'mappings'>('structure')

/* logika pro historii verzí (version history logic) */
type VersionHistoryItem = {
  id: string
  version: string
  status: 'DRAFT' | 'ACTIVE' | 'DEPRECATED'
  updatedAt: string
  changeDescription?: string
  blocks?: any[]
  fields?: any[]
}
const versionHistory = ref<VersionHistoryItem[]>([])
const versionHistoryLoading = ref(false)
const versionHistoryLoaded = ref(false)
const selectedVersionPreview = ref<VersionHistoryItem | null>(null)
const showVersionPreviewDialog = ref(false)
const showRollbackDialog = ref(false)
const rollbackTarget = ref<VersionHistoryItem | null>(null)

// stav hromadného mazání (bulk delete state)
const selectedVersionIds = ref<Set<string>>(new Set())
const showBulkDeleteDialog = ref(false)
const bulkDeleteLoading = ref(false)

async function loadVersionHistory() {
  // If we already loaded history and dialog is still open, we might want to refresh only if forced
  // But simpler is: check if loaded
  if (versionHistoryLoaded.value || versionHistoryLoading.value) return
  if (!props.initialTemplate?.templateId) return

  versionHistoryLoading.value = true
  try {
    const templateIdStr = props.initialTemplate.templateId
    const templateId = Number(templateIdStr)

    if (isNaN(templateId)) {
      // Fallback for non-numeric IDs if any
      throw new Error('Invalid template ID')
    }

    const rawVersions = await templateStore.fetchVersions(templateId)

    // Sort by createdAt/updatedAt descending (newest first)
    // Assuming the API returns mixed order
    rawVersions.sort((a, b) => {
      const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return tB - tA
    })

    versionHistory.value = rawVersions.map((v: any) => ({
      id: String(v.id),
      version: v.version || '1.0',
      status: v.status || 'ACTIVE',
      updatedAt: v.updatedAt || '',
      changeDescription: v.changeDescription,
      blocks: v.blocks,
      fields: v.fields
    }))

  } catch (e) {
    console.warn('Failed to load version history (backend endpoint missing?), using mock data', e)

    // Fallback: Generate mock history based on current version
    const currentV = props.initialTemplate.version || '1.0'
    const now = props.initialTemplate.updatedAt || new Date().toISOString()

    const mockHistory: VersionHistoryItem[] = [
      {
        id: props.initialTemplate.templateId,
        version: currentV,
        status: 'ACTIVE',
        updatedAt: now,
        changeDescription: 'Aktuální verze (Mock data - backend neodpovídá)'
      }
    ]

    // If version is > 1.0, add some fake history
    if (currentV !== '1.0') {
      const prevDate = new Date(new Date(now).getTime() - 86400000).toISOString() // 1 day ago
      mockHistory.push({
        id: 'mock-prev-id',
        version: '1.0',
        status: 'DEPRECATED',
        updatedAt: prevDate,
        changeDescription: 'Původní verze (ukázka historie)'
      })
    }

    versionHistory.value = mockHistory
  } finally {
    versionHistoryLoading.value = false
  }
}

// resetování historie při otevření dialogu
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    versionHistoryLoaded.value = false
    versionHistory.value = []
    mainTab.value = 'structure' // Reset tab to structure
  }
})

function formatVersionDate(isoString: string): string {
  if (!isoString) return '—'
  const d = new Date(isoString)
  return d.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function openVersionPreview(version: VersionHistoryItem) {
  selectedVersionPreview.value = version
  showVersionPreviewDialog.value = true
}

function openRollbackDialog(version: VersionHistoryItem) {
  rollbackTarget.value = version
  showRollbackDialog.value = true
}

async function confirmRollback() {
  if (!rollbackTarget.value) return

  try {
    loading.value = true // použít hlavní indikátor načítání (main loading indicator)
    await templatesStore.publish(Number(rollbackTarget.value.id))

    // Refresh history
    versionHistoryLoaded.value = false
    await loadVersionHistory()

    // Also need to refresh main list in parent?
    // Usually dialog is still open.
    // Maybe we should emit an event? or just show success.

    showRollbackDialog.value = false
    rollbackTarget.value = null
  } catch(e) {
    console.error('Rollback failed', e)
    // Could add error snackbar here
  } finally {
    loading.value = false
  }
}

// pomocné funkce pro hromadné mazání (bulk delete helpers)
const selectableVersions = computed(() =>
  versionHistory.value.filter(v => v.status !== 'ACTIVE')
)

const allSelectableSelected = computed(() =>
  selectableVersions.value.length > 0 &&
  selectableVersions.value.every(v => selectedVersionIds.value.has(v.id))
)

const someSelected = computed(() =>
  selectableVersions.value.some(v => selectedVersionIds.value.has(v.id))
)

function toggleVersionSelection(id: string) {
  const newSet = new Set(selectedVersionIds.value)
  if (newSet.has(id)) {
    newSet.delete(id)
  } else {
    newSet.add(id)
  }
  selectedVersionIds.value = newSet
}

function toggleSelectAll() {
  if (allSelectableSelected.value) {
    // Deselect all
    selectedVersionIds.value = new Set()
  } else {
    // Select all non-active
    selectedVersionIds.value = new Set(selectableVersions.value.map(v => v.id))
  }
}

async function confirmBulkDelete() {
  if (selectedVersionIds.value.size === 0) return

  bulkDeleteLoading.value = true
  try {
    const idsToDelete = Array.from(selectedVersionIds.value).map(Number)
    await templatesStore.deleteAll(idsToDelete)

    // Clear selection and refresh
    selectedVersionIds.value = new Set()
    versionHistoryLoaded.value = false
    await loadVersionHistory()
    showBulkDeleteDialog.value = false
  } catch (e) {
    console.error('Bulk delete failed', e)
  } finally {
    bulkDeleteLoading.value = false
  }
}

async function loadLearnedMappings() {
  console.log('[loadLearnedMappings] START.Operation:', props.operation)
  console.log('[loadLearnedMappings] Initial template:', JSON.stringify(props.initialTemplate))

  if (props.operation === 'edit' && props.initialTemplate?.templateId) {
    try {
      console.log('[loadLearnedMappings] Loading for template:', props.initialTemplate.templateId)
      learnedMappings.value = await importStore.fetchLearnedMappings(Number(props.initialTemplate.templateId))
      console.log('[loadLearnedMappings] Loaded:', learnedMappings.value.length)
    } catch (e) {
      console.error('Failed to load learned mappings', e)
    }
  } else {
    console.log('[loadLearnedMappings] Skipping load (op/id mismatch)', props.operation, props.initialTemplate?.templateId)
    learnedMappings.value = []
  }
}

async function removeLearnedMapping(id: number) {
  try {
    await importStore.deleteLearnedMapping(id)
    learnedMappings.value = learnedMappings.value.filter(m => m.id !== id)
  } catch (e) {
    console.error('Failed to delete mapping', e)
  }
}

// Clear all mappings for this template
async function clearAllMappings() {
  for (const m of learnedMappings.value) {
    try {
      await importStore.deleteLearnedMapping(m.id)
    } catch (e) {
      console.error('Failed to delete mapping', m.id, e)
    }
  }
  learnedMappings.value = []
}

// Group mappings by target field
type MappingGroup = {
  targetField: string
  mappings: LearnedMapping[]
  totalUses: number
}
const groupedMappings = computed<MappingGroup[]>(() => {
  const groups = new Map<string, LearnedMapping[]>()
  for (const m of learnedMappings.value) {
    const key = m.targetFieldName
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }
  return Array.from(groups.entries()).map(([targetField, mappings]) => ({
    targetField,
    mappings,
    totalUses: mappings.reduce((sum, m) => sum + m.useCount, 0)
  }))
})

// Stats
const totalUsageCount = computed(() =>
  learnedMappings.value.reduce((sum, m) => sum + m.useCount, 0)
)

// informace o verzi pro režim úprav (version info for edit mode)
const versionInfoText = computed(() => {
  if (props.operation !== 'edit' || !props.initialTemplate) return null

  const version = props.initialTemplate.version || '1.0'
  const updatedAt = props.initialTemplate.updatedAt

  let dateStr = ''
  if (updatedAt) {
    const d = new Date(updatedAt)
    dateStr = d.toLocaleDateString('cs-CZ', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return {
    version: `v${version}`,
    date: dateStr || 'neznámé datum'
  }
})

// barvy pro ikony skupin (group colors)
const groupColors = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16']
function getGroupColor(index: number): string {
  return groupColors[index % groupColors.length]
}

// sledování rozbalených skupin (ponecháno pro kompatibilitu, momentálně nepoužito) (track expanded groups)
const expandedGroups = ref<Set<string>>(new Set())
function toggleGroup(targetField: string): void {
  if (expandedGroups.value.has(targetField)) {
    expandedGroups.value.delete(targetField)
  } else {
    expandedGroups.value.add(targetField)
  }
}

// potvrzení smazání (delete confirmation)
const confirmDeleteMapping = ref(false)
const mappingToDelete = ref<LearnedMapping | null>(null)
const confirmClearAll = ref(false)

function askDeleteMapping(mapping: LearnedMapping): void {
  mappingToDelete.value = mapping
  confirmDeleteMapping.value = true
}

async function confirmDeleteMappingAction(): Promise<void> {
  if (mappingToDelete.value) {
    await removeLearnedMapping(mappingToDelete.value.id)
  }
  confirmDeleteMapping.value = false
  mappingToDelete.value = null
}

async function confirmClearAllAction(): Promise<void> {
  await clearAllMappings()
  confirmClearAll.value = false
}

// vkládání aliasu do řádku (inline add alias)
const addingAliasFor = ref<string | null>(null)
const newAliasInput = ref('')

function toggleAddAliasRow(targetField: string): void {
  if (addingAliasFor.value === targetField) {
    cancelAddAlias()
  } else {
    addingAliasFor.value = targetField
    newAliasInput.value = ''
  }
}

function cancelAddAlias(): void {
  addingAliasFor.value = null
  newAliasInput.value = ''
}

async function submitNewAlias(targetField: string): Promise<void> {
  if (!newAliasInput.value.trim() || !props.initialTemplate?.templateId) return
  try {
    const mapping: Record<string, string> = {
      [newAliasInput.value.trim()]: targetField
    }
    await importStore.saveMappings(
      Number(props.initialTemplate.templateId),
      mapping
    )
    await loadLearnedMappings()
    cancelAddAlias()
  } catch (e) {
    console.error('Failed to add alias', e)
  }
}

// zastaralé (pro kompatibilitu) (legacy)
const showAddMappingDialog = ref(false)
const newMappingSource = ref('')
const newMappingTarget = ref<string | null>(null)

// získání dostupných cílových polí z polí šablony (available target fields)
const availableTargetFields = computed(() => {
  const fields: string[] = []
  for (const block of pickedBlocks.value) {
    for (const f of block.fieldRows) {
      if (f.name) fields.push(f.name)
    }
  }
  for (const f of seriesFieldRows.value) {
    if (f.name) fields.push(f.name)
  }
  return fields
})

async function addMappingManually(): Promise<void> {
  if (!newMappingSource.value.trim() || !newMappingTarget.value || !props.initialTemplate?.templateId) return
  try {
    // savemappings očekává objekt record s dvojicemi (sourcecolumn, targetfield)
    const mapping: Record<string, string> = {
      [newMappingSource.value.trim()]: newMappingTarget.value
    }
    await importStore.saveMappings(
      Number(props.initialTemplate.templateId),
      mapping
    )
    // Reload mappings
    await loadLearnedMappings()
    showAddMappingDialog.value = false
    newMappingSource.value = ''
    newMappingTarget.value = null
  } catch (e) {
    console.error('Failed to add mapping', e)
  }
}

// načtení mapování při připojení komponenty (mount), pokud je dialog otevřený (pro přímé otevření nebo obnovení)
onMounted(() => {
  if (props.modelValue && props.operation === 'edit') {
    console.log('[TemplateWizardDialog] Mounted open in edit mode, loading mappings...')
    loadLearnedMappings()
  }
})

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    console.log('[TemplateWizardDialog] Opened, operation:', props.operation)
    console.log('[TemplateWizardDialog] preselectedDevice:', props.preselectedDevice)
    console.log('[TemplateWizardDialog] initialTemplate:', props.initialTemplate)
    console.log('[TemplateWizardDialog] devices:', props.devices)
    loadLearnedMappings()
    // předvýběr zařízení, pokud bylo zadáno a neexistuje úvodní šablona
    if (props.preselectedDevice && !props.initialTemplate) {
      console.log('[TemplateWizardDialog] Setting deviceCode to:', props.preselectedDevice)
      // použít nexttick k zajištění nastavení hodnoty po vykreslení komponenty
      nextTick(() => {
        deviceCode.value = props.preselectedDevice
        console.log('[TemplateWizardDialog] deviceCode after set:', deviceCode.value)
      })
    }
    // zaměření vstupu pro název šablony s animací posunu
    nextTick(() => {
      setTimeout(() => {
        const input = document.querySelector('[data-template-name-input] input') as HTMLInputElement | null
        if (input) {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' })
          input.focus()
          // přidání třídy pro animaci zaměření (focus animation class)
          input.classList.add('focus-highlight-animation')
          setTimeout(() => input.classList.remove('focus-highlight-animation'), 600)
        }
      }, 100)
    })
  }
})

/* výpočtová vlastnost (computed) v-model */
const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

// smazání je možné pouze v režimu úprav s platným id šablony

// zrušení úprav (zavření dialogu) (cancel editing)
function cancel(): void {
  open.value = false
}

// požadavek na smazání šablony (request template deletion)
function askDelete(): void {
  emit('delete')
}
/* stav (state) */
const templateStore = useMeasurementTemplatesStore()
const deviceCode = ref<string | null>(null)
const templateName = ref<string>('')

/**
 * Generate a derived template name with timestamp suffix.
 * Example: "DLS Měření" → "DLS Měření_2025-12-13_23-50"
 */
function generateDerivedName(sourceName: string): string {
  const now = new Date()
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const year = now.getFullYear()
  const dateStr = `${day}-${month}-${year}` // DD-MM-YYYY (Czech format)
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '-') // HH-MM
  return `${sourceName}_${dateStr}_${timeStr}`
}

/**
 * Derive a new template from the current one.
 * Emits event to parent which will handle the actual derivation logic.
 */
function deriveFromThis(): void {
  const templateId = props.initialTemplate?.templateId
  if (templateId) {
    emit('deriveFromTemplate', templateId)
  }
}

// Validation state
const formTouched = ref(false)

// Check for duplicate template name within same device
const isDuplicateName = computed(() => {
  if (!templateName.value.trim() || !deviceCode.value) return false
  const normalizedName = templateName.value.trim().toLowerCase()

  // ID aktuálně editované šablony (při UPDATE)
  const currentTemplateId = props.operation === 'edit' && props.initialTemplate
    ? String(props.initialTemplate.templateId)
    : null

  return templateStore.items.some(t =>
    t.deviceCode.toLowerCase() === deviceCode.value!.toLowerCase() &&
    t.name.toLowerCase() === normalizedName &&
    String(t.id) !== currentTemplateId  // Vyloučit sebe sama
  )
})

const nameError = computed(() => {
  if (!formTouched.value) return null
  if (!templateName.value.trim()) return 'Název šablony je povinný'

  // Při editaci - pokud je název stejný jako originál, není to duplicita
  if (props.operation === 'edit' && props.initialTemplate) {
    const originalName = props.initialTemplate.name.trim().toLowerCase()
    const currentName = templateName.value.trim().toLowerCase()
    if (originalName === currentName) {
      return null
    }
  }

  if (isDuplicateName.value) return 'Šablona s tímto názvem již existuje pro tento přístroj'
  return null
})

const deviceError = computed(() => {
  if (!formTouched.value) return null
  if (!deviceCode.value) return 'Vyber přístroj'
  return null
})

const loading = ref(false)
// New dropzone state (replaces mode toggle)
const isDragging = ref(false)
const showTextareaInput = ref(false)
const pickedBlocks = ref<PickedBlock[]>([])
const currentBlockIndex = ref(0)
/* Import parsing state */
const rawText = ref('')
const delimiter = ref<string>('auto')
const fileInput = ref<HTMLInputElement | null>(null)
/* NEW: Parse status and options */
const parseStatus = ref<ParseStatus>('FAIL')
const parseReasons = ref<string[]>([])
const parseOptions = ref<ParseOptions>({ ...DEFAULT_PARSE_OPTIONS })
const showFormatDialog = ref(false)
const showManualHeaderPicker = ref(false)
const rawDataRows = ref<string[][]>([])
const hasUserEditedFields = ref(false)
/* Parsed structures */
const mainHeader = ref<string[]>([])      // Block 1 headers (including Sizes, Intensities, Volumes, Numbers)
const statsLines = ref<string[]>([])      // Ignored statistics lines (Mean, Std Dev, RSD %)
const seriesHeader = ref<string[]>([])    // Block 2 (X Intensity + Intensity)
const seriesDataLines = ref<string[][]>([]) // Parsed X,Y pairs from X Intensity section

/* NEW: Computed for vector detection */
const hasVectorCells = computed(() => checkVectorCells(rawDataRows.value))

/* NEW: State for Import Box UI */
const showPreview = ref(true)
const highlightedColumn = ref<number | null>(null)

/* NEW: Manual row designation state */
const headerRowIdx = ref<number | null>(null)      // Which row is the header (null = auto-detect)
const unitsRowIdx = ref<number | null>(null)       // Which row has units (null = auto-detect)
const dataStartRowIdx = ref<number | null>(null)   // Where data starts (null = auto-detect from header+1)
const rowDesignationMode = ref<'header' | 'units' | 'data' | null>(null) // Current selection mode

/* NEW: Field selection for moving to series */
const selectedFieldIndices = ref<Set<number>>(new Set())
const lastSelectedFieldIdx = ref<number | null>(null) // For shift-click range select

/* NEW: Parse status computed properties */
const parseStatusIcon = computed(() => {
  switch (parseStatus.value) {
    case 'SUCCESS': return 'mdi-check-circle'
    case 'PARTIAL': return 'mdi-alert-circle'
    case 'FAIL': return 'mdi-close-circle'
  }
})

const parseStatusColor = computed(() => {
  switch (parseStatus.value) {
    case 'SUCCESS': return 'success'
    case 'PARTIAL': return 'warning'
    case 'FAIL': return 'error'
  }
})

const parseStatusClass = computed(() => {
  return `status-${parseStatus.value.toLowerCase()}`
})

const parseStatusTitle = computed(() => {
  switch (parseStatus.value) {
    case 'SUCCESS': return `Automaticky navržená struktura (${mainHeader.value.length} polí)`
    case 'PARTIAL': return `Částečně rozpoznáno (${mainHeader.value.length} polí) – doporučena kontrola`
    case 'FAIL': return 'Strukturu se nepodařilo automaticky vytvořit'
  }
})

const parseStatusSubtitle = computed(() => {
  if (parseStatus.value === 'SUCCESS') {
    return 'Toto je návrh – můžete ho kdykoliv upravit pomocí tlačítek níže.'
  }
  if (parseStatus.value === 'PARTIAL') {
    return parseReasons.value.join(', ') || 'Zkontrolujte a upravte strukturu'
  }
  return 'Zvolte způsob importu pomocí tlačítek níže.'
})

const usedDelimiterLabel = computed(() => {
  const d = parseOptions.value.delimiter
  switch (d) {
    case '\t': return 'TAB'
    case ';': return 'Středník'
    case ',': return 'Čárka'
    case '|': return 'Pipe'
    case 'auto': return 'AUTO'
    default: return d
  }
})

const usedHeaderLabel = computed(() => {
  const h = parseOptions.value.header
  if (h === 'no_header') return 'Bez hlavičky'
  if (h === 'auto') return 'Automaticky'
  if (typeof h === 'number') return `Řádek ${h + 1}`
  return 'Automaticky'
})

/* NEW: 3-Layer Architecture State */
const activeTab = ref<'blocks' | 'raw' | 'preview'>('preview')
const selectedBlockId = ref<string | null>(null)
const includedBlockIds = ref<string[]>([]) // Blocks that are included (checked)
const proposal = ref<ParseProposal>({
  blocks: [],
  suggestedMainBlock: null,
  rawKind: 'text',
  rawLines: []
})

/* Block selection handlers */
function onBlockSelect(blockId: string): void {
  selectedBlockId.value = selectedBlockId.value === blockId ? null : blockId
}

function onToggleInclude(blockId: string, included: boolean): void {
  if (included) {
    if (!includedBlockIds.value.includes(blockId)) {
      includedBlockIds.value = [...includedBlockIds.value, blockId]
    }
  } else {
    includedBlockIds.value = includedBlockIds.value.filter(id => id !== blockId)
  }
  console.log('[onToggleInclude] Block', blockId, 'included:', included, 'All included:', includedBlockIds.value)
}

function onBlockAction(blockId: string, action: BlockAction): void {
  const block = proposal.value.blocks.find(b => b.id === blockId)
  if (!block) return

  block.action = action
  console.log('[onBlockAction] Block', blockId, 'action:', action)
}

function onRawRowClick(row: number): void {
  // Find block containing this row
  const block = proposal.value.blocks.find(b => row >= b.startRow && row <= b.endRow)
  if (block) {
    selectedBlockId.value = block.id
    activeTab.value = 'blocks'
  }
}

/**
 * Change block type between 'table' and 'series'
 */
function onBlockTypeChange(blockId: string, newType: 'table' | 'series'): void {
  const block = proposal.value.blocks.find(b => b.id === blockId)
  if (!block) return

  block.type = newType
  console.log('[onBlockTypeChange] Block', blockId, 'type changed to:', newType)
}

/**
 * Update block description/name
 */
function onBlockDescriptionChange(blockId: string, description: string): void {
  const block = proposal.value.blocks.find(b => b.id === blockId)
  if (!block) return

  block.description = description
}

/**
 * Confirm selected blocks and add them to template structure
 */
function onConfirmBlocks(): void {
  const includedBlocks = proposal.value.blocks.filter(b => includedBlockIds.value.includes(b.id))

  if (includedBlocks.length === 0) {
    console.warn('[onConfirmBlocks] No blocks selected')
    return
  }

  console.log('[onConfirmBlocks] Processing blocks:', includedBlocks.map(b => ({ id: b.id, type: b.type, description: b.description })))

  // Process each included block based on its type
  for (const block of includedBlocks) {
    console.log('[onConfirmBlocks] Block:', block.id, 'type:', block.type, 'isSeries:', block.type === 'series')
    if (block.type === 'series') {
      // Add as series block
      console.log('[onConfirmBlocks] Adding as SERIES block')
      addSeriesBlockFromProposal(block)
    } else {
      // Add as table block (table, kv, stats, unknown)
      console.log('[onConfirmBlocks] Adding as TABLE block')
      addTableBlockFromProposal(block)
    }
  }

  // Clear selection after applying
  includedBlockIds.value = []
  console.log('[onConfirmBlocks] Applied', includedBlocks.length, 'blocks')
}


/**
 * Add a series block from proposal to template structure
 */
function addSeriesBlockFromProposal(block: DetectedBlock): void {
  const newBlock: PickedBlock = {
    id: 'series-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: block.description || 'Datová série',
    kind: 'series',
    fieldRows: (block.headers || []).map((name, idx) => ({
      id: 's-' + Date.now() + '-' + idx,
      orderIndex: idx + 1,
      name,
      type: 'float' as const,
      required: false
    }))
  }
  pickedBlocks.value.push(newBlock)
  currentBlockIndex.value = pickedBlocks.value.length - 1
  hasUserEditedFields.value = true
}

/**
 * Add a table block from proposal to template structure
 */
function addTableBlockFromProposal(block: DetectedBlock): void {
  const newBlock: PickedBlock = {
    id: 'table-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: block.description || 'Tabulka hodnot ' + (pickedBlocks.value.filter(b => b.kind !== 'series').length + 1),
    kind: 'table',
    fieldRows: (block.headers || []).map((name, idx) => ({
      id: 't-' + Date.now() + '-' + idx,
      orderIndex: idx + 1,
      name,
      type: inferFieldType(name) as 'float' | 'int' | 'text' | 'file' | 'bool' | 'date',
      required: false
    }))
  }
  pickedBlocks.value.push(newBlock)
  currentBlockIndex.value = pickedBlocks.value.length - 1
  hasUserEditedFields.value = true
}


function applyProposal(): void {
  // Apply all included blocks as template fields
  const includedBlocks = proposal.value.blocks.filter(b => includedBlockIds.value.includes(b.id))

  if (includedBlocks.length === 0) {
    // Nothing selected - use suggested main block
    if (proposal.value.suggestedMainBlock) {
      includedBlockIds.value = [proposal.value.suggestedMainBlock]
      const mainBlock = proposal.value.blocks.find(b => b.id === proposal.value.suggestedMainBlock)
      if (mainBlock) {
        // Check if it's a horizontal series block
        if (mainBlock.horizontalSeries) {
          applyHorizontalSeriesBlock(mainBlock)
        } else if (mainBlock.headers) {
          mainHeader.value = mainBlock.headers
          rawDataRows.value = mainBlock.sampleRows || []
          createBlocksFromParsed()
        }
        parseStatus.value = 'SUCCESS'
      }
    }
    return
  }

  // Process each included block
  for (const block of includedBlocks) {
    if (block.type === 'table' || block.type === 'unknown') {
      // Use as main data table
      if (block.headers) {
        mainHeader.value = block.headers
        rawDataRows.value = block.sampleRows || []
      }
    } else if (block.type === 'series') {
      // Check for horizontal series (transposed data like wavelength)
      if (block.horizontalSeries) {
        console.log('[applyProposal] Processing horizontal series block:', block)
        applyHorizontalSeriesBlock(block)
        return // Horizontal series is handled separately
      }
      // Regular series will be handled by addSeriesBlockEmpty or existing series logic
      console.log('[applyProposal] Adding regular series block:', block)
    }
  }

  createBlocksFromParsed()
  parseStatus.value = 'SUCCESS'
}

/**
 * Apply a horizontal series block - creates template structure from transposed data.
 * Each group (K2, KR SLN, SLN, etc.) becomes a series with its rows as Y values.
 * Generic: works with any number of groups and any number of rows per group.
 */
function applyHorizontalSeriesBlock(block: DetectedBlock): void {
  const hs = block.horizontalSeries
  if (!hs) return

  console.log('[applyHorizontalSeriesBlock] Processing:', hs)

  // Create fields for each group
  // Each group represents a measurement type (K2, KR SLN, SLN, etc.)
  const seriesFields: FieldRow[] = []

  for (const group of hs.groups) {
    // Each group can have multiple rows - create field for each row
    // Naming: "GroupLabel" for single row, "GroupLabel 1", "GroupLabel 2" for multiple
    for (let rowIdx = 0; rowIdx < group.rowCount; rowIdx++) {
      const fieldName = group.rowCount === 1
        ? (group.label || `Série ${seriesFields.length + 1}`)
        : `${group.label || 'Série'} ${rowIdx + 1}`

      seriesFields.push({
        id: generateFieldId(),
        orderIndex: seriesFields.length + 1,
        name: normalizeHeader(fieldName),
        required: true,
        type: 'float' as FieldType
      })
    }
  }

  // Set up series field rows
  seriesFieldRows.value = seriesFields
  seriesBlockTitle.value = hs.xAxisLabel
    ? `Série - ${hs.xAxisLabel}`
    : 'Datová série'

  // Create a X-axis field in series header
  seriesHeader.value = [hs.xAxisLabel || 'X', ...hs.groups.map(g => g.label)]

  // Also store X values for reference (wavelength values)
  // These will be used when importing actual measurement data
  console.log('[applyHorizontalSeriesBlock] X values:', hs.xValues)
  console.log('[applyHorizontalSeriesBlock] Created series fields:', seriesFields)

  // Create empty table block (horizontal series doesn't have traditional table fields)
  pickedBlocks.value = [{
    id: generateId(),
    title: 'Metadata',
    fieldRows: [] // Empty - user can add if needed
  }]

  currentBlockIndex.value = 0
  parseStatus.value = 'SUCCESS'
  parseReasons.value = []
}



/* NEW: Helper functions for preview */
function truncateCell(value: string, maxLen = 25): string {
  if (!value) return ''
  if (value.length <= maxLen) return value
  return value.slice(0, maxLen - 2) + '…'
}

function onPreviewColumnClick(idx: number): void {
  highlightedColumn.value = highlightedColumn.value === idx ? null : idx
  // Scroll to corresponding field in template
  if (highlightedColumn.value !== null) {
    focusFieldByIndex(idx, true)
  }
}

/* Focus helpers - scroll to field with flash animation */
function focusFieldByIndex(idx: number, flashAnimation = false): void {
  nextTick(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-field-input]')
    const el = els[idx]
    if (!el) return

    // Scroll into view first
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Focus after scroll
    setTimeout(() => {
      el.focus()

      // Add flash animation if requested
      if (flashAnimation) {
        const row = el.closest('.field-row') as HTMLElement | null
        if (row) {
          row.classList.add('field-highlight-flash')
          setTimeout(() => row.classList.remove('field-highlight-flash'), 2000)
        }
      }
    }, 300)
  })
}

function focusFirstInvalidField(): void {
  nextTick(() => {
    // Find first empty required field
    const currentBlock = pickedBlocks.value[currentBlockIndex.value]
    if (!currentBlock) return

    const firstEmpty = currentBlock.fieldRows.findIndex(f => f.required && !f.name.trim())
    if (firstEmpty >= 0) {
      focusFieldByIndex(firstEmpty, true)
    }
  })
}

function clearImport(): void {
  rawText.value = ''
  showTextareaInput.value = false
  resetParseState()
  highlightedColumn.value = null
  // Also clear template structure
  pickedBlocks.value = []
  currentBlockIndex.value = 0
  seriesFieldRows.value = []
  selectedSeriesRows.value = new Set()
  lastSelectedSeriesIdx.value = null
  seriesBlockTitle.value = 'Datová série'
  hasUserEditedFields.value = false
  // Reset proposal state
  proposal.value = { rawLines: [], rawGrid: [], blocks: [] }
  includedBlockIds.value = []
  selectedBlockId.value = null
}

/* Series Fields - editable rows for series block in template */
const seriesFieldRows = ref<FieldRow[]>([])
const selectedSeriesRows = ref<Set<number>>(new Set()) // For shift+click selection
const lastSelectedSeriesIdx = ref<number | null>(null)
const seriesBlockTitle = ref('Datová série')

/* Computed: convert parsed series to preview format */
const parsedSeriesPreview = computed(() => {
  if (!seriesHeader.value.length || !seriesDataLines.value.length) return []
  const xLabel = seriesHeader.value[0] || 'X'
  const yLabel = seriesHeader.value[1] || 'Y'
  const data = seriesDataLines.value.map(row => {
    const x = parseFloat((row[0] || '0').replace(',', '.'))
    const y = parseFloat((row[1] || '0').replace(',', '.'))
    return { x: isNaN(x) ? 0 : x, y: isNaN(y) ? 0 : y }
  })
  return [{
    seriesType: 'X_INTENSITY' as const,
    seriesName: xLabel,
    linkedRecordIndex: null,
    linkedRecordDescription: '',
    data
  }]
})

/* ===== Drag-and-drop state ===== */
const fieldDragState = ref<{ blockId: string; fromIdx: number } | null>(null)
const fieldDragOverIdx = ref<number | null>(null)

function onFieldDragStart(blockId: string, rowIdx: number, e: DragEvent): void {
  fieldDragState.value = { blockId, fromIdx: rowIdx }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(rowIdx))
  }
  const target = e.target as HTMLElement
  setTimeout(() => target.classList.add('is-dragging'), 0)
}

function onFieldDragEnd(e: DragEvent): void {
  fieldDragState.value = null
  fieldDragOverIdx.value = null
  const target = e.target as HTMLElement
  target.classList.remove('is-dragging')
}

function onFieldDragOver(rowIdx: number, e: DragEvent): void {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  fieldDragOverIdx.value = rowIdx
}

function onFieldDragLeave(): void {
  fieldDragOverIdx.value = null
}

function onFieldDrop(blockId: string, toIdx: number, e: DragEvent): void {
  e.preventDefault()
  if (!fieldDragState.value || fieldDragState.value.blockId !== blockId) return

  const fromIdx = fieldDragState.value.fromIdx
  if (fromIdx === toIdx) return

  const blockIdx = pickedBlocks.value.findIndex(b => b.id === blockId)
  if (blockIdx === -1) return

  const block = pickedBlocks.value[blockIdx]
  const newFieldRows = [...block.fieldRows]
  const [moved] = newFieldRows.splice(fromIdx, 1)
  newFieldRows.splice(toIdx, 0, moved)

  // Reassign with updated orderIndex
  pickedBlocks.value = pickedBlocks.value.map((b, i) =>
    i === blockIdx ? { ...b, fieldRows: newFieldRows.map((f, fi) => ({ ...f, orderIndex: fi + 1 })) } : b
  )

  fieldDragState.value = null
  fieldDragOverIdx.value = null
}

/* ===== Computed ===== */
const confirmLabel = computed(() => props.operation === 'edit' ? 'Upravit šablonu' : 'Vytvořit šablonu')
const canDelete = computed(() => props.operation === 'edit' && !!props.initialTemplate?.templateId)
const hasAnyFields = computed(() => pickedBlocks.value.some(pb => pb.fieldRows.length > 0))
const deleteLoading = computed(() => props.deleteLoading ?? false)

/* ===== Row Designation Computed ===== */
// Effective row indices (manual overrides or auto-detected)
const effectiveHeaderRow = computed(() => headerRowIdx.value ?? 0)
const effectiveDataStartRow = computed(() => dataStartRowIdx.value ?? (effectiveHeaderRow.value + 1))

// Preview table data using raw data grid
const previewHeaders = computed(() => {
  const grid = proposal.value.rawGrid
  if (!grid || grid.length === 0) return mainHeader.value
  const hRow = grid[effectiveHeaderRow.value] || []
  // If units row is set, merge with headers
  if (unitsRowIdx.value !== null && grid[unitsRowIdx.value]) {
    const uRow = grid[unitsRowIdx.value]
    return hRow.map((h, i) => {
      const unit = uRow[i]?.trim()
      return unit && unit !== h ? `${h} (${unit})` : h
    })
  }
  return hRow
})

const previewRows = computed(() => {
  const grid = proposal.value.rawGrid
  if (!grid || grid.length === 0) return rawDataRows.value.slice(0, 5)
  const startIdx = effectiveDataStartRow.value
  return grid.slice(startIdx, startIdx + 5)
})

// Check if a unit row was auto-detected (pattern: d.nm, %, °C, etc.)
const autoDetectedUnitsRow = computed(() => {
  const grid = proposal.value.rawGrid
  if (!grid || grid.length < 2) return null
  const headerIdx = effectiveHeaderRow.value
  const potentialUnitsRow = grid[headerIdx + 1]
  if (!potentialUnitsRow) return null
  // Check if row looks like units (short text, common patterns)
  const unitPatterns = /^(d\.nm|nm|µm|um|mm|cm|m|kg|g|mg|%|percent|°C|°F|K|s|ms|min|h|kcps|cps)$/i
  const looksLikeUnits = potentialUnitsRow.filter(c => c && unitPatterns.test(c.trim())).length >= 2
  return looksLikeUnits ? headerIdx + 1 : null
})

// Get row type for visual styling
function getRowType(rowIdx: number): 'header' | 'units' | 'data' | 'ignored' {
  if (rowIdx === effectiveHeaderRow.value) return 'header'
  if (rowIdx === (unitsRowIdx.value ?? autoDetectedUnitsRow.value)) return 'units'
  if (rowIdx >= effectiveDataStartRow.value) return 'data'
  return 'ignored'
}

// Click handler for row in preview - sets designation
function onPreviewRowClick(rowIdx: number, event: MouseEvent): void {
  if (rowDesignationMode.value === 'header') {
    headerRowIdx.value = rowIdx
    // Auto-adjust data start if header moved below current data start
    if (dataStartRowIdx.value !== null && rowIdx >= dataStartRowIdx.value) {
      dataStartRowIdx.value = rowIdx + 1
    }
    rowDesignationMode.value = null
  } else if (rowDesignationMode.value === 'units') {
    unitsRowIdx.value = rowIdx
    rowDesignationMode.value = null
  } else if (rowDesignationMode.value === 'data') {
    dataStartRowIdx.value = rowIdx
    rowDesignationMode.value = null
  }
}

// Set row designation mode (called from toolbar buttons)
function setRowDesignationMode(mode: 'header' | 'units' | 'data' | null): void {
  rowDesignationMode.value = rowDesignationMode.value === mode ? null : mode
}

// Clear all manual row designations
function clearRowDesignations(): void {
  headerRowIdx.value = null
  unitsRowIdx.value = null
  dataStartRowIdx.value = null
  rowDesignationMode.value = null
}

/* ===== Options ===== */
const typeOptions: Array<{ label: string; value: FieldType }> = [
  { label: 'Float', value: 'float' },
  { label: 'Integer', value: 'int' },
  { label: 'Text', value: 'text' },
  { label: 'Soubor', value: 'file' },
  { label: 'Bool', value: 'bool' },
  { label: 'Datum', value: 'date' },
]
const delimiterOptions = [
  { label: 'Auto', value: 'auto' },
  { label: 'Tab', value: 'tab' },
  { label: 'Středník', value: 'semicolon' },
  { label: 'Čárka', value: 'comma' },
]
const tableHeaders = [
  { title: 'Poř.', key: 'orderIndex', sortable: false, width: 70 },
  { title: 'Název pole', key: 'name', sortable: false },
  { title: 'Typ', key: 'type', sortable: false, width: 160 },
  { title: 'Povinné', key: 'required', sortable: false, width: 120 },
  { title: '', key: 'actions', sortable: false, width: 112 },
]
/* ===== Block management ===== */
let fieldIdCounter = 0
function generateId(): string {
  return `blk-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}
function generateFieldId(): string {
  return `fld-${Date.now()}-${++fieldIdCounter}`
}
function addEmptyBlock(): void {
  pickedBlocks.value.push({
    id: generateId(),
    title: `Tabulka hodnot ${pickedBlocks.value.length + 1}`,
    fieldRows: [
      { id: generateFieldId(), orderIndex: 1, name: '', required: true, type: 'float' },
      { id: generateFieldId(), orderIndex: 2, name: '', required: true, type: 'float' },
      { id: generateFieldId(), orderIndex: 3, name: '', required: true, type: 'float' },
    ],
  })
}
function addEmptyBlockAndGo(): void {
  addEmptyBlock()
  currentBlockIndex.value = pickedBlocks.value.length - 1
}
function removePickedBlock(id: string): void {
  pickedBlocks.value = pickedBlocks.value.filter(b => b.id !== id)
  if (currentBlockIndex.value >= pickedBlocks.value.length) {
    currentBlockIndex.value = Math.max(0, pickedBlocks.value.length - 1)
  }
}
function movePickedBlock(id: string, delta: number): void {
  const idx = pickedBlocks.value.findIndex(b => b.id === id)
  const target = idx + delta
  if (idx < 0 || target < 0 || target >= pickedBlocks.value.length) return
  const arr = [...pickedBlocks.value]
  const [item] = arr.splice(idx, 1)
  arr.splice(target, 0, item)
  pickedBlocks.value = arr
  currentBlockIndex.value = target
}
function prevBlock(): void {
  currentBlockIndex.value = Math.max(0, currentBlockIndex.value - 1)
}
function nextBlock(): void {
  currentBlockIndex.value = Math.min(pickedBlocks.value.length - 1, currentBlockIndex.value + 1)
}
/* ===== Field management ===== */
function addFieldTo(blockId: string, atIndex?: number): void {
  const blockIdx = pickedBlocks.value.findIndex(b => b.id === blockId)
  if (blockIdx === -1) return
  const block = pickedBlocks.value[blockIdx]
  const idx = typeof atIndex === 'number' ? atIndex : block.fieldRows.length
  const newField: FieldRow = { id: generateFieldId(), orderIndex: 0, name: '', required: false, type: 'float' }
  const newFieldRows = [...block.fieldRows]
  newFieldRows.splice(idx, 0, newField)
  // Reassign to trigger reactivity
  pickedBlocks.value = pickedBlocks.value.map((b, i) =>
    i === blockIdx ? { ...b, fieldRows: newFieldRows.map((f, fi) => ({ ...f, orderIndex: fi + 1 })) } : b
  )
}
function removeFieldIn(blockId: string, index: number): void {
  const blockIdx = pickedBlocks.value.findIndex(b => b.id === blockId)
  if (blockIdx === -1) return
  const block = pickedBlocks.value[blockIdx]
  const newFieldRows = block.fieldRows.filter((_, i) => i !== index)
  // Reassign to trigger reactivity
  pickedBlocks.value = pickedBlocks.value.map((b, i) =>
    i === blockIdx ? { ...b, fieldRows: newFieldRows.map((f, fi) => ({ ...f, orderIndex: fi + 1 })) } : b
  )
}
function moveFieldIn(blockId: string, index: number, delta: number): void {
  const blockIdx = pickedBlocks.value.findIndex(b => b.id === blockId)
  if (blockIdx === -1) return
  const block = pickedBlocks.value[blockIdx]
  const target = index + delta
  if (target < 0 || target >= block.fieldRows.length) return
  const newFieldRows = [...block.fieldRows]
  const [item] = newFieldRows.splice(index, 1)
  newFieldRows.splice(target, 0, item)
  // Reassign to trigger reactivity
  pickedBlocks.value = pickedBlocks.value.map((b, i) =>
    i === blockIdx ? { ...b, fieldRows: newFieldRows.map((f, fi) => ({ ...f, orderIndex: fi + 1 })) } : b
  )
}
function reindexFields(block: PickedBlock): void {
  // Find block and reassign to trigger reactivity
  const blockIdx = pickedBlocks.value.findIndex(b => b.id === block.id)
  if (blockIdx === -1) {
    // Fallback: just mutate in place
    block.fieldRows.forEach((f, i) => { f.orderIndex = i + 1 })
    return
  }
  // Create new array with updated orderIndex
  const updatedFieldRows = pickedBlocks.value[blockIdx].fieldRows.map((f, i) => ({ ...f, orderIndex: i + 1 }))
  pickedBlocks.value = pickedBlocks.value.map((b, i) =>
    i === blockIdx ? { ...b, fieldRows: updatedFieldRows } : b
  )
}
/* ===== Series field management ===== */
function addSeriesBlockEmpty(): void {
  // Create a new series block with 2 default fields
  seriesFieldRows.value = [
    { id: generateFieldId(), orderIndex: 1, name: 'X', required: true, type: 'float' },
    { id: generateFieldId(), orderIndex: 2, name: 'Y', required: true, type: 'float' }
  ]
  seriesBlockTitle.value = 'Datová série'
}
function addSeriesBlockAndGo(): void {
  addSeriesBlockEmpty()
  // Scroll to series section after next tick
  nextTick(() => {
    const seriesEl = document.querySelector('.series-section')
    if (seriesEl) seriesEl.scrollIntoView({ behavior: 'smooth' })
  })
}
function addSeriesField(atIndex?: number): void {
  const idx = typeof atIndex === 'number' ? atIndex : seriesFieldRows.value.length
  const newField: FieldRow = { id: generateFieldId(), orderIndex: 0, name: '', required: false, type: 'float' }
  const newRows = [...seriesFieldRows.value]
  newRows.splice(idx, 0, newField)
  seriesFieldRows.value = newRows.map((f, i) => ({ ...f, orderIndex: i + 1 }))
}

function removeSeriesField(index: number): void {
  const newRows = seriesFieldRows.value.filter((_, i) => i !== index)
  seriesFieldRows.value = newRows.map((f, i) => ({ ...f, orderIndex: i + 1 }))
  selectedSeriesRows.value.delete(index)
  // Re-adjust selection indexes after removal
  const adjusted = new Set<number>()
  selectedSeriesRows.value.forEach(idx => {
    if (idx > index) adjusted.add(idx - 1)
    else if (idx < index) adjusted.add(idx)
  })
  selectedSeriesRows.value = adjusted
}

function onSeriesRowClick(index: number, e: MouseEvent): void {
  if (e.shiftKey && lastSelectedSeriesIdx.value !== null) {
    // Shift+click: select range
    const start = Math.min(lastSelectedSeriesIdx.value, index)
    const end = Math.max(lastSelectedSeriesIdx.value, index)
    for (let i = start; i <= end; i++) {
      selectedSeriesRows.value.add(i)
    }
    selectedSeriesRows.value = new Set(selectedSeriesRows.value)
  } else if (e.ctrlKey || e.metaKey) {
    // Ctrl+click: toggle single
    if (selectedSeriesRows.value.has(index)) {
      selectedSeriesRows.value.delete(index)
    } else {
      selectedSeriesRows.value.add(index)
    }
    selectedSeriesRows.value = new Set(selectedSeriesRows.value)
  } else {
    // Normal click: single select
    selectedSeriesRows.value = new Set([index])
  }
  lastSelectedSeriesIdx.value = index
}

function deleteSelectedSeriesFields(): void {
  if (selectedSeriesRows.value.size === 0) return
  const indices = Array.from(selectedSeriesRows.value).sort((a, b) => b - a) // descending to delete from end
  const newRows = [...seriesFieldRows.value]
  indices.forEach(idx => { newRows.splice(idx, 1) })
  seriesFieldRows.value = newRows.map((f, i) => ({ ...f, orderIndex: i + 1 }))
  selectedSeriesRows.value = new Set()
  lastSelectedSeriesIdx.value = null
}
/* ===== Import mode helpers ===== */
function parseFromRawText(): void {
  runAnalysis()
}

/**
 * Check if file is an Excel format
 */
function isExcelFile(file: File): boolean {
  const ext = file.name.toLowerCase()
  return ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.xlsm')
}

/**
 * Read Excel file using SheetJS and convert to CSV text
 */
async function readExcelFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })

  // Get first sheet
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('Excel soubor neobsahuje žádný list')
  }

  const worksheet = workbook.Sheets[firstSheetName]

  // Convert to CSV with tab delimiter
  const csv = XLSX.utils.sheet_to_csv(worksheet, { FS: '\t' })
  console.log('[readExcelFile] Converted to CSV, first 500 chars:', csv.slice(0, 500))
  return csv
}

/* ===== Encoding detection for Czech characters ===== */
function normalizeNewlines(s: string): string {
  return s.replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ')
}

function countReplacementChars(s: string): number {
  return (s.match(/\uFFFD/g) || []).length
}

function isMostlyPrintable(s: string): boolean {
  const stripped = s.replace(/[\n\r\t ]+/g, '')
  const nonPrintable = stripped.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g)?.length ?? 0
  return nonPrintable < Math.max(4, Math.floor(stripped.length * 0.01))
}

type CandidateEncoding = 'utf-8' | 'windows-1250' | 'windows-1252' | 'iso-8859-2'
type ScoredText = { text: string; score: number }

/**
 * Smart file reading with encoding autodetection (UTF-8/16, Windows-1250/1252, ISO-8859-2).
 * Supports Czech characters (ěščřžýáíéúůďťňó) in CSV/TSV files.
 */
async function readFileSmart(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())

  // BOM detection
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return normalizeNewlines(new TextDecoder('utf-16le').decode(buf))
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    return normalizeNewlines(new TextDecoder('utf-16be').decode(buf))
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return normalizeNewlines(new TextDecoder('utf-8').decode(buf))
  }

  // UTF-16LE without BOM (typical for Excel CSV)
  const zeroRatio = buf.filter(b => b === 0).length / Math.max(1, buf.length)
  if (zeroRatio > 0.1) {
    return normalizeNewlines(new TextDecoder('utf-16le').decode(buf))
  }

  // Try multiple decoders and pick best (fewest replacement chars)
  const candidates: ReadonlyArray<CandidateEncoding> = ['utf-8', 'windows-1250', 'windows-1252', 'iso-8859-2']
  let best: ScoredText = { text: '', score: Number.POSITIVE_INFINITY }

  for (const enc of candidates) {
    try {
      const dec = new TextDecoder(enc, { fatal: false })
      const text = normalizeNewlines(dec.decode(buf))
      const score = countReplacementChars(text) + (isMostlyPrintable(text) ? 0 : 1000)
      if (score < best.score) best = { text, score }
      if (score === 0) break
    } catch {
      // Browser may not support encoding - skip
    }
  }

  // Fallback to UTF-8
  return best.text || normalizeNewlines(new TextDecoder().decode(buf))
}

// Track if current data comes from Excel (to force tab delimiter)
const isFromExcel = ref(false)

async function onDropFile(e: DragEvent): Promise<void> {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return

  try {
    if (isExcelFile(file)) {
      isFromExcel.value = true
      rawText.value = await readExcelFile(file)
      // Force tab delimiter for Excel files
      parseOptions.value = { ...parseOptions.value, delimiter: '\t' }
    } else {
      isFromExcel.value = false
      rawText.value = await readFileSmart(file)
    }
    runAnalysis()
  } catch (err) {
    console.error('[onDropFile] Error reading file:', err)
    parseStatus.value = 'FAIL'
    parseReasons.value = [err instanceof Error ? err.message : 'Chyba při čtení souboru']
  }
}

function onPasteText(e: ClipboardEvent): void {
  const text = e.clipboardData?.getData('text')
  if (text) {
    isFromExcel.value = false
    rawText.value = text
    showTextareaInput.value = false
    runAnalysis()
  }
}

function triggerFilePick(): void { fileInput.value?.click() }

async function onFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    if (isExcelFile(file)) {
      isFromExcel.value = true
      rawText.value = await readExcelFile(file)
      // Force tab delimiter for Excel files
      parseOptions.value = { ...parseOptions.value, delimiter: '\t' }
    } else {
      isFromExcel.value = false
      rawText.value = await readFileSmart(file)
    }
    runAnalysis()
  } catch (err) {
    console.error('[onFilePicked] Error reading file:', err)
    parseStatus.value = 'FAIL'
    parseReasons.value = [err instanceof Error ? err.message : 'Chyba při čtení souboru']
  }

  input.value = ''
}
/* Delimiter guess - now respects parseOptions.value.delimiter */
function detectDelimiter(line: string): string {
  // If parseOptions has explicit delimiter, use it
  const optDelim = parseOptions.value.delimiter
  if (optDelim !== 'auto') {
    return optDelim
  }

  // Legacy fallback using old delimiter ref
  if (delimiter.value === 'tab') return '\t'
  if (delimiter.value === 'comma') return ','
  if (delimiter.value === 'semicolon') return ';'

  // Auto-detect from line content
  if (line.includes('\t')) return '\t'
  if (line.includes(';')) return ';'
  if (line.includes(',')) return ','
  return '\t'
}
/* Normalization & type inference */
function normalizeHeader(raw: string): string {
  return (raw || '').trim().replace(/\s+/g, ' ')
}
function baseNameForRepeat(h: string): string {
  return h.replace(/\s+\d+$/u, '').trim()
}
function smartInferFieldType(header: string): FieldType {
  const h = header.trim().toLowerCase()
  if (
    /(^|\s)(date|datum)(\s|$)/.test(h) ||
    /(^|\s)(time|čas)(\s|$)/.test(h) ||
    /date\s*and\s*time|datetime|date\/time|timestamp/.test(h)
  ) return 'date'
  if (/(record\s*number|index|order|poř\.|id|identifier|číslo\s*záznamu)/.test(h) ||
    /(count|počet|quantity)/.test(h)) return 'int'
  // Boolean: use strict word boundaries to avoid matching "hodnota" (contains "no", "ano") or "jméno" (contains "no")
  if (/^(bool|boolean|ano|ne|yes|no|true|false)$/.test(h) ||
      /(^|\s)(bool|boolean|ano|ne|yes|no|true|false)(\s|$)/.test(h)) return 'bool'
  if (/(file|soubor|image|foto|picture|attachment)/.test(h)) return 'file'
  if (/(mean|average|avg|z-average|volume\s*mean|number\s*mean)/.test(h) ||
    /(temperature|temp|°c|°k|celsius|kelvin)/.test(h) ||
    /(pdi|polydispersity)/.test(h) ||
    /(size\s*peak)/.test(h) ||
    /(attenuator)/.test(h) ||
    /(sizes|intensities|volumes|numbers)/.test(h) ||
    /(diameter|radius|nm|µm|um|mm)/.test(h)) return 'float'
  // Float: also use word boundaries for 'value' to avoid partial matches in Czech words
  if (/^(hodnota|value|measurement|měření)$/.test(h) ||
      /(^|\s)(hodnota|value|measurement|měření)(\s|$)/.test(h) ||
      /(numeric|num|ratio|%|ppm|mg|ml|hz)/.test(h)) return 'float'
  return 'text'
}
/* Main parsing logic for the provided multi-line input */
const UNIT_INDICATORS: readonly string[] = [
  '°', '%', 'mv', 'ms/cm', 's/cm', 'mS', 'mS/cm',
  'cm', 'nm', 'um', 'µm', 'µ', 'μ', 'ohm', 'kda', 'v', 'a', 'hz', 'ppm', '/cm', '/vs', 'vs',
  'mg', 'kg', 'g', 'ml', 'l', 'mol', 'mmol', 'µmol', 'mm', 'm', 'µl', 'd.nm', 'percent'
]

function looksLikeUnitRow(parts: string[]): boolean {
  if (!parts || parts.length === 0) return false
  let unitCount = 0
  let nonEmpty = 0
  for (const p of parts) {
    const s = p.trim()
    if (!s) continue
    nonEmpty++
    const low = s.toLowerCase()
    // Pure numbers are not units
    if (/^[+-]?\d+([.,]\d+)?$/.test(s)) continue
    // Check for unit indicators
    const hasUnit = UNIT_INDICATORS.some(u => low.includes(u)) ||
      (low.length <= 8 && /^[a-zµμ°/%\-/.]+$/.test(low))
    if (hasUnit) unitCount++
  }
  return nonEmpty > 0 && unitCount >= Math.max(1, Math.round(nonEmpty * 0.4))
}

function mergeHeadersWithUnits(headers: string[], units: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < headers.length; i++) {
    const base = headers[i]?.trim() || ''
    const unit = units[i]?.trim() || ''
    if (unit && !base.toLowerCase().includes(unit.toLowerCase())) {
      result.push(base ? `${base} (${unit})` : unit)
    } else {
      result.push(base)
    }
  }
  return result
}

const unitRowDetected = ref(false)

function runAnalysis(): void {
  mainHeader.value = []
  statsLines.value = []
  seriesHeader.value = []
  seriesDataLines.value = []
  unitRowDetected.value = false
  rawDataRows.value = []
  parseStatus.value = 'FAIL'
  parseReasons.value = []

  const text = rawText.value.trim()
  if (!text) return
  const lines = text.split(/\r?\n/)
  if (!lines.length) return

  // find first potential header line (must contain Record Number)
  const headerLineIdx = lines.findIndex(l => /record\s*number/i.test(l))

  // If no "Record Number" found, use fallback parser
  if (headerLineIdx === -1) {
    console.log('[runAnalysis] No Record Number header found, using fallback parser')
    runFallbackParse()
    return
  }

  const delim = detectDelimiter(lines[headerLineIdx])
  const headerRaw = lines[headerLineIdx].split(delim).map(h => h.trim()).filter(Boolean)

  // Check if next line is a unit row
  const nextLineIdx = headerLineIdx + 1
  let startDataIdx = nextLineIdx
  if (nextLineIdx < lines.length) {
    const potentialUnitRow = lines[nextLineIdx].split(delim).map(u => u.trim())
    if (looksLikeUnitRow(potentialUnitRow)) {
      // Merge units into headers
      mainHeader.value = mergeHeadersWithUnits(headerRaw, potentialUnitRow)
      unitRowDetected.value = true
      startDataIdx = nextLineIdx + 1 // Skip unit row in data processing
    } else {
      mainHeader.value = headerRaw
    }
  } else {
    mainHeader.value = headerRaw
  }

  // Collect data rows for preview
  const dataRows: string[][] = []
  for (let i = startDataIdx; i < lines.length && dataRows.length < 50; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // Skip stats lines
    if (/^(mean|std\s*dev|rsd)/i.test(line)) {
      statsLines.value.push(line)
      continue
    }
    // Skip series block
    if (/^x\s+intensity/i.test(line)) break

    const cells = line.split(delim).map(c => c.trim())
    dataRows.push(cells)
  }
  rawDataRows.value = dataRows

  // Scan remaining lines for stats and series
  for (let i = startDataIdx; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // Stats lines
    if (/^(mean|std\s*dev|rsd)/i.test(line)) {
      if (!statsLines.value.includes(line)) {
        statsLines.value.push(line)
      }
      continue
    }
    // Series block header
    if (/^x\s+intensity/i.test(line)) {
      // Parse header columns
      const rawCols = line.split(delim).map(c => c.trim()).filter(Boolean)
      // Expect first col 'X Intensity' second descriptive, rename second to 'Intensity'
      const first = rawCols[0] || 'X'
      seriesHeader.value = [first, 'Intensity']
      // Collect following numeric pairs until blank or non-numeric
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j].trim()
        if (!ln) break
        const cols = ln.split(delim).map(c => c.trim())
        if (cols.length < 2) break
        // rudimentary numeric validation for first column
        if (!/^(\d+(\.\d+)?|\d+,\d+|\d+(\.\d+)?e[\+\-]?\d+|\d+,\d+e[\+\-]?\d+)$/i.test(cols[0])) break
        seriesDataLines.value.push(cols.slice(0, 2))
      }
      break
    }
  }

  // Auto-create blocks after successful parsing
  if (mainHeader.value.length > 0) {
    createBlocksFromParsed()
  } else {
    // No headers found even with Record Number - use fallback
    runFallbackParse()
  }
}
/* Create blocks from parsed structures */
function createBlocksFromParsed(): void {
  console.log('[createBlocksFromParsed] mainHeader:', mainHeader.value)
  console.log('[createBlocksFromParsed] seriesHeader:', seriesHeader.value)
  if (!mainHeader.value.length) {
    console.log('[createBlocksFromParsed] No mainHeader, returning early')
    return
  }

  // NEW: Detect vector columns and move them to series
  const vectorColumnIndices: Set<number> = new Set()
  const vectorHeaders: string[] = []

  for (let colIdx = 0; colIdx < mainHeader.value.length; colIdx++) {
    // Check if first data row has a vector in this column
    const sampleCell = rawDataRows.value[0]?.[colIdx]
    if (sampleCell && isVectorCell(sampleCell)) {
      vectorColumnIndices.add(colIdx)
      vectorHeaders.push(mainHeader.value[colIdx] || `Series ${colIdx + 1}`)
      console.log('[createBlocksFromParsed] Vector column detected:', colIdx, mainHeader.value[colIdx])
    }
  }

  // Filter out vector columns from headers for regular fields
  const nonVectorHeaders = mainHeader.value.filter((_, i) => !vectorColumnIndices.has(i))

  // Build main block with size peak auto-numbering (excluding vector columns)
  const counters = new Map<string, number>()
  const normalizedMain = nonVectorHeaders.map(normalizeHeader)
  console.log('[createBlocksFromParsed] normalizedMain (excluding vectors):', normalizedMain)
  const withRepeatHandling = normalizedMain.map(h => {
    const base = baseNameForRepeat(h) || h
    const count = (counters.get(base) ?? 0) + 1
    counters.set(base, count)
    return count > 1 ? `${base} ${count}` : base
  })
  console.log('[createBlocksFromParsed] withRepeatHandling:', withRepeatHandling)
  const block1Rows: FieldRow[] = withRepeatHandling.map((name, i) => ({
    id: generateFieldId(),
    orderIndex: i + 1,
    name,
    required: true,
    type: smartInferFieldType(name)
  }))
  console.log('[createBlocksFromParsed] block1Rows:', block1Rows)

  const newBlocks: PickedBlock[] = [{
    id: generateId(),
    title: 'Tabulka hodnot 1',
    fieldRows: block1Rows
  }]

  // Add vector columns to series headers
  if (vectorHeaders.length > 0) {
    console.log('[createBlocksFromParsed] Adding vector columns to series:', vectorHeaders)
    // Each vector column becomes a series with X=index, Y=values
    seriesHeader.value = [...seriesHeader.value, ...vectorHeaders]
  }

  // NOTE: Series data (X Intensity etc.) is NOT added as a template block.
  // Series data will be automatically imported to SeriesSection during measurement creation.
  // We create editable field rows for series headers so user can customize them.
  if (seriesHeader.value.length) {
    console.log('[createBlocksFromParsed] Series detected, creating field rows:', seriesHeader.value)
    seriesFieldRows.value = seriesHeader.value.map((name, i) => ({
      id: generateFieldId(),
      orderIndex: i + 1,
      name: normalizeHeader(name),
      required: true,
      type: 'float' as FieldType
    }))
    seriesBlockTitle.value = 'Datová série'
  }

  // Assign to trigger proper reactivity
  pickedBlocks.value = newBlocks
  currentBlockIndex.value = 0
  console.log('[createBlocksFromParsed] Final pickedBlocks:', pickedBlocks.value)

  // Update parse status for SUCCESS
  parseStatus.value = 'SUCCESS'
  parseReasons.value = []
}

/* ===== NEW: Fallback parsing functions ===== */

function resetParseState(): void {
  parseStatus.value = 'FAIL'
  parseReasons.value = []
  rawDataRows.value = []
  mainHeader.value = []
  seriesHeader.value = []
  seriesDataLines.value = []
  statsLines.value = []
}

/**
 * Run fallback parsing using clientParser when legacy runAnalysis fails.
 * Updates parseStatus, rawDataRows, mainHeader, and builds proposal for 3-layer architecture.
 */
function runFallbackParse(): void {
  const text = rawText.value.trim()
  if (!text) {
    resetParseState()
    return
  }

  try {
    // Get the delimiter to use
    const delim = detectDelimiter(text.split('\n')[0] || '')

    // Build proposal with multi-block detection
    const rawLines = text.split(/\r?\n/)
    proposal.value = buildProposal(rawLines, undefined, delim)

    // Auto-include all blocks with confidence >= 0.5
    includedBlockIds.value = proposal.value.blocks
      .filter(b => b.confidence >= 0.5)
      .map(b => b.id)

    selectedBlockId.value = null

    // Also run the single-result parser for compatibility
    const result = parseWithOptions(text, parseOptions.value)
    parseStatus.value = result.status
    parseReasons.value = result.reasons
    rawDataRows.value = result.rows
    mainHeader.value = result.headers

    // Set status based on proposal quality
    if (proposal.value.blocks.length > 0) {
      const highConfidence = proposal.value.blocks.filter(b => b.confidence >= 0.7)
      if (highConfidence.length > 0) {
        parseStatus.value = 'SUCCESS'
      } else if (includedBlockIds.value.length > 0) {
        parseStatus.value = 'PARTIAL'
        parseReasons.value = ['Nízká spolehlivost detekce - zkontrolujte bloky']
      }
    }

    // If parse was successful or partial with headers, try to create blocks
    if (result.status !== 'FAIL' && result.headers.length > 0) {
      // Don't auto-create blocks - let user explicitly use "Použít návrh"
      // This follows the 3-layer principle: user = authority
    }
  } catch (err) {
    console.error('[runFallbackParse] Error:', err)
    parseStatus.value = 'FAIL'
    parseReasons.value = [err instanceof Error ? err.message : 'Chyba při parsování']
    rawDataRows.value = []
  }
}

/**
 * Create blocks from headers (without legacy Record Number detection).
 */
function createBlocksFromHeaders(headers: string[], dataRows: string[][]): void {
  if (!headers.length) return

  // Infer types from data
  const types = inferColumnTypes(dataRows)

  const fieldRows: FieldRow[] = headers.map((name, i) => ({
    id: generateFieldId(),
    orderIndex: i + 1,
    name: name || `Column ${i + 1}`,
    required: false,
    type: mapInferredType(types[i] || 'text')
  }))

  pickedBlocks.value = [{
    id: generateId(),
    title: 'Tabulka hodnot 1',
    fieldRows
  }]
  currentBlockIndex.value = 0
  hasUserEditedFields.value = false
}

function mapInferredType(t: string): FieldType {
  switch (t) {
    case 'int': return 'int'
    case 'float': return 'float'
    case 'bool': return 'bool'
    case 'date': return 'date'
    case 'file': return 'file'
    default: return 'text'
  }
}

/**
 * Create columns from raw data without requiring headers.
 * Generates Column 1..N names and infers types from samples.
 */
function createColumnsFromData(): void {
  const text = rawText.value.trim()
  if (!text) return

  try {
    // Parse with current options but force no_header
    const opts: ParseOptions = { ...parseOptions.value, header: 'no_header' }
    const result = parseWithOptions(text, opts)

    if (result.rows.length === 0) {
      parseReasons.value = ['Žádná data k importu']
      return
    }

    // Generate column names
    const maxCols = Math.max(...result.rows.map(r => r.length))
    const headers = generateColumnNames(maxCols)

    // Infer types
    const types = inferColumnTypes(result.rows)

    const fieldRows: FieldRow[] = headers.map((name, i) => ({
      id: generateFieldId(),
      orderIndex: i + 1,
      name,
      required: true,
      type: mapInferredType(types[i] || 'text')
    }))

    pickedBlocks.value = [{
      id: generateId(),
      title: 'Tabulka hodnot 1',
      fieldRows
    }]
    currentBlockIndex.value = 0
    hasUserEditedFields.value = false

    // Update status
    parseStatus.value = 'SUCCESS'
    parseReasons.value = []
    mainHeader.value = headers
    rawDataRows.value = result.rows

  } catch (err) {
    console.error('[createColumnsFromData] Error:', err)
    parseReasons.value = [err instanceof Error ? err.message : 'Chyba']
  }
}

/**
 * Handle manual block selection from ManualHeaderPickerDialog.
 * Creates template blocks based on user's manual selection of headers and data ranges.
 */
interface ManualBlock {
  headerRowIndex: number
  dataRowIndexStart: number
  dataRowIndexEnd: number
  kind: 'table' | 'series'
  title: string
}

function onManualBlocksApply(manualBlocks: ManualBlock[]): void {
  console.log('[onManualBlocksApply] Received blocks:', manualBlocks)

  const grid = proposal.value.rawGrid
  if (!grid || grid.length === 0) {
    parseReasons.value = ['Žádná data k zpracování']
    return
  }

  // Process each block
  const newPickedBlocks: PickedBlock[] = []

  for (const mb of manualBlocks) {
    if (mb.kind === 'series') {
      // Series block - extract headers and set up series fields
      const headerRow = grid[mb.headerRowIndex]
      if (headerRow) {
        seriesHeader.value = headerRow.map(String)
        seriesFieldRows.value = headerRow.map((name, i) => ({
          id: generateFieldId(),
          orderIndex: i + 1,
          name: String(name),
          required: true,
          type: 'float' as FieldType
        }))
        seriesBlockTitle.value = mb.title
      }
    } else {
      // Table block - create regular fields
      const headerRow = grid[mb.headerRowIndex]
      if (headerRow) {
        const fieldRows: FieldRow[] = headerRow.map((name, i) => ({
          id: generateFieldId(),
          orderIndex: i + 1,
          name: String(name),
          required: true,
          type: smartInferFieldType(String(name))
        }))

        newPickedBlocks.push({
          id: generateId(),
          title: mb.title,
          fieldRows
        })
      }
    }
  }

  if (newPickedBlocks.length > 0) {
    pickedBlocks.value = newPickedBlocks
    currentBlockIndex.value = 0
  }

  // Update main header for compatibility
  const firstTableBlock = manualBlocks.find(b => b.kind === 'table')
  if (firstTableBlock) {
    mainHeader.value = (grid[firstTableBlock.headerRowIndex] || []).map(String)
  }

  // Update status
  parseStatus.value = 'SUCCESS'
  parseReasons.value = []
  hasUserEditedFields.value = true
}

/**
 * Handle selection of blocks from ManualHeaderPickerDialog.
 * Uses existing detected blocks but allows user to select which ones to use.
 */
function onManualBlocksSelect(selectedBlockIds: string[], blockTypes: Map<string, 'table' | 'series'>): void {
  console.log('[onManualBlocksSelect] Selected blocks:', selectedBlockIds, 'Types:', blockTypes)

  const grid = proposal.value.rawGrid
  const blocks = proposal.value.blocks

  if (!grid || grid.length === 0 || !blocks || blocks.length === 0) {
    parseReasons.value = ['Žádná data k zpracování']
    return
  }

  const newPickedBlocks: PickedBlock[] = []

  for (const blockId of selectedBlockIds) {
    const detectedBlock = blocks.find(b => b.id === blockId)
    if (!detectedBlock) continue

    const blockType = blockTypes.get(blockId) || 'table'
    const headerRow = grid[detectedBlock.headerRowIndex]
    if (!headerRow) continue

    const headers = headerRow.map(String)

    if (blockType === 'series') {
      // Create series fields
      seriesFieldRows.value = headers.map((name, i) => ({
        id: generateFieldId(),
        orderIndex: i + 1,
        name: normalizeHeader(name),
        required: true,
        type: 'float' as FieldType
      }))
      seriesBlockTitle.value = detectedBlock.title || 'Datová série'
    } else {
      // Create table fields
      const fieldRows: FieldRow[] = headers.map((name, i) => ({
        id: generateFieldId(),
        orderIndex: i + 1,
        name: normalizeHeader(name),
        required: true,
        type: smartInferFieldType(name)
      }))

      newPickedBlocks.push({
        id: generateId(),
        title: detectedBlock.title || 'Tabulka hodnot',
        fieldRows
      })
    }
  }

  if (newPickedBlocks.length > 0) {
    pickedBlocks.value = newPickedBlocks
    currentBlockIndex.value = 0
  }

  // Update status
  parseStatus.value = 'SUCCESS'
  parseReasons.value = []
  hasUserEditedFields.value = true
}

/**
 * Handle manual header selection from the redesigned picker dialog.
 * Creates table blocks and/or series fields from user-selected headers.
 */
function onManualHeadersApply(result: { tableHeaders: string[], seriesHeaders: string[], headerRowIndex: number | null }): void {
  console.log('[onManualHeadersApply]', result)

  // Create table block from table headers
  if (result.tableHeaders.length > 0) {
    const fieldRows: FieldRow[] = result.tableHeaders.map((name, i) => ({
      id: generateFieldId(),
      orderIndex: i + 1,
      name: normalizeHeader(name),
      required: true,
      type: smartInferFieldType(name)
    }))

    pickedBlocks.value = [{
      id: generateId(),
      title: 'Tabulka hodnot 1',
      fieldRows
    }]
    currentBlockIndex.value = 0
  }

  // Create series fields from series headers
  if (result.seriesHeaders.length > 0) {
    seriesFieldRows.value = result.seriesHeaders.map((name, i) => ({
      id: generateFieldId(),
      orderIndex: i + 1,
      name: normalizeHeader(name),
      required: true,
      type: 'float' as FieldType
    }))
    seriesBlockTitle.value = 'Datová série'
  }

  // Update main header for compatibility
  mainHeader.value = [...result.tableHeaders, ...result.seriesHeaders]

  // Update status
  parseStatus.value = 'SUCCESS'
  parseReasons.value = []
  hasUserEditedFields.value = true
}

/**
 * Create data series from detected vector columns.
 */
function createSeriesFromVectors(): void {
  const vectors = detectVectorColumns(rawDataRows.value)
  const pair = findPairedVectors(vectors)

  if (!pair) {
    parseReasons.value = ['Nenalezeny párové vektorové sloupce']
    return
  }

  const [xColIdx, yColIdx] = pair

  // Get column names
  const xName = mainHeader.value[xColIdx] || `Column ${xColIdx + 1}`
  const yName = mainHeader.value[yColIdx] || `Column ${yColIdx + 1}`

  // Create series fields
  seriesFieldRows.value = [
    { id: generateFieldId(), orderIndex: 1, name: xName, required: true, type: 'float' },
    { id: generateFieldId(), orderIndex: 2, name: yName, required: true, type: 'float' }
  ]
  seriesBlockTitle.value = 'Datová série'

  // Remove vector columns from regular fields if blocks exist
  if (pickedBlocks.value.length > 0) {
    const block = pickedBlocks.value[0]
    block.fieldRows = block.fieldRows.filter((_, i) => i !== xColIdx && i !== yColIdx)
    // Reindex
    block.fieldRows.forEach((f, i) => { f.orderIndex = i + 1 })
  }

  // Create regular fields for non-vector columns if no blocks exist
  if (pickedBlocks.value.length === 0 && mainHeader.value.length > 0) {
    const nonVectorHeaders = mainHeader.value.filter((_, i) => i !== xColIdx && i !== yColIdx)
    const types = inferColumnTypes(rawDataRows.value)

    const fieldRows: FieldRow[] = nonVectorHeaders.map((name, i) => {
      const originalIdx = mainHeader.value.indexOf(name)
      return {
        id: generateFieldId(),
        orderIndex: i + 1,
        name,
        required: false,
        type: mapInferredType(types[originalIdx] || 'text')
      }
    })

    if (fieldRows.length > 0) {
      pickedBlocks.value = [{
        id: generateId(),
        title: 'Tabulka hodnot 1',
        fieldRows
      }]
    }
  }

  parseStatus.value = 'SUCCESS'
  parseReasons.value = []
}

/**
 * Handle apply from format dialog.
 */
function onApplyFormat(opts: ParseOptions, result: ParseResult): void {
  parseOptions.value = opts
  parseStatus.value = result.status
  parseReasons.value = result.reasons
  rawDataRows.value = result.rows
  mainHeader.value = result.headers

  // If successful, create blocks
  if (result.status === 'SUCCESS' && result.headers.length > 0) {
    createBlocksFromHeaders(result.headers, result.rows)
  }
}

/* ===== Confirm / Cancel / Delete ===== */
function normalizeDeviceCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_')
}

function generateChangeDescription(): string {
  if (!props.initialTemplate) return ''
  const changes: string[] = []

  // Name
  const newName = (templateName.value || '').trim()
  if (props.initialTemplate.name !== newName) {
    changes.push(`Změna názvu: "${props.initialTemplate.name}" -> "${newName}"`)
  }

  // Device
  if (props.initialTemplate.deviceCode !== deviceCode.value) {
    changes.push(`Změna přístroje: "${props.initialTemplate.deviceCode}" -> "${deviceCode.value}"`)
  }

  // Helper to distinguish table/series blocks in initial template
  const oldBlocks = props.initialTemplate.blocks || []
  const oldTableBlocks = oldBlocks.filter(b => {
     const isSeries = (b as any).kind === 'series' ||
       (b.title?.toLowerCase().includes('série')) ||
       (b.title?.toLowerCase().includes('series'))
     return !isSeries
  })

  // Compare Table Blocks
  const newBlocks = pickedBlocks.value
  const maxLen = Math.max(oldTableBlocks.length, newBlocks.length)

  for (let i = 0; i < maxLen; i++) {
    const ob = oldTableBlocks[i]
    const nb = newBlocks[i]

    if (!ob && nb) {
      changes.push(`Přidán nový blok: "${nb.title}"`)
      continue
    }
    if (ob && !nb) {
      changes.push(`Odebrán blok: "${ob.title}"`)
      continue
    }

    if (ob.title !== nb.title) {
       changes.push(`Přejmenován blok: "${ob.title}" -> "${nb.title}"`)
    }

    // Compare fields
    const oldFields = ob.fields || []
    const newFields = nb.fieldRows || []
    const oldFieldMap = new Map(oldFields.map(f => [f.name, f]))
    const newFieldMap = new Map(newFields.map(f => [f.name, f]))

    // Additions & Mods
    for (const nf of newFields) {
       const of = oldFieldMap.get(nf.name)
       if (!of) {
          changes.push(`Blok "${nb.title}" - přidáno pole: "${nf.name}"`)
       } else {
          if (of.type !== nf.type) {
             changes.push(`Blok "${nb.title}" - pole "${nf.name}": změna typu ${of.type} -> ${nf.type}`)
          }
          if (!!of.required !== !!nf.required) {
             changes.push(`Blok "${nb.title}" - pole "${nf.name}": ${nf.required ? 'nastaveno jako povinné' : 'zrušena povinnost'}`)
          }
       }
    }
    // Removals
    for (const of of oldFields) {
       if (!newFieldMap.has(of.name)) {
          changes.push(`Blok "${nb.title}" - odebráno pole: "${of.name}"`)
       }
    }
  }

  return changes.join('\n')
}
/* ===== Save Version Logic ===== */
const showSaveVersionDialog = ref(false)
const changeDescription = ref('')

const currentVersionLabel = computed(() => props.initialTemplate?.version || '1.0')

const nextVersionLabel = computed(() => {
  const v = currentVersionLabel.value
  // Simple version increment logic
  // If integer "3" -> "4"
  // If dot separated "1.2" -> "1.3"
  const parts = v.split('.')
  const last = parts.pop()
  if (last && /^\d+$/.test(last)) {
    parts.push(String(parseInt(last, 10) + 1))
    return parts.join('.')
  }
  return v + '.1' // Fallback
})

async function confirmSave(): Promise<void> {
  // Mark form as touched to show validation errors
  formTouched.value = true

  // Validate before proceeding - scroll to name field if missing
  if (!templateName.value.trim() || !deviceCode.value) {
    // Scroll to top of dialog and highlight name field
    await nextTick()
    const nameInput = document.querySelector('[data-template-name-input]') as HTMLElement
    if (nameInput) {
      nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' })
      nameInput.classList.add('validation-error-highlight')
      setTimeout(() => nameInput.classList.remove('validation-error-highlight'), 2000)
    }
    return
  }
  // Block save if name has error (duplicates, empty, etc.)
  if (nameError.value) {
    return
  }
  // Allow save if we have either regular blocks OR series
  if (!pickedBlocks.value.length && !seriesFieldRows.value.length) return

  // If operation is 'edit', ask for version info
  if (props.operation === 'edit') {
    changeDescription.value = generateChangeDescription()
    showSaveVersionDialog.value = true
  } else {
    // Create mode - save directly
    await doFinalSave()
  }
}

async function submitNewVersion() {
  await doFinalSave(changeDescription.value, 'minor')
  showSaveVersionDialog.value = false
}

async function doFinalSave(description?: string, versionType?: 'minor' | 'major'): Promise<void> {
  // Build regular table blocks
  const blocks = pickedBlocks.value.map((pb, bi) => {
    const seen = new Set<string>()
    const fields: Omit<FieldRow, 'id'>[] = []
    let ord = 1
    for (const f of pb.fieldRows) {
      const nm = (f.name ?? '').trim()
      if (!nm) continue
      const key = nm.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      fields.push({ orderIndex: ord++, type: f.type, required: !!f.required, name: nm })
    }
    if (!fields.length) {
      fields.push({ orderIndex: 1, type: 'text', required: false, name: 'Pole 1' })
    }
    return {
      blockIndex: bi + 1,
      kind: 'table' as const,
      title: pb.title.trim() || `Tabulka hodnot ${bi + 1}`,
      fields
    }
  })

  // Build series block if exists
  if (seriesFieldRows.value.length) {
    const seriesSeen = new Set<string>()
    const seriesFields: Omit<FieldRow, 'id'>[] = []
    let ord = 1
    for (const f of seriesFieldRows.value) {
      const nm = (f.name ?? '').trim()
      if (!nm) continue
      const key = nm.toLowerCase()
      if (seriesSeen.has(key)) continue
      seriesSeen.add(key)
      seriesFields.push({ orderIndex: ord++, type: f.type, required: !!f.required, name: nm })
    }
    if (seriesFields.length) {
      blocks.push({
        blockIndex: blocks.length + 1,
        kind: 'series' as const,
        title: seriesBlockTitle.value.trim() || 'Datová série',
        fields: seriesFields
      })
    }
  }

  const payload: WizardTemplatePayload = {
    deviceCode: normalizeDeviceCode(deviceCode.value),
    templateName: (templateName.value || '').trim() || 'Šablona',
    blocks,
    templateId: props.operation === 'edit' && props.initialTemplate
      ? props.initialTemplate.templateId
      : undefined,
    changeDescription: description,
    createVersionType: versionType
  }
  loading.value = true
  try {
    if (typeof props.onConfirm === 'function') {
      await props.onConfirm(payload)
    } else {
      emit('confirm', payload)
    }
    open.value = false
  } finally {
    loading.value = false
  }
}

/* ===== Keyboard shortcuts ===== */
function onKeydown(e: KeyboardEvent): void {
  if (!open.value) return
  const key = e.key.toLowerCase()
  const ctrl = e.ctrlKey || e.metaKey
  if (key === 'escape') { e.preventDefault(); cancel(); return }
  if (ctrl && key === 's') { e.preventDefault(); void confirmSave(); return }
  if (isEditableElement(e.target)) return
}
/* ===== Initialization / Watch ===== */
watch(open, async (isOpen) => {
  if (!isOpen) return
  // Reset ALL state when dialog opens
  loading.value = false
  formTouched.value = false
  pickedBlocks.value = []
  currentBlockIndex.value = 0
  mainHeader.value = []
  statsLines.value = []
  seriesHeader.value = []
  seriesDataLines.value = []
  seriesFieldRows.value = []
  selectedSeriesRows.value = new Set()
  lastSelectedSeriesIdx.value = null
  seriesBlockTitle.value = 'Datová série'
  rawText.value = ''
  showTextareaInput.value = false
  isDragging.value = false

  // ALWAYS start with clean name and device for 'create' operation
  // This ensures that clicking "New Template" after "Derive" gives a fresh form
  if (props.operation === 'create' && !props.deriveFrom) {
    templateName.value = ''
    deviceCode.value = null
  }

  // Handle template derivation (clone from existing)
  if (props.deriveFrom) {
    const source = props.deriveFrom
    // Generate versioned name
    templateName.value = generateDerivedName(source.name)
    deviceCode.value = source.deviceCode

    const incomingBlocks = source.blocks ?? []
    if (incomingBlocks.length > 0) {
      const tableBlocks = incomingBlocks.filter(b => b.kind !== 'series')
      pickedBlocks.value = tableBlocks.map(b => ({
        id: generateId(),
        title: b.title ?? `Tabulka hodnot ${b.blockIndex}`,
        fieldRows: (b.fields ?? []).map((f, fi) => ({
          id: generateFieldId(),
          orderIndex: fi + 1,
          name: f.name,
          required: !!f.required,
          type: f.type as FieldType
        }))
      }))
      const seriesBlocks = incomingBlocks.filter(b => b.kind === 'series')
      if (seriesBlocks.length > 0) {
        const seriesBlock = seriesBlocks[0]
        seriesBlockTitle.value = seriesBlock?.title ?? 'Datová série'
        seriesFieldRows.value = (seriesBlock?.fields ?? []).map((f, i) => ({
          id: generateFieldId(),
          orderIndex: i + 1,
          name: f.name,
          required: !!f.required,
          type: f.type as FieldType
        }))
      }
    } else if (source.fields?.length) {
      pickedBlocks.value = [{
        id: generateId(),
        title: 'Tabulka hodnot 1',
        fieldRows: source.fields.map((f, i) => ({
          id: generateFieldId(),
          orderIndex: i + 1,
          name: f.name,
          required: f.required,
          type: f.type
        }))
      }]
    }
    await nextTick()
    return // Skip normal edit/create logic
  }

  // Load template data if editing
  if (props.operation === 'edit' && props.initialTemplate) {
    templateName.value = props.initialTemplate.name
    deviceCode.value = props.initialTemplate.deviceCode
    const incomingBlocks = props.initialTemplate.blocks ?? []
    if (incomingBlocks.length > 0) {
      const tableBlocks = incomingBlocks.filter(b => {
        // Backend might not return 'kind' - detect series by title
        const isSeries = b.kind === 'series' ||
          (b.title?.toLowerCase().includes('série')) ||
          (b.title?.toLowerCase().includes('series'))
        return !isSeries
      })
      pickedBlocks.value = tableBlocks.map(b => ({
        id: generateId(),
        title: b.title ?? `Tabulka hodnot ${b.blockIndex}`,
        fieldRows: (b.fields ?? []).map((f, fi) => ({
          id: generateFieldId(),
          orderIndex: fi + 1,
          name: f.name,
          required: !!f.required,
          type: f.type as FieldType
        }))
      }))
      // Detect series blocks by kind OR by title containing 'série/series'
      const seriesBlocks = incomingBlocks.filter(b => {
        return b.kind === 'series' ||
          (b.title?.toLowerCase().includes('série')) ||
          (b.title?.toLowerCase().includes('series'))
      })
      if (seriesBlocks.length > 0) {
        const seriesBlock = seriesBlocks[0]
        seriesBlockTitle.value = seriesBlock.title ?? 'Datová série'
        seriesFieldRows.value = (seriesBlock.fields ?? []).map((f, i) => ({
          id: generateFieldId(),
          orderIndex: i + 1,
          name: f.name,
          required: !!f.required,
          type: f.type as FieldType
        }))
      }
    } else if (props.initialTemplate.fields?.length) {
      pickedBlocks.value = [{
        id: generateId(),
        title: 'Tabulka hodnot 1',
        fieldRows: props.initialTemplate.fields.map((f, i) => ({
          id: generateFieldId(),
          orderIndex: i + 1,
          name: f.name,
          required: f.required,
          type: f.type
        }))
      }]
    }
  } else {
    templateName.value = props.initialTemplate?.name || ''
    deviceCode.value = props.initialTemplate?.deviceCode || null
  }
  await nextTick()
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
<style scoped>
.preview-header { font-weight: 600; }
.picked-block {
  border: 1px solid #ececec;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
  margin-bottom: 12px;
}

/* Draggable field table styles */
.field-table-wrapper {
  border-radius: 4px;
  overflow: hidden;
}

.field-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.field-table th,
.field-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.field-table th {
  background: #f5f5f5;
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(0, 0, 0, 0.6);
}

.field-row {
  transition: background-color 0.15s, opacity 0.2s;
  cursor: grab;
}

.field-row:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}

.field-row.is-dragging {
  opacity: 0.4;
  background: rgba(var(--v-theme-primary), 0.15);
}

.field-row.drag-over {
  background: rgba(var(--v-theme-primary), 0.2);
  box-shadow: inset 0 2px 0 0 rgb(var(--v-theme-primary));
}

.field-row:active {
  cursor: grabbing;
}

.ghost-field {
  opacity: 0.4;
  background: rgba(var(--v-theme-primary), 0.15);
}

.field-drag-handle {
  user-select: none;
}

.field-drag-handle:hover {
  color: rgb(var(--v-theme-primary));
}

/* Series block styling */
.series-block .block-card {
  border: 1px solid rgba(103, 58, 183, 0.3);
  border-radius: 8px;
  padding: 16px;
  background: rgba(103, 58, 183, 0.04);
}

.series-field-row {
  cursor: pointer;
}

.series-field-row.selected {
  background: rgba(103, 58, 183, 0.15) !important;
  outline: 2px solid rgba(103, 58, 183, 0.5);
  outline-offset: -2px;
}

/* Dropzone styling */
.dropzone {
  border: 2px dashed rgba(var(--v-theme-primary), 0.4);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  transition: all 0.2s ease;
  background: rgba(var(--v-theme-primary), 0.02);
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dropzone:hover {
  border-color: rgba(var(--v-theme-primary), 0.6);
  background: rgba(var(--v-theme-primary), 0.04);
}

.dropzone-active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  border-style: solid;
}

.dropzone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

/* Compact dropzone when file is loaded */
.dropzone.dropzone-compact {
  min-height: 0;
  padding: 0;
  border: none;
  background: transparent;
}

/* Import toolbar styling */
.import-toolbar {
  flex-wrap: wrap;
}

.data-preview {
  width: 100%;
}

.blocks-section {
  margin-top: 16px;
}

/* Import section styling (non-sticky) */
.import-section {
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0,0,0,0.08);
}

/* ═══════════════════════════════════════════════════════════════ */
/* IMPORT BOX STYLES                                               */
/* ═══════════════════════════════════════════════════════════════ */

.import-result-box {
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  padding: 16px;
  margin-top: 12px;
  background: #fafafa;
  width: 100%;
}

/* Parse Status Bar */
.parse-status-bar {
  padding: 12px 16px;
  border-radius: 8px;
  margin: -16px -16px 0 -16px;
  border-bottom: 1px solid rgba(0,0,0,0.08);
}

.parse-status-bar.status-success {
  background: linear-gradient(135deg, rgba(76, 175, 80, 0.08) 0%, rgba(76, 175, 80, 0.02) 100%);
}

.parse-status-bar.status-partial {
  background: linear-gradient(135deg, rgba(255, 152, 0, 0.1) 0%, rgba(255, 152, 0, 0.03) 100%);
}

.parse-status-bar.status-fail {
  background: linear-gradient(135deg, rgba(244, 67, 54, 0.1) 0%, rgba(244, 67, 54, 0.03) 100%);
}

.status-title {
  font-weight: 600;
  font-size: 0.95rem;
}

.status-subtitle {
  font-size: 0.8rem;
  margin-top: 4px;
  padding-left: 28px;
}

/* Action Bar */
.action-bar {
  border-bottom: 1px solid rgba(0,0,0,0.06);
  margin: 0 -16px;
  padding-left: 16px;
  padding-right: 16px;
}

/* Parse Summary */
.parse-summary {
  padding: 12px 0;
}

/* Preview Panel */
.preview-panel {
  background: white;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 12px;
}

.preview-table-container {
  max-height: 400px;
  overflow: auto;
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.preview-th {
  background: #f5f5f5;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid #e0e0e0;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background 0.15s ease;
}

.preview-th:hover {
  background: #e3f2fd;
}

.preview-th.highlighted {
  background: #bbdefb !important;
  box-shadow: inset 0 -3px 0 #1976d2;
}

.preview-td {
  padding: 6px 10px;
  border-bottom: 1px solid #eee;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-td.highlighted {
  background: rgba(25, 118, 210, 0.08);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Field highlight flash animation */
.field-highlight-flash {
  animation: field-flash 2s ease-out;
}

@keyframes field-flash {
  0% {
    background-color: rgba(25, 118, 210, 0.3);
    box-shadow: 0 0 8px rgba(25, 118, 210, 0.5);
  }
  50% {
    background-color: rgba(25, 118, 210, 0.15);
    box-shadow: 0 0 4px rgba(25, 118, 210, 0.3);
  }
  100% {
    background-color: transparent;
    box-shadow: none;
  }
}

/* Parse summary details styling */
.parse-summary-details summary {
  cursor: pointer;
  user-select: none;
}

.parse-summary-details summary:hover {
  color: rgb(var(--v-theme-primary));
}

/* Row number column styles */
.row-num-th,
.row-num-td {
  padding: 4px 8px;
  text-align: right;
  color: #999;
  font-size: 0.75rem;
  background: #fafafa;
  border-right: 1px solid #e0e0e0;
  min-width: 40px;
}

/* Row designation styles */
.preview-row {
  cursor: default;
  transition: background 0.15s ease;
}

.preview-row.is-selectable {
  cursor: pointer;
}

.preview-row.is-selectable:hover {
  background: rgba(0, 0, 0, 0.06);
}

.preview-row.row-header {
  background: rgba(255, 152, 0, 0.15);
  border-left: 3px solid #ff9800;
}

.preview-row.row-header .row-num-td {
  background: rgba(255, 152, 0, 0.25);
  color: #e65100;
  font-weight: 600;
}

.preview-row.row-units {
  background: rgba(156, 39, 176, 0.1);
  border-left: 3px solid #9c27b0;
}

.preview-row.row-units .row-num-td {
  background: rgba(156, 39, 176, 0.2);
  color: #6a1b9a;
  font-weight: 600;
}

.preview-row.row-data {
  background: rgba(33, 150, 243, 0.05);
  border-left: 3px solid #2196f3;
}

.preview-row.row-data .row-num-td {
  background: rgba(33, 150, 243, 0.1);
  color: #1565c0;
}

/* Validation error highlight animation */
.validation-error-highlight {
  animation: validation-pulse 0.5s ease-out 2;
}

@keyframes validation-pulse {
  0%, 100% {
    background-color: transparent;
    box-shadow: none;
  }
  50% {
    background-color: rgba(244, 67, 54, 0.15);
    box-shadow: 0 0 12px rgba(244, 67, 54, 0.4);
  }
}

/* Main Tabs Navigation */
.main-tabs {
  display: flex;
  gap: 0;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  padding: 0 0 0 0;
  margin: 0 -16px;
  padding: 0 16px;
}
.main-tab {
  padding: 14px 20px;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.15s;
}
.main-tab:hover {
  color: #374151;
  background: #f3f4f6;
}
.main-tab-active {
  background: white;
  color: #7c3aed;
  font-weight: 600;
  border-bottom: 2px solid #7c3aed;
}
.tab-badge {
  background: #ddd6fe;
  color: #7c3aed;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 700;
}

/* Mappings Panel */
.mappings-panel {
  padding: 8px 0;
}
.mappings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.mappings-title {
  font-size: 16px;
  font-weight: 600;
  color: #374151;
  display: flex;
  align-items: center;
  gap: 10px;
}
.mappings-subtitle {
  font-size: 13px;
  color: #6b7280;
  margin-top: 4px;
}
.mappings-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.stat-card {
  border-radius: 10px;
  padding: 14px 16px;
}
.stat-purple {
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
}
.stat-green {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
}
.stat-yellow {
  background: #fef3c7;
  border: 1px solid #fcd34d;
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
}
.stat-purple .stat-value { color: #7c3aed; }
.stat-green .stat-value { color: #059669; }
.stat-yellow .stat-value { color: #d97706; }
.stat-label {
  font-size: 12px;
  color: #6b7280;
}
.mappings-list {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 20px;
}
.mapping-row {
  padding: 10px 16px;
  border-bottom: 1px solid #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: white;
}
.mapping-row:last-child {
  border-bottom: none;
}
.mapping-content {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}
.mapping-icon {
  width: 24px;
  height: 24px;
  background: #f3f4f6;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mapping-arrow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.source-col {
  font-size: 13px;
  color: #374151;
  font-family: monospace;
  background: #f9fafb;
  padding: 2px 8px;
  border-radius: 4px;
}
.target-field {
  font-size: 13px;
  font-weight: 600;
  color: #7c3aed;
}
.mapping-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.usage-badge {
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 10px;
}
.mappings-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}
.empty-title {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 600;
  color: #374151;
}
.empty-text {
  margin-top: 8px;
  font-size: 13px;
  color: #6b7280;
  max-width: 320px;
}
.mappings-info {
  margin-top: 20px;
  padding: 16px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  display: flex;
  align-items: flex-start;
}
.info-title {
  font-size: 13px;
  font-weight: 600;
  color: #1e40af;
}
.info-text {
  font-size: 12px;
  color: #3b82f6;
  margin-top: 4px;
}

/* Mappings Tab Redesign */
.mappings-tab {
  padding: 8px 0;
}
.mappings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}
.mappings-title {
  font-size: 16px;
  font-weight: 600;
  color: #374151;
  display: flex;
  align-items: center;
  gap: 10px;
}
.mappings-subtitle {
  font-size: 13px;
  color: #6b7280;
  margin-top: 4px;
}
.mappings-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.stat-card {
  border-radius: 10px;
  padding: 14px 16px;
}
.stat-purple {
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
}
.stat-green {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
}
.stat-yellow {
  background: #fef3c7;
  border: 1px solid #fcd34d;
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
}
.stat-purple .stat-value { color: #7c3aed; }
.stat-green .stat-value { color: #059669; }
.stat-yellow .stat-value { color: #d97706; }
.stat-label {
  font-size: 12px;
  color: #6b7280;
}
.mapping-groups-container {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  max-height: 400px;
  overflow-y: auto;
}
.group-header-styled {
  background: #f9fafb;
  padding: 10px 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
}
.group-icon-styled {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.group-name {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}
.group-count {
  font-size: 11px;
  color: #9ca3af;
}
.group-aliases {
  background: white;
}
.alias-row-styled {
  padding: 10px 16px;
  border-bottom: 1px solid #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.alias-row-styled:last-child {
  border-bottom: none;
}
.alias-file-icon {
  width: 24px;
  height: 24px;
  background: #f3f4f6;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.alias-mapping {
  display: flex;
  align-items: center;
  gap: 8px;
}
.alias-source {
  font-size: 13px;
  color: #374151;
  font-family: monospace;
  background: #f9fafb;
  padding: 2px 8px;
  border-radius: 4px;
}
.alias-target {
  font-size: 13px;
  font-weight: 600;
  color: #7c3aed;
}
.alias-count {
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 10px;
}
.mappings-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}
.mappings-info-box {
  margin-top: 20px;
  padding: 16px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.info-box-title {
  font-size: 13px;
  font-weight: 600;
  color: #1e40af;
}
.info-box-text {
  font-size: 12px;
  color: #3b82f6;
  margin-top: 4px;
}
.alias-add-row {
  padding: 8px 16px;
  background: #f0fdf4;
  border-top: 1px dashed #86efac;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.alias-input {
  max-width: 300px;
}

/* Focus highlight animation for template name input */
.focus-highlight-animation {
  animation: focusPulse 0.6s ease-out;
}

@keyframes focusPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(var(--v-theme-primary), 0.2);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0);
  }
}

/* Also apply to the parent text-field wrapper for better visibility */
.validation-warn :deep(input) {
  border-color: #f59e0b !important;
}

/* ===== Versions Tab Styles ===== */
.versions-tab {
  padding: 16px 0;
}

.versions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.versions-title {
  display: flex;
  align-items: center;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.versions-subtitle {
  font-size: 12px;
  margin-top: 4px;
  margin-left: 30px;
}

.versions-list {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #f3f4f6;
  transition: background 0.15s;
}

.version-row:last-child {
  border-bottom: none;
}

.version-row:hover {
  background: #f9fafb;
}

.version-row-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.version-row-right {
  flex-shrink: 0;
}

.version-badge-active {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: #10b981;
  background: #d1fae5;
  padding: 2px 8px;
  border-radius: 4px;
}

.version-date {
  font-size: 13px;
}

.version-desc {
  font-size: 12px;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 250px;
}

.versions-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  background: #f9fafb;
  border-radius: 8px;
}
</style>


