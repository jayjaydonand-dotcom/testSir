<template>
  <aside class="tree-pane sdt-pane">
    <div class="tree-toolbar">
      <div class="tree-tabs" role="tablist">
        <button
          type="button"
          class="tree-tab"
          :class="{ 'is-active': pane === 'class' }"
          role="tab"
          :aria-selected="pane === 'class'"
          @click="pane = 'class'"
        >要素</button>
        <button
          type="button"
          class="tree-tab"
          :class="{ 'is-active': pane === 'relation' }"
          role="tab"
          :aria-selected="pane === 'relation'"
          @click="pane = 'relation'"
        >关系</button>
        <button
          type="button"
          class="tree-tab"
          :class="{ 'is-active': pane === 'model' }"
          role="tab"
          :aria-selected="pane === 'model'"
          @click="pane = 'model'"
        >型号</button>
      </div>
      <div class="tree-actions">
        <span class="sdt-legend" title="变更图例">
          <i class="add" />新增
          <i class="mod" />修改
          <i class="del" />删除
        </span>
      </div>
    </div>

    <div class="tree mode-class" :class="'mode-' + pane">
      <StructureDiffTreeNode
        v-for="n in visibleRoots"
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
      <div v-if="!visibleRoots.length" class="sdt-empty">
        {{ emptyHint }}
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed, ref } from 'vue'
import StructureDiffTreeNode from './StructureDiffTreeNode.vue'

const props = defineProps({
  roots: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  activeId: { type: String, default: '' }
})
defineEmits(['toggle-select', 'activate', 'accept', 'reject'])

const pane = ref('class')

function isPropNode(n) {
  const kind = String(n?.kind || '')
  const id = String(n?.id || '')
  return id === 'virtual:properties'
    || /Property|Relation/i.test(kind)
}

function isModelNode(n) {
  const kind = String(n?.kind || '')
  const role = String(n?.uiRole || '')
  return kind === 'Model' || role === 'model'
}

function isProposedBucket(n) {
  const id = String(n?.id || '')
  return id === 'virtual:proposed' || id === 'virtual:proposed-models'
}

/** Strip model children for 要素 tab (same as metamodel tree hides 型号). */
function stripModels(node) {
  if (!node || typeof node !== 'object') return node
  const kids = Array.isArray(node.children) ? node.children.filter((c) => !isModelNode(c)) : []
  return {
    ...node,
    children: kids.map(stripModels)
  }
}

/** Collect model nodes nested under metamodel parents for 型号 tab. */
function collectModelGroups(nodes, acc = []) {
  for (const n of nodes || []) {
    if (isPropNode(n)) continue
    if (String(n.id) === 'virtual:proposed-models') {
      acc.push(n)
      continue
    }
    const modelKids = (n.children || []).filter(isModelNode)
    if (modelKids.length && !isModelNode(n)) {
      acc.push({
        ...n,
        id: `models-under:${n.id}`,
        kind: 'Folder',
        label: n.label,
        children: modelKids.map((m) => ({ ...m, children: [] })),
        change: 'stable'
      })
    }
    collectModelGroups(n.children || [], acc)
    if (isModelNode(n) && !(n.parentIri || n.parentLabel)) {
      // orphan model root
      acc.push({ ...n, children: [] })
    }
  }
  return acc
}

const emptyHint = computed(() => {
  if (pane.value === 'relation') return '暂无关系属性。'
  if (pane.value === 'model') return '暂无型号。接受文档中的型号候选后，会写入 benti:uiRole=model。'
  return '暂无类结构。请先在元模型中建类，或导入文档生成变更。'
})

/** Split mixed backend tree into 要素 / 关系 / 型号 (align 元模型管理 + 模型管理). */
const visibleRoots = computed(() => {
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
          out.push({
            ...n,
            id: 'virtual:proposed-props',
            label: '待挂接关系',
            children: propsOnly
          })
        }
      }
    }
    return out
  }

  if (pane.value === 'model') {
    return collectModelGroups(roots)
  }

  // 要素：元模型层次（隐藏型号子节点，与元模型管理一致）
  return roots
    .filter((n) => !isPropNode(n) && String(n.id) !== 'virtual:proposed-models')
    .map((n) => {
      if (isProposedBucket(n) && Array.isArray(n.children)) {
        const classOnly = n.children.filter((c) => !isPropNode(c) && !isModelNode(c))
        return { ...n, children: classOnly }
      }
      return stripModels(n)
    })
    .filter((n) => !isProposedBucket(n) || (n.children && n.children.length))
})
</script>

<style scoped>
/* Match modeling aside.tree-pane + toolbar + tree rows */
.sdt-pane.tree-pane {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  height: 100%;
  width: 100%;
  background: #eef3fa;
  border-right: none;
  overflow: hidden;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #1c1c1c;
}

.tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.25);
  background: transparent;
  flex: 0 0 auto;
}
.tree-tabs {
  display: inline-flex;
  border-radius: 8px;
  overflow: hidden;
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
.tree-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
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

/* modeling.css .tree-row / twist / glyph / label / badge — kept in sync */
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
:deep(.tree-row:hover) {
  background: rgba(255, 255, 255, 0.55);
}
:deep(.tree-row.is-selected) {
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  color: #1e3a8a;
}
:deep(.tree-row.is-selected .tree-label) {
  color: #1d4ed8;
  font-weight: 600;
}
:deep(.tree-twist) {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  cursor: pointer;
  position: relative;
  color: #94a3b8;
}
:deep(.tree-twist::before) {
  content: "";
  position: absolute;
  left: 5px;
  top: 4px;
  width: 0;
  height: 0;
  border-left: 5px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.12s ease;
}
:deep(.tree-twist.is-expanded::before) {
  transform: rotate(90deg);
  left: 4px;
  top: 5px;
}
:deep(.tree-twist.is-leaf) {
  cursor: default;
  pointer-events: none;
}
:deep(.tree-twist.is-leaf::before) {
  display: none;
}
:deep(.tree-glyph) {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
}
:deep(.tree-glyph svg) { display: block; }
:deep(.tree-row.is-selected .tree-glyph) { color: #2563eb; }
:deep(.tree-badge) {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
:deep(.relation-badge) {
  color: #9a3412;
  background: #ffedd5;
}
:deep(.meta-badge) {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #93c5fd;
}
:deep(.model-badge) {
  background: #fff7ed;
  color: #c2410c;
  border: 1px solid #fdba74;
}
:deep(.model-row .tree-label) {
  font-weight: 600;
  color: #0f172a;
}
:deep(.tree-label) {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 13px;
}
:deep(.prop-row .tree-label) {
  font-weight: 600;
}
:deep(.tree-icon-btn) {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
:deep(.tree-icon-btn:hover:not(:disabled)) {
  color: #2563eb;
  background: rgba(255, 255, 255, 0.7);
}

.sdt-empty {
  color: #94a3b8;
  padding: 36px 16px;
  text-align: center;
  font-size: 13px;
}
</style>
