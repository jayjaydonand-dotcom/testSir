<template>
  <aside class="tree-pane sdt-pane">
    <!-- Same dual modes as App / modeling: 元模型管理 | 模型管理 -->
    <div class="sdt-modes">
      <button
        type="button"
        :class="{ active: mode === 'class' }"
        @click="mode = 'class'"
      >元模型管理</button>
      <button
        type="button"
        :class="{ active: mode === 'instance' }"
        @click="mode = 'instance'"
      >模型管理</button>
    </div>

    <!-- 元模型：要素 | 关系（与 modeling tree-toolbar 一致） -->
    <template v-if="mode === 'class'">
      <div class="tree-toolbar">
        <div class="tree-tabs" role="tablist">
          <button
            type="button"
            class="tree-tab"
            :class="{ 'is-active': pane === 'class' }"
            @click="pane = 'class'"
          >要素</button>
          <button
            type="button"
            class="tree-tab"
            :class="{ 'is-active': pane === 'relation' }"
            @click="pane = 'relation'"
          >关系</button>
        </div>
        <div class="tree-actions">
          <span class="sdt-legend" title="变更图例">
            <i class="add" />新增
            <i class="mod" />修改
            <i class="del" />删除
          </span>
        </div>
      </div>
      <div class="tree mode-class">
        <StructureDiffTreeNode
          v-for="n in metamodelRoots"
          :key="n.id"
          :node="n"
          :depth="0"
          :selected-ids="selectedIds"
          :active-id="activeId"
          @toggle-select="$emit('toggle-select', $event)"
          @activate="$emit('activate', $event)"
          @accept="$emit('accept', $event)"
          @reject="$emit('reject', $event)"
        />
        <div v-if="!metamodelRoots.length" class="sdt-empty">暂无元模型要素。请先在元模型管理中建类，或导入文档生成变更。</div>
      </div>
    </template>

    <!-- 模型管理：知识本体清单（与 modeling instance-list 一致） -->
    <template v-else>
      <div class="aside-head">
        <span>知识本体清单</span>
        <span class="sdt-legend">
          <i class="add" />新增
          <i class="mod" />修改
          <i class="del" />删除
        </span>
      </div>
      <div class="instance-list-search">
        <input v-model="modelFilter" type="search" placeholder="搜索模型名称" autocomplete="off" />
      </div>
      <div class="instance-list">
        <button
          v-for="(m, idx) in filteredModels"
          :key="m.id"
          type="button"
          class="instance-list-item"
          :class="[
            {
              'is-selected': activeId === m.id,
              'chg-add': m.change === 'add',
              'chg-modify': m.change === 'modify',
              'chg-delete': m.change === 'delete'
            }
          ]"
          @click="$emit('activate', m)"
        >
          <label v-if="isPending(m)" class="tree-check" @click.stop>
            <input
              type="checkbox"
              :checked="selectedIds.includes(m.candidateId || m.id)"
              @change="$emit('toggle-select', m.candidateId || m.id)"
            />
          </label>
          <span class="instance-list-seq">{{ idx + 1 }}</span>
          <span class="instance-list-dot" aria-hidden="true" />
          <span class="instance-list-text">
            <span class="instance-list-name">{{ m.label }}</span>
            <span v-if="m.parentLabel" class="instance-list-meta">{{ m.parentLabel }}</span>
          </span>
          <span v-if="isPending(m)" class="tree-badge" :class="changeBadgeClass(m.change)">
            {{ changeLabel(m.change) }}
          </span>
          <span v-if="isPending(m)" class="tree-decide" @click.stop>
            <button type="button" class="tree-icon-btn ok" title="接受" @click="$emit('accept', m)">✓</button>
            <button type="button" class="tree-icon-btn no" title="取消" @click="$emit('reject', m)">✕</button>
          </span>
        </button>
        <p v-if="!filteredModels.length" class="empty instance-list-empty">
          暂无模型。请先在模型管理中新建，或从文档抽取带父元模型的模型候选。
        </p>
      </div>
    </template>
  </aside>
</template>

<script setup>
import { computed, ref } from 'vue'
import StructureDiffTreeNode from './StructureDiffTreeNode.vue'

const props = defineProps({
  roots: { type: Array, default: () => [] },
  models: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  activeId: { type: String, default: '' }
})
defineEmits(['toggle-select', 'activate', 'accept', 'reject'])

const mode = ref('class')
const pane = ref('class')
const modelFilter = ref('')

function isPropNode(n) {
  const kind = String(n?.kind || '')
  const id = String(n?.id || '')
  return id === 'virtual:properties' || /Property|Relation/i.test(kind)
}

function isModelNode(n) {
  return String(n?.kind || '') === 'Model' || String(n?.uiRole || '') === 'model'
}

function isProposedBucket(n) {
  const id = String(n?.id || '')
  return id === 'virtual:proposed' || id === 'virtual:proposed-models'
}

function stripModels(node) {
  if (!node || typeof node !== 'object') return node
  const kids = Array.isArray(node.children) ? node.children.filter((c) => !isModelNode(c)) : []
  return { ...node, children: kids.map(stripModels) }
}

function isPending(m) {
  if (m?.decisionStatus === 'accepted' || m?.decisionStatus === 'rejected') return false
  return m?.change === 'add' || m?.change === 'modify' || m?.change === 'delete'
}

function changeLabel(c) {
  return ({ add: '新增', modify: '修改', delete: '删除' })[c] || ''
}

function changeBadgeClass(c) {
  return ({ add: 'add-badge', modify: 'mod-badge', delete: 'del-badge' })[c] || ''
}

/** 元模型管理：要素树或关系列表（不含模型类，与 modeling 一致） */
const metamodelRoots = computed(() => {
  const roots = Array.isArray(props.roots) ? props.roots : []
  if (pane.value === 'relation') {
    const out = []
    for (const n of roots) {
      if (isPropNode(n)) {
        if (String(n.id) === 'virtual:properties' && Array.isArray(n.children)) {
          out.push(...n.children)
        } else {
          out.push(n)
        }
      } else if (isProposedBucket(n) && Array.isArray(n.children)) {
        const propsOnly = n.children.filter(isPropNode)
        if (propsOnly.length) {
          out.push({ ...n, id: 'virtual:proposed-props', label: '待挂接关系', children: propsOnly })
        }
      }
    }
    return out
  }
  return roots
    .filter((n) => !isPropNode(n) && String(n.id) !== 'virtual:proposed-models')
    .map((n) => {
      if (isProposedBucket(n) && Array.isArray(n.children)) {
        return { ...n, children: n.children.filter((c) => !isPropNode(c) && !isModelNode(c)) }
      }
      return stripModels(n)
    })
    .filter((n) => !isProposedBucket(n) || (n.children && n.children.length))
})

/** 模型管理：后端 models 列表；若空则从树扁平化兜底 */
const allModels = computed(() => {
  if (Array.isArray(props.models) && props.models.length) return props.models
  const acc = []
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (isModelNode(n)) acc.push(n)
      else if (String(n.id) === 'virtual:proposed-models') walk(n.children)
      else walk(n.children)
    }
  }
  walk(props.roots)
  return acc
})

const filteredModels = computed(() => {
  const q = modelFilter.value.trim().toLowerCase()
  if (!q) return allModels.value
  return allModels.value.filter((m) =>
    String(m.label || '').toLowerCase().includes(q)
    || String(m.parentLabel || '').toLowerCase().includes(q)
  )
})
</script>

<style scoped>
.sdt-pane.tree-pane {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  height: 100%;
  width: 100%;
  background: #eef3fa;
  overflow: hidden;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #1c1c1c;
}

.sdt-modes {
  display: flex;
  gap: 0;
  margin: 10px 10px 0;
  border: 1px solid #dbe3ee;
  border-radius: 8px;
  overflow: hidden;
  background: #f8fafc;
  flex: 0 0 auto;
}
.sdt-modes button {
  flex: 1;
  border: none;
  background: transparent;
  color: #475569;
  padding: 7px 10px;
  font-size: 13px;
  cursor: pointer;
}
.sdt-modes button:hover { background: #eef4ff; }
.sdt-modes button.active {
  background: #2563eb;
  color: #fff;
  font-weight: 600;
}

.tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.25);
  flex: 0 0 auto;
}
.tree-tabs {
  display: inline-flex;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.45);
  padding: 2px;
  gap: 2px;
}
.tree-tab {
  border: none;
  background: transparent;
  color: #64748b;
  padding: 5px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
}
.tree-tab.is-active {
  background: #fff;
  color: #2563eb;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}
.sdt-legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
}
.sdt-legend i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
  margin-left: 6px;
}
.sdt-legend i:first-child { margin-left: 0; }
.sdt-legend i.add { background: #22c55e; }
.sdt-legend i.mod { background: #f59e0b; }
.sdt-legend i.del { background: #ef4444; }

.tree {
  padding: 6px 8px 16px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.sdt-empty, .instance-list-empty {
  color: #94a3b8;
  padding: 36px 16px;
  text-align: center;
  font-size: 13px;
}

.aside-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
  font-weight: 600;
  font-size: 13px;
  color: #334155;
  background: #fff;
  flex: 0 0 auto;
}
.instance-list-search {
  padding: 8px 12px;
  border-bottom: 1px solid #eef2f6;
  background: #fff;
  flex: 0 0 auto;
}
.instance-list-search input {
  width: 100%;
  border: 1px solid #dbe3ee;
  border-radius: 8px;
  padding: 6px 10px;
  font: inherit;
  box-sizing: border-box;
}
.instance-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
  background: #fff;
  min-height: 0;
}
.instance-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  margin: 1px 0;
}
.instance-list-item:hover { background: #f1f5f9; }
.instance-list-item.is-selected {
  background: #dbeafe;
  box-shadow: inset 0 0 0 1px #93c5fd;
}
.instance-list-item.chg-add { box-shadow: inset 3px 0 0 #22c55e; background: rgba(220, 252, 231, 0.45); }
.instance-list-item.chg-modify { box-shadow: inset 3px 0 0 #f59e0b; background: rgba(254, 243, 199, 0.55); }
.instance-list-item.chg-delete { box-shadow: inset 3px 0 0 #ef4444; background: rgba(254, 226, 226, 0.5); }
.instance-list-item.chg-add.is-selected,
.instance-list-item.chg-modify.is-selected,
.instance-list-item.chg-delete.is-selected {
  background: #dbeafe;
}
.instance-list-seq { color: #94a3b8; font-size: 12px; width: 22px; flex-shrink: 0; }
.instance-list-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #93c5fd; flex-shrink: 0;
}
.instance-list-item.is-selected .instance-list-dot { background: #2563eb; }
.instance-list-text { display: flex; flex-direction: column; min-width: 0; gap: 2px; flex: 1; }
.instance-list-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.instance-list-meta { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tree-check { display: inline-flex; margin: 0; cursor: pointer; }
.tree-check input { width: 14px; height: 14px; margin: 0; accent-color: #2563eb; }
.tree-badge {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  font-weight: 600;
}
.tree-badge.add-badge { color: #166534; background: #dcfce7; border: 1px solid #86efac; }
.tree-badge.mod-badge { color: #92400e; background: #fef3c7; border: 1px solid #fcd34d; }
.tree-badge.del-badge { color: #991b1b; background: #fee2e2; border: 1px solid #fca5a5; }
.tree-badge.ok-badge { color: #166534; background: #dcfce7; border: 1px solid #86efac; }
.tree-badge.no-badge { color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0; }
.tree-decide { display: inline-flex; gap: 1px; margin-left: auto; }
.tree-icon-btn {
  width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.tree-icon-btn.ok { color: #15803d; }
.tree-icon-btn.no { color: #b91c1c; }
.tree-icon-btn:hover { background: #f1f5f9; }

/* shared tree-row chrome for metamodel pane */
:deep(.tree-row) {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 5px 8px 5px calc(6px + var(--depth, 0) * 16px);
  margin: 1px 0;
  border-radius: 8px;
  cursor: pointer;
  position: relative;
  color: #334155;
}
:deep(.tree-row:hover) { background: rgba(255, 255, 255, 0.55); }
:deep(.tree-row.is-selected) {
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  color: #1e3a8a;
}
:deep(.tree-row.is-selected .tree-label) { color: #1d4ed8; font-weight: 600; }
:deep(.tree-twist) {
  flex: 0 0 16px; width: 16px; height: 16px; border: none; background: transparent;
  padding: 0; margin: 0; cursor: pointer; position: relative; color: #94a3b8;
}
:deep(.tree-twist::before) {
  content: ""; position: absolute; left: 5px; top: 4px; width: 0; height: 0;
  border-left: 5px solid currentColor; border-top: 4px solid transparent; border-bottom: 4px solid transparent;
}
:deep(.tree-twist.is-expanded::before) { transform: rotate(90deg); left: 4px; top: 5px; }
:deep(.tree-twist.is-leaf) { cursor: default; pointer-events: none; }
:deep(.tree-twist.is-leaf::before) { display: none; }
:deep(.tree-glyph) {
  flex: 0 0 18px; width: 18px; height: 18px; display: inline-flex;
  align-items: center; justify-content: center; color: #64748b;
}
:deep(.tree-row.is-selected .tree-glyph) { color: #2563eb; }
:deep(.tree-badge) {
  flex: 0 0 auto; font-size: 11px; line-height: 1; padding: 3px 6px;
  border-radius: 4px; font-weight: 600;
}
:deep(.relation-badge) { color: #9a3412; background: #ffedd5; }
:deep(.meta-badge) { background: #eff6ff; color: #1d4ed8; border: 1px solid #93c5fd; }
:deep(.model-badge) { background: #fff7ed; color: #c2410c; border: 1px solid #fdba74; }
:deep(.tree-label) {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-weight: 500; font-size: 13px;
}
:deep(.tree-icon-btn) {
  width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent;
  color: #64748b; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
</style>
