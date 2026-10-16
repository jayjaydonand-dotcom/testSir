<template>
  <div class="sdt-node">
    <div
      class="tree-row"
      :class="[
        rowKindClass,
        {
          'is-selected': activeId === node.id,
          'is-open': open && hasChildren,
          'is-leaf': !hasChildren,
          'chg-add': change === 'add',
          'chg-modify': change === 'modify',
          'chg-delete': change === 'delete'
        }
      ]"
      :style="{ '--depth': depth }"
      @click="$emit('activate', node)"
    >
      <button
        v-if="hasChildren"
        type="button"
        class="tree-twist"
        :class="{ 'is-expanded': open }"
        :aria-label="open ? '收起' : '展开'"
        @click.stop="open = !open"
      />
      <span v-else class="tree-twist is-leaf" aria-hidden="true" />

      <span class="tree-glyph" aria-hidden="true">
        <svg v-if="isFolder" viewBox="0 0 20 20" width="16" height="16">
          <path d="M3.5 6.2h4.2l1.2 1.4H16.5v7.2H3.5V6.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
        <svg v-else-if="isRelation" viewBox="0 0 20 20" width="16" height="16">
          <path d="M4 10h9.5M11 6.5l3.5 3.5L11 13.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else-if="isModel" viewBox="0 0 20 20" width="16" height="16">
          <rect x="4" y="5" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/>
          <path d="M7 8.5h6M7 11.5h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <svg v-else viewBox="0 0 20 20" width="16" height="16">
          <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/>
          <path d="M7 8h6M7 10.5h6M7 13h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </span>

      <label v-if="isPendingChange" class="tree-check" @click.stop>
        <input
          type="checkbox"
          :checked="isSelected"
          @change="$emit('toggle-select', node.candidateId || node.id)"
        />
      </label>

      <span class="tree-badge" :class="kindBadgeClass" v-if="kindBadge">{{ kindBadge }}</span>

      <span class="tree-label" :title="displayLabel">{{ displayLabel }}</span>

      <span v-if="isPendingChange" class="tree-badge" :class="changeBadgeClass">{{ changeLabel }}</span>

      <span v-if="isPendingChange" class="tree-decide" @click.stop>
        <button type="button" class="tree-icon-btn ok" title="接受" aria-label="接受" @click="$emit('accept', node)">✓</button>
        <button type="button" class="tree-icon-btn no" title="取消" aria-label="取消" @click="$emit('reject', node)">✕</button>
      </span>
    </div>

    <template v-if="open && hasChildren">
      <StructureDiffTreeNode
        v-for="ch in node.children"
        :key="ch.id"
        :node="ch"
        :depth="depth + 1"
        :selected-ids="selectedIds"
        :active-id="activeId"
        @toggle-select="$emit('toggle-select', $event)"
        @activate="$emit('activate', $event)"
        @accept="$emit('accept', $event)"
        @reject="$emit('reject', $event)"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

defineOptions({ name: 'StructureDiffTreeNode' })

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  selectedIds: { type: Array, default: () => [] },
  activeId: { type: String, default: '' }
})
defineEmits(['toggle-select', 'activate', 'accept', 'reject'])

const open = ref(true)
const hasChildren = computed(() => Array.isArray(props.node.children) && props.node.children.length > 0)
const change = computed(() => String(props.node.change || 'stable'))
const isPendingChange = computed(() =>
  ['add', 'modify', 'delete'].includes(change.value)
  && !['accepted', 'rejected'].includes(String(props.node.decisionStatus || ''))
)
const isSelected = computed(() => {
  const id = props.node.candidateId || props.node.id
  return props.selectedIds.includes(id)
})

const kind = computed(() => String(props.node.kind || 'Class'))
const isFolder = computed(() => kind.value === 'Folder' || String(props.node.id || '').startsWith('virtual:'))
const isRelation = computed(() => /Property|Relation/i.test(kind.value))
const isModel = computed(() =>
  kind.value === 'Model' || String(props.node.uiRole || '') === 'model'
)

const rowKindClass = computed(() => {
  if (isFolder.value) return 'folder-row'
  if (isRelation.value) return 'prop-row'
  if (isModel.value) return 'instance-row model-row'
  return 'class-row'
})

const kindBadge = computed(() => {
  if (isFolder.value) return ''
  if (isModel.value) return '型号'
  if (/ObjectProperty/i.test(kind.value)) return '关系'
  if (/DataProperty/i.test(kind.value)) return '数据'
  if (/Property/i.test(kind.value)) return '属性'
  return ''
})

const kindBadgeClass = computed(() => {
  if (isModel.value) return 'model-badge'
  if (/ObjectProperty|Relation/i.test(kind.value)) return 'relation-badge'
  if (/DataProperty/i.test(kind.value)) return 'data-badge'
  return 'meta-badge'
})

const changeLabel = computed(() => {
  const map = { add: '新增', modify: '修改', delete: '删除' }
  return map[change.value] || ''
})

const changeBadgeClass = computed(() => {
  if (change.value === 'add') return 'add-badge'
  if (change.value === 'modify') return 'mod-badge'
  if (change.value === 'delete') return 'del-badge'
  return ''
})

const displayLabel = computed(() => String(props.node.label || ''))
</script>

<style scoped>
/* Row chrome comes from parent .tree (modeling-matched). Local extras only. */
.tree-check {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  margin: 0;
  cursor: pointer;
}
.tree-check input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: #2563eb;
  cursor: pointer;
}
.tree-decide {
  display: inline-flex;
  gap: 1px;
  margin-left: auto;
  opacity: 0.45;
  transition: opacity 0.12s ease;
}
.tree-row:hover .tree-decide,
.tree-row.is-selected .tree-decide {
  opacity: 1;
}
.tree-decide .tree-icon-btn {
  width: 24px;
  height: 24px;
  font-size: 12px;
}
.tree-decide .ok { color: #15803d !important; }
.tree-decide .ok:hover { color: #166534 !important; background: rgba(220, 252, 231, 0.9) !important; }
.tree-decide .no { color: #b91c1c !important; }
.tree-decide .no:hover { color: #991b1b !important; background: rgba(254, 226, 226, 0.9) !important; }

.tree-badge.add-badge {
  color: #166534;
  background: #dcfce7;
  border: 1px solid #86efac;
}
.tree-badge.mod-badge {
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #fcd34d;
}
.tree-badge.del-badge {
  color: #991b1b;
  background: #fee2e2;
  border: 1px solid #fca5a5;
}
.tree-badge.ok-badge {
  color: #166534;
  background: #dcfce7;
  border: 1px solid #86efac;
}
.tree-badge.no-badge {
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}
.tree-badge.data-badge {
  color: #0f766e;
  background: #ccfbf1;
}

.tree-row.chg-add {
  background: rgba(220, 252, 231, 0.45);
  box-shadow: inset 3px 0 0 #22c55e;
}
.tree-row.chg-modify {
  background: rgba(254, 243, 199, 0.55);
  box-shadow: inset 3px 0 0 #f59e0b;
}
.tree-row.chg-delete {
  background: rgba(254, 226, 226, 0.5);
  box-shadow: inset 3px 0 0 #ef4444;
}
.tree-row.chg-delete .tree-label {
  text-decoration: line-through;
  opacity: 0.85;
}
.tree-row.chg-add.is-selected,
.tree-row.chg-modify.is-selected,
.tree-row.chg-delete.is-selected {
  background: #fff;
}

.folder-row .tree-label {
  font-weight: 600;
  color: #475569;
}
</style>
