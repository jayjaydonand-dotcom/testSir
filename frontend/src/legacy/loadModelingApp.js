/**
 * Loads the modeling IIFE from the single source file under src/legacy.
 * (Avoids drifting copies of public/modeling-app.js.)
 */
let loading = null

export function loadModelingApp() {
  if (typeof window !== 'undefined' && window.ModelingApp) {
    return Promise.resolve(window.ModelingApp)
  }
  if (loading) return loading
  loading = import('./modeling-app.js').then((mod) => {
    const api = (mod && (mod.default || mod.ModelingApp)) || (typeof window !== 'undefined' && window.ModelingApp)
    if (!api) {
      throw new Error('ModelingApp missing after importing modeling-app.js')
    }
    if (typeof window !== 'undefined') {
      window.ModelingApp = api
    }
    return api
  })
  return loading
}
