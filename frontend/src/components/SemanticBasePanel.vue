<template>
  <section class="semantic-base">
    <header class="sb-hero">
      <div>
        <h1>统一语义本体底座</h1>
        <p class="sb-desc">
          MVP 架子：术语 · 指标（含轻量约束）· 标准挂载。
          后续扩展至 500+ 术语、SHACL、追溯链与正式文件入库。
        </p>
      </div>
      <div class="sb-hero-actions">
        <button type="button" class="ghost" :disabled="busy" @click="reload">刷新</button>
        <button type="button" class="primary" :disabled="busy || !projectId" @click="seed">
          {{ seededOnce ? '重新加载种子' : '初始化示范数据' }}
        </button>
      </div>
    </header>

    <p v-if="!projectId" class="sb-empty">请先在领域管理中选择一个领域项目。</p>
    <p v-else-if="error" class="sb-error">{{ error }}</p>

    <template v-else>
      <div class="sb-stats">
        <div><b>{{ stats.terms }}</b><span>术语</span></div>
        <div><b>{{ stats.indicators }}</b><span>指标</span></div>
        <div><b>{{ stats.standards }}</b><span>标准</span></div>
      </div>

      <div class="sb-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="sb-tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >{{ tab.label }}</button>
      </div>

      <div class="sb-body">
        <!-- 术语 -->
        <div v-if="activeTab === 'terms'" class="sb-panel">
          <div class="sb-toolbar">
            <input v-model="termQuery" type="search" placeholder="搜索术语…" />
            <button type="button" class="primary" @click="openTermDialog()">新增术语</button>
          </div>
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>#</th><th>中文名</th><th>英文</th><th>分类</th><th>定义</th><th>状态</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="(t, i) in filteredTerms" :key="t.id">
                  <td>{{ i + 1 }}</td>
                  <td><strong>{{ t.label }}</strong></td>
                  <td>{{ t.labelEn || '—' }}</td>
                  <td>{{ t.category || '—' }}</td>
                  <td class="col-def">{{ t.definition || '—' }}</td>
                  <td><span class="pill">{{ t.status || 'draft' }}</span></td>
                  <td><button type="button" class="link" @click="openTermDialog(t)">编辑</button></td>
                </tr>
                <tr v-if="!filteredTerms.length">
                  <td colspan="7" class="empty">暂无术语。可点「初始化示范数据」。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 指标 -->
        <div v-else-if="activeTab === 'indicators'" class="sb-panel">
          <div class="sb-toolbar">
            <input v-model="indicatorQuery" type="search" placeholder="搜索指标…" />
            <button type="button" class="primary" @click="openIndicatorDialog()">新增指标</button>
          </div>
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th><th>指标</th><th>编码</th><th>单位</th><th>类型</th>
                  <th>分系统</th><th>轻量约束</th><th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(ind, i) in filteredIndicators" :key="ind.id">
                  <td>{{ i + 1 }}</td>
                  <td><strong>{{ ind.label }}</strong></td>
                  <td><code>{{ ind.code }}</code></td>
                  <td>{{ ind.unit || '—' }}</td>
                  <td><span class="pill type">{{ ind.dataType }}</span></td>
                  <td>{{ ind.subsystem || '—' }}</td>
                  <td class="col-def">{{ formatConstraint(ind.constraint) }}</td>
                  <td><button type="button" class="link" @click="openIndicatorDialog(ind)">编辑</button></td>
                </tr>
                <tr v-if="!filteredIndicators.length">
                  <td colspan="8" class="empty">暂无指标。</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="hint">约束为 MVP 字段（required / min / max / enum）；后续映射 SHACL 与 OWL 属性 IRI。</p>
        </div>

        <!-- 标准 -->
        <div v-else-if="activeTab === 'standards'" class="sb-panel">
          <div class="sb-toolbar">
            <button type="button" class="primary" @click="openStandardDialog()">登记标准</button>
          </div>
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>#</th><th>名称</th><th>来源</th><th>摘要</th><th>文件</th><th>状态</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in (data.standards || [])" :key="s.id">
                  <td>{{ i + 1 }}</td>
                  <td><strong>{{ s.title }}</strong></td>
                  <td>{{ s.source || '—' }}</td>
                  <td class="col-def">{{ s.summary || '—' }}</td>
                  <td>{{ s.fileName || '未上传（占位）' }}</td>
                  <td><span class="pill">{{ s.status }}</span></td>
                  <td><button type="button" class="link" @click="openStandardDialog(s)">编辑</button></td>
                </tr>
                <tr v-if="!(data.standards || []).length">
                  <td colspan="7" class="empty">暂无标准条目。</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="hint">MVP 仅登记元数据与映射占位；PDF 上传与自动抽条款后续接入。</p>
        </div>
      </div>
    </template>

    <div v-if="dialog.open" class="modal" @click.self="dialog.open = false">
      <div class="dialog">
        <h2>{{ dialogTitle }}</h2>
        <template v-if="dialog.kind === 'term'">
          <label>中文名<input v-model="dialog.form.label" /></label>
          <label>英文<input v-model="dialog.form.labelEn" /></label>
          <label>分类<input v-model="dialog.form.category" /></label>
          <label>定义<textarea v-model="dialog.form.definition" rows="3" /></label>
        </template>
        <template v-else-if="dialog.kind === 'indicator'">
          <label>名称<input v-model="dialog.form.label" /></label>
          <label>编码<input v-model="dialog.form.code" /></label>
          <label>单位<input v-model="dialog.form.unit" /></label>
          <label>数据类型
            <select v-model="dialog.form.dataType">
              <option value="string">string</option>
              <option value="double">double</option>
              <option value="integer">integer</option>
              <option value="boolean">boolean</option>
              <option value="enum">enum</option>
            </select>
          </label>
          <label>分系统<input v-model="dialog.form.subsystem" /></label>
          <label>必填
            <select v-model="dialog.form.required">
              <option :value="true">是</option>
              <option :value="false">否</option>
            </select>
          </label>
          <label>最小值<input v-model="dialog.form.min" placeholder="可空" /></label>
          <label>最大值<input v-model="dialog.form.max" placeholder="可空" /></label>
          <label>枚举（| 分隔）<input v-model="dialog.form.enumValues" placeholder="如 air|land" /></label>
        </template>
        <template v-else-if="dialog.kind === 'standard'">
          <label>名称<input v-model="dialog.form.title" /></label>
          <label>来源<input v-model="dialog.form.source" placeholder="GJB / ORG / …" /></label>
          <label>摘要<textarea v-model="dialog.form.summary" rows="3" /></label>
          <label>文件名（占位）<input v-model="dialog.form.fileName" placeholder="尚未实际上传" /></label>
        </template>
        <div class="dialog-actions">
          <button type="button" @click="dialog.open = false">取消</button>
          <button type="button" class="primary" :disabled="busy" @click="saveDialog">保存</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import * as api from '../api/onto'

const props = defineProps({
  projectId: { type: String, default: '' }
})

const tabs = [
  { id: 'terms', label: '术语' },
  { id: 'indicators', label: '指标' },
  { id: 'standards', label: '标准文档' }
]

const activeTab = ref('terms')
const busy = ref(false)
const error = ref('')
const seededOnce = ref(false)
const termQuery = ref('')
const indicatorQuery = ref('')
const data = reactive({
  terms: [],
  indicators: [],
  standards: [],
  stats: {}
})

const dialog = reactive({
  open: false,
  kind: 'term',
  editingId: '',
  form: {}
})

const stats = computed(() => ({
  terms: data.stats?.terms ?? (data.terms || []).length,
  indicators: data.stats?.indicators ?? (data.indicators || []).length,
  standards: data.stats?.standards ?? (data.standards || []).length
}))

const filteredTerms = computed(() => {
  const q = termQuery.value.trim().toLowerCase()
  const list = data.terms || []
  if (!q) return list
  return list.filter((t) =>
    [t.label, t.labelEn, t.category, t.definition, t.id].join(' ').toLowerCase().includes(q)
  )
})

const filteredIndicators = computed(() => {
  const q = indicatorQuery.value.trim().toLowerCase()
  const list = data.indicators || []
  if (!q) return list
  return list.filter((t) =>
    [t.label, t.code, t.unit, t.subsystem, t.id].join(' ').toLowerCase().includes(q)
  )
})

const dialogTitle = computed(() => {
  const map = { term: '术语', indicator: '指标', standard: '标准' }
  return (dialog.editingId ? '编辑' : '新增') + (map[dialog.kind] || '')
})

function applyPayload(payload) {
  data.terms = payload.terms || []
  data.indicators = payload.indicators || []
  data.standards = payload.standards || []
  data.stats = payload.stats || {}
  seededOnce.value = (data.terms.length + data.indicators.length) > 0
}

async function reload() {
  if (!props.projectId) return
  busy.value = true
  error.value = ''
  try {
    const payload = await api.getSemanticBase(props.projectId)
    applyPayload(payload || {})
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

async function seed() {
  if (!props.projectId) return
  busy.value = true
  error.value = ''
  try {
    // force reseed for MVP button: mark allowReseed then seed
    const current = await api.getSemanticBase(props.projectId)
    await api.saveSemanticBase(props.projectId, { ...current, allowReseed: true })
    const payload = await api.seedSemanticBase(props.projectId)
    applyPayload(payload || {})
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

async function persist() {
  busy.value = true
  error.value = ''
  try {
    const payload = await api.saveSemanticBase(props.projectId, {
      version: 1,
      domain: 'helicopter',
      terms: data.terms,
      indicators: data.indicators,
      standards: data.standards
    })
    applyPayload(payload || {})
    dialog.open = false
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

function formatConstraint(c) {
  if (!c || typeof c !== 'object') return '—'
  const bits = []
  if (c.required) bits.push('必填')
  if (c.min != null && c.min !== '') bits.push('≥' + c.min)
  if (c.max != null && c.max !== '') bits.push('≤' + c.max)
  if (c.enumValues) {
    const ev = Array.isArray(c.enumValues) ? c.enumValues.join('|') : String(c.enumValues)
    if (ev) bits.push('枚举:' + ev)
  }
  if (c.unitCode) bits.push(c.unitCode)
  return bits.length ? bits.join(' · ') : '—'
}

function mintId(prefix) {
  return prefix + '.' + Date.now().toString(36)
}

function openTermDialog(row) {
  dialog.kind = 'term'
  dialog.editingId = row ? row.id : ''
  dialog.form = {
    label: row?.label || '',
    labelEn: row?.labelEn || '',
    category: row?.category || '',
    definition: row?.definition || ''
  }
  dialog.open = true
}

function openIndicatorDialog(row) {
  const c = row?.constraint || {}
  dialog.kind = 'indicator'
  dialog.editingId = row ? row.id : ''
  dialog.form = {
    label: row?.label || '',
    code: row?.code || '',
    unit: row?.unit || '',
    dataType: row?.dataType || 'double',
    subsystem: row?.subsystem || '',
    required: c.required !== false,
    min: c.min != null ? String(c.min) : '',
    max: c.max != null ? String(c.max) : '',
    enumValues: Array.isArray(c.enumValues) ? c.enumValues.join('|') : (c.enumValues || '')
  }
  dialog.open = true
}

function openStandardDialog(row) {
  dialog.kind = 'standard'
  dialog.editingId = row ? row.id : ''
  dialog.form = {
    title: row?.title || '',
    source: row?.source || '',
    summary: row?.summary || '',
    fileName: row?.fileName || ''
  }
  dialog.open = true
}

async function saveDialog() {
  if (dialog.kind === 'term') {
    const row = {
      id: dialog.editingId || mintId('term'),
      label: String(dialog.form.label || '').trim(),
      labelEn: String(dialog.form.labelEn || '').trim(),
      category: String(dialog.form.category || '').trim(),
      definition: String(dialog.form.definition || '').trim(),
      status: 'draft',
      skosConceptIri: ''
    }
    if (!row.label) return
    const list = [...(data.terms || [])]
    const idx = list.findIndex((x) => x.id === row.id)
    if (idx >= 0) list[idx] = { ...list[idx], ...row }
    else list.push(row)
    data.terms = list
  } else if (dialog.kind === 'indicator') {
    const enumValues = String(dialog.form.enumValues || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
    const constraint = {
      required: !!dialog.form.required,
      unitCode: ''
    }
    if (dialog.form.min !== '') constraint.min = Number(dialog.form.min)
    if (dialog.form.max !== '') constraint.max = Number(dialog.form.max)
    if (enumValues.length) constraint.enumValues = enumValues
    const row = {
      id: dialog.editingId || mintId('ind'),
      label: String(dialog.form.label || '').trim(),
      code: String(dialog.form.code || '').trim(),
      unit: String(dialog.form.unit || '').trim(),
      dataType: dialog.form.dataType || 'double',
      subsystem: String(dialog.form.subsystem || '').trim(),
      termId: '',
      constraint,
      owlPropertyIri: '',
      status: 'draft'
    }
    if (!row.label) return
    const list = [...(data.indicators || [])]
    const idx = list.findIndex((x) => x.id === row.id)
    if (idx >= 0) list[idx] = { ...list[idx], ...row }
    else list.push(row)
    data.indicators = list
  } else if (dialog.kind === 'standard') {
    const row = {
      id: dialog.editingId || mintId('std'),
      title: String(dialog.form.title || '').trim(),
      source: String(dialog.form.source || '').trim(),
      summary: String(dialog.form.summary || '').trim(),
      fileName: String(dialog.form.fileName || '').trim(),
      fileRef: '',
      status: 'draft'
    }
    if (!row.title) return
    const list = [...(data.standards || [])]
    const idx = list.findIndex((x) => x.id === row.id)
    if (idx >= 0) list[idx] = { ...list[idx], ...row }
    else list.push(row)
    data.standards = list
  }
  await persist()
}

watch(() => props.projectId, (id) => {
  if (id) reload()
  else {
    applyPayload({})
    error.value = ''
  }
}, { immediate: true })
</script>

<style scoped>
.semantic-base {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 28px 32px;
  gap: 16px;
}
.sb-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.sb-hero h1 {
  margin: 0 0 6px;
  font-size: 22px;
  color: #0f172a;
}
.sb-desc {
  margin: 0;
  max-width: 720px;
  color: #64748b;
  font-size: 13px;
}
.sb-hero-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.sb-stats {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}
.sb-stats > div {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sb-stats b {
  font-size: 20px;
  color: #1d4ed8;
}
.sb-stats span {
  font-size: 12px;
  color: #94a3b8;
}
.sb-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #e2e8f0;
}
.sb-tab {
  border: none;
  background: transparent;
  padding: 10px 14px;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.sb-tab.active {
  color: #1d4ed8;
  font-weight: 600;
  border-bottom-color: #2563eb;
}
.sb-body {
  flex: 1;
  min-height: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  overflow: auto;
}
.sb-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.sb-toolbar input[type='search'] {
  flex: 1;
  height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 10px;
}
.data-table-wrap { overflow: auto; }
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table th,
.data-table td {
  border-bottom: 1px solid #f1f5f9;
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
.data-table th {
  color: #64748b;
  font-weight: 600;
  background: #f8fafc;
}
.col-def {
  max-width: 280px;
  color: #475569;
}
.empty, .sb-empty, .muted, .hint {
  color: #94a3b8;
}
.sb-error { color: #a51d2d; }
.pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #334155;
  font-size: 11px;
}
.pill.type {
  background: #dcfce7;
  color: #166534;
}
.link {
  border: none;
  background: none;
  color: #2563eb;
  cursor: pointer;
  padding: 0;
}
.hint { font-size: 12px; margin-top: 10px; }
.ghost, .dialog-actions button {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #0f172a;
  cursor: pointer;
}
.primary,
.dialog-actions button.primary {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  background: #2563eb;
  border: 1px solid #2563eb;
  color: #fff;
  cursor: pointer;
}
.modal {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}
.dialog {
  width: min(480px, 92vw);
  background: #fff;
  border-radius: 12px;
  padding: 18px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dialog h2 { margin: 0 0 4px; font-size: 18px; }
.dialog label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #64748b;
}
.dialog input,
.dialog textarea,
.dialog select {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  color: #0f172a;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
@media (max-width: 960px) {
  .sb-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sb-hero { flex-direction: column; }
}
</style>
