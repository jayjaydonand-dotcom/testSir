/**
 * Legacy modeling fetch shim.
 * Modeling app now calls /api/onto/* with JSON bodies; this shim is a no-op
 * safety net that only rewrites leftover /modeling/*.jsp and /data/* URLs
 * into the new body-based API (should not be needed after modeling-app update).
 */
export function installModelingFetchShim() {
  if (typeof window === 'undefined' || window.__modelingFetchShimInstalled) {
    return () => {}
  }
  const originalFetch = window.fetch.bind(window)
  window.__modelingFetchShimInstalled = true

  async function rewriteLegacy(input, init) {
    const raw = typeof input === 'string' ? input : (input && input.url) || ''
    let url
    try {
      url = new URL(raw, window.location.origin)
    } catch (_) {
      return originalFetch(input, init)
    }
    const path = url.pathname
    const project = url.searchParams.get('project')
    const headers = new Headers((init && init.headers) || (typeof input !== 'string' && input.headers) || {})
    const baseInit = init ? { ...init, headers } : { headers }

    const post = (apiPath, body) => {
      headers.set('Content-Type', 'application/json; charset=utf-8')
      headers.set('Accept', 'application/json')
      return originalFetch(apiPath, {
        ...baseInit,
        method: 'POST',
        body: JSON.stringify(body),
        cache: 'no-store'
      })
    }

    if (path === '/data/projects') {
      return originalFetch('/api/onto/projects', baseInit)
    }
    const snap = path.match(/^\/data\/projects\/([^/]+)\/ontology-snapshot$/)
    if (snap) {
      return post('/api/onto/ontology-snapshot', {
        projectId: decodeURIComponent(snap[1])
      })
    }
    const rev = path.match(/^\/data\/projects\/([^/]+)\/revisions$/)
    if (rev) {
      return post('/api/onto/revisions', {
        projectId: decodeURIComponent(rev[1]),
        from: Number(url.searchParams.get('from') || 1),
        to: url.searchParams.get('to') || 'HEAD'
      })
    }
    const ax = path.match(/^\/data\/projects\/([^/]+)\/axioms$/)
    if (ax) {
      const owl = baseInit.body != null ? String(baseInit.body) : ''
      return post('/api/onto/axioms', {
        projectId: decodeURIComponent(ax[1]),
        msg: url.searchParams.get('msg') || 'Added axioms',
        owl
      })
    }

    if (!project) {
      return originalFetch(input, init)
    }

    if (path === '/modeling/consistency-results.jsp') {
      return post('/api/onto/consistency-results', { projectId: project })
    }
    if (path === '/modeling/reason-consistency.jsp') {
      return post('/api/onto/reason/consistency', { projectId: project })
    }
    if (path === '/modeling/reason-swrl.jsp') {
      return post('/api/onto/reason/swrl', { projectId: project })
    }
    if (path === '/modeling/reason-classify.jsp') {
      const individual = url.searchParams.get('individual')
      return post('/api/onto/reason/classify', {
        projectId: project,
        ...(individual ? { individual } : {})
      })
    }
    if (path === '/modeling/swrl-candidates.jsp') {
      const method = String((baseInit.method || 'GET')).toUpperCase()
      if (method === 'GET') {
        return post('/api/onto/swrl-candidates/get', { projectId: project })
      }
      let payload = {}
      try {
        payload = baseInit.body ? JSON.parse(String(baseInit.body)) : {}
      } catch (_) {
        payload = {}
      }
      payload.projectId = project
      return post('/api/onto/swrl-candidates', payload)
    }
    if (path === '/modeling/delete-individual.jsp') {
      return post('/api/onto/delete-individual', {
        projectId: project,
        iri: url.searchParams.get('iri') || ''
      })
    }
    if (path === '/modeling/delete-axioms.jsp') {
      const owl = baseInit.body != null ? String(baseInit.body) : ''
      return post('/api/onto/delete-axioms', {
        projectId: project,
        msg: url.searchParams.get('msg') || 'Deleted axioms',
        owl
      })
    }
    if (path === '/modeling/delete-property-assertions.jsp') {
      return post('/api/onto/delete-property-assertions', {
        projectId: project,
        individual: url.searchParams.get('individual') || '',
        property: url.searchParams.get('property') || '',
        kind: url.searchParams.get('kind') || 'data',
        msg: url.searchParams.get('msg') || ''
      })
    }
    if (path === '/modeling/cleanup-invalid-individuals.jsp') {
      return post('/api/onto/cleanup-invalid-individuals', { projectId: project })
    }

    return originalFetch(input, init)
  }

  window.fetch = function (input, init) {
    return rewriteLegacy(input, init)
  }

  return function uninstall() {
    window.fetch = originalFetch
    window.__modelingFetchShimInstalled = false
  }
}
