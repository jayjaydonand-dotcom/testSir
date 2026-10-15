<template>
  <Teleport to="body">
    <div class="sm-overlay" @keydown.esc="emit('close')">
      <div class="sm-shell">
        <header class="sm-top">
          <div class="sm-title">
            <strong>{{ instanceIri ? '实例行为状态' : '编辑行为' }}</strong>
            <span class="sm-sub">
              {{ behaviorLabel || behaviorIri }}
              <template v-if="instanceIri"> · 实例 {{ instanceLabel || instanceIri }}</template>
              <template v-else-if="classLabel || classIri"> · {{ classLabel || classIri }}</template>
            </span>
          </div>
          <div class="sm-tools">
            <button type="button" @click="addState">+ 状态</button>
            <button type="button" :disabled="!selectedNode" @click="setInitial">设为初始</button>
            <button type="button" :disabled="!selectedNode" @click="toggleFinal">切换终态</button>
            <button
              v-if="instanceIri"
              type="button"
              class="accent"
              :disabled="!selectedNode || busy"
              @click="setCurrent"
            >设为当前状态</button>
            <button type="button" class="primary" :disabled="busy" @click="save">保存</button>
            <button type="button" class="danger" :disabled="busy || !exists" @click="remove">删除</button>
            <button type="button" @click="emit('close')">关闭</button>
          </div>
        </header>
        <p class="sm-status" :class="{ err: !!error, ok: !!okMsg }">{{ error || okMsg || hint }}</p>

        <div class="sm-body">
          <div class="sm-canvas">
            <VueFlow
              v-model:nodes="nodes"
              v-model:edges="edges"
              :default-viewport="{ zoom: 1 }"
              :min-zoom="0.3"
              :max-zoom="2"
              fit-view-on-init
              @node-click="onNodeClick"
              @edge-click="onEdgeClick"
              @pane-click="clearSelection"
              @connect="onConnect"
            >
              <Background :gap="18" />
              <Controls />
              <template #node-state="{ data, id }">
                <div
                  class="state-node"
                  :class="{
                    initial: data.isInitial,
                    final: data.isFinal,
                    current: instanceIri && id === liveCurrentStateId
                  }"
                >
                  <Handle type="target" :position="Position.Left" />
                  <div class="state-label">{{ data.label }}</div>
                  <div class="state-badges">
                    <span v-if="data.isInitial" class="badge">初始</span>
                    <span v-if="data.isFinal" class="badge">终态</span>
                    <span v-if="instanceIri && id === liveCurrentStateId" class="badge current">当前</span>
                  </div>
                  <Handle type="source" :position="Position.Right" />
                </div>
              </template>
            </VueFlow>
          </div>

          <aside class="sm-side">
            <template v-if="selectedEdge">
              <h3>转移属性</h3>
              <label>
                事件名
                <input v-model="selectedEdge.data.event" @input="syncEdgeLabel" placeholder="例如 TAKEOFF_OK" />
              </label>

              <div class="field-block">
                <div class="field-title">何时可跳转（条件）</div>
                <p class="field-help">选一条 SWRL：规则结论成立时，才允许发生这次转移。</p>
                <select v-model="guardRuleId" @change="applyGuard">
                  <option value="">（无条件，事件触发即跳转）</option>
                  <option v-for="r in rules" :key="r.ruleId" :value="r.ruleId">
                    {{ r.label }}
                  </option>
                </select>
                <p v-if="guardSummary" class="rule-summary">{{ guardSummary }}</p>
              </div>

              <div class="field-block">
                <div class="field-title-row">
                  <div class="field-title">跳转时做什么（动作）</div>
                  <button
                    type="button"
                    class="link-btn"
                    :disabled="!availableActions.length"
                    @click="openActionPicker"
                  >+ 添加</button>
                </div>
                <p class="field-help">仅显示本转移已选动作；需要时再添加。</p>
                <div v-if="!selectedActions.length" class="empty-pick">仅跳转状态（无动作）</div>
                <div
                  v-for="a in selectedActions"
                  :key="a.actionId"
                  class="picked-item"
                >
                  <div class="picked-body">
                    <strong>{{ a.label }}</strong>
                    <small v-if="a.description">{{ a.description }}</small>
                    <small v-if="a.effectRule" class="effect">效果关联：{{ a.effectRule }}</small>
                  </div>
                  <button type="button" class="ghost-btn" title="移除" @click="removeAction(a.actionId)">移除</button>
                </div>
              </div>

              <details class="advanced">
                <summary>高级：关联说明规则（不执行）</summary>
                <div class="field-title-row">
                  <p class="field-help" style="margin:0;flex:1">仅文档追溯，不自动执行。</p>
                  <button
                    type="button"
                    class="link-btn"
                    :disabled="!availableRelatedRules.length"
                    @click="openRelatedPicker"
                  >+ 添加</button>
                </div>
                <div v-if="!selectedRelatedRules.length" class="empty-pick">未关联说明规则</div>
                <div
                  v-for="r in selectedRelatedRules"
                  :key="r.ruleId"
                  class="picked-item compact"
                >
                  <div class="picked-body">
                    <strong>{{ r.label }}</strong>
                    <small v-if="r.summary">{{ r.summary }}</small>
                  </div>
                  <button type="button" class="ghost-btn" @click="removeRelatedRule(r.ruleId)">移除</button>
                </div>
              </details>

              <button type="button" class="danger" @click="deleteSelectedEdge">删除此转移</button>
            </template>

            <template v-else-if="selectedNode">
              <h3>状态属性</h3>
              <label>
                名称
                <input v-model="selectedNode.data.label" />
              </label>
              <p class="side-hint">
                id：{{ selectedNode.id }}
                <br />
                {{ selectedNode.data.isInitial ? '图初始状态' : '非图初始' }}
                ·
                {{ selectedNode.data.isFinal ? '终态' : '非终态' }}
                <template v-if="instanceIri">
                  <br />
                  {{ selectedNode.id === liveCurrentStateId ? '本实例当前状态' : '非本实例当前状态' }}
                </template>
              </p>
              <button
                v-if="instanceIri"
                type="button"
                class="accent"
                :disabled="busy || selectedNode.id === liveCurrentStateId"
                @click="setCurrent"
              >设为当前状态</button>
              <button type="button" class="danger" @click="deleteSelectedNode">删除此状态</button>
            </template>

            <template v-else>
              <h3>说明</h3>
              <ul class="side-hint">
                <li v-if="instanceIri">选中状态后点「设为当前状态」，立即写入该实例对该行为的当前标记</li>
                <li>拖拽右侧圆点到另一状态可创建转移</li>
                <li>条件 = SWRL 是否成立；动作 = 跳转时要做的任务意图</li>
                <li>保存后写入本类 SubClassOf 的 benti:stateGraph 注解</li>
              </ul>
            </template>
          </aside>
        </div>
      </div>

      <!-- Action picker dialog -->
      <div v-if="picker.open" class="picker-mask" @click.self="closePicker">
        <div class="picker-dialog" role="dialog" aria-modal="true">
          <header class="picker-head">
            <strong>{{ picker.kind === 'action' ? '添加动作' : '添加关联规则' }}</strong>
            <button type="button" class="ghost-btn" @click="closePicker">关闭</button>
          </header>
          <p class="field-help picker-help">
            {{ picker.kind === 'action'
              ? '勾选要附加到本转移的任务动作，确认后加入右侧列表。'
              : '勾选仅作说明追溯的 SWRL 规则（不会执行）。' }}
          </p>
          <div class="picker-list">
            <label
              v-for="item in pickerItems"
              :key="item.id"
              class="action-item"
            >
              <input type="checkbox" :value="item.id" v-model="picker.selected" />
              <span>
                <strong>{{ item.label }}</strong>
                <small v-if="item.description">{{ item.description }}</small>
                <small v-if="item.effectRule" class="effect">效果关联：{{ item.effectRule }}</small>
              </span>
            </label>
            <p v-if="!pickerItems.length" class="empty-pick">没有可添加的项</p>
          </div>
          <footer class="picker-foot">
            <button type="button" @click="closePicker">取消</button>
            <button
              type="button"
              class="primary"
              :disabled="!picker.selected.length"
              @click="confirmPicker"
            >添加所选（{{ picker.selected.length }}）</button>
          </footer>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { VueFlow, Handle, Position, MarkerType } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import * as api from '../api/onto'

const props = defineProps({
  projectId: { type: String, required: true },
  classIri: { type: String, default: '' },
  classLabel: { type: String, default: '' },
  behaviorIri: { type: String, default: '' },
  behaviorLabel: { type: String, default: '' },
  rules: { type: Array, default: () => [] },
  /** When set, panel can mark this instance's current behavior state. */
  instanceIri: { type: String, default: '' },
  instanceLabel: { type: String, default: '' },
  currentStateId: { type: String, default: '' }
})

const emit = defineEmits(['close', 'current-state-changed'])

const nodes = ref([])
const edges = ref([])
const selectedNodeId = ref('')
const selectedEdgeId = ref('')
const busy = ref(false)
const error = ref('')
const okMsg = ref('')
const exists = ref(false)
const liveCurrentStateId = ref(props.currentStateId || '')
const hint = computed(() => {
  if (props.instanceIri) {
    return '从实例打开：可选中状态后点「设为当前状态」写入该实例；「设为初始 / 切换终态 / 保存」仍编辑类上的状态机图。'
  }
  return '状态机以 JSON 写入本类对该行为的 SubClassOf 注解 benti:stateGraph（与功能码 functionCode 同级）；打开本页时再渲染为图。'
})

watch(() => props.currentStateId, (id) => {
  liveCurrentStateId.value = id || ''
})

function subjectPayload() {
  return { classIri: props.classIri, behaviorIri: props.behaviorIri }
}

/** Curated mission actions — what actually happens on a transition. */
const ACTION_CATALOG = [
  {
    id: 'cue_track',
    label: '接敌提示 / 启动跟踪',
    description: '形成接敌态势，进入探测→跟踪链路',
    effectRule: '空空拦截-目标提示 / 探测转跟踪'
  },
  {
    id: 'declare_engage',
    label: '声明交战目标',
    description: '把当前目标标为交战对象（武器交战意图）',
    effectRule: '空空拦截-射击即交战目标'
  },
  {
    id: 'weapon_fire',
    label: '武器开火就绪',
    description: '确认弹药与射程允许后进入交战开火',
    effectRule: '空空拦截-弹药与射程可射击'
  },
  {
    id: 'winchester',
    label: '低弹药脱离',
    description: '弹药不足，准备脱离交战并返航',
    effectRule: '空空拦截-低弹药告警'
  },
  {
    id: 'bingo',
    label: '燃油告警返航',
    description: '燃油低于阈值，中止任务返航',
    effectRule: '空空拦截-低燃油告警'
  },
  {
    id: 'break_contact',
    label: '失联回巡航',
    description: '丢失目标接触，恢复巡航搜索',
    effectRule: '空空拦截-失联回巡航'
  },
  {
    id: 'takeoff',
    label: '起飞出航',
    description: '离开待命，按任务航线出航',
    effectRule: ''
  },
  {
    id: 'land',
    label: '着陆结束',
    description: '返航完成，任务收尾',
    effectRule: ''
  }
]

const selectedNode = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value) || null)
const selectedEdge = computed(() => edges.value.find((e) => e.id === selectedEdgeId.value) || null)

const guardRuleId = ref('')
const actionIds = ref([])
const relatedRuleIds = ref([])

const picker = ref({
  open: false,
  kind: 'action', // 'action' | 'related'
  selected: []
})

const guardSummary = computed(() => {
  const r = ruleById(guardRuleId.value)
  if (!r) return ''
  return r.summary ? ('规则大意：' + r.summary) : ('已选条件：' + r.label)
})

const selectedActions = computed(() =>
  (actionIds.value || []).map(toMissionAction).filter((a) => a && a.actionId)
)

const availableActions = computed(() =>
  ACTION_CATALOG.filter((a) => !actionIds.value.includes(a.id))
)

const selectedRelatedRules = computed(() =>
  (relatedRuleIds.value || []).map((id) => {
    const r = ruleById(id)
    return r
      ? { ruleId: r.ruleId, label: r.label, summary: r.summary || '' }
      : { ruleId: id, label: id, summary: '' }
  })
)

const availableRelatedRules = computed(() =>
  (props.rules || []).filter((r) => !relatedRuleIds.value.includes(r.ruleId))
)

const pickerItems = computed(() => {
  if (picker.value.kind === 'action') {
    return availableActions.value.map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      effectRule: a.effectRule
    }))
  }
  return availableRelatedRules.value.map((r) => ({
    id: r.ruleId,
    label: r.label,
    description: r.summary || '',
    effectRule: ''
  }))
})

watch(selectedEdge, (edge) => {
  closePicker()
  if (!edge) {
    guardRuleId.value = ''
    actionIds.value = []
    relatedRuleIds.value = []
    return
  }
  ensureEdgeDataShape(edge)
  const g = edge.data.guard
  guardRuleId.value = (g && g.ruleId) || ''
  const parsed = splitStoredActions(edge.data.actions, edge.data.relatedRules)
  actionIds.value = parsed.actionIds
  relatedRuleIds.value = parsed.relatedRuleIds
  // write back normalized shape so save is clean
  edge.data.actions = parsed.actions
  edge.data.relatedRules = parsed.relatedRules
})

function ruleById(id) {
  return (props.rules || []).find((r) => r.ruleId === id) || null
}

function catalogById(id) {
  return ACTION_CATALOG.find((a) => a.id === id) || null
}

function ensureEdgeDataShape(edge) {
  if (!edge.data) edge.data = {}
  if (!Array.isArray(edge.data.actions)) edge.data.actions = []
  if (!Array.isArray(edge.data.relatedRules)) edge.data.relatedRules = []
}

/** Normalize edge payload: mission actions vs relatedRules (docs only). */
function splitStoredActions(actions, relatedRules) {
  const mission = []
  const related = []
  const seenRel = new Set()
  ;(Array.isArray(relatedRules) ? relatedRules : []).forEach((r) => {
    if (!r || !r.ruleId) return
    related.push({ type: 'swrlRule', ruleId: r.ruleId, label: r.label || r.ruleId })
    seenRel.add(r.ruleId)
  })
  ;(Array.isArray(actions) ? actions : []).forEach((a) => {
    if (!a) return
    const id = a.actionId || (a.type === 'missionAction' ? a.id : '')
    if (id && catalogById(id)) mission.push(toMissionAction(id))
  })
  return {
    actions: mission,
    relatedRules: related,
    actionIds: mission.map((a) => a.actionId),
    relatedRuleIds: related.map((r) => r.ruleId)
  }
}

function toMissionAction(actionId) {
  const a = catalogById(actionId)
  return {
    type: 'missionAction',
    actionId,
    label: a ? a.label : actionId,
    description: a ? a.description : '',
    effectRule: a && a.effectRule ? a.effectRule : ''
  }
}

function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9)
}

function defaultGraph() {
  const a = uid('s')
  const b = uid('s')
  return {
    nodes: [
      {
        id: a,
        type: 'state',
        position: { x: 80, y: 120 },
        data: { label: '空闲', isInitial: true, isFinal: false }
      },
      {
        id: b,
        type: 'state',
        position: { x: 360, y: 120 },
        data: { label: '运行', isInitial: false, isFinal: false }
      }
    ],
    edges: [
      {
        id: uid('e'),
        source: a,
        target: b,
        label: 'START',
        markerEnd: MarkerType.ArrowClosed,
        data: { event: 'START', guard: null, actions: [], relatedRules: [] }
      }
    ]
  }
}

function applyGraph(graph) {
  const g = graph && Array.isArray(graph.nodes) ? graph : defaultGraph()
  nodes.value = (g.nodes || []).map((n) => ({
    ...n,
    type: 'state',
    data: {
      label: (n.data && n.data.label) || n.id,
      isInitial: !!(n.data && n.data.isInitial),
      isFinal: !!(n.data && n.data.isFinal)
    }
  }))
  edges.value = (g.edges || []).map((e) => ({
    ...e,
    markerEnd: MarkerType.ArrowClosed,
    label: (e.data && e.data.event) || e.label || '',
    data: (() => {
      const parsed = splitStoredActions(
        (e.data && e.data.actions) || [],
        (e.data && e.data.relatedRules) || []
      )
      return {
        event: (e.data && e.data.event) || e.label || '',
        guard: (e.data && e.data.guard) || null,
        actions: parsed.actions,
        relatedRules: parsed.relatedRules
      }
    })()
  }))
  // ensure exactly one initial if any
  const initials = nodes.value.filter((n) => n.data.isInitial)
  if (!initials.length && nodes.value.length) {
    nodes.value[0].data.isInitial = true
  } else if (initials.length > 1) {
    initials.slice(1).forEach((n) => { n.data.isInitial = false })
  }
}

function graphToMachine() {
  const initialNode = nodes.value.find((n) => n.data.isInitial) || nodes.value[0]
  const states = {}
  nodes.value.forEach((n) => {
    const on = {}
    edges.value.filter((e) => e.source === n.id).forEach((e) => {
      const event = (e.data && e.data.event) || e.label || e.id
      on[event] = {
        target: e.target,
        meta: {
          guard: (e.data && e.data.guard) || null,
          actions: (e.data && e.data.actions) || [],
          relatedRules: (e.data && e.data.relatedRules) || []
        }
      }
    })
    states[n.id] = {
      meta: {
        label: n.data.label,
        isFinal: !!n.data.isFinal
      },
      on
    }
  })
  return {
    id: 'sm:' + props.classIri,
    initial: initialNode ? initialNode.id : undefined,
    states
  }
}

function onNodeClick({ node }) {
  selectedNodeId.value = node.id
  selectedEdgeId.value = ''
}

function onEdgeClick({ edge }) {
  selectedEdgeId.value = edge.id
  selectedNodeId.value = ''
}

function clearSelection() {
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
}

function onConnect(params) {
  const event = 'EVENT'
  edges.value = edges.value.concat([{
    id: uid('e'),
    source: params.source,
    target: params.target,
    label: event,
    markerEnd: MarkerType.ArrowClosed,
    data: { event, guard: null, actions: [], relatedRules: [] }
  }])
}

function addState() {
  const id = uid('s')
  const n = nodes.value.length
  nodes.value = nodes.value.concat([{
    id,
    type: 'state',
    position: { x: 100 + (n % 4) * 160, y: 80 + Math.floor(n / 4) * 120 },
    data: { label: '状态' + (n + 1), isInitial: nodes.value.length === 0, isFinal: false }
  }])
  selectedNodeId.value = id
  selectedEdgeId.value = ''
}

function setInitial() {
  if (!selectedNode.value) return
  nodes.value = nodes.value.map((n) => ({
    ...n,
    data: { ...n.data, isInitial: n.id === selectedNode.value.id }
  }))
}

function toggleFinal() {
  if (!selectedNode.value) return
  selectedNode.value.data.isFinal = !selectedNode.value.data.isFinal
}

async function setCurrent() {
  if (!props.instanceIri || !props.behaviorIri || !selectedNode.value) return
  busy.value = true
  error.value = ''
  okMsg.value = ''
  try {
    const stateId = selectedNode.value.id
    const stateLabel = (selectedNode.value.data && selectedNode.value.data.label) || stateId
    await api.setInstanceDataValue(
      props.projectId,
      props.instanceIri,
      props.behaviorIri,
      stateId
    )
    liveCurrentStateId.value = stateId
    okMsg.value = '已将「' + stateLabel + '」设为实例当前状态'
    emit('current-state-changed', {
      instanceIri: props.instanceIri,
      behaviorIri: props.behaviorIri,
      stateId,
      stateLabel
    })
  } catch (e) {
    error.value = e && e.message ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function syncEdgeLabel() {
  if (!selectedEdge.value) return
  selectedEdge.value.label = selectedEdge.value.data.event || ''
}

function applyGuard() {
  if (!selectedEdge.value) return
  const r = ruleById(guardRuleId.value)
  selectedEdge.value.data.guard = r
    ? { type: 'swrlRule', ruleId: r.ruleId, label: r.label, summary: r.summary || '' }
    : null
}

function syncActionsToEdge() {
  if (!selectedEdge.value) return
  selectedEdge.value.data.actions = (actionIds.value || []).map(toMissionAction)
}

function syncRelatedToEdge() {
  if (!selectedEdge.value) return
  selectedEdge.value.data.relatedRules = (relatedRuleIds.value || []).map((id) => {
    const r = ruleById(id)
    return r
      ? { type: 'swrlRule', ruleId: r.ruleId, label: r.label, summary: r.summary || '' }
      : { type: 'swrlRule', ruleId: id, label: id }
  })
}

function removeAction(actionId) {
  actionIds.value = actionIds.value.filter((id) => id !== actionId)
  syncActionsToEdge()
}

function removeRelatedRule(ruleId) {
  relatedRuleIds.value = relatedRuleIds.value.filter((id) => id !== ruleId)
  syncRelatedToEdge()
}

function openActionPicker() {
  if (!availableActions.value.length) return
  picker.value = { open: true, kind: 'action', selected: [] }
}

function openRelatedPicker() {
  if (!availableRelatedRules.value.length) return
  picker.value = { open: true, kind: 'related', selected: [] }
}

function closePicker() {
  picker.value = { open: false, kind: 'action', selected: [] }
}

function confirmPicker() {
  const ids = picker.value.selected || []
  if (!ids.length) {
    closePicker()
    return
  }
  if (picker.value.kind === 'action') {
    const set = new Set(actionIds.value)
    ids.forEach((id) => set.add(id))
    actionIds.value = Array.from(set)
    syncActionsToEdge()
  } else {
    const set = new Set(relatedRuleIds.value)
    ids.forEach((id) => set.add(id))
    relatedRuleIds.value = Array.from(set)
    syncRelatedToEdge()
  }
  closePicker()
}

function deleteSelectedEdge() {
  if (!selectedEdgeId.value) return
  edges.value = edges.value.filter((e) => e.id !== selectedEdgeId.value)
  selectedEdgeId.value = ''
}

function deleteSelectedNode() {
  if (!selectedNodeId.value) return
  const id = selectedNodeId.value
  nodes.value = nodes.value.filter((n) => n.id !== id)
  edges.value = edges.value.filter((e) => e.source !== id && e.target !== id)
  selectedNodeId.value = ''
}

async function load() {
  busy.value = true
  error.value = ''
  okMsg.value = ''
  try {
    if (!props.classIri || !props.behaviorIri) {
      throw new Error('缺少 classIri 或 behaviorIri')
    }
    const res = await api.getClassBehavior(props.projectId, subjectPayload(), 'stateMachine')
    exists.value = !!res.exists
    if (res.graph && Array.isArray(res.graph.nodes) && res.graph.nodes.length) {
      applyGraph(res.graph)
    } else if (res.machine && res.machine.states) {
      applyGraph(machineToGraph(res.machine))
    } else {
      applyGraph(defaultGraph())
    }
  } catch (e) {
    error.value = e && e.message ? e.message : String(e)
    applyGraph(defaultGraph())
  } finally {
    busy.value = false
  }
}

function machineToGraph(machine) {
  const stateIds = Object.keys(machine.states || {})
  const nodesOut = stateIds.map((id, i) => ({
    id,
    type: 'state',
    position: { x: 80 + (i % 4) * 180, y: 80 + Math.floor(i / 4) * 140 },
    data: {
      label: (machine.states[id].meta && machine.states[id].meta.label) || id,
      isInitial: machine.initial === id,
      isFinal: !!(machine.states[id].meta && machine.states[id].meta.isFinal)
    }
  }))
  const edgesOut = []
  stateIds.forEach((sid) => {
    const on = (machine.states[sid] && machine.states[sid].on) || {}
    Object.keys(on).forEach((event) => {
      const t = on[event]
      const target = typeof t === 'string' ? t : t.target
      const meta = (typeof t === 'object' && t.meta) || {}
      edgesOut.push({
        id: uid('e'),
        source: sid,
        target,
        label: event,
        markerEnd: MarkerType.ArrowClosed,
        data: (() => {
          const parsed = splitStoredActions(meta.actions || [], meta.relatedRules || [])
          return {
            event,
            guard: meta.guard || null,
            actions: parsed.actions,
            relatedRules: parsed.relatedRules
          }
        })()
      })
    })
  })
  return { nodes: nodesOut, edges: edgesOut }
}

async function save() {
  busy.value = true
  error.value = ''
  okMsg.value = ''
  try {
    const machine = graphToMachine()
    if (!machine.initial) throw new Error('请至少设置一个初始状态')
    const graph = {
      nodes: nodes.value.map((n) => ({
        id: n.id,
        type: 'state',
        position: n.position,
        data: { ...n.data }
      })),
      edges: edges.value.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: (e.data && e.data.event) || e.label || '',
        data: {
          event: (e.data && e.data.event) || '',
          guard: (e.data && e.data.guard) || null,
          actions: (e.data && e.data.actions) || [],
          relatedRules: (e.data && e.data.relatedRules) || []
        }
      }))
    }
    await api.saveClassBehavior(props.projectId, subjectPayload(), 'stateMachine', { machine, graph })
    exists.value = true
    okMsg.value = '已保存到本类 SubClassOf 的 benti:stateGraph'
    window.dispatchEvent(new CustomEvent('class-state-machine-changed', {
      detail: {
        projectId: props.projectId,
        classIri: props.classIri,
        behaviorIri: props.behaviorIri,
        behaviorLabel: props.behaviorLabel,
        deleted: false
      }
    }))
  } catch (e) {
    error.value = e && e.message ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!window.confirm('确定删除该行为的状态机配置？')) return
  busy.value = true
  error.value = ''
  okMsg.value = ''
  try {
    await api.deleteClassBehavior(props.projectId, subjectPayload(), 'stateMachine')
    exists.value = false
    applyGraph(defaultGraph())
    okMsg.value = '已删除本类 SubClassOf 上的 benti:stateGraph'
    window.dispatchEvent(new CustomEvent('class-state-machine-changed', {
      detail: {
        projectId: props.projectId,
        classIri: props.classIri,
        behaviorIri: props.behaviorIri,
        behaviorLabel: props.behaviorLabel,
        deleted: true
      }
    }))
  } catch (e) {
    error.value = e && e.message ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
watch(() => [props.projectId, props.classIri, props.behaviorIri], load)
</script>

<style scoped>
.sm-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(20, 28, 40, 0.45);
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 24px;
}
.sm-shell {
  flex: 1;
  max-width: 1280px;
  background: #fff;
  border-radius: 6px;
  border: 1px solid #d8dde3;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}
.sm-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid #d8dde3;
  background: #f8fafc;
}
.sm-title { display: flex; align-items: baseline; gap: 10px; }
.sm-title strong { font-size: 16px; }
.sm-sub { color: #555; font-size: 13px; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.sm-tools button, .sm-side button {
  padding: 5px 10px;
  border: 1px solid #d8dde3;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}
.sm-tools button.primary, .sm-side button.primary {
  background: #1a5fb4;
  border-color: #1a5fb4;
  color: #fff;
}
.sm-tools button.accent, .sm-side button.accent {
  background: #b45309;
  border-color: #b45309;
  color: #fff;
}
.sm-tools button.danger, .sm-side button.danger {
  color: #a51d2d;
  border-color: #e4b4b8;
}
.sm-tools button:disabled,
.sm-side button.accent:disabled { opacity: 0.5; cursor: not-allowed; }
.sm-side button.accent {
  display: block;
  width: 100%;
  margin-bottom: 8px;
}
.sm-status {
  margin: 0;
  padding: 6px 14px;
  font-size: 12px;
  color: #555;
  border-bottom: 1px solid #eef1f4;
  min-height: 28px;
}
.sm-status.ok { color: #0f766e; }
.sm-status.err { color: #a51d2d; }
.sm-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 320px;
}
.sm-canvas {
  position: relative;
  min-height: 520px;
  background: #f5f7fa;
}
.sm-side {
  border-left: 1px solid #d8dde3;
  padding: 12px 14px;
  overflow: auto;
  background: #fff;
}
.sm-side h3 { margin: 0 0 10px; font-size: 14px; }
.sm-side > label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #444;
}
.sm-side input[type="text"],
.sm-side input:not([type]),
.sm-side select {
  padding: 6px 8px;
  border: 1px solid #d8dde3;
  border-radius: 3px;
  font-size: 13px;
  width: 100%;
}
.field-block {
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eef1f4;
}
.field-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.field-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1c;
}
.field-help {
  margin: 0 0 8px;
  font-size: 11px;
  color: #666;
  line-height: 1.45;
}
.rule-summary {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: #f3f6fa;
  border-radius: 3px;
  font-size: 11px;
  color: #444;
  line-height: 1.4;
  word-break: break-all;
}
.link-btn {
  border: none !important;
  background: transparent !important;
  color: #1a5fb4 !important;
  padding: 2px 4px !important;
  font-size: 12px !important;
  cursor: pointer;
}
.link-btn:disabled {
  color: #9aa3ad !important;
  cursor: not-allowed;
}
.ghost-btn {
  border: 1px solid #d8dde3;
  background: #fff;
  color: #555;
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  flex: 0 0 auto;
}
.empty-pick {
  padding: 10px 8px;
  border: 1px dashed #d8dde3;
  border-radius: 4px;
  color: #888;
  font-size: 12px;
  text-align: center;
  margin-bottom: 8px;
}
.picked-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid #e4e8ee;
  border-radius: 4px;
  background: #f8fafc;
}
.picked-item.compact { padding: 6px 8px; }
.picked-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.picked-body strong { font-size: 12px; color: #1c1c1c; }
.picked-body small {
  font-size: 11px;
  color: #666;
  line-height: 1.35;
}
.picked-body small.effect { color: #1a5fb4; }
.action-item {
  display: flex !important;
  flex-direction: row !important;
  align-items: flex-start;
  gap: 8px !important;
  margin-bottom: 8px !important;
  padding: 7px 8px;
  border: 1px solid #e4e8ee;
  border-radius: 4px;
  background: #fafbfc;
  cursor: pointer;
  font-size: 12px;
  color: #333;
}
.action-item:hover { border-color: #b8c7db; background: #f3f7fc; }
.action-item input {
  margin-top: 2px;
  width: auto !important;
  flex: 0 0 auto;
}
.action-item span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.action-item strong { font-size: 12px; }
.action-item small {
  font-size: 11px;
  color: #666;
  line-height: 1.35;
}
.action-item small.effect { color: #1a5fb4; }
.advanced {
  margin: 0 0 12px;
  font-size: 12px;
  color: #444;
}
.advanced summary {
  cursor: pointer;
  margin-bottom: 8px;
  color: #555;
}
.picker-mask {
  position: fixed;
  inset: 0;
  z-index: 4100;
  background: rgba(20, 28, 40, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.picker-dialog {
  width: min(440px, 100%);
  max-height: min(70vh, 560px);
  background: #fff;
  border-radius: 6px;
  border: 1px solid #d8dde3;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #eef1f4;
  background: #f8fafc;
}
.picker-help { padding: 0 14px; margin-top: 10px; }
.picker-list {
  flex: 1;
  overflow: auto;
  padding: 8px 14px 4px;
}
.picker-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #eef1f4;
  background: #fff;
}
.picker-foot button {
  padding: 6px 12px;
  border: 1px solid #d8dde3;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}
.picker-foot button.primary {
  background: #1a5fb4;
  border-color: #1a5fb4;
  color: #fff;
}
.picker-foot button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.side-hint { color: #666; font-size: 12px; line-height: 1.5; padding-left: 16px; }
.state-node {
  min-width: 110px;
  padding: 10px 14px;
  border: 2px solid #1a5fb4;
  border-radius: 8px;
  background: #fff;
  text-align: center;
  font-size: 13px;
}
.state-node.initial { border-color: #0f766e; box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.15); }
.state-node.final { border-style: double; border-width: 4px; }
.state-node.current {
  border-color: #b45309;
  box-shadow: 0 0 0 2px rgba(180, 83, 9, 0.2);
}
.state-label { font-weight: 600; }
.state-badges { margin-top: 4px; display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; }
.badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 999px;
  background: #e8f1fb;
  color: #1a5fb4;
}
.badge.current {
  background: #fff7ed;
  color: #b45309;
}
</style>
