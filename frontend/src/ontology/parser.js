import { OWL_THING, PREFIX, RDFS_LABEL } from './constants.js'

function expandPrefixed(token) {
  if (!token) return null
  const t = String(token).trim()
  const iriMatch = t.match(/^<([^>]+)>$/)
  if (iriMatch) return iriMatch[1]
  const pref = t.match(/^([A-Za-z][A-Za-z0-9_]*):([A-Za-z0-9_\-.]+)$/)
  if (pref && PREFIX[pref[1]]) return PREFIX[pref[1]] + pref[2]
  return null
}

function extractIri(token) {
  return expandPrefixed(token)
}

function splitArgs(inner) {
  const args = []
  let depthParen = 0
  let inIri = false
  let inStr = false
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (inStr) {
      if (ch === '"' && inner[i - 1] !== '\\') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '<') inIri = true
    else if (ch === '>') inIri = false
    else if (!inIri) {
      if (ch === '(') depthParen++
      else if (ch === ')') depthParen--
      else if (ch === ' ' && depthParen === 0) {
        const part = inner.slice(start, i).trim()
        if (part) args.push(part)
        start = i + 1
      }
    }
  }
  const last = inner.slice(start).trim()
  if (last) args.push(last)
  return args
}

function blankClass(iri) {
  return { iri, label: null, parents: [], children: [] }
}
function blankIndividual(iri) {
  return { iri, label: null, types: [] }
}
function blankProperty(iri) {
  return { iri, label: null, domains: [], ranges: [], restrictions: [] }
}

export function localName(iri) {
  if (!iri) return ''
  const hash = iri.lastIndexOf('#')
  if (hash >= 0) return iri.slice(hash + 1)
  const slash = iri.lastIndexOf('/')
  return slash >= 0 ? iri.slice(slash + 1) : iri
}

export function labelOf(entity) {
  if (!entity) return ''
  return entity.label || localName(entity.iri) || entity.iri
}

export function modelFromRevisions(revisions) {
  const axiomMap = {}
  ;(revisions || []).forEach((rev) => {
    ;(rev.changes || []).forEach((change) => {
      const axiom = change && change.axiom
      if (!axiom || typeof axiom !== 'string') return
      const op = String(change.operation || 'ADD').toUpperCase()
      if (op.indexOf('REMOVE') >= 0) delete axiomMap[axiom]
      else axiomMap[axiom] = axiom
    })
  })
  const axioms = Object.keys(axiomMap)
  return { axioms, model: parseAxioms(axioms), revisionCount: (revisions || []).length }
}

export function parseAxioms(axioms) {
  const model = {
    classes: {},
    individuals: {},
    dataProperties: {},
    objectProperties: {},
    swrlRules: [],
    classAssertions: [],
    subclassOf: [],
    dataAssertions: [],
    objectAssertions: []
  }
  model.classes[OWL_THING] = blankClass(OWL_THING)
  model.classes[OWL_THING].label = 'Thing'

  function ensureClass(iri) {
    if (!iri) return
    model.classes[iri] = model.classes[iri] || blankClass(iri)
  }
  function ensureInd(iri) {
    if (!iri) return
    model.individuals[iri] = model.individuals[iri] || blankIndividual(iri)
  }
  function ensureData(iri) {
    if (!iri) return
    model.dataProperties[iri] = model.dataProperties[iri] || blankProperty(iri)
  }
  function ensureObject(iri) {
    if (!iri) return
    model.objectProperties[iri] = model.objectProperties[iri] || blankProperty(iri)
  }

  ;(axioms || []).forEach((ax) => {
    if (!ax || typeof ax !== 'string') return
    const text = ax.trim()
    let m

    m = text.match(/^Declaration\(Class\((.+)\)\)$/)
    if (m) { ensureClass(extractIri(m[1])); return }
    m = text.match(/^Declaration\(NamedIndividual\((.+)\)\)$/)
    if (m) { ensureInd(extractIri(m[1])); return }
    m = text.match(/^Declaration\(DataProperty\((.+)\)\)$/)
    if (m) { ensureData(extractIri(m[1])); return }
    m = text.match(/^Declaration\(ObjectProperty\((.+)\)\)$/)
    if (m) { ensureObject(extractIri(m[1])); return }

    m = text.match(/^SubClassOf\((.+)\)$/)
    if (m) {
      const args = splitArgs(m[1])
      if (args.length >= 2) {
        const child = extractIri(args[0])
        const parent = extractIri(args[1])
        if (child && parent) {
          ensureClass(child); ensureClass(parent)
          if (model.classes[child].parents.indexOf(parent) < 0) model.classes[child].parents.push(parent)
          if (model.classes[parent].children.indexOf(child) < 0) model.classes[parent].children.push(child)
          model.subclassOf.push({ child, parent })
        } else if (child) {
          // restriction on class
          ensureClass(child)
          const rest = args[1] || ''
          let rm = rest.match(/^DataSomeValuesFrom\((.+) (.+)\)$/) || rest.match(/^DataAllValuesFrom\((.+) (.+)\)$/)
          if (rm) {
            const prop = extractIri(rm[1]); const range = extractIri(rm[2])
            ensureData(prop)
            model.dataProperties[prop].restrictions.push({ classIri: child, propertyIri: prop, range, isData: true })
            if (range && model.dataProperties[prop].ranges.indexOf(range) < 0) model.dataProperties[prop].ranges.push(range)
          }
          rm = rest.match(/^ObjectSomeValuesFrom\((.+) (.+)\)$/) || rest.match(/^ObjectAllValuesFrom\((.+) (.+)\)$/)
          if (rm) {
            const prop = extractIri(rm[1]); const range = extractIri(rm[2])
            ensureObject(prop); ensureClass(range)
            model.objectProperties[prop].restrictions.push({ classIri: child, propertyIri: prop, range, isData: false })
            if (range && model.objectProperties[prop].ranges.indexOf(range) < 0) model.objectProperties[prop].ranges.push(range)
          }
        }
      }
      return
    }

    m = text.match(/^ClassAssertion\((.+)\)$/)
    if (m) {
      const args = splitArgs(m[1])
      if (args.length >= 2) {
        const cls = extractIri(args[0]); const ind = extractIri(args[1])
        if (cls && ind) {
          ensureClass(cls); ensureInd(ind)
          if (model.individuals[ind].types.indexOf(cls) < 0) model.individuals[ind].types.push(cls)
          model.classAssertions.push({ classIri: cls, individualIri: ind, cls, individual: ind })
        }
      }
      return
    }

    m = text.match(/^DataPropertyDomain\((.+) (.+)\)$/)
    if (m) {
      const prop = extractIri(m[1]); const domain = extractIri(m[2])
      ensureData(prop); ensureClass(domain)
      if (domain && model.dataProperties[prop].domains.indexOf(domain) < 0) model.dataProperties[prop].domains.push(domain)
      return
    }
    m = text.match(/^DataPropertyRange\((.+) (.+)\)$/)
    if (m) {
      const prop = extractIri(m[1]); const range = extractIri(m[2])
      ensureData(prop)
      if (range && model.dataProperties[prop].ranges.indexOf(range) < 0) model.dataProperties[prop].ranges.push(range)
      return
    }
    m = text.match(/^ObjectPropertyDomain\((.+) (.+)\)$/)
    if (m) {
      const prop = extractIri(m[1]); const domain = extractIri(m[2])
      ensureObject(prop); ensureClass(domain)
      if (domain && model.objectProperties[prop].domains.indexOf(domain) < 0) model.objectProperties[prop].domains.push(domain)
      return
    }
    m = text.match(/^ObjectPropertyRange\((.+) (.+)\)$/)
    if (m) {
      const prop = extractIri(m[1]); const range = extractIri(m[2])
      ensureObject(prop); ensureClass(range)
      if (range && model.objectProperties[prop].ranges.indexOf(range) < 0) model.objectProperties[prop].ranges.push(range)
      return
    }

    m = text.match(/^DataPropertyAssertion\((.+) (.+) (.+)\)$/)
    if (m) {
      const prop = extractIri(m[1]); const ind = extractIri(m[2])
      ensureData(prop); ensureInd(ind)
      model.dataAssertions.push({ property: prop, individual: ind, literal: m[3] })
      return
    }
    m = text.match(/^ObjectPropertyAssertion\((.+) (.+) (.+)\)$/)
    if (m) {
      const prop = extractIri(m[1]); const src = extractIri(m[2]); const tgt = extractIri(m[3])
      ensureObject(prop); ensureInd(src); ensureInd(tgt)
      model.objectAssertions.push({ property: prop, source: src, target: tgt })
      return
    }

    m = text.match(/^AnnotationAssertion\((.+)\)$/)
    if (m) {
      const args = splitArgs(m[1])
      if (args.length >= 3) {
        const prop = extractIri(args[0]) || (args[0] === 'rdfs:label' ? RDFS_LABEL : null)
        const entity = extractIri(args[1])
        const lit = args[2].match(/^"((?:\\.|[^"\\])*)"/)
        const label = lit ? lit[1] : null
        if (prop === RDFS_LABEL && entity && label) {
          ensureClass(entity)
          if (model.classes[entity]) model.classes[entity].label = label
          if (model.individuals[entity]) model.individuals[entity].label = label
          if (model.dataProperties[entity]) model.dataProperties[entity].label = label
          if (model.objectProperties[entity]) model.objectProperties[entity].label = label
        }
      }
      return
    }

    if (text.indexOf('DLSafeRule(') === 0 || text.indexOf('Rule(') === 0) {
      model.swrlRules.push(text)
    }
  })
  return model
}

export function classLineage(model, classIri) {
  const result = []
  const seen = {}
  let current = classIri
  while (current && !seen[current]) {
    seen[current] = true
    result.push(current)
    const parents = (model.classes[current] && model.classes[current].parents) || []
    current = parents[0] || null
    if (!current) {
      // also walk subclassOf edges
      const edge = (model.subclassOf || []).find((e) => e.child === result[result.length - 1])
      current = edge ? edge.parent : null
    }
  }
  if (result.indexOf(OWL_THING) < 0) result.push(OWL_THING)
  return result
}

export function fieldsOf(model, classIri) {
  const classes = classLineage(model, classIri)
  function matches(property) {
    if ((property.domains || []).some((d) => classes.indexOf(d) >= 0)) return true
    return (property.restrictions || []).some((r) => classes.indexOf(r.classIri) >= 0)
  }
  function sourceOf(property) {
    for (const c of classes) {
      if ((property.domains || []).indexOf(c) >= 0) return c
      if ((property.restrictions || []).some((r) => r.classIri === c)) return c
    }
    return classIri
  }
  function split(list) {
    const local = []
    const inherited = []
    list.forEach((p) => {
      const src = sourceOf(p)
      if (src === classIri) local.push({ ...p, sourceClass: src })
      else inherited.push({ ...p, sourceClass: src })
    })
    return { local, inherited }
  }
  const data = Object.values(model.dataProperties || {}).filter(matches)
  const object = Object.values(model.objectProperties || {}).filter(matches)
  return {
    data: split(data),
    object: split(object),
    allData: data,
    allObject: object
  }
}

/** Protégé-like browser-text order (Unicode); not localeCompare('zh'). */
function compareBrowserText(a, b) {
  const left = String((a && a.label) || a.iri || '').toLowerCase()
  const right = String((b && b.label) || b.iri || '').toLowerCase()
  if (left < right) return -1
  if (left > right) return 1
  const li = (a && a.iri) || ''
  const ri = (b && b.iri) || ''
  if (li < ri) return -1
  if (li > ri) return 1
  return 0
}

export function buildClassTree(model) {
  const classes = model.classes || {}
  function node(iri, trail) {
    const cls = classes[iri]
    if (!cls) return null
    if (trail.has(iri)) return { iri, label: labelOf(cls), children: [] }
    const next = new Set(trail); next.add(iri)
    const children = (cls.children || []).map((c) => node(c, next)).filter(Boolean)
      .sort(compareBrowserText)
    return { iri, label: labelOf(cls), children }
  }
  const thing = classes[OWL_THING]
  if (thing && thing.children && thing.children.length) {
    return thing.children.map((c) => node(c, new Set([OWL_THING]))).filter(Boolean)
      .sort(compareBrowserText)
  }
  return Object.keys(classes)
    .filter((iri) => iri !== OWL_THING && (!classes[iri].parents || !classes[iri].parents.length))
    .map((iri) => node(iri, new Set())).filter(Boolean)
    .sort(compareBrowserText)
}

export { OWL_THING }
