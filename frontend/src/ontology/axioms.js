import { OWL_THING, RDFS_LABEL, XSD } from './constants.js'

export function iri(value) {
  return '<' + value + '>'
}

export function mintIri() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let local = 'R'
  for (let i = 0; i < 16; i++) local += chars.charAt(Math.floor(Math.random() * chars.length))
  return 'http://webprotege.stanford.edu/' + local
}

export function labelAxioms(entityIri, name) {
  if (!name) return []
  return ['AnnotationAssertion(<' + RDFS_LABEL + '> ' + iri(entityIri) + ' "' + escapeLiteral(name) + '"@zh)']
}

export function escapeLiteral(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function literal(text, datatype) {
  const dt = datatype || (XSD + 'string')
  return '"' + escapeLiteral(text) + '"^^<' + dt + '>'
}

export function renderOntology(axioms) {
  return [
    'Prefix(owl:=<http://www.w3.org/2002/07/owl#>)',
    'Prefix(rdf:=<http://www.w3.org/1999/02/22-rdf-syntax-ns#>)',
    'Prefix(xsd:=<' + XSD + '>)',
    'Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)',
    'Ontology(<http://webprotege.stanford.edu/modeling/temp>',
    (axioms || []).join('\n'),
    ')'
  ].join('\n')
}

export function axiomsForClass(parentIri, name) {
  const classIri = mintIri()
  return {
    iri: classIri,
    axioms: [
      'Declaration(Class(' + iri(classIri) + '))',
      ...labelAxioms(classIri, name),
      'SubClassOf(' + iri(classIri) + ' ' + iri(parentIri || OWL_THING) + ')'
    ]
  }
}

export function classRestrictionAxiom(classIri, propertyIri, rangeIri, isData, constraint) {
  const mode = (constraint && constraint.mode) || 'some'
  const filler = isData
    ? ('DataSomeValuesFrom(' + iri(propertyIri) + ' ' + iri(rangeIri || XSD + 'string') + ')')
    : ('ObjectSomeValuesFrom(' + iri(propertyIri) + ' ' + iri(rangeIri || OWL_THING) + ')')
  if (mode === 'only') {
    const only = isData
      ? ('DataAllValuesFrom(' + iri(propertyIri) + ' ' + iri(rangeIri || XSD + 'string') + ')')
      : ('ObjectAllValuesFrom(' + iri(propertyIri) + ' ' + iri(rangeIri || OWL_THING) + ')')
    return 'SubClassOf(' + iri(classIri) + ' ' + only + ')'
  }
  return 'SubClassOf(' + iri(classIri) + ' ' + filler + ')'
}

export function axiomsForDataField(classIri, name, datatype) {
  const propertyIri = mintIri()
  const dt = datatype || (XSD + 'string')
  return [
    'Declaration(DataProperty(' + iri(propertyIri) + '))',
    ...labelAxioms(propertyIri, name),
    'DataPropertyDomain(' + iri(propertyIri) + ' ' + iri(classIri) + ')',
    'DataPropertyRange(' + iri(propertyIri) + ' ' + iri(dt) + ')',
    classRestrictionAxiom(classIri, propertyIri, dt, true, { mode: 'some' })
  ]
}

export function axiomsForObjectField(classIri, name, rangeIri) {
  const propertyIri = mintIri()
  const range = rangeIri || OWL_THING
  return [
    'Declaration(ObjectProperty(' + iri(propertyIri) + '))',
    ...labelAxioms(propertyIri, name),
    'ObjectPropertyDomain(' + iri(propertyIri) + ' ' + iri(classIri) + ')',
    'ObjectPropertyRange(' + iri(propertyIri) + ' ' + iri(range) + ')',
    classRestrictionAxiom(classIri, propertyIri, range, false, { mode: 'some' })
  ]
}

export function axiomsForInstance(classIri, name, values) {
  const individualIri = mintIri()
  const axioms = [
    'Declaration(NamedIndividual(' + iri(individualIri) + '))',
    ...labelAxioms(individualIri, name),
    'ClassAssertion(' + iri(classIri) + ' ' + iri(individualIri) + ')'
  ]
  ;(values || []).forEach((value) => {
    if (value.kind === 'data' && value.text !== '' && value.text != null) {
      axioms.push('DataPropertyAssertion(' + iri(value.property) + ' ' + iri(individualIri) + ' ' + literal(value.text, value.datatype) + ')')
    }
    if (value.kind === 'object' && value.targetIri) {
      axioms.push('ObjectPropertyAssertion(' + iri(value.property) + ' ' + iri(individualIri) + ' ' + iri(value.targetIri) + ')')
    }
  })
  return { iri: individualIri, axioms }
}
