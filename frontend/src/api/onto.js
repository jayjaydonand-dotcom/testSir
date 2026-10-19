const BASE = '/api/onto'

function formatApiError(body, text, status) {
  if (body && typeof body === 'object') {
    const msg = body.error || body.message || body.detail
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  if (text && String(text).trim()) return String(text).trim()
  return 'HTTP ' + status
}

function networkErrorMessage(err) {
  const raw = err && err.message ? String(err.message) : String(err || '')
  if (/failed to fetch|networkerror|load failed|econnrefused|network request failed/i.test(raw)) {
    return '无法连接后端（请确认 ontology-backend 已在 :18090 运行，且前端 Vite 代理正常）'
  }
  return raw || '网络请求失败'
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(BASE + path, options)
  } catch (err) {
    throw new Error(networkErrorMessage(err))
  }
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch (_) { body = { raw: text } }
  if (!response.ok) {
    throw new Error(formatApiError(body, text, response.status))
  }
  return body
}

function postJson(path, payload) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload || {})
  })
}

export const health = () => request('/health')
export const listProjects = () => request('/projects')
export const createProject = (displayName, description, documentId) =>
  postJson('/projects', {
    displayName,
    description: description || '',
    ...(documentId ? { documentId } : {})
  })

/** Upload ontology source (.owl/.owx/…) → { documentId, fileName, size } */
export const uploadSource = async (file) => {
  const form = new FormData()
  // Keep a stable ASCII fallback name so servers that only sniff the filename still accept Chinese names.
  const original = (file && file.name) || 'ontology.owl'
  const hasExt = /\.(owl|owx|rdf|ttl|obo|ofn|omn|xml|zip)$/i.test(original)
  const uploadName = hasExt ? original : (original + '.owl')
  form.append('file', file, uploadName)
  let response
  try {
    response = await fetch(BASE + '/uploads', { method: 'POST', body: form })
  } catch (err) {
    throw new Error(networkErrorMessage(err))
  }
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch (_) { body = { raw: text } }
  if (!response.ok) {
    throw new Error(formatApiError(body, text, response.status))
  }
  return body
}

export const updateProject = (projectId, displayName, description) =>
  postJson('/projects/update', { projectId, displayName, description: description || '' })

export const trashProject = (projectId) =>
  postJson('/projects/trash', { projectId })

export const restoreProject = (projectId) =>
  postJson('/projects/restore', { projectId })

export const getRevisions = (projectId, from = 1, to = 'HEAD') =>
  postJson('/revisions', { projectId, from, to })

export const getOntologySnapshot = (projectId) =>
  postJson('/ontology-snapshot', { projectId })

/**
 * Download ontology file (owl/owx/ttl/omn/ofn). Triggers browser save.
 * @returns {{ fileName: string, format: string }}
 */
export const exportOntology = async (projectId, format = 'owl') => {
  const response = await fetch(BASE + '/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ projectId, format: format || 'owl' })
  })
  if (!response.ok) {
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch (_) { body = null }
    const msg = (body && (body.error || body.message)) || text || ('HTTP ' + response.status)
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  let fileName = 'ontology.' + (format || 'owl')
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  if (utfMatch) {
    try { fileName = decodeURIComponent(utfMatch[1]) } catch (_) { fileName = utfMatch[1] }
  } else if (plainMatch) {
    fileName = plainMatch[1]
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return { fileName, format: format || 'owl' }
}

export const addAxioms = (projectId, owlBody, msg) =>
  postJson('/axioms', { projectId, owl: owlBody, msg: msg || 'Added axioms' })

export const deleteAxioms = (projectId, owlBody, msg) =>
  postJson('/delete-axioms', { projectId, owl: owlBody, msg: msg || 'Deleted axioms' })

/** Clear all assertions of one property on an individual. */
export const deletePropertyAssertions = (projectId, individual, property, kind = 'data', msg) =>
  postJson('/delete-property-assertions', {
    projectId,
    individual,
    property,
    kind,
    msg: msg || 'Cleared instance property assertion'
  })

/**
 * Set a single data-property value on an individual (clears old values first).
 * @param {string} projectId
 * @param {string} individualIri
 * @param {string} propertyIri
 * @param {string} value
 * @param {string} [datatypeIri]
 */
export async function setInstanceDataValue(projectId, individualIri, propertyIri, value, datatypeIri) {
  const XSD = 'http://www.w3.org/2001/XMLSchema#'
  const dt = datatypeIri || (XSD + 'string')
  await deletePropertyAssertions(
    projectId,
    individualIri,
    propertyIri,
    'data',
    '清除实例行为状态标记'
  )
  const text = String(value == null ? '' : value).trim()
  if (!text) {
    return { ok: true, removed: true, added: false }
  }
  const esc = (s) => String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
  const axiom = 'DataPropertyAssertion(<' + propertyIri + '> <' + individualIri + '> "' +
    esc(text) + '"^^<' + dt + '>)'
  const owl = [
    'Prefix(xsd:=<' + XSD + '>)',
    'Ontology(<http://example.org/benti-patch>',
    axiom,
    ')'
  ].join('\n')
  await addAxioms(projectId, owl, '设置实例行为当前状态')
  return { ok: true, removed: true, added: true, value: text }
}

export const reasonConsistency = (projectId) =>
  postJson('/reason/consistency', { projectId })

export const reasonSwrl = (projectId) =>
  postJson('/reason/swrl', { projectId })

export const reasonClassify = (projectId, individual) =>
  postJson('/reason/classify', { projectId, ...(individual ? { individual } : {}) })

export const getConsistencyResults = (projectId) =>
  postJson('/consistency-results', { projectId })

/** Unified semantic base MVP (terms / indicators / standards). */
export const getSemanticBase = (projectId) =>
  postJson('/semantic-base/get', { projectId })

export const saveSemanticBase = (projectId, payload) =>
  postJson('/semantic-base/save', { projectId, ...(payload || {}) })

export const seedSemanticBase = (projectId) =>
  postJson('/semantic-base/seed', { projectId })

/** Doc-intel (upload → chunk → candidates → review → axioms). */
export const getDocIntelEngines = () => request('/doc-intel/engines')

export const getDocIntel = (projectId) =>
  postJson('/doc-intel/get', { projectId })

export const uploadDocIntel = async (projectId, file) => {
  const form = new FormData()
  form.append('projectId', projectId)
  form.append('file', file, (file && file.name) || 'upload.bin')
  let response
  try {
    response = await fetch(BASE + '/doc-intel/upload', { method: 'POST', body: form })
  } catch (err) {
    throw new Error(networkErrorMessage(err))
  }
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch (_) { body = { raw: text } }
  if (!response.ok) {
    throw new Error(formatApiError(body, text, response.status))
  }
  return body
}

/**
 * @param {string} projectId
 * @param {string} docId
 * @param {{ extractMode?: string, allowCreateMetamodel?: boolean, scopeParentIris?: string[] }} [options]
 */
export const startDocIntelJob = (projectId, docId, options = {}) =>
  postJson('/doc-intel/jobs', {
    projectId,
    docId,
    extractMode: options.extractMode || 'populate',
    allowCreateMetamodel: !!options.allowCreateMetamodel,
    ...(Array.isArray(options.scopeParentIris) && options.scopeParentIris.length
      ? { scopeParentIris: options.scopeParentIris }
      : {})
  })

export const getDocIntelJob = (projectId, jobId) =>
  postJson('/doc-intel/jobs/get', { projectId, jobId })

export const listDocIntelChunks = (projectId, docId) =>
  postJson('/doc-intel/chunks', { projectId, ...(docId ? { docId } : {}) })

export const listDocIntelCandidates = (projectId, status) =>
  postJson('/doc-intel/candidates/list', { projectId, ...(status ? { status } : {}) })

export const promoteDocIntelIntake = (projectId, candidateId, asKind) =>
  postJson('/doc-intel/intake/promote', { projectId, candidateId, as: asKind || 'term' })

export const dismissDocIntelIntake = (projectId, candidateId) =>
  postJson('/doc-intel/intake/dismiss', { projectId, candidateId })

export const decideDocIntelCandidate = (projectId, candidateId, decision, editedLabel) =>
  postJson('/doc-intel/candidates/decide', {
    projectId,
    candidateId,
    decision,
    ...(editedLabel ? { editedLabel } : {})
  })

/** Write all pending candidates into the current project ontology. */
export const acceptDocIntelPending = (projectId) =>
  postJson('/doc-intel/candidates/accept-pending', { projectId })

export const getDocIntelEvidence = (projectId, candidateId) =>
  postJson('/doc-intel/evidence/get', { projectId, candidateId })

export const seedDocIntelDemo = (projectId) =>
  postJson('/doc-intel/seed-demo', { projectId })

/** Optional Argilla review bridge. */
export const pushDocIntelArgilla = (projectId) =>
  postJson('/doc-intel/argilla/push', { projectId })

export const syncDocIntelArgilla = (projectId) =>
  postJson('/doc-intel/argilla/sync', { projectId })

/** Metamodel tree + pending change overlays (add/modify/delete). */
export const getDocIntelStructureReview = (projectId) =>
  postJson('/doc-intel/structure-review', { projectId })

/** Batch accept|reject candidate ids from structure tree. */
export const decideDocIntelBatch = (projectId, candidateIds, decision) =>
  postJson('/doc-intel/candidates/decide-batch', {
    projectId,
    candidateIds: candidateIds || [],
    decision
  })

/**
 * Behavior state machine on class×behavior SubClassOf annotation (like functionCode).
 * @param {string} projectId
 * @param {{ classIri: string, behaviorIri: string }} subject
 * @param {string} [kind]
 */
export const getClassBehavior = (projectId, subject, kind = 'stateMachine') => {
  return postJson('/class-behavior/get', {
    projectId,
    kind,
    classIri: subject && subject.classIri,
    behaviorIri: subject && subject.behaviorIri
  })
}

export const saveClassBehavior = (projectId, subject, kind, payload) => {
  return postJson('/class-behavior/save', {
    projectId,
    kind: kind || 'stateMachine',
    classIri: subject && subject.classIri,
    behaviorIri: subject && subject.behaviorIri,
    machine: payload && payload.machine,
    graph: payload && payload.graph
  })
}

export const deleteClassBehavior = (projectId, subject, kind = 'stateMachine') => {
  return postJson('/class-behavior/delete', {
    projectId,
    kind,
    classIri: subject && subject.classIri,
    behaviorIri: subject && subject.behaviorIri
  })
}
