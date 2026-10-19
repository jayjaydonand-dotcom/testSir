<template>
  <div class="app-frame">
    <header class="app-shell">
      <div class="shell-brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
            <circle cx="16" cy="16" r="16" fill="#2563eb"/>
            <path d="M16 7.5L23 11.5V19.5L16 23.5L9 19.5V11.5L16 7.5Z" stroke="#fff" stroke-width="1.6" fill="rgba(255,255,255,0.15)"/>
            <path d="M16 12.2L19.8 14.4V18.6L16 20.8L12.2 18.6V14.4L16 12.2Z" fill="#fff"/>
          </svg>
        </span>
        <span class="brand-text">基于本体的知识管理系统</span>
      </div>
      <nav class="shell-nav" aria-label="主导航">
        <button
          type="button"
          class="shell-nav-item"
          :class="{ 'is-active': module === 'domains' }"
          @click="goDomains"
        >
          <svg class="nav-ico" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 100 16A8 8 0 0010 2zm6.5 7.5h-3.1a13.4 13.4 0 00-1.2-4.4A6.5 6.5 0 0116.5 9.5zM10 3.5c.7 0 2.1 1.7 2.7 4.5H7.3C7.9 5.2 9.3 3.5 10 3.5zM3.5 10.5h3.1c.2 1.6.6 3.1 1.2 4.4A6.5 6.5 0 013.5 10.5zm3.1-1H3.5a6.5 6.5 0 014.3-4.4A13.4 13.4 0 006.6 9.5zm1.2 1h5.4c-.2 1.7-.7 3.3-1.4 4.5-.3.5-.7.9-1.3.9s-1-.4-1.3-.9c-.7-1.2-1.2-2.8-1.4-4.5zm5.6 0h3.1a6.5 6.5 0 01-4.3 4.4c.6-1.3 1-2.8 1.2-4.4zM10 16.5c-.7 0-2.1-1.7-2.7-4.5h5.4c-.6 2.8-2 4.5-2.7 4.5z"/></svg>
          领域管理
        </button>
        <button
          type="button"
          class="shell-nav-item"
          :class="{ 'is-active': module === 'class' }"
          @click="openWorkspace('class')"
        >
          <svg class="nav-ico" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2.2L17 6v8l-7 3.8L3 14V6l7-3.8zm0 1.8L5 7v6l5 2.7L15 13V7l-5-3z"/><path fill="currentColor" d="M10 7.2l3.2 1.7v3.2L10 13.8 6.8 12.1V8.9L10 7.2z"/></svg>
          元模型管理
        </button>
        <button
          type="button"
          class="shell-nav-item"
          :class="{ 'is-active': module === 'instance' }"
          @click="openWorkspace('instance')"
        >
          <svg class="nav-ico" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M3 4.5h14v2.2H3V4.5zm0 4.4h14v2.2H3V8.9zm0 4.4h14V15.5H3v-2.2z"/></svg>
          模型管理
        </button>
        <button
          type="button"
          class="shell-nav-item"
          :class="{ 'is-active': module === 'semantic' }"
          @click="openWorkspace('semantic')"
        >
          <svg class="nav-ico" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6L10 2.5zm0 2.1L5.5 7v5.8L10 15.4l4.5-2.6V7L10 4.6zM10 8.2l2.4 1.4v2.7L10 13.7 7.6 12.3V9.6L10 8.2z"/></svg>
          语义底座
        </button>
        <button
          type="button"
          class="shell-nav-item"
          :class="{ 'is-active': module === 'docintel' }"
          @click="openWorkspace('docintel')"
        >
          <svg class="nav-ico" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M4 3.5h8l4 4V16.5H4V3.5zm8 1.2v2.8h2.8L12 4.7zM6.2 9h7.6v1.4H6.2V9zm0 3h7.6v1.4H6.2V12zm0 3h5v1.4h-5V15z"/></svg>
          智能构建
        </button>
        <button
          type="button"
          class="shell-nav-item"
          :class="{ 'is-active': module === 'rules' }"
          @click="openWorkspace('rules')"
        >
          <svg class="nav-ico" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M5 3.5h10a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0115 16.5H5A1.5 1.5 0 013.5 15V5A1.5 1.5 0 015 3.5zm0 1.5v10h10V5H5zm2 2h6v1.5H7V7zm0 3h6v1.5H7V10zm0 3h4V14.5H7V13z"/></svg>
          案例库
        </button>
      </nav>
      <div class="shell-tools">
        <div class="global-search" :class="{ open: globalSearch.open && globalSearch.query.trim() }">
          <form class="global-search-form" @submit.prevent="submitGlobalSearch">
            <span class="global-search-ico" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="15" height="15"><path fill="currentColor" d="M8.5 3a5.5 5.5 0 014.36 8.86l3.64 3.64-1.06 1.06-3.64-3.64A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z"/></svg>
            </span>
            <input
              v-model="globalSearch.query"
              class="global-search-input"
              type="search"
              autocomplete="off"
              placeholder="搜索元模型 / 模型"
              :disabled="!workspaceReady"
              @focus="onGlobalSearchFocus"
              @input="onGlobalSearchInput"
              @keydown.down.prevent="moveGlobalSearch(1)"
              @keydown.up.prevent="moveGlobalSearch(-1)"
              @keydown.esc="closeGlobalSearch"
            />
            <button type="submit" class="global-search-btn" :disabled="!workspaceReady">搜索</button>
          </form>
          <div
            v-if="globalSearch.open && workspaceReady && globalSearch.query.trim()"
            class="global-search-panel"
            role="listbox"
          >
            <p v-if="globalSearch.pending" class="global-search-empty">搜索中…</p>
            <p v-else-if="!globalSearch.results.length" class="global-search-empty">无匹配的元模型或模型</p>
            <button
              v-for="(item, idx) in globalSearch.results"
              :key="item.kind + ':' + item.iri"
              type="button"
              class="global-search-item"
              :class="{ active: idx === globalSearch.activeIndex }"
              role="option"
              @mousedown.prevent="pickGlobalSearch(item)"
            >
              <span class="global-search-kind" :data-kind="item.kind">{{ item.kind === 'model' || item.kind === 'instance' ? '模型' : '元模型' }}</span>
              <span class="global-search-label">{{ item.label }}</span>
              <span v-if="item.hint" class="global-search-hint">{{ item.hint }}</span>
            </button>
          </div>
        </div>
        <button
          v-if="workspaceReady"
          type="button"
          class="shell-reason-btn"
          title="使用 HermiT 检查当前领域本体一致性"
          @click="runConsistency"
        >推理</button>
        <span class="shell-user">管理员</span>
      </div>
    </header>

    <header class="subhead">
      <nav class="crumb" aria-label="面包屑">
        <template v-if="module === 'domains'">
          <span>领域管理</span>
          <span class="crumb-sep">/</span>
          <span class="crumb-current">{{ showTrash ? '回收站' : '全部' }}</span>
        </template>
        <template v-else>
          <template v-for="(c, i) in workspaceCrumbs" :key="i">
            <span v-if="i" class="crumb-sep">/</span>
            <button
              v-if="c.iri"
              type="button"
              class="crumb-link"
              :class="{ 'is-current': i === workspaceCrumbs.length - 1 }"
              @click="jumpCrumb(c)"
            >{{ c.label }}</button>
            <span
              v-else
              :class="{ 'crumb-current': i === workspaceCrumbs.length - 1 }"
            >{{ c.label }}</span>
          </template>
        </template>
      </nav>
      <div class="subhead-meta">
        <template v-if="module === 'domains'">
          <button
            type="button"
            class="view-toggle"
            :class="{ active: !showTrash }"
            @click="showTrash = false"
          >全部领域</button>
          <button
            type="button"
            class="view-toggle"
            :class="{ active: showTrash }"
            @click="showTrash = true"
          >回收站</button>
          <span class="chip">{{ filteredProjects.length }} 个领域</span>
        </template>
        <template v-else>
          <label class="domain-select-label">
            <span>所属领域：</span>
            <select class="domain-select" :value="activeProjectId" @change="onDomainChange">
              <option v-for="p in activeProjects" :key="pidOf(p)" :value="pidOf(p)">
                {{ p.displayName || pidOf(p) }}
              </option>
            </select>
          </label>
        </template>
      </div>
    </header>

    <div v-if="status" class="hub-status" :class="{ ok: statusOk, err: statusErr }">{{ status }}</div>

    <section v-if="module === 'domains'" class="hub domain-page">
      <div class="domain-toolbar">
        <form class="domain-search-bar" @submit.prevent="runSearch">
          <div class="search-box">
            <span class="search-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="16" height="16"><path fill="currentColor" d="M8.5 3a5.5 5.5 0 014.36 8.86l3.64 3.64-1.06 1.06-3.64-3.64A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z"/></svg>
            </span>
            <input
              v-model="searchInput"
              class="domain-search"
              placeholder="输入领域名称搜索"
            />
          </div>
          <button type="submit" class="search-btn">
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8.5 3a5.5 5.5 0 014.36 8.86l3.64 3.64-1.06 1.06-3.64-3.64A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z"/></svg>
            搜索
          </button>
        </form>
        <div class="toolbar-actions">
          <button
            type="button"
            class="ghost batch-btn"
            :class="{ active: batchMode }"
            :disabled="busy"
            @click="toggleBatchMode"
          >{{ batchMode ? '完成选择' : '批量管理' }}</button>
          <button
            v-if="batchMode"
            type="button"
            class="ghost batch-btn danger-outline"
            :disabled="busy || !selectedIds.length"
            @click="onBatchTrash"
          >{{ showTrash ? '批量恢复' : '批量删除' }} ({{ selectedIds.length }})</button>
          <button type="button" class="primary add-btn" :disabled="busy" @click="openCreateDialog">+ 新增</button>
        </div>
      </div>

      <div v-if="pagedProjects.length" class="domain-grid">
        <article
          v-for="p in pagedProjects"
          :key="pidOf(p)"
          class="domain-card"
          :class="[
            cardTone(p),
            {
              trash: p.inTrash,
              'menu-open': openMenuId === pidOf(p),
              selected: selectedIds.includes(pidOf(p)),
              'batch-mode': batchMode
            }
          ]"
          @click="onCardClick(p)"
        >
          <div class="card-accent"></div>
          <label v-if="batchMode" class="card-check" @click.stop>
            <input
              type="checkbox"
              :checked="selectedIds.includes(pidOf(p))"
              @change="toggleSelect(pidOf(p))"
            />
          </label>
          <header class="card-head">
            <h3>{{ p.displayName || pidOf(p) }}</h3>
            <div class="card-more-wrap" @click.stop>
              <button
                type="button"
                class="card-more"
                title="更多"
                @click="toggleMenu(pidOf(p))"
              >⋯</button>
              <div v-if="openMenuId === pidOf(p)" class="card-menu">
                <template v-if="!p.inTrash">
                  <button type="button" @click="openEditDialog(p); closeMenu()">编辑</button>
                  <button type="button" @click="openExportDialog(p); closeMenu()">导出</button>
                  <button type="button" class="menu-danger" @click="onTrash(p); closeMenu()">删除</button>
                </template>
                <button v-else type="button" @click="onRestore(p); closeMenu()">恢复</button>
              </div>
            </div>
          </header>
          <p class="card-desc">{{ p.description || '暂无描述' }}</p>
        </article>
      </div>
      <p v-else class="domain-empty">
        {{ showTrash ? '回收站为空。' : '暂无领域，点击「+ 新增」开始。' }}
      </p>

      <div class="pager" v-if="filteredProjects.length > pageSize">
        <button :disabled="projectPage <= 1" @click="projectPage--">上一页</button>
        <span>第 {{ projectPage }} / {{ totalPages }} 页</span>
        <button :disabled="projectPage >= totalPages" @click="projectPage++">下一页</button>
      </div>
    </section>

    <SemanticBasePanel
      v-else-if="module === 'semantic' && activeProjectId"
      :key="'sb-' + activeProjectId"
      class="workspace-pane"
      :project-id="activeProjectId"
    />

    <DocIntelPanel
      v-else-if="module === 'docintel' && activeProjectId"
      :key="'di-' + activeProjectId"
      class="workspace-pane"
      :project-id="activeProjectId"
    />

    <ModelingWorkspace
      v-else-if="activeProjectId && (module === 'class' || module === 'instance' || module === 'rules')"
      :key="activeProjectId"
      class="workspace-pane"
      :project-id="activeProjectId"
      :mode="module"
    />

    <div v-if="dialog.open" class="modal" @click.self="dialog.open = false">
      <div class="dialog">
        <h2>{{ dialog.mode === 'create' ? '新增领域' : '编辑领域' }}</h2>
        <label>名称<input v-model="dialog.displayName" placeholder="领域名称" /></label>
        <label>描述<textarea v-model="dialog.description" rows="3" placeholder="可选"></textarea></label>
        <div v-if="dialog.mode === 'create'" class="upload-block">
          <label class="upload-label">从已有本体文件创建（可选）</label>
          <input
            ref="fileInputRef"
            type="file"
            class="file-input"
            accept=".owl,.owx,.rdf,.ttl,.obo,.ofn,.omn,.xml,.zip,application/rdf+xml,text/turtle"
            @change="onSourceFileChange"
          />
          <div v-if="dialog.fileName" class="file-picked">
            已选：<strong>{{ dialog.fileName }}</strong>
            <button type="button" class="ghost tiny-btn" @click="clearSourceFile">清除</button>
          </div>
        </div>
        <div class="dialog-actions">
          <button @click="dialog.open = false">取消</button>
          <button class="primary" :disabled="busy || !dialog.displayName.trim()" @click="submitDialog">
            {{ dialog.mode === 'create' && dialog.file ? '上传并创建' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="exportDialog.open" class="modal" @click.self="exportDialog.open = false">
      <div class="dialog">
        <h2>导出本体</h2>
        <p class="help">将「{{ exportDialog.displayName }}」导出为可下载的本体文件（与 WebProtege Download 一致）。</p>
        <label>格式
          <select v-model="exportDialog.format">
            <option value="owl">OWL / RDF/XML (.owl)</option>
            <option value="owx">OWL/XML (.owx)</option>
            <option value="ttl">Turtle (.ttl)</option>
            <option value="omn">Manchester (.omn)</option>
            <option value="ofn">Functional (.ofn)</option>
          </select>
        </label>
        <div class="dialog-actions">
          <button @click="exportDialog.open = false">取消</button>
          <button class="primary" :disabled="busy" @click="submitExport">下载</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ModelingWorkspace from './components/ModelingWorkspace.vue'
import SemanticBasePanel from './components/SemanticBasePanel.vue'
import DocIntelPanel from './components/DocIntelPanel.vue'
import * as api from './api/onto'

const LAST_PROJECT_KEY = 'benti.lastProjectId'
const pageSize = 20
/** domains | class | instance | rules */
const module = ref('domains')
const projects = ref([])
const activeProjectId = ref('')
const modelingCrumbs = ref([])
const status = ref('')
const statusOk = ref(false)
const statusErr = ref(false)
const busy = ref(false)
const searchInput = ref('')
const projectQuery = ref('')
const showTrash = ref(false)
const projectPage = ref(1)
const openMenuId = ref('')
const selectedIds = ref([])
const batchMode = ref(false)
const fileInputRef = ref(null)
const globalSearch = reactive({
  query: '',
  open: false,
  pending: false,
  results: [],
  activeIndex: 0,
  requestId: 0
})
let globalSearchTimer = null
const dialog = reactive({
  open: false,
  mode: 'create',
  projectId: '',
  displayName: '',
  description: '',
  file: null,
  fileName: ''
})
const exportDialog = reactive({
  open: false,
  projectId: '',
  displayName: '',
  format: 'owl'
})

const MODULE_LABELS = {
  domains: '领域管理',
  class: '元模型管理',
  instance: '模型管理',
  semantic: '语义底座',
  docintel: '智能构建',
  rules: '案例库'
}

const pidOf = (p) => (p && (p.projectId || p._id)) || ''

const moduleLabel = computed(() => MODULE_LABELS[module.value] || '领域管理')
const activeProjects = computed(() => projects.value.filter((p) => !p.inTrash))
const workspaceReady = computed(() =>
  !!activeProjectId.value &&
  (module.value === 'class' || module.value === 'instance' || module.value === 'rules')
)
const workspaceCrumbs = computed(() => {
  if (module.value === 'semantic') {
    return [
      { label: '语义底座', iri: null, kind: 'module' },
      { label: '术语 · 指标 · 标准', iri: null, kind: 'static' }
    ]
  }
  if (module.value === 'docintel') {
    return [
      { label: '智能构建', iri: null, kind: 'module' },
      { label: '文档 · 分块 · 审核入库', iri: null, kind: 'static' }
    ]
  }
  if (modelingCrumbs.value && modelingCrumbs.value.length) {
    return modelingCrumbs.value
  }
  const fallback = [{ label: moduleLabel.value, iri: null, kind: 'module' }]
  if (activeProjectId.value) {
    fallback.push({ label: '要素', iri: null, kind: 'static' })
  }
  return fallback
})

function jumpCrumb(crumb) {
  if (!crumb || !crumb.iri) return
  window.dispatchEvent(new CustomEvent('modeling-navigate-class', {
    detail: { iri: crumb.iri }
  }))
}

function onModelingChrome(event) {
  const detail = (event && event.detail) || {}
  modelingCrumbs.value = Array.isArray(detail.crumbs) ? detail.crumbs : []
  if (
    detail.mode === 'class' ||
    detail.mode === 'instance' ||
    detail.mode === 'rules'
  ) {
    if (module.value !== 'domains') {
      module.value = detail.mode
    }
  }
}

function onAppOpenModule(event) {
  const mode = event && event.detail && event.detail.module
  if (!mode) return
  if (mode === 'domains') {
    goDomains()
    return
  }
  openWorkspace(mode)
}

function onGlobalSearchResults(event) {
  const detail = (event && event.detail) || {}
  if (detail.requestId != null && detail.requestId !== globalSearch.requestId) return
  globalSearch.pending = false
  globalSearch.results = Array.isArray(detail.results) ? detail.results : []
  globalSearch.activeIndex = 0
  globalSearch.open = true
}

function requestGlobalSearch(options = {}) {
  if (!workspaceReady.value) {
    globalSearch.results = []
    globalSearch.pending = false
    return
  }
  const query = globalSearch.query.trim()
  globalSearch.requestId += 1
  const requestId = globalSearch.requestId
  if (!query) {
    globalSearch.pending = false
    globalSearch.results = []
    window.dispatchEvent(new CustomEvent('modeling-global-search', {
      detail: { query: '', requestId, clear: true }
    }))
    return
  }
  globalSearch.pending = true
  globalSearch.open = true
  window.dispatchEvent(new CustomEvent('modeling-global-search', {
    detail: {
      query,
      requestId,
      navigateFirst: !!options.navigateFirst,
      highlight: options.highlight !== false
    }
  }))
}

function onGlobalSearchInput() {
  if (globalSearchTimer) clearTimeout(globalSearchTimer)
  globalSearchTimer = setTimeout(() => {
    requestGlobalSearch({ highlight: true })
  }, 180)
}

function onGlobalSearchFocus() {
  if (!workspaceReady.value) return
  globalSearch.open = true
  if (globalSearch.query.trim()) requestGlobalSearch({ highlight: true })
}

function closeGlobalSearch() {
  globalSearch.open = false
  globalSearch.activeIndex = 0
}

function moveGlobalSearch(delta) {
  if (!globalSearch.results.length) return
  const n = globalSearch.results.length
  globalSearch.activeIndex = (globalSearch.activeIndex + delta + n) % n
}

function pickGlobalSearch(item) {
  if (!item || !item.iri) return
  window.dispatchEvent(new CustomEvent('modeling-navigate-entity', {
    detail: {
      iri: item.iri,
      kind: item.kind === 'model' || item.kind === 'instance' ? '模型' : '类'
    }
  }))
  if (item.kind === 'model' || item.kind === 'instance') module.value = 'instance'
  else module.value = 'class'
  globalSearch.open = false
}

function submitGlobalSearch() {
  if (!workspaceReady.value) {
    setStatus('请先进入元模型或模型管理后再搜索。', false, true)
    return
  }
  const q = globalSearch.query.trim()
  if (!q) {
    requestGlobalSearch({ clear: true })
    return
  }
  if (globalSearch.results.length && globalSearch.activeIndex >= 0) {
    pickGlobalSearch(globalSearch.results[globalSearch.activeIndex])
    return
  }
  requestGlobalSearch({ navigateFirst: true, highlight: true })
}

function runConsistency() {
  if (!workspaceReady.value) {
    setStatus('请先进入元模型或模型管理后再推理。', false, true)
    return
  }
  window.dispatchEvent(new CustomEvent('modeling-run-consistency'))
}

const CARD_TONES = ['tone-blue', 'tone-green', 'tone-orange', 'tone-violet']

function hashName(text) {
  const s = String(text || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function cardTone(p) {
  if (p && p.inTrash) return 'tone-muted'
  return CARD_TONES[hashName(p && (p.displayName || pidOf(p))) % CARD_TONES.length]
}

function rememberProject(id) {
  if (!id) return
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id)
  } catch (e) { /* ignore */ }
}

function lastProjectId() {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) || ''
  } catch (e) {
    return ''
  }
}

const visibleProjects = computed(() =>
  projects.value.filter((p) => (showTrash.value ? !!p.inTrash : !p.inTrash))
)
const filteredProjects = computed(() => {
  const q = projectQuery.value.trim().toLowerCase()
  if (!q) return visibleProjects.value
  return visibleProjects.value.filter((p) => {
    const name = String(p.displayName || '').toLowerCase()
    const desc = String(p.description || '').toLowerCase()
    return name.includes(q) || desc.includes(q) || pidOf(p).toLowerCase().includes(q)
  })
})
const totalPages = computed(() => Math.max(1, Math.ceil(filteredProjects.value.length / pageSize) || 1))
const pagedProjects = computed(() => {
  const page = Math.min(Math.max(1, projectPage.value), totalPages.value)
  const start = (page - 1) * pageSize
  return filteredProjects.value.slice(start, start + pageSize)
})

watch([projectQuery, showTrash], () => {
  projectPage.value = 1
  selectedIds.value = []
  closeMenu()
})

function runSearch() {
  projectQuery.value = searchInput.value.trim()
}

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  if (!batchMode.value) selectedIds.value = []
}

function onCardClick(p) {
  if (batchMode.value) {
    toggleSelect(pidOf(p))
    return
  }
  if (!p.inTrash) enterModeling(p, 'class')
}

function toggleSelect(id) {
  if (!id) return
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
  } else {
    selectedIds.value = selectedIds.value.concat([id])
  }
}

async function onBatchTrash() {
  const ids = selectedIds.value.slice()
  if (!ids.length) return
  const verb = showTrash.value ? '恢复' : '删除'
  if (!window.confirm('确定' + verb + '选中的 ' + ids.length + ' 个领域？')) return
  busy.value = true
  try {
    for (const id of ids) {
      if (showTrash.value) await api.restoreProject(id)
      else await api.trashProject(id)
    }
    selectedIds.value = []
    batchMode.value = false
    await loadProjects()
    setStatus(showTrash.value ? '已恢复所选领域' : '已将所选领域移入回收站', true, false)
  } catch (e) {
    setStatus(e.message || String(e), false, true)
  } finally {
    busy.value = false
  }
}

function toggleMenu(id) {
  openMenuId.value = openMenuId.value === id ? '' : id
}
function closeMenu() {
  openMenuId.value = ''
}

function onPageClick(event) {
  if (event.target && event.target.closest && event.target.closest('.card-more-wrap')) return
  closeMenu()
  if (event.target && event.target.closest && event.target.closest('.global-search')) return
  closeGlobalSearch()
}

function setStatus(text, ok, err) {
  status.value = text || ''
  statusOk.value = !!ok
  statusErr.value = !!err
}

function goDomains() {
  module.value = 'domains'
  modelingCrumbs.value = []
  globalSearch.query = ''
  globalSearch.results = []
  globalSearch.open = false
  setStatus('', false, false)
  loadProjects()
}

function enterModeling(p, mode) {
  const id = pidOf(p)
  if (!id) return
  rememberProject(id)
  activeProjectId.value = id
  module.value = mode || 'class'
  if (mode === 'semantic' || mode === 'docintel') {
    modelingCrumbs.value = []
  }
}

function onDomainChange(event) {
  const id = event.target && event.target.value
  if (!id) return
  rememberProject(id)
  activeProjectId.value = id
}

/** Top nav: switch module; keep shell, only content changes. */
function openWorkspace(mode) {
  const active = activeProjects.value
  if (!active.length) {
    setStatus('请先新增并选择一个领域。', false, true)
    module.value = 'domains'
    return
  }
  const remembered = lastProjectId()
  let target = active.find((p) => pidOf(p) === remembered)
  if (!target && activeProjectId.value) {
    target = active.find((p) => pidOf(p) === activeProjectId.value)
  }
  if (!target) target = active[0]
  enterModeling(target, mode)
}

function openCreateDialog() {
  dialog.open = true
  dialog.mode = 'create'
  dialog.projectId = ''
  dialog.displayName = '领域-' + Date.now().toString().slice(-6)
  dialog.description = ''
  clearSourceFile()
}
function openEditDialog(p) {
  dialog.open = true
  dialog.mode = 'edit'
  dialog.projectId = pidOf(p)
  dialog.displayName = p.displayName || ''
  dialog.description = p.description || ''
  clearSourceFile()
}

function openExportDialog(p) {
  exportDialog.open = true
  exportDialog.projectId = pidOf(p)
  exportDialog.displayName = p.displayName || pidOf(p)
  exportDialog.format = 'owl'
}

async function submitExport() {
  const id = exportDialog.projectId
  const format = exportDialog.format || 'owl'
  if (!id) return
  busy.value = true
  try {
    setStatus('正在导出「' + exportDialog.displayName + '」…', false, false)
    const result = await api.exportOntology(id, format)
    exportDialog.open = false
    setStatus('已下载 ' + (result.fileName || ('本体.' + format)), true, false)
  } catch (e) {
    setStatus(e.message || String(e), false, true)
  } finally {
    busy.value = false
  }
}

function onSourceFileChange(ev) {
  const f = ev.target && ev.target.files && ev.target.files[0]
  if (!f) {
    dialog.file = null
    dialog.fileName = ''
    return
  }
  dialog.file = f
  dialog.fileName = f.name
}

function clearSourceFile() {
  dialog.file = null
  dialog.fileName = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}

async function submitDialog() {
  const name = dialog.displayName.trim()
  if (!name) return
  busy.value = true
  try {
    if (dialog.mode === 'create') {
      try {
        await api.health()
      } catch (e) {
        throw new Error(
          (e && e.message) ||
          '无法连接后端。请先启动 ontology-backend（默认 http://127.0.0.1:18090），并保持前端 Vite 运行。'
        )
      }
      let documentId = null
      if (dialog.file) {
        setStatus('正在上传「' + dialog.fileName + '」…', false, false)
        const uploaded = await api.uploadSource(dialog.file)
        documentId = uploaded && uploaded.documentId
        if (!documentId) throw new Error('上传成功但未返回 documentId')
      }
      setStatus(documentId ? '正在从本体文件创建领域…' : '正在创建空领域…', false, false)
      const created = await api.createProject(name, dialog.description || '', documentId)
      const createdId = pidOf(created)
      if (!createdId) throw new Error('创建成功但未返回 projectId')
      await loadProjects()
      dialog.open = false
      clearSourceFile()
      setStatus(
        documentId
          ? '已从本体文件创建领域，正在打开元模型…'
          : '已创建领域「' + name + '」',
        true,
        false
      )
      enterModeling(created, 'class')
    } else {
      await api.updateProject(dialog.projectId, name, dialog.description || '')
      await loadProjects()
      dialog.open = false
      setStatus('已更新领域「' + name + '」', true, false)
    }
  } catch (e) {
    setStatus(e.message || String(e), false, true)
  } finally {
    busy.value = false
  }
}

async function onTrash(p) {
  const id = pidOf(p)
  if (!window.confirm('将领域「' + (p.displayName || id) + '」移入回收站？')) return
  busy.value = true
  try {
    await api.trashProject(id)
    await loadProjects()
    setStatus('已移入回收站', true, false)
  } catch (e) {
    setStatus(e.message || String(e), false, true)
  } finally {
    busy.value = false
  }
}

async function onRestore(p) {
  busy.value = true
  try {
    await api.restoreProject(pidOf(p))
    await loadProjects()
    setStatus('已恢复项目', true, false)
  } catch (e) {
    setStatus(e.message || String(e), false, true)
  } finally {
    busy.value = false
  }
}

async function loadProjects() {
  busy.value = true
  try {
    const list = await api.listProjects()
    projects.value = (list || []).map((p) => ({ ...p, projectId: p.projectId || p._id }))
    setStatus('', false, false)
  } catch (e) {
    setStatus(e.message || String(e), false, true)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', onPageClick)
  window.addEventListener('modeling-chrome', onModelingChrome)
  window.addEventListener('modeling-search-results', onGlobalSearchResults)
  window.addEventListener('app-open-module', onAppOpenModule)
  const params = new URLSearchParams(window.location.search)
  const project = params.get('project')
  const modeParam = params.get('mode')
  await loadProjects()
  if (project) {
    const found = projects.value.find((p) => pidOf(p) === project && !p.inTrash)
    if (found) {
      const mode = modeParam === 'instance' || modeParam === 'rules' ? modeParam : 'class'
      enterModeling(found, mode)
    }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onPageClick)
  window.removeEventListener('modeling-chrome', onModelingChrome)
  window.removeEventListener('modeling-search-results', onGlobalSearchResults)
  window.removeEventListener('app-open-module', onAppOpenModule)
  if (globalSearchTimer) clearTimeout(globalSearchTimer)
})
</script>
