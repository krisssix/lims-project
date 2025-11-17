<template>
  <Dialog
    v-model:is-open="open"
    width="1100px"
    :hide-footer="true"
  >
    <template #content>
      <div
        class="pa-4"
        @keydown="onKeydown"
      >
        <div class="d-flex align-center mb-4">
          <div class="text-h6">
            Import šablony
          </div>
          <v-spacer />
          <v-chip
            v-if="fileInfo"
            size="small"
            variant="tonal"
          >
            {{ fileInfo.name }} • {{ prettyBytes(fileInfo.size) }}
          </v-chip>
        </div>

        <v-stepper
          v-model="step"
          flat
        >
          <v-stepper-header>
            <v-stepper-item
              :value="1"
              title="Zdroj"
            />
            <v-divider />
            <v-stepper-item
              :value="2"
              title="Oddělovač"
            />
            <v-divider />
            <v-stepper-item
              :value="3"
              title="Hlavičky"
            />
            <v-divider />
            <v-stepper-item
              :value="4"
              title="Bloky"
            />
            <v-divider />
            <v-stepper-item
              :value="5"
              title="Rekapitulace"
            />
          </v-stepper-header>

          <v-stepper-window class="mt-3">
            <!-- KROK 1: Zdroj -->
            <v-stepper-window-item :value="1">
              <div class="d-flex align-center ga-3 mb-4">
                <v-text-field
                  v-model="templateName"
                  label="Název šablony"
                  variant="outlined"
                  hide-details
                  class="flex-grow-1"
                />
                <v-select
                  v-model="deviceCode"
                  :items="devices"
                  item-title="name"
                  item-value="id"
                  label="Přístroj"
                  variant="outlined"
                  hide-details
                  style="max-width:260px"
                >
                  <template #selection="{ item }">
                    <v-chip
                      size="small"
                      :color="item.raw?.color"
                      text-color="white"
                    >
                      {{ item.raw?.name }}
                    </v-chip>
                  </template>
                </v-select>
              </div>

              <div class="d-flex align-center ga-3 mb-3">
                <v-btn
                  variant="tonal"
                  color="primary"
                  title="Vložit ze schránky (Ctrl+V)"
                  @click="pasteFromClipboard"
                >
                  VLOŽIT ZE SCHRÁNKY
                </v-btn>

                <input
                  ref="fileInput"
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  style="display:none"
                  @change="onFilePicked"
                >
                <v-btn
                  variant="tonal"
                  color="primary"
                  title="Vybrat soubor (Ctrl+O)"
                  @click="triggerFilePick"
                >
                  VYBRAT SOUBOR
                </v-btn>

                <v-spacer />
                <v-switch
                  v-model="largeFileMode"
                  color="primary"
                  inset
                  label="Velký soubor (rychlý náhled)"
                  hide-details
                />
              </div>

              <v-textarea
                v-model="rawText"
                data-clipboard-input
                label="Schránka / obsah CSV"
                :rows="8"
                variant="outlined"
                density="comfortable"
                hide-details
                class="mb-3 clipboard-textarea"
              />

              <div class="d-flex justify-end">
                <v-btn
                  color="primary"
                  :disabled="!hasAnyInput"
                  @click="goStep(2)"
                >
                  Pokračovat
                </v-btn>
              </div>
            </v-stepper-window-item>

            <!-- KROK 2: Oddělovač -->
            <v-stepper-window-item :value="2">
              <div class="d-flex align-center ga-3 mb-3">
                <v-select
                  v-model="delimiterOverrideModel"
                  :items="delimiterSelectItems"
                  item-title="label"
                  item-value="value"
                  :return-object="false"
                  label="Oddělovač"
                  variant="outlined"
                  hide-details
                  style="max-width: 240px"
                />
                <div class="text-body-2">
                  Doporučeno: <b>{{ recommendedDelimiterLabel }}</b>
                </div>
                <v-spacer />
                <v-text-field
                  v-model="headerRowIndexInput"
                  type="number"
                  min="1"
                  label="Řádek hlavičky (volitelně)"
                  variant="outlined"
                  hide-details
                  style="max-width:220px"
                />
              </div>

              <v-table
                density="compact"
                class="mono-block mb-3"
                style="max-height:260px; overflow:auto"
              >
                <thead class="sticky">
                  <tr>
                    <th
                      v-for="(h, i) in previewHeaders"
                      :key="i"
                      class="mono-th"
                    >
                      {{ h }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(r, ri) in previewRows"
                    :key="ri"
                  >
                    <td
                      v-for="(c, ci) in r"
                      :key="ci"
                      style="white-space:nowrap"
                    >
                      {{ c }}
                    </td>
                  </tr>
                </tbody>
              </v-table>

              <div class="d-flex justify-end">
                <v-btn
                  variant="text"
                  @click="goStep(1)"
                >
                  Zpět
                </v-btn>
                <v-btn
                  color="primary"
                  @click="confirmDelimiterAndAnalyze"
                >
                  Pokračovat
                </v-btn>
              </div>
            </v-stepper-window-item>

            <!-- KROK 3: Hlavičky -->
            <v-stepper-window-item :value="3">
              <div class="d-flex align-center ga-2 mb-2">
                <v-text-field
                  v-model="columnFilter"
                  placeholder="Hledat sloupce…"
                  hide-details
                  density="comfortable"
                  variant="outlined"
                  style="max-width:280px"
                />
                <v-btn
                  size="small"
                  variant="text"
                  @click="toggleAll(true)"
                >
                  Vybrat vše
                </v-btn>
                <v-btn
                  size="small"
                  variant="text"
                  @click="toggleAll(false)"
                >
                  Zrušit výběr
                </v-btn>
                <v-btn
                  size="small"
                  variant="text"
                  @click="invertSelection"
                >
                  Invertovat
                </v-btn>
                <v-spacer />
                <v-btn
                  variant="tonal"
                  size="small"
                  :disabled="!deviceCode"
                  @click="saveSelectionPreset"
                >
                  Uložit preset pro přístroj
                </v-btn>
              </div>

              <v-data-table
                :headers="headerPickerCols"
                :items="headerPickerRowsFiltered"
                density="comfortable"
                :items-per-page="-1"
                hide-default-footer
                item-key="index"
                class="elevation-1"
              >
                <template #[`item.selected`]="{ item }">
                  <v-checkbox
                    v-model="item.selected"
                    density="compact"
                    hide-details
                  />
                </template>

                <template #[`item.name`]="{ item }">
                  <v-text-field
                    v-model="item.name"
                    variant="plain"
                    density="compact"
                    hide-details
                  />
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

                <template #[`item.actions`]="{ index }">
                  <div class="d-flex ga-1">
                    <v-btn
                      icon="mdi-chevron-up"
                      size="x-small"
                      variant="text"
                      @click="reorder(index, -1)"
                    />
                    <v-btn
                      icon="mdi-chevron-down"
                      size="x-small"
                      variant="text"
                      @click="reorder(index, +1)"
                    />
                  </div>
                </template>
              </v-data-table>

              <div class="d-flex justify-end mt-3">
                <v-btn
                  variant="text"
                  @click="goStep(2)"
                >
                  Zpět
                </v-btn>
                <v-btn
                  color="primary"
                  :disabled="!anySelected"
                  @click="applySelectionToBlocks"
                >
                  Pokračovat
                </v-btn>
              </div>
            </v-stepper-window-item>

            <!-- KROK 4: Bloky -->
            <v-stepper-window-item :value="4">
              <PickedBlocksEditor
                :blocks="blocks"
                :picked-blocks="pickedBlocks"
                @update="(pb) => pickedBlocks = pb"
                @back="goStep(3)"
                @next="goStep(5)"
              />
            </v-stepper-window-item>

            <!-- KROK 5: Rekapitulace -->
            <v-stepper-window-item :value="5">
              <v-alert
                type="info"
                variant="tonal"
                class="mb-3"
              >
                <div><b>Zařízení:</b> {{ deviceCode || '—' }}</div>
                <div><b>Název:</b> {{ templateName }}</div>
                <div><b>Počet polí:</b> {{ totalFields }}</div>
              </v-alert>

              <v-table
                density="compact"
                class="mb-4"
              >
                <thead><tr><th>#</th><th>Blok</th><th>Počet polí</th></tr></thead>
                <tbody>
                  <tr
                    v-for="(b, i) in pickedBlocks"
                    :key="b.id"
                  >
                    <td>{{ i + 1 }}</td>
                    <td>{{ b.title }}</td>
                    <td>{{ b.fieldRows.length }}</td>
                  </tr>
                </tbody>
              </v-table>

              <div class="d-flex justify-end">
                <v-btn
                  variant="text"
                  @click="goStep(4)"
                >
                  Zpět
                </v-btn>
                <v-btn
                  color="primary"
                  :disabled="!deviceCode || !pickedBlocks.length || !hasAnyFields"
                  :loading="loading"
                  @click="confirm"
                >
                  Vytvořit šablonu
                </v-btn>
              </div>
            </v-stepper-window-item>
          </v-stepper-window>
        </v-stepper>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import PickedBlocksEditor from './PickedBlocksEditor.vue'
import { type ParserOptions, type AnalyzeResult, type TableBlock, type StatsBlock, type SeriesBlock, type KvBlock } from '@/utils/importParsing'

type FieldType = 'float' | 'int' | 'text' | 'file' | 'bool' | 'date'
type FieldRow = { orderIndex: number; type: FieldType; required: boolean; name: string }
type PickedBlock = {
  id: string; sourceIndex: number; kind: 'table'|'stats'|'series'|'kv'; title: string;
  includeRepeatSets: boolean; headerOverrideEnabled: boolean; headerOverrideIndex: number | null;
  fieldRows: FieldRow[];
}
type TemplateBlockPayload = { kind: PickedBlock['kind']; title: string; fields: FieldRow[] }
type TemplatePayload = {
  deviceCode: string; templateName: string; blocks: TemplateBlockPayload[]; fields: FieldRow[]
}

const props = defineProps<{
  modelValue: boolean
  devices: { id: string; name: string; color?: string }[]
  onConfirm?: (p: TemplatePayload) => Promise<void> | void
}>()
const emit  = defineEmits<{ (e:'update:modelValue',v:boolean):void; (e:'confirm',p:TemplatePayload):void }>()
type HeaderPickRow = { index: number; selected: boolean; name: string; type: FieldType; required: boolean }


/* ---------- state ---------- */
const open = computed({ get:()=>props.modelValue, set:(v:boolean)=>emit('update:modelValue', v) })
const step = ref(1)

const deviceCode = ref('')
const templateName = ref('Nová šablona')
const rawText = ref('')

const largeFileMode = ref(true)
const fileInput = ref<HTMLInputElement|null>(null)
const fileInfo = ref<{name:string; size:number} | null>(null)

/* delimiter */
type DelimiterOverride = 'auto'|'tab'|'semicolon'|'comma'|'pipe'|'spaces'
const delimiterOverrideModel = ref<DelimiterOverride>('auto')
const delimiterSelectItems = [
  { label:'Auto', value:'auto' },{ label:'Tab', value:'tab' },{ label:'Středník ;', value:'semicolon' },
  { label:'Čárka ,', value:'comma' },{ label:'Svislítko |', value:'pipe' },{ label:'Více mezer', value:'spaces' },
]

/* preview step 2 */
const previewRows = ref<string[][]>([])
const previewHeaders = ref<string[]>([])
const headerRowIndexInput = ref<string>('') // volitelné, 1-based
const recommendedDelimiterLabel = computed(() => delimiterSelectItems.find(i=>i.value===delimiterOverrideModel.value)?.label ?? 'Auto')

/* analyzované bloky */
const blocks = ref<Array<TableBlock|StatsBlock|SeriesBlock|KvBlock>>([])
const pickedBlocks = ref<PickedBlock[]>([])
const loading = ref(false)

/* header picker (step 3) */
const headerPickerRows = ref<HeaderPickRow[]>([])
const columnFilter = ref('')
const typeOptions = [
  { label:'Float', value:'float' },{ label:'Integer', value:'int' },{ label:'Text', value:'text' },
  { label:'Soubor', value:'file' },{ label:'Boolean', value:'bool' },{ label:'Date', value:'date' },
]
const headerPickerCols = [
  { title:'', key:'selected', width:48, sortable:false },
  { title:'Poř.', key:'index', width:70 },
  { title:'Název', key:'name' },
  { title:'Typ', key:'type', width:160 },
  { title:'Povinné', key:'required', width:120 },
  { title:'', key:'actions', width:100, sortable:false }
]
const headerPickerRowsFiltered = computed(() => {
  const q = columnFilter.value.trim().toLowerCase()
  if (!q) return headerPickerRows.value
  return headerPickerRows.value.filter(r => r.name.toLowerCase().includes(q))
})
const anySelected = computed(() => headerPickerRows.value.some(r => r.selected))
const totalFields = computed(() => pickedBlocks.value.reduce((s,b)=>s + (b.fieldRows?.length||0), 0))

/* ---------- lifecycle ---------- */
watch(open, async (v) => {
  if (!v) return
  step.value = 1
  deviceCode.value = props.devices[0]?.id ?? ''
  templateName.value = 'Nová šablona'
  rawText.value = ''
  blocks.value = []
  pickedBlocks.value = []
  fileInfo.value = null
  delimiterOverrideModel.value = 'auto'
  await nextTick()
  document.querySelector<HTMLTextAreaElement>('[data-clipboard-input]')?.focus()
})

/* ---------- actions ---------- */
function goStep(n:number){ step.value = n }
const hasAnyInput = computed(()=> (rawText.value.trim().length>0) || !!fileInfo.value)

async function pasteFromClipboard(){
  try {
    const t = await navigator.clipboard.readText()
    rawText.value = t.replace(/\uFEFF/g,'').replace(/\r\n?/g,'\n').replace(/\u00A0/g,' ')
    makePreview()
  } catch {}
}
function triggerFilePick(){ fileInput.value?.click() }
async function onFilePicked(e: Event){
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]; if(!f) return
  fileInfo.value = { name:f.name, size:f.size }
  const buf = new Uint8Array(await f.arrayBuffer())
  rawText.value = new TextDecoder().decode(buf).replace(/\u00A0/g,' ')
  makePreview()
  input.value = ''
}

/* --- rychlý náhled (step 2) --- */
function makePreview(){
  const lines = rawText.value.split(/\r?\n/).filter(Boolean)
  const sample = lines.slice(0, 12).join('\n')
  delimiterOverrideModel.value = guessDelimiterFast(sample)
  const rows = tokenizeForPreview(sample, delimiterOverrideModel.value)
  previewRows.value = rows.slice(1)
  previewHeaders.value = rows[0] ?? []
}
function guessDelimiterFast(s:string): DelimiterOverride{
  if (/\t/.test(s)) return 'tab'
  const semi=(s.match(/;/g)||[]).length, comma=(s.match(/,/g)||[]).length, pipe=(s.match(/\|/g)||[]).length
  if (semi>=comma && semi>=pipe && semi>0) return 'semicolon'
  if (comma>=semi && comma>=pipe && comma>0) return 'comma'
  if (pipe>0) return 'pipe'
  if (/\s{2,}/.test(s)) return 'spaces'
  return 'comma'
}
function splitCsvLine(line:string, sep:string){ const o:string[]=[]; let c='',q=false; for(let i=0;i<line.length;i++){const ch=line[i]; if(ch==='"'){ if(q && line[i+1]==='"'){c+='"';i++} else q=!q; continue} if(!q && ch===sep){ o.push(c); c=''; continue } c+=ch } o.push(c); return o}
function tokenizeForPreview(text:string, dd:DelimiterOverride){
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length>0)
  const sep = dd==='semicolon'?';': dd==='comma'? ',': dd==='pipe'? '|': dd==='tab'? '\t': null
  return lines.map(l => dd==='spaces' ? (/\s{2,}/.test(l)? l.split(/\s{2,}/):[l]) : (sep? splitCsvLine(l,sep):[l]))
}

/* --- potvrdit step2 + analyzovat (Worker) --- */
function confirmDelimiterAndAnalyze(){
  goStep(3)
  runAnalysisWorker({
    delimiterOverride: delimiterOverrideModel.value !== 'auto' ? delimiterOverrideModel.value : undefined,
    preferDecimalComma: true, acceptMarkdownTables: true, mergeUnitsWithHeaders: true,
  })
}

/* --- Worker s cancel-id --- */
let msgId = 0
let worker: Worker | null = null
function ensureWorker(){
  if (worker) return worker
  worker = new Worker(new URL('@/workers/parser.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (ev:MessageEvent) => {
    const { id, result } = ev.data || {}
    if (id !== msgId) return
    const a: AnalyzeResult = result
    blocks.value = a.blocks
    // header picker – předvyplnění
    const tbl = a.blocks.find(b=>b.kind==='table') as TableBlock | undefined
    const headers = tbl?.headersRaw ?? previewHeaders.value
    headerPickerRows.value = headers.map((h, i) => ({
      index: i+1, selected: true, name: h || `Col ${i+1}`, type: 'text', required: false
    }))
  })
  return worker
}
function runAnalysisWorker(opts: ParserOptions & { delimiterOverride?: Exclude<DelimiterOverride,'auto'> }){
  msgId++
  ensureWorker().postMessage({ id: msgId, text: rawText.value, opts })
}

/* --- výběr hlaviček (step 3) --- */
function toggleAll(v:boolean){ headerPickerRows.value.forEach(r => r.selected = v) }
function invertSelection(){ headerPickerRows.value.forEach(r => r.selected = !r.selected) }
function reorder(index:number, delta:number){
  const arr = headerPickerRows.value.slice()
  const j = index + delta; if (j<0 || j>=arr.length) return
  const [row] = arr.splice(index,1); arr.splice(j,0,row)
  headerPickerRows.value = arr.map((r,i)=>({...r,index:i+1}))
}
function saveSelectionPreset(){
  if (!deviceCode.value) return
  const sel = headerPickerRows.value.filter(r=>r.selected).map(({name,type,required})=>({name,type,required}))
  localStorage.setItem(`lims/presets/${deviceCode.value}`, JSON.stringify(sel))
}
function loadSelectionPresetIfAny(){
  if (!deviceCode.value) return
  const raw = localStorage.getItem(`lims/presets/${deviceCode.value}`)
  if (!raw) return
  try{
    const preset = JSON.parse(raw) as Array<{name:string;type:FieldType;required:boolean}>
    // map na existující řádky podle názvu
    headerPickerRows.value = headerPickerRows.value.map(r => {
      const p = preset.find(x => x.name.toLowerCase() === r.name.toLowerCase())
      return p ? { ...r, selected:true, type:p.type, required:p.required } : r
    })
  }catch{}
}
watch([deviceCode, () => step.value], () => { if (step.value===3) loadSelectionPresetIfAny() })

function applySelectionToBlocks(){
  const selected = headerPickerRows.value.filter(r=>r.selected)
  if (!selected.length) return
  pickedBlocks.value = [{
    id: `sel-${Date.now()}`, sourceIndex: 0, kind: 'table', title: 'Vybrané sloupce',
    includeRepeatSets: false, headerOverrideEnabled: false, headerOverrideIndex: null,
    fieldRows: selected.map((r,i)=>({ orderIndex:i+1, name:r.name, required:r.required, type:r.type }))
  }]
  goStep(4)
}

/* --- confirm --- */
const hasAnyFields = computed(()=> pickedBlocks.value.some(pb=>pb.fieldRows?.length>0))
async function confirm(){
  if (!deviceCode.value || !pickedBlocks.value.length || !hasAnyFields.value) return
  loading.value = true
  try{
    const blocksPayload: TemplateBlockPayload[] = pickedBlocks.value.map(pb => ({
      kind: pb.kind,
      title: pb.title,
      fields: pb.fieldRows.map((f, i) => ({
        orderIndex: i + 1,
        name: (f.name || '').trim() || `Pole ${i + 1}`,
        required: !!f.required,
        type: f.type
      }))
    }))
    const payload: TemplatePayload = {
      deviceCode: deviceCode.value,
      templateName: (templateName.value||'').trim() || 'Šablona',
      blocks: blocksPayload,
      fields: blocksPayload.flatMap(b => b.fields),
    }
    if (typeof props.onConfirm === 'function') await Promise.resolve(props.onConfirm(payload))
    else emit('confirm', payload)
    open.value = false
  } finally { loading.value = false }
}


/* --- UX helpers --- */
function onKeydown(e:KeyboardEvent){
  const k = e.key.toLowerCase()
  if (k==='escape'){ e.preventDefault(); open.value=false; return }
  if ((e.ctrlKey||e.metaKey) && k==='o'){ e.preventDefault(); triggerFilePick(); return }
  if ((e.ctrlKey||e.metaKey) && k==='v'){ e.preventDefault(); void pasteFromClipboard(); return }
}
function prettyBytes(n:number){
  const u=['B','KB','MB','GB']; let i=0; let x=n
  while (x>=1024 && i<u.length-1){ x/=1024; i++ } return `${x.toFixed(x<10?1:0)} ${u[i]}`
}
</script>

<style scoped>
.clipboard-textarea :deep(textarea){ max-height: 260px; overflow:auto; white-space:pre; font-family: ui-monospace, Menlo, Consolas, monospace }
.mono-block{ font-family: ui-monospace, Menlo, Consolas, monospace; background:#fff; border:1px solid #eee; border-radius:8px }
.sticky th{ position: sticky; top: 0; background:#fafafa; z-index:1 }
</style>
