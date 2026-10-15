<template>
  <div ref="host" class="modeling-host"></div>
  <ClassStateMachinePanel
    v-if="sm.open"
    :project-id="sm.projectId"
    :class-iri="sm.classIri"
    :class-label="sm.classLabel"
    :behavior-iri="sm.behaviorIri"
    :behavior-label="sm.behaviorLabel"
    :rules="sm.rules"
    :instance-iri="sm.instanceIri"
    :instance-label="sm.instanceLabel"
    :current-state-id="sm.currentStateId"
    @close="sm.open = false"
    @current-state-changed="onCurrentStateChanged"
  />
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import '../legacy/modeling.css'
import { installModelingFetchShim } from '../legacy/modeling-shim.js'
import { loadModelingApp } from '../legacy/loadModelingApp.js'
import ClassStateMachinePanel from './ClassStateMachinePanel.vue'

const props = defineProps({
  projectId: { type: String, required: true },
  /** class | instance | rules — matches modeling-app modes */
  mode: { type: String, default: 'class' }
})

const host = ref(null)
let uninstallShim = null
let controller = null

const sm = reactive({
  open: false,
  projectId: '',
  classIri: '',
  classLabel: '',
  behaviorIri: '',
  behaviorLabel: '',
  rules: [],
  instanceIri: '',
  instanceLabel: '',
  currentStateId: ''
})

function onOpenStateMachine(event) {
  const d = (event && event.detail) || {}
  sm.projectId = d.projectId || props.projectId
  sm.classIri = d.classIri || ''
  sm.classLabel = d.classLabel || ''
  sm.behaviorIri = d.behaviorIri || ''
  sm.behaviorLabel = d.behaviorLabel || ''
  sm.rules = Array.isArray(d.rules) ? d.rules : []
  sm.instanceIri = d.instanceIri || ''
  sm.instanceLabel = d.instanceLabel || ''
  sm.currentStateId = d.currentStateId || ''
  if (sm.classIri && sm.behaviorIri) sm.open = true
}

function onCurrentStateChanged(detail) {
  const d = detail || {}
  if (d.stateId != null) sm.currentStateId = d.stateId
  window.dispatchEvent(new CustomEvent('instance-behavior-state-changed', {
    detail: {
      projectId: sm.projectId,
      individualIri: d.instanceIri || sm.instanceIri,
      behaviorIri: d.behaviorIri || sm.behaviorIri,
      stateId: d.stateId || '',
      stateLabel: d.stateLabel || ''
    }
  }))
}

function syncProjectQuery(projectId) {
  const url = new URL(window.location.href)
  if (projectId) {
    url.searchParams.set('project', projectId)
    url.searchParams.set('mode', props.mode || 'class')
  } else {
    url.searchParams.delete('project')
    url.searchParams.delete('mode')
  }
  window.history.replaceState(null, '', url)
}

async function mountApp() {
  if (!host.value || !props.projectId) return
  if (controller && typeof controller.destroy === 'function') {
    controller.destroy()
    controller = null
  }
  uninstallShim = installModelingFetchShim()
  syncProjectQuery(props.projectId)
  const ModelingApp = await loadModelingApp()
  host.value.innerHTML = ''
  controller = ModelingApp.mount(host.value, {
    projectId: props.projectId,
    mode: props.mode || 'class',
    embedded: true
  }) || null
}

onMounted(() => {
  window.addEventListener('open-class-state-machine', onOpenStateMachine)
  mountApp().catch((err) => {
    console.error(err)
    if (host.value) {
      host.value.innerHTML = '<div class="status error" style="padding:1rem">建模页加载失败：' +
        (err && err.message ? err.message : String(err)) + '</div>'
    }
  })
})

watch(() => props.projectId, (id) => {
  syncProjectQuery(id)
  if (controller && typeof controller.setProjectId === 'function') {
    controller.setProjectId(id)
  } else {
    mountApp().catch(console.error)
  }
})

watch(() => props.mode, (mode) => {
  const url = new URL(window.location.href)
  if (mode) url.searchParams.set('mode', mode)
  window.history.replaceState(null, '', url)
  if (controller && typeof controller.setMode === 'function') {
    controller.setMode(mode)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('open-class-state-machine', onOpenStateMachine)
  if (controller && typeof controller.destroy === 'function') {
    controller.destroy()
    controller = null
  }
  if (uninstallShim) uninstallShim()
  if (host.value) host.value.innerHTML = ''
  const url = new URL(window.location.href)
  url.searchParams.delete('project')
  url.searchParams.delete('mode')
  window.history.replaceState(null, '', url)
})
</script>

<style scoped>
.modeling-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.modeling-host :deep(.layout),
.modeling-host :deep(.layout-embedded) {
  flex: 1;
  min-height: 0;
  height: 100%;
}
</style>
