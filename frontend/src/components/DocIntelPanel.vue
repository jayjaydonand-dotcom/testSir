<template>
  <section class="doc-intel">
    <div class="di-shell">
      <!-- 顶栏：标题与操作同一基线 -->
      <header class="di-bar">
        <div class="di-bar-left">
          <h1>智能构建</h1>
          <span class="di-sep" aria-hidden="true" />
          <p>展示元模型树 → 导入抽取 → <b>虚线标记增/改/删</b> → 勾选接受或取消</p>
        </div>
        <div class="di-bar-right">
          <span class="engine-chip" :class="{ on: engines.workerReachable }">
            {{ engines.workerReachable ? 'Worker 在线' : 'Worker 离线' }}
            <template v-if="engines.extractEngine"> · {{ engines.extractEngine }}</template>
          </span>
          <span class="engine-chip" :class="{ on: engines.ontogptConfigured || engines.llmConfigured }">
            {{ (engines.ontogptConfigured || engines.llmConfigured) ? ('OntoGPT ' + (engines.llmModel || '就绪')) : 'OntoGPT 未配置' }}
          </span>
          <button type="button" class="btn ghost" :disabled="busy" @click="reloadAll">刷新</button>
          <button type="button" class="btn primary" :disabled="busy || !projectId" @click="seedDemo">
            一键演示
          </button>
        </div>
      </header>

      <p v-if="toast" class="toast" :class="{ ok: toastOk }">{{ toast }}</p>
      <p v-if="!engines.workerReachable" class="alert">
        请启动 Worker：<code>doc-intel-worker/start.ps1</code>（:18100）。抽取仅支持 OntoGPT。
      </p>
      <p v-else-if="!engines.llmConfigured" class="alert">
        请在 <code>doc-intel-worker/.env</code> 配置 <code>DOC_INTEL_LLM_API_KEY</code>（OntoGPT 后端模型）。
      </p>

      <!-- 步骤：等宽对齐 -->
      <nav class="steps" aria-label="步骤">
        <button
          v-for="(step, i) in pipeline"
          :key="step.id"
          type="button"
          class="step"
          :class="{ active: activeTab === step.id }"
          @click="activeTab = step.id"
        >
          <span class="step-num">{{ i + 1 }}</span>
          <span class="step-label">{{ step.label }}</span>
          <span class="step-count">{{ stepCount(step.id) }}</span>
          <span v-if="i < pipeline.length - 1" class="step-line" aria-hidden="true" />
        </button>
      </nav>

      <p v-if="!projectId" class="alert">请先选择领域项目。</p>
      <p v-else-if="error" class="alert err">{{ error }}</p>

      <div v-else class="work">
        <!-- 文档 -->
        <div v-if="activeTab === 'docs'" class="pane pane-docs">
          <label class="upload" :class="{ busy }" @dragover.prevent @drop.prevent="onDrop">
            <input
              type="file"
              accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
              @change="onUpload"
            />
            <span class="upload-title">拖入文件，或点击选择</span>
            <span class="upload-sub">
              .txt / .md{{ engines.workerReachable ? ' / .pdf' : '（PDF 需 Worker）' }}
            </span>
          </label>

          <div class="block">
            <div class="block-head">
              <h2>资料库</h2>
              <span class="meta">{{ data.docs.length }} 份</span>
            </div>
            <div v-if="data.docs.length" class="rows">
              <div v-for="d in data.docs" :key="d.id" class="row">
                <div class="row-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" width="18" height="18"><path fill="currentColor" d="M5 2h7l4 4v12H5V2zm7 1.2V7h3.5L12 3.2z"/></svg>
                </div>
                <div class="row-text">
                  <div class="row-title">{{ d.fileName }}</div>
                  <div class="row-sub">{{ formatSize(d.size) }} · {{ statusLabel(d.status) }}</div>
                </div>
                <button type="button" class="btn primary sm" :disabled="busy" @click="runJob(d)">解析并生成候选</button>
              </div>
            </div>
            <div v-else class="blank">上传文档，或点击右上角「一键演示」。</div>
          </div>

          <div v-if="stats.pending > 0" class="convert-banner">
            <div>
              <strong>已抽出 {{ stats.pending }} 条结构变更</strong>
              <span>在「结构审核」树中查看虚线新增/修改/删除，勾选后接受或取消。</span>
            </div>
            <button type="button" class="btn primary" :disabled="busy" @click="goWriteOntology">
              去结构审核
            </button>
          </div>
        </div>

        <!-- 分块 -->
        <div v-else-if="activeTab === 'chunks'" class="pane pane-split">
          <aside class="side">
            <div class="side-inner">
              <label class="lbl">文档</label>
              <select v-model="filterDocId">
                <option value="">全部</option>
                <option v-for="d in data.docs" :key="d.id" :value="d.id">{{ d.fileName }}</option>
              </select>
              <p class="hint">分块带页码，供审核回看原文。</p>
            </div>
          </aside>
          <div class="main scroll">
            <template v-if="filteredChunks.length">
              <article v-for="c in filteredChunks" :key="c.id" class="chunk">
                <div class="chunk-page">{{ c.page }}</div>
                <div class="chunk-body">
                  <div class="chunk-loc">{{ c.locator }}</div>
                  <p>{{ c.text }}</p>
                </div>
              </article>
            </template>
            <div v-else class="blank fill">
              暂无分块。请先完成文档解析。
              <button type="button" class="btn ghost sm" @click="activeTab = 'docs'">去文档</button>
            </div>
          </div>
        </div>

        <!-- 元模型结构差审核 -->
        <div v-else class="pane pane-ontology">
          <div class="struct-toolbar">
            <div class="struct-toolbar-left">
              <h2>结构审核</h2>
              <div class="struct-pills">
                <span class="pill add"><b>{{ changeStats.add }}</b> 新增</span>
                <span class="pill mod"><b>{{ changeStats.modify }}</b> 修改</span>
                <span class="pill del"><b>{{ changeStats.delete }}</b> 删除</span>
                <span class="pill sel" v-if="selectedChangeIds.length"><b>{{ selectedChangeIds.length }}</b> 已勾选</span>
              </div>
            </div>
            <div class="struct-toolbar-right">
              <button type="button" class="btn primary" :disabled="busy || !pendingChangeIds.length" @click="acceptAllChanges">
                全部接受
              </button>
              <button type="button" class="btn ghost" :disabled="busy || !pendingChangeIds.length" @click="rejectAllChanges">
                全部取消
              </button>
              <button type="button" class="btn ghost" :disabled="busy || !selectedChangeIds.length" @click="acceptSelected">
                接受勾选
              </button>
              <button type="button" class="btn ghost" :disabled="busy || !selectedChangeIds.length" @click="rejectSelected">
                取消勾选
              </button>
              <span class="toolbar-sep" />
              <button type="button" class="btn ghost" :disabled="busy" @click="loadStructureReview">刷新树</button>
              <button type="button" class="btn ghost" @click="openModeling">打开元模型管理</button>
            </div>
          </div>

          <div class="structure-body">
            <div class="tree-panel scroll">
              <StructureDiffTree
                :roots="structureTree"
                :selected-ids="selectedChangeIds"
                :active-id="activeNodeId"
                @toggle-select="toggleChangeSelect"
                @activate="onActivateNode"
                @accept="acceptNode"
                @reject="rejectNode"
              />
            </div>
            <aside class="detail-panel">
              <div class="detail-panel-inner scroll" v-if="activeNode">
                <div class="detail-kicker">
                  <span>{{ activeNode.kind || 'Class' }}</span>
                  <span
                    v-if="activeNode.change && activeNode.change !== 'stable'"
                    class="detail-chg"
                    :class="'c-' + activeNode.change"
                  >{{ changeTypeLabel(activeNode.change) }}</span>
                </div>
                <h2>{{ activeNode.label }}</h2>
                <p class="detail-iri" v-if="activeNode.iri"><code>{{ activeNode.iri }}</code></p>

                <template v-if="activeCand">
                  <div class="detail-block">
                    <h3>定义</h3>
                    <p>{{ activeCand.definition || activeNode.definition || '暂无定义' }}</p>
                  </div>
                  <div class="detail-block" v-if="activeCand.parentLabel || activeCand.existingIri || activeCand.action">
                    <h3>挂接信息</h3>
                    <ul class="detail-meta">
                      <li v-if="activeCand.action"><span>动作</span>{{ activeCand.action }}</li>
                      <li v-if="activeCand.parentLabel"><span>父类</span>{{ activeCand.parentLabel }}</li>
                      <li v-if="activeCand.existingIri"><span>已有 IRI</span><code>{{ activeCand.existingIri }}</code></li>
                    </ul>
                  </div>
                  <div class="detail-block">
                    <h3>公理预览</h3>
                    <pre class="owl-mini">{{ previewOwl(activeCand) }}</pre>
                  </div>
                  <div class="detail-actions" v-if="activeCand.status === 'pending'">
                    <button type="button" class="btn primary" :disabled="busy" @click="acceptNode(activeNode)">接受变更</button>
                    <button type="button" class="btn ghost" :disabled="busy" @click="rejectNode(activeNode)">取消变更</button>
                  </div>
                </template>
                <div v-else class="detail-block muted">
                  <p>这是现有元模型节点，暂无待审变更。</p>
                </div>
              </div>
              <div v-else class="detail-empty">
                <div class="detail-empty-card">
                  <strong>选择树中的节点</strong>
                  <p>查看定义、挂接关系与公理预览；对待审项可直接接受或取消。</p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import * as api from '../api/onto'
import StructureDiffTree from './StructureDiffTree.vue'

const props = defineProps({
  projectId: { type: String, default: '' }
})

const pipeline = [
  { id: 'docs', label: '文档解析' },
  { id: 'chunks', label: '原文分块' },
  { id: 'review', label: '结构审核' }
]

const activeTab = ref('docs')
const busy = ref(false)
const error = ref('')
const toast = ref('')
const toastOk = ref(true)
const filterDocId = ref('')
const filterStatus = ref('pending')
const selectedId = ref('')
const evidenceList = ref([])
const evidenceLoading = ref(false)

const structureTree = ref([])
const structureChanges = ref([])
const changeStats = reactive({ add: 0, modify: 0, delete: 0 })
const selectedChangeIds = ref([])
const activeNodeId = ref('')
const activeNode = ref(null)

function showToast(msg, ok = true) {
  toast.value = msg
  toastOk.value = ok
  window.clearTimeout(showToast._t)
  showToast._t = window.setTimeout(() => { toast.value = '' }, 4500)
}

function goWriteOntology() {
  activeTab.value = 'review'
  filterStatus.value = 'pending'
  loadStructureReview()
}

function changeTypeLabel(c) {
  return ({ add: '新增', modify: '修改', delete: '删除' })[c] || c
}

const pendingChangeIds = computed(() =>
  (structureChanges.value || []).map((c) => c.candidateId).filter(Boolean)
)

const activeCand = computed(() => {
  const cid = activeNode.value?.candidateId
  if (!cid) return null
  return data.candidates.find((c) => c.id === cid) || null
})

function toggleChangeSelect(id) {
  if (!id) return
  const i = selectedChangeIds.value.indexOf(id)
  if (i >= 0) selectedChangeIds.value = selectedChangeIds.value.filter((x) => x !== id)
  else selectedChangeIds.value = [...selectedChangeIds.value, id]
}

function onActivateNode(node) {
  activeNode.value = node
  activeNodeId.value = node?.id || ''
  if (node?.candidateId) {
    const cand = data.candidates.find((c) => c.id === node.candidateId)
    if (cand) selectCandidate(cand)
    else selectedId.value = node.candidateId
  }
}

async function loadStructureReview() {
  if (!props.projectId) return
  try {
    const res = await api.getDocIntelStructureReview(props.projectId)
    structureTree.value = res.tree || []
    structureChanges.value = res.changes || []
    changeStats.add = res.changeStats?.add ?? 0
    changeStats.modify = res.changeStats?.modify ?? 0
    changeStats.delete = res.changeStats?.delete ?? 0
    // drop selections that no longer exist
    const alive = new Set(pendingChangeIds.value)
    selectedChangeIds.value = selectedChangeIds.value.filter((id) => alive.has(id))
  } catch (e) {
    error.value = e.message || String(e)
  }
}

async function decideBatch(ids, decision) {
  if (!props.projectId || !ids?.length) return
  busy.value = true
  error.value = ''
  try {
    const res = await api.decideDocIntelBatch(props.projectId, ids, decision)
    await reload()
    await loadStructureReview()
    selectedChangeIds.value = []
    showToast(res.message || (decision === 'accept' ? '已接受' : '已取消'), !!res.ok)
  } catch (e) {
    error.value = e.message || String(e)
    showToast(error.value, false)
  } finally {
    busy.value = false
  }
}

function acceptAllChanges() {
  return decideBatch(pendingChangeIds.value, 'accept')
}
function rejectAllChanges() {
  return decideBatch(pendingChangeIds.value, 'reject')
}
function acceptSelected() {
  return decideBatch(selectedChangeIds.value, 'accept')
}
function rejectSelected() {
  return decideBatch(selectedChangeIds.value, 'reject')
}

function nodeCandidateId(node) {
  return node?.candidateId || null
}

async function acceptNode(node) {
  const id = nodeCandidateId(node)
  if (!id) return
  await decideBatch([id], 'accept')
}
async function rejectNode(node) {
  const id = nodeCandidateId(node)
  if (!id) return
  await decideBatch([id], 'reject')
}

function openModeling() {
  window.dispatchEvent(new CustomEvent('app-open-module', { detail: { module: 'class' } }))
}

const engines = reactive({
  workerReachable: false,
  llmConfigured: false,
  ontogptConfigured: false,
  argillaConfigured: false,
  argillaMock: false,
  argillaApiUrl: '',
  extractEngine: '',
  llmModel: '',
  worker: {},
  message: ''
})

function previewOwl(cand) {
  if (!cand) return ''
  const id = String(cand.id || '').replace('cand.', '')
  const label = String(cand.label || '').replace(/"/g, '\\"')
  const def = String(cand.definition || '').replace(/"/g, '\\"')
  const kind = cand.kind || 'Class'
  if (kind === 'Relation') {
    const iri = 'http://example.org/doc-intel#OP_' + id
    const pred = String(cand.predicate || label).replace(/"/g, '\\"')
    const subj = String(cand.relationSubject || '').replace(/"/g, '\\"')
    const obj = String(cand.relationObject || '').replace(/"/g, '\\"')
    return [
      'Ontology(<http://example.org/doc-intel-patch>',
      '  Declaration(ObjectProperty(<' + iri + '>))',
      '  AnnotationAssertion(rdfs:label <' + iri + '> "' + pred + '"@zh)',
      def ? '  AnnotationAssertion(rdfs:comment <' + iri + '> "' + def + '"@zh)' : null,
      subj ? '  ObjectPropertyDomain(<' + iri + '> <…' + subj + '…>)' : null,
      obj ? '  ObjectPropertyRange(<' + iri + '> <…' + obj + '…>)' : null,
      ')'
    ].filter(Boolean).join('\n')
  }
  if (kind === 'DataProperty' || kind === 'ObjectProperty') {
    const decl = kind === 'DataProperty' ? 'DataProperty' : 'ObjectProperty'
    const iri = 'http://example.org/doc-intel#' + (kind === 'DataProperty' ? 'DP_' : 'OP_') + id
    return [
      'Ontology(<http://example.org/doc-intel-patch>',
      '  Declaration(' + decl + '(<' + iri + '>))',
      '  AnnotationAssertion(rdfs:label <' + iri + '> "' + label + '"@zh)',
      def ? '  AnnotationAssertion(rdfs:comment <' + iri + '> "' + def + '"@zh)' : null,
      ')'
    ].filter(Boolean).join('\n')
  }
  if (kind === 'SubClassOf') {
    const iri = 'http://example.org/doc-intel#C_' + id
    const parent = String(cand.parentLabel || 'Thing').replace(/"/g, '\\"')
    return [
      'Ontology(<http://example.org/doc-intel-patch>',
      '  Declaration(Class(<' + iri + '>))',
      '  AnnotationAssertion(rdfs:label <' + iri + '> "' + label + '"@zh)',
      '  SubClassOf(<' + iri + '> <…父类 ' + parent + '…>)',
      ')'
    ].join('\n')
  }
  const iri = 'http://example.org/doc-intel#C_' + id
  return [
    'Ontology(<http://example.org/doc-intel-patch>',
    '  Declaration(Class(<' + iri + '>))',
    '  AnnotationAssertion(rdfs:label <' + iri + '> "' + label + '"@zh)',
    def ? '  AnnotationAssertion(rdfs:comment <' + iri + '> "' + def + '"@zh)' : null,
    ')'
  ].filter(Boolean).join('\n')
}

async function loadEngines() {
  try {
    const e = await api.getDocIntelEngines()
    engines.workerReachable = !!e.workerReachable
    engines.llmConfigured = !!e.llmConfigured
    engines.ontogptConfigured = !!e.ontogptConfigured
    engines.argillaConfigured = !!e.argillaConfigured
    engines.argillaMock = !!e.argillaMock || !!e.worker?.argillaMock
    engines.argillaApiUrl = e.argillaApiUrl || e.worker?.argillaApiUrl || ''
    engines.extractEngine = e.extractEngine || e.worker?.extractEngine || ''
    engines.llmModel = e.llmModel || e.worker?.llmModel || ''
    engines.worker = e.worker || {}
    engines.message = e.message || ''
  } catch (_) {
    engines.workerReachable = false
    engines.llmConfigured = false
  }
}

async function reloadAll() {
  await Promise.all([reload(), loadEngines(), loadStructureReview()])
}

const data = reactive({
  docs: [],
  chunks: [],
  candidates: [],
  jobs: [],
  stats: {}
})

const stats = computed(() => ({
  docs: data.stats?.docs ?? data.docs.length,
  chunks: data.stats?.chunks ?? data.chunks.length,
  pending: data.stats?.pending ?? data.candidates.filter((c) => c.status === 'pending').length,
  accepted: data.stats?.accepted ?? data.candidates.filter((c) => c.status === 'accepted').length,
  rejected: data.stats?.rejected ?? data.candidates.filter((c) => c.status === 'rejected').length
}))

const filteredChunks = computed(() => {
  if (!filterDocId.value) return data.chunks
  return data.chunks.filter((c) => c.docId === filterDocId.value)
})

function stepCount(id) {
  if (id === 'docs') return stats.value.docs
  if (id === 'chunks') return stats.value.chunks
  return (changeStats.add + changeStats.modify + changeStats.delete) || stats.value.pending
}

function statusLabel(s) {
  const map = {
    uploaded: '已上传',
    processing: '处理中',
    ready: '已解析',
    failed: '失败',
    pending: '待审',
    accepted: '已入库',
    rejected: '已驳回'
  }
  return map[s] || s || '—'
}

function applySnapshot(payload) {
  data.docs = payload.docs || []
  data.chunks = payload.chunks || []
  data.candidates = payload.candidates || []
  data.jobs = payload.jobs || []
  data.stats = payload.stats || {}
  if (selectedId.value && !data.candidates.some((c) => c.id === selectedId.value)) {
    selectedId.value = ''
    evidenceList.value = []
  }
  if (!selectedId.value && filterStatus.value === 'pending') {
    const first = data.candidates.find((c) => c.status === 'pending')
    if (first) selectCandidate(first)
  }
}

async function reload() {
  if (!props.projectId) return
  busy.value = true
  error.value = ''
  try {
    applySnapshot((await api.getDocIntel(props.projectId)) || {})
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

async function seedDemo() {
  if (!props.projectId) return
  busy.value = true
  error.value = ''
  try {
    applySnapshot((await api.seedDocIntelDemo(props.projectId)) || {})
    activeTab.value = 'review'
    await loadStructureReview()
    showToast('演示抽取完成，请在结构树中审核变更。', true)
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

async function handleFile(file) {
  if (!file || !props.projectId) return
  busy.value = true
  error.value = ''
  try {
    await api.uploadDocIntel(props.projectId, file)
    await reload()
    activeTab.value = 'docs'
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

async function onUpload(ev) {
  const file = ev.target?.files?.[0]
  ev.target.value = ''
  await handleFile(file)
}

async function onDrop(ev) {
  await handleFile(ev.dataTransfer?.files?.[0])
}

async function runJob(doc) {
  if (!doc || !props.projectId) return
  busy.value = true
  error.value = ''
  try {
    const payload = await api.startDocIntelJob(props.projectId, doc.id)
    applySnapshot(payload || {})
    activeTab.value = 'review'
    filterStatus.value = 'pending'
    await loadStructureReview()
    showToast('解析完成，请在结构树中审核新增/修改/删除。', true)
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

async function decide(cand, decision) {
  if (!cand || !props.projectId) return
  busy.value = true
  error.value = ''
  try {
    const res = await api.decideDocIntelCandidate(props.projectId, cand.id, decision)
    await reload()
    if (decision === 'accept') {
      showToast('已写入本体类：' + (res.acceptedIri || cand.label), true)
      filterStatus.value = 'accepted'
      if (res.acceptedIri) {
        selectedId.value = cand.id
      }
    } else {
      showToast('已驳回：' + cand.label, true)
    }
  } catch (e) {
    error.value = e.message || String(e)
    showToast(error.value, false)
  } finally {
    busy.value = false
  }
}

async function acceptAllPending() {
  if (!props.projectId || stats.value.pending === 0) return
  busy.value = true
  error.value = ''
  try {
    const res = await api.acceptDocIntelPending(props.projectId)
    applySnapshot(res || {})
    filterStatus.value = 'accepted'
    showToast(res.message || ('已写入 ' + (res.acceptedCount || 0) + ' 条本体类'), true)
    const firstAccepted = (data.candidates || []).find((c) => c.status === 'accepted')
    if (firstAccepted) await selectCandidate(firstAccepted)
  } catch (e) {
    error.value = e.message || String(e)
    showToast(error.value, false)
  } finally {
    busy.value = false
  }
}

async function selectCandidate(cand) {
  selectedId.value = cand.id
  evidenceLoading.value = true
  evidenceList.value = []
  try {
    const payload = await api.getDocIntelEvidence(props.projectId, cand.id)
    evidenceList.value = payload.evidence || []
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    evidenceLoading.value = false
  }
}

function formatSize(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / (1024 * 1024)).toFixed(1) + ' MB'
}

watch(() => props.projectId, (id) => {
  loadEngines()
  if (id) {
    reload().then(() => loadStructureReview())
  } else {
    applySnapshot({})
    structureTree.value = []
    structureChanges.value = []
    error.value = ''
    selectedId.value = ''
  }
}, { immediate: true })

watch(activeTab, (tab) => {
  if (tab === 'review' && props.projectId) loadStructureReview()
})
</script>

<style scoped>
.doc-intel {
  --ink: #0f172a;
  --muted: #64748b;
  --line: #e2e8f0;
  --bg: #f1f5f9;
  --panel: #ffffff;
  --accent: #2563eb;
  --pad: 20px;
  --radius: 10px;
  --gap: 12px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--ink);
}

.di-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 12px 16px 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}

/* —— 顶栏：左右垂直居中对齐 —— */
.di-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  min-height: 56px;
  padding: 0 var(--pad);
  border-bottom: 1px solid var(--line);
  flex: 0 0 auto;
}
.di-bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.di-bar-left h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.di-sep {
  width: 1px;
  height: 14px;
  background: var(--line);
  flex: 0 0 auto;
}
.di-bar-left p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.di-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.engine-chip {
  font-size: 12px;
  color: var(--muted);
  background: #f1f5f9;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 10px;
  white-space: nowrap;
}
.engine-chip.on {
  color: #0f766e;
  background: #ecfdf5;
  border-color: #a7f3d0;
}
.cand-t em {
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  color: var(--accent);
  margin-right: 6px;
}
.struct-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: #fff;
  flex: 0 0 auto;
}
.struct-toolbar-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.struct-toolbar-left h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
}
.struct-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 2px 10px;
}
.pill b { font-weight: 700; }
.pill.add { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
.pill.mod { color: #92400e; background: #fffbeb; border-color: #fde68a; }
.pill.del { color: #991b1b; background: #fef2f2; border-color: #fecaca; }
.pill.sel { color: #1d4ed8; background: #eff6ff; border-color: #bfdbfe; }

.struct-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.toolbar-sep {
  width: 1px;
  height: 18px;
  background: var(--line);
  margin: 0 2px;
}

.structure-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 340px) minmax(0, 1fr);
  background: #fff;
}
.tree-panel {
  border-right: 1px solid #dbe3ee;
  background: #eef3fa;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.tree-panel :deep(.sdt-pane) {
  flex: 1;
  min-height: 0;
}
.detail-panel {
  min-height: 0;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.detail-panel-inner {
  padding: 20px 22px 28px;
}
.detail-kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
}
.detail-chg {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
}
.detail-chg.c-add { color: #166534; background: #dcfce7; }
.detail-chg.c-modify { color: #92400e; background: #fde68a; }
.detail-chg.c-delete { color: #991b1b; background: #fecaca; }
.detail-panel h2 {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.25;
  color: #0f172a;
}
.detail-iri {
  margin: 0 0 16px;
}
.detail-iri code {
  font-size: 11px;
  color: #64748b;
  word-break: break-all;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 6px;
  padding: 4px 8px;
  display: inline-block;
}
.detail-block {
  margin-top: 16px;
}
.detail-block h3 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: none;
  letter-spacing: 0.02em;
}
.detail-block p {
  margin: 0;
  font-size: 14px;
  color: #334155;
  line-height: 1.55;
}
.detail-block.muted p { color: #94a3b8; }
.detail-meta {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.detail-meta li {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  font-size: 13px;
  color: #334155;
  align-items: start;
}
.detail-meta li span {
  color: #94a3b8;
  font-size: 12px;
}
.detail-meta code {
  font-size: 11px;
  word-break: break-all;
  color: #475569;
}
.owl-mini {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 10px;
  padding: 12px 14px;
  overflow: auto;
  max-height: 200px;
  white-space: pre-wrap;
}
.detail-actions {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}
.detail-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background:
    radial-gradient(circle at 30% 20%, rgba(37, 99, 235, 0.06), transparent 45%),
    radial-gradient(circle at 80% 70%, rgba(15, 23, 42, 0.04), transparent 40%),
    #fff;
}
.detail-empty-card {
  max-width: 280px;
  text-align: center;
}
.detail-empty-card strong {
  display: block;
  font-size: 15px;
  color: #0f172a;
  margin-bottom: 8px;
}
.detail-empty-card p {
  margin: 0;
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.5;
}

@media (max-width: 960px) {
  .structure-body {
    grid-template-columns: 1fr;
  }
  .tree-panel {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    max-height: 48vh;
  }
}
.alert code {
  font-size: 12px;
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 4px;
}

/* —— 步骤：三等分、同高、数字基线一致 —— */
.steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 1px solid var(--line);
  flex: 0 0 auto;
  background: #fafbfc;
}
.step {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--muted);
  font: inherit;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.step:hover { color: var(--ink); background: #fff; }
.step.active {
  color: var(--accent);
  background: #fff;
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.step-num {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  background: #e2e8f0;
  color: #475569;
  flex: 0 0 auto;
}
.step.active .step-num {
  background: #dbeafe;
  color: var(--accent);
}
.step-label { font-size: 13px; }
.step-count {
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 6px;
  background: #f1f5f9;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.step.active .step-count {
  background: #eff6ff;
  color: var(--accent);
}
.step-line {
  position: absolute;
  right: 0;
  top: 50%;
  width: 1px;
  height: 20px;
  margin-top: -10px;
  background: var(--line);
}

.alert {
  margin: 0;
  padding: 12px var(--pad);
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
  flex: 0 0 auto;
}
.alert.err {
  color: #991b1b;
  background: #fef2f2;
}
.toast {
  margin: 0;
  padding: 10px var(--pad);
  border-bottom: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1e40af;
  font-size: 13px;
  flex: 0 0 auto;
}
.toast.ok { border-color: #a7f3d0; background: #ecfdf5; color: #065f46; }
.di-bar-left b { color: var(--accent); font-weight: 700; }

.convert-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid #bfdbfe;
  border-radius: var(--radius);
  background: #eff6ff;
}
.convert-banner strong { display: block; font-size: 14px; color: var(--ink); }
.convert-banner span { display: block; margin-top: 4px; font-size: 12px; color: var(--muted); }

.pane-ontology {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.convert-hero {
  display: grid;
  grid-template-columns: 1.4fr auto auto;
  gap: 16px;
  align-items: center;
  padding: 16px var(--pad);
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #f8fbff 0%, #fff 100%);
  flex: 0 0 auto;
}
.convert-copy h2 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 700;
}
.convert-copy p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.55;
  max-width: 560px;
}
.convert-copy code {
  font-size: 12px;
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 4px;
  color: #334155;
}
.convert-stats {
  display: flex;
  gap: 10px;
}
.convert-stats > div {
  min-width: 72px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  text-align: center;
}
.convert-stats b { display: block; font-size: 18px; color: var(--ink); }
.convert-stats span { font-size: 11px; color: var(--muted); }
.convert-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.ontology-body {
  flex: 1;
  min-height: 0;
}
.owl-preview pre {
  margin: 0;
  padding: 12px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.55;
  overflow: auto;
  font-family: ui-monospace, Consolas, monospace;
}
.ok-hint { color: #0f766e !important; margin-top: 8px !important; }
.btn.lg { height: 36px; padding: 0 14px; }

.work {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pane-docs {
  padding: var(--pad);
  gap: var(--gap);
  overflow: auto;
}

.upload {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 100px;
  border: 1px dashed #93c5fd;
  border-radius: var(--radius);
  background: #f8fbff;
  cursor: pointer;
  text-align: center;
}
.upload:hover { border-color: var(--accent); background: #eff6ff; }
.upload.busy { opacity: 0.55; pointer-events: none; }
.upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.upload-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.upload-sub { font-size: 12px; color: var(--muted); }

.block {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: #fff;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  background: #fafbfc;
}
.block-head.tight {
  padding: 0;
  border: none;
  background: transparent;
  height: 28px;
  margin-bottom: 8px;
}
.block-head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}
.meta { font-size: 12px; color: var(--muted); }

.rows { display: flex; flex-direction: column; }
.row {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 0 14px;
  border-bottom: 1px solid #f1f5f9;
}
.row:last-child { border-bottom: none; }
.row:hover { background: #f8fafc; }
.row-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #eff6ff;
  color: var(--accent);
  display: grid;
  place-items: center;
}
.row-text { min-width: 0; }
.row-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }

/* 分栏：侧栏固定宽，主区吃满，顶底对齐 */
.pane-split {
  display: grid;
  grid-template-columns: 260px 1fr;
  min-height: 0;
  flex: 1;
}
.side {
  border-right: 1px solid var(--line);
  background: #fafbfc;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.side-inner {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
}
.review-side .side-inner { padding-bottom: 8px; }
.lbl {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.side select {
  width: 100%;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  font: inherit;
  color: var(--ink);
}
.hint { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; }

.main {
  min-height: 0;
  min-width: 0;
  background: #fff;
}
.main.scroll { overflow: auto; }
.main.detail { padding: 0; display: flex; flex-direction: column; }

.chunk {
  display: grid;
  grid-template-columns: 48px 1fr;
  border-bottom: 1px solid #f1f5f9;
}
.chunk-page {
  padding: 14px 8px;
  text-align: right;
  font-size: 12px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  border-right: 1px solid #f1f5f9;
}
.chunk-body { padding: 14px 16px; }
.chunk-loc {
  font-size: 11px;
  color: #94a3b8;
  font-family: ui-monospace, Consolas, monospace;
  margin-bottom: 6px;
}
.chunk-body p {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  color: var(--ink);
}

.filters {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.filter {
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}
.filter.on {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: var(--accent);
  font-weight: 600;
}
.cand-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 -6px;
  padding: 0 6px;
}
.cand {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.cand:hover { background: #fff; border-color: var(--line); }
.cand.on {
  background: #eff6ff;
  border-color: #bfdbfe;
}
.cand-t {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cand-s { font-size: 11px; color: var(--muted); flex: 0 0 auto; }

.detail-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
  flex: 0 0 auto;
}
.detail-titles { min-width: 0; }
.detail-tag {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}
.detail-titles h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  word-break: break-word;
}
.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding-top: 2px;
}
.detail-grid {
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: auto;
}
.detail-grid h3 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.02em;
}
.detail-grid > section > p {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
}
.detail-grid code {
  display: block;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 12px;
  word-break: break-all;
  color: #334155;
}
.evs { display: flex; flex-direction: column; gap: 8px; }
.ev {
  padding: 10px 12px;
  border-left: 3px solid var(--accent);
  background: #f8fafc;
  border-radius: 0 8px 8px 0;
}
.ev-h { font-size: 11px; color: #94a3b8; margin-bottom: 4px; }
.ev p { margin: 0; font-size: 13px; line-height: 1.55; }

.blank {
  padding: 28px 16px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.blank.fill {
  flex: 1;
  min-height: 200px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.ghost {
  background: #fff;
  border-color: var(--line);
  color: var(--ink);
}
.btn.ghost:hover:not(:disabled) { background: #f8fafc; }
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.btn.primary:hover:not(:disabled) { background: #1d4ed8; }
.btn.sm { height: 30px; padding: 0 10px; font-size: 12px; }

@media (max-width: 900px) {
  .di-bar {
    flex-wrap: wrap;
    padding: 12px var(--pad);
    min-height: 0;
    gap: 10px;
  }
  .di-bar-left p { display: none; }
  .di-sep { display: none; }
  .pane-split { grid-template-columns: 1fr; }
  .side {
    border-right: none;
    border-bottom: 1px solid var(--line);
    max-height: 240px;
  }
  .steps { grid-template-columns: repeat(3, 1fr); }
  .step-line { display: none; }
  .convert-hero {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
  .convert-actions { flex-direction: row; flex-wrap: wrap; }
  .convert-banner { flex-direction: column; align-items: stretch; }
}
</style>
