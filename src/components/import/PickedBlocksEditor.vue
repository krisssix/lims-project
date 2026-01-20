<template>
  <div>
    <div class="preview-header mb-2">
      Šablona se skládá z bloků
    </div>

    <div
      v-for="(pb, pbi) in localPicked"
      :key="pb.id"
      class="picked-block"
    >
      <div class="d-flex align-center ga-2 mb-2">
        <div class="text-subtitle-2">
          {{ pbi + 1 }}. {{ pb.title }}
        </div>
        <v-chip
          size="small"
          class="ml-1"
          color="grey"
          variant="tonal"
        >
          zdroj #{{ pb.sourceIndex + 1 }}
        </v-chip>
        <v-spacer />
        <v-btn
          icon="mdi-chevron-up"
          size="small"
          variant="text"
          :disabled="pbi===0"
          @click="movePickedBlock(pb.id, -1)"
        />
        <v-btn
          icon="mdi-chevron-down"
          size="small"
          variant="text"
          :disabled="pbi===localPicked.length-1"
          @click="movePickedBlock(pb.id, 1)"
        />
        <v-btn
          icon="mdi-delete-outline"
          size="small"
          color="error"
          variant="text"
          @click="removePickedBlock(pb.id)"
        />
      </div>

      <!-- volby tabulky a náhled (preview) -->
      <div
        v-if="isTable(pb)"
        class="mb-2"
      >
        <div class="d-flex align-center ga-3 mb-2">
          <v-switch
            v-model="pb.headerOverrideEnabled"
            label="Vybrat jinou hlavičku"
            density="comfortable"
            @update:model-value="() => updatePicked(pb.id)"
          />
          <v-select
            v-if="pb.headerOverrideEnabled"
            v-model="pb.headerOverrideIndex"
            :items="headerOverrideOptionsFor(pb)"
            item-title="label"
            item-value="value"
            label="Řádek pro hlavičku"
            density="comfortable"
            variant="outlined"
            hide-details
            style="min-width: 260px"
            @update:model-value="() => updatePicked(pb.id)"
          />
          <v-switch
            v-model="pb.includeRepeatSets"
            label="Rozbalit opakované sady"
            density="comfortable"
            @update:model-value="() => updatePicked(pb.id)"
          />
        </div>

        <div class="preview-sample">
          <div style="font-weight:700; margin-bottom:6px;">
            Hlavičky
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <span
              v-for="(h, idx) in effectiveHeadersFor(pb)"
              :key="`eh-${pb.id}-${idx}`"
              class="chip"
            >{{ h }}</span>
          </div>
          <div style="margin-top:8px;">
            <div
              v-for="(r, ri) in tableRows(pb).slice(0, 6)"
              :key="`row-${pb.id}-${ri}`"
              class="mono-line"
            >
              {{ r.join(' | ') }}
            </div>
          </div>
        </div>
      </div>

      <!-- náhled kv (key-value) -->
      <div
        v-else-if="isKv(pb)"
        class="mb-2"
      >
        <div class="preview-header mb-1">
          Metadata (key:value)
        </div>
        <v-list density="compact">
          <v-list-item
            v-for="(p, i) in kvPairs(pb)"
            :key="`kv-${pb.id}-${i}`"
          >
            <v-list-item-title><strong>{{ p.key }}</strong>: {{ p.value }}</v-list-item-title>
          </v-list-item>
        </v-list>
        <div class="d-flex ga-2">
          <v-btn
            color="primary"
            variant="tonal"
            @click="addMetadataAsFieldsTo(pb.id)"
          >
            PŘIDAT METADATA JAKO POLE
          </v-btn>
        </div>
      </div>

      <!-- statistiky (stats) -->
      <div
        v-else-if="isStats(pb)"
        class="mb-2"
      >
        <div class="preview-header mb-1">
          Statistické řádky
        </div>
        <div class="mono-block">
          <div
            v-for="(l, i) in statsLines(pb)"
            :key="`st-${pb.id}-${i}`"
            class="mono-line"
          >
            {{ l }}
          </div>
        </div>
      </div>

      <!-- série (series) -->
      <div
        v-else-if="isSeries(pb)"
        class="mb-2"
      >
        <div class="preview-header mb-1">
          Řada hodnot
        </div>
        <div class="mono-block">
          <div>{{ seriesHeader(pb) }}</div>
          <div class="mono-line">
            {{ seriesValues(pb).slice(0, 40).join(', ') }}{{ seriesValues(pb).length > 40 ? ' …' : '' }}
          </div>
        </div>
      </div>


      <!-- tabulka polí -->
      <div
        v-if="pb.fieldRows.length"
        class="mb-4"
      >
        <v-data-table
          :items="pb.fieldRows"
          :headers="tableHeaders"
          class="elevation-1"
          density="comfortable"
          hide-default-footer
          item-key="orderIndex"
        >
          <template #[`item.orderIndex`]="{ item }">
            <span class="text-body-2">{{ item.orderIndex }}</span>
          </template>

          <template #[`item.type`]="{ item }">
            <v-select
              v-model="item.type"
              :items="typeOptions"
              item-title="label"
              item-value="value"
              density="compact"
              hide-details
              variant="plain"
            />
          </template>

          <template #[`item.required`]="{ item }">
            <v-checkbox
              v-model="item.required"
              density="compact"
              hide-details
            />
          </template>

          <template #[`item.name`]="{ item }">
            <v-text-field
              v-model="item.name"
              density="compact"
              hide-details
              variant="plain"
              :placeholder="`Pole ${item.orderIndex}`"
            />
          </template>

          <template #[`item.actions`]="{ index }">
            <div class="d-flex ga-1">
              <v-btn
                icon="mdi-chevron-up"
                size="small"
                variant="text"
                @click="moveFieldIn(index, -1)"
              />
              <v-btn
                icon="mdi-chevron-down"
                size="small"
                variant="text"
                @click="moveFieldIn(index, 1)"
              />
              <v-btn
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                color="error"
                @click="removeFieldIn(index)"
              />
            </div>
          </template>
        </v-data-table>
      </div>
    </div>

    <div class="d-flex justify-end ga-2">
      <v-btn
        variant="text"
        @click="$emit('back')"
      >
        Zpět
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        class="ml-3"
        :disabled="!hasAnyFields"
        @click="$emit('next')"
      >
        Pokračovat
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { buildRepeatMetaFromHeaders, inferFieldType as inferFieldTypeFromParser, type TableBlock, type StatsBlock, type SeriesBlock, type KvBlock, type ColumnType } from '@/utils/importParsing'

// typoví strážci (type guards) pro šablonu
function blkAt(pb: PickedBlock){ return props.blocks[pb.sourceIndex] }
function isTable(pb: PickedBlock): boolean { return blkAt(pb)?.kind === 'table' }
function isStats(pb: PickedBlock): boolean { return blkAt(pb)?.kind === 'stats' }
function isSeries(pb: PickedBlock): boolean { return blkAt(pb)?.kind === 'series' }
function isKv(pb: PickedBlock): boolean { return blkAt(pb)?.kind === 'kv' }

// bezpečný přístup k datům bloků (safe access)
function tableRows(pb: PickedBlock): string[][] {
  const b = blkAt(pb)
  return b && b.kind === 'table' ? (b as TableBlock).rows : []
}
function kvPairs(pb: PickedBlock){ const b = blkAt(pb); return b && b.kind==='kv' ? (b as KvBlock).pairs : [] }
function statsLines(pb: PickedBlock){ const b = blkAt(pb); return b && b.kind==='stats' ? (b as StatsBlock).lines : [] }
function seriesHeader(pb: PickedBlock){ const b = blkAt(pb); return b && b.kind==='series' ? (b as SeriesBlock).header : '' }
function seriesValues(pb: PickedBlock){ const b = blkAt(pb); return b && b.kind==='series' ? (b as SeriesBlock).values : [] }

// přidá kv páry jako pole (převod metadat na pole šablony)
function addMetadataAsFieldsTo(id: string){
  const pb = localPicked.value.find(x => x.id === id); if (!pb) return
  const b = blkAt(pb); if (!b || b.kind !== 'kv') return
  const base = pb.fieldRows.length
  const rows: FieldRow[] = (b as KvBlock).pairs.map((p,i) => ({
    orderIndex: base + i + 1,
    name: p.key,
    required: false,
    type: 'text',
  }))
  pb.fieldRows = [...pb.fieldRows, ...rows].map((f,i)=>({ ...f, orderIndex:i+1 }))
  emit('update', localPicked.value)
}


type FieldType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
type FieldRow = { orderIndex: number; type: FieldType; required: boolean; name: string }
type PickedBlock = {
  id: string
  sourceIndex: number
  kind: 'table' | 'stats' | 'series' | 'kv'
  title: string
  includeRepeatSets: boolean
  headerOverrideEnabled: boolean
  headerOverrideIndex: number | null
  fieldRows: FieldRow[]
}

const props = defineProps<{
  blocks: Array<TableBlock|StatsBlock|SeriesBlock|KvBlock>
  pickedBlocks: PickedBlock[]
}>()
const emit = defineEmits<{ (e:'update', v:PickedBlock[]):void; (e:'back'):void; (e:'next'):void }>()

const localPicked = ref<PickedBlock[]>(JSON.parse(JSON.stringify(props.pickedBlocks || [])))
const typeOptions = [
  { label:'Float', value:'float' },{ label:'Integer', value:'int' },{ label:'Text', value:'text' },
  { label:'Soubor', value:'file' },{ label:'Boolean', value:'bool' },{ label:'Date', value:'date' },
]
const tableHeaders = [
  { title:'Poř.', key:'orderIndex', sortable:false, width:70 },
  { title:'Typ', key:'type', sortable:false, width:160 },
  { title:'Povinné', key:'required', sortable:false, width:120 },
  { title:'Název pole', key:'name', sortable:false },
  { title:'', key:'actions', sortable:false, width:112 },
]
const hasAnyFields = computed(()=> localPicked.value.some(pb => pb.fieldRows?.length>0))

/* pomocné funkce (helpers) */
function toFieldType(t: ColumnType): FieldType {
  if (t === 'float' || t === 'int' || t === 'text' || t === 'file' || t === 'bool' || t === 'date') return t
  return 'text'
}
function inferFieldTypeFromHeader(header: string): ColumnType {
  return inferFieldTypeFromParser(header)
}

function headerOverrideOptionsFor(pb: PickedBlock) {
  const blk = props.blocks[pb.sourceIndex]
  if (!blk || blk.kind !== 'table') return []
  const rows = (blk as TableBlock).rows
  const items: Array<{ label: string; value: number | null }> = [{ label:'Rozpoznaná hlavička', value:null }]
  for (let i=0; i<Math.min(8, rows.length); i++){
    const sample = (rows[i] ?? []).slice(0, 6).join(' | ')
    items.push({ label:`Řádek ${i+1}: ${sample}`, value:i })
  }
  return items
}
function effectiveHeadersFor(pb: PickedBlock): string[] {
  const blk = props.blocks[pb.sourceIndex]
  if (!blk || blk.kind !== 'table') return []
  if (pb.headerOverrideEnabled && pb.headerOverrideIndex != null){
    return ((blk as TableBlock).rows[pb.headerOverrideIndex] ?? []).map(s => (s ?? '').trim())
  }
  return (blk as TableBlock).headersRaw
}

function buildFieldsForBlock(blk: TableBlock | StatsBlock | SeriesBlock | KvBlock, opts:{ includeRepeatSets:boolean; headerOverrideEnabled:boolean; headerOverrideIndex:number|null }): FieldRow[] {
  let headerNames: string[] = []
  if (blk.kind === 'table'){
    const tbl = blk as TableBlock
    const baseHeaders = opts.headerOverrideEnabled && opts.headerOverrideIndex != null ? (tbl.rows[opts.headerOverrideIndex] ?? []) : tbl.headersRaw
    const headers = baseHeaders.slice()
    if (!opts.includeRepeatSets){
      const seen = new Set<string>()
      const baseOf = (h: string) => h.trim().replace(/\s+\d+$/u, '')
      const out: string[] = []
      for (const h of headers){
        const base = baseOf(h) || h
        if (seen.has(base)) continue
        seen.add(base)
        out.push(base || h)
      }
      headerNames = out
    } else {
      const rep = buildRepeatMetaFromHeaders(headers)
      if (!rep.repeatDetected) headerNames = headers
      else {
        const counters: Record<string, number> = {}
        const baseOf = (h: string) => h.trim().replace(/\s+\d+$/u, '')
        headerNames = headers.map(h => {
          const base = baseOf(h) || h
          counters[base] = (counters[base] ?? 0) + 1
          const idx = counters[base]
          return `${base} ${idx}`
        })
      }
    }
  } else if (blk.kind === 'series'){
    headerNames = [blk.header?.trim() || 'Value']
  } else if (blk.kind === 'kv'){
    headerNames = []
  } else {
    headerNames = ['Value']
  }

  return headerNames.map((h,i)=>({ orderIndex:i+1, name: h || `Col ${i+1}`, required:false, type: toFieldType(inferFieldTypeFromHeader(h)) }))
}

/* operace s vybranými bloky */
function updatePicked(id:string){
  const pb = localPicked.value.find(x => x.id === id); if (!pb) return
  const src = props.blocks[pb.sourceIndex]; if (!src) return
  pb.fieldRows = buildFieldsForBlock(src, {
    includeRepeatSets: pb.includeRepeatSets,
    headerOverrideEnabled: pb.headerOverrideEnabled,
    headerOverrideIndex: pb.headerOverrideIndex
  }).map((f,i)=>({ ...f, orderIndex:i+1 }))
  emit('update', localPicked.value)
}

function removeFieldIn(index:number){
  const pb = localPicked.value[0]; if(!pb) return
  if (index<0 || index>=pb.fieldRows.length) return
  pb.fieldRows.splice(index,1)
  pb.fieldRows = pb.fieldRows.map((f,i)=>({ ...f, orderIndex:i+1 }))
  emit('update', localPicked.value)
}
function moveFieldIn(index:number, delta:number){
  const pb = localPicked.value[0]; if(!pb) return
  const target = index + delta
  if (index<0 || index>=pb.fieldRows.length) return
  if (target<0 || target>=pb.fieldRows.length) return
  const arr = pb.fieldRows.slice()
  const [row] = arr.splice(index,1); arr.splice(target,0,row)
  pb.fieldRows = arr.map((f,i)=>({ ...f, orderIndex:i+1 }))
  emit('update', localPicked.value)
}
function removePickedBlock(id:string){
  localPicked.value = localPicked.value.filter(x => x.id !== id)
  emit('update', localPicked.value)
}
function movePickedBlock(id:string, delta:number){
  const i = localPicked.value.findIndex(x => x.id === id)
  const j = i + delta
  if (i<0 || j<0 || j>=localPicked.value.length) return
  const cp = localPicked.value.slice()
  const [row] = cp.splice(i,1); cp.splice(j,0,row)
  localPicked.value = cp
  emit('update', localPicked.value)
}
</script>

<style scoped>
.preview-header { font-weight: 600; }
.mono-block { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; background:#fff; padding:8px; border:1px solid #e3e3e3; border-radius:6px; max-height:160px; overflow:auto; }
.mono-line { font-family: inherit; white-space: nowrap; font-size: 12px; }
.chip { display:inline-block; padding:2px 6px; border-radius:12px; background:#f2f2f2; margin-right:6px; margin-bottom:6px; font-size:12px; }
.picked-block { border:1px solid #ececec; border-radius:8px; padding:10px; background:#fff; margin-bottom:12px; }
.preview-sample { max-height:220px; overflow:auto; border:1px solid #ececec; padding:8px; border-radius:6px; background:#fff }
</style>
