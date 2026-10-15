(function (root, factory) {
    var api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (typeof window !== "undefined") {
        window.ModelingApp = api;
    }
    
})(this, function () {
    var OWL_THING = "http://www.w3.org/2002/07/owl#Thing";
    var UNTYPED = "modeling:untyped";
    var XSD = "http://www.w3.org/2001/XMLSchema#";
    var BENTI_NS = "http://example.org/benti#";
    var UI_FACET = BENTI_NS + "uiFacet";
    var UI_UNIT = BENTI_NS + "uiUnit";
    var UI_FUNCTION_CODE = BENTI_NS + "functionCode";
    /** Class-level JSON state machine (machine + Vue Flow layout). */
    var UI_STATE_GRAPH = BENTI_NS + "stateGraph";
    /** Class role: metamodel (骨架) | model (带约束的子类). */
    var UI_ROLE = BENTI_NS + "uiRole";
    var UI_ENUM_VALUES = BENTI_NS + "enumValues";
    var UI_MIN_VALUE = BENTI_NS + "minValue";
    var UI_MAX_VALUE = BENTI_NS + "maxValue";
    var ROLE_METAMODEL = "metamodel";
    var ROLE_MODEL = "model";
    var FACET_TABS = [
        {id: "technicalParam", label: "技术参数"},
        {id: "stateVariable", label: "状态变量"},
        {id: "relation", label: "关系"},
        {id: "function", label: "功能"},
        {id: "behavior", label: "行为"},
        {id: "general", label: "常规"}
    ];
    var FACET_ALIASES = {
        technicalParam: "technicalParam",
        "技术参数": "technicalParam",
        stateVariable: "stateVariable",
        "状态变量": "stateVariable",
        "function": "function",
        "功能": "function",
        behavior: "behavior",
        "行为": "behavior",
        relation: "relation",
        "关系": "relation"
    };
    function normalizeFacet(value) {
        return FACET_ALIASES[String(value || "").trim()] || "";
    }
    function facetLabel(id) {
        var found = FACET_TABS.filter(function (tab) { return tab.id === id; })[0];
        return found ? found.label : id;
    }
    /**
     * True when this class (or an ancestor) already uses benti:uiFacet on any
     * property restriction — i.e. the facet tabs were intentionally designed.
     */
    function classUsesFacetTabs(classIri, model) {
        if (!classIri || !model) {
            return false;
        }
        var lineage = classLineage(model, classIri);
        var bags = [model.dataProperties || {}, model.objectProperties || {}];
        for (var b = 0; b < bags.length; b++) {
            var map = bags[b];
            var iris = Object.keys(map);
            for (var i = 0; i < iris.length; i++) {
                var restrictions = (map[iris[i]] && map[iris[i]].restrictions) || [];
                for (var r = 0; r < restrictions.length; r++) {
                    var item = restrictions[r];
                    if (item && item.uiFacet && lineage.indexOf(item.classIri) >= 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Resolve UI facet for a property in the context of a class.
     * Only reads uiFacet from that class's (or an ancestor's) SubClassOf restriction.
     * When the class already has facet annotations, unannotated props stay out of
     * the five tabs (avoids Platform leftovers dumping into 技术参数).
     * When no facets exist at all, keep the legacy default (data→技术参数, object→关系).
     */
    function propertyTabOf(property, isData, classIri, model) {
        var restrictions = (property && property.restrictions) || [];
        if (classIri) {
            var exact = restrictions.filter(function (item) {
                return item.classIri === classIri && item.uiFacet;
            })[0];
            if (exact && exact.uiFacet) {
                return exact.uiFacet;
            }
            if (model) {
                var lineage = classLineage(model, classIri);
                for (var i = 0; i < lineage.length; i++) {
                    var ancestor = lineage[i];
                    if (ancestor === classIri) {
                        continue;
                    }
                    var inherited = restrictions.filter(function (item) {
                        return item.classIri === ancestor && item.uiFacet;
                    })[0];
                    if (inherited && inherited.uiFacet) {
                        return inherited.uiFacet;
                    }
                }
                if (classUsesFacetTabs(classIri, model)) {
                    return "";
                }
            }
        }
        return isData ? "technicalParam" : "relation";
    }
    var DATATYPES = [
        {iri: XSD + "string", label: "字符串"},
        {iri: XSD + "integer", label: "整数"},
        {iri: XSD + "decimal", label: "小数"},
        {iri: XSD + "boolean", label: "布尔"}
    ];

    function parseOntology(text) {
        var prefixes = {};
        var prefixRe = /Prefix\(([^:]*):=<([^>]+)>\)/g;
        var match;
        while ((match = prefixRe.exec(text))) {
            prefixes[match[1]] = match[2];
        }

        var ontologyInner = extractCall(text, "Ontology");
        var model = {
            classes: {},
            classOrder: [],
            dataProperties: {},
            objectProperties: {},
            individuals: {},
            subclassOf: [],
            equivalents: {},
            disjointWith: {},
            disjointUnions: {},
            classAssertions: [],
            dataAssertions: [],
            objectAssertions: [],
            pendingLabels: {},
            pendingComments: {},
            pendingUnits: {},
            pendingRoles: {}
        };
        if (!ontologyInner) {
            ensureThing(model);
            return model;
        }
        splitTop(ontologyInner).forEach(function (form) {
            var call = parseCall(form);
            if (!call) {
                return;
            }
            applyAxiom(model, prefixes, call.name, call.inner);
        });
        Object.keys(model.pendingLabels).forEach(function (iri) {
            var buckets = [];
            if (model.classes[iri]) {
                buckets.push(model.classes[iri]);
            }
            if (model.dataProperties[iri]) {
                buckets.push(model.dataProperties[iri]);
            }
            if (model.objectProperties[iri]) {
                buckets.push(model.objectProperties[iri]);
            }
            if (model.individuals[iri]) {
                buckets.push(model.individuals[iri]);
            }
            if (!buckets.length) {
                model.individuals[iri] = blankIndividual(iri);
                buckets.push(model.individuals[iri]);
            }
            model.pendingLabels[iri].forEach(function (literal) {
                buckets.forEach(function (bucket) {
                    bucket.labels.push(literal);
                });
            });
        });
        Object.keys(model.pendingComments).forEach(function (iri) {
            if (model.classes[iri]) {
                model.classes[iri].comments = (model.classes[iri].comments || []).concat(model.pendingComments[iri]);
            }
            var commentProp = model.dataProperties[iri] || model.objectProperties[iri];
            if (commentProp) {
                commentProp.comments = (commentProp.comments || []).concat(model.pendingComments[iri]);
            }
        });
        Object.keys(model.pendingUnits).forEach(function (iri) {
            var prop = model.dataProperties[iri] || model.objectProperties[iri];
            if (prop) {
                prop.uiUnit = model.pendingUnits[iri];
            }
        });
        Object.keys(model.pendingRoles).forEach(function (iri) {
            if (model.classes[iri]) {
                model.classes[iri].uiRole = model.pendingRoles[iri];
            }
        });
        ensureThing(model);
        return model;
    }

    function applyAxiom(model, prefixes, name, inner) {
        var args = splitTop(inner);
        if (name === "Declaration") {
            var entity = parseCall(args[0] || "");
            if (!entity) {
                return;
            }
            var iri = iriOf(prefixes, extractCall(args[0], entity.name));
            if (!iri) {
                return;
            }
            if (entity.name === "Class") {
                ensureClass(model, iri);
            } else if (entity.name === "DataProperty") {
                model.dataProperties[iri] = model.dataProperties[iri] || blankProperty(iri);
            } else if (entity.name === "ObjectProperty") {
                model.objectProperties[iri] = model.objectProperties[iri] || blankProperty(iri);
            } else if (entity.name === "NamedIndividual") {
                model.individuals[iri] = model.individuals[iri] || blankIndividual(iri);
            }
            return;
        }
        if (name === "AnnotationAssertion") {
            var kindAt = -1;
            var annKind = "";
            for (var i = 0; i < args.length; i++) {
                var expandedAnn = expand(prefixes, args[i]);
                if (expandedAnn === "http://www.w3.org/2000/01/rdf-schema#label") {
                    kindAt = i;
                    annKind = "label";
                    break;
                }
                if (expandedAnn === "http://www.w3.org/2000/01/rdf-schema#comment") {
                    kindAt = i;
                    annKind = "comment";
                    break;
                }
                if (expandedAnn === UI_UNIT || /#uiUnit$/.test(expandedAnn)) {
                    kindAt = i;
                    annKind = "unit";
                    break;
                }
                if (expandedAnn === UI_ROLE || /#uiRole$/.test(expandedAnn)) {
                    kindAt = i;
                    annKind = "role";
                    break;
                }
            }
            if (kindAt >= 0 && args.length >= kindAt + 3) {
                var subject = iriOf(prefixes, args[kindAt + 1]);
                var literal = parseLiteral(prefixes, args[kindAt + 2]);
                if (subject && literal) {
                    if (annKind === "label") {
                        var pending = model.pendingLabels[subject] || [];
                        pending.push(literal);
                        model.pendingLabels[subject] = pending;
                    } else if (annKind === "comment") {
                        var pendingComments = model.pendingComments[subject] || [];
                        pendingComments.push(literal);
                        model.pendingComments[subject] = pendingComments;
                    } else if (annKind === "unit") {
                        model.pendingUnits[subject] = literal.value;
                    } else if (annKind === "role") {
                        var roleVal = String(literal.value || "").trim().toLowerCase();
                        if (roleVal === ROLE_MODEL || roleVal === ROLE_METAMODEL) {
                            model.pendingRoles[subject] = roleVal;
                        }
                    }
                }
            }
            return;
        }
        if (name === "SubClassOf" && args.length >= 2) {
            var subclassParts = peelAxiomAnnotations(args, prefixes);
            var subclassArgs = subclassParts.rest;
            if (subclassArgs.length < 2) {
                return;
            }
            var restrictionFacet = facetFromAxiomAnnotations(subclassParts.annotations);
            var restrictionFunctionCode = functionCodeFromAxiomAnnotations(subclassParts.annotations);
            var restrictionStateGraph = stateGraphFromAxiomAnnotations(subclassParts.annotations);
            var restrictionExtras = constraintExtrasFromAxiomAnnotations(subclassParts.annotations);
            var child = iriOf(prefixes, subclassArgs[0]);
            var parent = iriOf(prefixes, subclassArgs[1]);
            if (child && parent) {
                ensureClass(model, child);
                ensureClass(model, parent);
                model.subclassOf.push({child: child, parent: parent});
                return;
            }
            if (child) {
                ensureClass(model, child);
                var parentExpr = parseCall(subclassArgs[1]);
                if (parentExpr) {
                    applyClassRestriction(
                        model,
                        prefixes,
                        child,
                        parentExpr,
                        restrictionFacet,
                        restrictionFunctionCode,
                        restrictionStateGraph,
                        restrictionExtras
                    );
                }
            }
            return;
        }
        if (name === "EquivalentClasses" && args.length >= 2) {
            applyEquivalentClasses(model, prefixes, args);
            return;
        }
        if (name === "DisjointClasses" && args.length >= 2) {
            applyDisjointClasses(model, prefixes, args);
            return;
        }
        if (name === "DisjointUnion" && args.length >= 3) {
            applyDisjointUnion(model, prefixes, args);
            return;
        }
        if (name === "DataPropertyDomain" && args.length >= 2) {
            var prop = iriOf(prefixes, args[0]);
            var domain = iriOf(prefixes, args[1]);
            if (prop && domain) {
                var dataProp = model.dataProperties[prop] || blankProperty(prop);
                dataProp.domains.push(domain);
                model.dataProperties[prop] = dataProp;
                ensureClass(model, domain);
            }
            return;
        }
        if (name === "DataPropertyRange" && args.length >= 2) {
            var dataPropIri = iriOf(prefixes, args[0]);
            var range = iriOf(prefixes, args[1]);
            if (dataPropIri && range) {
                var dp = model.dataProperties[dataPropIri] || blankProperty(dataPropIri);
                dp.ranges.push(range);
                model.dataProperties[dataPropIri] = dp;
            }
            return;
        }
        if (name === "ObjectPropertyDomain" && args.length >= 2) {
            var objectProp = iriOf(prefixes, args[0]);
            var objectDomain = iriOf(prefixes, args[1]);
            if (objectProp && objectDomain) {
                var op = model.objectProperties[objectProp] || blankProperty(objectProp);
                op.domains.push(objectDomain);
                model.objectProperties[objectProp] = op;
                ensureClass(model, objectDomain);
            }
            return;
        }
        if (name === "ObjectPropertyRange" && args.length >= 2) {
            var objectPropIri = iriOf(prefixes, args[0]);
            var objectRange = iriOf(prefixes, args[1]);
            if (objectPropIri && objectRange) {
                var property = model.objectProperties[objectPropIri] || blankProperty(objectPropIri);
                property.ranges.push(objectRange);
                model.objectProperties[objectPropIri] = property;
                ensureClass(model, objectRange);
            }
            return;
        }
        if (name === "ClassAssertion" && args.length >= 2) {
            var cls = iriOf(prefixes, args[0]);
            var individual = iriOf(prefixes, args[1]);
            if (cls && individual) {
                ensureClass(model, cls);
                model.individuals[individual] = model.individuals[individual] || blankIndividual(individual);
                model.classAssertions.push({cls: cls, individual: individual});
            }
            return;
        }
        if (name === "DataPropertyAssertion" && args.length >= 3) {
            var dataProperty = iriOf(prefixes, args[0]);
            var dataIndividual = iriOf(prefixes, args[1]);
            var value = parseLiteral(prefixes, args[2]);
            if (dataProperty && dataIndividual && value) {
                model.individuals[dataIndividual] = model.individuals[dataIndividual] || blankIndividual(dataIndividual);
                model.dataAssertions.push({property: dataProperty, individual: dataIndividual, literal: value});
            }
            return;
        }
        if (name === "ObjectPropertyAssertion" && args.length >= 3) {
            var rel = iriOf(prefixes, args[0]);
            var source = iriOf(prefixes, args[1]);
            var target = iriOf(prefixes, args[2]);
            if (rel && source && target) {
                model.individuals[source] = model.individuals[source] || blankIndividual(source);
                model.individuals[target] = model.individuals[target] || blankIndividual(target);
                model.objectAssertions.push({property: rel, source: source, target: target});
            }
        }
    }

    function blankProperty(iri) {
        return {iri: iri, labels: [], comments: [], domains: [], ranges: [], restrictions: [], uiUnit: ""};
    }

    function peelAxiomAnnotations(args, prefixes) {
        var annotations = [];
        var rest = [];
        var i = 0;
        for (; i < (args || []).length; i++) {
            var call = parseCall(args[i]);
            if (!call || call.name !== "Annotation") {
                break;
            }
            var annArgs = splitTop(call.inner);
            if (annArgs.length >= 2) {
                var annProp = expand(prefixes, annArgs[0]) || iriOf(prefixes, annArgs[0]);
                var literal = parseLiteral(prefixes, annArgs[1]);
                if (annProp && literal) {
                    annotations.push({property: annProp, literal: literal});
                }
            }
        }
        rest = (args || []).slice(i);
        return {annotations: annotations, rest: rest};
    }

    function facetFromAxiomAnnotations(annotations) {
        for (var i = 0; i < (annotations || []).length; i++) {
            var item = annotations[i];
            var prop = item && item.property;
            if (prop === UI_FACET || /#uiFacet$/.test(String(prop || ""))) {
                return normalizeFacet(item.literal && item.literal.value);
            }
        }
        return "";
    }

    function functionCodeFromAxiomAnnotations(annotations) {
        for (var i = 0; i < (annotations || []).length; i++) {
            var item = annotations[i];
            var prop = item && item.property;
            if (prop === UI_FUNCTION_CODE || /#functionCode$/.test(String(prop || ""))) {
                return item.literal && item.literal.value != null ? String(item.literal.value) : "";
            }
        }
        return "";
    }

    function annotationLiteralValue(annotations, propIri, propSuffix) {
        for (var i = 0; i < (annotations || []).length; i++) {
            var item = annotations[i];
            var prop = item && item.property;
            if (prop === propIri || (propSuffix && String(prop || "").indexOf(propSuffix) >= 0)) {
                return item.literal && item.literal.value != null ? String(item.literal.value) : "";
            }
        }
        return "";
    }

    function constraintExtrasFromAxiomAnnotations(annotations) {
        return {
            enumValues: annotationLiteralValue(annotations, UI_ENUM_VALUES, "#enumValues"),
            minValue: annotationLiteralValue(annotations, UI_MIN_VALUE, "#minValue"),
            maxValue: annotationLiteralValue(annotations, UI_MAX_VALUE, "#maxValue")
        };
    }

    function uiRoleOf(classIri, model) {
        var cls = model && model.classes && model.classes[classIri];
        return (cls && cls.uiRole) || "";
    }

    /** Explicit model class (constrained subclass). */
    function isModelClass(classIri, model) {
        return uiRoleOf(classIri, model) === ROLE_MODEL;
    }

    /**
     * Metamodel / skeleton class. Unmarked classes default to metamodel
     * so existing projects keep working under 元模型管理.
     */
    function isMetamodelClass(classIri, model) {
        if (!classIri || classIri === OWL_THING || classIri === UNTYPED) {
            return false;
        }
        return !isModelClass(classIri, model);
    }

    function nearestMetamodelIri(classIri, model) {
        if (!classIri || !model) {
            return "";
        }
        if (isMetamodelClass(classIri, model)) {
            return classIri;
        }
        var lineage = classLineage(model, classIri);
        for (var i = 0; i < lineage.length; i++) {
            if (isMetamodelClass(lineage[i], model)) {
                return lineage[i];
            }
        }
        return "";
    }

    function listModelChildren(model, parentIri) {
        return childrenOf(model, parentIri).filter(function (childIri) {
            return isModelClass(childIri, model);
        });
    }

    /** All classes marked uiRole=model (flat list for 模型管理). */
    function listAllModelClasses(model) {
        return Object.keys((model && model.classes) || {}).filter(function (iriValue) {
            return isModelClass(iriValue, model);
        }).sort(function (left, right) {
            return compareClassByBrowserText(model, left, right);
        });
    }

    function uiRoleAxioms(classIri, role) {
        var next = role === ROLE_MODEL ? ROLE_MODEL : ROLE_METAMODEL;
        return [
            "Declaration(AnnotationProperty(" + iri(UI_ROLE) + "))",
            annotationLiteralAxiom(UI_ROLE, classIri, next)
        ];
    }

    function stateGraphFromAxiomAnnotations(annotations) {
        for (var i = 0; i < (annotations || []).length; i++) {
            var item = annotations[i];
            var prop = item && item.property;
            if (prop === UI_STATE_GRAPH || /#stateGraph$/.test(String(prop || ""))) {
                return item.literal && item.literal.value != null ? String(item.literal.value) : "";
            }
        }
        return "";
    }

    function parseStateGraphLiteral(raw) {
        if (!raw || !String(raw).trim()) {
            return null;
        }
        try {
            var doc = JSON.parse(String(raw));
            if (!doc || typeof doc !== "object") {
                return null;
            }
            return {
                kind: doc.kind || "stateMachine",
                machine: doc.machine || null,
                graph: doc.graph || null,
                updatedAt: doc.updatedAt || null,
                raw: String(raw)
            };
        } catch (e) {
            return {kind: "stateMachine", machine: null, graph: null, updatedAt: null, raw: String(raw)};
        }
    }

    function stateGraphDocHasContent(sg) {
        if (!sg) {
            return false;
        }
        if (sg.machine && sg.machine.states && Object.keys(sg.machine.states).length) {
            return true;
        }
        if (sg.graph && Array.isArray(sg.graph.nodes) && sg.graph.nodes.length) {
            return true;
        }
        return !!(sg.raw && String(sg.raw).trim());
    }

    /**
     * stateGraph on a property usage for classIri (SubClassOf axiom annotation).
     * Falls back to ancestor restriction when inherited — same as functionCodeOf.
     */
    function stateGraphOf(property, classIri, model) {
        var restrictions = (property && property.restrictions) || [];
        if (!classIri) {
            return null;
        }
        var exact = restrictions.filter(function (item) {
            return item.classIri === classIri && item.stateGraph;
        })[0];
        if (exact && exact.stateGraph) {
            return exact.stateGraph;
        }
        if (model) {
            var lineage = classLineage(model, classIri);
            for (var i = 0; i < lineage.length; i++) {
                var ancestor = lineage[i];
                if (ancestor === classIri) {
                    continue;
                }
                var inherited = restrictions.filter(function (item) {
                    return item.classIri === ancestor && item.stateGraph;
                })[0];
                if (inherited && inherited.stateGraph) {
                    return inherited.stateGraph;
                }
            }
        }
        return null;
    }

    function behaviorHasStateGraph(property, classIri, model) {
        return stateGraphDocHasContent(stateGraphOf(property, classIri, model));
    }

    function stateGraphRawOf(property, classIri, model) {
        var sg = stateGraphOf(property, classIri, model);
        return sg && sg.raw ? String(sg.raw) : "";
    }

    /**
     * Flatten state-machine states for instance UI (功能标记 / 当前状态).
     * Prefers machine.states; falls back to graph.nodes.
     */
    function listBehaviorMachineStates(property, classIri, model) {
        var sg = stateGraphOf(property, classIri, model);
        if (!sg) {
            return [];
        }
        var initialId = sg.machine && sg.machine.initial ? String(sg.machine.initial) : "";
        var states = [];
        var seen = {};
        if (sg.machine && sg.machine.states) {
            Object.keys(sg.machine.states).forEach(function (id) {
                var meta = (sg.machine.states[id] && sg.machine.states[id].meta) || {};
                seen[id] = true;
                states.push({
                    id: id,
                    label: meta.label || id,
                    isInitial: initialId ? id === initialId : false,
                    isFinal: !!meta.isFinal
                });
            });
            if (!initialId && states.length) {
                states[0].isInitial = true;
            }
        }
        if ((!states.length) && sg.graph && Array.isArray(sg.graph.nodes)) {
            sg.graph.nodes.forEach(function (node) {
                if (!node || !node.id || seen[node.id]) {
                    return;
                }
                var data = node.data || {};
                states.push({
                    id: String(node.id),
                    label: data.label || String(node.id),
                    isInitial: !!data.isInitial,
                    isFinal: !!data.isFinal
                });
            });
        }
        return states;
    }

    /** Match stored assertion (state id or legacy label) to a machine state id. */
    function matchBehaviorStateId(states, rawValue) {
        var value = String(rawValue == null ? "" : rawValue).trim();
        if (!value || !states || !states.length) {
            return "";
        }
        var byId = states.filter(function (s) { return s.id === value; })[0];
        if (byId) {
            return byId.id;
        }
        var byLabel = states.filter(function (s) { return s.label === value; })[0];
        if (byLabel) {
            return byLabel.id;
        }
        return value;
    }

    function behaviorStateLabel(states, stateId) {
        if (!stateId) {
            return "";
        }
        var hit = (states || []).filter(function (s) { return s.id === stateId; })[0];
        return hit ? (hit.label || hit.id) : stateId;
    }

    function axiomsForBehaviorField(classIri, name, description) {
        var propertyIri = mintIri();
        var axioms = [
            "Declaration(DataProperty(" + iri(propertyIri) + "))"
        ].concat(
            labelAxioms(propertyIri, name),
            commentAxioms(propertyIri, description),
            uiFacetDeclarationAxioms("behavior"),
            [
                "DataPropertyDomain(" + iri(propertyIri) + " " + iri(classIri) + ")",
                "DataPropertyRange(" + iri(propertyIri) + " " + iri(XSD + "string") + ")",
                classRestrictionAxiom(classIri, propertyIri, XSD + "string", true, {mode: "some", n: 1}, "behavior", "")
            ]
        );
        return {propertyIri: propertyIri, axioms: axioms};
    }

    function escapeOwlLiteral(text) {
        return String(text == null ? "" : text)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, "\\\"")
            .replace(/\r\n/g, "\\n")
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\n");
    }

    /**
     * functionCode on a property usage for classIri (SubClassOf axiom annotation).
     * Falls back to ancestor restriction when inherited.
     */
    function functionCodeOf(property, classIri, model) {
        var restrictions = (property && property.restrictions) || [];
        if (!classIri) {
            return "";
        }
        var exact = restrictions.filter(function (item) {
            return item.classIri === classIri && item.functionCode;
        })[0];
        if (exact && exact.functionCode) {
            return exact.functionCode;
        }
        if (model) {
            var lineage = classLineage(model, classIri);
            for (var i = 0; i < lineage.length; i++) {
                var ancestor = lineage[i];
                if (ancestor === classIri) {
                    continue;
                }
                var inherited = restrictions.filter(function (item) {
                    return item.classIri === ancestor && item.functionCode;
                })[0];
                if (inherited && inherited.functionCode) {
                    return inherited.functionCode;
                }
            }
        }
        return "";
    }

    function applyClassRestriction(model, prefixes, classIri, expr, uiFacet, functionCode, stateGraphRaw, extras) {
        var restrictionFacet = normalizeFacet(uiFacet) || "";
        var code = functionCode != null ? String(functionCode) : "";
        var graphDoc = parseStateGraphLiteral(stateGraphRaw);
        extras = extras || {};
        var enumValues = extras.enumValues || "";
        var minValue = extras.minValue || "";
        var maxValue = extras.maxValue || "";
        var hasValueMatch = expr.name && expr.name.match(/^(Data|Object)HasValue$/);
        if (hasValueMatch) {
            var hvParts = splitTop(expr.inner);
            if (hvParts.length < 2) {
                return;
            }
            var hvProp = iriOf(prefixes, hvParts[0]);
            if (!hvProp) {
                return;
            }
            var hvIsData = hasValueMatch[1] === "Data";
            var hvBucket = hvIsData ? model.dataProperties : model.objectProperties;
            var hvProperty = hvBucket[hvProp] || blankProperty(hvProp);
            if (hvProperty.domains.indexOf(classIri) < 0) {
                hvProperty.domains.push(classIri);
            }
            var hvValueText = "";
            var hvFiller = "";
            if (!hvIsData) {
                var hvTarget = iriOf(prefixes, hvParts[1]);
                hvFiller = hvTarget || "";
                if (hvTarget) {
                    model.individuals[hvTarget] = model.individuals[hvTarget] || blankIndividual(hvTarget);
                }
            } else {
                var hvLit = parseLiteral(prefixes, hvParts[1]);
                hvValueText = hvLit && hvLit.value != null ? String(hvLit.value) : "";
            }
            hvProperty.restrictions = hvProperty.restrictions || [];
            hvProperty.restrictions.push({
                classIri: classIri,
                mode: "value",
                n: null,
                filler: hvFiller,
                valueText: hvValueText,
                enumValues: "",
                minValue: "",
                maxValue: "",
                uiFacet: restrictionFacet,
                functionCode: code,
                stateGraph: graphDoc
            });
            hvBucket[hvProp] = hvProperty;
            return;
        }
        var match = expr.name && expr.name.match(/^(Data|Object)(SomeValuesFrom|AllValuesFrom|ExactCardinality|MinCardinality|MaxCardinality)$/);
        if (!match) {
            return;
        }
        var isData = match[1] === "Data";
        var form = match[2];
        var parts = splitTop(expr.inner);
        var prop = "";
        var filler = "";
        var cardinality = null;
        var mode = "some";
        if (form === "SomeValuesFrom" || form === "AllValuesFrom") {
            if (parts.length < 2) {
                return;
            }
            prop = iriOf(prefixes, parts[0]);
            filler = iriOf(prefixes, parts[1]);
            mode = form === "AllValuesFrom" ? "only" : "some";
        } else {
            if (parts.length < 2) {
                return;
            }
            cardinality = parseInt(parts[0], 10);
            prop = iriOf(prefixes, parts[1]);
            filler = parts.length >= 3 ? iriOf(prefixes, parts[2]) : "";
            mode = form === "ExactCardinality" ? "exact" : (form === "MinCardinality" ? "min" : "max");
        }
        if (!prop) {
            return;
        }
        if (enumValues) {
            mode = "enum";
        } else if (minValue || maxValue) {
            mode = "range";
        }
        var bucket = isData ? model.dataProperties : model.objectProperties;
        var property = bucket[prop] || blankProperty(prop);
        if (property.domains.indexOf(classIri) < 0) {
            property.domains.push(classIri);
        }
        if (filler && property.ranges.indexOf(filler) < 0) {
            property.ranges.push(filler);
            if (!isData) {
                ensureClass(model, filler);
            }
        }
        property.restrictions = property.restrictions || [];
        property.restrictions.push({
            classIri: classIri,
            mode: mode,
            n: isNaN(cardinality) ? null : cardinality,
            filler: filler || "",
            valueText: "",
            enumValues: enumValues,
            minValue: minValue,
            maxValue: maxValue,
            uiFacet: restrictionFacet,
            functionCode: code,
            stateGraph: graphDoc
        });
        bucket[prop] = property;
    }

    function parseRestrictionMember(prefixes, expr) {
        if (!expr || !expr.name) {
            return null;
        }
        var hasValueMatch = expr.name.match(/^(Data|Object)HasValue$/);
        if (hasValueMatch) {
            var hvParts = splitTop(expr.inner);
            if (hvParts.length < 2) {
                return null;
            }
            var hvProp = iriOf(prefixes, hvParts[0]);
            if (!hvProp) {
                return null;
            }
            if (hasValueMatch[1] === "Data") {
                var lit = parseLiteral(prefixes, hvParts[1]);
                if (!lit) {
                    return null;
                }
                return {
                    kind: "restriction",
                    propertyIri: hvProp,
                    isData: true,
                    mode: "value",
                    n: null,
                    filler: lit.datatype || (XSD + "string"),
                    valueText: lit.value
                };
            }
            var individual = iriOf(prefixes, hvParts[1]);
            if (!individual) {
                return null;
            }
            return {
                kind: "restriction",
                propertyIri: hvProp,
                isData: false,
                mode: "value",
                n: null,
                filler: individual,
                valueText: ""
            };
        }
        var match = expr.name.match(/^(Data|Object)(SomeValuesFrom|AllValuesFrom|ExactCardinality|MinCardinality|MaxCardinality)$/);
        if (!match) {
            return null;
        }
        var isData = match[1] === "Data";
        var form = match[2];
        var parts = splitTop(expr.inner);
        var prop = "";
        var filler = "";
        var cardinality = null;
        var mode = "some";
        if (form === "SomeValuesFrom" || form === "AllValuesFrom") {
            if (parts.length < 2) {
                return null;
            }
            prop = iriOf(prefixes, parts[0]);
            filler = namedClassIriFromExpr(prefixes, parts[1]);
            mode = form === "AllValuesFrom" ? "only" : "some";
        } else {
            if (parts.length < 2) {
                return null;
            }
            cardinality = parseInt(parts[0], 10);
            prop = iriOf(prefixes, parts[1]);
            filler = parts.length >= 3 ? namedClassIriFromExpr(prefixes, parts[2]) : "";
            mode = form === "ExactCardinality" ? "exact" : (form === "MinCardinality" ? "min" : "max");
        }
        if (!prop) {
            return null;
        }
        return {
            kind: "restriction",
            propertyIri: prop,
            isData: isData,
            mode: mode,
            n: isNaN(cardinality) ? null : cardinality,
            filler: filler || ""
        };
    }

    /**
     * Named class IRI from a class expression. Protégé often wraps a single filler
     * as ObjectUnionOf(GroundMover); unwrap singleton Boolean combinations.
     */
    function namedClassIriFromExpr(prefixes, text) {
        var named = iriOf(prefixes, text);
        if (named) {
            return named;
        }
        var expr = parseCall(text);
        if (!expr) {
            return "";
        }
        if (expr.name === "ObjectUnionOf" || expr.name === "ObjectIntersectionOf"
                || expr.name === "DataUnionOf" || expr.name === "DataIntersectionOf") {
            var parts = splitTop(expr.inner);
            if (parts.length === 1) {
                return namedClassIriFromExpr(prefixes, parts[0]);
            }
        }
        return "";
    }

    function parseClassExpressionMembers(prefixes, text) {
        var members = [];
        var named = iriOf(prefixes, text);
        if (named) {
            members.push({kind: "class", iri: named});
            return members;
        }
        var expr = parseCall(text);
        if (!expr) {
            return members;
        }
        if (expr.name === "ObjectIntersectionOf" || expr.name === "DataIntersectionOf") {
            splitTop(expr.inner).forEach(function (part) {
                members = members.concat(parseClassExpressionMembers(prefixes, part));
            });
            return members;
        }
        if (expr.name === "ObjectUnionOf" || expr.name === "DataUnionOf") {
            var unionParts = splitTop(expr.inner);
            if (unionParts.length === 1) {
                return parseClassExpressionMembers(prefixes, unionParts[0]);
            }
            unionParts.forEach(function (part) {
                members = members.concat(parseClassExpressionMembers(prefixes, part));
            });
            return members;
        }
        var restriction = parseRestrictionMember(prefixes, expr);
        if (restriction) {
            members.push(restriction);
        }
        return members;
    }

    function applyEquivalentClasses(model, prefixes, args) {
        var sides = args.map(function (arg) {
            return {
                iri: iriOf(prefixes, arg),
                members: parseClassExpressionMembers(prefixes, arg)
            };
        });
        var namedSide = sides.filter(function (side) {
            return side.iri && side.members.length === 1 && side.members[0].kind === "class" && side.members[0].iri === side.iri;
        })[0];
        var expressionSide = sides.filter(function (side) {
            return side !== namedSide;
        })[0];
        if (!namedSide && sides[0] && sides[0].iri) {
            namedSide = sides[0];
            expressionSide = sides[1];
        }
        if (!namedSide || !namedSide.iri) {
            return;
        }
        ensureClass(model, namedSide.iri);
        var members = (expressionSide && expressionSide.members) || [];
        members.forEach(function (member) {
            if (member.kind === "class") {
                ensureClass(model, member.iri);
            }
        });
        model.equivalents[namedSide.iri] = {members: members};
    }

    function addDisjointPeer(model, left, right) {
        if (!left || !right || left === right) {
            return;
        }
        ensureClass(model, left);
        ensureClass(model, right);
        model.disjointWith = model.disjointWith || {};
        var leftPeers = model.disjointWith[left] || [];
        var rightPeers = model.disjointWith[right] || [];
        if (leftPeers.indexOf(right) < 0) {
            leftPeers.push(right);
        }
        if (rightPeers.indexOf(left) < 0) {
            rightPeers.push(left);
        }
        model.disjointWith[left] = leftPeers;
        model.disjointWith[right] = rightPeers;
    }

    function applyDisjointClasses(model, prefixes, args) {
        var classIris = args.map(function (arg) {
            return iriOf(prefixes, arg);
        }).filter(Boolean);
        for (var i = 0; i < classIris.length; i++) {
            for (var j = i + 1; j < classIris.length; j++) {
                addDisjointPeer(model, classIris[i], classIris[j]);
            }
        }
    }

    function disjointPeersOf(model, classIri) {
        var peers = ((model.disjointWith || {})[classIri] || []).slice();
        return peers.filter(function (peerIri, index) {
            return peers.indexOf(peerIri) === index;
        }).sort(function (a, b) {
            return labelOf(model.classes[a] || {iri: a, labels: []}).localeCompare(
                labelOf(model.classes[b] || {iri: b, labels: []}),
                "zh"
            );
        });
    }

    function extractIriTokens(text) {
        var iris = [];
        var re = /<([^>]+)>/g;
        var match;
        while ((match = re.exec(text || ""))) {
            if (iris.indexOf(match[1]) < 0) {
                iris.push(match[1]);
            }
        }
        return iris;
    }

    function disjointClassesAxiom(classIris) {
        var unique = (classIris || []).filter(function (classIri, index, list) {
            return !!classIri && list.indexOf(classIri) === index;
        });
        if (unique.length < 2) {
            return null;
        }
        return "DisjointClasses(" + unique.map(iri).join(" ") + ")";
    }

    function findDisjointAxioms(axiomList, classIri) {
        var token = "<" + classIri + ">";
        return (axiomList || []).filter(function (axiom) {
            return axiom.indexOf("DisjointClasses(") === 0 && axiom.indexOf(token) >= 0;
        });
    }

    function rewriteDisjointRemovingLink(axiomList, classIri, peerIri) {
        var toDelete = [];
        var toAdd = [];
        var seen = {};
        (axiomList || []).forEach(function (axiom) {
            if (axiom.indexOf("DisjointClasses(") !== 0) {
                return;
            }
            var classes = extractIriTokens(axiom);
            if (classes.indexOf(classIri) < 0 || classes.indexOf(peerIri) < 0) {
                return;
            }
            toDelete.push(axiom);
            var withoutPeer = classes.filter(function (item) { return item !== peerIri; });
            var withoutClass = classes.filter(function (item) { return item !== classIri; });
            [withoutPeer, withoutClass].forEach(function (group) {
                var next = disjointClassesAxiom(group);
                if (next && !seen[next]) {
                    seen[next] = true;
                    toAdd.push(next);
                }
            });
        });
        return {toDelete: toDelete, toAdd: toAdd};
    }

    function rewriteDisjointClearingClass(axiomList, classIri) {
        var toDelete = [];
        var toAdd = [];
        var seen = {};
        findDisjointAxioms(axiomList, classIri).forEach(function (axiom) {
            toDelete.push(axiom);
            var remaining = extractIriTokens(axiom).filter(function (item) {
                return item !== classIri;
            });
            var next = disjointClassesAxiom(remaining);
            if (next && !seen[next]) {
                seen[next] = true;
                toAdd.push(next);
            }
        });
        return {toDelete: toDelete, toAdd: toAdd};
    }

    function applyDisjointUnion(model, prefixes, args) {
        var coverIri = iriOf(prefixes, args[0]);
        if (!coverIri) {
            return;
        }
        var members = args.slice(1).map(function (arg) {
            return iriOf(prefixes, arg);
        }).filter(function (memberIri) {
            return memberIri && memberIri !== coverIri;
        }).filter(function (memberIri, index, list) {
            return list.indexOf(memberIri) === index;
        });
        if (members.length < 2) {
            return;
        }
        ensureClass(model, coverIri);
        members.forEach(function (memberIri) {
            ensureClass(model, memberIri);
        });
        model.disjointUnions = model.disjointUnions || {};
        var groups = model.disjointUnions[coverIri] || [];
        groups.push(members);
        model.disjointUnions[coverIri] = groups;
    }

    function disjointUnionsOf(model, coverIri) {
        return ((model.disjointUnions || {})[coverIri] || []).map(function (members) {
            return members.slice();
        });
    }

    function disjointUnionMembersOf(model, coverIri) {
        var seen = {};
        var members = [];
        disjointUnionsOf(model, coverIri).forEach(function (group) {
            group.forEach(function (memberIri) {
                if (!seen[memberIri]) {
                    seen[memberIri] = true;
                    members.push(memberIri);
                }
            });
        });
        return members.sort(function (a, b) {
            return labelOf(model.classes[a] || {iri: a, labels: []}).localeCompare(
                labelOf(model.classes[b] || {iri: b, labels: []}),
                "zh"
            );
        });
    }

    function disjointUnionAxiom(coverIri, memberIris) {
        var members = (memberIris || []).filter(function (memberIri, index, list) {
            return !!memberIri && memberIri !== coverIri && list.indexOf(memberIri) === index;
        });
        if (!coverIri || members.length < 2) {
            return null;
        }
        return "DisjointUnion(" + iri(coverIri) + " " + members.map(iri).join(" ") + ")";
    }

    function findDisjointUnionAxiomsForCover(axiomList, coverIri) {
        return (axiomList || []).filter(function (axiom) {
            if (axiom.indexOf("DisjointUnion(") !== 0) {
                return false;
            }
            var iris = extractIriTokens(axiom);
            return iris[0] === coverIri;
        });
    }

    function namedParentsOf(model, classIri) {
        return model.subclassOf.filter(function (edge) {
            return edge.child === classIri;
        }).map(function (edge) {
            return edge.parent;
        }).filter(function (parentIri, index, list) {
            return list.indexOf(parentIri) === index;
        });
    }

    function definitionOf(model, classIri) {
        return (model.equivalents && model.equivalents[classIri]) || {members: []};
    }

    function findEquivalentAxioms(axiomList, classIri) {
        var token = "<" + classIri + ">";
        return (axiomList || []).filter(function (axiom) {
            return axiom.indexOf("EquivalentClasses(") === 0 && axiom.indexOf(token) >= 0;
        });
    }

    function restrictionExpression(propertyIri, rangeIri, isData, constraint) {
        var c = normalizeConstraint(constraint);
        var prefix = isData ? "Data" : "Object";
        var prop = iri(propertyIri);
        var filler = iri(rangeIri);
        if (c.mode === "value") {
            if (isData) {
                return "DataHasValue(" + prop + " " + literal(c.valueText != null ? c.valueText : "", rangeIri || (XSD + "string")) + ")";
            }
            return "ObjectHasValue(" + prop + " " + (c.valueText ? iri(c.valueText) : filler) + ")";
        }
        if (c.mode === "only") {
            return prefix + "AllValuesFrom(" + prop + " " + filler + ")";
        }
        if (c.mode === "exact") {
            return prefix + "ExactCardinality(" + c.n + " " + prop + " " + filler + ")";
        }
        if (c.mode === "min") {
            return prefix + "MinCardinality(" + c.n + " " + prop + " " + filler + ")";
        }
        if (c.mode === "max") {
            return prefix + "MaxCardinality(" + c.n + " " + prop + " " + filler + ")";
        }
        // enum / range / some：OWL 层用 SomeValuesFrom，细节在注解中
        return prefix + "SomeValuesFrom(" + prop + " " + filler + ")";
    }

    function equivalentClassesAxiom(classIri, members) {
        var parts = (members || []).map(function (member) {
            if (member.kind === "class") {
                return iri(member.iri);
            }
            return restrictionExpression(
                member.propertyIri,
                member.filler,
                member.isData,
                {mode: member.mode, n: member.n, valueText: member.valueText}
            );
        }).filter(Boolean);
        if (!parts.length) {
            return null;
        }
        var rhs = parts.length === 1 ? parts[0] : "ObjectIntersectionOf(" + parts.join(" ") + ")";
        return "EquivalentClasses(" + iri(classIri) + " " + rhs + ")";
    }

    function normalizeConstraint(constraint) {
        var mode = (constraint && constraint.mode) || "some";
        if (["value", "some", "only", "exact", "min", "max", "enum", "range", "none"].indexOf(mode) < 0) {
            mode = "some";
        }
        var n = constraint && constraint.n != null ? parseInt(constraint.n, 10) : 1;
        if ((mode === "exact" || mode === "min" || mode === "max") && !(n >= 0)) {
            n = 1;
        }
        return {
            mode: mode,
            n: n,
            valueText: constraint && constraint.valueText != null ? String(constraint.valueText) : "",
            enumValues: constraint && constraint.enumValues != null ? String(constraint.enumValues) : "",
            minValue: constraint && constraint.minValue != null ? String(constraint.minValue) : "",
            maxValue: constraint && constraint.maxValue != null ? String(constraint.maxValue) : ""
        };
    }

    function constraintLabel(constraint) {
        var c = normalizeConstraint(constraint);
        if (c.mode === "none") {
            return "未约束";
        }
        if (c.mode === "value") {
            return "固定值" + (c.valueText ? (" = " + c.valueText) : "");
        }
        if (c.mode === "enum") {
            return "枚举" + (c.enumValues ? (" ∈ {" + c.enumValues + "}") : "");
        }
        if (c.mode === "range") {
            var lo = c.minValue || "−∞";
            var hi = c.maxValue || "+∞";
            return "区间 [" + lo + ", " + hi + "]";
        }
        if (c.mode === "only") {
            return "只能是该类型";
        }
        if (c.mode === "exact") {
            return "恰好 " + c.n + " 个";
        }
        if (c.mode === "min") {
            return "至少 " + c.n + " 个";
        }
        if (c.mode === "max") {
            return "至多 " + c.n + " 个";
        }
        return "至少有一个";
    }

    function findRestrictionOnClass(property, classIri, defaultMode) {
        var list = ((property && property.restrictions) || []).filter(function (item) {
            return item.classIri === classIri;
        });
        if (!list.length) {
            return {
                mode: defaultMode || "some",
                n: 1,
                valueText: "",
                enumValues: "",
                minValue: "",
                maxValue: "",
                filler: "",
                uiFacet: "",
                functionCode: "",
                stateGraph: null
            };
        }
        return {
            mode: list[0].mode || "some",
            n: list[0].n != null ? list[0].n : 1,
            valueText: list[0].valueText || "",
            enumValues: list[0].enumValues || "",
            minValue: list[0].minValue || "",
            maxValue: list[0].maxValue || "",
            filler: list[0].filler || "",
            uiFacet: list[0].uiFacet || "",
            functionCode: list[0].functionCode || "",
            stateGraph: list[0].stateGraph || null
        };
    }

    function restrictionKeywords(isData) {
        var prefix = isData ? "Data" : "Object";
        return [
            prefix + "SomeValuesFrom(",
            prefix + "AllValuesFrom(",
            prefix + "ExactCardinality(",
            prefix + "MinCardinality(",
            prefix + "MaxCardinality(",
            prefix + "HasValue("
        ];
    }

    function blankIndividual(iri) {
        return {iri: iri, labels: []};
    }

    function ensureClass(model, iri) {
        if (!model.classes[iri]) {
            model.classes[iri] = {iri: iri, labels: [], comments: []};
            if (!model.classOrder) {
                model.classOrder = [];
            }
            model.classOrder.push(iri);
        }
    }

    /**
     * Sibling order for the class hierarchy — match Protégé Desktop:
     * case-insensitive lexicographic order on browser text (Unicode code points).
     * Avoid localeCompare('zh'): Chinese collation (pinyin) puts 非实体类 before 实体类,
     * while Protégé / Java String.compareToIgnoreCase keeps 实体类 first.
     */
    function compareClassByBrowserText(model, leftIri, rightIri) {
        var leftLabel = labelOf(model.classes[leftIri], model) || localName(leftIri) || leftIri || "";
        var rightLabel = labelOf(model.classes[rightIri], model) || localName(rightIri) || rightIri || "";
        var left = String(leftLabel).toLowerCase();
        var right = String(rightLabel).toLowerCase();
        if (left < right) {
            return -1;
        }
        if (left > right) {
            return 1;
        }
        if (leftIri < rightIri) {
            return -1;
        }
        if (leftIri > rightIri) {
            return 1;
        }
        return 0;
    }

    function ensureThing(model) {
        ensureClass(model, OWL_THING);
        // Keep IRI as owl:Thing; show a product-friendly root name in the tree/UI.
        model.classes[OWL_THING].labels = [{value: "要素", lang: "zh"}];
    }

    function extractCall(text, name) {
        var start = text.indexOf(name + "(");
        if (start < 0) {
            return "";
        }
        var open = start + name.length;
        var end = matchingParen(text, open);
        if (end < 0) {
            return "";
        }
        return text.slice(open + 1, end);
    }

    function parseCall(text) {
        if (!text) {
            return null;
        }
        var trimmed = text.trim();
        var open = trimmed.indexOf("(");
        if (open <= 0 || !/^[_A-Za-z][_A-Za-z0-9]*\(/.test(trimmed)) {
            return null;
        }
        var end = matchingParen(trimmed, open);
        if (end !== trimmed.length - 1) {
            return null;
        }
        return {name: trimmed.slice(0, open), inner: trimmed.slice(open + 1, end)};
    }

    function matchingParen(text, openIndex) {
        var depth = 0;
        var quote = false;
        var escaped = false;
        for (var i = openIndex; i < text.length; i++) {
            var ch = text.charAt(i);
            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (ch === "\\") {
                    escaped = true;
                } else if (ch === "\"") {
                    quote = false;
                }
                continue;
            }
            if (ch === "\"") {
                quote = true;
            } else if (ch === "(") {
                depth++;
            } else if (ch === ")") {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    function splitTop(text) {
        var args = [];
        var buf = "";
        var depth = 0;
        var quote = false;
        var escaped = false;
        var angle = false;
        function push() {
            if (buf.trim()) {
                args.push(buf.trim());
            }
            buf = "";
        }
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (quote) {
                buf += ch;
                if (escaped) {
                    escaped = false;
                } else if (ch === "\\") {
                    escaped = true;
                } else if (ch === "\"") {
                    quote = false;
                }
                continue;
            }
            if (ch === "\"") {
                quote = true;
                buf += ch;
                continue;
            }
            if (ch === "<") {
                angle = true;
                buf += ch;
                continue;
            }
            if (ch === ">" && angle) {
                angle = false;
                buf += ch;
                continue;
            }
            if (!angle && ch === "(") {
                depth++;
                buf += ch;
                continue;
            }
            if (!angle && ch === ")") {
                depth--;
                buf += ch;
                continue;
            }
            if (!angle && depth === 0 && /\s/.test(ch)) {
                push();
                continue;
            }
            buf += ch;
        }
        push();
        return args;
    }

    function iriOf(prefixes, token) {
        if (!token) {
            return "";
        }
        var trimmed = token.trim();
        if (trimmed.indexOf("(") >= 0) {
            return "";
        }
        return expand(prefixes, trimmed);
    }

    function expand(prefixes, token) {
        var trimmed = token.trim();
        if (trimmed.charAt(0) === "<" && trimmed.charAt(trimmed.length - 1) === ">") {
            return trimmed.slice(1, -1);
        }
        var idx = trimmed.indexOf(":");
        if (idx >= 0 && Object.prototype.hasOwnProperty.call(prefixes, trimmed.slice(0, idx))) {
            return prefixes[trimmed.slice(0, idx)] + trimmed.slice(idx + 1);
        }
        return trimmed;
    }

    function parseLiteral(prefixes, token) {
        var trimmed = token.trim();
        if (trimmed.charAt(0) !== "\"") {
            return null;
        }
        var value = "";
        var i = 1;
        while (i < trimmed.length) {
            var ch = trimmed.charAt(i);
            if (ch === "\\") {
                value += trimmed.charAt(i + 1) || "";
                i += 2;
                continue;
            }
            if (ch === "\"") {
                break;
            }
            value += ch;
            i++;
        }
        var rest = trimmed.slice(i + 1);
        var lang = "";
        var datatype = XSD + "string";
        if (rest.indexOf("@") === 0) {
            lang = rest.slice(1);
        } else if (rest.indexOf("^^") === 0) {
            datatype = expand(prefixes, rest.slice(2));
        }
        return {value: value, lang: lang, datatype: datatype};
    }

    function labelOf(entity, model) {
        if (!entity) {
            return "";
        }
        function hasLatin(text) {
            return /[A-Za-z]/.test(String(text || ""));
        }
        function pickFrom(labels) {
            if (!labels || !labels.length) {
                return null;
            }
            var zhPure = labels.filter(function (literal) {
                return literal.lang === "zh" && !hasLatin(literal.value);
            })[0];
            var plainPure = labels.filter(function (literal) {
                return !literal.lang && !hasLatin(literal.value);
            })[0];
            var zh = labels.filter(function (literal) {
                return literal.lang === "zh";
            })[0];
            var plain = labels.filter(function (literal) {
                return !literal.lang;
            })[0];
            var pick = zhPure || plainPure || zh || plain || labels[0];
            return pick && pick.value ? pick.value : null;
        }
        var own = pickFrom(entity.labels);
        if (own) {
            return own;
        }
        // Dual-typed IRIs (Class + DataProperty): reuse the class label when the
        // property side has no annotation of its own.
        if (model && entity.iri) {
            var alt = (model.classes && model.classes[entity.iri])
                || (model.dataProperties && model.dataProperties[entity.iri])
                || (model.objectProperties && model.objectProperties[entity.iri]);
            if (alt && alt !== entity) {
                var shared = pickFrom(alt.labels);
                if (shared) {
                    return shared;
                }
            }
        }
        return localName(entity.iri);
    }

    function localName(iri) {
        if (!iri) {
            return "";
        }
        var slash = iri.lastIndexOf("/");
        var hash = iri.lastIndexOf("#");
        return iri.slice(Math.max(slash, hash) + 1);
    }

    /** Case-insensitive multi-token substring match (space-separated AND). */
    function fuzzyTextMatch(haystack, query) {
        var q = String(query || "").trim().toLowerCase();
        if (!q) {
            return true;
        }
        var text = String(haystack || "").toLowerCase();
        var tokens = q.split(/\s+/).filter(Boolean);
        for (var i = 0; i < tokens.length; i++) {
            if (text.indexOf(tokens[i]) < 0) {
                return false;
            }
        }
        return true;
    }

    function propertySearchText(model, property, isData) {
        if (!property) {
            return "";
        }
        var name = labelOf(property, model);
        var local = localName(property.iri);
        var rangeIri = property.ranges && property.ranges[0]
            ? property.ranges[0]
            : (isData ? (XSD + "string") : OWL_THING);
        var rangeLabel;
        if (isData) {
            var foundType = DATATYPES.filter(function (type) { return type.iri === rangeIri; })[0];
            rangeLabel = foundType ? foundType.label : localName(rangeIri);
        } else {
            rangeLabel = labelOf((model.classes && model.classes[rangeIri]) || {iri: rangeIri, labels: []}, model);
        }
        var domains = propertyDomainSummary(model, property);
        return [name, local, rangeLabel, domains].join(" ");
    }

    function childrenOf(model, parentIri) {
        var seen = {};
        var children = model.subclassOf.filter(function (edge) {
            return edge.parent === parentIri;
        }).map(function (edge) {
            return edge.child;
        });
        if (parentIri === "http://www.w3.org/2002/07/owl#Thing") {
            var linked = {};
            model.subclassOf.forEach(function (edge) {
                linked[edge.child] = true;
            });
            Object.keys(model.classes).forEach(function (iri) {
                if (iri !== parentIri && !linked[iri]) {
                    children.push(iri);
                }
            });
        }
        return children.filter(function (iri) {
            if (seen[iri] || iri === parentIri) {
                return false;
            }
            seen[iri] = true;
            return true;
        }).sort(function (left, right) {
            return compareClassByBrowserText(model, left, right);
        });
    }

    function classLineage(model, classIri) {
        var lineage = [];
        var seen = {};
        var queue = [classIri];
        while (queue.length) {
            var current = queue.shift();
            if (!current || seen[current]) {
                continue;
            }
            seen[current] = true;
            lineage.push(current);
            model.subclassOf.forEach(function (edge) {
                if (edge.child === current) {
                    queue.push(edge.parent);
                }
            });
            var definition = definitionOf(model, current);
            (definition.members || []).forEach(function (member) {
                if (member.kind === "class" && member.iri) {
                    queue.push(member.iri);
                }
            });
        }
        return lineage;
    }

    function fieldSourceIri(model, property, focusClassIri) {
        var lineage = classLineage(model, focusClassIri);
        var domainHit = (property.domains || []).filter(function (domain) {
            return lineage.indexOf(domain) >= 0 && domain !== OWL_THING;
        })[0];
        if (domainHit) {
            return domainHit;
        }
        var restrictionHit = ((property.restrictions || []).filter(function (restriction) {
            return lineage.indexOf(restriction.classIri) >= 0;
        })[0] || {}).classIri;
        if (restrictionHit) {
            return restrictionHit;
        }
        return focusClassIri;
    }

    function fieldsOf(model, classIri) {
        var classes = classLineage(model, classIri);
        function matches(property) {
            if ((property.domains || []).some(function (domain) {
                return classes.indexOf(domain) >= 0;
            })) {
                return true;
            }
            return (property.restrictions || []).some(function (restriction) {
                return classes.indexOf(restriction.classIri) >= 0;
            });
        }
        function byLabel(a, b) {
            var sourceCompare = labelOf(model.classes[fieldSourceIri(model, a, classIri)] || {iri: "", labels: []})
                .localeCompare(labelOf(model.classes[fieldSourceIri(model, b, classIri)] || {iri: "", labels: []}), "zh");
            if (sourceCompare !== 0) {
                return sourceCompare;
            }
            return labelOf(a).localeCompare(labelOf(b), "zh");
        }
        return {
            data: Object.keys(model.dataProperties).map(function (iri) {
                return model.dataProperties[iri];
            }).filter(matches).sort(byLabel),
            object: Object.keys(model.objectProperties).map(function (iri) {
                return model.objectProperties[iri];
            }).filter(matches).sort(byLabel)
        };
    }

    function untypedIndividuals(model) {
        var seen = {};
        return Object.keys(model.individuals).filter(function (individualIri) {
            if (seen[individualIri]) {
                return false;
            }
            seen[individualIri] = true;
            return !model.classAssertions.some(function (assertion) {
                return assertion.individual === individualIri;
            });
        });
    }

    function orphanClasses(model) {
        var linked = {};
        model.subclassOf.forEach(function (edge) {
            linked[edge.child] = true;
        });
        return Object.keys(model.classes).filter(function (classIri) {
            return classIri !== OWL_THING && !linked[classIri];
        });
    }

    function usagesOf(model, individualIri) {
        return model.objectAssertions.filter(function (assertion) {
            return assertion.target === individualIri;
        }).map(function (assertion) {
            var source = model.individuals[assertion.source] || {iri: assertion.source, labels: []};
            var property = model.objectProperties[assertion.property] || {iri: assertion.property, labels: []};
            return labelOf(source) + " 的「" + labelOf(property) + "」";
        });
    }

    function descendantClassesOf(model, classIri) {
        var result = [];
        var seen = {};
        var queue = [classIri];
        while (queue.length) {
            var current = queue.shift();
            model.subclassOf.forEach(function (edge) {
                if (edge.parent !== current || seen[edge.child] || edge.child === classIri) {
                    return;
                }
                seen[edge.child] = true;
                result.push(edge.child);
                queue.push(edge.child);
            });
        }
        return result;
    }

    function individualsOf(model, classIri) {
        var allowed = {};
        allowed[classIri] = true;
        if (classIri !== OWL_THING) {
            descendantClassesOf(model, classIri).forEach(function (iri) {
                allowed[iri] = true;
            });
        }
        var seen = {};
        return model.classAssertions.filter(function (assertion) {
            return !!allowed[assertion.cls];
        }).map(function (assertion) {
            return assertion.individual;
        }).filter(function (iri) {
            if (seen[iri] || !isHttpIri(iri)) {
                return false;
            }
            seen[iri] = true;
            return true;
        });
    }

    function isHttpIri(value) {
        return !!value && (value.indexOf("http://") === 0 || value.indexOf("https://") === 0);
    }

    function relationTargets(model, rangeIri) {
        if (!rangeIri || rangeIri === OWL_THING) {
            return Object.keys(model.individuals).filter(isHttpIri);
        }
        return individualsOf(model, rangeIri);
    }

    function individualTypeLabel(model, individualIri) {
        var types = model.classAssertions.filter(function (assertion) {
            return assertion.individual === individualIri;
        });
        if (!types.length) {
            return "未指定类型";
        }
        return types.map(function (assertion) {
            return labelOf(model.classes[assertion.cls] || {iri: assertion.cls, labels: []});
        }).join("、");
    }

    function primaryClassOfIndividual(model, individualIri, preferredClassIri) {
        var types = (model.classAssertions || []).filter(function (assertion) {
            return assertion.individual === individualIri;
        }).map(function (assertion) {
            return assertion.cls;
        });
        if (preferredClassIri && preferredClassIri !== OWL_THING && types.indexOf(preferredClassIri) >= 0) {
            return preferredClassIri;
        }
        var nonThing = types.filter(function (cls) {
            return cls && cls !== OWL_THING;
        });
        if (nonThing.length) {
            return nonThing[0];
        }
        if (preferredClassIri && preferredClassIri !== OWL_THING) {
            return preferredClassIri;
        }
        return OWL_THING;
    }

    function mintIri() {
        var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        var bytes = new Uint8Array(16);
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
            crypto.getRandomValues(bytes);
        } else {
            for (var i = 0; i < bytes.length; i++) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }
        var local = "R";
        for (var j = 0; j < bytes.length; j++) {
            local += alphabet.charAt(bytes[j] % alphabet.length);
        }
        return "http://webprotege.stanford.edu/" + local;
    }

    function iri(value) {
        return "<" + value + ">";
    }

    function literal(value, datatype) {
        var escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        return "\"" + escaped + "\"^^" + iri(datatype || (XSD + "string"));
    }

    function datatypeKind(datatype) {
        var type = datatype || (XSD + "string");
        if (type === XSD + "boolean") {
            return "boolean";
        }
        if (type === XSD + "integer" || type === XSD + "int" || type === XSD + "long"
                || type === XSD + "short" || type === XSD + "byte"
                || type === XSD + "nonNegativeInteger" || type === XSD + "positiveInteger"
                || type === XSD + "nonPositiveInteger" || type === XSD + "negativeInteger"
                || type === XSD + "unsignedLong" || type === XSD + "unsignedInt"
                || type === XSD + "unsignedShort" || type === XSD + "unsignedByte") {
            return "integer";
        }
        if (type === XSD + "decimal" || type === XSD + "float" || type === XSD + "double") {
            return "decimal";
        }
        if (type === XSD + "date") {
            return "date";
        }
        if (type === XSD + "dateTime" || type === XSD + "dateTimeStamp") {
            return "datetime";
        }
        if (type === XSD + "time") {
            return "time";
        }
        return "string";
    }

    function normalizeDataFieldValue(text, datatype) {
        var raw = String(text == null ? "" : text).trim();
        if (!raw) {
            return {ok: true, text: ""};
        }
        var kind = datatypeKind(datatype);
        if (kind === "boolean") {
            var lower = raw.toLowerCase();
            if (lower === "true" || lower === "1") {
                return {ok: true, text: "true"};
            }
            if (lower === "false" || lower === "0") {
                return {ok: true, text: "false"};
            }
            return {ok: false, text: raw, message: "布尔值请选择「是」或「否」"};
        }
        if (kind === "integer") {
            if (!/^-?\d+$/.test(raw)) {
                return {ok: false, text: raw, message: "请输入整数"};
            }
            return {ok: true, text: String(parseInt(raw, 10))};
        }
        if (kind === "decimal") {
            if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
                return {ok: false, text: raw, message: "请输入有效小数"};
            }
            return {ok: true, text: raw};
        }
        if (kind === "date") {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                return {ok: false, text: raw, message: "请选择有效日期"};
            }
            return {ok: true, text: raw};
        }
        if (kind === "datetime") {
            var normalized = raw.indexOf(" ") >= 0 ? raw.replace(" ", "T") : raw;
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(normalized)) {
                return {ok: false, text: raw, message: "请选择有效日期时间"};
            }
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
                normalized += ":00";
            }
            return {ok: true, text: normalized};
        }
        if (kind === "time") {
            if (!/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) {
                return {ok: false, text: raw, message: "请选择有效时间"};
            }
            return {ok: true, text: raw.length === 5 ? raw + ":00" : raw};
        }
        return {ok: true, text: raw};
    }

    function dataFieldInputValueForControl(value, datatype) {
        var raw = String(value == null ? "" : value).trim();
        if (!raw) {
            return "";
        }
        var kind = datatypeKind(datatype);
        if (kind === "boolean") {
            var lower = raw.toLowerCase();
            if (lower === "true" || lower === "1") {
                return "true";
            }
            if (lower === "false" || lower === "0") {
                return "false";
            }
            return "";
        }
        if (kind === "datetime") {
            return raw.replace(" ", "T").replace(/Z$/, "").replace(/([+-]\d{2}:\d{2})$/, "");
        }
        return raw;
    }

    function dataFieldControlHtml(datatype, index, value) {
        var kind = datatypeKind(datatype);
        var rawValue = dataFieldInputValueForControl(value, datatype);
        var common = " class='cell-input' data-kind='data' data-index='" + index + "' data-datatype-kind='" + kind + "'";
        if (kind === "boolean") {
            return "<select" + common + ">" +
                "<option value=''" + (rawValue ? "" : " selected") + ">不填</option>" +
                "<option value='true'" + (rawValue === "true" ? " selected" : "") + ">是（true）</option>" +
                "<option value='false'" + (rawValue === "false" ? " selected" : "") + ">否（false）</option>" +
                "</select>";
        }
        if (kind === "integer") {
            return "<input type='number' step='1' inputmode='numeric'" + common +
                " value='" + escapeHtml(rawValue) + "' placeholder='整数，如 3'>";
        }
        if (kind === "decimal") {
            return "<input type='number' step='any' inputmode='decimal'" + common +
                " value='" + escapeHtml(rawValue) + "' placeholder='小数，如 3.14'>";
        }
        if (kind === "date") {
            return "<input type='date'" + common + " value='" + escapeHtml(rawValue) + "'>";
        }
        if (kind === "datetime") {
            var localValue = rawValue.length >= 16 ? rawValue.slice(0, 16) : rawValue;
            return "<input type='datetime-local'" + common + " value='" + escapeHtml(localValue) + "'>";
        }
        if (kind === "time") {
            var timeValue = rawValue.length >= 5 ? rawValue.slice(0, 5) : rawValue;
            return "<input type='time'" + common + " value='" + escapeHtml(timeValue) + "'>";
        }
        return "<input type='text'" + common + " value='" + escapeHtml(rawValue) + "' placeholder='输入文本'>";
    }

    function labelAxioms(subject, text) {
        var escaped = String(text).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        var prefix = "AnnotationAssertion(<http://www.w3.org/2000/01/rdf-schema#label> " + iri(subject) + " \"" + escaped + "\"";
        // Plain label (no language tag) is what WebProtégé uses as the primary display name
        // by default; keep @zh as well for Chinese display-language settings.
        return [
            prefix + ")",
            prefix + "@zh)"
        ];
    }

    function labelAxiom(subject, text) {
        return labelAxioms(subject, text)[0];
    }

    function annotationLiteralAxiom(annPropIri, subject, text) {
        var escaped = String(text == null ? "" : text).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        return "AnnotationAssertion(" + iri(annPropIri) + " " + iri(subject) + " \"" + escaped + "\")";
    }

    function commentAxioms(subject, text) {
        if (!String(text || "").trim()) {
            return [];
        }
        return [annotationLiteralAxiom("http://www.w3.org/2000/01/rdf-schema#comment", subject, String(text).trim())];
    }

    function commentOf(entity) {
        var comments = (entity && entity.comments) || [];
        for (var i = 0; i < comments.length; i++) {
            if (comments[i] && comments[i].value) {
                return comments[i].value;
            }
        }
        return "";
    }

    /** Unit stays on the property; facet is written on the class SubClassOf restriction. */
    function unitAxioms(propertyIri, unit) {
        var out = [];
        if (String(unit || "").trim()) {
            out.push("Declaration(AnnotationProperty(" + iri(UI_UNIT) + "))");
            out.push(annotationLiteralAxiom(UI_UNIT, propertyIri, String(unit).trim()));
        }
        return out;
    }

    function uiFacetAnnotationPrefix(facet) {
        var normalized = normalizeFacet(facet);
        if (!normalized) {
            return "";
        }
        var escaped = String(facetLabel(normalized)).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        return "Annotation(" + iri(UI_FACET) + " \"" + escaped + "\")";
    }

    function functionCodeAnnotationPrefix(functionCode) {
        if (!String(functionCode || "").trim()) {
            return "";
        }
        return "Annotation(" + iri(UI_FUNCTION_CODE) + " \"" + escapeOwlLiteral(String(functionCode).trim()) + "\")";
    }

    function stateGraphAnnotationPrefix(stateGraphRaw) {
        if (!String(stateGraphRaw || "").trim()) {
            return "";
        }
        return "Annotation(" + iri(UI_STATE_GRAPH) + " \"" + escapeOwlLiteral(String(stateGraphRaw).trim()) + "\")";
    }

    function constraintExtraAnnotationPrefix(constraint) {
        var c = normalizeConstraint(constraint);
        var parts = [];
        if (c.mode === "enum" && String(c.enumValues || "").trim()) {
            parts.push("Annotation(" + iri(UI_ENUM_VALUES) + " \"" +
                escapeOwlLiteral(String(c.enumValues).trim()) + "\")");
        }
        if (c.mode === "range") {
            if (String(c.minValue || "").trim() !== "") {
                parts.push("Annotation(" + iri(UI_MIN_VALUE) + " \"" +
                    escapeOwlLiteral(String(c.minValue).trim()) + "\")");
            }
            if (String(c.maxValue || "").trim() !== "") {
                parts.push("Annotation(" + iri(UI_MAX_VALUE) + " \"" +
                    escapeOwlLiteral(String(c.maxValue).trim()) + "\")");
            }
        }
        return parts;
    }

    function restrictionAnnotationPrefix(facet, functionCode, stateGraphRaw, constraint) {
        var parts = [];
        var facetAnn = uiFacetAnnotationPrefix(facet);
        var codeAnn = functionCodeAnnotationPrefix(functionCode);
        var graphAnn = stateGraphAnnotationPrefix(stateGraphRaw);
        if (facetAnn) {
            parts.push(facetAnn);
        }
        if (codeAnn) {
            parts.push(codeAnn);
        }
        if (graphAnn) {
            parts.push(graphAnn);
        }
        parts = parts.concat(constraintExtraAnnotationPrefix(constraint));
        return parts.length ? parts.join(" ") + " " : "";
    }

    function uiFacetDeclarationAxioms(facet) {
        if (!normalizeFacet(facet)) {
            return [];
        }
        return ["Declaration(AnnotationProperty(" + iri(UI_FACET) + "))"];
    }

    function functionCodeDeclarationAxioms(functionCode) {
        if (!String(functionCode || "").trim()) {
            return [];
        }
        return ["Declaration(AnnotationProperty(" + iri(UI_FUNCTION_CODE) + "))"];
    }

    function stateGraphDeclarationAxioms(stateGraphRaw) {
        if (!String(stateGraphRaw || "").trim()) {
            return [];
        }
        return ["Declaration(AnnotationProperty(" + iri(UI_STATE_GRAPH) + "))"];
    }

    function findAnnotationAxioms(axiomList, subjectIri, annHint) {
        var token = "<" + subjectIri + ">";
        return (axiomList || []).filter(function (axiom) {
            return axiom.indexOf("AnnotationAssertion(") === 0
                && axiom.indexOf(token) >= 0
                && axiom.indexOf(annHint) >= 0;
        });
    }

    function missingPlainLabelAxioms(model, axiomList) {
        var missing = [];
        var seen = {};

        function consider(entity) {
            if (!entity || !entity.iri || !entity.labels || !entity.labels.length) {
                return;
            }
            // Built-in OWL vocabulary (e.g. owl:Thing) is not created by modeling UI.
            if (entity.iri.indexOf("http://www.w3.org/2002/07/owl#") === 0) {
                return;
            }
            var hasPlain = entity.labels.some(function (literal) {
                return !literal.lang;
            });
            if (hasPlain) {
                return;
            }
            var preferred = entity.labels.filter(function (literal) {
                return literal.lang === "zh";
            })[0] || entity.labels[0];
            if (!preferred || !preferred.value) {
                return;
            }
            var axiom = labelAxiom(entity.iri, preferred.value);
            if (seen[axiom]) {
                return;
            }
            var already = (axiomList || []).some(function (existing) {
                return existing === axiom;
            });
            if (!already) {
                seen[axiom] = true;
                missing.push(axiom);
            }
        }

        Object.keys(model.classes || {}).forEach(function (iriValue) {
            consider(model.classes[iriValue]);
        });
        Object.keys(model.dataProperties || {}).forEach(function (iriValue) {
            consider(model.dataProperties[iriValue]);
        });
        Object.keys(model.objectProperties || {}).forEach(function (iriValue) {
            consider(model.objectProperties[iriValue]);
        });
        Object.keys(model.individuals || {}).forEach(function (iriValue) {
            consider(model.individuals[iriValue]);
        });
        return missing;
    }

    function renderOntology(axioms) {
        return [
            "Prefix(owl:=<http://www.w3.org/2002/07/owl#>)",
            "Prefix(rdf:=<http://www.w3.org/1999/02/22-rdf-syntax-ns#>)",
            "Prefix(xsd:=<" + XSD + ">)",
            "Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)",
            "Ontology(<http://webprotege.stanford.edu/modeling/temp>",
            axioms.join("\n"),
            ")"
        ].join("\n");
    }

    function axiomsForClass(parentIri, name, role) {
        var classIri = mintIri();
        var nextRole = role === ROLE_MODEL ? ROLE_MODEL : ROLE_METAMODEL;
        return {
            iri: classIri,
            axioms: [
                "Declaration(Class(" + iri(classIri) + "))"
            ].concat(
                labelAxioms(classIri, name),
                uiRoleAxioms(classIri, nextRole),
                [
                    "SubClassOf(" + iri(classIri) + " " + iri(parentIri || OWL_THING) + ")"
                ]
            )
        };
    }

    function axiomsForModelClass(metamodelIri, name) {
        return axiomsForClass(metamodelIri, name, ROLE_MODEL);
    }

    function axiomsForDataField(classIri, name, datatype, constraint, facet, unit, functionCode) {
        var propertyIri = mintIri();
        var nextFacet = facet || "technicalParam";
        var code = nextFacet === "function" ? (functionCode || "") : "";
        return [
            "Declaration(DataProperty(" + iri(propertyIri) + "))"
        ].concat(
            labelAxioms(propertyIri, name),
            unitAxioms(propertyIri, unit),
            uiFacetDeclarationAxioms(nextFacet),
            functionCodeDeclarationAxioms(code),
            [
                "DataPropertyDomain(" + iri(propertyIri) + " " + iri(classIri) + ")",
                "DataPropertyRange(" + iri(propertyIri) + " " + iri(datatype) + ")",
                classRestrictionAxiom(classIri, propertyIri, datatype, true, constraint, nextFacet, code)
            ]
        );
    }

    function axiomsForObjectField(classIri, name, rangeIri, constraint, facet, unit, functionCode) {
        var propertyIri = mintIri();
        var nextFacet = facet || "relation";
        var code = nextFacet === "function" ? (functionCode || "") : "";
        return [
            "Declaration(ObjectProperty(" + iri(propertyIri) + "))"
        ].concat(
            labelAxioms(propertyIri, name),
            unitAxioms(propertyIri, unit),
            uiFacetDeclarationAxioms(nextFacet),
            functionCodeDeclarationAxioms(code),
            [
                "ObjectPropertyDomain(" + iri(propertyIri) + " " + iri(classIri) + ")",
                "ObjectPropertyRange(" + iri(propertyIri) + " " + iri(rangeIri) + ")",
                classRestrictionAxiom(classIri, propertyIri, rangeIri, false, constraint, nextFacet, code)
            ]
        );
    }

    function propertyLinkedToClass(property, classIri) {
        if (!property || !classIri) {
            return false;
        }
        if ((property.domains || []).indexOf(classIri) >= 0) {
            return true;
        }
        return (property.restrictions || []).some(function (restriction) {
            return restriction.classIri === classIri;
        });
    }

    function reusableProperties(model, classIri, isData) {
        var bucket = isData ? model.dataProperties : model.objectProperties;
        var already = {};
        var currentFields = fieldsOf(model, classIri);
        (isData ? currentFields.data : currentFields.object).forEach(function (property) {
            already[property.iri] = true;
        });
        return Object.keys(bucket).map(function (propertyIri) {
            return bucket[propertyIri];
        }).filter(function (property) {
            if (!property || already[property.iri] || propertyLinkedToClass(property, classIri)) {
                return false;
            }
            if (isData) {
                return !!(property.ranges && property.ranges[0]);
            }
            return true;
        }).sort(function (left, right) {
            return labelOf(left).localeCompare(labelOf(right), "zh");
        });
    }

    function propertyDomainSummary(model, property) {
        var domains = (property.domains || []).filter(function (domain) {
            return domain && domain !== OWL_THING;
        });
        if (!domains.length) {
            return "未指定定义域";
        }
        return domains.map(function (domain) {
            return labelOf(model.classes[domain] || {iri: domain, labels: []});
        }).join("、");
    }

    function axiomsForAttachExistingField(classIri, property, isData, constraint, facet, functionCode) {
        if (!property || !property.iri || !classIri) {
            return [];
        }
        var range = isData
            ? (property.ranges && property.ranges[0]) || (XSD + "string")
            : (property.ranges && property.ranges[0]) || OWL_THING;
        var nextFacet = normalizeFacet(facet) || (isData ? "technicalParam" : "relation");
        var code = nextFacet === "function" ? (functionCode || "") : "";
        var axioms = uiFacetDeclarationAxioms(nextFacet).concat(functionCodeDeclarationAxioms(code));
        if ((property.domains || []).indexOf(classIri) < 0) {
            axioms.push(
                (isData ? "DataPropertyDomain(" : "ObjectPropertyDomain(")
                + iri(property.iri) + " " + iri(classIri) + ")"
            );
        }
        axioms.push(classRestrictionAxiom(classIri, property.iri, range, isData, constraint, nextFacet, code));
        return axioms;
    }

    function namedDomainsOf(property) {
        return (property.domains || []).filter(function (domain) {
            return domain && domain !== OWL_THING;
        });
    }

    /**
     * How a property's OWL Domain relates to the current class.
     * Domain axiom means: any individual with a value for the property is classified
     * into that domain class — which can conflict with DisjointClasses.
     */
    function propertyDomainFit(model, property, classIri) {
        var domains = namedDomainsOf(property);
        if (!domains.length) {
            return {fit: "open", domains: [], matching: [], conflicting: []};
        }
        var lineage = classLineage(model, classIri);
        var matching = domains.filter(function (domain) {
            return lineage.indexOf(domain) >= 0;
        });
        if (matching.length) {
            return {fit: "ok", domains: domains, matching: matching, conflicting: []};
        }
        var conflicting = [];
        domains.forEach(function (domain) {
            var domainLineage = classLineage(model, domain);
            lineage.forEach(function (cls) {
                var peers = disjointPeersOf(model, cls);
                domainLineage.forEach(function (domCls) {
                    if (peers.indexOf(domCls) >= 0) {
                        conflicting.push({from: cls, domain: domCls});
                    }
                });
            });
        });
        return {
            fit: conflicting.length ? "conflict" : "cross",
            domains: domains,
            matching: matching,
            conflicting: conflicting
        };
    }

    function propertyDomainFitMessage(model, property, classIri) {
        var info = propertyDomainFit(model, property, classIri);
        var domainLabels = (info.domains || []).map(function (domain) {
            return labelOf(model.classes[domain] || {iri: domain, labels: []}, model);
        });
        if (info.fit === "conflict") {
            var pairs = info.conflicting.map(function (item) {
                return "「" + labelOf(model.classes[item.from] || {iri: item.from, labels: []}, model)
                    + "」⊥「" + labelOf(model.classes[item.domain] || {iri: item.domain, labels: []}, model) + "」";
            });
            return "危险：属性定义域为 " + domainLabels.join("、")
                + "。OWL 定义域表示「有取值 ⇒ 属于该类」，会与当前类型互斥（"
                + pairs.join("；") + "），保存后推理会判定不一致。";
        }
        if (info.fit === "cross") {
            return "注意：属性定义域为 " + domainLabels.join("、")
                + "。填写后推理器会把该实例同时归入定义域类（不一定报错，但类型会变宽）。";
        }
        return "";
    }

    function propertyRoleOnClass(property, classIri) {
        if (!property || !classIri) {
            return "none";
        }
        var domains = namedDomainsOf(property);
        var hasDomainHere = domains.indexOf(classIri) >= 0;
        var restrictions = property.restrictions || [];
        var hasRestrictionHere = restrictions.some(function (restriction) {
            return restriction.classIri === classIri;
        });
        if (!hasDomainHere && !hasRestrictionHere) {
            return "inherited";
        }
        var otherDomains = domains.filter(function (domain) {
            return domain !== classIri;
        });
        var otherRestrictions = restrictions.some(function (restriction) {
            return restriction.classIri && restriction.classIri !== classIri && restriction.classIri !== OWL_THING;
        });
        if (otherDomains.length || otherRestrictions) {
            return "shared";
        }
        return "local";
    }

    function findPropertyRangeAxioms(axiomList, propertyIri, isData) {
        var token = "<" + propertyIri + ">";
        var prefix = isData ? "DataPropertyRange(" : "ObjectPropertyRange(";
        return (axiomList || []).filter(function (axiom) {
            return axiom.indexOf(prefix) === 0 && axiom.indexOf(token) >= 0;
        });
    }

    function findPropertyDomainAxioms(axiomList, propertyIri, isData, classIri) {
        var token = "<" + propertyIri + ">";
        var prefix = isData ? "DataPropertyDomain(" : "ObjectPropertyDomain(";
        var classToken = classIri ? ("<" + classIri + ">") : "";
        return (axiomList || []).filter(function (axiom) {
            if (!axiom || axiom.indexOf(prefix) !== 0 || axiom.indexOf(token) < 0) {
                return false;
            }
            if (classToken) {
                return axiom.indexOf(classToken) >= 0;
            }
            return true;
        });
    }

    function subclassOfTargetsClass(axiom, classIri) {
        if (!axiom || axiom.indexOf("SubClassOf(") !== 0) {
            return false;
        }
        var classToken = "<" + classIri + ">";
        // Legacy unannotated form.
        if (axiom.indexOf("SubClassOf(" + classToken + " ") === 0
                || axiom.indexOf("SubClassOf(" + classToken + "\n") === 0) {
            return true;
        }
        var inner = extractCall(axiom, "SubClassOf");
        if (!inner) {
            return false;
        }
        var peeled = peelAxiomAnnotations(splitTop(inner), {});
        return !!(peeled.rest[0] && peeled.rest[0] === classToken);
    }

    function findClassPropertyLinkAxioms(axiomList, classIri, propertyIri, isData) {
        var classToken = "<" + classIri + ">";
        var propertyToken = "<" + propertyIri + ">";
        var domainPrefix = isData ? "DataPropertyDomain(" : "ObjectPropertyDomain(";
        var keywords = restrictionKeywords(isData);
        var expectedDomain = domainPrefix + iri(propertyIri) + " " + iri(classIri) + ")";
        var found = {};
        (axiomList || []).forEach(function (axiom) {
            if (!axiom) {
                return;
            }
            if (axiom === expectedDomain || axiom.indexOf(domainPrefix) === 0
                    && axiom.indexOf(propertyToken) >= 0 && axiom.indexOf(classToken) >= 0) {
                found[axiom] = true;
                return;
            }
            if (axiom.indexOf("SubClassOf(") !== 0 || axiom.indexOf(propertyToken) < 0) {
                return;
            }
            if (!subclassOfTargetsClass(axiom, classIri)) {
                return;
            }
            if (keywords.some(function (keyword) { return axiom.indexOf(keyword) >= 0; })) {
                found[axiom] = true;
            }
        });
        return Object.keys(found);
    }

    function allPropertiesOfKind(model, isData) {
        var bucket = isData ? model.dataProperties : model.objectProperties;
        return Object.keys(bucket).map(function (propertyIri) {
            return bucket[propertyIri];
        }).sort(function (left, right) {
            return labelOf(left).localeCompare(labelOf(right), "zh");
        });
    }

    function classRestrictionAxiom(classIri, propertyIri, rangeIri, isData, constraint, facet, functionCode, stateGraphRaw) {
        var c = normalizeConstraint(constraint);
        if (c.mode === "none") {
            return "";
        }
        var decls = [];
        if (c.mode === "enum") {
            decls.push("Declaration(AnnotationProperty(" + iri(UI_ENUM_VALUES) + "))");
        }
        if (c.mode === "range") {
            decls.push("Declaration(AnnotationProperty(" + iri(UI_MIN_VALUE) + "))");
            decls.push("Declaration(AnnotationProperty(" + iri(UI_MAX_VALUE) + "))");
        }
        var axiom = "SubClassOf("
            + restrictionAnnotationPrefix(facet, functionCode, stateGraphRaw, c)
            + iri(classIri) + " "
            + restrictionExpression(propertyIri, rangeIri, isData, c)
            + ")";
        // Caller may concat decls; return axiom only here for backward compat.
        // Store decls on a side channel via wrapping helper when needed.
        classRestrictionAxiom._lastDecls = decls;
        return axiom;
    }

    function classRestrictionAxiomsWithDecls(classIri, propertyIri, rangeIri, isData, constraint, facet, functionCode, stateGraphRaw) {
        var axiom = classRestrictionAxiom(classIri, propertyIri, rangeIri, isData, constraint, facet, functionCode, stateGraphRaw);
        var decls = classRestrictionAxiom._lastDecls || [];
        classRestrictionAxiom._lastDecls = [];
        if (!axiom) {
            return [];
        }
        return decls.concat([axiom]);
    }

    function hasClassRestriction(axiomList, classIri, propertyIri, isData) {
        var propertyToken = "<" + propertyIri + ">";
        var keywords = restrictionKeywords(isData);
        return (axiomList || []).some(function (axiom) {
            if (axiom.indexOf("SubClassOf(") !== 0
                || axiom.indexOf(propertyToken) < 0
                || !subclassOfTargetsClass(axiom, classIri)) {
                return false;
            }
            return keywords.some(function (keyword) {
                return axiom.indexOf(keyword) >= 0;
            });
        });
    }

    function missingClassRestrictionAxioms(model, axiomList) {
        var missing = [];
        Object.keys(model.dataProperties || {}).forEach(function (propertyIri) {
            var property = model.dataProperties[propertyIri];
            var range = property.ranges[0];
            if (!range) {
                return;
            }
            (property.domains || []).forEach(function (classIri) {
                if (classIri === OWL_THING) {
                    return;
                }
                if (!hasClassRestriction(axiomList, classIri, propertyIri, true)) {
                    missing.push(classRestrictionAxiom(classIri, propertyIri, range, true, {mode: "some"}));
                }
            });
        });
        Object.keys(model.objectProperties || {}).forEach(function (propertyIri) {
            var property = model.objectProperties[propertyIri];
            var range = property.ranges[0] || OWL_THING;
            (property.domains || []).forEach(function (classIri) {
                if (classIri === OWL_THING) {
                    return;
                }
                if (!hasClassRestriction(axiomList, classIri, propertyIri, false)) {
                    missing.push(classRestrictionAxiom(classIri, propertyIri, range, false, {mode: "some"}));
                }
            });
        });
        return missing;
    }

    function axiomsForInstance(model, classIri, name, values) {
        var individualIri = mintIri();
        var axioms = [
            "Declaration(NamedIndividual(" + iri(individualIri) + "))"
        ].concat(labelAxioms(individualIri, name), [
            "ClassAssertion(" + iri(classIri) + " " + iri(individualIri) + ")"
        ]);
        values.forEach(function (value) {
            if (value.kind === "data" && value.text !== "") {
                axioms.push("DataPropertyAssertion(" + iri(value.property) + " " + iri(individualIri) + " " + literal(value.text, value.datatype) + ")");
            }
            if (value.kind === "object" && value.targetIri) {
                axioms.push("ObjectPropertyAssertion(" + iri(value.property) + " " + iri(individualIri) + " " + iri(value.targetIri) + ")");
            }
            if (value.kind === "object-new" && value.name) {
                var created = mintIri();
                axioms.push("Declaration(NamedIndividual(" + iri(created) + "))");
                axioms = axioms.concat(labelAxioms(created, value.name));
                axioms.push("ClassAssertion(" + iri(value.range) + " " + iri(created) + ")");
                axioms.push("ObjectPropertyAssertion(" + iri(value.property) + " " + iri(individualIri) + " " + iri(created) + ")");
            }
        });
        return {iri: individualIri, axioms: axioms, model: model};
    }

    function ontologyFromRevisions(revisions) {
        var axioms = {};
        function axiomKey(axiom) {
            return String(axiom || "").replace(/\s+/g, " ").trim();
        }
        (revisions || []).forEach(function (revision) {
            (revision.changes || []).forEach(function (change) {
                if (!change || !change.axiom) {
                    return;
                }
                var key = axiomKey(change.axiom);
                if (change.operation === "ADD") {
                    axioms[key] = change.axiom;
                } else if (change.operation === "REMOVE") {
                    delete axioms[key];
                }
            });
        });
        var list = Object.keys(axioms).map(function (key) {
            return axioms[key];
        });
        return {
            text: renderOntology(list),
            axioms: list
        };
    }

    /** Prefer server HEAD snapshot: { axioms: string[], revision } */
    function ontologyFromSnapshot(snapshot) {
        var list = (snapshot && snapshot.axioms) ? snapshot.axioms.slice() : [];
        return {
            text: renderOntology(list),
            axioms: list,
            revision: snapshot && snapshot.revision != null ? snapshot.revision : null
        };
    }

    function fetchOntologySnapshot(projectId) {
        return fetch("/api/onto/ontology-snapshot", {
            method: "POST",
            credentials: "include",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8"
            },
            body: JSON.stringify({projectId: projectId})
        }).then(function (response) {
            if (response.status === 401 || response.status === 403) {
                throw new Error("请先用管理员账号登录 WebProtégé，再打开本页。");
            }
            if (!response.ok) {
                throw new Error("读取本体快照失败（" + response.status + "）。");
            }
            return response.json();
        }).then(function (snapshot) {
            return ontologyFromSnapshot(snapshot);
        });
    }

    function axiomsForInstanceUpdate(individualIri, name, values) {
        var axioms = labelAxioms(individualIri, name);
        values.forEach(function (value) {
            if (value.kind === "data" && value.text !== "") {
                axioms.push("DataPropertyAssertion(" + iri(value.property) + " " + iri(individualIri) + " " + literal(value.text, value.datatype) + ")");
            }
            if (value.kind === "object" && value.targetIri) {
                axioms.push("ObjectPropertyAssertion(" + iri(value.property) + " " + iri(individualIri) + " " + iri(value.targetIri) + ")");
            }
            if (value.kind === "object-new" && value.name) {
                var created = mintIri();
                axioms.push("Declaration(NamedIndividual(" + iri(created) + "))");
                axioms = axioms.concat(labelAxioms(created, value.name));
                axioms.push("ClassAssertion(" + iri(value.range) + " " + iri(created) + ")");
                axioms.push("ObjectPropertyAssertion(" + iri(value.property) + " " + iri(individualIri) + " " + iri(created) + ")");
            }
        });
        return axioms;
    }

    function findEditableInstanceAxioms(axiomList, individualIri, fields) {
        var indToken = "<" + individualIri + ">";
        // fields kept for call-site compatibility; save replaces all outgoing property assertions.
        void fields;
        return (axiomList || []).filter(function (axiom) {
            if (axiom.indexOf(indToken) < 0) {
                return false;
            }
            if (axiom.indexOf("AnnotationAssertion(") === 0
                    && (axiom.indexOf("rdf-schema#label") >= 0 || axiom.indexOf("rdfs:label") >= 0)) {
                return true;
            }
            if (axiom.indexOf("DataPropertyAssertion(") === 0) {
                var dataMatch = axiom.match(/^DataPropertyAssertion\(\s*<[^>]+>\s*<([^>]+)>/);
                return !!(dataMatch && dataMatch[1] === individualIri);
            }
            if (axiom.indexOf("ObjectPropertyAssertion(") === 0) {
                var objectMatch = axiom.match(/^ObjectPropertyAssertion\(\s*<[^>]+>\s*<([^>]+)>/);
                return !!(objectMatch && objectMatch[1] === individualIri);
            }
            return false;
        });
    }

    function propertiesOutsideClassFields(model, classIri, isData) {
        var used = {};
        var classFields = fieldsOf(model, classIri);
        (isData ? classFields.data : classFields.object).forEach(function (property) {
            used[property.iri] = true;
        });
        var lineage = classLineage(model, classIri);
        return allPropertiesOfKind(model, isData).filter(function (property) {
            return property && property.iri && !used[property.iri];
        }).sort(function (left, right) {
            function rank(property) {
                var domains = property.domains || [];
                if (!domains.length || domains.indexOf(OWL_THING) >= 0) {
                    return 1;
                }
                if (domains.some(function (domain) {
                    return lineage.indexOf(domain) >= 0;
                })) {
                    return 0;
                }
                return 2;
            }
            var rankDiff = rank(left) - rank(right);
            if (rankDiff !== 0) {
                return rankDiff;
            }
            return labelOf(left).localeCompare(labelOf(right), "zh");
        });
    }

    function findAllInstanceAxioms(axiomList, individualIri) {
        var indToken = "<" + individualIri + ">";
        return (axiomList || []).filter(function (axiom) {
            if (axiom.indexOf(indToken) < 0) {
                return false;
            }
            return axiom.indexOf("Declaration(NamedIndividual(") === 0
                || axiom.indexOf("ClassAssertion(") === 0
                || axiom.indexOf("AnnotationAssertion(") === 0
                || axiom.indexOf("DataPropertyAssertion(") === 0
                || axiom.indexOf("ObjectPropertyAssertion(") === 0;
        });
    }

    function findLabelAxioms(axiomList, subjectIri) {
        var token = "<" + subjectIri + ">";
        return (axiomList || []).filter(function (axiom) {
            return axiom.indexOf("AnnotationAssertion(") === 0
                && axiom.indexOf(token) >= 0
                && (axiom.indexOf("rdf-schema#label") >= 0 || axiom.indexOf("rdfs:label") >= 0);
        });
    }

    function findPropertyAxioms(axiomList, propertyIri, isData) {
        var token = "<" + propertyIri + ">";
        return (axiomList || []).filter(function (axiom) {
            if (axiom.indexOf(token) < 0) {
                return false;
            }
            if (axiom.indexOf("Declaration(") === 0 || axiom.indexOf("AnnotationAssertion(") === 0) {
                return true;
            }
            if (isData) {
                return axiom.indexOf("DataPropertyDomain(") === 0
                    || axiom.indexOf("DataPropertyRange(") === 0
                    || axiom.indexOf("DataPropertyAssertion(") === 0
                    || axiom.indexOf("SubClassOf(") === 0;
            }
            return axiom.indexOf("ObjectPropertyDomain(") === 0
                || axiom.indexOf("ObjectPropertyRange(") === 0
                || axiom.indexOf("ObjectPropertyAssertion(") === 0
                || axiom.indexOf("SubClassOf(") === 0;
        });
    }

    function findPropertySchemaAxioms(axiomList, propertyIri, isData) {
        var token = "<" + propertyIri + ">";
        return (axiomList || []).filter(function (axiom) {
            if (axiom.indexOf(token) < 0) {
                return false;
            }
            if (axiom.indexOf("AnnotationAssertion(") === 0
                && (axiom.indexOf("rdf-schema#label") >= 0 || axiom.indexOf("rdfs:label") >= 0)) {
                return true;
            }
            if (isData) {
                return axiom.indexOf("DataPropertyDomain(") === 0
                    || axiom.indexOf("DataPropertyRange(") === 0
                    || (axiom.indexOf("SubClassOf(") === 0 && restrictionKeywords(true).some(function (keyword) {
                        return axiom.indexOf(keyword) >= 0;
                    }));
            }
            return axiom.indexOf("ObjectPropertyDomain(") === 0
                || axiom.indexOf("ObjectPropertyRange(") === 0
                || (axiom.indexOf("SubClassOf(") === 0 && restrictionKeywords(false).some(function (keyword) {
                    return axiom.indexOf(keyword) >= 0;
                }));
        });
    }

    function findClassAxioms(axiomList, classIri) {
        var token = "<" + classIri + ">";
        return (axiomList || []).filter(function (axiom) {
            if (axiom.indexOf(token) < 0) {
                return false;
            }
            return axiom.indexOf("Declaration(Class(") === 0
                || axiom.indexOf("AnnotationAssertion(") === 0
                || axiom.indexOf("SubClassOf(") === 0
                || axiom.indexOf("EquivalentClasses(") === 0
                || axiom.indexOf("DisjointClasses(") === 0
                || axiom.indexOf("DisjointUnion(") === 0
                || axiom.indexOf("ClassAssertion(") === 0
                || axiom.indexOf("DataPropertyDomain(") === 0
                || axiom.indexOf("ObjectPropertyDomain(") === 0
                || axiom.indexOf("ObjectPropertyRange(") === 0;
        });
    }

    function collectClassDeleteAxioms(model, axiomList, classIri) {
        var collected = {};
        function addAll(list) {
            (list || []).forEach(function (axiom) {
                collected[axiom] = true;
            });
        }
        addAll(findClassAxioms(axiomList, classIri));
        Object.keys(model.dataProperties).forEach(function (propertyIri) {
            if (model.dataProperties[propertyIri].domains.indexOf(classIri) >= 0) {
                addAll(findPropertyAxioms(axiomList, propertyIri, true));
            }
        });
        Object.keys(model.objectProperties).forEach(function (propertyIri) {
            var property = model.objectProperties[propertyIri];
            if (property.domains.indexOf(classIri) >= 0 || property.ranges.indexOf(classIri) >= 0) {
                addAll(findPropertyAxioms(axiomList, propertyIri, false));
            }
        });
        model.classAssertions.forEach(function (assertion) {
            if (assertion.cls === classIri) {
                addAll(findAllInstanceAxioms(axiomList, assertion.individual));
            }
        });
        return Object.keys(collected);
    }

    var SWRL_VAR_NS = "urn:swrl#";
    var RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
    var SWRLB = "http://www.w3.org/2003/11/swrlb#";
    var SWRLB_BUILTINS = {
        equal: 1, notEqual: 1, lessThan: 1, lessThanOrEqual: 1, greaterThan: 1, greaterThanOrEqual: 1,
        add: 1, subtract: 1, multiply: 1, divide: 1, integerDivide: 1, mod: 1, pow: 1, unaryMinus: 1, unaryPlus: 1,
        abs: 1, ceiling: 1, floor: 1, round: 1, roundHalfToEven: 1, sin: 1, cos: 1, tan: 1,
        booleanNot: 1, stringEqualIgnoreCase: 1, stringConcat: 1, substring: 1, stringLength: 1,
        normalizeSpace: 1, upperCase: 1, lowerCase: 1, translate: 1, contains: 1, containsIgnoreCase: 1,
        startsWith: 1, endsWith: 1, substringBefore: 1, substringAfter: 1, matches: 1, replace: 1,
        tokenize: 1, yearMonthDuration: 1, dayTimeDuration: 1, dateTime: 1, date: 1, time: 1,
        subtractDates: 1, subtractTimes: 1, addYearMonthDurationToDate: 1
    };

    function swrlVariable(name) {
        var cleaned = String(name || "x").replace(/^\?/, "");
        return "Variable(<" + SWRL_VAR_NS + cleaned + ">)";
    }

    function swrlVarNameFromIri(varIri) {
        if (!varIri) {
            return "?x";
        }
        if (varIri.indexOf(SWRL_VAR_NS) === 0) {
            return "?" + varIri.slice(SWRL_VAR_NS.length);
        }
        return "?" + localName(varIri);
    }

    function axiomsForSwrlClassRule(label, bodyClassIri, headClassIri) {
        if (!bodyClassIri || !headClassIri || bodyClassIri === headClassIri) {
            return [];
        }
        var vx = swrlVariable("x");
        var body = "Body(ClassAtom(" + iri(bodyClassIri) + " " + vx + "))";
        var head = "Head(ClassAtom(" + iri(headClassIri) + " " + vx + "))";
        var annotation = "";
        if (label) {
            var escaped = String(label).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
            annotation = "Annotation(" + iri(RDFS_LABEL) + " \"" + escaped + "\"@zh) ";
        }
        return ["DLSafeRule(" + annotation + body + " " + head + ")"];
    }

    function findSwrlRuleAxioms(axiomList) {
        return (axiomList || []).filter(function (axiom) {
            return axiom.indexOf("DLSafeRule(") === 0 || axiom.indexOf("Rule(") === 0;
        });
    }

    function buildSwrlNameIndex(model) {
        var index = {classes: {}, objectProperties: {}, dataProperties: {}, individuals: {}};
        function add(map, key, value) {
            if (!key || !value) {
                return;
            }
            var k = String(key).toLowerCase();
            if (!map[k]) {
                map[k] = [];
            }
            if (map[k].indexOf(value) < 0) {
                map[k].push(value);
            }
        }
        function indexEntity(map, entityMap) {
            Object.keys(entityMap || {}).forEach(function (entityIri) {
                var entity = entityMap[entityIri];
                add(map, entityIri, entityIri);
                add(map, localName(entityIri), entityIri);
                (entity.labels || []).forEach(function (literalValue) {
                    add(map, literalValue.value, entityIri);
                });
            });
        }
        if (model) {
            indexEntity(index.classes, model.classes);
            indexEntity(index.objectProperties, model.objectProperties);
            indexEntity(index.dataProperties, model.dataProperties);
            indexEntity(index.individuals, model.individuals);
        }
        return index;
    }

    function resolveSwrlName(name, indexMaps, prefer) {
        var raw = String(name || "").trim();
        if (!raw) {
            return {error: "空名称"};
        }
        if (raw.charAt(0) === "<" && raw.charAt(raw.length - 1) === ">") {
            return {iri: raw.slice(1, -1)};
        }
        var lower = raw.toLowerCase();
        if (lower.indexOf("swrlb:") === 0) {
            return {iri: SWRLB + raw.slice(6), builtin: true};
        }
        if (Object.prototype.hasOwnProperty.call(SWRLB_BUILTINS, raw) || Object.prototype.hasOwnProperty.call(SWRLB_BUILTINS, lower)) {
            return {iri: SWRLB + raw.replace(/^swrlb:/i, ""), builtin: true};
        }
        if (lower === "sameas" || lower === "owl:sameas") {
            return {sameAs: true};
        }
        if (lower === "differentfrom" || lower === "owl:differentfrom") {
            return {differentFrom: true};
        }
        var order = prefer === "data"
            ? ["dataProperties", "objectProperties", "classes", "individuals"]
            : prefer === "object"
                ? ["objectProperties", "dataProperties", "classes", "individuals"]
                : prefer === "class"
                    ? ["classes", "objectProperties", "dataProperties", "individuals"]
                    : prefer === "individual"
                        ? ["individuals", "classes", "objectProperties", "dataProperties"]
                        : ["classes", "objectProperties", "dataProperties", "individuals"];
        var colon = raw.indexOf(":");
        var local = colon >= 0 ? raw.slice(colon + 1) : raw;
        var candidates = [];
        order.forEach(function (kind) {
            var hits = indexMaps[kind][lower] || indexMaps[kind][local.toLowerCase()] || [];
            hits.forEach(function (hit) {
                candidates.push({kind: kind, iri: hit});
            });
        });
        if (!candidates.length && colon >= 0) {
            order.forEach(function (kind) {
                Object.keys(indexMaps[kind]).forEach(function (key) {
                    indexMaps[kind][key].forEach(function (hit) {
                        if (localName(hit).toLowerCase() === local.toLowerCase()) {
                            candidates.push({kind: kind, iri: hit});
                        }
                    });
                });
            });
        }
        if (!candidates.length) {
            return {error: "找不到名称「" + raw + "」（请用类/属性/实例的显示名、localName 或 <完整IRI>）"};
        }
        if (prefer === "class") {
            var classHit = candidates.filter(function (c) { return c.kind === "classes"; })[0];
            if (classHit) {
                return {iri: classHit.iri, kind: "classes"};
            }
        }
        if (prefer === "object" || prefer === "data") {
            var propKind = prefer === "data" ? "dataProperties" : "objectProperties";
            var propHit = candidates.filter(function (c) { return c.kind === propKind; })[0]
                || candidates.filter(function (c) {
                    return c.kind === "objectProperties" || c.kind === "dataProperties";
                })[0];
            if (propHit) {
                return {iri: propHit.iri, kind: propHit.kind};
            }
        }
        return {iri: candidates[0].iri, kind: candidates[0].kind};
    }

    function splitSwrlArgs(inner) {
        var args = [];
        var current = "";
        var depth = 0;
        var inString = false;
        var i;
        for (i = 0; i < inner.length; i++) {
            var ch = inner.charAt(i);
            if (inString) {
                current += ch;
                if (ch === "\\" && i + 1 < inner.length) {
                    current += inner.charAt(++i);
                } else if (ch === "\"") {
                    inString = false;
                }
                continue;
            }
            if (ch === "\"") {
                inString = true;
                current += ch;
                continue;
            }
            if (ch === "(" || ch === "<") {
                depth++;
                current += ch;
                continue;
            }
            if (ch === ")" || ch === ">") {
                depth = Math.max(0, depth - 1);
                current += ch;
                continue;
            }
            if (ch === "," && depth === 0) {
                args.push(current.trim());
                current = "";
                continue;
            }
            current += ch;
        }
        if (current.trim()) {
            args.push(current.trim());
        }
        return args;
    }

    function parseSwrlArgument(token, indexMaps) {
        var t = String(token || "").trim();
        if (!t) {
            return {error: "空参数"};
        }
        if (t.charAt(0) === "?") {
            return {functional: swrlVariable(t), display: t};
        }
        if (t.charAt(0) === "\"" ) {
            var litMatch = t.match(/^\"((?:\\.|[^\"])*)\"(?:@([A-Za-z-]+)|(\^\^(.+)))?$/);
            if (!litMatch) {
                return {error: "无法解析字面量 " + t};
            }
            var value = litMatch[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
            if (litMatch[2]) {
                var escapedLang = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
                return {functional: "\"" + escapedLang + "\"@" + litMatch[2], display: t};
            }
            var dt = XSD + "string";
            if (litMatch[4]) {
                var dtToken = litMatch[4].trim();
                if (dtToken.charAt(0) === "<") {
                    dt = dtToken.slice(1, -1);
                } else if (dtToken.toLowerCase().indexOf("xsd:") === 0) {
                    dt = XSD + dtToken.slice(4);
                } else {
                    dt = dtToken;
                }
            }
            return {functional: literal(value, dt), display: t};
        }
        if (/^[+-]?\d+$/.test(t)) {
            return {functional: literal(t, XSD + "integer"), display: t};
        }
        if (/^[+-]?\d+\.\d+$/.test(t)) {
            return {functional: literal(t, XSD + "decimal"), display: t};
        }
        if (t === "true" || t === "false") {
            return {functional: literal(t, XSD + "boolean"), display: t};
        }
        var resolved = resolveSwrlName(t, indexMaps, "individual");
        if (resolved.error) {
            return resolved;
        }
        return {functional: iri(resolved.iri), display: t, iri: resolved.iri};
    }

    function parseSwrlAtom(text, indexMaps) {
        var trimmed = String(text || "").trim();
        var match = trimmed.match(/^([^\s(]+)\s*\((.*)\)\s*$/);
        if (!match) {
            return {error: "无法解析原子「" + trimmed + "」，期望形如 Class(?x) 或 prop(?x, ?y)"};
        }
        var pred = match[1];
        var args = splitSwrlArgs(match[2]);
        var parsedArgs = [];
        var i;
        for (i = 0; i < args.length; i++) {
            var arg = parseSwrlArgument(args[i], indexMaps);
            if (arg.error) {
                return arg;
            }
            parsedArgs.push(arg);
        }
        var predLower = pred.toLowerCase();
        if (predLower === "sameas" || predLower === "owl:sameas") {
            if (parsedArgs.length !== 2) {
                return {error: "sameAs 需要 2 个参数"};
            }
            return {functional: "SameIndividualAtom(" + parsedArgs[0].functional + " " + parsedArgs[1].functional + ")"};
        }
        if (predLower === "differentfrom" || predLower === "owl:differentfrom") {
            if (parsedArgs.length !== 2) {
                return {error: "differentFrom 需要 2 个参数"};
            }
            return {functional: "DifferentIndividualsAtom(" + parsedArgs[0].functional + " " + parsedArgs[1].functional + ")"};
        }
        var prefer = parsedArgs.length <= 1 ? "class" : "object";
        var resolved = resolveSwrlName(pred, indexMaps, prefer);
        if (resolved.error && parsedArgs.length >= 2) {
            resolved = resolveSwrlName(pred, indexMaps, "data");
        }
        if (resolved.builtin || (resolved.iri && resolved.iri.indexOf(SWRLB) === 0)) {
            return {
                functional: "BuiltInAtom(" + iri(resolved.iri) + " " +
                    parsedArgs.map(function (a) { return a.functional; }).join(" ") + ")"
            };
        }
        if (resolved.error) {
            return resolved;
        }
        if (parsedArgs.length === 1) {
            if (resolved.kind && resolved.kind !== "classes") {
                return {error: "一元原子「" + pred + "」应是类，但匹配到了属性/实例"};
            }
            return {functional: "ClassAtom(" + iri(resolved.iri) + " " + parsedArgs[0].functional + ")"};
        }
        if (parsedArgs.length === 2) {
            if (resolved.kind === "dataProperties") {
                return {
                    functional: "DataPropertyAtom(" + iri(resolved.iri) + " " +
                        parsedArgs[0].functional + " " + parsedArgs[1].functional + ")"
                };
            }
            if (resolved.kind === "objectProperties" || resolved.kind === "classes") {
                if (resolved.kind === "classes") {
                    var asProp = resolveSwrlName(pred, indexMaps, "object");
                    if (asProp.iri && asProp.kind === "objectProperties") {
                        resolved = asProp;
                    } else {
                        asProp = resolveSwrlName(pred, indexMaps, "data");
                        if (asProp.iri && asProp.kind === "dataProperties") {
                            return {
                                functional: "DataPropertyAtom(" + iri(asProp.iri) + " " +
                                    parsedArgs[0].functional + " " + parsedArgs[1].functional + ")"
                            };
                        }
                        return {error: "「" + pred + "」是类名，不能用作二元属性原子"};
                    }
                }
                return {
                    functional: "ObjectPropertyAtom(" + iri(resolved.iri) + " " +
                        parsedArgs[0].functional + " " + parsedArgs[1].functional + ")"
                };
            }
            if (resolved.kind === "dataProperties") {
                return {
                    functional: "DataPropertyAtom(" + iri(resolved.iri) + " " +
                        parsedArgs[0].functional + " " + parsedArgs[1].functional + ")"
                };
            }
            return {
                functional: "ObjectPropertyAtom(" + iri(resolved.iri) + " " +
                    parsedArgs[0].functional + " " + parsedArgs[1].functional + ")"
            };
        }
        if (parsedArgs.length > 2 && (resolved.builtin || predLower.indexOf("swrlb:") === 0 || SWRLB_BUILTINS[pred] || SWRLB_BUILTINS[predLower])) {
            var builtinIri = resolved.iri || (SWRLB + pred.replace(/^swrlb:/i, ""));
            return {
                functional: "BuiltInAtom(" + iri(builtinIri) + " " +
                    parsedArgs.map(function (a) { return a.functional; }).join(" ") + ")"
            };
        }
        return {error: "暂不支持 " + parsedArgs.length + " 个参数的原子「" + pred + "」（内置函数请使用 swrlb: 前缀）"};
    }

    function splitSwrlConjunction(text) {
        var parts = [];
        var current = "";
        var depth = 0;
        var inString = false;
        var i;
        var src = String(text || "");
        for (i = 0; i < src.length; i++) {
            var ch = src.charAt(i);
            if (inString) {
                current += ch;
                if (ch === "\\" && i + 1 < src.length) {
                    current += src.charAt(++i);
                } else if (ch === "\"") {
                    inString = false;
                }
                continue;
            }
            if (ch === "\"") {
                inString = true;
                current += ch;
                continue;
            }
            if (ch === "(") {
                depth++;
                current += ch;
                continue;
            }
            if (ch === ")") {
                depth = Math.max(0, depth - 1);
                current += ch;
                continue;
            }
            if (depth === 0 && ch === "^") {
                if (current.trim()) {
                    parts.push(current.trim());
                }
                current = "";
                continue;
            }
            if (depth === 0 && ch === "∧") {
                if (current.trim()) {
                    parts.push(current.trim());
                }
                current = "";
                continue;
            }
            current += ch;
        }
        if (current.trim()) {
            parts.push(current.trim());
        }
        return parts;
    }

    function parseSwrlPresentation(text, model) {
        var raw = String(text || "").replace(/\u2192/g, "->").replace(/\u2227/g, "^").trim();
        if (!raw) {
            return {ok: false, error: "请输入 SWRL 规则"};
        }
        var arrowIdx = raw.indexOf("->");
        if (arrowIdx < 0) {
            return {ok: false, error: "规则需要包含 ->（或 →），例如：男人(?x) -> 人(?x)"};
        }
        if (raw.indexOf("->", arrowIdx + 2) >= 0) {
            return {ok: false, error: "规则只能有一个 ->"};
        }
        var bodyText = raw.slice(0, arrowIdx).trim();
        var headText = raw.slice(arrowIdx + 2).trim();
        if (!bodyText || !headText) {
            return {ok: false, error: "Body 与 Head 都不能为空"};
        }
        var indexMaps = buildSwrlNameIndex(model);
        var bodyAtoms = splitSwrlConjunction(bodyText);
        var headAtoms = splitSwrlConjunction(headText);
        if (!bodyAtoms.length || !headAtoms.length) {
            return {ok: false, error: "Body 与 Head 都至少需要一个原子"};
        }
        var bodyFunctional = [];
        var headFunctional = [];
        var i;
        for (i = 0; i < bodyAtoms.length; i++) {
            var bodyAtom = parseSwrlAtom(bodyAtoms[i], indexMaps);
            if (bodyAtom.error) {
                return {ok: false, error: "Body：" + bodyAtom.error};
            }
            bodyFunctional.push(bodyAtom.functional);
        }
        for (i = 0; i < headAtoms.length; i++) {
            var headAtom = parseSwrlAtom(headAtoms[i], indexMaps);
            if (headAtom.error) {
                return {ok: false, error: "Head：" + headAtom.error};
            }
            headFunctional.push(headAtom.functional);
        }
        return {
            ok: true,
            bodyAtoms: bodyFunctional,
            headAtoms: headFunctional,
            presentation: bodyAtoms.join(" ^ ") + " -> " + headAtoms.join(" ^ ")
        };
    }

    function axiomsForSwrlPresentation(label, presentationText, model) {
        var parsed = parseSwrlPresentation(presentationText, model);
        if (!parsed.ok) {
            return {ok: false, error: parsed.error, axioms: []};
        }
        var annotation = "";
        if (label) {
            var escaped = String(label).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
            annotation = "Annotation(" + iri(RDFS_LABEL) + " \"" + escaped + "\"@zh) ";
        }
        var axiom = "DLSafeRule(" + annotation +
            "Body(" + parsed.bodyAtoms.join(" ") + ") " +
            "Head(" + parsed.headAtoms.join(" ") + "))";
        return {ok: true, axioms: [axiom], presentation: parsed.presentation};
    }

    function shortSwrlName(entityIri, model) {
        if (!entityIri) {
            return "";
        }
        if (entityIri.indexOf(SWRLB) === 0) {
            return "swrlb:" + entityIri.slice(SWRLB.length);
        }
        if (model) {
            var entity = (model.classes && model.classes[entityIri])
                || (model.objectProperties && model.objectProperties[entityIri])
                || (model.dataProperties && model.dataProperties[entityIri])
                || (model.individuals && model.individuals[entityIri]);
            if (entity) {
                var named = labelOf(entity);
                if (named && named.indexOf(" ") < 0 && named.indexOf("(") < 0) {
                    return named;
                }
            }
        }
        var local = localName(entityIri);
        if (local) {
            return local;
        }
        return "<" + entityIri + ">";
    }

    function formatSwrlFunctionalArg(token, model) {
        var t = String(token || "").trim();
        var varMatch = t.match(/^Variable\(<([^>]+)>\)$/);
        if (varMatch) {
            return swrlVarNameFromIri(varMatch[1]);
        }
        var iriMatch = t.match(/^<([^>]+)>$/);
        if (iriMatch) {
            return shortSwrlName(iriMatch[1], model);
        }
        var litMatch = t.match(/^\"((?:\\.|[^\"])*)\"(?:@([A-Za-z-]+)|(\^\^<([^>]+)>))?/);
        if (litMatch) {
            var value = litMatch[1];
            if (litMatch[2]) {
                return "\"" + value + "\"@" + litMatch[2];
            }
            if (litMatch[4] === XSD + "integer" || litMatch[4] === XSD + "decimal" || litMatch[4] === XSD + "boolean") {
                return value;
            }
            return "\"" + value + "\"";
        }
        return t;
    }

    function splitTopLevelSwrlFunctional(inner) {
        var parts = [];
        var current = "";
        var depth = 0;
        var i;
        for (i = 0; i < inner.length; i++) {
            var ch = inner.charAt(i);
            if (ch === "(") {
                depth++;
                current += ch;
                continue;
            }
            if (ch === ")") {
                depth = Math.max(0, depth - 1);
                current += ch;
                continue;
            }
            if (/\s/.test(ch) && depth === 0) {
                if (current.trim()) {
                    parts.push(current.trim());
                }
                current = "";
                continue;
            }
            current += ch;
        }
        if (current.trim()) {
            parts.push(current.trim());
        }
        return parts;
    }

    function formatSwrlFunctionalAtom(atomText, model) {
        var text = String(atomText || "").trim();
        var classMatch = text.match(/^ClassAtom\((.*)\)$/);
        if (classMatch) {
            var classParts = splitTopLevelSwrlFunctional(classMatch[1]);
            return formatSwrlFunctionalArg(classParts[0], model) + "(" + formatSwrlFunctionalArg(classParts[1], model) + ")";
        }
        var objectMatch = text.match(/^ObjectPropertyAtom\((.*)\)$/);
        if (objectMatch) {
            var objectParts = splitTopLevelSwrlFunctional(objectMatch[1]);
            return formatSwrlFunctionalArg(objectParts[0], model) + "(" +
                formatSwrlFunctionalArg(objectParts[1], model) + ", " +
                formatSwrlFunctionalArg(objectParts[2], model) + ")";
        }
        var dataMatch = text.match(/^DataPropertyAtom\((.*)\)$/);
        if (dataMatch) {
            var dataParts = splitTopLevelSwrlFunctional(dataMatch[1]);
            return formatSwrlFunctionalArg(dataParts[0], model) + "(" +
                formatSwrlFunctionalArg(dataParts[1], model) + ", " +
                formatSwrlFunctionalArg(dataParts[2], model) + ")";
        }
        var builtinMatch = text.match(/^BuiltInAtom\((.*)\)$/);
        if (builtinMatch) {
            var builtinParts = splitTopLevelSwrlFunctional(builtinMatch[1]);
            return formatSwrlFunctionalArg(builtinParts[0], model) + "(" +
                builtinParts.slice(1).map(function (part) {
                    return formatSwrlFunctionalArg(part, model);
                }).join(", ") + ")";
        }
        var sameMatch = text.match(/^SameIndividualAtom\((.*)\)$/);
        if (sameMatch) {
            var sameParts = splitTopLevelSwrlFunctional(sameMatch[1]);
            return "sameAs(" + formatSwrlFunctionalArg(sameParts[0], model) + ", " +
                formatSwrlFunctionalArg(sameParts[1], model) + ")";
        }
        var diffMatch = text.match(/^DifferentIndividualsAtom\((.*)\)$/);
        if (diffMatch) {
            var diffParts = splitTopLevelSwrlFunctional(diffMatch[1]);
            return "differentFrom(" + formatSwrlFunctionalArg(diffParts[0], model) + ", " +
                formatSwrlFunctionalArg(diffParts[1], model) + ")";
        }
        return text;
    }

    function extractSwrlFunctionalAtomList(sectionText) {
        var inner = String(sectionText || "");
        var open = inner.indexOf("(");
        if (open < 0) {
            return [];
        }
        var depth = 0;
        var end = -1;
        var i;
        for (i = open; i < inner.length; i++) {
            if (inner.charAt(i) === "(") {
                depth++;
            } else if (inner.charAt(i) === ")") {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        if (end < 0) {
            return [];
        }
        return splitTopLevelSwrlFunctional(inner.slice(open + 1, end));
    }

    function formatSwrlPresentation(axiom, model) {
        if (!axiom) {
            return "";
        }
        var bodyIdx = axiom.indexOf("Body(");
        var headIdx = axiom.indexOf("Head(");
        if (bodyIdx < 0 || headIdx < 0) {
            return "";
        }
        var bodyAtoms = extractSwrlFunctionalAtomList(axiom.slice(bodyIdx));
        var headAtoms = extractSwrlFunctionalAtomList(axiom.slice(headIdx));
        var bodyText = bodyAtoms.map(function (atom) {
            return formatSwrlFunctionalAtom(atom, model);
        }).join(" ^ ");
        var headText = headAtoms.map(function (atom) {
            return formatSwrlFunctionalAtom(atom, model);
        }).join(" ^ ");
        return bodyText + " -> " + headText;
    }

    function parseSwrlRuleSummary(axiom, model) {
        var labelMatch = axiom.match(/Annotation\(\s*(?:<http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#label>|rdfs:label)\s+\"([^\"]+)\"/);
        var bodyClasses = [];
        var headClasses = [];
        var classAtomRe = /ClassAtom\(<([^>]+)>\s+Variable\(<[^>]+>\)\)/g;
        var bodyPart = "";
        var headPart = "";
        var bodyIdx = axiom.indexOf("Body(");
        var headIdx = axiom.indexOf("Head(");
        if (bodyIdx >= 0 && headIdx >= 0) {
            bodyPart = axiom.slice(bodyIdx, headIdx);
            headPart = axiom.slice(headIdx);
        }
        var match;
        while ((match = classAtomRe.exec(bodyPart))) {
            bodyClasses.push(match[1]);
        }
        classAtomRe.lastIndex = 0;
        while ((match = classAtomRe.exec(headPart))) {
            headClasses.push(match[1]);
        }
        var presentation = formatSwrlPresentation(axiom, model);
        return {
            axiom: axiom,
            label: labelMatch ? labelMatch[1] : "",
            bodyClasses: bodyClasses,
            headClasses: headClasses,
            presentation: presentation
        };
    }


    function parseInferredObjectBindings(axioms) {
        var map = {};
        (axioms || []).forEach(function (axiom) {
            var match = String(axiom || "").match(
                /^ObjectPropertyAssertion\(\s*<([^>]+)>\s*<([^>]+)>\s*<([^>]+)>\s*\)$/
            );
            if (!match) {
                return;
            }
            var propertyIri = match[1];
            var subjectIri = match[2];
            var valueIri = match[3];
            var key = subjectIri + "\t" + propertyIri;
            if (!map[key]) {
                map[key] = {
                    kind: "object",
                    subject: subjectIri,
                    property: propertyIri,
                    values: []
                };
            }
            if (map[key].values.indexOf(valueIri) < 0) {
                map[key].values.push(valueIri);
            }
        });
        return Object.keys(map).map(function (key) {
            return map[key];
        }).sort(function (left, right) {
            var propCmp = left.property.localeCompare(right.property);
            if (propCmp !== 0) {
                return propCmp;
            }
            return left.subject.localeCompare(right.subject);
        });
    }

    function lookupSwrlObjectCandidateValues(bindings, subjectIri, propertyIri) {
        if (!subjectIri || !propertyIri || !bindings || !bindings.length) {
            return null;
        }
        var found = null;
        bindings.forEach(function (binding) {
            if (binding && binding.kind === "object"
                    && binding.subject === subjectIri
                    && binding.property === propertyIri) {
                found = binding.values || [];
            }
        });
        return found;
    }

    function filterRelationTargetsBySwrlCandidates(targets, candidateValues, selectedTarget) {
        var list = (targets || []).slice();
        if (candidateValues) {
            list = list.filter(function (targetIri) {
                return candidateValues.indexOf(targetIri) >= 0;
            });
            candidateValues.forEach(function (targetIri) {
                if (list.indexOf(targetIri) < 0) {
                    list = list.concat([targetIri]);
                }
            });
        }
        if (selectedTarget && list.indexOf(selectedTarget) < 0) {
            list = list.concat([selectedTarget]);
        }
        return list;
    }

    function mount(root, options) {
        if (!root) {
            return;
        }
        options = options || {};
        var initialMode = options.mode === "instance" || options.mode === "rules" || options.mode === "class"
            ? options.mode
            : "class";
        var state = {
            projects: [],
            projectId: options.projectId
                || new URLSearchParams(window.location.search).get("project")
                || "",
            mode: initialMode,
            classTab: "technicalParam",
            instanceTab: "technicalParam",
            relationTab: "basic",
            treePane: "class",
            treeCollapsed: {},
            selectedProperty: null,
            relationCommentEditing: false,
            relationNameEditing: false,
            focusInstance: null,
            /** Selected model class IRI in 模型管理 (flat list); tree keeps metamodel. */
            focusModel: null,
            model: null,
            axioms: [],
            selected: OWL_THING,
            treeSearchHits: {},
            instanceSearchHits: {},
            status: "",
            cleaningInvalidIris: false,
            tablePage: {
                definition: 1, dataLocal: 1, dataInherited: 1, objectLocal: 1, objectInherited: 1,
                disjoint: 1, union: 1, swrlRules: 1, swrlCandidates: 1, swrlResult: 1,
                behaviorList: 1
            },
            tableFilter: {
                dataLocal: "", dataInherited: "", objectLocal: "", objectInherited: "",
                behaviorList: ""
            },
            swrlCandidates: {bindings: [], revision: null, updatedAt: null},
            consistencyResults: {latest: null, history: [], viewingId: null, collapsed: true}
        };
        var TABLE_PAGE_SIZE = 10;
        var embedded = !!options.embedded;

        // Embedded: Vue app-shell owns chrome; no duplicate export/status strip.
        root.innerHTML = embedded
            ? [
                "<select id='project' hidden aria-hidden='true'></select>",
                "<div id='status' class='status status-embedded' hidden aria-live='polite'></div>",
                "<div class='layout layout-embedded'>",
                treePaneHtml(),
                "<aside id='instance-list-pane' class='instance-list-pane' hidden>",
                "<div class='aside-head'><span id='instance-list-title'>知识本体清单</span>",
                "<button type='button' id='add-individual'>新增</button></div>",
                "<div class='instance-list-search'><input type='search' id='instance-list-filter' placeholder='搜索模型名称' autocomplete='off'></div>",
                "<div id='instance-list' class='instance-list'></div>",
                "</aside>",
                "<main id='detail'></main>",
                "<aside id='consistency-pane' class='consistency-pane collapsed is-closed' hidden>",
                "<div class='aside-head consistency-pane-head'>",
                "<span>一致性结果</span>",
                "<button type='button' id='toggle-consistency-pane' title='折叠/展开'>展开</button>",
                "</div>",
                "<div id='consistency-pane-body' class='consistency-pane-body'></div>",
                "</aside>",
                "</div>",
                "<div id='modal' class='modal hidden'></div>"
            ].join("")
            : [
                "<header class='top'>",
                "<div><strong>建模</strong></div>",
                "<label>项目 <select id='project'></select></label>",
                "<div class='modes'>",
                "<button type='button' id='nav-domains'>领域管理</button>",
                "<button type='button' data-mode='class'" + (initialMode === "class" ? " class='active'" : "") + ">元模型管理</button>",
                "<button type='button' data-mode='instance'" + (initialMode === "instance" ? " class='active'" : "") + ">模型管理</button>",
                "<button type='button' data-mode='rules'" + (initialMode === "rules" ? " class='active'" : "") + ">案例库</button>",
                "</div>",
                "<div class='top-actions'>",
                "<button type='button' id='export-ontology' class='ghost' title='导出本体为 OWL / OWX / Turtle 等'>导出</button>",
                "<button type='button' id='check-consistency' class='ghost' title='使用 HermiT 推理并检查一致性（自动忽略 SWRL，规则请用运行 SWRL）'>推理</button>",
                "<button type='button' id='run-swrl' class='ghost' title='使用 Pellet 运行 SWRL 规则'>运行 SWRL</button>",
                "</div>",
                "</header>",
                "<div id='status' class='status'></div>",
                "<div class='layout'>",
                treePaneHtml(),
                "<aside id='instance-list-pane' class='instance-list-pane' hidden>",
                "<div class='aside-head'><span id='instance-list-title'>知识本体清单</span>",
                "<button type='button' id='add-individual'>新增</button></div>",
                "<div class='instance-list-search'><input type='search' id='instance-list-filter' placeholder='搜索模型名称' autocomplete='off'></div>",
                "<div id='instance-list' class='instance-list'></div>",
                "</aside>",
                "<main id='detail'></main>",
                "<aside id='consistency-pane' class='consistency-pane collapsed'>",
                "<div class='aside-head consistency-pane-head'>",
                "<span>一致性结果</span>",
                "<button type='button' id='toggle-consistency-pane' title='折叠/展开'>展开</button>",
                "</div>",
                "<div id='consistency-pane-body' class='consistency-pane-body'></div>",
                "</aside>",
                "</div>",
                "<div id='modal' class='modal hidden'></div>"
            ].join("");

        function treePaneHtml() {
            return [
                "<aside class='tree-pane'>",
                "<div class='tree-toolbar'>",
                "<div class='tree-tabs' role='tablist'>",
                "<button type='button' class='tree-tab is-active' data-tree-pane='class'>要素</button>",
                "<button type='button' class='tree-tab' data-tree-pane='relation'>关系</button>",
                "</div>",
                "<div class='tree-actions'>",
                "<button type='button' class='tree-icon-btn' id='tree-add' title='新增' aria-label='新增'>+</button>",
                "<button type='button' class='tree-icon-btn' id='tree-focus' title='定位到当前选中' aria-label='定位'>☰</button>",
                "<button type='button' class='tree-icon-btn' id='tree-delete' title='删除' aria-label='删除'>✕</button>",
                "<button type='button' class='tree-icon-btn' id='tree-edit' title='编辑' aria-label='编辑'>✎</button>",
                "</div>",
                "</div>",
                "<div class='aside-head tree-pane-caption' hidden><span id='tree-title'>要素</span>",
                "<button type='button' id='add-class' hidden>新建子类</button></div>",
                "<div id='tree' class='tree'></div>",
                "</aside>"
            ].join("");
        }

        /** Uniform class glyph for every tree node (no per-label icon mapping). */
        function treeGlyphHtml() {
            return "<span class='tree-glyph tree-glyph-class' aria-hidden='true'>" +
                "<svg viewBox='0 0 20 20' width='16' height='16'>" +
                "<rect x='3.5' y='3.5' width='13' height='13' rx='2.5' fill='none' stroke='currentColor' stroke-width='1.4'/>" +
                "<path d='M7 8h6M7 10.5h6M7 13h4' fill='none' stroke='currentColor' stroke-width='1.3' stroke-linecap='round'/>" +
                "</svg></span>";
        }

        function syncChromeForMode() {
            var layout = root.querySelector(".layout");
            if (layout) {
                layout.classList.toggle("is-instance-mode", state.mode === "instance");
            }
            var instPane = root.querySelector("#instance-list-pane");
            if (instPane) {
                instPane.hidden = state.mode !== "instance";
            }
            var addClassBtn = root.querySelector("#add-class");
            if (addClassBtn) {
                // CRUD lives in tree-toolbar; keep legacy button as a hidden hook.
                addClassBtn.hidden = true;
            }
            var addInstBtn = root.querySelector("#add-individual");
            if (addInstBtn) {
                addInstBtn.hidden = false;
                // 允许在 Thing 下新增：对话框内再选元模型
                addInstBtn.disabled = state.mode !== "instance"
                    || state.selected === UNTYPED
                    || isModelClass(state.selected, state.model);
                addInstBtn.textContent = "新增";
                addInstBtn.title = "新建模型（可先选左侧元模型）";
            }
            var filterInput = root.querySelector("#instance-list-filter");
            if (filterInput) {
                filterInput.placeholder = "搜索模型名称";
            }
            var treeTitle = root.querySelector("#tree-title");
            if (treeTitle) {
                treeTitle.textContent = state.mode === "rules"
                    ? "规则说明"
                    : (state.mode === "instance" ? "知识类清单" : "类结构");
            }
        }

        function ensureFocusModelSelected() {
            if (state.mode !== "instance" || !state.model) {
                return;
            }
            var all = listAllModelClasses(state.model);
            if (!all.length) {
                state.focusModel = null;
                return;
            }
            if (state.focusModel && all.indexOf(state.focusModel) >= 0) {
                var meta = nearestMetamodelIri(state.focusModel, state.model);
                if (meta && (state.selected === OWL_THING || !state.selected || state.selected === UNTYPED)) {
                    state.selected = meta;
                    ensureTreePathOpen(meta);
                }
                return;
            }
            state.focusModel = all[0];
            state.selected = nearestMetamodelIri(state.focusModel, state.model) || state.selected || OWL_THING;
            ensureTreePathOpen(state.selected);
        }

        function applyMode(mode) {
            if (mode === "data") {
                mode = "instance";
            }
            if (mode !== "class" && mode !== "instance" && mode !== "rules") {
                return;
            }
            state.mode = mode;
            state.focusInstance = null;
            if (state.mode === "rules" || state.mode === "instance") {
                state.treePane = "class";
            }
            // 树从不选中模型类：切模式时若落在模型上，退回其元模型，模型进清单
            if (isModelClass(state.selected, state.model)) {
                state.focusModel = state.selected;
                state.selected = nearestMetamodelIri(state.selected, state.model) || OWL_THING;
            } else if (state.mode !== "instance") {
                state.focusModel = null;
            }
            if (state.mode === "instance") {
                ensureFocusModelSelected();
            }
            root.querySelectorAll("[data-mode]").forEach(function (item) {
                item.classList.toggle("active", item.getAttribute("data-mode") === mode);
            });
            syncChromeForMode();
            renderTree();
            if (state.mode === "instance") {
                renderInstanceList();
            }
            renderDetail();
            emitSelectionChrome();
        }

        function applyProjectId(projectId) {
            if (!projectId || projectId === state.projectId) {
                return;
            }
            state.projectId = projectId;
            var select = root.querySelector("#project");
            if (select) {
                select.value = projectId;
            }
            var url = new URL(window.location.href);
            url.searchParams.set("project", state.projectId);
            window.history.replaceState(null, "", url);
            loadOntology();
            loadSwrlCandidates();
            loadConsistencyResults();
        }

        root.querySelectorAll("[data-mode]").forEach(function (button) {
            button.addEventListener("click", function () {
                applyMode(button.getAttribute("data-mode"));
            });
        });
        root.querySelector("#project").addEventListener("change", function (event) {
            applyProjectId(event.target.value);
        });
        function onStateMachineChanged(event) {
            var detail = (event && event.detail) || {};
            if (detail.projectId && detail.projectId !== state.projectId) {
                return;
            }
            loadOntology().then(function () {
                var name = detail.behaviorLabel ? ("「" + detail.behaviorLabel + "」") : "";
                setStatus(detail.deleted
                    ? ("已删除" + name + "的状态机。")
                    : ("已保存" + name + "的状态机到本类 SubClassOf 的 benti:stateGraph。"));
            }).catch(function () { /* status already set */ });
        }
        function onInstanceBehaviorStateChanged(event) {
            var detail = (event && event.detail) || {};
            if (detail.projectId && detail.projectId !== state.projectId) {
                return;
            }
            if (!detail.individualIri || !detail.behaviorIri) {
                return;
            }
            loadOntology().then(function () {
                var label = detail.stateLabel || detail.stateId || "";
                setStatus(label
                    ? ("已将实例行为当前状态设为「" + label + "」。")
                    : "已更新实例行为当前状态。");
            }).catch(function () { /* status already set */ });
        }
        window.addEventListener("class-state-machine-changed", onStateMachineChanged);
        window.addEventListener("instance-behavior-state-changed", onInstanceBehaviorStateChanged);
        var addIndividualBtn = root.querySelector("#add-individual");
        if (addIndividualBtn) {
            addIndividualBtn.addEventListener("click", function () {
                if (state.mode !== "instance") {
                    return;
                }
                if (state.selected === UNTYPED || isModelClass(state.selected, state.model)) {
                    setStatus("请先在左侧树选择一个元模型类，再新增模型。", true);
                    return;
                }
                openCreateModelDialog(
                    state.selected && state.selected !== OWL_THING && isMetamodelClass(state.selected, state.model)
                        ? state.selected
                        : ""
                );
            });
        }
        var instanceListFilter = root.querySelector("#instance-list-filter");
        if (instanceListFilter) {
            instanceListFilter.addEventListener("input", function () {
                renderInstanceList();
            });
        }
        syncChromeForMode();
        root.querySelectorAll("[data-tree-pane]").forEach(function (button) {
            button.addEventListener("click", function () {
                var nextPane = button.getAttribute("data-tree-pane") || "class";
                if (state.mode === "instance" && nextPane === "relation") {
                    setStatus("模型管理只编辑约束，关系骨架请到「元模型管理」维护。", true);
                    return;
                }
                state.treePane = nextPane;
                if (state.treePane !== "relation") {
                    state.relationCommentEditing = false;
                    state.relationNameEditing = false;
                }
                renderTree();
                renderDetail();
                emitSelectionChrome();
            });
        });
        root.querySelector("#tree-add").addEventListener("click", function () {
            if (state.mode === "rules") {
                return;
            }
            if (state.mode === "instance") {
                openCreateModelDialog(
                    state.selected && state.selected !== OWL_THING && isMetamodelClass(state.selected, state.model)
                        ? state.selected
                        : ""
                );
                return;
            }
            if (state.treePane === "relation") {
                if (!state.selected || state.selected === UNTYPED) {
                    setStatus("请先在「要素」中选择一个类，再添加关系。", true);
                    return;
                }
                openAddPropertyDialog(state.model.classes[state.selected], false, "relation");
                return;
            }
            if (state.selected === UNTYPED) {
                state.selected = OWL_THING;
            }
            openClassDialog();
        });
        root.querySelector("#tree-edit").addEventListener("click", function () {
            if (state.mode === "rules") {
                return;
            }
            if (state.treePane === "relation") {
                if (!state.selectedProperty) {
                    setStatus("请先选择一个关系。", true);
                    return;
                }
                openEditPropertyDialog(state.selectedProperty, false, {});
                return;
            }
            openRenameClassDialog();
        });
        root.querySelector("#tree-delete").addEventListener("click", function () {
            if (state.mode === "rules") {
                return;
            }
            if (state.treePane === "relation") {
                if (!state.selectedProperty) {
                    setStatus("请先选择一个关系。", true);
                    return;
                }
                confirmDeleteProperty(state.selectedProperty, false, {});
                return;
            }
            confirmDeleteClass();
        });
        root.querySelector("#tree-focus").addEventListener("click", function () {
            var selector = state.treePane === "relation"
                ? "[data-property='" + (state.selectedProperty || "") + "']"
                : "[data-class='" + (state.selected || "") + "']";
            var row = root.querySelector("#tree " + selector);
            if (row) {
                row.scrollIntoView({block: "center", behavior: "smooth"});
                row.classList.add("tree-flash");
                setTimeout(function () {
                    row.classList.remove("tree-flash");
                }, 1200);
            }
        });
        function onNavigateClass(event) {
            var iriValue = event && event.detail && event.detail.iri;
            if (!iriValue) {
                return;
            }
            selectClass(iriValue);
        }
        function collectGlobalSearchResults(query) {
            var q = String(query || "").trim();
            if (!q || !state.model) {
                return [];
            }
            var results = [];
            Object.keys(state.model.classes || {}).forEach(function (iriValue) {
                if (!iriValue || iriValue === OWL_THING || iriValue === UNTYPED) {
                    return;
                }
                var entity = state.model.classes[iriValue];
                var label = labelOf(entity);
                var hay = [label, localName(iriValue), iriValue].join(" ");
                if (!fuzzyTextMatch(hay, q)) {
                    return;
                }
                var asModel = isModelClass(iriValue, state.model);
                var metaIri = asModel ? nearestMetamodelIri(iriValue, state.model) : "";
                var metaLabel = metaIri
                    ? labelOf(state.model.classes[metaIri] || {iri: metaIri, labels: []})
                    : "";
                results.push({
                    kind: asModel ? "model" : "class",
                    iri: iriValue,
                    label: label || localName(iriValue),
                    hint: asModel
                        ? (metaLabel ? ("模型 · " + metaLabel) : "模型")
                        : "元模型",
                    typeIri: metaIri || ""
                });
            });
            results.sort(function (left, right) {
                if (left.kind !== right.kind) {
                    return left.kind === "class" ? -1 : 1;
                }
                return String(left.label || "").localeCompare(String(right.label || ""), "zh");
            });
            return results.slice(0, 50);
        }
        function applyTreeSearchHits(hitMap, options) {
            options = options || {};
            state.treeSearchHits = hitMap || {};
            Object.keys(state.treeSearchHits).forEach(function (iriValue) {
                ensureTreePathOpen(iriValue);
            });
            if (state.treePane !== "class" && Object.keys(state.treeSearchHits).length) {
                state.treePane = "class";
            }
            renderTree();
            if (options.flash) {
                requestAnimationFrame(function () {
                    root.querySelectorAll("#tree .tree-row.is-search-hit").forEach(function (row) {
                        row.classList.remove("tree-flash");
                        void row.offsetWidth;
                        row.classList.add("tree-flash");
                        window.setTimeout(function () {
                            row.classList.remove("tree-flash");
                        }, 1400);
                    });
                });
            }
        }
        function onGlobalSearch(event) {
            var detail = (event && event.detail) || {};
            var query = String(detail.query || "").trim();
            if (detail.clear || !query) {
                state.instanceSearchHits = {};
                applyTreeSearchHits({}, {flash: false});
                if (state.mode === "instance") {
                    renderInstanceList();
                }
                window.dispatchEvent(new CustomEvent("modeling-search-results", {
                    detail: {requestId: detail.requestId, query: "", results: []}
                }));
                return;
            }
            var results = collectGlobalSearchResults(query);
            var hitMap = {};
            results.forEach(function (item) {
                if ((item.kind === "class" || item.kind === "model") && item.iri) {
                    hitMap[item.iri] = true;
                    if (item.typeIri) {
                        hitMap[item.typeIri] = true;
                    }
                }
            });
            state.instanceSearchHits = {};
            if (detail.highlight !== false) {
                applyTreeSearchHits(hitMap, {flash: true});
            }
            if (detail.navigateFirst && results.length) {
                var first = results[0];
                navigateToEntity(
                    first.iri,
                    first.kind === "model" ? "模型" : "类"
                );
            }
            window.dispatchEvent(new CustomEvent("modeling-search-results", {
                detail: {requestId: detail.requestId, query: query, results: results}
            }));
        }
        function onNavigateEntity(event) {
            var detail = (event && event.detail) || {};
            if (!detail.iri) {
                return;
            }
            navigateToEntity(detail.iri, detail.kind || "");
        }
        window.addEventListener("modeling-navigate-class", onNavigateClass);
        window.addEventListener("modeling-global-search", onGlobalSearch);
        window.addEventListener("modeling-navigate-entity", onNavigateEntity);
        root.querySelector("#add-class").addEventListener("click", function () {
            if (state.selected === UNTYPED) {
                state.selected = OWL_THING;
            }
            openClassDialog();
        });
        var exportBtn = root.querySelector("#export-ontology");
        if (exportBtn) {
            exportBtn.addEventListener("click", function () {
                openExportDialog();
            });
        }
        var consistencyBtn = root.querySelector("#check-consistency");
        if (consistencyBtn) {
            consistencyBtn.addEventListener("click", function () {
                runConsistencyCheck();
            });
        }
        function onRunConsistencyEvent() {
            runConsistencyCheck();
        }
        window.addEventListener("modeling-run-consistency", onRunConsistencyEvent);
        var swrlBtn = root.querySelector("#run-swrl");
        if (swrlBtn) {
            swrlBtn.addEventListener("click", function () {
                runSwrlReasoning();
            });
        }
        root.querySelector("#toggle-consistency-pane").addEventListener("click", function () {
            state.consistencyResults.collapsed = !state.consistencyResults.collapsed;
            syncConsistencyPaneCollapsed();
        });
        root.querySelector("#consistency-pane-body").addEventListener("click", function (event) {
            var link = event.target.closest("[data-nav-iri]");
            if (link) {
                event.preventDefault();
                navigateToEntity(link.getAttribute("data-nav-iri"), link.getAttribute("data-nav-kind"));
            }
        });

        loadProjects();
        syncConsistencyPaneCollapsed();
        renderConsistencyPane();

        function setStatus(text, isError) {
            var node = root.querySelector("#status");
            if (!node) {
                return;
            }
            // Embedded shell hides the strip; still keep text for screen readers / debugging.
            if (embedded) {
                node.hidden = true;
                node.textContent = text || "";
                node.classList.toggle("error", !!isError);
                return;
            }
            node.hidden = false;
            node.textContent = text || "";
            node.classList.toggle("error", !!isError);
            node.classList.toggle("ok", !!text && !isError && text.indexOf("一致") >= 0);
        }

        function openExportDialog() {
            if (!state.projectId) {
                setStatus("请先选择项目再导出。", true);
                return;
            }
            showModal(
                "<form id='export-form'>" +
                "<h2>导出本体</h2>" +
                "<p class='help'>下载当前项目 HEAD 修订版本体文件（与 WebProtege Download 一致）。多本体项目会打包为 zip。</p>" +
                "<label>格式<select name='format'>" +
                "<option value='owl'>OWL / RDF/XML (.owl)</option>" +
                "<option value='owx'>OWL/XML (.owx)</option>" +
                "<option value='ttl'>Turtle (.ttl)</option>" +
                "<option value='omn'>Manchester (.omn)</option>" +
                "<option value='ofn'>Functional (.ofn)</option>" +
                "</select></label>" +
                "<div class='actions'>" +
                "<button type='button' id='cancel'>取消</button>" +
                "<button type='submit'>下载</button>" +
                "</div></form>"
            );
            var form = root.querySelector("#export-form");
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var format = (form.format && form.format.value) || "owl";
                hideModal();
                exportOntologyFile(format);
            });
        }

        function exportOntologyFile(format) {
            if (!state.projectId) {
                setStatus("请先选择项目再导出。", true);
                return;
            }
            setStatus("正在导出本体…");
            fetch("/api/onto/export", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/octet-stream, application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({projectId: state.projectId, format: format || "owl"})
            }).then(function (response) {
                if (!response.ok) {
                    return response.text().then(function (text) {
                        var body = {};
                        try {
                            body = text ? JSON.parse(text) : {};
                        } catch (error) {
                            body = {};
                        }
                        throw new Error(body.error || body.message || text || ("导出失败（HTTP " + response.status + "）"));
                    });
                }
                var disposition = response.headers.get("Content-Disposition") || "";
                var fileName = "ontology." + (format || "owl");
                var utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
                var plainMatch = disposition.match(/filename="?([^";]+)"?/i);
                if (utfMatch) {
                    try {
                        fileName = decodeURIComponent(utfMatch[1]);
                    } catch (error) {
                        fileName = utfMatch[1];
                    }
                } else if (plainMatch) {
                    fileName = plainMatch[1];
                }
                return response.blob().then(function (blob) {
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement("a");
                    a.href = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    setStatus("已下载 " + fileName);
                });
            }).catch(function (error) {
                setStatus(error.message || String(error), true);
            });
        }

        function loadSwrlCandidates() {
            if (!state.projectId) {
                state.swrlCandidates = {bindings: [], revision: null, updatedAt: null};
                return Promise.resolve(state.swrlCandidates);
            }
            return fetch("/api/onto/swrl-candidates/get", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({projectId: state.projectId})
            }).then(function (response) {
                return response.text().then(function (text) {
                    var body = {};
                    try {
                        body = text ? JSON.parse(text) : {};
                    } catch (error) {
                        throw new Error("读取 SWRL 候选结果失败（非 JSON）");
                    }
                    if (!response.ok) {
                        throw new Error(body.error || ("读取 SWRL 候选失败（HTTP " + response.status + "）"));
                    }
                    state.swrlCandidates = {
                        bindings: body.bindings || [],
                        revision: body.revision == null ? null : body.revision,
                        updatedAt: body.updatedAt == null ? null : body.updatedAt
                    };
                    return state.swrlCandidates;
                });
            }).catch(function (error) {
                state.swrlCandidates = {bindings: [], revision: null, updatedAt: null};
                return state.swrlCandidates;
            });
        }

        function saveSwrlCandidates(revision, bindings) {
            var payload = {
                revision: revision == null ? null : revision,
                bindings: bindings || []
            };
            return fetch("/api/onto/swrl-candidates", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify(Object.assign({projectId: state.projectId}, payload))
            }).then(function (response) {
                return response.text().then(function (text) {
                    var body = {};
                    try {
                        body = text ? JSON.parse(text) : {};
                    } catch (error) {
                        throw new Error("保存 SWRL 候选失败（服务器返回非 JSON）");
                    }
                    if (!response.ok) {
                        throw new Error(body.error || ("保存 SWRL 候选失败（HTTP " + response.status + "）"));
                    }
                    state.swrlCandidates = {
                        bindings: bindings || [],
                        revision: revision == null ? null : revision,
                        updatedAt: body.updatedAt == null ? Date.now() : body.updatedAt
                    };
                    return state.swrlCandidates;
                });
            });
        }

        function swrlObjectCandidateValues(subjectIri, propertyIri) {
            return lookupSwrlObjectCandidateValues(
                state.swrlCandidates && state.swrlCandidates.bindings,
                subjectIri,
                propertyIri
            );
        }

        function entityLabel(iri) {
            return labelOf(
                (state.model && (state.model.individuals[iri]
                    || state.model.objectProperties[iri]
                    || state.model.dataProperties[iri]
                    || state.model.classes[iri]))
                || {iri: iri, labels: []}
            );
        }

        function showLoadingModal(title, hint) {
            var modal = root.querySelector("#modal");
            modal.innerHTML =
                "<div class='dialog dialog-loading' role='status' aria-live='polite' aria-busy='true'>" +
                "<div class='loading-spinner' aria-hidden='true'></div>" +
                "<h2 class='loading-title'>" + escapeHtml(title || "处理中") + "</h2>" +
                "<p class='loading-hint'>" + escapeHtml(hint || "请稍候…") + "</p>" +
                "</div>";
            modal.classList.remove("hidden");
        }

        function runSwrlReasoning() {
            if (!state.projectId) {
                setStatus("请先选择项目。", true);
                return;
            }
            var button = root.querySelector("#run-swrl");
            var inline = root.querySelector("#run-swrl-inline");
            function setBusy(busy) {
                if (button) {
                    button.disabled = busy;
                }
                if (inline) {
                    inline.disabled = busy;
                }
            }
            setBusy(true);
            showLoadingModal("正在运行 SWRL", "Pellet 正在按当前规则与数据推理，本体较大时可能需要几十秒，请稍候…");
            setStatus("正在按当前规则重新运行 Pellet SWRL…");
            // Always hit the server with the latest revision; never reuse a cached GET.
            fetch("/api/onto/reason/swrl", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache"
                },
                body: JSON.stringify({projectId: state.projectId})
            }).then(function (response) {
                return response.json().then(function (body) {
                    return {ok: response.ok, status: response.status, body: body};
                });
            }).then(function (result) {
                setBusy(false);
                hideModal();
                if (!result.ok || (result.body && result.body.error)) {
                    setStatus((result.body && result.body.error) || ("SWRL 运行失败（HTTP " + result.status + "）"), true);
                    return;
                }
                if (!result.body.consistent) {
                    setStatus("本体不一致，已跳过 SWRL 候选更新。", true);
                    return;
                }
                var inferred = result.body.inferredAxioms || [];
                // candidateObjectAxioms = what current SWRL heads derive (recomputed every run).
                var axiomsForCandidates = Array.isArray(result.body.candidateObjectAxioms)
                    ? result.body.candidateObjectAxioms
                    : inferred;
                var bindings = parseInferredObjectBindings(axiomsForCandidates);
                var elapsed = result.body.elapsedMs != null ? ("，耗时 " + result.body.elapsedMs + " ms") : "";
                var rules = result.body.ruleCount != null ? ("，规则 " + result.body.ruleCount + " 条") : "";
                var rev = result.body.revision != null ? ("，修订 " + result.body.revision) : "";
                // Always overwrite the candidate store with this run's result (including empty).
                return saveSwrlCandidates(result.body.revision, bindings).then(function () {
                    if (!bindings.length) {
                        setStatus("SWRL 已按当前规则重跑：无关系候选" + rules + rev + elapsed + "（候选库已整表覆盖为空）。");
                    } else {
                        setStatus("SWRL 已按当前规则重跑：覆盖候选库 " + bindings.length + " 组（新推断 " + inferred.length + " 条）" + rules + rev + elapsed + "。");
                    }
                    showSwrlResultModal(bindings, inferred, axiomsForCandidates, result.body.revision);
                    if (state.mode === "rules") {
                        renderDetail();
                    }
                });
            }).catch(function (error) {
                setBusy(false);
                hideModal();
                setStatus(error.message || String(error), true);
            });
        }

        function showSwrlResultModal(bindings, inferred, candidateAxioms, revision) {
            var list = bindings || [];
            var hasBindings = !!list.length;
            var revBit = revision != null ? ("（修订 " + revision + "）") : "";
            var hint = hasBindings
                ? ("本次已按当前规则重新推理" + revBit + "，并整表覆盖候选库 " + list.length
                    + " 组（不改本体）。实例编辑里对应关系的「选择实例」会按本次结果过滤。改规则或数据后再点「运行 SWRL」即可刷新。")
                : ("本次已按当前规则重新推理" + revBit
                    + "：未得到关系候选（规则未命中或规则头无对象属性）。候选库已整表覆盖为空，下拉暂不按 SWRL 过滤。");
            state.tablePage.swrlResult = 1;
            showModal(
                "<div id='swrl-result-form' class='classify-form'>" +
                "<h2>SWRL 候选结果（本次重跑）</h2>" +
                "<p class='hint'>" + hint + "</p>" +
                "<div class='panel-head' style='margin-top:8px'><h3 style='margin:0;font-size:14px'>候选绑定</h3>" +
                "<span class='panel-count' id='swrl-result-count'>" + list.length + "</span></div>" +
                "<div id='swrl-result-table-wrap'></div>" +
                "<p class='hint'>本次候选公理 " + ((candidateAxioms && candidateAxioms.length) || 0) +
                " 条；相对本体的新推断 " + ((inferred && inferred.length) || 0) + " 条。</p>" +
                "<div class='actions'><button type='button' id='cancel'>关闭</button></div></div>"
            );

            function paintResultTable() {
                var wrap = root.querySelector("#swrl-result-table-wrap");
                var countEl = root.querySelector("#swrl-result-count");
                if (!wrap) {
                    return;
                }
                if (countEl) {
                    countEl.textContent = String(list.length);
                }
                var pageInfo = pageSlice(list, "swrlResult");
                var rows = pageInfo.rows.map(function (binding, offset) {
                    var index = pageInfo.start + offset;
                    var valueLabels = (binding.values || []).map(function (iri) {
                        return entityLabel(iri);
                    }).join("、");
                    return "<tr>" +
                        "<td>" + (index + 1) + "</td>" +
                        "<td>" + escapeHtml(entityLabel(binding.subject)) + "</td>" +
                        "<td>" + escapeHtml(entityLabel(binding.property)) + "</td>" +
                        "<td>" + escapeHtml(valueLabels || "（无）") + "</td>" +
                        "</tr>";
                }).join("");
                wrap.innerHTML = renderDataTable(
                    ["#", "主体实例", "关系", "可选目标"],
                    rows || "",
                    "没有关系候选。"
                ) + renderPager("swrlResult", pageInfo);
                wrap.querySelectorAll("[data-page-key='swrlResult']").forEach(function (button) {
                    button.addEventListener("click", function () {
                        if (button.disabled) {
                            return;
                        }
                        state.tablePage.swrlResult = parseInt(button.getAttribute("data-page"), 10) || 1;
                        paintResultTable();
                    });
                });
            }
            paintResultTable();
        }

        function swrlRuleDisplay(rule, index) {
            var presentation = rule.presentation || formatSwrlPresentation(rule.axiom, state.model);
            return {
                title: rule.label || ("规则 " + (index + 1)),
                summary: presentation || "（无法解析的规则）"
            };
        }

        function renderRulesDetail(detail) {
            var rules = findSwrlRuleAxioms(state.axioms).map(function (axiom) {
                return parseSwrlRuleSummary(axiom, state.model);
            });
            detail.innerHTML = [
                "<h1>SWRL 规则</h1>",
                "<p class='hint'>语法与桌面 Protégé SWRLTab 一致。每次点「运行 SWRL」都会按当前规则与数据重新推理，并整表覆盖候选库（不改本体）；实例编辑时对应关系下拉按最近一次结果过滤。</p>",
                "<div class='panel-tools' style='margin-bottom:12px'>",
                "<button type='button' id='add-swrl-rule'>新建规则</button>",
                "<button type='button' id='run-swrl-inline'>运行 SWRL</button>",
                "<label class='picker-search swrl-search'><span class='sr-only'>搜索规则</span>",
                "<input type='search' id='swrl-search' placeholder='搜索规则名称或语句…' autocomplete='off'></label>",
                "</div>",
                "<section class='panel table-panel'>",
                "<div class='panel-head'><h2>规则列表</h2><span class='panel-count' id='swrl-count'>" + rules.length + "</span></div>",
                "<div id='swrl-table-wrap'></div>",
                "</section>",
                "<section class='panel table-panel' style='margin-top:16px'>",
                "<div class='panel-head'><h2>最近运行候选</h2><span class='panel-count' id='swrl-candidate-count'>0</span></div>",
                "<p class='hint' id='swrl-candidate-meta'></p>",
                "<div id='swrl-candidate-wrap'></div>",
                "</section>"
            ].join("");

            function paintRulesTable(query) {
                var q = String(query || "").trim().toLowerCase();
                var matched = [];
                rules.forEach(function (rule, index) {
                    var display = swrlRuleDisplay(rule, index);
                    var hay = (display.title + " " + display.summary).toLowerCase();
                    if (!q || hay.indexOf(q) >= 0) {
                        matched.push({rule: rule, index: index, display: display});
                    }
                });
                var pageInfo = pageSlice(matched, "swrlRules");
                var rows = pageInfo.rows.map(function (item) {
                    return "<tr>" +
                        "<td>" + escapeHtml(item.display.title) + "</td>" +
                        "<td><code class='swrl-summary'>" + escapeHtml(item.display.summary) + "</code></td>" +
                        "<td class='col-actions'>" +
                        "<button type='button' data-edit-swrl='" + item.index + "'>编辑</button>" +
                        "<button type='button' class='danger' data-delete-swrl='" + item.index + "'>删除</button>" +
                        "</td></tr>";
                }).join("");
                var emptyMsg = rules.length
                    ? (q ? "没有匹配「" + escapeHtml(query) + "」的规则。" : "还没有 SWRL 规则。")
                    : "还没有 SWRL 规则。可新建，例如：男人(?x) -> 人(?x)";
                var wrap = detail.querySelector("#swrl-table-wrap");
                wrap.innerHTML = renderDataTable(["名称", "规则语句", "操作"], rows || "", emptyMsg)
                    + renderPager("swrlRules", pageInfo);
                var countEl = detail.querySelector("#swrl-count");
                if (countEl) {
                    countEl.textContent = q ? (matched.length + "/" + rules.length) : String(rules.length);
                }
                wrap.querySelectorAll("[data-edit-swrl]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        openSwrlRuleDialog(rules[parseInt(button.getAttribute("data-edit-swrl"), 10)]);
                    });
                });
                wrap.querySelectorAll("[data-delete-swrl]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        confirmDeleteSwrlRule(rules[parseInt(button.getAttribute("data-delete-swrl"), 10)]);
                    });
                });
                wrap.querySelectorAll("[data-page-key='swrlRules']").forEach(function (button) {
                    button.addEventListener("click", function () {
                        if (button.disabled) {
                            return;
                        }
                        state.tablePage.swrlRules = parseInt(button.getAttribute("data-page"), 10) || 1;
                        paintRulesTable(searchInput.value);
                    });
                });
            }

            detail.querySelector("#add-swrl-rule").addEventListener("click", function () {
                openSwrlRuleDialog(null);
            });
            detail.querySelector("#run-swrl-inline").addEventListener("click", runSwrlReasoning);
            var searchInput = detail.querySelector("#swrl-search");
            searchInput.addEventListener("input", function () {
                state.tablePage.swrlRules = 1;
                paintRulesTable(searchInput.value);
            });
            paintRulesTable("");

            function paintCandidateTable() {
                var bindings = (state.swrlCandidates && state.swrlCandidates.bindings) || [];
                var countEl = detail.querySelector("#swrl-candidate-count");
                var metaEl = detail.querySelector("#swrl-candidate-meta");
                var wrap = detail.querySelector("#swrl-candidate-wrap");
                if (countEl) {
                    countEl.textContent = String(bindings.length);
                }
                if (metaEl) {
                    var bits = [];
                    if (state.swrlCandidates && state.swrlCandidates.revision != null) {
                        bits.push("修订 " + state.swrlCandidates.revision);
                    }
                    if (state.swrlCandidates && state.swrlCandidates.updatedAt) {
                        bits.push("更新于 " + new Date(state.swrlCandidates.updatedAt).toLocaleString());
                    }
                    metaEl.textContent = bits.length
                        ? ("候选库：" + bits.join(" · ") + "。重新运行会整表覆盖。")
                        : "尚未运行过 SWRL，或候选库为空。";
                }
                var pageInfo = pageSlice(bindings, "swrlCandidates");
                var rows = pageInfo.rows.map(function (binding, offset) {
                    var index = pageInfo.start + offset;
                    var valueLabels = (binding.values || []).map(function (iri) {
                        return entityLabel(iri);
                    }).join("、");
                    return "<tr>" +
                        "<td>" + (index + 1) + "</td>" +
                        "<td>" + escapeHtml(entityLabel(binding.subject)) + "</td>" +
                        "<td>" + escapeHtml(entityLabel(binding.property)) + "</td>" +
                        "<td>" + escapeHtml(valueLabels || "（无）") + "</td>" +
                        "</tr>";
                }).join("");
                if (wrap) {
                    wrap.innerHTML = renderDataTable(
                        ["#", "主体实例", "关系", "可选目标"],
                        rows || "",
                        "没有候选绑定。点「运行 SWRL」生成。"
                    ) + renderPager("swrlCandidates", pageInfo);
                    wrap.querySelectorAll("[data-page-key='swrlCandidates']").forEach(function (button) {
                        button.addEventListener("click", function () {
                            if (button.disabled) {
                                return;
                            }
                            state.tablePage.swrlCandidates = parseInt(button.getAttribute("data-page"), 10) || 1;
                            paintCandidateTable();
                        });
                    });
                }
            }
            paintCandidateTable();
            loadSwrlCandidates().then(function () {
                state.tablePage.swrlCandidates = 1;
                paintCandidateTable();
            });
        }

        function confirmDeleteSwrlRule(rule) {
            if (!rule) {
                return;
            }
            var title = rule.label || rule.presentation || "未命名规则";
            showModal(
                "<div id='delete-swrl-form'><h2>删除规则</h2>" +
                "<p>确认删除「" + escapeHtml(title) + "」？删除后会写入新修订，WebProtégé 同步可见。</p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='button' id='confirm-delete-swrl' class='danger'>确认删除</button></div></div>"
            );
            root.querySelector("#confirm-delete-swrl").addEventListener("click", function () {
                hideModal();
                deleteAxioms([rule.axiom], "删除 SWRL 规则 " + title).then(function () {
                    return loadOntology();
                }).then(function () {
                    setStatus("已删除 SWRL 规则「" + title + "」。");
                }).catch(function (error) {
                    setStatus(error.message || String(error), true);
                });
            });
        }

        function openSwrlRuleDialog(existing) {
            var editing = !!existing;
            var initialText = editing
                ? (existing.presentation || formatSwrlPresentation(existing.axiom, state.model))
                : "";
            showModal(
                "<form id='swrl-rule-form' class='add-field-form'>" +
                "<h2>" + (editing ? "编辑" : "新建") + " SWRL 规则</h2>" +
                "<p class='hint'>与桌面 Protégé 相同写法。示例：<code>男人(?x) -> 人(?x)</code>；" +
                "多条件用 <code>^</code>；比较用 <code>swrlb:lessThanOrEqual(?w, ?m)</code>。类/属性名可用显示名或 localName。</p>" +
                "<label class='field-row'><span>名称（可选）</span><input name='name' placeholder='例如：男人是人' value='" +
                escapeHtml(editing ? (existing.label || "") : "") + "'></label>" +
                "<label class='field-row swrl-rule-text-row'><span>规则语句</span>" +
                "<textarea name='rule' required rows='5' class='swrl-rule-input' placeholder='Part(?p) ^ weight(?p, ?w) ^ Vehicle(?v) ^ maxLoad(?v, ?m) ^ swrlb:lessThanOrEqual(?w, ?m) -> canCarry(?v, ?p)'>" +
                escapeHtml(initialText) + "</textarea></label>" +
                "<p id='swrl-rule-error' class='hint error-hint' hidden></p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button><button type='submit'>" +
                (editing ? "保存修改" : "保存规则") + "</button></div></form>"
            );
            var form = root.querySelector("#swrl-rule-form");
            var errorNode = form.querySelector("#swrl-rule-error");
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var data = new FormData(event.target);
                var name = String(data.get("name") || "").trim();
                var ruleText = String(data.get("rule") || "").trim();
                var built = axiomsForSwrlPresentation(name, ruleText, state.model);
                if (!built.ok) {
                    errorNode.hidden = false;
                    errorNode.textContent = built.error;
                    setStatus(built.error, true);
                    return;
                }
                errorNode.hidden = true;
                hideModal();
                var msgName = name || built.presentation || "SWRL 规则";
                if (editing) {
                    replaceAxioms([existing.axiom], built.axioms, "更新 SWRL 规则 " + msgName).then(function () {
                        setStatus("已更新 SWRL 规则「" + msgName + "」。");
                    });
                } else {
                    submitAxioms(built.axioms, "添加 SWRL 规则 " + msgName);
                }
            });
        }


        function loadConsistencyResults() {
            if (!state.projectId) {
                state.consistencyResults.latest = null;
                state.consistencyResults.history = [];
                state.consistencyResults.viewingId = null;
                renderConsistencyPane();
                return Promise.resolve(state.consistencyResults);
            }
            return fetch("/api/onto/consistency-results", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({projectId: state.projectId})
            }).then(function (response) {
                return response.text().then(function (text) {
                    var body = {};
                    try {
                        body = text ? JSON.parse(text) : {};
                    } catch (error) {
                        throw new Error("读取一致性结果失败（非 JSON）");
                    }
                    if (!response.ok) {
                        throw new Error(body.error || ("读取一致性结果失败（HTTP " + response.status + "）"));
                    }
                    applyConsistencyResultsPayload(body);
                    return state.consistencyResults;
                });
            }).catch(function () {
                state.consistencyResults.latest = null;
                state.consistencyResults.history = [];
                state.consistencyResults.viewingId = null;
                renderConsistencyPane();
                return state.consistencyResults;
            });
        }

        function applyConsistencyResultsPayload(body) {
            var history = Array.isArray(body && body.history) ? body.history.slice() : [];
            var latest = (body && body.latest) || (history.length ? history[0] : null);
            state.consistencyResults.latest = latest;
            state.consistencyResults.history = history;
            if (latest && latest.id) {
                state.consistencyResults.viewingId = latest.id;
            } else {
                state.consistencyResults.viewingId = null;
            }
            renderConsistencyPane();
        }

        function syncConsistencyPaneCollapsed() {
            var pane = root.querySelector("#consistency-pane");
            var button = root.querySelector("#toggle-consistency-pane");
            if (!pane) {
                return;
            }
            var collapsed = !!state.consistencyResults.collapsed;
            pane.classList.toggle("collapsed", collapsed);
            // Embedded: fully hide until user expands after a check (no prototype side strip).
            if (embedded) {
                var closed = collapsed;
                pane.classList.toggle("is-closed", closed);
                pane.hidden = closed;
            }
            if (button) {
                button.textContent = collapsed ? "展开" : "收起";
            }
        }

        function viewingConsistencyResult() {
            return state.consistencyResults.latest || null;
        }

        function formatConsistencyTime(ms) {
            if (ms == null || isNaN(Number(ms))) {
                return "—";
            }
            var d = new Date(Number(ms));
            function pad(n) {
                return n < 10 ? "0" + n : String(n);
            }
            return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
                + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
        }

        function conflictEntityLink(label, iri, kind) {
            var text = escapeHtml(label || "—");
            if (!iri || iri === "—" || iri === "-") {
                return text;
            }
            return "<a href='#' class='conflict-link' data-nav-iri='" + escapeHtml(iri)
                + "' data-nav-kind='" + escapeHtml(kind || "") + "' title='" + escapeHtml(iri) + "'>"
                + text + "</a>";
        }

        function buildConflictTableHtml(conflicts) {
            if (!conflicts || !conflicts.length) {
                return "";
            }
            return "<div class='data-table-wrap conflict-table-wrap'>" +
                "<table class='data-table conflict-table'>" +
                "<thead><tr>" +
                "<th class='col-idx'>#</th>" +
                "<th>冲突类型</th>" +
                "<th>冲突主体</th>" +
                "<th>冲突方 A</th>" +
                "<th>冲突方 B</th>" +
                "<th>原因</th>" +
                "</tr></thead><tbody>" +
                conflicts.map(function (c, idx) {
                    var subjectKind = c.subjectKind || "实体";
                    var partyKind = subjectKind === "实例" ? "类" : subjectKind;
                    return "<tr>" +
                        "<td class='col-idx'>" + (idx + 1) + "</td>" +
                        "<td>" + escapeHtml(c.type) + "</td>" +
                        "<td><span class='conflict-kind'>" + escapeHtml(subjectKind) + "</span> " +
                        conflictEntityLink(c.subject, c.subjectIri, subjectKind) + "</td>" +
                        "<td>" + conflictEntityLink(c.partyA, c.partyAIri, partyKind) + "</td>" +
                        "<td>" + conflictEntityLink(c.partyB, c.partyBIri, partyKind) + "</td>" +
                        "<td>" + escapeHtml(c.reason) + "</td>" +
                        "</tr>";
                }).join("") +
                "</tbody></table></div>";
        }

        function renderConsistencyPane() {
            var body = root.querySelector("#consistency-pane-body");
            if (!body) {
                return;
            }
            var result = viewingConsistencyResult();
            if (!result) {
                body.innerHTML = "<p class='hint'>尚未检查。点击上方「推理」后，最新结果会显示在这里。</p>";
                return;
            }
            var consistent = !!result.consistent;
            var conflicts = normalizeConsistencyConflicts(result);
            var summary = consistent
                ? "HermiT 未发现逻辑冲突。"
                : (conflicts.length
                    ? ("共 " + conflicts.length + " 处冲突，点击名称可跳转到对应类/实例。")
                    : "检测到不一致，但未能解析冲突双方。");
            var meta = [];
            if (result.revision != null) {
                meta.push("修订 " + result.revision);
            }
            if (result.axiomCount != null) {
                meta.push("公理 " + result.axiomCount);
            }
            if (result.elapsedMs != null) {
                meta.push(result.elapsedMs + " ms");
            }
            if (result.ignoredSwrlRules) {
                meta.push("忽略 SWRL " + result.ignoredSwrlRules);
            }
            body.innerHTML =
                "<div class='consistency-result consistency-pane-result'>" +
                "<div class='result-badge " + (consistent ? "ok" : "bad") + "'>"
                + (consistent ? "一致" : "不一致") + "</div>" +
                "<p class='hint'>" + summary + "</p>" +
                buildConflictTableHtml(conflicts) +
                (meta.length ? ("<p class='result-meta-line'>" + escapeHtml(meta.join(" · ")) + "</p>") : "") +
                "<p class='hint tiny'>检查时间：" + escapeHtml(formatConsistencyTime(result.checkedAt))
                + "；本体若已修改，请重新检查。</p>" +
                "</div>";
        }

        function focusTreeSelection() {
            requestAnimationFrame(function () {
                var row = root.querySelector("#tree .tree-row.is-selected");
                if (!row) {
                    return;
                }
                row.scrollIntoView({ block: "center", behavior: "smooth" });
                row.classList.remove("tree-flash");
                // Force reflow so the animation can restart.
                void row.offsetWidth;
                row.classList.add("tree-flash");
                window.setTimeout(function () {
                    row.classList.remove("tree-flash");
                }, 1400);
            });
        }

        function navigateToEntity(iri, kind) {
            if (!iri || !state.model) {
                setStatus("无法跳转：实体标识缺失。", true);
                return;
            }
            var isClass = !!(state.model.classes && state.model.classes[iri]);
            var asModel = kind === "模型" || kind === "model" || (isClass && isModelClass(iri, state.model));
            if (asModel && isClass) {
                state.mode = "instance";
                state.treePane = "class";
                state.focusModel = iri;
                state.selected = nearestMetamodelIri(iri, state.model) || OWL_THING;
                state.focusInstance = null;
                state.treeSearchHits = state.treeSearchHits || {};
                state.treeSearchHits[state.selected] = true;
                ensureTreePathOpen(state.selected);
                root.querySelectorAll("[data-mode]").forEach(function (item) {
                    item.classList.toggle("active", item.getAttribute("data-mode") === "instance");
                });
                syncChromeForMode();
                renderTree();
                renderInstanceList();
                renderDetail();
                focusTreeSelection();
                setStatus("已跳转到模型「" + entityLabel(iri) + "」。");
                return;
            }
            if (isClass || kind === "类" || kind === "class") {
                if (!isClass) {
                    setStatus("类已不存在于当前本体：" + iri, true);
                    return;
                }
                state.mode = "class";
                state.treePane = "class";
                state.selected = iri;
                state.focusInstance = null;
                state.treeSearchHits = state.treeSearchHits || {};
                state.treeSearchHits[iri] = true;
                ensureTreePathOpen(iri);
                root.querySelectorAll("[data-mode]").forEach(function (item) {
                    item.classList.toggle("active", item.getAttribute("data-mode") === "class");
                });
                syncChromeForMode();
                renderTree();
                renderDetail();
                focusTreeSelection();
                setStatus("已跳转到元模型「" + entityLabel(iri) + "」，左侧树已定位。");
                return;
            }
            setStatus("当前本体中找不到该实体，可能已被删除。", true);
        }

        function showConsistencyResultModal(body) {
            // Kept for errors; successful results go to the right pane.
            var consistent = !!(body && body.consistent);
            var conflicts = normalizeConsistencyConflicts(body);
            showModal(
                "<div id='consistency-result-form' class='consistency-result'>" +
                "<h2>一致性检查结果</h2>" +
                "<div class='result-badge " + (consistent ? "ok" : "bad") + "'>"
                + (consistent ? "一致" : "不一致") + "</div>" +
                "<p class='hint'>结果已写入右侧「一致性结果」面板，可随时回看历史记录。</p>" +
                buildConflictTableHtml(conflicts) +
                "<div class='actions'><button type='button' id='cancel'>关闭</button></div></div>"
            );
        }

        function normalizeConsistencyConflicts(body) {
            var list = [];
            var source = body;
            if (body && Array.isArray(body.conflicts)) {
                source = body;
            }
            if (source && Array.isArray(source.conflicts)) {
                source.conflicts.forEach(function (c) {
                    if (!c || typeof c !== "object") {
                        return;
                    }
                    list.push({
                        type: String(c.type || "逻辑冲突"),
                        subjectKind: String(c.subjectKind || "实体"),
                        subject: String(c.subject || "—"),
                        subjectIri: c.subjectIri ? String(c.subjectIri) : "",
                        partyA: String(c.partyA || "—"),
                        partyAIri: c.partyAIri ? String(c.partyAIri) : "",
                        partyB: String(c.partyB || "—"),
                        partyBIri: c.partyBIri ? String(c.partyBIri) : "",
                        reason: String(c.reason || "")
                    });
                });
            }
            if (list.length) {
                return list;
            }
            if (body && Array.isArray(body.issues)) {
                body.issues.forEach(function (text) {
                    var parsed = parseLegacyConsistencyIssue(String(text || ""));
                    if (parsed) {
                        list.push(parsed);
                    }
                });
            }
            return list;
        }

        function parseLegacyConsistencyIssue(text) {
            var m = text.match(/实例「([^」]+)」同时被断言为互斥类「([^」]+)」与「([^」]+)」/);
            if (m) {
                return {
                    type: "互斥类冲突",
                    subjectKind: "实例",
                    subject: m[1],
                    subjectIri: "",
                    partyA: m[2],
                    partyAIri: "",
                    partyB: m[3],
                    partyBIri: "",
                    reason: "同一实例不能同时属于两个互斥类"
                };
            }
            if (!text.trim()) {
                return null;
            }
            return {
                type: "逻辑冲突",
                subjectKind: "—",
                subject: "—",
                subjectIri: "",
                partyA: "—",
                partyAIri: "",
                partyB: "—",
                partyBIri: "",
                reason: text
            };
        }

        function runConsistencyCheck() {
            if (!state.projectId) {
                setStatus("请先选择项目。", true);
                return;
            }
            var button = root.querySelector("#check-consistency");
            if (button) {
                button.disabled = true;
            }
            showLoadingModal("正在检查一致性", "HermiT 正在检查当前本体（会忽略 SWRL 规则），请稍候…");
            setStatus("正在使用 HermiT 检查一致性…");
            fetch("/api/onto/reason/consistency", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache"
                },
                body: JSON.stringify({projectId: state.projectId})
            }).then(function (response) {
                return response.json().then(function (body) {
                    return {ok: response.ok, status: response.status, body: body};
                });
            }).then(function (result) {
                if (button) {
                    button.disabled = false;
                }
                hideModal();
                if (!result.ok || result.body.error) {
                    var err = (result.body && result.body.error) || ("检查失败（HTTP " + result.status + "）");
                    setStatus(err, true);
                    showModal(
                        "<div id='consistency-result-form' class='consistency-result'>" +
                        "<h2>一致性检查失败</h2>" +
                        "<div class='result-badge bad'>失败</div>" +
                        "<p class='hint'>" + escapeHtml(err) + "</p>" +
                        "<div class='actions'><button type='button' id='cancel'>关闭</button></div></div>"
                    );
                    return;
                }
                var elapsed = result.body.elapsedMs != null ? ("，耗时 " + result.body.elapsedMs + " ms") : "";
                var revision = result.body.revision != null ? ("，revision " + result.body.revision) : "";
                var ignored = result.body.ignoredSwrlRules
                    ? ("，已忽略 " + result.body.ignoredSwrlRules + " 条 SWRL（由 Pellet 负责）")
                    : "";
                if (result.body.consistent) {
                    setStatus("本体一致（HermiT）" + revision + elapsed + ignored + "。结果已保存在右侧面板。");
                } else {
                    setStatus("本体不一致（HermiT）" + revision + elapsed + ignored + "。详见右侧冲突表。", true);
                }
                state.consistencyResults.collapsed = false;
                var pane = root.querySelector("#consistency-pane");
                if (pane) {
                    pane.hidden = false;
                    pane.classList.remove("is-closed");
                }
                syncConsistencyPaneCollapsed();
                return loadConsistencyResults();
            }).catch(function (error) {
                if (button) {
                    button.disabled = false;
                }
                hideModal();
                var message = error.message || String(error);
                setStatus(message, true);
                showModal(
                    "<div id='consistency-result-form' class='consistency-result'>" +
                    "<h2>一致性检查失败</h2>" +
                    "<div class='result-badge bad'>失败</div>" +
                    "<p class='hint'>" + escapeHtml(message) + "</p>" +
                    "<div class='actions'><button type='button' id='cancel'>关闭</button></div></div>"
                );
            });
        }

        function loadProjects() {
            fetch("/api/onto/projects", {credentials: "include"}).then(function (response) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error("请先用管理员账号登录 WebProtégé，再打开本页。");
                }
                if (!response.ok) {
                    throw new Error("无法读取项目列表。");
                }
                return response.json();
            }).then(function (projects) {
                state.projects = projects.filter(function (project) {
                    return !project.inTrash;
                });
                var select = root.querySelector("#project");
                select.innerHTML = state.projects.map(function (project) {
                    return "<option value='" + escapeHtml(project.projectId) + "'>" + escapeHtml(project.displayName) + "</option>";
                }).join("");
                if (!state.projectId || !state.projects.some(function (project) { return project.projectId === state.projectId; })) {
                    state.projectId = state.projects.length ? state.projects[0].projectId : "";
                }
                select.value = state.projectId;
                if (state.projectId) {
                    loadOntology();
                    loadSwrlCandidates();
                    loadConsistencyResults();
                } else {
                    setStatus("没有可用项目。", true);
                }
            }).catch(function (error) {
                setStatus(error.message, true);
            });
        }

        function loadOntology() {
            setStatus("正在读取本体…");
            return fetchOntologySnapshot(state.projectId).then(function (loaded) {
                state.axioms = loaded.axioms;
                state.model = parseOntology(loaded.text);
                if (state.selected !== UNTYPED && !state.model.classes[state.selected]) {
                    state.selected = OWL_THING;
                }
                if (state.selectedProperty && !state.model.objectProperties[state.selectedProperty]) {
                    state.selectedProperty = null;
                }
                var invalidIndividuals = Object.keys(state.model.individuals).filter(function (individualIri) {
                    return !isHttpIri(individualIri);
                });
                if (invalidIndividuals.length && !state.cleaningInvalidIris) {
                    state.cleaningInvalidIris = true;
                    setStatus("发现 " + invalidIndividuals.length + " 个非法标识，正在清理…");
                    return cleanupInvalidIndividuals().then(function (result) {
                        state.cleaningInvalidIris = false;
                        if (result && result.removedIndividualsCount > 0) {
                            return loadOntology().then(function () {
                                setStatus("已清理 " + result.removedIndividualsCount + " 个非法标识（无法导出到桌面版 Protégé 的路径型 IRI）。");
                            });
                        }
                        return finishLoadOntology();
                    }).catch(function (error) {
                        state.cleaningInvalidIris = false;
                        throw error;
                    });
                }
                return finishLoadOntology();
            }).catch(function (error) {
                setStatus(error.message, true);
                throw error;
            });
        }

        function finishLoadOntology() {
            var missingParents = orphanClasses(state.model).map(function (classIri) {
                return "SubClassOf(" + iri(classIri) + " " + iri(OWL_THING) + ")";
            });
            var missingTypes = untypedIndividuals(state.model).filter(isHttpIri).map(function (individualIri) {
                return "ClassAssertion(" + iri(OWL_THING) + " " + iri(individualIri) + ")";
            });
            var missingRestrictions = missingClassRestrictionAxioms(state.model, state.axioms);
            var missingPlainLabels = missingPlainLabelAxioms(state.model, state.axioms);
            if (missingParents.length || missingTypes.length || missingRestrictions.length || missingPlainLabels.length) {
                setStatus("正在补全类归属、显示名称，以及 WebProtégé 类页需要的属性/关系限制…");
                return submitAxioms(
                    missingParents.concat(missingTypes).concat(missingRestrictions).concat(missingPlainLabels),
                    "补全类归属、显示名称与类上的属性/关系限制"
                );
            }
            var classCount = Object.keys(state.model.classes).length - 1;
            var dataCount = Object.keys(state.model.dataProperties).length;
            var objectCount = Object.keys(state.model.objectProperties).length;
            var individualCount = Object.keys(state.model.individuals).length;
            setStatus("已加载 " + classCount + " 个类，" + dataCount + " 个属性，" + objectCount + " 个关系，" + individualCount + " 个实例。");
            syncChromeForMode();
            renderTree();
            if (state.mode === "instance") {
                ensureFocusModelSelected();
                renderInstanceList();
            }
            renderDetail();
        }

        function cleanupInvalidIndividuals() {
            return fetch("/api/onto/cleanup-invalid-individuals", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({projectId: state.projectId})
            }).then(function (response) {
                if (!response.ok) {
                    return response.text().then(function (text) {
                        throw new Error("清理非法标识失败（" + response.status + "）：" + text);
                    });
                }
                return response.json();
            });
        }

        function moduleLabelOf(mode) {
            if (mode === "instance") {
                return "模型管理";
            }
            if (mode === "rules") {
                return "案例库";
            }
            return "元模型管理";
        }

        function buildBreadcrumbCrumbs() {
            var crumbs = [{label: moduleLabelOf(state.mode), iri: null, kind: "module"}];
            if (state.mode === "rules") {
                crumbs.push({label: "规则", iri: null, kind: "static"});
                return crumbs;
            }
            if (state.treePane === "relation") {
                crumbs.push({label: "关系", iri: null, kind: "static"});
                if (state.selectedProperty && state.model && state.model.objectProperties[state.selectedProperty]) {
                    crumbs.push({
                        label: labelOf(state.model.objectProperties[state.selectedProperty]),
                        iri: state.selectedProperty,
                        kind: "relation"
                    });
                }
                return crumbs;
            }
            crumbs.push({label: "要素", iri: OWL_THING, kind: "class"});
            if (!state.model || !state.selected || state.selected === OWL_THING || state.selected === UNTYPED) {
                if (state.selected === UNTYPED) {
                    crumbs.push({label: "无法挂靠", iri: UNTYPED, kind: "class"});
                }
                return crumbs;
            }
            var lineage = classLineage(state.model, state.selected).slice().reverse().filter(function (iriValue) {
                return iriValue && iriValue !== OWL_THING && iriValue !== UNTYPED;
            });
            lineage.forEach(function (iriValue) {
                var entity = state.model.classes[iriValue] || {iri: iriValue, labels: []};
                crumbs.push({label: labelOf(entity), iri: iriValue, kind: "class"});
            });
            return crumbs;
        }

        function emitSelectionChrome() {
            window.dispatchEvent(new CustomEvent("modeling-chrome", {
                detail: {
                    projectId: state.projectId,
                    mode: state.mode,
                    selectedClassIri: state.selected,
                    crumbs: buildBreadcrumbCrumbs()
                }
            }));
        }

        function syncTreeToolbar() {
            root.querySelectorAll("[data-tree-pane]").forEach(function (button) {
                button.classList.toggle("is-active", button.getAttribute("data-tree-pane") === state.treePane);
            });
            var caption = root.querySelector("#tree-title");
            if (caption) {
                if (state.mode === "rules") {
                    caption.textContent = "规则说明";
                } else if (state.treePane === "relation") {
                    caption.textContent = "对象关系";
                } else {
                    caption.textContent = state.mode === "instance" ? "知识类清单" : "要素结构";
                }
            }
            var addBtn = root.querySelector("#tree-add");
            var editBtn = root.querySelector("#tree-edit");
            var deleteBtn = root.querySelector("#tree-delete");
            var focusBtn = root.querySelector("#tree-focus");
            var canMutateClass = state.treePane === "class"
                && state.mode !== "rules"
                && state.selected
                && state.selected !== UNTYPED;
            var canEditClass = canMutateClass && state.selected !== OWL_THING;
            var canMutateRelation = state.treePane === "relation" && state.mode === "class";
            if (addBtn) {
                if (state.mode === "instance") {
                    addBtn.disabled = false;
                    addBtn.title = "新增模型";
                } else {
                    addBtn.disabled = state.mode === "rules"
                        || (state.treePane === "class" && !canMutateClass)
                        || (state.treePane === "relation" && (!state.selected || state.selected === UNTYPED));
                }
            }
            if (editBtn) {
                editBtn.disabled = state.mode === "rules"
                    || (state.treePane === "class" && !canEditClass)
                    || (state.treePane === "relation" && (!canMutateRelation || !state.selectedProperty));
            }
            if (deleteBtn) {
                deleteBtn.disabled = state.mode === "rules"
                    || (state.treePane === "class" && !canEditClass)
                    || (state.treePane === "relation" && (!canMutateRelation || !state.selectedProperty));
            }
            if (focusBtn) {
                focusBtn.disabled = state.mode === "rules";
            }
        }

        function ensureTreePathOpen(classIri) {
            if (!state.treeCollapsed) {
                state.treeCollapsed = {};
            }
            var cursor = classIri;
            var guard = 0;
            while (cursor && cursor !== OWL_THING && guard < 40) {
                guard += 1;
                var parents = namedParentsOf(state.model, cursor);
                if (!parents.length) {
                    break;
                }
                parents.forEach(function (parentIri) {
                    if (state.treeCollapsed[parentIri]) {
                        delete state.treeCollapsed[parentIri];
                    }
                });
                cursor = parents[0];
            }
            if (state.treeCollapsed[OWL_THING]) {
                delete state.treeCollapsed[OWL_THING];
            }
        }

        function selectClass(classIri, options) {
            options = options || {};
            if (!classIri) {
                return;
            }
            // 模型类不进树选中态：改到清单 focusModel
            if (isModelClass(classIri, state.model)) {
                state.focusModel = classIri;
                state.selected = nearestMetamodelIri(classIri, state.model) || OWL_THING;
                state.focusInstance = null;
                if (options.switchPane !== false) {
                    state.treePane = "class";
                }
                if (state.mode !== "instance") {
                    state.mode = "instance";
                }
                syncChromeForMode();
                ensureTreePathOpen(state.selected);
                renderTree();
                renderInstanceList();
                renderDetail();
                emitSelectionChrome();
                return;
            }
            state.selected = classIri;
            state.focusInstance = null;
            if (state.mode === "instance") {
                var modelsUnder = listModelChildren(state.model, classIri);
                // 选中具体元模型时：优先该节点下的模型；若无，再回落到全库第一个模型
                if (classIri !== OWL_THING && classIri !== UNTYPED) {
                    if (!state.focusModel || modelsUnder.indexOf(state.focusModel) < 0) {
                        state.focusModel = modelsUnder[0] || null;
                    }
                } else {
                    ensureFocusModelSelected();
                }
            } else {
                state.focusModel = null;
            }
            if (options.switchPane !== false) {
                state.treePane = "class";
            }
            syncChromeForMode();
            state.tablePage = {
                definition: 1, dataLocal: 1, dataInherited: 1, objectLocal: 1, objectInherited: 1,
                disjoint: 1, union: 1, swrlRules: 1, swrlCandidates: 1, swrlResult: 1,
                behaviorList: 1
            };
            state.tableFilter = {
                dataLocal: "", dataInherited: "", objectLocal: "", objectInherited: "",
                behaviorList: ""
            };
            ensureTreePathOpen(classIri);
            renderTree();
            if (state.mode === "instance") {
                renderInstanceList();
            }
            renderDetail();
            emitSelectionChrome();
        }

        function renderTree() {
            var tree = root.querySelector("#tree");
            if (!tree) {
                return;
            }
            syncTreeToolbar();
            if (state.mode === "rules") {
                tree.className = "tree mode-rules";
                tree.innerHTML = "<div class='hint' style='padding:12px'>SWRL 规则与类、实例写在同一本体中。" +
                    "新建/编辑时直接输入桌面 Protégé 同款语句（如 男人(?x) -> 人(?x)），保存后点「运行 SWRL」用 Pellet 推断。</div>";
                emitSelectionChrome();
                return;
            }
            if (state.treePane === "relation") {
                renderRelationTree(tree);
                emitSelectionChrome();
                return;
            }
            tree.className = "tree mode-" + state.mode;
            if (!state.treeCollapsed) {
                state.treeCollapsed = {};
            }
            var html = renderNode(OWL_THING, 0, {});
            var untyped = untypedIndividuals(state.model).filter(function (individualIri) {
                return !isHttpIri(individualIri);
            });
            if (untyped.length) {
                var bucketSelected = state.selected === UNTYPED ? " is-selected" : "";
                html += "<div class='tree-row class-row untyped" + bucketSelected + "' data-class='" + UNTYPED + "' style='--depth:0'>";
                html += "<span class='tree-twist is-leaf' aria-hidden='true'></span>";
                html += "<span class='tree-badge warn-badge'>未归类</span>";
                html += "<span class='tree-label'>无法挂靠</span>";
                html += "<span class='tree-count'>" + untyped.length + "</span>";
                html += "</div>";
            }
            tree.innerHTML = html;
            tree.querySelectorAll("[data-class]").forEach(function (node) {
                node.addEventListener("click", function () {
                    selectClass(node.getAttribute("data-class"), {switchPane: false});
                });
            });
            tree.querySelectorAll("[data-tree-twist]").forEach(function (button) {
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    var iri = button.getAttribute("data-tree-twist");
                    if (!iri) {
                        return;
                    }
                    state.treeCollapsed[iri] = !state.treeCollapsed[iri];
                    renderTree();
                });
            });
            tree.querySelectorAll("[data-tree-rename]").forEach(function (button) {
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    var editBtn = root.querySelector("#tree-edit");
                    if (editBtn && !editBtn.disabled) {
                        editBtn.click();
                    }
                });
            });
            emitSelectionChrome();
        }

        function renderRelationTree(tree) {
            tree.className = "tree mode-relation";
            var props = Object.keys(state.model.objectProperties || {}).map(function (iriValue) {
                return state.model.objectProperties[iriValue];
            }).filter(Boolean).sort(function (left, right) {
                return labelOf(left).localeCompare(labelOf(right), "zh");
            });
            if (!props.length) {
                tree.innerHTML = "<div class='hint' style='padding:12px'>还没有对象关系。点上方「+」在当前类上添加关系。</div>";
                return;
            }
            tree.innerHTML = props.map(function (property) {
                var selected = property.iri === state.selectedProperty ? " is-selected" : "";
                var domains = (property.domains || []).filter(function (domain) {
                    return domain && domain !== OWL_THING;
                }).map(function (domain) {
                    return labelOf(state.model.classes[domain] || {iri: domain, labels: []});
                }).join("、") || "未限定";
                var range = property.ranges && property.ranges[0]
                    ? labelOf(state.model.classes[property.ranges[0]] || {iri: property.ranges[0], labels: []})
                    : "Thing";
                return "<div class='tree-row prop-row" + selected + "' data-property='" + escapeHtml(property.iri) + "' style='--depth:0'>" +
                    "<span class='tree-badge relation-badge'>关系</span>" +
                    "<span class='tree-label'>" + escapeHtml(labelOf(property)) + "</span>" +
                    "<span class='tree-meta' title='定义域 → 值域'>" + escapeHtml(domains) + " → " + escapeHtml(range) + "</span>" +
                    "</div>";
            }).join("");
            tree.querySelectorAll("[data-property]").forEach(function (node) {
                node.addEventListener("click", function () {
                    selectRelationProperty(node.getAttribute("data-property"));
                });
            });
        }

        function selectRelationProperty(propertyIri) {
            if (!propertyIri) {
                return;
            }
            state.selectedProperty = propertyIri;
            state.treePane = "relation";
            if (!state.relationTab) {
                state.relationTab = "basic";
            }
            state.relationCommentEditing = false;
            state.relationNameEditing = false;
            renderTree();
            renderDetail();
            emitSelectionChrome();
        }

        function renderNode(classIri, depth, seen) {
            if (seen[classIri]) {
                return "";
            }
            seen[classIri] = true;
            var entity = state.model.classes[classIri];
            var classLabel = labelOf(entity);
            // childrenOf already sorts siblings like Protégé (browser-text order).
            // 模型类不进树：仅导出 OWL 时作为元模型子类出现在类层次中
            var childClasses = childrenOf(state.model, classIri).slice().filter(function (childIri) {
                return !isModelClass(childIri, state.model);
            });
            var hasChildren = childClasses.length > 0;
            var collapsed = !!(state.treeCollapsed && state.treeCollapsed[classIri]);
            var selected = classIri === state.selected ? " is-selected" : "";
            var searchHit = state.treeSearchHits && state.treeSearchHits[classIri] ? " is-search-hit" : "";
            var openClass = hasChildren && !collapsed ? " is-open" : "";
            var leafClass = hasChildren ? "" : " is-leaf";
            var twist = hasChildren
                ? ("<button type='button' class='tree-twist" + (collapsed ? "" : " is-expanded") +
                    "' data-tree-twist='" + escapeHtml(classIri) + "' aria-label='" +
                    (collapsed ? "展开" : "收起") + "'></button>")
                : "<span class='tree-twist is-leaf' aria-hidden='true'></span>";
            var renameBtn = selected && classIri !== OWL_THING
                ? "<button type='button' class='tree-row-edit' data-tree-rename title='重命名' aria-label='重命名'>✎</button>"
                : "";
            var modelCountHtml = "";
            if (state.mode === "instance" && classIri !== UNTYPED) {
                var modelCount = listModelChildren(state.model, classIri).length;
                if (modelCount > 0) {
                    modelCountHtml = "<span class='tree-count' title='该元模型下的模型数'>" + modelCount + "</span>";
                }
            }
            var html = [
                "<div class='tree-row class-row" + selected + searchHit + openClass + leafClass +
                "' data-class='" + escapeHtml(classIri) + "' style='--depth:" + depth + "'>",
                twist,
                treeGlyphHtml(),
                "<span class='tree-label'>" + escapeHtml(classLabel) + "</span>",
                renameBtn,
                modelCountHtml,
                "</div>"
            ].join("");
            if (hasChildren && !collapsed) {
                childClasses.forEach(function (child) {
                    html += renderNode(child, depth + 1, seen);
                });
            }
            return html;
        }

        function constraintSelectHtml(selectedMode) {
            var mode = selectedMode || "some";
            var options = [
                {value: "some", label: "至少有一个"},
                {value: "only", label: "只能是该类型"},
                {value: "exact", label: "恰好 N 个"},
                {value: "min", label: "至少 N 个"},
                {value: "max", label: "至多 N 个"}
            ];
            return "<select name='constraint' title='约束'>" + options.map(function (option) {
                return "<option value='" + option.value + "'" + (option.value === mode ? " selected" : "") + ">" + option.label + "</option>";
            }).join("") + "</select>";
        }

        function definitionConstraintSelectHtml(selectedMode) {
            var mode = selectedMode || "value";
            var options = [
                {value: "value", label: "具体值（推荐）"},
                {value: "some", label: "至少有一个（某类型）"},
                {value: "only", label: "只能是该类型"},
                {value: "exact", label: "恰好 N 个"},
                {value: "min", label: "至少 N 个"},
                {value: "max", label: "至多 N 个"}
            ];
            return "<select name='constraint' title='约束'>" + options.map(function (option) {
                return "<option value='" + option.value + "'" + (option.value === mode ? " selected" : "") + ">" + option.label + "</option>";
            }).join("") + "</select>";
        }

        function cardinalityInputHtml(constraint) {
            var c = normalizeConstraint(constraint);
            var needsN = c.mode === "exact" || c.mode === "min" || c.mode === "max";
            return "<input name='cardinality' type='number' min='0' step='1' value='" + (c.n != null ? c.n : 1) + "' title='个数 N' class='constraint-n'" + (needsN ? "" : " hidden") + ">";
        }

        function individualOptionsHtml(rangeIri, selectedIri) {
            var targets = relationTargets(state.model, rangeIri || OWL_THING);
            if (!targets.length) {
                return "<option value=''>暂无可用实例</option>";
            }
            return targets.map(function (individualIri) {
                var individual = state.model.individuals[individualIri] || {iri: individualIri, labels: []};
                return "<option value='" + escapeHtml(individualIri) + "'" +
                    (individualIri === selectedIri ? " selected" : "") + ">" +
                    escapeHtml(labelOf(individual)) + "</option>";
            }).join("");
        }

        function datatypeOptionsHtml(selectedIri) {
            var current = selectedIri || (XSD + "string");
            return DATATYPES.map(function (type) {
                return "<option value='" + type.iri + "'" + (type.iri === current ? " selected" : "") + ">" + type.label + "</option>";
            }).join("");
        }

        function syncDefinitionRestrictionFields(form) {
            var mode = (form.querySelector("[name='constraint']") || {}).value || "value";
            var nRow = form.querySelector(".constraint-n-row");
            var nInput = form.querySelector("[name='cardinality']");
            var needsN = mode === "exact" || mode === "min" || mode === "max";
            if (nRow) {
                nRow.hidden = !needsN;
            }
            if (nInput) {
                nInput.hidden = !needsN;
            }
        }

        function definitionDataValueControlHtml(datatype, value) {
            var kind = datatypeKind(datatype);
            var rawValue = dataFieldInputValueForControl(value, datatype);
            var common = " name='valueText' class='cell-input'";
            if (kind === "boolean") {
                return "<select" + common + ">" +
                    "<option value=''" + (rawValue ? "" : " selected") + ">请选择</option>" +
                    "<option value='true'" + (rawValue === "true" ? " selected" : "") + ">是（true）</option>" +
                    "<option value='false'" + (rawValue === "false" ? " selected" : "") + ">否（false）</option>" +
                    "</select>";
            }
            if (kind === "integer") {
                return "<input type='number' step='1' inputmode='numeric'" + common +
                    " value='" + escapeHtml(rawValue) + "' placeholder='整数，如 3'>";
            }
            if (kind === "decimal") {
                return "<input type='number' step='any' inputmode='decimal'" + common +
                    " value='" + escapeHtml(rawValue) + "' placeholder='小数，如 3.14'>";
            }
            if (kind === "date") {
                return "<input type='date'" + common + " value='" + escapeHtml(rawValue) + "'>";
            }
            if (kind === "datetime") {
                var localValue = rawValue.length >= 16 ? rawValue.slice(0, 16) : rawValue;
                return "<input type='datetime-local'" + common + " value='" + escapeHtml(localValue) + "'>";
            }
            if (kind === "time") {
                var timeValue = rawValue.length >= 5 ? rawValue.slice(0, 5) : rawValue;
                return "<input type='time'" + common + " value='" + escapeHtml(timeValue) + "'>";
            }
            return "<input type='text'" + common + " value='" + escapeHtml(rawValue) + "' placeholder='输入文本'>";
        }

        function bindDefinitionDataValueControls(form) {
            var dtSelect = form.querySelector("[name='valueDatatype']");
            var host = form.querySelector("[data-def-value-host]");
            if (!dtSelect || !host) {
                return;
            }
            function refreshValueControl() {
                var previous = form.querySelector("[name='valueText']");
                var previousValue = previous ? previous.value : "";
                var datatype = dtSelect.value || (XSD + "string");
                host.innerHTML = definitionDataValueControlHtml(datatype, previousValue);
            }
            dtSelect.addEventListener("change", refreshValueControl);
        }

        function renderDefinitionRestrictionFields(form, isData, property, member) {
            var host = form.querySelector("#def-restriction-fields");
            if (!host) {
                return;
            }
            var mode = (form.querySelector("[name='constraint']") || {}).value || "value";
            var defaultRange = (property.ranges && property.ranges[0]) || (isData ? XSD + "string" : OWL_THING);
            if (mode === "value") {
                var valueMember = {
                    mode: "value",
                    filler: member && member.mode === "value" ? member.filler : defaultRange,
                    valueText: member && member.mode === "value" ? (member.valueText || "") : ""
                };
                // Keep typed value when only switching datatype inside value mode.
                var existingValue = form.querySelector("[name='valueText']");
                var existingDt = form.querySelector("[name='valueDatatype']");
                if (existingValue && member && member.mode === "value") {
                    valueMember.valueText = existingValue.value;
                }
                if (existingDt && member && member.mode === "value") {
                    valueMember.filler = existingDt.value || valueMember.filler;
                }
                host.innerHTML = definitionValueControlsHtml(isData, property, valueMember);
                bindDefinitionDataValueControls(form);
            } else {
                var typeMember = {
                    mode: mode,
                    filler: member && member.mode !== "value" && member.filler ? member.filler : defaultRange
                };
                var existingRange = form.querySelector("[name='range']");
                if (existingRange && existingRange.value && member && member.mode !== "value") {
                    typeMember.filler = existingRange.value;
                }
                host.innerHTML = definitionTypeControlsHtml(isData, property, typeMember);
                if (!isData) {
                    var rangeSelect = form.querySelector("select[name='range']");
                    if (rangeSelect) {
                        rangeSelect.value = typeMember.filler || OWL_THING;
                    }
                }
            }
            syncDefinitionRestrictionFields(form);
        }

        function readDefinitionRestrictionFromForm(form, propertyIri, isData) {
            var mode = (form.querySelector("[name='constraint']") || {}).value || "value";
            var nInput = form.querySelector("[name='cardinality']");
            var constraint = normalizeConstraint({
                mode: mode,
                n: nInput ? nInput.value : 1,
                valueText: ""
            });
            if (constraint.mode === "value") {
                if (isData) {
                    var valueInput = form.querySelector("[name='valueText']");
                    var dtSelect = form.querySelector("[name='valueDatatype']");
                    var valueText = valueInput ? String(valueInput.value || "").trim() : "";
                    var datatype = dtSelect && dtSelect.value ? dtSelect.value : (XSD + "string");
                    if (!valueText) {
                        return {error: "请填写具体取值。"};
                    }
                    var normalized = normalizeDataFieldValue(valueText, datatype);
                    if (!normalized.ok) {
                        return {error: normalized.message || "取值与类型不匹配。"};
                    }
                    return {
                        member: {
                            kind: "restriction",
                            propertyIri: propertyIri,
                            isData: true,
                            mode: "value",
                            n: null,
                            filler: datatype,
                            valueText: normalized.text
                        }
                    };
                }
                var indSelect = form.querySelector("[name='valueIndividual']");
                var individualIri = indSelect && indSelect.value ? indSelect.value : "";
                if (!individualIri) {
                    return {error: "请选择具体实例。"};
                }
                return {
                    member: {
                        kind: "restriction",
                        propertyIri: propertyIri,
                        isData: false,
                        mode: "value",
                        n: null,
                        filler: individualIri,
                        valueText: ""
                    }
                };
            }
            var rangeSelect = form.querySelector("[name='range']");
            var filler = rangeSelect && rangeSelect.value
                ? rangeSelect.value
                : (isData ? XSD + "string" : OWL_THING);
            return {
                member: {
                    kind: "restriction",
                    propertyIri: propertyIri,
                    isData: isData,
                    mode: constraint.mode,
                    n: constraint.n,
                    filler: filler,
                    valueText: ""
                }
            };
        }

        function definitionValueControlsHtml(isData, property, member) {
            var range = (property.ranges && property.ranges[0]) || (isData ? XSD + "string" : OWL_THING);
            if (isData) {
                var datatype = member && member.mode === "value" && member.filler
                    ? member.filler
                    : range;
                var valueText = member && member.valueText != null ? member.valueText : "";
                return "<label class='field-row def-value-row'><span>值类型</span><select name='valueDatatype'>" +
                    datatypeOptionsHtml(datatype) +
                    "</select></label>" +
                    "<label class='field-row def-value-row'><span>具体取值</span><span data-def-value-host>" +
                    definitionDataValueControlHtml(datatype, valueText) +
                    "</span></label>";
            }
            return "<label class='field-row def-value-row'><span>具体实例</span><select name='valueIndividual'>" +
                individualOptionsHtml(range, member && member.mode === "value" ? member.filler : "") +
                "</select></label>";
        }

        function definitionTypeControlsHtml(isData, property, member) {
            var range = (property.ranges && property.ranges[0]) || (isData ? XSD + "string" : OWL_THING);
            var selected = member && member.mode !== "value" ? (member.filler || range) : range;
            if (isData) {
                return "<label class='field-row def-type-row'><span>取值类型</span><select name='range'>" +
                    datatypeOptionsHtml(selected) + "</select></label>";
            }
            return "<label class='field-row def-type-row'><span>目标类</span><select name='range'>" +
                classOptions(state.model) + "</select></label>";
        }

        function readConstraintFromForm(form) {
            var mode = (form.querySelector("[name='constraint']") || {}).value || "some";
            var nInput = form.querySelector("[name='cardinality']");
            return normalizeConstraint({
                mode: mode,
                n: nInput ? nInput.value : 1
            });
        }

        function bindConstraintToggle(form) {
            var select = form.querySelector("[name='constraint']");
            var nInput = form.querySelector("[name='cardinality']");
            if (!select || !nInput) {
                return;
            }
            function sync() {
                var needsN = select.value === "exact" || select.value === "min" || select.value === "max";
                nInput.hidden = !needsN;
                var row = nInput.closest(".constraint-n-row");
                if (row) {
                    row.hidden = !needsN;
                }
                if (needsN && (nInput.value === "" || isNaN(parseInt(nInput.value, 10)))) {
                    nInput.value = "1";
                }
            }
            select.addEventListener("change", sync);
            sync();
        }

        function propertiesForTab(fields, tabId) {
            var classIri = state.selected;
            return {
                data: (fields.data || []).filter(function (property) {
                    return propertyTabOf(property, true, classIri, state.model) === tabId;
                }),
                object: (fields.object || []).filter(function (property) {
                    return propertyTabOf(property, false, classIri, state.model) === tabId;
                })
            };
        }

        function collectBehaviorRows(fields) {
            var packed = propertiesForTab(fields, "behavior");
            var localData = partitionClassProperties(packed.data, state.selected).local;
            var localObj = partitionClassProperties(packed.object, state.selected).local;
            var inheritedData = partitionClassProperties(packed.data, state.selected).inherited;
            var inheritedObj = partitionClassProperties(packed.object, state.selected).inherited;
            function mapRow(property, isData, inherited) {
                return {
                    property: property,
                    isData: isData,
                    inherited: !!inherited,
                    sourceIri: inherited ? fieldSourceIri(state.model, property, state.selected) : state.selected
                };
            }
            return localData.map(function (p) { return mapRow(p, true, false); })
                .concat(localObj.map(function (p) { return mapRow(p, false, false); }))
                .concat(inheritedData.map(function (p) { return mapRow(p, true, true); }))
                .concat(inheritedObj.map(function (p) { return mapRow(p, false, true); }));
        }

        function renderBehaviorListPanel(fields, options) {
            options = options || {};
            var localOnly = !!options.localOnly;
            if (!state.tableFilter) {
                state.tableFilter = {};
            }
            if (state.tableFilter.behaviorList == null) {
                state.tableFilter.behaviorList = "";
            }
            var filterQuery = state.tableFilter.behaviorList || "";
            var rows = collectBehaviorRows(fields).filter(function (row) {
                if (localOnly && row.inherited) {
                    return false;
                }
                var text = labelOf(row.property) + " " + commentOf(row.property);
                return fuzzyTextMatch(text, filterQuery);
            });
            var pageInfo = pageSlice(rows, "behaviorList");
            var body = pageInfo.rows.map(function (row, index) {
                var property = row.property;
                var name = labelOf(property);
                var desc = commentOf(property) || "暂无描述";
                var hasGraph = behaviorHasStateGraph(property, state.selected, state.model);
                var n = (pageInfo.start || 0) + index + 1;
                var seq = n < 10 ? ("0" + n) : String(n);
                var actions;
                if (row.inherited) {
                    var src = labelOf(state.model.classes[row.sourceIri] || {iri: row.sourceIri, labels: []});
                    actions = "<span class='hint'>继承自 " + escapeHtml(src) + " · 只读</span>";
                } else {
                    actions =
                        "<button type='button' class='link' data-open-behavior-sm='" + escapeHtml(property.iri) +
                        "' data-kind='" + (row.isData ? "data" : "object") + "'>编辑</button>" +
                        "<button type='button' class='danger' data-delete-behavior='" + escapeHtml(property.iri) +
                        "' data-kind='" + (row.isData ? "data" : "object") + "'>删除</button>";
                }
                return "<tr class='behavior-row" + (row.inherited ? " is-inherited" : "") + "'>" +
                    "<td class='col-seq'>" + seq + "</td>" +
                    "<td><button type='button' class='behavior-name-btn' data-open-behavior-sm='" +
                    escapeHtml(property.iri) + "' data-kind='" + (row.isData ? "data" : "object") + "'" +
                    (row.inherited ? " disabled" : "") + ">" + escapeHtml(name) + "</button>" +
                    (hasGraph ? "<span class='behavior-sm-badge'>有状态机</span>" : "") +
                    "</td>" +
                    "<td class='col-desc'>" + escapeHtml(desc) + "</td>" +
                    "<td class='col-actions'>" + actions + "</td></tr>";
            }).join("");
            var emptyMsg = filterQuery
                ? ("没有匹配「" + escapeHtml(filterQuery) + "」的行为。")
                : "还没有行为。点击「添加」创建后，再点名称或「编辑」配置状态机。";
            var pager = renderPager("behaviorList", pageInfo);
            return [
                "<div class='behavior-list-panel" + (localOnly ? " local-panel" : "") + "'>",
                localOnly
                    ? ("<div class='panel-head'><h2>行为</h2><span class='panel-count'>" + rows.length +
                        "</span>" +
                        "<div class='panel-tools'><button type='button' class='add-facet-btn' id='add-behavior'>+ 添加</button></div></div>" +
                        "<div class='local-toolbar'><form class='local-search' onsubmit='return false;'>" +
                        "<input type='search' data-table-filter='behaviorList' placeholder='输入名称搜索' value='" +
                        escapeHtml(filterQuery) + "' autocomplete='off' aria-label='搜索'>" +
                        "<button type='button' class='local-search-btn' data-local-search-btn>搜索</button>" +
                        "</form></div>")
                    : ("<p class='hint'>每条行为是本类属性；状态机保存在本类 SubClassOf 的 <code>benti:stateGraph</code> 注解中（与功能码同级）。点击名称或「编辑」打开状态机。</p>" +
                        "<div class='behavior-list-toolbar'>" +
                        "<label class='field-row catalog-search-row'><span>搜索</span>" +
                        "<input type='search' data-table-filter='behaviorList' placeholder='输入名称搜索' value='" +
                        escapeHtml(filterQuery) + "' autocomplete='off'></label>" +
                        "<button type='button' class='primary' id='add-behavior'>+ 添加</button></div>"),
                "<div class='data-table-wrap'>",
                "<table class='data-table behavior-table'>",
                "<thead><tr><th>#</th><th>行为名称</th><th>描述</th><th>操作</th></tr></thead>",
                "<tbody>" + (body || "<tr><td colspan='4' class='empty'>" + emptyMsg + "</td></tr>") + "</tbody>",
                "</table></div>",
                pager,
                "</div>"
            ].join("");
        }

        function openBehaviorStateMachine(propertyIri, isData, options) {
            options = options || {};
            var property = isData
                ? state.model.dataProperties[propertyIri]
                : state.model.objectProperties[propertyIri];
            if (!property) {
                return;
            }
            var rules = findSwrlRuleAxioms(state.axioms).map(function (axiom, index) {
                var summary = parseSwrlRuleSummary(axiom, state.model);
                return {
                    ruleId: summary.label || ("swrl-" + (index + 1)),
                    label: summary.label || ("规则 " + (index + 1)),
                    summary: summary.presentation || ""
                };
            });
            var instanceIri = options.instanceIri
                || (state.mode === "instance" ? state.focusInstance : "")
                || "";
            var instanceLabel = "";
            var currentStateId = options.currentStateId || "";
            if (instanceIri) {
                var ind = state.model.individuals[instanceIri] || {iri: instanceIri, labels: []};
                instanceLabel = options.instanceLabel || labelOf(ind);
                if (!currentStateId) {
                    var raw = "";
                    (state.model.dataAssertions || []).forEach(function (assertion) {
                        if (assertion.individual === instanceIri && assertion.property === propertyIri
                                && assertion.literal && assertion.literal.value) {
                            raw = String(assertion.literal.value);
                        }
                    });
                    currentStateId = matchBehaviorStateId(
                        listBehaviorMachineStates(property, state.selected, state.model),
                        raw
                    );
                }
            }
            window.dispatchEvent(new CustomEvent("open-class-state-machine", {
                detail: {
                    projectId: state.projectId,
                    classIri: state.selected,
                    classLabel: labelOf(state.model.classes[state.selected] || {iri: state.selected, labels: []}),
                    behaviorIri: propertyIri,
                    behaviorLabel: labelOf(property),
                    rules: rules,
                    instanceIri: instanceIri,
                    instanceLabel: instanceLabel,
                    currentStateId: currentStateId
                }
            }));
        }

        function openAddBehaviorDialog(cls, options) {
            options = options || {};
            showModal(
                "<form id='add-behavior-form'>" +
                "<h2>添加行为</h2>" +
                "<p class='hint'>填写名称与可选描述；保存后可在列表中打开状态机编辑器。</p>" +
                "<label class='field-row'><span>行为名称</span><input name='name' required placeholder='例如：目标搜索'></label>" +
                "<label class='field-row'><span>描述</span><input name='description' placeholder='可空'></label>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='submit'>创建</button></div></form>",
                {stacked: !!options.stacked}
            );
            var form = root.querySelector("#add-behavior-form");
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var data = new FormData(form);
                var name = String(data.get("name") || "").trim();
                var description = String(data.get("description") || "").trim();
                if (!name) {
                    setStatus("请填写行为名称。", true);
                    return;
                }
                hideModal();
                state.classTab = "behavior";
                var created = axiomsForBehaviorField(state.selected, name, description);
                submitAxioms(created.axioms, "为" + labelOf(cls) + "添加行为 " + name).then(function () {
                    if (typeof options.onSaved === "function") {
                        options.onSaved();
                    }
                    openBehaviorStateMachine(created.propertyIri, true);
                });
            });
        }

        function tabCount(tabId, fields) {
            if (tabId === "general" || tabId === "behavior") {
                var packed = propertiesForTab(fields, tabId);
                return packed.data.length + packed.object.length;
            }
            var items = propertiesForTab(fields, tabId);
            return items.data.length + items.object.length;
        }

        /** Prototype-aligned hero stats: 自有 / 继承 / 数据类型种数 / 合计. */
        function classFacetParamStats(fields, classIri) {
            var local = 0;
            var inherited = 0;
            var datatypeSet = {};
            function visit(list, isData) {
                (list || []).forEach(function (property) {
                    var tab = propertyTabOf(property, isData, classIri, state.model);
                    if (!tab || tab === "general") {
                        return;
                    }
                    if (propertyRoleOnClass(property, classIri) === "inherited") {
                        inherited += 1;
                    } else {
                        local += 1;
                    }
                    if (isData) {
                        var dt = (property.ranges && property.ranges[0]) || "";
                        if (dt) {
                            datatypeSet[dt] = true;
                        }
                    }
                });
            }
            visit(fields.data, true);
            visit(fields.object, false);
            return {
                local: local,
                inherited: inherited,
                datatypes: Object.keys(datatypeSet).length,
                total: local + inherited
            };
        }

        function primaryParentChipHtml(classIri) {
            var parents = namedParentsOf(state.model, classIri).filter(function (iriValue) {
                return iriValue && iriValue !== OWL_THING;
            });
            if (!parents.length) {
                return "";
            }
            var parentIri = parents[0];
            var text = labelOf(state.model.classes[parentIri] || {iri: parentIri, labels: []});
            return "<span class='meta-type-chip' title='" + escapeHtml(parentIri) + "'>" +
                escapeHtml(text) + "</span>";
        }

        function renderGeneralChip(label, removeAttr) {
            return "<span class='general-chip'>" +
                "<span class='general-chip-text'>" + escapeHtml(label) + "</span>" +
                (removeAttr
                    ? ("<button type='button' class='general-chip-x' " + removeAttr + " title='移除' aria-label='移除'>×</button>")
                    : "") +
                "</span>";
        }

        function renderGeneralPropRow(label, valueHtml, actionHtml) {
            return [
                "<div class='general-prop-row'>",
                "<span class='general-prop-dot' aria-hidden='true'></span>",
                "<span class='general-prop-label'>" + escapeHtml(label) + "</span>",
                "<div class='general-prop-value'>" + (valueHtml || "<span class='general-empty'>未设置</span>") + "</div>",
                "<div class='general-prop-action'>" + (actionHtml || "") + "</div>",
                "</div>"
            ].join("");
        }

        function renderGeneralPanel(cls) {
            var isThing = state.selected === OWL_THING;
            var members = currentDefinitionMembers();
            var equivHtml = members.length
                ? renderGeneralChip(
                    members.map(function (member) {
                        return manchesterMemberLabel(state.model, member);
                    }).filter(Boolean).join(" and "),
                    ""
                )
                : "";
            var parents = namedParentsOf(state.model, state.selected);
            var parentHtml = parents.length
                ? parents.map(function (iriValue) {
                    return renderGeneralChip(
                        labelOf(state.model.classes[iriValue] || {iri: iriValue, labels: []}),
                        ""
                    );
                }).join("")
                : renderGeneralChip("Thing", "");
            var peers = isThing ? [] : disjointPeersOf(state.model, state.selected);
            var disjointHtml = peers.map(function (peerIri) {
                return renderGeneralChip(
                    labelOf(state.model.classes[peerIri] || {iri: peerIri, labels: []}),
                    "data-remove-disjoint='" + escapeHtml(peerIri) + "'"
                );
            }).join("");
            var commentText = commentOf(cls) || "";
            var editingComment = !!state.generalCommentEditing;
            var descValue;
            var descAction;
            if (editingComment) {
                descValue =
                    "<div class='general-comment-edit'>" +
                    "<textarea id='class-comment' rows='2' placeholder='输入描述…'>" +
                    escapeHtml(commentText) + "</textarea>" +
                    "<div class='general-comment-actions'>" +
                    "<button type='button' id='cancel-class-comment'>取消</button>" +
                    "<button type='button' class='primary' id='save-class-comment'>保存</button>" +
                    "</div></div>";
                descAction = "";
            } else {
                descValue = commentText
                    ? ("<span class='general-desc-text'>" + escapeHtml(commentText) + "</span>")
                    : "<span class='general-empty'>暂无描述</span>";
                descAction = "<button type='button' class='general-icon-btn' id='edit-class-comment' title='编辑描述' aria-label='编辑描述'>" +
                    "<span class='general-icon-pencil' aria-hidden='true'></span></button>";
            }
            var addEquiv = isThing
                ? ""
                : "<button type='button' class='general-icon-btn' id='add-def-parent' title='添加等价类' aria-label='添加等价类'>" +
                    "<span class='general-icon-plus' aria-hidden='true'></span></button>";
            var addDisjoint = isThing
                ? ""
                : "<button type='button' class='general-icon-btn' id='add-disjoint' title='添加互斥类' aria-label='添加互斥类'>" +
                    "<span class='general-icon-plus' aria-hidden='true'></span></button>";
            return [
                "<section class='general-card'>",
                "<div class='general-card-head'>",
                "<span class='general-card-icon' aria-hidden='true'></span>",
                "<h2>常规属性配置</h2>",
                "</div>",
                "<div class='general-prop-list'>",
                renderGeneralPropRow("等价类", equivHtml, addEquiv),
                renderGeneralPropRow("父类", parentHtml, ""),
                renderGeneralPropRow("互斥类", disjointHtml, addDisjoint),
                renderGeneralPropRow("描述", descValue, descAction),
                "</div>",
                "</section>"
            ].join("");
        }

        function renderClassTabBody(cls, fields, tabId) {
            if (tabId === "general") {
                return renderGeneralPanel(cls);
            }
            if (tabId === "behavior") {
                var behaviorPacked = propertiesForTab(fields, "behavior");
                var behaviorDataParts = partitionClassProperties(behaviorPacked.data, state.selected);
                var behaviorObjParts = partitionClassProperties(behaviorPacked.object, state.selected);
                var behaviorInherited = [];
                (behaviorDataParts.inherited || []).forEach(function (property) {
                    behaviorInherited.push({property: property, isData: true});
                });
                (behaviorObjParts.inherited || []).forEach(function (property) {
                    behaviorInherited.push({property: property, isData: false});
                });
                return [
                    "<div class='facet-split'>",
                    "<div class='facet-main'>",
                    renderBehaviorListPanel(fields, {localOnly: true}),
                    "</div>",
                    renderInheritedFacetPanel("behavior", behaviorInherited),
                    "</div>"
                ].join("");
            }
            var packed = propertiesForTab(fields, tabId);
            var dataParts = partitionClassProperties(packed.data, state.selected);
            var objParts = partitionClassProperties(packed.object, state.selected);
            var showData = tabId !== "relation";
            var showObject = tabId === "relation" || packed.object.length > 0;
            var inheritedRows = [];
            if (showData) {
                (dataParts.inherited || []).forEach(function (property) {
                    inheritedRows.push({property: property, isData: true});
                });
            }
            if (showObject) {
                (objParts.inherited || []).forEach(function (property) {
                    inheritedRows.push({property: property, isData: false});
                });
            }
            return [
                "<div class='facet-split'>",
                "<div class='facet-main'>",
                showData ? renderPropertyTable(dataParts.local, true, "local", tabId) : "",
                showObject ? renderPropertyTable(objParts.local, false, "local", tabId) : "",
                "</div>",
                renderInheritedFacetPanel(tabId, inheritedRows),
                "</div>"
            ].join("");
        }

        function typePillHtml(rangeIri, isData) {
            if (!isData) {
                var classLabel = labelOf(state.model.classes[rangeIri] || {iri: rangeIri || OWL_THING, labels: []});
                return "<span class='type-pill type-obj'><i></i>" + escapeHtml(classLabel) + "</span>";
            }
            var kind = datatypeKind(rangeIri);
            var tone = kind === "decimal" || kind === "integer" ? "num"
                : (kind === "boolean" ? "bool" : "str");
            return "<span class='type-pill type-" + tone + "'><i></i>" + escapeHtml(datatypeLabel(rangeIri)) + "</span>";
        }

        function renderInheritedFacetPanel(tabId, rows) {
            rows = rows || [];
            var facetName = facetLabel(tabId) || "属性";
            var filterKey = "inheritedFacet:" + tabId;
            if (!state.tableFilter) {
                state.tableFilter = {};
            }
            if (state.tableFilter[filterKey] == null) {
                state.tableFilter[filterKey] = "";
            }
            if (!state.inheritedGroupOpen) {
                state.inheritedGroupOpen = {};
            }
            var filterQuery = state.tableFilter[filterKey] || "";
            var filtered = rows.filter(function (row) {
                return fuzzyTextMatch(propertySearchText(state.model, row.property, row.isData), filterQuery);
            });
            var groupsMap = {};
            var groupOrder = [];
            filtered.forEach(function (row) {
                var sourceIri = fieldSourceIri(state.model, row.property, state.selected) || OWL_THING;
                if (!groupsMap[sourceIri]) {
                    groupsMap[sourceIri] = [];
                    groupOrder.push(sourceIri);
                }
                groupsMap[sourceIri].push(row);
            });
            // Prefer ancestor order (near → far): reverse lineage of current class.
            var lineage = classLineage(state.model, state.selected) || [];
            groupOrder.sort(function (a, b) {
                var ia = lineage.indexOf(a);
                var ib = lineage.indexOf(b);
                if (ia < 0 && ib < 0) {
                    return labelOf(state.model.classes[a] || {iri: a, labels: []})
                        .localeCompare(labelOf(state.model.classes[b] || {iri: b, labels: []}), "zh");
                }
                if (ia < 0) {
                    return 1;
                }
                if (ib < 0) {
                    return -1;
                }
                return ia - ib;
            });
            var sourceCount = groupOrder.length;
            var totalCount = filtered.length;
            var allCount = rows.length;
            var showFunction = tabId === "function";
            var showBehavior = tabId === "behavior";
            var groupsHtml = groupOrder.map(function (sourceIri) {
                var groupKey = tabId + "::" + sourceIri;
                var open = state.inheritedGroupOpen[groupKey] !== false;
                var sourceLabel = labelOf(state.model.classes[sourceIri] || {iri: sourceIri, labels: []});
                var items = groupsMap[sourceIri];
                var body = items.map(function (row) {
                    var property = row.property;
                    var range = (property.ranges && property.ranges[0]) || "";
                    var third;
                    if (showFunction) {
                        var code = functionCodeOf(property, sourceIri, state.model) || "";
                        var preview = code
                            ? escapeHtml(code.length > 40 ? code.slice(0, 40) + "…" : code)
                            : "—";
                        third = "<td class='inh-code' title='" + escapeHtml(code) + "'><code>" + preview + "</code></td>";
                    } else if (showBehavior) {
                        var desc = commentOf(property) || "—";
                        var hasGraph = behaviorHasStateGraph(property, state.selected, state.model);
                        third = "<td class='inh-unit'>" + escapeHtml(desc) +
                            (hasGraph ? " <span class='behavior-sm-badge'>有状态机</span>" : "") + "</td>";
                    } else if (tabId === "relation") {
                        third = "<td>" + typePillHtml(range, false) + "</td>";
                    } else {
                        third = "<td class='inh-unit'>" + escapeHtml(property.uiUnit || "—") + "</td>";
                    }
                    var typeCell = showFunction || showBehavior || tabId === "relation"
                        ? ""
                        : ("<td>" + typePillHtml(range, true) + "</td>");
                    return "<tr>" +
                        "<td class='inh-name'>" + escapeHtml(labelOf(property)) + "</td>" +
                        typeCell +
                        third +
                        "</tr>";
                }).join("");
                return [
                    "<section class='inh-group" + (open ? " is-open" : "") + "' data-inh-group='" + escapeHtml(groupKey) + "'>",
                    "<button type='button' class='inh-group-head' data-inh-toggle='" + escapeHtml(groupKey) + "'>",
                    "<span class='inh-caret' aria-hidden='true'></span>",
                    "<span class='inh-source'>" + escapeHtml(sourceLabel) + "</span>",
                    "<span class='inh-group-count'>" + items.length + " 项</span>",
                    "</button>",
                    "<div class='inh-group-body'" + (open ? "" : " hidden") + ">",
                    "<table class='inh-table'>",
                    "<tbody>" + body + "</tbody>",
                    "</table>",
                    "</div>",
                    "</section>"
                ].join("");
            }).join("");
            var emptyHtml = filterQuery
                ? ("<p class='inh-empty'>没有匹配「" + escapeHtml(filterQuery) + "」的继承项。</p>")
                : "<p class='inh-empty'>暂无继承的" + escapeHtml(facetName) + "。上级要素配置后会出现在这里。</p>";
            var headCols = showFunction
                ? ("<th>名称</th><th>功能代码</th>")
                : (showBehavior
                    ? ("<th>名称</th><th>描述</th>")
                    : (tabId === "relation"
                        ? ("<th>关系名称</th><th>目标类</th>")
                        : ("<th>" + escapeHtml(facetName) + "名称</th><th>数据类型</th><th>量纲</th>")));
            return [
                "<div class='facet-inherited inherited-card'>",
                "<div class='inh-card-head'>",
                "<div class='inh-card-title'><span class='inh-icon' aria-hidden='true'></span>",
                "<strong>继承的" + escapeHtml(facetName) + "</strong></div>",
                "<span class='inh-card-stats'>" + totalCount + " 项 · " + sourceCount + " 个来源</span>",
                "</div>",
                "<form class='inh-search' data-inh-search-form='" + escapeHtml(filterKey) + "' onsubmit='return false;'>",
                "<input type='search' data-table-filter='" + escapeHtml(filterKey) + "' value='" +
                escapeHtml(filterQuery) + "' placeholder='输入名称搜索' autocomplete='off'>",
                "<button type='button' class='inh-search-btn'>搜索</button>",
                "</form>",
                allCount
                    ? ("<div class='inh-table-head'><table class='inh-table'><thead><tr>" + headCols +
                        "</tr></thead></table></div>" +
                        "<div class='inh-groups'>" + (groupsHtml || emptyHtml) + "</div>")
                    : emptyHtml,
                "<div class='inh-card-foot'>",
                "<span>共 " + (filterQuery ? totalCount + " / " + allCount : allCount) + " 条</span>",
                "<span class='inh-foot-hint'>继承自上级要素</span>",
                "</div>",
                "</div>"
            ].join("");
        }

        function instanceListQuery() {
            var input = root.querySelector("#instance-list-filter");
            return input ? String(input.value || "").trim() : "";
        }

        function currentMetamodelIri() {
            var metaIri = state.selected;
            if (isModelClass(metaIri, state.model)) {
                metaIri = nearestMetamodelIri(metaIri, state.model) || OWL_THING;
            }
            return metaIri;
        }

        function renderInstanceList() {
            var list = root.querySelector("#instance-list");
            var title = root.querySelector("#instance-list-title");
            var addBtn = root.querySelector("#add-individual");
            if (!list) {
                return;
            }
            if (state.mode !== "instance") {
                return;
            }
            var metaIri = currentMetamodelIri();
            var filterByMeta = metaIri && metaIri !== UNTYPED && metaIri !== OWL_THING
                && isMetamodelClass(metaIri, state.model);
            // 未选具体元模型时展示全库模型，避免进入「模型管理」后清单空白
            var allModels = filterByMeta
                ? listModelChildren(state.model, metaIri)
                : listAllModelClasses(state.model);
            var modelQuery = instanceListQuery();
            var filteredModels = allModels.filter(function (iriValue) {
                return fuzzyTextMatch(labelOf(state.model.classes[iriValue] || {iri: iriValue, labels: []}), modelQuery);
            });
            if (title) {
                title.textContent = (filterByMeta ? "知识本体清单" : "全部模型") + " · " + allModels.length;
            }
            if (addBtn) {
                addBtn.disabled = state.selected === UNTYPED || isModelClass(state.selected, state.model);
            }
            if (state.focusModel && allModels.indexOf(state.focusModel) < 0) {
                state.focusModel = filteredModels[0] || allModels[0] || null;
            }
            if (!state.focusModel && filteredModels.length) {
                state.focusModel = filteredModels[0];
            }
            if (!filteredModels.length) {
                list.innerHTML = "<p class='empty instance-list-empty'>" +
                    (modelQuery
                        ? "没有匹配的模型。"
                        : (filterByMeta
                            ? "该元模型下还没有模型。点「新增」创建。"
                            : "还没有任何模型。点「新增」创建（可先在左侧选择元模型）。")) +
                    "</p>";
                return;
            }
            list.innerHTML = filteredModels.map(function (iriValue, index) {
                var name = labelOf(state.model.classes[iriValue] || {iri: iriValue, labels: []});
                var parentMeta = nearestMetamodelIri(iriValue, state.model);
                var parentLabel = parentMeta
                    ? labelOf(state.model.classes[parentMeta] || {iri: parentMeta, labels: []})
                    : "";
                var selected = iriValue === state.focusModel ? " is-selected" : "";
                var searchHit = state.instanceSearchHits && state.instanceSearchHits[iriValue] ? " is-search-hit" : "";
                var n = index + 1;
                var seq = n < 10 ? ("0" + n) : String(n);
                return "<button type='button' class='instance-list-item" + selected + searchHit +
                    "' data-select-model='" + escapeHtml(iriValue) + "'>" +
                    "<span class='instance-list-seq'>" + seq + "</span>" +
                    "<span class='instance-list-dot' aria-hidden='true'></span>" +
                    "<span class='instance-list-text'>" +
                    "<span class='instance-list-name'>" + escapeHtml(name) + "</span>" +
                    (parentLabel && !filterByMeta
                        ? ("<span class='instance-list-meta'>" + escapeHtml(parentLabel) + "</span>")
                        : "") +
                    "</span></button>";
            }).join("");
            list.querySelectorAll("[data-select-model]").forEach(function (button) {
                button.addEventListener("click", function () {
                    var modelIri = button.getAttribute("data-select-model");
                    state.focusModel = modelIri;
                    var meta = nearestMetamodelIri(modelIri, state.model);
                    if (meta) {
                        state.selected = meta;
                        ensureTreePathOpen(meta);
                    }
                    renderTree();
                    renderInstanceList();
                    renderDetail();
                    emitSelectionChrome();
                });
            });
        }

        function renderRelationGeneralPanel(property) {
            var name = labelOf(property);
            var commentText = commentOf(property) || "";
            var nameValue;
            var nameAction;
            if (state.relationNameEditing) {
                nameValue =
                    "<div class='general-comment-edit'>" +
                    "<input id='relation-name-input' type='text' value='" + escapeHtml(name) + "' placeholder='关系名称'>" +
                    "<div class='general-comment-actions'>" +
                    "<button type='button' id='cancel-relation-name'>取消</button>" +
                    "<button type='button' class='primary' id='save-relation-name'>保存</button>" +
                    "</div></div>";
                nameAction = "";
            } else {
                nameValue = "<span class='general-desc-text'>" + escapeHtml(name) + "</span>";
                nameAction = "<button type='button' class='general-icon-btn' id='edit-relation-name' title='重命名' aria-label='重命名'>" +
                    "<span class='general-icon-pencil' aria-hidden='true'></span></button>";
            }
            var descValue;
            var descAction;
            if (state.relationCommentEditing) {
                descValue =
                    "<div class='general-comment-edit'>" +
                    "<textarea id='relation-comment' rows='2' placeholder='输入描述…'>" +
                    escapeHtml(commentText) + "</textarea>" +
                    "<div class='general-comment-actions'>" +
                    "<button type='button' id='cancel-relation-comment'>取消</button>" +
                    "<button type='button' class='primary' id='save-relation-comment'>保存</button>" +
                    "</div></div>";
                descAction = "";
            } else {
                descValue = commentText
                    ? ("<span class='general-desc-text'>" + escapeHtml(commentText) + "</span>")
                    : "<span class='general-empty'>暂无描述</span>";
                descAction = "<button type='button' class='general-icon-btn' id='edit-relation-comment' title='编辑描述' aria-label='编辑描述'>" +
                    "<span class='general-icon-pencil' aria-hidden='true'></span></button>";
            }
            return [
                "<section class='general-card relation-general-card'>",
                "<div class='general-card-head'>",
                "<span class='general-card-icon' aria-hidden='true'></span>",
                "<h2>常规属性配置</h2>",
                "</div>",
                "<div class='general-prop-list'>",
                renderGeneralPropRow("名称", nameValue, nameAction),
                renderGeneralPropRow("描述", descValue, descAction),
                "</div>",
                "</section>"
            ].join("");
        }

        function renderRelationBasicPanel(property) {
            var domains = (property.domains || []).filter(function (domain) {
                return domain && domain !== OWL_THING;
            });
            var domainHtml = domains.length
                ? domains.map(function (domainIri) {
                    return renderGeneralChip(
                        labelOf(state.model.classes[domainIri] || {iri: domainIri, labels: []}),
                        "data-remove-domain='" + escapeHtml(domainIri) + "'"
                    );
                }).join("")
                : "";
            var rangeIri = (property.ranges && property.ranges[0]) || OWL_THING;
            var rangeLabel = labelOf(state.model.classes[rangeIri] || {iri: rangeIri, labels: []});
            var rangeHtml = renderGeneralChip(rangeLabel, "");
            return [
                "<section class='general-card relation-basic-card'>",
                "<div class='general-card-head'>",
                "<span class='general-card-icon' aria-hidden='true'></span>",
                "<h2>基本属性配置</h2>",
                "</div>",
                "<div class='general-prop-list'>",
                renderGeneralPropRow(
                    "定义域",
                    domainHtml,
                    "<button type='button' class='general-icon-btn' id='add-relation-domain' title='添加定义域' aria-label='添加定义域'>" +
                    "<span class='general-icon-plus' aria-hidden='true'></span></button>"
                ),
                renderGeneralPropRow(
                    "值域",
                    rangeHtml,
                    "<button type='button' class='general-icon-btn' id='edit-relation-range' title='修改值域' aria-label='修改值域'>" +
                    "<span class='general-icon-pencil' aria-hidden='true'></span></button>"
                ),
                "</div>",
                "<p class='hint relation-basic-hint'>定义域：哪些要素可以拥有该关系；值域：关系指向的目标要素类型。</p>",
                "</section>"
            ].join("");
        }

        function bindRelationDetail(detail, property) {
            detail.querySelectorAll("[data-relation-tab]").forEach(function (button) {
                button.addEventListener("click", function () {
                    state.relationTab = button.getAttribute("data-relation-tab") || "basic";
                    state.relationCommentEditing = false;
                    state.relationNameEditing = false;
                    renderDetail();
                });
            });
            var renameBtn = detail.querySelector("#rename-relation");
            if (renameBtn) {
                renameBtn.addEventListener("click", function () {
                    state.relationTab = "general";
                    state.relationNameEditing = true;
                    renderDetail();
                    var input = root.querySelector("#relation-name-input");
                    if (input) {
                        input.focus();
                        input.select();
                    }
                });
            }
            var deleteBtn = detail.querySelector("#delete-relation");
            if (deleteBtn) {
                deleteBtn.addEventListener("click", function () {
                    confirmDeleteProperty(property.iri, false, {});
                });
            }
            var editName = detail.querySelector("#edit-relation-name");
            if (editName) {
                editName.addEventListener("click", function () {
                    state.relationNameEditing = true;
                    renderDetail();
                    var input = root.querySelector("#relation-name-input");
                    if (input) {
                        input.focus();
                        input.select();
                    }
                });
            }
            var cancelName = detail.querySelector("#cancel-relation-name");
            if (cancelName) {
                cancelName.addEventListener("click", function () {
                    state.relationNameEditing = false;
                    renderDetail();
                });
            }
            var saveName = detail.querySelector("#save-relation-name");
            if (saveName) {
                saveName.addEventListener("click", function () {
                    var input = detail.querySelector("#relation-name-input");
                    var name = input ? String(input.value || "").trim() : "";
                    if (!name) {
                        setStatus("请填写关系名称。", true);
                        return;
                    }
                    state.relationNameEditing = false;
                    replaceAxioms(
                        findLabelAxioms(state.axioms, property.iri),
                        labelAxioms(property.iri, name),
                        "重命名关系为 " + name
                    );
                });
            }
            var editComment = detail.querySelector("#edit-relation-comment");
            if (editComment) {
                editComment.addEventListener("click", function () {
                    state.relationCommentEditing = true;
                    renderDetail();
                    var area = root.querySelector("#relation-comment");
                    if (area) {
                        area.focus();
                    }
                });
            }
            var cancelComment = detail.querySelector("#cancel-relation-comment");
            if (cancelComment) {
                cancelComment.addEventListener("click", function () {
                    state.relationCommentEditing = false;
                    renderDetail();
                });
            }
            var saveComment = detail.querySelector("#save-relation-comment");
            if (saveComment) {
                saveComment.addEventListener("click", function () {
                    var next = (detail.querySelector("#relation-comment") || {}).value || "";
                    var toDelete = findAnnotationAxioms(state.axioms, property.iri, "rdf-schema#comment")
                        .concat(findAnnotationAxioms(state.axioms, property.iri, "rdfs:comment"));
                    state.relationCommentEditing = false;
                    replaceAxioms(toDelete, commentAxioms(property.iri, next), "更新关系 " + labelOf(property) + " 的描述");
                });
            }
            var addDomain = detail.querySelector("#add-relation-domain");
            if (addDomain) {
                addDomain.addEventListener("click", function () {
                    openAddRelationDomainDialog(property);
                });
            }
            detail.querySelectorAll("[data-remove-domain]").forEach(function (button) {
                button.addEventListener("click", function () {
                    var domainIri = button.getAttribute("data-remove-domain");
                    if (!domainIri) {
                        return;
                    }
                    var toDelete = findPropertyDomainAxioms(state.axioms, property.iri, false, domainIri);
                    if (!toDelete.length) {
                        setStatus("未找到该定义域公理。", true);
                        return;
                    }
                    var domainLabel = labelOf(state.model.classes[domainIri] || {iri: domainIri, labels: []});
                    replaceAxioms(toDelete, [], "从关系 " + labelOf(property) + " 移除定义域 " + domainLabel);
                });
            });
            var editRange = detail.querySelector("#edit-relation-range");
            if (editRange) {
                editRange.addEventListener("click", function () {
                    openEditRelationRangeDialog(property);
                });
            }
        }

        function openAddRelationDomainDialog(property) {
            var used = {};
            (property.domains || []).forEach(function (domainIri) {
                used[domainIri] = true;
            });
            var options = Object.keys(state.model.classes).filter(function (classIri) {
                return classIri !== OWL_THING && !used[classIri];
            }).map(function (classIri) {
                return "<option value='" + escapeHtml(classIri) + "'>" +
                    escapeHtml(labelOf(state.model.classes[classIri])) + "</option>";
            }).join("");
            if (!options) {
                setStatus("没有可添加的定义域类。", true);
                return;
            }
            showModal(
                "<form id='add-relation-domain-form'><h2>添加定义域</h2>" +
                "<p class='hint'>定义域表示：具有该关系取值的个体，属于所选要素类。</p>" +
                "<label class='field-row'><span>要素类</span><select name='domain' required>" + options + "</select></label>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='submit'>添加</button></div></form>"
            );
            var form = root.querySelector("#add-relation-domain-form");
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var domainIri = String(new FormData(form).get("domain") || "").trim();
                if (!domainIri) {
                    return;
                }
                hideModal();
                var axiom = "ObjectPropertyDomain(" + iri(property.iri) + " " + iri(domainIri) + ")";
                var domainLabel = labelOf(state.model.classes[domainIri] || {iri: domainIri, labels: []});
                submitAxioms([axiom], "为关系 " + labelOf(property) + " 添加定义域 " + domainLabel);
            });
        }

        function openEditRelationRangeDialog(property) {
            var currentRange = (property.ranges && property.ranges[0]) || OWL_THING;
            showModal(
                "<form id='edit-relation-range-form'><h2>修改值域</h2>" +
                "<p class='hint'>值域表示：该关系指向的目标要素类型。</p>" +
                "<label class='field-row'><span>目标类</span><select name='range' required>" +
                "<option value='" + escapeHtml(OWL_THING) + "'>Thing</option>" +
                classOptions(state.model) + "</select></label>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='submit'>保存</button></div></form>"
            );
            var form = root.querySelector("#edit-relation-range-form");
            var select = form.querySelector("select[name='range']");
            if (select) {
                select.value = currentRange;
            }
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var rangeIri = String(new FormData(form).get("range") || "").trim() || OWL_THING;
                hideModal();
                if (rangeIri === currentRange) {
                    return;
                }
                var toDelete = findPropertyRangeAxioms(state.axioms, property.iri, false);
                var toAdd = ["ObjectPropertyRange(" + iri(property.iri) + " " + iri(rangeIri) + ")"];
                var rangeLabel = labelOf(state.model.classes[rangeIri] || {iri: rangeIri, labels: []});
                replaceAxioms(toDelete, toAdd, "更新关系 " + labelOf(property) + " 的值域为 " + rangeLabel);
            });
        }

        function renderRelationDetail(detail) {
            if (!state.selectedProperty || !state.model.objectProperties[state.selectedProperty]) {
                detail.innerHTML =
                    "<div class='relation-empty'>" +
                    "<h2>关系</h2>" +
                    "<p class='hint'>请在左侧选择一条对象关系，查看并编辑定义域、值域与描述。</p>" +
                    "</div>";
                return;
            }
            var property = state.model.objectProperties[state.selectedProperty];
            if (!state.relationTab) {
                state.relationTab = "basic";
            }
            var domains = (property.domains || []).filter(function (domain) {
                return domain && domain !== OWL_THING;
            });
            var rangeIri = (property.ranges && property.ranges[0]) || OWL_THING;
            var rangeLabel = labelOf(state.model.classes[rangeIri] || {iri: rangeIri, labels: []});
            var domainSummary = domains.length
                ? domains.map(function (domainIri) {
                    return labelOf(state.model.classes[domainIri] || {iri: domainIri, labels: []});
                }).join("、")
                : "未限定";
            var commentText = commentOf(property);
            var body = state.relationTab === "general"
                ? renderRelationGeneralPanel(property)
                : renderRelationBasicPanel(property);
            detail.innerHTML = [
                "<div class='meta-hero relation-hero'>",
                "<div class='meta-hero-main'>",
                "<h1>" + escapeHtml(labelOf(property)) + "</h1>",
                "<p class='meta-hero-desc'>" + escapeHtml(commentText || "暂无描述") + "</p>",
                "</div>",
                "<div class='meta-hero-stats'>",
                "<div><b>" + domains.length + "</b><span>定义域</span></div>",
                "<div><b>1</b><span>值域</span></div>",
                "<div class='relation-hero-arrow'><b>" + escapeHtml(domainSummary) + "</b><span>→ " +
                escapeHtml(rangeLabel) + "</span></div>",
                "</div>",
                "<div class='card-actions'>",
                "<button type='button' id='rename-relation'>重命名</button>",
                "<button type='button' class='danger' id='delete-relation'>删除关系</button>",
                "</div>",
                "</div>",
                "<div class='class-tabs relation-tabs' role='tablist'>",
                "<button type='button' class='class-tab" + (state.relationTab === "basic" ? " active" : "") +
                "' data-relation-tab='basic'>基本</button>",
                "<button type='button' class='class-tab" + (state.relationTab === "general" ? " active" : "") +
                "' data-relation-tab='general'>常规</button>",
                "</div>",
                "<div class='class-tab-body'>" + body + "</div>"
            ].join("");
            bindRelationDetail(detail, property);
        }

        function renderDetail() {
            var detail = root.querySelector("#detail");
            if (state.mode === "rules") {
                renderRulesDetail(detail);
                return;
            }
            if (state.mode === "instance") {
                renderModelModeDetail(detail);
                return;
            }
            if (state.treePane === "relation") {
                renderRelationDetail(detail);
                return;
            }
            if (state.selected === UNTYPED) {
                renderUntypedDetail(detail);
                return;
            }
            var cls = state.model.classes[state.selected];
            var fields = fieldsOf(state.model, state.selected);
            if (state.mode === "class") {
                var canMutateClass = state.selected !== OWL_THING;
                if (!state.classTab) {
                    state.classTab = "technicalParam";
                }
                var commentText = commentOf(cls);
                var paramStats = classFacetParamStats(fields, state.selected);
                var parentChip = primaryParentChipHtml(state.selected);
                detail.innerHTML = [
                    "<div class='meta-hero'>",
                    "<div class='meta-hero-main'>",
                    "<div class='meta-hero-title-row'>",
                    "<h1>" + escapeHtml(labelOf(cls)) + "</h1>",
                    parentChip,
                    "</div>",
                    "<p class='meta-hero-desc'>" + escapeHtml(commentText || "暂无描述") + "</p>",
                    "</div>",
                    "<div class='meta-hero-stats'>",
                    "<div><b>" + paramStats.local + "</b><span>自有参数</span></div>",
                    "<div><b>" + paramStats.inherited + "</b><span>继承参数</span></div>",
                    "<div><b>" + (paramStats.datatypes || "—") + "</b><span>数据类型</span></div>",
                    "<div><b>" + paramStats.total + "</b><span>合计参数</span></div>",
                    "</div>",
                    "<div class='card-actions'>",
                    canMutateClass ? "<button type='button' id='rename-class'>重命名</button><button type='button' class='danger' id='delete-class'>删除类</button>" : "",
                    "</div>",
                    "</div>",
                    "<div class='class-tabs' role='tablist'>",
                    FACET_TABS.map(function (tab) {
                        var n = tabCount(tab.id, fields);
                        return "<button type='button' class='class-tab" + (state.classTab === tab.id ? " active" : "") +
                            "' data-class-tab='" + tab.id + "'>" + tab.label +
                            (n != null ? " <em>" + n + "</em>" : "") + "</button>";
                    }).join(""),
                    "</div>",
                    "<div class='class-tab-body'>",
                    renderClassTabBody(cls, fields, state.classTab),
                    "</div>"
                ].join("");
                bindClassTables(detail, cls, fields);
                var renameClassBtn = detail.querySelector("#rename-class");
                if (renameClassBtn) {
                    renameClassBtn.addEventListener("click", function () {
                        openRenameClassDialog();
                    });
                }
                var deleteClassBtn = detail.querySelector("#delete-class");
                if (deleteClassBtn) {
                    deleteClassBtn.addEventListener("click", function () {
                        confirmDeleteClass();
                    });
                }
                return;
            }
        }

        function renderModelModeDetail(detail) {
            if (!detail) {
                return;
            }
            renderInstanceList();
            if (state.focusModel && isModelClass(state.focusModel, state.model)) {
                renderModelConstraintEditor(detail, state.focusModel);
                return;
            }
            if (state.selected === UNTYPED || state.selected === OWL_THING
                    || !isMetamodelClass(state.selected, state.model)) {
                var anyModels = listAllModelClasses(state.model).length;
                detail.innerHTML = [
                    "<div class='meta-hero'><div class='meta-hero-main'>",
                    "<h1>模型管理</h1>",
                    "<p class='meta-hero-desc'>" +
                    (anyModels
                        ? "请在中间清单选择一个<strong>模型</strong>查看参数约束；也可点「新增」创建。"
                        : "还没有模型。点中间清单「新增」创建（将作为所选元模型的子类写入 OWL，页面以清单展示，不进类树）。") +
                    "</p>",
                    "</div></div>"
                ].join("");
                return;
            }
            var metaLabel = labelOf(state.model.classes[state.selected] || {iri: state.selected, labels: []});
            detail.innerHTML = [
                "<div class='meta-hero'><div class='meta-hero-main'>",
                "<h1>" + escapeHtml(metaLabel) + "</h1>",
                "<p class='meta-hero-desc'>该元模型下还没有模型。请在中间清单点「新增」创建（将作为子类写入 OWL，页面清单展示）。</p>",
                "</div>",
                "<div class='card-actions'>",
                "<button type='button' class='primary' id='create-model-empty'>新增模型</button>",
                "</div></div>"
            ].join("");
            var emptyCreate = detail.querySelector("#create-model-empty");
            if (emptyCreate) {
                emptyCreate.addEventListener("click", function () {
                    openCreateModelDialog(state.selected);
                });
            }
        }

        function modelConstraintValueSummary(constraint) {
            var c = normalizeConstraint(constraint);
            if (c.mode === "none" || c.mode === "some") {
                return "";
            }
            if (c.mode === "value") {
                return c.valueText || "";
            }
            if (c.mode === "enum") {
                return c.enumValues || "";
            }
            if (c.mode === "range") {
                var lo = c.minValue !== "" ? c.minValue : "−∞";
                var hi = c.maxValue !== "" ? c.maxValue : "+∞";
                return lo + " ~ " + hi;
            }
            return constraintLabel(c);
        }

        function propertyDatatypeLabel(property, isData) {
            if (!isData) {
                var rangeIri = property.ranges && property.ranges[0];
                return rangeIri
                    ? labelOf(state.model.classes[rangeIri] || {iri: rangeIri, labels: []})
                    : "Thing";
            }
            var dt = (property.ranges && property.ranges[0]) || (XSD + "string");
            return datatypeLabel(dt);
        }

        function modelConstraintModeOptions(selectedMode, isData) {
            var mode = selectedMode || "none";
            var options = [
                {value: "none", label: "未额外约束"},
                {value: "value", label: "固定值"},
                {value: "enum", label: "枚举"},
                {value: "range", label: "区间"},
                {value: "exact", label: "恰好 N 个"},
                {value: "min", label: "至少 N 个"},
                {value: "max", label: "至多 N 个"}
            ];
            if (!isData) {
                options = options.filter(function (option) {
                    return option.value !== "enum" && option.value !== "range";
                });
                options.splice(2, 0, {value: "only", label: "只能是该类型"});
            }
            return options.map(function (option) {
                return "<option value='" + option.value + "'" +
                    (option.value === mode ? " selected" : "") + ">" + option.label + "</option>";
            }).join("");
        }

        function modelConstraintParamsHtml(constraint, isData, property) {
            var c = normalizeConstraint(constraint);
            var bits = [];
            bits.push("<input name='cardinality' type='number' min='0' step='1' class='cell-input constraint-n' style='width:72px' value='" +
                (c.n != null ? c.n : 1) + "'" + ((c.mode === "exact" || c.mode === "min" || c.mode === "max") ? "" : " hidden") + ">");
            if (isData) {
                bits.push("<input name='valueText' class='cell-input' placeholder='固定值' value='" +
                    escapeHtml(c.valueText || "") + "'" + (c.mode === "value" ? "" : " hidden") + ">");
                bits.push("<input name='enumValues' class='cell-input' placeholder='枚举，用 | 分隔' value='" +
                    escapeHtml(c.enumValues || "") + "'" + (c.mode === "enum" ? "" : " hidden") + ">");
                bits.push("<input name='minValue' class='cell-input' style='width:88px' placeholder='下限' value='" +
                    escapeHtml(c.minValue || "") + "'" + (c.mode === "range" ? "" : " hidden") + ">");
                bits.push("<input name='maxValue' class='cell-input' style='width:88px' placeholder='上限' value='" +
                    escapeHtml(c.maxValue || "") + "'" + (c.mode === "range" ? "" : " hidden") + ">");
            } else {
                var rangeIri = (property.ranges && property.ranges[0]) || OWL_THING;
                bits.push("<select name='valueText' class='cell-input'" + (c.mode === "value" ? "" : " hidden") + ">" +
                    "<option value=''>选择个体</option>" +
                    individualOptionsHtml(rangeIri, c.valueText || c.filler || "") +
                    "</select>");
            }
            return "<div class='model-constraint-params'>" + bits.join(" ") + "</div>";
        }

        function renderModelConstraintEditor(detail, modelIri) {
            var modelCls = state.model.classes[modelIri] || {iri: modelIri, labels: []};
            var metaIri = nearestMetamodelIri(modelIri, state.model);
            var metaCls = state.model.classes[metaIri] || {iri: metaIri, labels: []};
            var metaLabel = labelOf(metaCls) || metaIri || "—";
            var skeleton = metaIri ? fieldsOf(state.model, metaIri) : {data: [], object: []};
            if (!state.modelTab) {
                state.modelTab = "technicalParam";
            }
            function rowsForFacet(facetId) {
                var dataRows = skeleton.data.filter(function (property) {
                    return propertyTabOf(property, true, metaIri, state.model) === facetId;
                }).map(function (property) {
                    return {property: property, isData: true};
                });
                var objectRows = skeleton.object.filter(function (property) {
                    return propertyTabOf(property, false, metaIri, state.model) === facetId;
                }).map(function (property) {
                    return {property: property, isData: false};
                });
                return dataRows.concat(objectRows);
            }
            var bodyRows = rowsForFacet(state.modelTab);
            var nameCol = (FACET_TABS.filter(function (tab) { return tab.id === state.modelTab; })[0] || {}).label
                || "名称";
            var tableBody = bodyRows.map(function (row, index) {
                var property = row.property;
                var restriction = findRestrictionOnClass(property, modelIri, "none");
                var facet = propertyTabOf(property, row.isData, metaIri, state.model) || "";
                var sourceIri = fieldSourceIri(state.model, property, metaIri) || metaIri;
                var inheritedLabel = labelOf(state.model.classes[sourceIri] || metaCls) || metaLabel;
                var n = index + 1;
                var seq = n < 10 ? ("0" + n) : String(n);
                var valueText = modelConstraintValueSummary(restriction);
                return "<tr data-property='" + escapeHtml(property.iri) + "' data-kind='" +
                    (row.isData ? "data" : "object") + "' data-facet='" + escapeHtml(facet) + "'>" +
                    "<td class='col-seq'>" + seq + "</td>" +
                    "<td><strong>" + escapeHtml(labelOf(property)) + "</strong></td>" +
                    "<td><span class='type-pill'>" + escapeHtml(propertyDatatypeLabel(property, row.isData)) + "</span></td>" +
                    "<td>" + escapeHtml(inheritedLabel) + "</td>" +
                    "<td class='col-value'>" + (valueText ? escapeHtml(valueText) : "<span class='hint'>—</span>") + "</td>" +
                    "<td>" + escapeHtml(property.uiUnit || "") + "</td>" +
                    "<td class='col-actions'><button type='button' class='link' data-edit-constraint>编辑</button></td>" +
                    "</tr>";
            }).join("");
            var emptyMsg = "该分面在元模型上还没有字段。请先到「元模型管理」添加。";
            detail.innerHTML = [
                "<div class='meta-hero instance-hero'>",
                "<div class='meta-hero-main'>",
                "<div class='meta-hero-title-row'>",
                "<h1>" + escapeHtml(labelOf(modelCls)) + "</h1>",
                "</div>",
                "<p class='meta-hero-desc'>继承元模型「" + escapeHtml(metaLabel) +
                "」的字段骨架；在此填写取值/约束。模型只出现在中间清单，导出 OWL 时写入类树。</p>",
                "</div>",
                "<div class='card-actions'>",
                "<button type='button' id='rename-model-class'>重命名</button>",
                "<button type='button' class='danger' id='delete-model-class'>删除</button>",
                "</div></div>",
                "<div class='class-tabs' role='tablist'>",
                FACET_TABS.map(function (tab) {
                    var n = tab.id === "general" ? null : rowsForFacet(tab.id).length;
                    return "<button type='button' class='class-tab" + (state.modelTab === tab.id ? " active" : "") +
                        "' data-model-tab='" + tab.id + "'>" + tab.label +
                        (n != null ? " <em>" + n + "</em>" : "") + "</button>";
                }).join(""),
                "</div>",
                "<div class='class-tab-body'>",
                state.modelTab === "general"
                    ? ("<p class='hint'>模型 IRI：<code>" + escapeHtml(modelIri) + "</code></p>" +
                        "<p class='hint'>所属元模型：" + escapeHtml(metaLabel) + "</p>")
                    : ("<div class='data-table-wrap'><table class='data-table model-constraint-table'>" +
                        "<thead><tr><th>#</th><th>" + escapeHtml(nameCol) + "名称</th><th>数据类型</th>" +
                        "<th>继承自</th><th>值</th><th>量纲</th><th>操作</th></tr></thead>" +
                        "<tbody>" + (tableBody || "<tr><td colspan='7' class='empty'>" + emptyMsg + "</td></tr>") +
                        "</tbody></table></div>"),
                "</div>"
            ].join("");
            detail.querySelectorAll("[data-model-tab]").forEach(function (button) {
                button.addEventListener("click", function () {
                    state.modelTab = button.getAttribute("data-model-tab") || "technicalParam";
                    renderModelConstraintEditor(detail, modelIri);
                });
            });
            var renameBtn = detail.querySelector("#rename-model-class");
            if (renameBtn) {
                renameBtn.addEventListener("click", function () {
                    openRenameModelDialog(modelIri);
                });
            }
            var deleteBtn = detail.querySelector("#delete-model-class");
            if (deleteBtn) {
                deleteBtn.addEventListener("click", function () {
                    openDeleteModelConfirm(modelIri, metaIri);
                });
            }
            detail.querySelectorAll("[data-edit-constraint]").forEach(function (button) {
                button.addEventListener("click", function () {
                    var row = button.closest("tr");
                    if (row) {
                        openModelFieldConstraintDialog(modelIri, row);
                    }
                });
            });
        }

        function openRenameModelDialog(modelIri) {
            var cls = state.model.classes[modelIri] || {iri: modelIri, labels: []};
            var current = labelOf(cls);
            showModal("<form id='rename-model-form'><h2>重命名模型</h2>" +
                "<label class='field-row'><span>名称</span>" +
                "<input name='name' required value='" + escapeHtml(current) + "'></label>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='submit'>保存</button></div></form>");
            root.querySelector("#rename-model-form").addEventListener("submit", function (event) {
                event.preventDefault();
                var name = new FormData(event.target).get("name").trim();
                if (!name || name === current) {
                    hideModal();
                    return;
                }
                var toDelete = findLabelAxioms(state.axioms, modelIri);
                hideModal();
                replaceAxioms(toDelete, labelAxioms(modelIri, name), "重命名模型为 " + name);
            });
        }

        function openDeleteModelConfirm(modelIri, metaIri) {
            var name = labelOf(state.model.classes[modelIri] || {iri: modelIri, labels: []});
            var toDelete = collectClassDeleteAxioms(state.model, state.axioms, modelIri);
            showModal(
                "<div id='delete-model-form'><h2>删除模型</h2>" +
                "<p>确定删除模型「" + escapeHtml(name) + "」？将移除相关公理（约 " + toDelete.length + " 条）。</p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='button' class='danger' id='confirm-delete-model'>确认删除</button></div></div>"
            );
            root.querySelector("#confirm-delete-model").addEventListener("click", function () {
                hideModal();
                setStatus("正在删除模型…");
                deleteAxioms(toDelete, "删除模型 " + name).then(function () {
                    state.focusModel = null;
                    state.selected = metaIri || OWL_THING;
                    return loadOntology();
                }).then(function () {
                    setStatus("已删除模型 " + name + "。");
                }).catch(function (error) {
                    setStatus(error.message || String(error), true);
                });
            });
        }

        function openModelFieldConstraintDialog(modelIri, row) {
            var propertyIri = row.getAttribute("data-property");
            var isData = row.getAttribute("data-kind") !== "object";
            var facet = row.getAttribute("data-facet") || "";
            var property = isData
                ? state.model.dataProperties[propertyIri]
                : state.model.objectProperties[propertyIri];
            if (!property) {
                return;
            }
            var restriction = findRestrictionOnClass(property, modelIri, "none");
            showModal([
                "<form id='model-constraint-form'>",
                "<h2>编辑「" + escapeHtml(labelOf(property)) + "」</h2>",
                "<p class='hint'>设置固定值 / 枚举 / 区间 / 基数等约束（写入模型类 Restriction）。</p>",
                "<label class='field-row'><span>约束类型</span>",
                "<select name='constraint'>" + modelConstraintModeOptions(restriction.mode, isData) + "</select></label>",
                "<div class='model-constraint-dialog-params'>" +
                modelConstraintParamsHtml(restriction, isData, property) +
                "</div>",
                "<div class='actions'><button type='button' id='cancel'>取消</button>",
                "<button type='submit' class='primary'>保存</button></div></form>"
            ].join(""));
            var form = root.querySelector("#model-constraint-form");
            var fakeRow = form;
            // Reuse sync helpers by tagging inputs on form
            form.setAttribute("data-property", propertyIri);
            form.setAttribute("data-kind", isData ? "data" : "object");
            form.setAttribute("data-facet", facet);
            var select = form.querySelector("[name='constraint']");
            if (select) {
                select.addEventListener("change", function () {
                    syncModelConstraintRow(form);
                });
            }
            syncModelConstraintRow(form);
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                hideModal();
                saveModelFieldConstraintFromRow(modelIri, form);
            });
        }

        function syncModelConstraintRow(row) {
            var mode = (row.querySelector("[name='constraint']") || {}).value || "none";
            var nInput = row.querySelector("[name='cardinality']");
            var valueInput = row.querySelector("[name='valueText']");
            var enumInput = row.querySelector("[name='enumValues']");
            var minInput = row.querySelector("[name='minValue']");
            var maxInput = row.querySelector("[name='maxValue']");
            if (nInput) {
                nInput.hidden = !(mode === "exact" || mode === "min" || mode === "max");
            }
            if (valueInput) {
                valueInput.hidden = mode !== "value";
            }
            if (enumInput) {
                enumInput.hidden = mode !== "enum";
            }
            if (minInput) {
                minInput.hidden = mode !== "range";
            }
            if (maxInput) {
                maxInput.hidden = mode !== "range";
            }
        }

        function saveModelFieldConstraintFromRow(modelIri, row) {
            var propertyIri = row.getAttribute("data-property");
            var isData = row.getAttribute("data-kind") !== "object";
            var facet = row.getAttribute("data-facet") || "";
            var property = isData
                ? state.model.dataProperties[propertyIri]
                : state.model.objectProperties[propertyIri];
            if (!property) {
                setStatus("找不到字段定义。", true);
                return;
            }
            var mode = (row.querySelector("[name='constraint']") || {}).value || "none";
            var nInput = row.querySelector("[name='cardinality']");
            var valueInput = row.querySelector("[name='valueText']");
            var enumInput = row.querySelector("[name='enumValues']");
            var minInput = row.querySelector("[name='minValue']");
            var maxInput = row.querySelector("[name='maxValue']");
            var constraint = {
                mode: mode,
                n: nInput ? parseInt(nInput.value, 10) : 1,
                valueText: valueInput ? String(valueInput.value || "").trim() : "",
                enumValues: enumInput ? String(enumInput.value || "").trim() : "",
                minValue: minInput ? String(minInput.value || "").trim() : "",
                maxValue: maxInput ? String(maxInput.value || "").trim() : ""
            };
            if (mode === "value" && !constraint.valueText) {
                setStatus("请填写固定值。", true);
                return;
            }
            if (mode === "enum" && !constraint.enumValues) {
                setStatus("请填写枚举值（用 | 分隔）。", true);
                return;
            }
            if (mode === "range" && !constraint.minValue && !constraint.maxValue) {
                setStatus("请至少填写区间下限或上限。", true);
                return;
            }
            var range = isData
                ? ((property.ranges && property.ranges[0]) || (XSD + "string"))
                : ((property.ranges && property.ranges[0]) || OWL_THING);
            var toDelete = findClassPropertyLinkAxioms(state.axioms, modelIri, propertyIri, isData).filter(function (axiom) {
                return axiom.indexOf("SubClassOf(") === 0;
            });
            var toAdd = mode === "none"
                ? []
                : classRestrictionAxiomsWithDecls(
                    modelIri,
                    propertyIri,
                    range,
                    isData,
                    constraint,
                    facet || propertyTabOf(property, isData, nearestMetamodelIri(modelIri, state.model), state.model),
                    "",
                    null
                );
            replaceAxioms(
                toDelete,
                toAdd,
                "更新模型约束「" + labelOf(property) + "」"
            );
        }

        function openCreateModelDialog(forcedMetamodelIri) {
            var parentIri = forcedMetamodelIri || state.selected;
            if (isModelClass(parentIri, state.model)) {
                parentIri = nearestMetamodelIri(parentIri, state.model);
            }
            var metamodelOptions = Object.keys(state.model.classes || {}).filter(function (iriValue) {
                return isMetamodelClass(iriValue, state.model);
            }).sort(function (left, right) {
                return labelOf(state.model.classes[left]).localeCompare(labelOf(state.model.classes[right]), "zh");
            });
            if (!metamodelOptions.length) {
                setStatus("请先在「元模型管理」中创建元模型类，再新建模型。", true);
                return;
            }
            if (!parentIri || parentIri === OWL_THING || !isMetamodelClass(parentIri, state.model)) {
                parentIri = metamodelOptions[0];
            }
            var optionsHtml = metamodelOptions.map(function (iriValue) {
                return "<option value='" + escapeHtml(iriValue) + "'" +
                    (iriValue === parentIri ? " selected" : "") + ">" +
                    escapeHtml(labelOf(state.model.classes[iriValue])) + "</option>";
            }).join("");
            showModal([
                "<form id='create-model-form'>",
                "<h2>新建模型</h2>",
                "<p class='hint'>模型将作为所选元模型的子类，并标记为 benti:uiRole = model。</p>",
                "<label class='field-row'><span>所属元模型</span>",
                "<select name='metamodel' required>" + optionsHtml + "</select></label>",
                "<label class='field-row'><span>模型名称</span>",
                "<input name='name' required placeholder='例如 某型论证模型'></label>",
                "<div class='actions'><button type='button' id='cancel'>取消</button>",
                "<button type='submit'>创建</button></div></form>"
            ].join(""));
            root.querySelector("#create-model-form").addEventListener("submit", function (event) {
                event.preventDefault();
                var data = new FormData(event.target);
                var name = String(data.get("name") || "").trim();
                var metamodel = String(data.get("metamodel") || "").trim();
                if (!name || !metamodel) {
                    return;
                }
                var created = axiomsForModelClass(metamodel, name);
                // 树停留在元模型；新模型进入中间清单
                state.selected = metamodel;
                state.focusModel = created.iri;
                hideModal();
                submitAxioms(created.axioms, "创建模型 " + name).then(function () {
                    renderInstanceList();
                    renderDetail();
                }).catch(function () { /* status already set */ });
            });
        }

        function renderUntypedDetail(detail) {
            var individuals = untypedIndividuals(state.model);
            detail.innerHTML = [
                "<h1>未指定类型</h1>",
                "<p class='hint'>没有类型的实例会自动补成 Thing 的实例，并显示在 Thing 下面。这里只保留标识不合法、无法挂靠的数据。</p>",
                "<section><h2>未指定类型的实例（" + individuals.length + "）</h2>",
                individuals.length
                    ? "<div class='cards'>" + individuals.map(renderUntypedIndividual).join("") + "</div>"
                    : "<p class='empty'>没有未指定类型的实例。</p>",
                "</section>"
            ].join("");
            detail.querySelectorAll("[data-assign-type]").forEach(function (button) {
                button.addEventListener("click", function () {
                    var card = button.closest("article");
                    var classIri = card.querySelector("select").value;
                    var individualIri = button.getAttribute("data-assign-type");
                    if (!classIri || !isHttpIri(individualIri)) {
                        setStatus("这个标识不是合法 IRI，无法指定类型，请删除后重建。", true);
                        return;
                    }
                    submitAxioms([
                        "ClassAssertion(" + iri(classIri) + " " + iri(individualIri) + ")"
                    ], "为 " + labelOf(state.model.individuals[individualIri]) + " 指定类型");
                });
            });
            detail.querySelectorAll("[data-delete-individual]").forEach(function (button) {
                button.addEventListener("click", function () {
                    confirmDeleteInstance(button.getAttribute("data-delete-individual"));
                });
            });
        }

        function renderUntypedIndividual(individualIri) {
            var individual = state.model.individuals[individualIri] || {iri: individualIri, labels: []};
            var used = usagesOf(state.model, individualIri);
            var bad = !isHttpIri(individualIri);
            var title = labelOf(individual);
            var meta = bad
                ? "<p class='card-meta bad-text'>无效标识：" + escapeHtml(individualIri) + "</p>"
                : "<p class='card-meta'>没有 ClassAssertion，默认只是 Thing</p>";
            var usage = "<p class='card-meta'>" + (used.length ? "被引用：" + escapeHtml(used.join("；")) : "目前没有被关系引用") + "</p>";
            var assign = bad
                ? ""
                : "<div class='row'><select>" + classOptions(state.model) + "</select><button type='button' data-assign-type='" + escapeHtml(individualIri) + "'>指定类型</button></div>";
            return "<article><div class='card-head'><h3>" + escapeHtml(title) + "</h3><button type='button' class='danger' data-delete-individual='" + escapeHtml(individualIri) + "'>删除</button></div>" + meta + usage + assign + "</article>";
        }

        function pageSlice(items, key) {
            var total = items.length;
            var pages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE) || 1);
            var page = state.tablePage[key] || 1;
            if (page > pages) {
                page = pages;
            }
            if (page < 1) {
                page = 1;
            }
            state.tablePage[key] = page;
            var start = (page - 1) * TABLE_PAGE_SIZE;
            return {
                page: page,
                pages: pages,
                total: total,
                start: start,
                rows: items.slice(start, start + TABLE_PAGE_SIZE)
            };
        }

        function renderPager(key, pageInfo) {
            if (!pageInfo.total && !pageInfo.matchLabel) {
                return "";
            }
            if (!pageInfo.total) {
                return "";
            }
            var info = pageInfo.matchLabel
                ? pageInfo.matchLabel + (pageInfo.total > TABLE_PAGE_SIZE ? " · 第 " + pageInfo.page + " / " + pageInfo.pages + " 页" : "")
                : ("共 " + pageInfo.total + " 条" + (pageInfo.total > TABLE_PAGE_SIZE ? " · 第 " + pageInfo.page + " / " + pageInfo.pages + " 页" : ""));
            return [
                "<div class='table-pager'>",
                "<span class='pager-info'>" + info + "</span>",
                pageInfo.total > TABLE_PAGE_SIZE
                    ? "<div class='pager-actions'>" +
                        "<button type='button' data-page-key='" + key + "' data-page='" + (pageInfo.page - 1) + "'" + (pageInfo.page <= 1 ? " disabled" : "") + ">上一页</button>" +
                        "<button type='button' data-page-key='" + key + "' data-page='" + (pageInfo.page + 1) + "'" + (pageInfo.page >= pageInfo.pages ? " disabled" : "") + ">下一页</button>" +
                      "</div>"
                    : "",
                "</div>"
            ].join("");
        }

        function renderDataTable(headers, bodyRows, emptyText) {
            if (!bodyRows) {
                return "<div class='empty panel-empty'>" + escapeHtml(emptyText) + "</div>";
            }
            return [
                "<div class='data-table-wrap'><table class='data-table'>",
                "<thead><tr>" + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead>",
                "<tbody>" + bodyRows + "</tbody>",
                "</table></div>"
            ].join("");
        }

        function manchesterMemberLabel(model, member) {
            if (!member) {
                return "";
            }
            if (member.kind === "class") {
                return labelOf(model.classes[member.iri] || {iri: member.iri, labels: []}, model);
            }
            var property = model.dataProperties[member.propertyIri]
                || model.objectProperties[member.propertyIri]
                || {iri: member.propertyIri, labels: []};
            var propName = labelOf(property, model);
            if (member.mode === "value") {
                var valueText = member.isData
                    ? String(member.valueText != null ? member.valueText : "")
                    : labelOf(model.individuals[member.filler] || {iri: member.filler, labels: []}, model);
                return propName + " value " + valueText;
            }
            var fillerName = member.isData
                ? datatypeLabel(member.filler)
                : labelOf(model.classes[member.filler] || {iri: member.filler, labels: []}, model);
            var quantifier = "some";
            if (member.mode === "only") {
                quantifier = "only";
            } else if (member.mode === "exact") {
                quantifier = "exactly " + (member.n != null ? member.n : 1);
            } else if (member.mode === "min") {
                quantifier = "min " + (member.n != null ? member.n : 1);
            } else if (member.mode === "max") {
                quantifier = "max " + (member.n != null ? member.n : 1);
            }
            return propName + " " + quantifier + " (" + fillerName + ")";
        }

        function definitionMemberLabel(member) {
            if (member.kind === "class") {
                return {
                    badge: "父类",
                    title: labelOf(state.model.classes[member.iri] || {iri: member.iri, labels: []}),
                    meta: "—"
                };
            }
            var property = state.model.dataProperties[member.propertyIri] || state.model.objectProperties[member.propertyIri] || {iri: member.propertyIri, labels: []};
            var detail;
            if (member.mode === "value") {
                if (member.isData) {
                    detail = String(member.valueText != null ? member.valueText : "") +
                        " · " + datatypeLabel(member.filler || (XSD + "string"));
                } else {
                    detail = labelOf(state.model.individuals[member.filler] || {iri: member.filler, labels: []});
                }
                return {
                    badge: member.isData ? "属性=值" : "关系=值",
                    title: labelOf(property),
                    meta: "具体值 · " + detail
                };
            }
            var rangeLabel = member.isData
                ? datatypeLabel(member.filler)
                : labelOf(state.model.classes[member.filler] || {iri: member.filler, labels: []});
            return {
                badge: member.isData ? "属性约束" : "关系约束",
                title: labelOf(property),
                meta: rangeLabel + " · " + constraintLabel({mode: member.mode, n: member.n})
            };
        }

        function currentDefinitionMembers() {
            var current = definitionOf(state.model, state.selected);
            return (current.members || []).map(function (member) {
                return JSON.parse(JSON.stringify(member));
            });
        }

        function persistClassDefinition(members, message) {
            var toDelete = findEquivalentAxioms(state.axioms, state.selected);
            if (!members.length) {
                return replaceAxioms(toDelete, [], message || ("清除 " + labelOf(state.model.classes[state.selected]) + " 的类定义"));
            }
            var axiom = equivalentClassesAxiom(state.selected, members);
            if (!axiom) {
                setStatus("无法生成类定义。", true);
                return Promise.reject(new Error("empty definition"));
            }
            return replaceAxioms(toDelete, [axiom], message || ("更新 " + labelOf(state.model.classes[state.selected]) + " 的类定义"));
        }

        function renderDefinitionTable(cls, fields) {
            if (state.selected === OWL_THING) {
                return [
                    "<section class='panel table-panel'>",
                    "<div class='panel-head'><h2>类定义</h2><span class='panel-note'>Equivalent To</span></div>",
                    "<p class='hint'>根类 Thing 不配置等价定义。</p>",
                    "</section>"
                ].join("");
            }
            var members = currentDefinitionMembers();
            var pageInfo = pageSlice(members, "definition");
            var rows = pageInfo.rows.map(function (member, offset) {
                var index = pageInfo.start + offset;
                var info = definitionMemberLabel(member);
                return "<tr>" +
                    "<td><span class='meta-chip'>" + escapeHtml(info.badge) + "</span></td>" +
                    "<td>" + escapeHtml(info.title) + "</td>" +
                    "<td>" + escapeHtml(info.meta) + "</td>" +
                    "<td class='col-actions'><button type='button' data-edit-def='" + index + "'>编辑</button>" +
                    "<button type='button' class='danger' data-delete-def='" + index + "'>移除</button></td>" +
                    "</tr>";
            }).join("");
            return [
                "<section class='panel table-panel'>",
                "<div class='panel-head'>",
                "<h2>类定义</h2><span class='panel-count'>" + members.length + "</span><span class='panel-note'>Equivalent To · 推荐具体值</span>",
                "<div class='panel-tools'>",
                "<button type='button' id='add-def-parent'>添加父类</button>",
                "<button type='button' id='add-def-restriction'>添加约束</button>",
                members.length ? "<button type='button' class='danger' id='clear-definition'>清除全部</button>" : "",
                "</div></div>",
                renderDataTable(["类型", "名称", "详情", "操作"], rows || "", "还没有定义成员，点击右上角添加。"),
                renderPager("definition", pageInfo),
                "</section>"
            ].join("");
        }

        function partitionClassProperties(properties, classIri) {
            var local = [];
            var inherited = [];
            (properties || []).forEach(function (property) {
                if (propertyRoleOnClass(property, classIri) === "inherited") {
                    inherited.push(property);
                } else {
                    // local + shared stay on this class's SubClass Of / Domain
                    local.push(property);
                }
            });
            return {local: local, inherited: inherited};
        }

        function renderPropertySections(properties, isData) {
            var parts = partitionClassProperties(properties, state.selected);
            return renderPropertyTable(parts.local, isData, "local")
                + renderPropertyTable(parts.inherited, isData, "inherited");
        }

        function renderPropertyTable(properties, isData, section, tabId) {
            properties = properties || [];
            if (!properties.length && section === "inherited") {
                return "";
            }
            var kind = isData ? "data" : "object";
            var isInherited = section === "inherited";
            var key = (tabId || kind) + (isData ? "Data" : "Obj") + (isInherited ? "Inherited" : "Local");
            var noun = isData ? "属性" : "关系";
            var title = isInherited ? ("继承" + noun) : (tabId ? facetLabel(tabId) : ("本类" + noun));
            if (!state.tableFilter) {
                state.tableFilter = {};
            }
            if (state.tableFilter[key] == null) {
                state.tableFilter[key] = "";
            }
            var filterQuery = state.tableFilter[key] || "";
            var filtered = (properties || []).filter(function (property) {
                return fuzzyTextMatch(propertySearchText(state.model, property, isData), filterQuery);
            });
            var pageInfo = pageSlice(filtered, key);
            var rows = pageInfo.rows.map(function (property) {
                var range = property.ranges[0] || "";
                var rangeLabel = isData ? datatypeLabel(range) : labelOf(state.model.classes[range] || {iri: range, labels: []});
                var role = propertyRoleOnClass(property, state.selected);
                var sourceIri = fieldSourceIri(state.model, property, state.selected);
                var sourceLabel = labelOf(state.model.classes[sourceIri] || {iri: sourceIri, labels: []});
                // Inherited constraints live on the ancestor class, not this class.
                var constraint = isInherited
                    ? findRestrictionOnClass(property, sourceIri)
                    : findRestrictionOnClass(property, state.selected);
                var rowClass = role === "inherited" ? " prop-row is-inherited" : (role === "shared" ? " prop-row is-shared" : " prop-row is-local");
                var roleChip = role === "inherited"
                    ? "<span class='meta-chip inherited-chip'>继承</span>"
                    : (role === "shared"
                        ? "<span class='meta-chip shared-chip'>共用</span>"
                        : "<span class='meta-chip local-chip'>本类</span>");
                var actions = "";
                if (role === "inherited") {
                    actions = "<span class='hint'>只读 · 请到「" + escapeHtml(sourceLabel) + "」修改</span>";
                } else if (role === "shared") {
                    actions = "<button type='button' class='danger' data-detach-property='" + escapeHtml(property.iri) +
                        "' data-kind='" + kind + "' title='只从本类解绑，不删除全局属性'>移除</button>";
                } else {
                    actions = "<button type='button' data-edit-property='" + escapeHtml(property.iri) +
                        "' data-kind='" + kind + "'>编辑</button>" +
                        "<button type='button' class='danger' data-delete-property='" + escapeHtml(property.iri) +
                        "' data-kind='" + kind + "'>删除</button>";
                }
                var sourceCell = isInherited
                    ? ("<td>" + escapeHtml(sourceLabel) + "</td>")
                    : "";
                var showFunctionCode = tabId === "function";
                var unitCell = showFunctionCode ? "" : ("<td>" + escapeHtml(property.uiUnit || "—") + "</td>");
                var rangeCell = showFunctionCode ? "" : ("<td>" + escapeHtml(rangeLabel) + "</td>");
                var codeValue = showFunctionCode
                    ? functionCodeOf(property, isInherited ? sourceIri : state.selected, state.model)
                    : "";
                var codePreview = codeValue
                    ? escapeHtml(codeValue.length > 72 ? codeValue.slice(0, 72) + "…" : codeValue)
                    : "—";
                var codeCell = showFunctionCode
                    ? ("<td class='function-code-cell' title='" + escapeHtml(codeValue || "") + "'><code>" + codePreview + "</code></td>")
                    : "";
                var constraintCell = (isInherited || showFunctionCode)
                    ? ""
                    : ("<td><span class='constraint-tag'>" + escapeHtml(constraintLabel(constraint)) + "</span></td>");
                return "<tr class='" + rowClass.trim() + "'>" +
                    "<td>" + escapeHtml(labelOf(property)) + " " + roleChip + "</td>" +
                    sourceCell +
                    rangeCell +
                    unitCell +
                    codeCell +
                    constraintCell +
                    (isInherited ? "" : "<td class='col-actions'>" + actions + "</td>") +
                    "</tr>";
            }).join("");
            var showFunctionCode = tabId === "function";
            var headers = showFunctionCode
                ? (isInherited ? ["名称", "来源类", "功能代码"] : ["名称", "功能代码", "操作"])
                : (isInherited
                    ? (isData
                        ? ["名称", "来源类", "数据类型", "量纲"]
                        : ["名称", "来源类", "目标类", "量纲"])
                    : (isData
                        ? ["名称", "数据类型", "量纲", "约束", "操作"]
                        : ["名称", "目标类", "量纲", "约束", "操作"]));
            var emptyMsg = filterQuery
                ? ("没有匹配「" + filterQuery + "」的" + noun + "。")
                : (isInherited
                    ? ("暂无从祖先类继承的" + noun + "。祖先上配置的 SubClass Of 限制会出现在这里（只读）。")
                    : ("还没有本类" + noun + "，可新建或从已有库中选用（写入本类 SubClass Of）。"));
            var tools = isInherited
                ? ""
                : ("<div class='panel-tools'><button type='button' class='add-facet-btn' data-add-facet='" +
                    escapeHtml(tabId || "") + "' data-kind='" + kind + "'>+ 添加</button></div>");
            var countLabel = filterQuery
                ? (filtered.length + " / " + properties.length)
                : String(properties.length);
            var pagerInfo = pageInfo;
            if (filterQuery && pageInfo.total) {
                // Show match count in pager via a light wrapper after re-renderPager text.
                pagerInfo = {
                    page: pageInfo.page,
                    pages: pageInfo.pages,
                    total: pageInfo.total,
                    start: pageInfo.start,
                    rows: pageInfo.rows,
                    matchLabel: "匹配 " + filtered.length + " / 共 " + properties.length + " 条"
                };
            }
            var searchBar = isInherited
                ? ("<label class='field-row panel-filter-row'><span>搜索</span>" +
                    "<input type='search' data-table-filter='" + key + "' value='" + escapeHtml(filterQuery) +
                    "' placeholder='按名称、类型模糊搜索…' autocomplete='off'></label>")
                : ("<div class='local-toolbar'>" +
                    "<form class='local-search' onsubmit='return false;'>" +
                    "<input type='search' data-table-filter='" + key + "' value='" + escapeHtml(filterQuery) +
                    "' placeholder='输入名称搜索' autocomplete='off' aria-label='搜索'>" +
                    "<button type='button' class='local-search-btn' data-local-search-btn>搜索</button>" +
                    "</form></div>");
            return [
                "<section class='panel table-panel" + (isInherited ? " inherited-panel" : " local-panel") + "'>",
                "<div class='panel-head'>",
                "<h2>" + title + "</h2><span class='panel-count'>" + countLabel + "</span>",
                isInherited ? "<span class='panel-note'>继承 · 只读</span>" : "",
                tools,
                "</div>",
                isInherited
                    ? ("<p class='hint panel-inline-hint'>只读展示祖先类上的" + noun + "限制。</p>")
                    : "",
                searchBar,
                renderDataTable(headers, rows || "", emptyMsg),
                renderPager(key, pagerInfo),
                "</section>"
            ].join("");
        }

        function renderDisjointTable(cls) {
            if (state.selected === OWL_THING) {
                return [
                    "<section class='panel table-panel'>",
                    "<div class='panel-head'><h2>互斥类</h2><span class='panel-note'>Disjoint With</span></div>",
                    "<p class='hint'>根类 Thing 不配置互斥类。</p>",
                    "</section>"
                ].join("");
            }
            var peers = disjointPeersOf(state.model, state.selected);
            var pageInfo = pageSlice(peers, "disjoint");
            var currentLabel = labelOf(cls);
            var rows = pageInfo.rows.map(function (peerIri) {
                var peer = state.model.classes[peerIri] || {iri: peerIri, labels: []};
                return "<tr>" +
                    "<td>" + escapeHtml(labelOf(peer)) + "</td>" +
                    "<td>不能同时是「" + escapeHtml(currentLabel) + "」和「" + escapeHtml(labelOf(peer)) + "」</td>" +
                    "<td class='col-actions'><button type='button' class='danger' data-remove-disjoint='" + escapeHtml(peerIri) + "'>移除</button></td>" +
                    "</tr>";
            }).join("");
            return [
                "<section class='panel table-panel'>",
                "<div class='panel-head'>",
                "<h2>互斥类</h2><span class='panel-count'>" + peers.length + "</span><span class='panel-note'>Disjoint With</span>",
                "<div class='panel-tools'>",
                "<button type='button' id='add-disjoint'>添加互斥类</button>",
                peers.length ? "<button type='button' class='danger' id='clear-disjoint'>清除全部</button>" : "",
                "</div></div>",
                renderDataTable(["互斥对象", "说明", "操作"], rows || "", "还没有互斥类。例如猫与狗互斥后，同一实例不能既是猫又是狗。"),
                renderPager("disjoint", pageInfo),
                "</section>"
            ].join("");
        }

        function memberLabelsText(memberIris) {
            return memberIris.map(function (memberIri) {
                return labelOf(state.model.classes[memberIri] || {iri: memberIri, labels: []});
            }).join("、");
        }

        function renderDisjointUnionTable(cls) {
            if (state.selected === OWL_THING) {
                return [
                    "<section class='panel table-panel'>",
                    "<div class='panel-head'><h2>完备划分</h2><span class='panel-note'>Disjoint Union Of</span></div>",
                    "<p class='hint'>根类 Thing 不配置完备划分。</p>",
                    "</section>"
                ].join("");
            }
            var members = disjointUnionMembersOf(state.model, state.selected);
            var pageInfo = pageSlice(members, "union");
            var currentLabel = labelOf(cls);
            var rows = pageInfo.rows.map(function (memberIri) {
                var member = state.model.classes[memberIri] || {iri: memberIri, labels: []};
                return "<tr>" +
                    "<td>" + escapeHtml(labelOf(member)) + "</td>" +
                    "<td>「" + escapeHtml(currentLabel) + "」由这些成员组成；成员之间两两互斥</td>" +
                    "<td class='col-actions'><button type='button' class='danger' data-remove-union='" + escapeHtml(memberIri) + "'>移除</button></td>" +
                    "</tr>";
            }).join("");
            return [
                "<section class='panel table-panel'>",
                "<div class='panel-head'>",
                "<h2>完备划分</h2><span class='panel-count'>" + members.length + "</span><span class='panel-note'>Disjoint Union Of</span>",
                "<div class='panel-tools'>",
                "<button type='button' id='add-union'>添加成员</button>",
                members.length ? "<button type='button' class='danger' id='clear-union'>清除全部</button>" : "",
                "</div></div>",
                renderDataTable(["成员", "说明", "操作"], rows || "", "还没有完备划分。添加至少 2 个成员后，表示当前类由这些类组成，且两两互斥。"),
                renderPager("union", pageInfo),
                "</section>"
            ].join("");
        }

        function bindClassTables(detail, cls, fields) {
            detail.querySelectorAll("[data-page-key]").forEach(function (button) {
                button.addEventListener("click", function () {
                    if (button.disabled) {
                        return;
                    }
                    var key = button.getAttribute("data-page-key");
                    state.tablePage[key] = parseInt(button.getAttribute("data-page"), 10) || 1;
                    renderDetail();
                });
            });
            detail.querySelectorAll("[data-table-filter]").forEach(function (input) {
                input.addEventListener("input", function () {
                    var key = input.getAttribute("data-table-filter");
                    if (!state.tableFilter) {
                        state.tableFilter = {};
                    }
                    state.tableFilter[key] = input.value || "";
                    state.tablePage[key] = 1;
                    var active = document.activeElement === input;
                    var caret = input.selectionStart;
                    renderDetail();
                    if (active) {
                        var next = root.querySelector("[data-table-filter='" + key + "']");
                        if (next) {
                            next.focus();
                            try {
                                next.setSelectionRange(caret, caret);
                            } catch (ignore) {}
                        }
                    }
                });
            });
            detail.querySelectorAll("[data-inh-toggle]").forEach(function (button) {
                button.addEventListener("click", function () {
                    var groupKey = button.getAttribute("data-inh-toggle");
                    if (!groupKey) {
                        return;
                    }
                    if (!state.inheritedGroupOpen) {
                        state.inheritedGroupOpen = {};
                    }
                    var currentlyOpen = state.inheritedGroupOpen[groupKey] !== false;
                    state.inheritedGroupOpen[groupKey] = !currentlyOpen;
                    var section = button.closest(".inh-group");
                    if (section) {
                        section.classList.toggle("is-open", !currentlyOpen);
                        var body = section.querySelector(".inh-group-body");
                        if (body) {
                            body.hidden = currentlyOpen;
                        }
                    }
                });
            });
            detail.querySelectorAll(".inh-search-btn, .local-search-btn").forEach(function (button) {
                button.addEventListener("click", function () {
                    var form = button.closest(".inh-search, .local-search");
                    var input = form && form.querySelector("[data-table-filter]");
                    if (input) {
                        input.dispatchEvent(new Event("input", {bubbles: true}));
                    }
                });
            });
            detail.querySelectorAll("[data-edit-property]").forEach(function (button) {
                button.addEventListener("click", function () {
                    openEditPropertyDialog(
                        button.getAttribute("data-edit-property"),
                        button.getAttribute("data-kind") === "data",
                        state.classTab === "function" ? {fixedFacet: "function"} : {}
                    );
                });
            });
            detail.querySelectorAll("[data-delete-property]").forEach(function (button) {
                button.addEventListener("click", function () {
                    confirmDeleteProperty(button.getAttribute("data-delete-property"), button.getAttribute("data-kind") === "data");
                });
            });
            detail.querySelectorAll("[data-detach-property]").forEach(function (button) {
                button.addEventListener("click", function () {
                    detachPropertyFromClass(button.getAttribute("data-detach-property"), button.getAttribute("data-kind") === "data");
                });
            });
            var addData = detail.querySelector("#add-data-field");
            if (addData) {
                addData.addEventListener("click", function () {
                    openAddPropertyDialog(cls, true, state.classTab);
                });
            }
            var addObject = detail.querySelector("#add-object-field");
            if (addObject) {
                addObject.addEventListener("click", function () {
                    openAddPropertyDialog(cls, false, state.classTab);
                });
            }
            detail.querySelectorAll("[data-add-facet]").forEach(function (button) {
                button.addEventListener("click", function () {
                    var facet = button.getAttribute("data-add-facet") || state.classTab;
                    if (facet === "behavior") {
                        openAddBehaviorDialog(cls);
                        return;
                    }
                    var isData = button.getAttribute("data-kind") !== "object";
                    openAddPropertyDialog(cls, isData, facet);
                });
            });
            var addBehaviorBtn = detail.querySelector("#add-behavior");
            if (addBehaviorBtn) {
                addBehaviorBtn.addEventListener("click", function () {
                    openAddBehaviorDialog(cls);
                });
            }
            detail.querySelectorAll("[data-open-behavior-sm]").forEach(function (button) {
                button.addEventListener("click", function () {
                    if (button.disabled) {
                        return;
                    }
                    openBehaviorStateMachine(
                        button.getAttribute("data-open-behavior-sm"),
                        button.getAttribute("data-kind") !== "object"
                    );
                });
            });
            detail.querySelectorAll("[data-delete-behavior]").forEach(function (button) {
                button.addEventListener("click", function () {
                    confirmDeleteProperty(
                        button.getAttribute("data-delete-behavior"),
                        button.getAttribute("data-kind") !== "object"
                    );
                });
            });
            detail.querySelectorAll("[data-class-tab]").forEach(function (button) {
                button.addEventListener("click", function () {
                    var nextTab = button.getAttribute("data-class-tab") || "technicalParam";
                    if (nextTab !== "general") {
                        state.generalCommentEditing = false;
                    }
                    state.classTab = nextTab;
                    renderDetail();
                });
            });
            var editComment = detail.querySelector("#edit-class-comment");
            if (editComment) {
                editComment.addEventListener("click", function () {
                    state.generalCommentEditing = true;
                    renderDetail();
                    var area = root.querySelector("#class-comment");
                    if (area) {
                        area.focus();
                    }
                });
            }
            var cancelComment = detail.querySelector("#cancel-class-comment");
            if (cancelComment) {
                cancelComment.addEventListener("click", function () {
                    state.generalCommentEditing = false;
                    renderDetail();
                });
            }
            var saveComment = detail.querySelector("#save-class-comment");
            if (saveComment) {
                saveComment.addEventListener("click", function () {
                    var next = (detail.querySelector("#class-comment") || {}).value || "";
                    var toDelete = findAnnotationAxioms(state.axioms, state.selected, "rdf-schema#comment")
                        .concat(findAnnotationAxioms(state.axioms, state.selected, "rdfs:comment"));
                    state.generalCommentEditing = false;
                    replaceAxioms(toDelete, commentAxioms(state.selected, next), "更新 " + labelOf(cls) + " 的描述");
                });
            }
            if (state.selected === OWL_THING) {
                return;
            }
            var addParent = detail.querySelector("#add-def-parent");
            if (addParent) {
                addParent.addEventListener("click", function () {
                    openAddDefinitionParentDialog(cls);
                });
            }
            var addRestriction = detail.querySelector("#add-def-restriction");
            if (addRestriction) {
                addRestriction.addEventListener("click", function () {
                    openAddDefinitionRestrictionDialog(cls, fields);
                });
            }
            detail.querySelectorAll("[data-edit-def]").forEach(function (button) {
                button.addEventListener("click", function () {
                    openEditDefinitionMemberDialog(parseInt(button.getAttribute("data-edit-def"), 10), cls);
                });
            });
            detail.querySelectorAll("[data-delete-def]").forEach(function (button) {
                button.addEventListener("click", function () {
                    var index = parseInt(button.getAttribute("data-delete-def"), 10);
                    var members = currentDefinitionMembers();
                    var removed = members.splice(index, 1)[0];
                    var info = definitionMemberLabel(removed || {kind: "class", iri: ""});
                    persistClassDefinition(members, "从 " + labelOf(cls) + " 的定义移除 " + info.title);
                });
            });
            var clearBtn = detail.querySelector("#clear-definition");
            if (clearBtn) {
                clearBtn.addEventListener("click", function () {
                    showModal(
                        "<div id='clear-def-form'><h2>清除类定义</h2>" +
                        "<p>确认清除「" + escapeHtml(labelOf(cls)) + "」的全部 Equivalent To 定义？不会删除属性/关系本身。</p>" +
                        "<div class='actions'><button type='button' id='cancel'>取消</button><button type='button' id='confirm-clear-def' class='danger'>确认清除</button></div></div>"
                    );
                    root.querySelector("#confirm-clear-def").addEventListener("click", function () {
                        hideModal();
                        persistClassDefinition([], "清除 " + labelOf(cls) + " 的类定义");
                    });
                });
            }
            var addDisjoint = detail.querySelector("#add-disjoint");
            if (addDisjoint) {
                addDisjoint.addEventListener("click", function () {
                    openAddDisjointDialog(cls);
                });
            }
            detail.querySelectorAll("[data-remove-disjoint]").forEach(function (button) {
                button.addEventListener("click", function () {
                    removeDisjointPeer(cls, button.getAttribute("data-remove-disjoint"));
                });
            });
            var clearDisjoint = detail.querySelector("#clear-disjoint");
            if (clearDisjoint) {
                clearDisjoint.addEventListener("click", function () {
                    showModal(
                        "<div id='clear-disjoint-form'><h2>清除互斥类</h2>" +
                        "<p>确认清除「" + escapeHtml(labelOf(cls)) + "」的全部 Disjoint With？其他类之间若仍互斥会保留。</p>" +
                        "<div class='actions'><button type='button' id='cancel'>取消</button><button type='button' id='confirm-clear-disjoint' class='danger'>确认清除</button></div></div>"
                    );
                    root.querySelector("#confirm-clear-disjoint").addEventListener("click", function () {
                        hideModal();
                        clearDisjointPeers(cls);
                    });
                });
            }
            var addUnion = detail.querySelector("#add-union");
            if (addUnion) {
                addUnion.addEventListener("click", function () {
                    openAddUnionMembersDialog(cls);
                });
            }
            detail.querySelectorAll("[data-remove-union]").forEach(function (button) {
                button.addEventListener("click", function () {
                    removeUnionMember(cls, button.getAttribute("data-remove-union"));
                });
            });
            var clearUnion = detail.querySelector("#clear-union");
            if (clearUnion) {
                clearUnion.addEventListener("click", function () {
                    showModal(
                        "<div id='clear-union-form'><h2>清除完备划分</h2>" +
                        "<p>确认清除「" + escapeHtml(labelOf(cls)) + "」的完备划分？不会删除单独添加的互斥类。</p>" +
                        "<div class='actions'><button type='button' id='cancel'>取消</button><button type='button' id='confirm-clear-union' class='danger'>确认清除</button></div></div>"
                    );
                    root.querySelector("#confirm-clear-union").addEventListener("click", function () {
                        hideModal();
                        clearUnionMembers(cls);
                    });
                });
            }
        }

        function disjointRowStatus(classIri, focusIri) {
            if (classIri === focusIri) {
                return {selectable: false, code: "current", reason: "当前类"};
            }
            if (classIri === OWL_THING) {
                return {selectable: false, code: "thing", reason: "根类不可选"};
            }
            if (disjointPeersOf(state.model, focusIri).indexOf(classIri) >= 0) {
                return {selectable: false, code: "already", reason: "已互斥"};
            }
            if (namedParentsOf(state.model, focusIri).indexOf(classIri) >= 0) {
                return {selectable: false, code: "parent", reason: "直接父类"};
            }
            if (childrenOf(state.model, focusIri).indexOf(classIri) >= 0) {
                return {selectable: false, code: "child", reason: "直接子类"};
            }
            return {selectable: true, code: "ok", reason: "可选"};
        }

        function flattenClassTree(rootIri, depth, seen, rows) {
            if (seen[rootIri]) {
                return rows;
            }
            seen[rootIri] = true;
            rows.push({iri: rootIri, depth: depth});
            childrenOf(state.model, rootIri).slice().forEach(function (childIri) {
                flattenClassTree(childIri, depth + 1, seen, rows);
            });
            return rows;
        }

        function openAddDisjointDialog(cls) {
            var focusIri = state.selected;
            var currentLabel = labelOf(cls);
            var treeRows = flattenClassTree(OWL_THING, 0, {}, []);
            var selectableCount = treeRows.filter(function (row) {
                return disjointRowStatus(row.iri, focusIri).selectable;
            }).length;
            if (!selectableCount) {
                setStatus("没有可添加的互斥类（已排除自身、Thing、已互斥类、直接父子类）。", true);
                return;
            }
            var selectedMap = {};

            showModal(
                "<form id='disjoint-form' class='disjoint-picker'>" +
                "<div class='picker-head'>" +
                "<div><h2>添加互斥类</h2>" +
                "<p class='hint'>为「" + escapeHtml(currentLabel) + "」选择不能重叠的类。同一实例不能同时属于两边。</p></div>" +
                "<label class='picker-search'><span class='sr-only'>搜索类</span>" +
                "<input type='search' id='disjoint-search' placeholder='搜索类名…' autocomplete='off'></label>" +
                "</div>" +
                "<div class='picker-toolbar'>" +
                "<span id='disjoint-filter-meta' class='picker-meta'></span>" +
                "<div class='picker-toolbar-actions'>" +
                "<button type='button' class='ghost' id='disjoint-select-visible'>全选可见可选</button>" +
                "<button type='button' class='ghost' id='disjoint-clear-selection'>清空已选</button>" +
                "</div></div>" +
                "<div class='picker-table-wrap'>" +
                "<table class='picker-table' id='disjoint-tree-table'>" +
                "<thead><tr><th class='col-check'></th><th>类</th><th>状态</th></tr></thead>" +
                "<tbody id='disjoint-tree-body'></tbody>" +
                "</table>" +
                "<p class='picker-empty hidden' id='disjoint-empty'>没有匹配的类。</p>" +
                "</div>" +
                "<div class='picker-foot'>" +
                "<div class='picker-selected'>" +
                "<div class='picker-selected-label'>已选 <strong id='disjoint-selected-count'>0</strong></div>" +
                "<div class='picker-chips' id='disjoint-chips'><span class='picker-chips-empty'>尚未选择</span></div>" +
                "</div>" +
                "<p class='hint preview-hint' id='disjoint-preview'>请至少选择一个类。</p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button><button type='submit' id='disjoint-save' disabled>保存</button></div>" +
                "</div></form>"
            );

            var form = root.querySelector("#disjoint-form");
            var searchInput = form.querySelector("#disjoint-search");
            var body = form.querySelector("#disjoint-tree-body");
            var emptyNode = form.querySelector("#disjoint-empty");
            var metaNode = form.querySelector("#disjoint-filter-meta");
            var chipsNode = form.querySelector("#disjoint-chips");
            var countNode = form.querySelector("#disjoint-selected-count");
            var previewNode = form.querySelector("#disjoint-preview");
            var saveBtn = form.querySelector("#disjoint-save");

            function selectedIris() {
                return Object.keys(selectedMap).filter(function (iriValue) {
                    return selectedMap[iriValue];
                });
            }

            function matchesQuery(label, query) {
                if (!query) {
                    return true;
                }
                return label.toLowerCase().indexOf(query) >= 0;
            }

            function visibleRows(query) {
                var matchSet = {};
                var keepAncestors = {};
                treeRows.forEach(function (row) {
                    var label = labelOf(state.model.classes[row.iri] || {iri: row.iri, labels: []});
                    if (matchesQuery(label, query)) {
                        matchSet[row.iri] = true;
                    }
                });
                if (!query) {
                    return treeRows.slice();
                }
                treeRows.forEach(function (row, index) {
                    if (!matchSet[row.iri]) {
                        return;
                    }
                    keepAncestors[row.iri] = true;
                    var depth = row.depth;
                    for (var i = index - 1; i >= 0 && depth > 0; i--) {
                        if (treeRows[i].depth < depth) {
                            keepAncestors[treeRows[i].iri] = true;
                            depth = treeRows[i].depth;
                        }
                    }
                });
                return treeRows.filter(function (row) {
                    return keepAncestors[row.iri];
                });
            }

            function highlightLabel(label, query) {
                var safe = escapeHtml(label);
                if (!query) {
                    return safe;
                }
                var lower = label.toLowerCase();
                var at = lower.indexOf(query);
                if (at < 0) {
                    return safe;
                }
                return escapeHtml(label.slice(0, at)) +
                    "<mark>" + escapeHtml(label.slice(at, at + query.length)) + "</mark>" +
                    escapeHtml(label.slice(at + query.length));
            }

            function renderRows() {
                var query = (searchInput.value || "").trim().toLowerCase();
                var rows = visibleRows(query);
                var selectableVisible = 0;
                var html = rows.map(function (row) {
                    var status = disjointRowStatus(row.iri, focusIri);
                    var label = labelOf(state.model.classes[row.iri] || {iri: row.iri, labels: []});
                    var checked = !!selectedMap[row.iri];
                    var rowClass = "picker-row status-" + status.code + (status.selectable ? " is-selectable" : " is-disabled") + (checked ? " is-checked" : "");
                    if (status.selectable) {
                        selectableVisible += 1;
                    }
                    var checkCell = status.selectable
                        ? "<input type='checkbox' name='peer' value='" + escapeHtml(row.iri) + "'" + (checked ? " checked" : "") + ">"
                        : "<span class='picker-check-placeholder'></span>";
                    return "<tr class='" + rowClass + "' data-iri='" + escapeHtml(row.iri) + "' data-selectable='" + (status.selectable ? "1" : "0") + "'>" +
                        "<td class='col-check'>" + checkCell + "</td>" +
                        "<td class='col-name'><span class='picker-tree-label' style='--depth:" + row.depth + "'>" +
                        "<span class='picker-tree-guide'></span>" +
                        "<span class='picker-name'>" + highlightLabel(label, query) + "</span></span></td>" +
                        "<td class='col-status'><span class='picker-status status-" + status.code + "'>" + escapeHtml(status.reason) + "</span></td>" +
                        "</tr>";
                }).join("");
                body.innerHTML = html;
                emptyNode.classList.toggle("hidden", rows.length > 0);
                form.querySelector(".picker-table").classList.toggle("hidden", rows.length === 0);
                metaNode.textContent = query
                    ? ("匹配 " + rows.length + " 个 · 其中可选 " + selectableVisible + " 个")
                    : ("共 " + treeRows.length + " 个类 · 可选 " + selectableCount + " 个");
            }

            function syncSelectionUi() {
                var iris = selectedIris();
                countNode.textContent = String(iris.length);
                saveBtn.disabled = iris.length === 0;
                if (!iris.length) {
                    chipsNode.innerHTML = "<span class='picker-chips-empty'>尚未选择</span>";
                    previewNode.textContent = "请至少选择一个类。";
                } else {
                    chipsNode.innerHTML = iris.map(function (iriValue) {
                        var name = labelOf(state.model.classes[iriValue] || {iri: iriValue, labels: []});
                        return "<button type='button' class='picker-chip' data-unselect='" + escapeHtml(iriValue) + "' title='取消选择'>" +
                            escapeHtml(name) + "<span aria-hidden='true'>×</span></button>";
                    }).join("");
                    var names = iris.map(function (iriValue) {
                        return labelOf(state.model.classes[iriValue] || {iri: iriValue, labels: []});
                    });
                    previewNode.textContent = "保存后：没有任何个体可以同时是「" + currentLabel + "」和「" + names.join(" / ") + "」。";
                }
                body.querySelectorAll("tr[data-iri]").forEach(function (row) {
                    var iriValue = row.getAttribute("data-iri");
                    var on = !!selectedMap[iriValue];
                    row.classList.toggle("is-checked", on);
                    var input = row.querySelector("input[name='peer']");
                    if (input) {
                        input.checked = on;
                    }
                });
            }

            function setSelected(iriValue, on) {
                if (on) {
                    selectedMap[iriValue] = true;
                } else {
                    delete selectedMap[iriValue];
                }
                syncSelectionUi();
            }

            renderRows();
            syncSelectionUi();
            searchInput.focus();

            searchInput.addEventListener("input", function () {
                renderRows();
                syncSelectionUi();
            });
            form.querySelector("#disjoint-select-visible").addEventListener("click", function () {
                body.querySelectorAll("tr.is-selectable").forEach(function (row) {
                    selectedMap[row.getAttribute("data-iri")] = true;
                });
                syncSelectionUi();
            });
            form.querySelector("#disjoint-clear-selection").addEventListener("click", function () {
                selectedMap = {};
                syncSelectionUi();
            });
            body.addEventListener("click", function (event) {
                var row = event.target.closest("tr[data-iri]");
                if (!row || row.getAttribute("data-selectable") !== "1") {
                    return;
                }
                if (event.target && event.target.tagName === "INPUT") {
                    setSelected(row.getAttribute("data-iri"), event.target.checked);
                    return;
                }
                setSelected(row.getAttribute("data-iri"), !selectedMap[row.getAttribute("data-iri")]);
            });
            chipsNode.addEventListener("click", function (event) {
                var button = event.target.closest("[data-unselect]");
                if (!button) {
                    return;
                }
                setSelected(button.getAttribute("data-unselect"), false);
            });
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var peerIris = selectedIris();
                if (!peerIris.length) {
                    setStatus("请至少选择一个互斥类。", true);
                    return;
                }
                var existing = disjointPeersOf(state.model, focusIri);
                var toAdd = peerIris.filter(function (peerIri) {
                    return existing.indexOf(peerIri) < 0;
                }).map(function (peerIri) {
                    return disjointClassesAxiom([focusIri, peerIri]);
                }).filter(Boolean);
                hideModal();
                if (!toAdd.length) {
                    setStatus("所选类已互斥，无需重复添加。");
                    return;
                }
                submitAxioms(toAdd, "为 " + currentLabel + " 添加互斥类");
            });
        }

        function removeDisjointPeer(cls, peerIri) {
            var peerLabel = labelOf(state.model.classes[peerIri] || {iri: peerIri, labels: []});
            var rewrite = rewriteDisjointRemovingLink(state.axioms, state.selected, peerIri);
            if (!rewrite.toDelete.length) {
                setStatus("未找到与「" + peerLabel + "」的互斥公理。", true);
                return;
            }
            replaceAxioms(
                rewrite.toDelete,
                rewrite.toAdd,
                "移除 " + labelOf(cls) + " 与 " + peerLabel + " 的互斥"
            );
        }

        function clearDisjointPeers(cls) {
            var rewrite = rewriteDisjointClearingClass(state.axioms, state.selected);
            if (!rewrite.toDelete.length) {
                setStatus("没有可清除的互斥公理。");
                return;
            }
            replaceAxioms(
                rewrite.toDelete,
                rewrite.toAdd,
                "清除 " + labelOf(cls) + " 的互斥类"
            );
        }

        function unionRowStatus(classIri, coverIri, existingMembers) {
            if (classIri === coverIri) {
                return {selectable: false, code: "current", reason: "当前类"};
            }
            if (classIri === OWL_THING) {
                return {selectable: false, code: "thing", reason: "根类不可选"};
            }
            if ((existingMembers || []).indexOf(classIri) >= 0) {
                return {selectable: false, code: "already", reason: "已是成员"};
            }
            if (childrenOf(state.model, coverIri).indexOf(classIri) >= 0) {
                return {selectable: true, code: "child", reason: "直接子类"};
            }
            return {selectable: true, code: "ok", reason: "可选"};
        }

        function persistUnionMembers(coverIri, memberIris, message) {
            var toDelete = findDisjointUnionAxiomsForCover(state.axioms, coverIri);
            var axiom = memberIris.length >= 2 ? disjointUnionAxiom(coverIri, memberIris) : null;
            return replaceAxioms(toDelete, axiom ? [axiom] : [], message);
        }

        function openAddUnionMembersDialog(cls) {
            var coverIri = state.selected;
            var currentLabel = labelOf(cls);
            var existingMembers = disjointUnionMembersOf(state.model, coverIri);
            var treeRows = flattenClassTree(OWL_THING, 0, {}, []);
            var directChildren = childrenOf(state.model, coverIri);
            var selectableCount = treeRows.filter(function (row) {
                return unionRowStatus(row.iri, coverIri, existingMembers).selectable;
            }).length;
            var minSelect = existingMembers.length ? 1 : 2;
            if (selectableCount < minSelect) {
                setStatus(existingMembers.length
                    ? "没有可继续添加的成员。"
                    : "完备划分至少需要 2 个可选类，请先创建更多类。", true);
                return;
            }
            var selectedMap = {};

            showModal(
                "<form id='union-form' class='disjoint-picker'>" +
                "<div class='picker-head'>" +
                "<div><h2>添加划分成员</h2>" +
                "<p class='hint'>为「" + escapeHtml(currentLabel) + "」选择组成成员。当前类由这些成员组成，且成员两两互斥。</p></div>" +
                "<label class='picker-search'><span class='sr-only'>搜索类</span>" +
                "<input type='search' id='union-search' placeholder='搜索类名…' autocomplete='off'></label>" +
                "</div>" +
                "<div class='picker-toolbar'>" +
                "<span id='union-filter-meta' class='picker-meta'></span>" +
                "<div class='picker-toolbar-actions'>" +
                "<button type='button' class='ghost' id='union-select-children'>勾选全部直接子类</button>" +
                "<button type='button' class='ghost' id='union-clear-selection'>清空已选</button>" +
                "</div></div>" +
                "<div class='picker-table-wrap'>" +
                "<table class='picker-table' id='union-tree-table'>" +
                "<thead><tr><th class='col-check'></th><th>类</th><th>状态</th></tr></thead>" +
                "<tbody id='union-tree-body'></tbody>" +
                "</table>" +
                "<p class='picker-empty hidden' id='union-empty'>没有匹配的类。</p>" +
                "</div>" +
                "<div class='picker-foot'>" +
                "<div class='picker-selected'>" +
                "<div class='picker-selected-label'>本次勾选 <strong id='union-selected-count'>0</strong>" +
                (existingMembers.length ? "（已有成员 " + existingMembers.length + " 个）" : "（首次至少 2 个）") +
                "</div>" +
                "<div class='picker-chips' id='union-chips'><span class='picker-chips-empty'>尚未选择</span></div>" +
                "</div>" +
                "<p class='hint preview-hint' id='union-preview'></p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button><button type='submit' id='union-save' disabled>保存</button></div>" +
                "</div></form>"
            );

            var form = root.querySelector("#union-form");
            var searchInput = form.querySelector("#union-search");
            var body = form.querySelector("#union-tree-body");
            var emptyNode = form.querySelector("#union-empty");
            var metaNode = form.querySelector("#union-filter-meta");
            var chipsNode = form.querySelector("#union-chips");
            var countNode = form.querySelector("#union-selected-count");
            var previewNode = form.querySelector("#union-preview");
            var saveBtn = form.querySelector("#union-save");

            function selectedIris() {
                return Object.keys(selectedMap).filter(function (iriValue) {
                    return selectedMap[iriValue];
                });
            }

            function matchesQuery(label, query) {
                if (!query) {
                    return true;
                }
                return label.toLowerCase().indexOf(query) >= 0;
            }

            function visibleRows(query) {
                var matchSet = {};
                var keepAncestors = {};
                treeRows.forEach(function (row) {
                    var label = labelOf(state.model.classes[row.iri] || {iri: row.iri, labels: []});
                    if (matchesQuery(label, query)) {
                        matchSet[row.iri] = true;
                    }
                });
                if (!query) {
                    return treeRows.slice();
                }
                treeRows.forEach(function (row, index) {
                    if (!matchSet[row.iri]) {
                        return;
                    }
                    keepAncestors[row.iri] = true;
                    var depth = row.depth;
                    for (var i = index - 1; i >= 0 && depth > 0; i--) {
                        if (treeRows[i].depth < depth) {
                            keepAncestors[treeRows[i].iri] = true;
                            depth = treeRows[i].depth;
                        }
                    }
                });
                return treeRows.filter(function (row) {
                    return keepAncestors[row.iri];
                });
            }

            function highlightLabel(label, query) {
                var safe = escapeHtml(label);
                if (!query) {
                    return safe;
                }
                var lower = label.toLowerCase();
                var at = lower.indexOf(query);
                if (at < 0) {
                    return safe;
                }
                return escapeHtml(label.slice(0, at)) +
                    "<mark>" + escapeHtml(label.slice(at, at + query.length)) + "</mark>" +
                    escapeHtml(label.slice(at + query.length));
            }

            function renderRows() {
                var query = (searchInput.value || "").trim().toLowerCase();
                var rows = visibleRows(query);
                var selectableVisible = 0;
                var html = rows.map(function (row) {
                    var status = unionRowStatus(row.iri, coverIri, existingMembers);
                    var label = labelOf(state.model.classes[row.iri] || {iri: row.iri, labels: []});
                    var checked = !!selectedMap[row.iri];
                    var rowClass = "picker-row status-" + status.code + (status.selectable ? " is-selectable" : " is-disabled") + (checked ? " is-checked" : "");
                    if (status.selectable) {
                        selectableVisible += 1;
                    }
                    var checkCell = status.selectable
                        ? "<input type='checkbox' name='member' value='" + escapeHtml(row.iri) + "'" + (checked ? " checked" : "") + ">"
                        : "<span class='picker-check-placeholder'></span>";
                    return "<tr class='" + rowClass + "' data-iri='" + escapeHtml(row.iri) + "' data-selectable='" + (status.selectable ? "1" : "0") + "'>" +
                        "<td class='col-check'>" + checkCell + "</td>" +
                        "<td class='col-name'><span class='picker-tree-label' style='--depth:" + row.depth + "'>" +
                        "<span class='picker-tree-guide'></span>" +
                        "<span class='picker-name'>" + highlightLabel(label, query) + "</span></span></td>" +
                        "<td class='col-status'><span class='picker-status status-" + status.code + "'>" + escapeHtml(status.reason) + "</span></td>" +
                        "</tr>";
                }).join("");
                body.innerHTML = html;
                emptyNode.classList.toggle("hidden", rows.length > 0);
                form.querySelector(".picker-table").classList.toggle("hidden", rows.length === 0);
                metaNode.textContent = query
                    ? ("匹配 " + rows.length + " 个 · 其中可选 " + selectableVisible + " 个")
                    : ("共 " + treeRows.length + " 个类 · 已有成员 " + existingMembers.length + " 个");
            }

            function syncSelectionUi() {
                var iris = selectedIris();
                countNode.textContent = String(iris.length);
                saveBtn.disabled = iris.length < minSelect;
                var merged = existingMembers.concat(iris.filter(function (iriValue) {
                    return existingMembers.indexOf(iriValue) < 0;
                }));
                if (!iris.length) {
                    chipsNode.innerHTML = "<span class='picker-chips-empty'>尚未选择</span>";
                    previewNode.textContent = existingMembers.length
                        ? "请至少再选 1 个类加入划分。"
                        : "请至少选择 2 个类。";
                } else {
                    chipsNode.innerHTML = iris.map(function (iriValue) {
                        var name = labelOf(state.model.classes[iriValue] || {iri: iriValue, labels: []});
                        return "<button type='button' class='picker-chip' data-unselect='" + escapeHtml(iriValue) + "' title='取消选择'>" +
                            escapeHtml(name) + "<span aria-hidden='true'>×</span></button>";
                    }).join("");
                    if (merged.length < 2) {
                        previewNode.textContent = "还差成员才能构成完备划分（合计至少 2 个）。";
                    } else {
                        var names = merged.map(function (iriValue) {
                            return labelOf(state.model.classes[iriValue] || {iri: iriValue, labels: []});
                        });
                        previewNode.textContent = "保存后：「" + currentLabel + "」由「" + names.join("」「") + "」组成，且两两互斥。";
                    }
                }
                body.querySelectorAll("tr[data-iri]").forEach(function (row) {
                    var iriValue = row.getAttribute("data-iri");
                    var on = !!selectedMap[iriValue];
                    row.classList.toggle("is-checked", on);
                    var input = row.querySelector("input[name='member']");
                    if (input) {
                        input.checked = on;
                    }
                });
            }

            function setSelected(iriValue, on) {
                if (on) {
                    selectedMap[iriValue] = true;
                } else {
                    delete selectedMap[iriValue];
                }
                syncSelectionUi();
            }

            renderRows();
            syncSelectionUi();
            searchInput.focus();

            searchInput.addEventListener("input", function () {
                renderRows();
                syncSelectionUi();
            });
            form.querySelector("#union-select-children").addEventListener("click", function () {
                var added = 0;
                directChildren.forEach(function (childIri) {
                    if (unionRowStatus(childIri, coverIri, existingMembers).selectable) {
                        selectedMap[childIri] = true;
                        added += 1;
                    }
                });
                if (!added) {
                    setStatus("没有可勾选的直接子类（可能已全部是成员）。", true);
                    return;
                }
                syncSelectionUi();
                renderRows();
            });
            form.querySelector("#union-clear-selection").addEventListener("click", function () {
                selectedMap = {};
                syncSelectionUi();
            });
            body.addEventListener("click", function (event) {
                var row = event.target.closest("tr[data-iri]");
                if (!row || row.getAttribute("data-selectable") !== "1") {
                    return;
                }
                if (event.target && event.target.tagName === "INPUT") {
                    setSelected(row.getAttribute("data-iri"), event.target.checked);
                    return;
                }
                setSelected(row.getAttribute("data-iri"), !selectedMap[row.getAttribute("data-iri")]);
            });
            chipsNode.addEventListener("click", function (event) {
                var button = event.target.closest("[data-unselect]");
                if (!button) {
                    return;
                }
                setSelected(button.getAttribute("data-unselect"), false);
            });
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var added = selectedIris();
                if (added.length < minSelect) {
                    setStatus(existingMembers.length ? "请至少再选 1 个成员。" : "完备划分至少选择 2 个类。", true);
                    return;
                }
                var merged = existingMembers.concat(added.filter(function (iriValue) {
                    return existingMembers.indexOf(iriValue) < 0;
                }));
                if (merged.length < 2) {
                    setStatus("完备划分至少需要 2 个成员。", true);
                    return;
                }
                hideModal();
                persistUnionMembers(coverIri, merged, "更新 " + currentLabel + " 的完备划分成员");
            });
        }

        function removeUnionMember(cls, memberIri) {
            var coverIri = state.selected;
            var memberLabel = labelOf(state.model.classes[memberIri] || {iri: memberIri, labels: []});
            var next = disjointUnionMembersOf(state.model, coverIri).filter(function (iriValue) {
                return iriValue !== memberIri;
            });
            if (next.length < 2) {
                showModal(
                    "<div id='remove-union-last-form'><h2>移除成员</h2>" +
                    "<p>移除「" + escapeHtml(memberLabel) + "」后成员不足 2 个，将清除整份完备划分。是否继续？</p>" +
                    "<div class='actions'><button type='button' id='cancel'>取消</button><button type='button' id='confirm-remove-union-last' class='danger'>清除划分</button></div></div>"
                );
                root.querySelector("#confirm-remove-union-last").addEventListener("click", function () {
                    hideModal();
                    persistUnionMembers(coverIri, [], "清除 " + labelOf(cls) + " 的完备划分");
                });
                return;
            }
            persistUnionMembers(
                coverIri,
                next,
                "从 " + labelOf(cls) + " 的完备划分移除 " + memberLabel
            );
        }

        function clearUnionMembers(cls) {
            var coverIri = state.selected;
            var toDelete = findDisjointUnionAxiomsForCover(state.axioms, coverIri);
            if (!toDelete.length) {
                setStatus("没有可清除的完备划分。");
                return;
            }
            deleteAxioms(toDelete, "清除 " + labelOf(cls) + " 的完备划分");
        }

        function openAddPropertyDialog(cls, isData, facet, options) {
            options = options || {};
            facet = normalizeFacet(facet) || (isData ? "technicalParam" : "relation");
            var functionMode = facet === "function";
            var lockedFacet = functionMode ? "function" : (normalizeFacet(facet) || (isData ? "technicalParam" : "relation"));
            var title = functionMode ? "添加功能" : (isData ? "添加属性" : "添加关系");
            var kindLabel = functionMode ? "功能" : (isData ? "属性" : "关系");
            var catalogPage = 1;
            var catalogQuery = "";
            var createRangeControl = functionMode
                ? "<input type='hidden' name='range' value='" + escapeHtml(XSD + "string") + "'>"
                : (isData
                    ? "<label class='field-row'><span>数据类型</span><select name='range'>" + DATATYPES.map(function (type) {
                        return "<option value='" + type.iri + "'>" + type.label + "</option>";
                    }).join("") + "</select></label>"
                    : "<label class='field-row'><span>目标类</span><select name='range'>" + classOptions(state.model) + "</select></label>");
            var createUnitControl = functionMode
                ? ""
                : "<label class='field-row'><span>量纲</span><input name='unit' placeholder='例如：千米/小时，可空'></label>";
            var createConstraintControl = functionMode
                ? "<input type='hidden' name='constraint' value='some'><input type='hidden' name='cardinality' value='1'>"
                : ("<label class='field-row'><span>约束</span>" + constraintSelectHtml("some") + "</label>" +
                    "<label class='field-row constraint-n-row'><span>个数 N</span>" + cardinalityInputHtml({mode: "some"}) + "</label>");
            var createFunctionCodeControl = functionMode
                ? ("<label class='field-row function-code-row'><span>功能代码</span>" +
                    "<textarea name='functionCode' rows='5' placeholder='例如：猎手(?a) :- 动物(?a), 饥饿(?a, ?h), greaterThan(?h, 50)'></textarea>" +
                    "<span class='hint'>写入本类 SubClassOf 的 benti:functionCode 注解。</span></label>")
                : "";
            var catalogConstraintBlock = functionMode
                ? ""
                : ("<label class='field-row'><span>选用约束</span>" + constraintSelectHtml("some") + "</label>" +
                    "<label class='field-row constraint-n-row'><span>个数 N</span>" + cardinalityInputHtml({mode: "some"}) + "</label>");
            var createNamePlaceholder = functionMode ? "例如：看家能力" : (isData ? "例如：体重" : "例如：居住于");

            showModal(
                "<div id='add-field-form' class='add-field-form'>" +
                "<h2>" + title + "</h2>" +
                "<p class='hint'>" + (functionMode
                    ? "功能只需填写名称与功能代码；取值类型默认字符串，约束默认「至少有一个」。"
                    : ("新建会创建本类专属" + kindLabel + "，并归入当前 Tab；「已有」表格可浏览、选用、编辑或删除全局" + kindLabel + "（编辑/删除会影响所有使用它的类）。")) +
                "</p>" +
                "<div class='mode-toggle' role='tablist'>" +
                "<button type='button' class='mode-btn is-active' data-field-mode='catalog'>已有" + kindLabel + "</button>" +
                "<button type='button' class='mode-btn' data-field-mode='create'>新建</button>" +
                "</div>" +
                "<div class='field-mode-panel' data-field-panel='catalog'>" +
                "<label class='field-row catalog-search-row'><span>搜索</span>" +
                "<input type='search' id='property-catalog-search' placeholder='按名称、类型、定义域模糊搜索…' autocomplete='off'></label>" +
                "<div class='data-table-wrap' id='property-catalog-wrap'></div>" +
                "<div id='property-catalog-pager'></div>" +
                catalogConstraintBlock +
                "</div>" +
                "<div class='field-mode-panel' data-field-panel='create' hidden>" +
                "<form id='create-field-form'>" +
                "<input type='hidden' name='facet' value='" + escapeHtml(lockedFacet) + "'>" +
                "<label class='field-row'><span>名称</span><input name='name' required placeholder='" + createNamePlaceholder + "'></label>" +
                createRangeControl +
                createUnitControl +
                createFunctionCodeControl +
                createConstraintControl +
                "<div class='actions'><button type='button' id='cancel-create'>返回列表</button><button type='submit'>创建并挂到本类</button></div>" +
                "</form></div>" +
                "<div class='actions' data-field-footer='catalog'><button type='button' id='cancel'>关闭</button></div>" +
                "</div>",
                {stacked: !!options.stacked}
            );

            var rootForm = root.querySelector("#add-field-form");
            var createForm = root.querySelector("#create-field-form");
            var catalogSearchInput = rootForm.querySelector("#property-catalog-search");
            if (!functionMode) {
                bindConstraintToggle(rootForm);
                bindConstraintToggle(createForm);
            }

            function currentConstraintFromCatalog() {
                if (functionMode) {
                    return {mode: "some", n: 1};
                }
                return readConstraintFromForm(rootForm);
            }

            function filteredCatalogProperties() {
                return allPropertiesOfKind(state.model, isData).filter(function (property) {
                    return fuzzyTextMatch(propertySearchText(state.model, property, isData), catalogQuery);
                });
            }

            function renderCatalog() {
                var properties = filteredCatalogProperties();
                var pages = Math.max(1, Math.ceil(properties.length / TABLE_PAGE_SIZE) || 1);
                if (catalogPage > pages) {
                    catalogPage = pages;
                }
                if (catalogPage < 1) {
                    catalogPage = 1;
                }
                var start = (catalogPage - 1) * TABLE_PAGE_SIZE;
                var slice = properties.slice(start, start + TABLE_PAGE_SIZE);
                var rows = slice.map(function (property) {
                    var range = property.ranges[0] || (isData ? (XSD + "string") : OWL_THING);
                    var rangeLabel = isData
                        ? datatypeLabel(range)
                        : labelOf(state.model.classes[range] || {iri: range, labels: []});
                    var domains = propertyDomainSummary(state.model, property);
                    var linked = propertyLinkedToClass(property, state.selected)
                        || fieldsOf(state.model, state.selected)[isData ? "data" : "object"].some(function (item) {
                            return item.iri === property.iri;
                        });
                    var selectBtn = linked
                        ? ""
                        : "<button type='button' class='btn-attach' data-catalog-attach='" + escapeHtml(property.iri) + "'>选用</button>";
                    return "<tr class='catalog-row" + (linked ? " is-on-class" : "") + "'>" +
                        "<td>" + escapeHtml(labelOf(property)) + "</td>" +
                        "<td>" + escapeHtml(rangeLabel) + "</td>" +
                        "<td>" + escapeHtml(domains) + "</td>" +
                        "<td class='col-actions'>" + selectBtn +
                        "<button type='button' data-catalog-edit='" + escapeHtml(property.iri) + "'>编辑</button>" +
                        "<button type='button' class='danger' data-catalog-delete='" + escapeHtml(property.iri) + "'>删除</button>" +
                        "</td></tr>";
                }).join("");
                var emptyMsg = catalogQuery
                    ? "没有匹配「" + escapeHtml(catalogQuery) + "」的" + kindLabel + "。"
                    : "还没有" + kindLabel + "，可切换到「新建」。";
                var wrap = rootForm.querySelector("#property-catalog-wrap");
                wrap.innerHTML = "<table class='data-table'>" +
                    "<thead><tr><th>名称</th><th>" + (isData ? "数据类型" : "目标类") + "</th><th>定义域</th><th>操作</th></tr></thead>" +
                    "<tbody>" + (rows || "<tr><td colspan='4' class='empty'>" + emptyMsg + "</td></tr>") + "</tbody></table>";
                var totalAll = allPropertiesOfKind(state.model, isData).length;
                var pager = rootForm.querySelector("#property-catalog-pager");
                var countLabel = catalogQuery
                    ? "匹配 " + properties.length + " / 共 " + totalAll + " 条"
                    : "共 " + properties.length + " 条";
                pager.innerHTML = properties.length > TABLE_PAGE_SIZE
                    ? "<div class='table-pager'><span class='pager-info'>" + countLabel + " · 第 " + catalogPage + " / " + pages + " 页</span>" +
                      "<div class='pager-actions'>" +
                      "<button type='button' data-catalog-page='-1'" + (catalogPage <= 1 ? " disabled" : "") + ">上一页</button>" +
                      "<button type='button' data-catalog-page='1'" + (catalogPage >= pages ? " disabled" : "") + ">下一页</button>" +
                      "</div></div>"
                    : (properties.length || catalogQuery ? "<div class='table-pager'><span class='pager-info'>" + countLabel + "</span></div>" : "");

                pager.querySelectorAll("[data-catalog-page]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        catalogPage += parseInt(button.getAttribute("data-catalog-page"), 10);
                        renderCatalog();
                    });
                });
                wrap.querySelectorAll("[data-catalog-attach]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        var propertyIri = button.getAttribute("data-catalog-attach");
                        var property = isData
                            ? state.model.dataProperties[propertyIri]
                            : state.model.objectProperties[propertyIri];
                        if (!property) {
                            return;
                        }
                        if (!state.tableFilter) {
                            state.tableFilter = {};
                        }
                        hideModal();
                        submitAxioms(
                            axiomsForAttachExistingField(
                                state.selected,
                                property,
                                isData,
                                currentConstraintFromCatalog(),
                                lockedFacet
                            ),
                            "为" + labelOf(cls) + "选用" + labelOf(property)
                        ).then(function () {
                            if (typeof options.onSaved === "function") {
                                options.onSaved();
                            }
                        });
                    });
                });
                wrap.querySelectorAll("[data-catalog-edit]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        openEditPropertyDialog(button.getAttribute("data-catalog-edit"), isData, {
                            fromCatalog: true,
                            fixedFacet: functionMode ? "function" : "",
                            stacked: !!options.stacked,
                            onSaved: options.onSaved
                        });
                    });
                });
                wrap.querySelectorAll("[data-catalog-delete]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        confirmDeleteProperty(button.getAttribute("data-catalog-delete"), isData, {
                            fromCatalog: true,
                            stacked: !!options.stacked,
                            onSaved: options.onSaved
                        });
                    });
                });
            }

            if (catalogSearchInput) {
                catalogSearchInput.addEventListener("input", function () {
                    catalogQuery = catalogSearchInput.value || "";
                    catalogPage = 1;
                    renderCatalog();
                });
            }

            function syncMode(mode) {
                rootForm.querySelectorAll(".mode-btn").forEach(function (button) {
                    button.classList.toggle("is-active", button.getAttribute("data-field-mode") === mode);
                });
                rootForm.querySelectorAll("[data-field-panel]").forEach(function (panel) {
                    panel.hidden = panel.getAttribute("data-field-panel") !== mode;
                });
                var footer = rootForm.querySelector("[data-field-footer='catalog']");
                if (footer) {
                    footer.hidden = mode !== "catalog";
                }
                if (mode === "catalog") {
                    renderCatalog();
                }
            }

            rootForm.querySelectorAll(".mode-btn").forEach(function (button) {
                button.addEventListener("click", function () {
                    syncMode(button.getAttribute("data-field-mode"));
                });
            });
            var cancelCreate = rootForm.querySelector("#cancel-create");
            if (cancelCreate) {
                cancelCreate.addEventListener("click", function () {
                    syncMode("catalog");
                });
            }
            createForm.addEventListener("submit", function (event) {
                event.preventDefault();
                var data = new FormData(createForm);
                var name = String(data.get("name") || "").trim();
                var range = data.get("range") || (functionMode ? (XSD + "string") : "");
                if (!name || !range) {
                    setStatus(functionMode ? "请填写名称。" : "请填写名称并选择类型。", true);
                    return;
                }
                var constraint = functionMode
                    ? {mode: "some", n: 1}
                    : readConstraintFromForm(createForm);
                var nextFacet = lockedFacet;
                var unit = functionMode ? "" : String(data.get("unit") || "").trim();
                var functionCode = functionMode ? String(data.get("functionCode") || "").trim() : "";
                hideModal();
                if (!state.tableFilter) {
                    state.tableFilter = {};
                }
                state.classTab = nextFacet === "general" ? "technicalParam" : nextFacet;
                var createPromise = (isData || functionMode)
                    ? submitAxioms(
                        axiomsForDataField(state.selected, name, range, constraint, nextFacet, unit, functionCode),
                        "为" + labelOf(cls) + "添加" + (functionMode ? "功能" : "属性")
                    )
                    : submitAxioms(
                        axiomsForObjectField(state.selected, name, range, constraint, nextFacet, unit, functionCode),
                        "为" + labelOf(cls) + "添加关系"
                    );
                createPromise.then(function () {
                    if (typeof options.onSaved === "function") {
                        options.onSaved();
                    }
                });
            });
            syncMode(functionMode ? "create" : "catalog");
        }

        function detachPropertyFromClass(propertyIri, isData) {
            var property = isData ? state.model.dataProperties[propertyIri] : state.model.objectProperties[propertyIri];
            if (!property) {
                return;
            }
            var toDelete = findClassPropertyLinkAxioms(state.axioms, state.selected, propertyIri, isData);
            if (!toDelete.length) {
                setStatus("没有可移除的本类关联。", true);
                return;
            }
            var name = labelOf(property);
            showModal(
                "<div id='detach-property-form'><h2>移除" + (isData ? "属性" : "关系") + "</h2>" +
                "<p>从「" + escapeHtml(labelOf(state.model.classes[state.selected])) + "」移除「" + escapeHtml(name) + "」？" +
                "只解除本类的定义域/约束，不会删除该" + (isData ? "属性" : "关系") + "本身，也不影响其他类。</p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='button' id='confirm-detach' class='danger'>确认移除</button></div></div>"
            );
            root.querySelector("#confirm-detach").addEventListener("click", function () {
                hideModal();
                setStatus("正在从本类移除…");
                deleteAxioms(toDelete, "从类上移除 " + name).then(function () {
                    return loadOntology();
                }).then(function () {
                    setStatus("已从本类移除「" + name + "」。");
                }).catch(function (error) {
                    setStatus(error.message || String(error), true);
                });
            });
        }

        function openAddDefinitionParentDialog(cls) {
            var members = currentDefinitionMembers();
            var used = {};
            members.forEach(function (member) {
                if (member.kind === "class") {
                    used[member.iri] = true;
                }
            });
            var available = Object.keys(state.model.classes).filter(function (classIri) {
                return classIri !== state.selected && classIri !== OWL_THING && !used[classIri];
            }).sort(function (left, right) {
                return labelOf(state.model.classes[left]).localeCompare(labelOf(state.model.classes[right]), "zh");
            });
            if (!available.length) {
                setStatus("没有可添加的父类。", true);
                return;
            }
            var catalogPage = 1;
            var catalogQuery = "";
            var selectedIri = available[0] || "";
            showModal(
                "<div id='add-def-parent-form' class='add-field-form'>" +
                "<h2>添加定义父类</h2>" +
                "<p class='hint'>从类列表中选用父类写入 Equivalent To。支持按名称模糊搜索。</p>" +
                "<label class='field-row catalog-search-row'><span>搜索</span>" +
                "<input type='search' id='def-parent-search' placeholder='按类名称模糊搜索…' autocomplete='off'></label>" +
                "<div class='data-table-wrap' id='def-parent-wrap'></div>" +
                "<div id='def-parent-pager'></div>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='button' id='def-parent-ok'>添加所选父类</button></div></div>"
            );
            var rootForm = root.querySelector("#add-def-parent-form");
            var searchInput = rootForm.querySelector("#def-parent-search");

            function filteredParents() {
                return available.filter(function (classIri) {
                    var clsEntity = state.model.classes[classIri] || {iri: classIri, labels: []};
                    return fuzzyTextMatch(labelOf(clsEntity) + " " + localName(classIri), catalogQuery);
                });
            }

            function renderParentCatalog() {
                var list = filteredParents();
                var pages = Math.max(1, Math.ceil(list.length / TABLE_PAGE_SIZE) || 1);
                if (catalogPage > pages) {
                    catalogPage = pages;
                }
                if (catalogPage < 1) {
                    catalogPage = 1;
                }
                if (selectedIri && list.indexOf(selectedIri) < 0) {
                    selectedIri = list[0] || "";
                }
                var start = (catalogPage - 1) * TABLE_PAGE_SIZE;
                var slice = list.slice(start, start + TABLE_PAGE_SIZE);
                var rows = slice.map(function (classIri) {
                    var active = classIri === selectedIri ? " is-selected" : "";
                    return "<tr class='catalog-row" + active + "' data-def-parent='" + escapeHtml(classIri) + "'>" +
                        "<td>" + escapeHtml(labelOf(state.model.classes[classIri])) + "</td>" +
                        "<td class='col-actions'><button type='button' class='btn-attach' data-def-parent-pick='" +
                        escapeHtml(classIri) + "'>" + (classIri === selectedIri ? "已选" : "选用") + "</button></td></tr>";
                }).join("");
                var emptyMsg = catalogQuery
                    ? "没有匹配「" + escapeHtml(catalogQuery) + "」的类。"
                    : "没有可添加的父类。";
                rootForm.querySelector("#def-parent-wrap").innerHTML =
                    "<table class='data-table'><thead><tr><th>类名称</th><th>操作</th></tr></thead>" +
                    "<tbody>" + (rows || "<tr><td colspan='2' class='empty'>" + emptyMsg + "</td></tr>") + "</tbody></table>";
                var countLabel = catalogQuery
                    ? "匹配 " + list.length + " / 共 " + available.length + " 条"
                    : "共 " + list.length + " 条";
                var pager = rootForm.querySelector("#def-parent-pager");
                pager.innerHTML = list.length > TABLE_PAGE_SIZE
                    ? "<div class='table-pager'><span class='pager-info'>" + countLabel + " · 第 " + catalogPage + " / " + pages + " 页</span>" +
                      "<div class='pager-actions'>" +
                      "<button type='button' data-def-parent-page='-1'" + (catalogPage <= 1 ? " disabled" : "") + ">上一页</button>" +
                      "<button type='button' data-def-parent-page='1'" + (catalogPage >= pages ? " disabled" : "") + ">下一页</button>" +
                      "</div></div>"
                    : (list.length || catalogQuery ? "<div class='table-pager'><span class='pager-info'>" + countLabel + "</span></div>" : "");
                pager.querySelectorAll("[data-def-parent-page]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        catalogPage += parseInt(button.getAttribute("data-def-parent-page"), 10);
                        renderParentCatalog();
                    });
                });
                rootForm.querySelectorAll("[data-def-parent-pick]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        selectedIri = button.getAttribute("data-def-parent-pick");
                        renderParentCatalog();
                    });
                });
                rootForm.querySelectorAll("[data-def-parent]").forEach(function (row) {
                    row.addEventListener("dblclick", function () {
                        selectedIri = row.getAttribute("data-def-parent");
                        confirmParent();
                    });
                });
            }

            function confirmParent() {
                if (!selectedIri) {
                    setStatus("请先选用一个父类。", true);
                    return;
                }
                members.push({kind: "class", iri: selectedIri});
                hideModal();
                persistClassDefinition(members, "为 " + labelOf(cls) + " 的定义添加父类");
            }

            if (searchInput) {
                searchInput.addEventListener("input", function () {
                    catalogQuery = searchInput.value || "";
                    catalogPage = 1;
                    renderParentCatalog();
                });
                searchInput.focus();
            }
            rootForm.querySelector("#def-parent-ok").addEventListener("click", confirmParent);
            renderParentCatalog();
        }

        function openAddDefinitionRestrictionDialog(cls, fields) {
            var members = currentDefinitionMembers();
            var used = {};
            members.forEach(function (member) {
                if (member.propertyIri) {
                    used[member.propertyIri] = true;
                }
            });
            var available = fields.data.concat(fields.object).filter(function (property) {
                return property && property.iri && !used[property.iri];
            }).sort(function (left, right) {
                return labelOf(left).localeCompare(labelOf(right), "zh");
            });
            if (!available.length) {
                setStatus("没有可添加的属性/关系约束（请先在下方「本类属性 / 本类关系」中新增或选用）。", true);
                return;
            }

            var catalogPage = 1;
            var catalogQuery = "";
            var selectedIri = available[0] ? available[0].iri : "";
            var kindFilter = "all"; // all | data | object

            showModal(
                "<div id='add-def-restriction-form' class='add-field-form'>" +
                "<h2>添加定义约束</h2>" +
                "<p class='hint'>从本类已配置的<strong>属性</strong>与<strong>关系</strong>中选用，写入 Equivalent To。" +
                "建议使用「具体值」：关系选目标实例，属性填写字面量（与 Protégé hasValue 一致）。</p>" +
                "<div class='mode-toggle' role='tablist'>" +
                "<button type='button' class='mode-btn is-active' data-def-kind='all'>全部</button>" +
                "<button type='button' class='mode-btn' data-def-kind='data'>仅属性</button>" +
                "<button type='button' class='mode-btn' data-def-kind='object'>仅关系</button>" +
                "</div>" +
                "<div class='field-mode-panel' data-def-step='catalog'>" +
                "<label class='field-row catalog-search-row'><span>搜索</span>" +
                "<input type='search' id='def-restriction-search' placeholder='按名称、类型、定义域模糊搜索属性/关系…' autocomplete='off'></label>" +
                "<div class='data-table-wrap' id='def-restriction-wrap'></div>" +
                "<div id='def-restriction-pager'></div>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                "<button type='button' id='def-restriction-next'>选用并配置</button></div>" +
                "</div>" +
                "<div class='field-mode-panel' data-def-step='config' hidden>" +
                "<p class='hint' id='def-restriction-selected-label'></p>" +
                "<label class='field-row'><span>约束</span>" + definitionConstraintSelectHtml("value") + "</label>" +
                "<div id='def-restriction-fields'></div>" +
                "<label class='field-row constraint-n-row' hidden><span>个数 N</span>" + cardinalityInputHtml({mode: "value"}) + "</label>" +
                "<div class='actions'><button type='button' id='def-restriction-back'>返回列表</button>" +
                "<button type='button' id='def-restriction-ok'>添加到定义</button></div>" +
                "</div></div>"
            );

            var rootForm = root.querySelector("#add-def-restriction-form");
            var searchInput = rootForm.querySelector("#def-restriction-search");

            function isDataProperty(property) {
                return !!(property && state.model.dataProperties[property.iri]);
            }

            function filteredAvailable() {
                return available.filter(function (property) {
                    var data = isDataProperty(property);
                    if (kindFilter === "data" && !data) {
                        return false;
                    }
                    if (kindFilter === "object" && data) {
                        return false;
                    }
                    return fuzzyTextMatch(propertySearchText(state.model, property, data), catalogQuery);
                });
            }

            function selectedProperty() {
                return available.filter(function (property) {
                    return property.iri === selectedIri;
                })[0] || null;
            }

            function showStep(step) {
                rootForm.querySelectorAll("[data-def-step]").forEach(function (panel) {
                    panel.hidden = panel.getAttribute("data-def-step") !== step;
                });
            }

            function renderRestrictionCatalog() {
                var list = filteredAvailable();
                var pages = Math.max(1, Math.ceil(list.length / TABLE_PAGE_SIZE) || 1);
                if (catalogPage > pages) {
                    catalogPage = pages;
                }
                if (catalogPage < 1) {
                    catalogPage = 1;
                }
                if (selectedIri && !list.some(function (property) { return property.iri === selectedIri; })) {
                    selectedIri = list[0] ? list[0].iri : "";
                }
                var start = (catalogPage - 1) * TABLE_PAGE_SIZE;
                var slice = list.slice(start, start + TABLE_PAGE_SIZE);
                var rows = slice.map(function (property) {
                    var data = isDataProperty(property);
                    var range = property.ranges[0] || (data ? (XSD + "string") : OWL_THING);
                    var rangeLabel = data
                        ? datatypeLabel(range)
                        : labelOf(state.model.classes[range] || {iri: range, labels: []});
                    var domains = propertyDomainSummary(state.model, property);
                    var kindChip = data
                        ? "<span class='meta-chip local-chip'>属性</span>"
                        : "<span class='meta-chip shared-chip'>关系</span>";
                    var active = property.iri === selectedIri ? " is-selected" : "";
                    return "<tr class='catalog-row" + active + "' data-def-prop='" + escapeHtml(property.iri) + "'>" +
                        "<td>" + escapeHtml(labelOf(property)) + " " + kindChip + "</td>" +
                        "<td>" + escapeHtml(rangeLabel) + "</td>" +
                        "<td>" + escapeHtml(domains) + "</td>" +
                        "<td class='col-actions'><button type='button' class='btn-attach' data-def-prop-pick='" +
                        escapeHtml(property.iri) + "'>" + (property.iri === selectedIri ? "已选" : "选用") + "</button></td></tr>";
                }).join("");
                var emptyMsg = catalogQuery || kindFilter !== "all"
                    ? "没有匹配的属性/关系。"
                    : "没有可添加的属性/关系。";
                rootForm.querySelector("#def-restriction-wrap").innerHTML =
                    "<table class='data-table'><thead><tr><th>名称</th><th>类型 / 目标类</th><th>定义域</th><th>操作</th></tr></thead>" +
                    "<tbody>" + (rows || "<tr><td colspan='4' class='empty'>" + emptyMsg + "</td></tr>") + "</tbody></table>";
                var countLabel = (catalogQuery || kindFilter !== "all")
                    ? "匹配 " + list.length + " / 共 " + available.length + " 条"
                    : "共 " + list.length + " 条（含属性与关系）";
                var pager = rootForm.querySelector("#def-restriction-pager");
                pager.innerHTML = list.length > TABLE_PAGE_SIZE
                    ? "<div class='table-pager'><span class='pager-info'>" + countLabel + " · 第 " + catalogPage + " / " + pages + " 页</span>" +
                      "<div class='pager-actions'>" +
                      "<button type='button' data-def-rest-page='-1'" + (catalogPage <= 1 ? " disabled" : "") + ">上一页</button>" +
                      "<button type='button' data-def-rest-page='1'" + (catalogPage >= pages ? " disabled" : "") + ">下一页</button>" +
                      "</div></div>"
                    : (list.length || catalogQuery || kindFilter !== "all"
                        ? "<div class='table-pager'><span class='pager-info'>" + countLabel + "</span></div>" : "");
                pager.querySelectorAll("[data-def-rest-page]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        catalogPage += parseInt(button.getAttribute("data-def-rest-page"), 10);
                        renderRestrictionCatalog();
                    });
                });
                rootForm.querySelectorAll("[data-def-prop-pick]").forEach(function (button) {
                    button.addEventListener("click", function () {
                        selectedIri = button.getAttribute("data-def-prop-pick");
                        renderRestrictionCatalog();
                    });
                });
                rootForm.querySelectorAll("[data-def-prop]").forEach(function (row) {
                    row.addEventListener("dblclick", function () {
                        selectedIri = row.getAttribute("data-def-prop");
                        openConfigStep();
                    });
                });
            }

            function refreshConfigFields() {
                var property = selectedProperty();
                if (!property) {
                    return;
                }
                var data = isDataProperty(property);
                renderDefinitionRestrictionFields(rootForm, data, property, {
                    mode: (rootForm.querySelector("[name='constraint']") || {}).value || "value",
                    filler: property.ranges[0] || (data ? (XSD + "string") : OWL_THING),
                    valueText: ""
                });
            }

            function openConfigStep() {
                var property = selectedProperty();
                if (!property) {
                    setStatus("请先选用一个属性或关系。", true);
                    return;
                }
                var data = isDataProperty(property);
                var label = rootForm.querySelector("#def-restriction-selected-label");
                if (label) {
                    label.innerHTML = "已选：" + escapeHtml(labelOf(property)) +
                        " <span class='meta-chip " + (data ? "local-chip" : "shared-chip") + "'>" +
                        (data ? "属性" : "关系") + "</span>";
                }
                showStep("config");
                refreshConfigFields();
            }

            function confirmRestriction() {
                var property = selectedProperty();
                if (!property) {
                    setStatus("请先选用一个属性或关系。", true);
                    return;
                }
                var data = isDataProperty(property);
                var parsed = readDefinitionRestrictionFromForm(rootForm, property.iri, data);
                if (parsed.error) {
                    setStatus(parsed.error, true);
                    return;
                }
                members.push(parsed.member);
                hideModal();
                persistClassDefinition(members, "为 " + labelOf(cls) + " 的定义添加约束");
            }

            rootForm.querySelectorAll("[data-def-kind]").forEach(function (button) {
                button.addEventListener("click", function () {
                    kindFilter = button.getAttribute("data-def-kind") || "all";
                    rootForm.querySelectorAll("[data-def-kind]").forEach(function (btn) {
                        btn.classList.toggle("is-active", btn.getAttribute("data-def-kind") === kindFilter);
                    });
                    catalogPage = 1;
                    renderRestrictionCatalog();
                });
            });
            if (searchInput) {
                searchInput.addEventListener("input", function () {
                    catalogQuery = searchInput.value || "";
                    catalogPage = 1;
                    renderRestrictionCatalog();
                });
                searchInput.focus();
            }
            var constraintSelect = rootForm.querySelector("[name='constraint']");
            if (constraintSelect) {
                constraintSelect.addEventListener("change", refreshConfigFields);
            }
            rootForm.querySelector("#def-restriction-next").addEventListener("click", openConfigStep);
            rootForm.querySelector("#def-restriction-back").addEventListener("click", function () {
                showStep("catalog");
            });
            rootForm.querySelector("#def-restriction-ok").addEventListener("click", confirmRestriction);
            renderRestrictionCatalog();
            showStep("catalog");
        }

        function openEditDefinitionMemberDialog(index, cls) {
            var members = currentDefinitionMembers();
            var member = members[index];
            if (!member) {
                return;
            }
            if (member.kind === "class") {
                var options = Object.keys(state.model.classes).filter(function (classIri) {
                    return classIri !== state.selected && classIri !== OWL_THING;
                }).map(function (classIri) {
                    return "<option value='" + escapeHtml(classIri) + "'" + (classIri === member.iri ? " selected" : "") + ">" + escapeHtml(labelOf(state.model.classes[classIri])) + "</option>";
                }).join("");
                showModal(
                    "<form id='edit-def-form'><h2>编辑定义中的父类</h2>" +
                    "<label class='field-row'><span>父类</span><select name='parent' required>" + options + "</select></label>" +
                    "<div class='actions'><button type='button' id='cancel'>取消</button><button type='submit'>保存</button></div></form>"
                );
                root.querySelector("#edit-def-form").addEventListener("submit", function (event) {
                    event.preventDefault();
                    var parentIri = new FormData(event.target).get("parent");
                    if (!parentIri) {
                        return;
                    }
                    if (members.some(function (item, i) { return i !== index && item.kind === "class" && item.iri === parentIri; })) {
                        setStatus("该父类已在定义中。", true);
                        return;
                    }
                    members[index] = {kind: "class", iri: parentIri};
                    hideModal();
                    persistClassDefinition(members, "更新 " + labelOf(cls) + " 定义中的父类");
                });
                return;
            }
            var property = state.model.dataProperties[member.propertyIri] || state.model.objectProperties[member.propertyIri] || {
                iri: member.propertyIri,
                labels: [],
                ranges: [member.filler]
            };
            var mode = member.mode || "value";
            showModal(
                "<form id='edit-def-form'><h2>编辑定义约束 · " + escapeHtml(labelOf(property)) + "</h2>" +
                "<p class='hint'>推荐使用「具体值」；类型量词仅表示存在某类取值，不等于某个实例/字面量。</p>" +
                "<label class='field-row'><span>约束</span>" + definitionConstraintSelectHtml(mode) + "</label>" +
                "<div id='def-restriction-fields'></div>" +
                "<label class='field-row constraint-n-row'><span>个数 N</span>" + cardinalityInputHtml({mode: mode, n: member.n}) + "</label>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button><button type='submit'>保存</button></div></form>"
            );
            var form = root.querySelector("#edit-def-form");
            function refreshEditFields() {
                renderDefinitionRestrictionFields(form, !!member.isData, property, member);
            }
            form.querySelector("[name='constraint']").addEventListener("change", refreshEditFields);
            refreshEditFields();
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var parsed = readDefinitionRestrictionFromForm(form, member.propertyIri, !!member.isData);
                if (parsed.error) {
                    setStatus(parsed.error, true);
                    return;
                }
                members[index] = parsed.member;
                hideModal();
                persistClassDefinition(members, "更新 " + labelOf(cls) + " 定义中的 " + labelOf(property));
            });
        }

        function renderIndividual(individualIri, fields) {
            var individual = state.model.individuals[individualIri];
            var lines = [];
            state.model.dataAssertions.filter(function (assertion) {
                return assertion.individual === individualIri;
            }).forEach(function (assertion) {
                var property = state.model.dataProperties[assertion.property];
                lines.push("<li>" + escapeHtml(labelOf(property || {iri: assertion.property, labels: []})) + "：" + escapeHtml(assertion.literal.value) + "</li>");
            });
            state.model.objectAssertions.filter(function (assertion) {
                return assertion.source === individualIri;
            }).forEach(function (assertion) {
                var property = state.model.objectProperties[assertion.property];
                var target = state.model.individuals[assertion.target] || {iri: assertion.target, labels: []};
                lines.push("<li>" + escapeHtml(labelOf(property || {iri: assertion.property, labels: []})) + "：" + escapeHtml(labelOf(target)) + "</li>");
            });
            var total = fields.data.length + fields.object.length;
            var typeText = individualTypeLabel(state.model, individualIri);
            var meta = "<p class='card-meta'>所属类：" + escapeHtml(typeText) +
                " · 已填 " + lines.length + " / 可配 " + total + "</p>";
            return "<article class='clickable' data-edit-individual='" + escapeHtml(individualIri) + "'><div class='card-head'><h3>" + escapeHtml(labelOf(individual)) + "</h3><div class='card-actions'><button type='button'>编辑</button><button type='button' class='danger' data-delete-individual='" + escapeHtml(individualIri) + "'>删除</button></div></div>" + meta + "<ul>" + (lines.join("") || "<li>还没有填写值，点此配置</li>") + "</ul></article>";
        }

        function classOptions(model) {
            return Object.keys(model.classes).filter(function (classIri) {
                return classIri !== OWL_THING;
            }).map(function (classIri) {
                return "<option value='" + escapeHtml(classIri) + "'>" + escapeHtml(labelOf(model.classes[classIri])) + "</option>";
            }).join("");
        }

        function datatypeLabel(datatype) {
            var found = DATATYPES.filter(function (type) { return type.iri === datatype; })[0];
            return found ? found.label : localName(datatype);
        }

        function openClassDialog() {
            var parent = state.model.classes[state.selected];
            showModal("<form id='class-form'><h2>新建子类</h2><p>父类：" + escapeHtml(labelOf(parent)) + "</p><input name='name' required placeholder='类名称'><div class='actions'><button type='button' id='cancel'>取消</button><button type='submit'>创建</button></div></form>");
            root.querySelector("#class-form").addEventListener("submit", function (event) {
                event.preventDefault();
                var name = new FormData(event.target).get("name").trim();
                if (!name) {
                    return;
                }
                var parentIri = state.selected;
                if (isModelClass(parentIri, state.model)) {
                    setStatus("请在元模型下创建子类；模型类请到「模型管理」中新建。", true);
                    return;
                }
                var created = axiomsForClass(parentIri, name, ROLE_METAMODEL);
                state.selected = created.iri;
                hideModal();
                submitAxioms(created.axioms, "创建元模型类 " + name);
            });
        }

        function openRenameClassDialog() {
            if (state.selected === OWL_THING) {
                return;
            }
            var cls = state.model.classes[state.selected];
            var current = labelOf(cls);
            showModal("<form id='rename-class-form'><h2>重命名类</h2><label class='field-row'><span>名称</span><input name='name' required value='" + escapeHtml(current) + "'></label><div class='actions'><button type='button' id='cancel'>取消</button><button type='submit'>保存</button></div></form>");
            root.querySelector("#rename-class-form").addEventListener("submit", function (event) {
                event.preventDefault();
                var name = new FormData(event.target).get("name").trim();
                if (!name || name === current) {
                    hideModal();
                    return;
                }
                var toDelete = findLabelAxioms(state.axioms, state.selected);
                hideModal();
                replaceAxioms(toDelete, labelAxioms(state.selected, name), "重命名类为 " + name);
            });
        }

        function confirmDeleteClass() {
            if (state.selected === OWL_THING) {
                return;
            }
            var cls = state.model.classes[state.selected];
            var name = labelOf(cls);
            var childCount = childrenOf(state.model, state.selected).length;
            var individualCount = individualsOf(state.model, state.selected).length;
            var fields = fieldsOf(state.model, state.selected);
            var toDelete = collectClassDeleteAxioms(state.model, state.axioms, state.selected);
            showModal(
                "<div id='delete-class-form'><h2>删除类</h2>" +
                "<p>确认删除「" + escapeHtml(name) + "」？会一并移除其子类关联、该类上的属性/关系、实例及相关公理（约 " + toDelete.length + " 条）。</p>" +
                "<p class='hint'>当前：子类 " + childCount + " 个，直接实例 " + individualCount + " 个，属性 " + fields.data.length + " 个，关系 " + fields.object.length + " 个。</p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button><button type='button' id='confirm-delete' class='danger'>确认删除</button></div></div>"
            );
            root.querySelector("#confirm-delete").addEventListener("click", function () {
                hideModal();
                var parent = state.model.subclassOf.filter(function (edge) {
                    return edge.child === state.selected;
                })[0];
                var fallback = parent ? parent.parent : OWL_THING;
                setStatus("正在删除类…");
                deleteAxioms(toDelete, "删除类 " + name).then(function () {
                    state.selected = fallback;
                    return loadOntology();
                }).then(function () {
                    setStatus("已删除类 " + name + "。");
                }).catch(function (error) {
                    setStatus(error.message || String(error), true);
                });
            });
        }

        function openEditPropertyDialog(propertyIri, isData, options) {
            options = options || {};
            var property = isData ? state.model.dataProperties[propertyIri] : state.model.objectProperties[propertyIri];
            if (!property) {
                return;
            }
            var currentName = labelOf(property);
            var currentRange = property.ranges[0] || (isData ? (XSD + "string") : OWL_THING);
            var linkedHere = propertyLinkedToClass(property, state.selected);
            var currentConstraint = findRestrictionOnClass(property, state.selected);
            var currentFacet = propertyTabOf(property, isData, state.selected, state.model);
            var fixedFacet = normalizeFacet(options.fixedFacet) || "";
            // Only the 功能 Tab (or explicit fixedFacet) uses the function-code editor.
            var functionMode = fixedFacet === "function" || (!options.fromCatalog && state.classTab === "function");
            var lockedFacet = functionMode
                ? "function"
                : (normalizeFacet(currentFacet) || normalizeFacet(state.classTab) || (isData ? "technicalParam" : "relation"));
            var currentFunctionCode = functionCodeOf(property, state.selected, state.model);
            var rangeControl;
            var unitControl;
            var constraintBlock;
            if (functionMode) {
                rangeControl = "<input type='hidden' name='range' value='" + escapeHtml(currentRange || (XSD + "string")) + "'>";
                unitControl = "";
                constraintBlock = linkedHere
                    ? ("<input type='hidden' name='facet' value='function'>" +
                        "<input type='hidden' name='constraint' value='some'>" +
                        "<input type='hidden' name='cardinality' value='1'>" +
                        "<label class='field-row function-code-row'><span>功能代码</span>" +
                        "<textarea name='functionCode' rows='5' placeholder='例如：Employee(?x) :- Person(?x), worksFor(?x, ?y)'>" +
                        escapeHtml(currentFunctionCode) + "</textarea>" +
                        "<span class='hint'>保存在本类 SubClassOf 的 benti:functionCode 注解中。</span></label>")
                    : "<p class='hint'>当前类尚未挂接该功能，请先在功能 Tab 中选用或新建。</p>";
            } else {
                rangeControl = isData
                    ? "<label class='field-row'><span>取值类型</span><select name='range'>" + DATATYPES.map(function (type) {
                        return "<option value='" + type.iri + "'" + (type.iri === currentRange ? " selected" : "") + ">" + type.label + "</option>";
                    }).join("") + "</select></label>"
                    : "<label class='field-row'><span>目标类</span><select name='range'>" + classOptions(state.model) + "</select></label>";
                unitControl = "<label class='field-row'><span>量纲</span><input name='unit' value='" + escapeHtml(property.uiUnit || "") + "' placeholder='例如：千米/小时，可空'></label>";
                constraintBlock = linkedHere
                    ? ("<input type='hidden' name='facet' value='" + escapeHtml(lockedFacet) + "'>" +
                        "<label class='field-row'><span>本类约束</span>" + constraintSelectHtml(currentConstraint.mode) + "</label>" +
                        "<label class='field-row constraint-n-row'><span>个数 N</span>" + cardinalityInputHtml(currentConstraint) + "</label>")
                    : "<p class='hint'>当前类尚未挂接该" + (isData ? "属性" : "关系") + "，本次只改名称、类型与量纲。</p>";
            }
            showModal(
                "<form id='edit-property-form'><h2>编辑" + (functionMode ? "功能" : (isData ? "属性" : "关系")) + "</h2>" +
                "<p class='hint'>" + (functionMode
                    ? "只需修改名称与功能代码；取值类型默认字符串，约束保持「至少有一个」。"
                    : "名称、类型、量纲为属性全局设置；本类约束属于当前类对该属性的用法。") + "</p>" +
                "<label class='field-row'><span>名称</span><input name='name' required value='" + escapeHtml(currentName) + "'></label>" +
                rangeControl +
                unitControl +
                constraintBlock +
                "<div class='actions'><button type='button' id='cancel'>取消</button><button type='submit'>保存</button></div></form>",
                {stacked: !!options.stacked}
            );
            var form = root.querySelector("#edit-property-form");
            if (!functionMode && !isData) {
                var select = form.querySelector("select[name='range']");
                if (select) {
                    select.value = currentRange;
                }
            }
            if (!functionMode) {
                bindConstraintToggle(form);
            }
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var data = new FormData(event.target);
                var name = data.get("name").trim();
                var range = data.get("range") || (functionMode ? (XSD + "string") : "");
                if (!name || !range) {
                    return;
                }
                var nextFacet = lockedFacet;
                var unit = functionMode ? "" : String(data.get("unit") || "").trim();
                // functionCode only editable on 功能 Tab; preserve existing when saving elsewhere.
                var functionCode = functionMode
                    ? String(data.get("functionCode") || "").trim()
                    : (nextFacet === "function" ? currentFunctionCode : "");
                var toDelete = findLabelAxioms(state.axioms, propertyIri)
                    .concat(findPropertyRangeAxioms(state.axioms, propertyIri, isData))
                    .concat(findAnnotationAxioms(state.axioms, propertyIri, "uiUnit"));
                var toAdd = labelAxioms(propertyIri, name).concat(
                    functionMode ? [] : unitAxioms(propertyIri, unit),
                    [
                        (isData || functionMode ? "DataPropertyRange(" : "ObjectPropertyRange(")
                        + iri(propertyIri) + " " + iri(range) + ")"
                    ]
                );
                if (linkedHere) {
                    var constraint = functionMode
                        ? {mode: "some", n: 1}
                        : readConstraintFromForm(event.target);
                    var keepStateGraphRaw = stateGraphRawOf(property, state.selected, state.model);
                    toDelete = toDelete.concat(findClassPropertyLinkAxioms(state.axioms, state.selected, propertyIri, isData).filter(function (axiom) {
                        return axiom.indexOf("SubClassOf(") === 0;
                    }));
                    toAdd = toAdd.concat(
                        uiFacetDeclarationAxioms(nextFacet),
                        functionCodeDeclarationAxioms(functionCode),
                        stateGraphDeclarationAxioms(keepStateGraphRaw),
                        [classRestrictionAxiom(
                            state.selected,
                            propertyIri,
                            range,
                            isData || functionMode,
                            constraint,
                            nextFacet,
                            functionCode,
                            keepStateGraphRaw
                        )]
                    );
                    state.classTab = nextFacet === "general" ? "technicalParam" : nextFacet;
                }
                hideModal();
                replaceAxioms(toDelete, toAdd, "更新" + (functionMode ? "功能" : (isData ? "属性" : "关系")) + " " + name).then(function () {
                    if (typeof options.onSaved === "function") {
                        options.onSaved();
                    }
                    if (options.fromCatalog) {
                        openAddPropertyDialog(
                            state.model.classes[state.selected],
                            isData || functionMode,
                            functionMode ? "function" : state.classTab,
                            options.stacked ? {stacked: true, onSaved: options.onSaved} : {}
                        );
                    }
                });
            });
        }

        function confirmDeleteProperty(propertyIri, isData, options) {
            options = options || {};
            var property = isData ? state.model.dataProperties[propertyIri] : state.model.objectProperties[propertyIri];
            if (!property) {
                return;
            }
            var name = labelOf(property);
            var toDelete = findPropertyAxioms(state.axioms, propertyIri, isData);
            var domainText = propertyDomainSummary(state.model, property);
            var cls = state.model.classes[state.selected];
            showModal(
                "<div id='delete-property-form'><h2>删除" + (isData ? "属性" : "关系") + "</h2>" +
                "<p>确认删除「" + escapeHtml(name) + "」？这是<strong>全局删除</strong>，会移除声明、所有定义域（现用于：" +
                escapeHtml(domainText) + "）、Range 以及相关实例取值（共 " + toDelete.length + " 条公理）。</p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button><button type='button' id='confirm-delete' class='danger'>确认删除</button></div></div>",
                {stacked: !!options.stacked}
            );
            if (options.fromCatalog && cls) {
                var cancelBtn = root.querySelector("#cancel");
                if (cancelBtn) {
                    var freshCancel = cancelBtn.cloneNode(true);
                    cancelBtn.parentNode.replaceChild(freshCancel, cancelBtn);
                    freshCancel.addEventListener("click", function () {
                        openAddPropertyDialog(cls, isData, state.classTab, {
                            stacked: !!options.stacked,
                            onSaved: options.onSaved
                        });
                    });
                }
            }
            root.querySelector("#confirm-delete").addEventListener("click", function () {
                hideModal();
                setStatus("正在删除…");
                deleteAxioms(toDelete, "删除" + (isData ? "属性" : "关系") + " " + name).then(function () {
                    if (!isData && state.selectedProperty === propertyIri) {
                        state.selectedProperty = null;
                    }
                    return loadOntology();
                }).then(function () {
                    setStatus("已删除" + (isData ? "属性" : "关系") + " " + name + "。");
                    if (typeof options.onSaved === "function") {
                        options.onSaved();
                    }
                    if (options.fromCatalog) {
                        openAddPropertyDialog(state.model.classes[state.selected], isData, state.classTab, {
                            stacked: !!options.stacked,
                            onSaved: options.onSaved
                        });
                    }
                }).catch(function (error) {
                    setStatus(error.message || String(error), true);
                    if (options.fromCatalog) {
                        openAddPropertyDialog(state.model.classes[state.selected], isData, state.classTab, {
                            stacked: !!options.stacked,
                            onSaved: options.onSaved
                        });
                    }
                });
            });
        }

        function replaceAxioms(toDelete, toAdd, message) {
            setStatus("正在保存…");
            var step = toDelete.length ? deleteAxioms(toDelete, message + "（移除旧值）") : Promise.resolve();
            return step.then(function () {
                if (toAdd && toAdd.length) {
                    return submitAxioms(toAdd, message);
                }
                return loadOntology();
            }).catch(function (error) {
                setStatus(error.message || String(error), true);
            });
        }

        function openInstanceDialog(individualIri) {
            setStatus("正在加载该类的最新属性和关系…");
            return loadOntology().then(function () {
                showInstanceDialog(individualIri);
            });
        }

        function showInstanceDialog(individualIri, options) {
            options = options || {};
            var inlineHost = options.host || null;
            var editing = !!individualIri;
            var typeIri = options.typeIri
                || (editing ? primaryClassOfIndividual(state.model, individualIri, state.focusModel || state.selected) : "")
                || state.focusModel
                || state.selected;
            if (!typeIri || typeIri === OWL_THING || typeIri === UNTYPED || !state.model.classes[typeIri]) {
                setStatus("请先选择型号（模型）或元模型类，再录入实例。", true);
                return;
            }
            var cls = state.model.classes[typeIri];
            var fields = fieldsOf(state.model, typeIri);
            var currentName = editing ? labelOf(state.model.individuals[individualIri] || {iri: individualIri, labels: []}) : "";
            var currentData = {};
            var currentObject = {};
            if (editing) {
                state.model.dataAssertions.filter(function (assertion) {
                    return assertion.individual === individualIri;
                }).forEach(function (assertion) {
                    currentData[assertion.property] = assertion.literal.value;
                });
                state.model.objectAssertions.filter(function (assertion) {
                    return assertion.source === individualIri;
                }).forEach(function (assertion) {
                    var previous = currentObject[assertion.property];
                    if (!previous || (!isHttpIri(previous) && isHttpIri(assertion.target))) {
                        currentObject[assertion.property] = assertion.target;
                    }
                });
            }

            var classDataIris = {};
            var classObjectIris = {};
            fields.data.forEach(function (property) {
                classDataIris[property.iri] = true;
            });
            fields.object.forEach(function (property) {
                classObjectIris[property.iri] = true;
            });

            // Unified lists: class/ancestor fields first, then any other asserted properties.
            var allDataProps = fields.data.slice();
            var allObjectProps = fields.object.slice();
            Object.keys(currentData).forEach(function (propertyIri) {
                if (!classDataIris[propertyIri] && state.model.dataProperties[propertyIri]) {
                    allDataProps.push(state.model.dataProperties[propertyIri]);
                }
            });
            Object.keys(currentObject).forEach(function (propertyIri) {
                if (!classObjectIris[propertyIri] && state.model.objectProperties[propertyIri]) {
                    allObjectProps.push(state.model.objectProperties[propertyIri]);
                }
            });

            function propertyUsed(isData) {
                var used = {};
                (isData ? allDataProps : allObjectProps).forEach(function (property) {
                    used[property.iri] = true;
                });
                return used;
            }

            function sourceChipHtml(property, isData) {
                var onClass = isData ? classDataIris[property.iri] : classObjectIris[property.iri];
                if (!onClass) {
                    return "<span class='meta-chip extra-chip'>其它</span>";
                }
                var sourceIri = fieldSourceIri(state.model, property, typeIri);
                var sourceLabel = labelOf(state.model.classes[sourceIri] || {iri: sourceIri, labels: []});
                var inherited = sourceIri !== typeIri;
                return "<span class='meta-chip" + (inherited ? " inherited-chip" : "") + "'>" +
                    escapeHtml(sourceLabel) + (inherited ? " · 继承" : " · 本类") + "</span>";
            }

            function instancePager(tableKey, total) {
                var pages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE) || 1);
                if (!total) {
                    return "";
                }
                return [
                    "<div class='table-pager instance-pager' data-instance-pager='" + tableKey + "' data-pages='" + pages + "'>",
                    "<span class='pager-info'>共 " + total + " 项" + (total > TABLE_PAGE_SIZE ? " · 每页 " + TABLE_PAGE_SIZE + " 条" : "") + "</span>",
                    total > TABLE_PAGE_SIZE
                        ? "<div class='pager-actions'>" +
                            "<button type='button' data-inst-page-key='" + tableKey + "' data-inst-page-delta='-1'>上一页</button>" +
                            "<span class='pager-page-label'>第 <em data-inst-page-label='" + tableKey + "'>1</em> / " + pages + " 页</span>" +
                            "<button type='button' data-inst-page-key='" + tableKey + "' data-inst-page-delta='1'>下一页</button>" +
                          "</div>"
                        : "",
                    "</div>"
                ].join("");
            }

            var inheritedCount = fields.data.concat(fields.object).filter(function (property) {
                return fieldSourceIri(state.model, property, typeIri) !== typeIri;
            }).length;

            function instanceFacetOf(property, isData) {
                return propertyTabOf(property, isData, typeIri, state.model)
                    || (isData ? "technicalParam" : "relation");
            }

            function buildDataRowHtml(property, index) {
                var value = currentData[property.iri] || "";
                var page = Math.floor(index / TABLE_PAGE_SIZE) + 1;
                var filled = !!value;
                var datatype = property.ranges[0] || (XSD + "string");
                var facet = instanceFacetOf(property, true);
                var control = dataFieldControlHtml(datatype, index, value)
                    .replace("data-kind='data'", "data-kind='data' data-property='" + escapeHtml(property.iri) + "'");
                var code = functionCodeOf(property, typeIri, state.model);
                var extra = facet === "function" && code
                    ? ("<div class='hint' title='" + escapeHtml(code) + "'>功能代码：" +
                        escapeHtml(code.length > 48 ? code.slice(0, 48) + "…" : code) + "</div>")
                    : (facet === "behavior" && behaviorHasStateGraph(property, typeIri, state.model)
                        ? "<span class='behavior-sm-badge'>有状态机</span>"
                        : "");
                return "<tr class='inst-page-row' data-inst-table='data' data-inst-facet='" + escapeHtml(facet) +
                    "' data-inst-page='" + page +
                    "' data-property-iri='" + escapeHtml(property.iri) + "'" +
                    (page === 1 ? "" : " hidden") + ">" +
                    "<td>" + escapeHtml(labelOf(property)) + extra + "</td>" +
                    "<td>" + sourceChipHtml(property, true) + "</td>" +
                    "<td>" + escapeHtml(datatypeLabel(property.ranges[0])) + "</td>" +
                    "<td>" + escapeHtml(property.uiUnit || "—") + "</td>" +
                    "<td><span class='status-pill" + (filled ? " filled" : "") + "'>" + (filled ? "已填" : "未填") + "</span></td>" +
                    "<td><div class='inst-value-cell'>" + control +
                    "<button type='button' class='ghost inst-clear' data-clear-data='" + escapeHtml(property.iri) + "'" +
                    (filled ? "" : " hidden") + ">清除</button>" +
                    "</div></td></tr>";
            }

            function buildObjectRowHtml(property, index) {
                var range = property.ranges[0] || OWL_THING;
                var selectedTarget = currentObject[property.iri] || "";
                var targets = relationTargets(state.model, range);
                var candidateFilter = individualIri
                    ? swrlObjectCandidateValues(individualIri, property.iri)
                    : null;
                targets = filterRelationTargetsBySwrlCandidates(targets, candidateFilter, selectedTarget);
                var rangeIsThing = !range || range === OWL_THING;
                var options = ["<option value=''>不填</option>"].concat(targets.map(function (targetIri) {
                    var selected = targetIri === selectedTarget ? " selected" : "";
                    var extra = rangeIsThing ? "（" + individualTypeLabel(state.model, targetIri) + "）" : "";
                    return "<option value='" + escapeHtml(targetIri) + "'" + selected + ">" +
                        escapeHtml(labelOf(state.model.individuals[targetIri] || {iri: targetIri, labels: []})) + extra + "</option>";
                })).join("");
                var filterNote = candidateFilter
                    ? ("<div class='hint' style='margin-top:4px;font-size:12px'>已按 SWRL 候选过滤（" + candidateFilter.length + " 项）</div>")
                    : "";
                var page = Math.floor(index / TABLE_PAGE_SIZE) + 1;
                var filled = !!selectedTarget;
                var facet = instanceFacetOf(property, false);
                return "<tr class='inst-page-row' data-inst-table='object' data-inst-facet='" + escapeHtml(facet) +
                    "' data-inst-page='" + page +
                    "' data-property-iri='" + escapeHtml(property.iri) + "'" +
                    (page === 1 ? "" : " hidden") + ">" +
                    "<td>" + escapeHtml(labelOf(property)) + "</td>" +
                    "<td>" + sourceChipHtml(property, false) + "</td>" +
                    "<td>" + escapeHtml(labelOf(state.model.classes[range] || {iri: range, labels: []})) + "</td>" +
                    "<td><span class='status-pill" + (filled ? " filled" : "") + "'>" + (filled ? "已填" : "未填") + "</span></td>" +
                    "<td><select class='cell-input' data-kind='object' data-property='" + escapeHtml(property.iri) +
                    "' data-index='" + index + "'>" + options + "</select>" + filterNote + "</td>" +
                    "<td><input class='cell-input' data-kind='object-new' data-property='" + escapeHtml(property.iri) +
                    "' data-index='" + index + "' placeholder='或新建实例名'></td>" +
                    "<td class='col-actions'>" +
                    "<button type='button' class='inst-detail' data-detail-object='" +
                    escapeHtml(property.iri) + "' data-detail-range='" + escapeHtml(range) + "'" +
                    (selectedTarget ? "" : " hidden") + ">详情</button>" +
                    "<button type='button' class='ghost inst-clear' data-clear-object='" +
                    escapeHtml(property.iri) + "'" + (filled ? "" : " hidden") + ">清除</button></td>" +
                    "</tr>";
            }

            function countFilledData() {
                var filled = 0;
                allDataProps.forEach(function (property) {
                    if (currentData[property.iri]) {
                        filled += 1;
                    }
                });
                return filled;
            }

            function countFilledObject() {
                var filled = 0;
                allObjectProps.forEach(function (property) {
                    if (currentObject[property.iri]) {
                        filled += 1;
                    }
                });
                return filled;
            }

            var dataRows = allDataProps.map(function (property, index) {
                return buildDataRowHtml(property, index);
            }).join("");

            var objectRows = allObjectProps.map(function (property, index) {
                return buildObjectRowHtml(property, index);
            }).join("");

            function belongingClassChipsHtml() {
                var iris = [];
                var seen = {};
                function addIri(iriValue) {
                    if (!iriValue || seen[iriValue]) {
                        return;
                    }
                    // Skip synthetic untyped bucket
                    if (iriValue === UNTYPED) {
                        return;
                    }
                    seen[iriValue] = true;
                    iris.push(iriValue);
                }
                addIri(typeIri);
                if (editing) {
                    assertedClassIris(state.model, individualIri).forEach(addIri);
                    (state.model.classAssertions || []).forEach(function (a) {
                        if (a.individual === individualIri && a.cls) {
                            addIri(a.cls);
                        }
                    });
                }
                if (!iris.length) {
                    return "<span class='meta-chip extra-chip'>未指定</span>";
                }
                return iris.map(function (iriValue) {
                    var text = labelOf(state.model.classes[iriValue] || {iri: iriValue, labels: []});
                    var canJump = !!(state.model.classes && state.model.classes[iriValue]);
                    if (!canJump) {
                        return "<span class='meta-chip' title='" + escapeHtml(iriValue) + "'>" +
                            escapeHtml(text) + "</span>";
                    }
                    return "<a href='#' class='meta-chip class-link-chip' data-goto-class='" +
                        escapeHtml(iriValue) + "' title='在类树中定位：" + escapeHtml(iriValue) + "'>" +
                        escapeHtml(text) + "</a>";
                }).join(" ");
            }

            var belongingRow =
                "<div class='instance-id-row'>" +
                "<span class='instance-id-label'>所属类</span>" +
                "<div class='instance-class-chips'>" + belongingClassChipsHtml() + "</div>" +
                "</div>";

            function facetPropertyCount(tabId) {
                var n = 0;
                allDataProps.forEach(function (property) {
                    if (instanceFacetOf(property, true) === tabId) {
                        n += 1;
                    }
                });
                allObjectProps.forEach(function (property) {
                    if (instanceFacetOf(property, false) === tabId) {
                        n += 1;
                    }
                });
                return n;
            }

            // Modal create flow should always start on 技术参数; keep last tab only for inline edit.
            if (!inlineHost || !state.instanceTab) {
                state.instanceTab = "technicalParam";
            }
            var instanceTabsHtml = "<div class='class-tabs instance-tabs' role='tablist'>" +
                FACET_TABS.map(function (tab) {
                    var n = tab.id === "general" ? 1 : facetPropertyCount(tab.id);
                    return "<button type='button' class='class-tab" + (state.instanceTab === tab.id ? " active" : "") +
                        "' data-instance-tab='" + tab.id + "'>" + tab.label +
                        " <em>" + n + "</em></button>";
                }).join("") + "</div>";

            // Name must stay outside facet panels: default tab is not「常规」, and a
            // required input inside [hidden] blocks submit ("not focusable") with no UI.
            // Editing: quiet text + pencil; creating: always show editable input.
            var nameFieldHtml = editing
                ? ("<div class='instance-name-field' data-name-mode='view'>" +
                    "<input name='name' id='instance-name-input' required readonly class='is-quiet' value='" +
                    escapeHtml(currentName) + "' placeholder='实例名称' autocomplete='off' title='点击铅笔编辑，回车确认，Esc 取消'>" +
                    "<button type='button' class='general-icon-btn' id='edit-instance-name' title='编辑名称（回车确认）' aria-label='编辑名称'>" +
                    "<span class='general-icon-pencil' aria-hidden='true'></span></button>" +
                    "</div>")
                : ("<input name='name' id='instance-name-input' required value='" +
                    escapeHtml(currentName) + "' placeholder='实例名称' autocomplete='off'>");
            var identityBlock =
                "<div class='instance-identity'>" +
                belongingRow +
                "<div class='instance-id-row instance-name-row'><span class='instance-id-label'>名称</span>" +
                nameFieldHtml +
                "</div></div>";

            var individualEntity = editing
                ? (state.model.individuals[individualIri] || {iri: individualIri, labels: [], comments: []})
                : null;
            var instanceComment = individualEntity ? (commentOf(individualEntity) || "") : "";
            var generalPanel =
                "<div class='inst-tab-panel' data-inst-panel='general'" +
                (state.instanceTab === "general" ? "" : " hidden") + ">" +
                "<section class='general-card instance-general-card'>" +
                "<div class='general-card-head'><span class='general-card-icon' aria-hidden='true'></span>" +
                "<h2>常规信息</h2></div>" +
                "<div class='general-prop-list'>" +
                renderGeneralPropRow("所属类", belongingClassChipsHtml(), "") +
                renderGeneralPropRow(
                    "名称",
                    "<span class='general-desc-text' id='instance-general-name'>" +
                    escapeHtml(currentName || "（未命名）") + "</span>",
                    ""
                ) +
                renderGeneralPropRow(
                    "描述",
                    instanceComment
                        ? ("<span class='general-desc-text' id='instance-general-comment'>" +
                            escapeHtml(instanceComment) + "</span>")
                        : "<span class='general-empty' id='instance-general-comment'>暂无描述</span>",
                    editing
                        ? ("<button type='button' class='general-icon-btn' id='edit-instance-comment' title='编辑描述' aria-label='编辑描述'>" +
                            "<span class='general-icon-pencil' aria-hidden='true'></span></button>")
                        : ""
                ) +
                "</div>" +
                "<p class='hint relation-basic-hint'>技术参数 / 状态变量 / 关系用于填写取值；功能与行为在对应 Tab 中配置（与元模型一致）。</p>" +
                "</section></div>";

            var initialDataFacetCount = allDataProps.filter(function (property) {
                return instanceFacetOf(property, true) === state.instanceTab;
            }).length;
            var initialObjectFacetCount = allObjectProps.filter(function (property) {
                return instanceFacetOf(property, false) === state.instanceTab;
            }).length;
            var dataSection =
                "<section class='instance-table-section' id='instance-data-section'>" +
                "<div class='instance-section-toolbar'>" +
                "<div class='instance-section-meta'>" +
                "<span class='instance-facet-pill'>当前分面 <strong id='instance-data-count'>" + initialDataFacetCount +
                "</strong> · <span id='instance-data-filled'>已填 " + countFilledData() + "</span></span>" +
                "</div>" +
                "<button type='button' class='primary' id='add-instance-data'>添加属性</button>" +
                "</div>" +
                "<div class='instance-search' data-instance-search='data'>" +
                "<input type='search' id='instance-data-filter' placeholder='按名称、类型模糊搜索…' autocomplete='off'>" +
                "<button type='button' class='instance-search-btn' data-instance-search-btn='data'>搜索</button>" +
                "</div>" +
                "<div class='data-table-wrap'><table class='data-table instance-entry-table'>" +
                "<thead><tr><th>名称</th><th>来源</th><th>类型</th><th>量纲</th><th>状态</th><th>取值</th></tr></thead>" +
                "<tbody id='instance-data-body'>" + (dataRows || "") + "</tbody></table></div>" +
                "<p class='empty panel-empty' id='instance-data-empty'" + (allDataProps.length ? " hidden" : "") +
                ">还没有属性。可点「添加属性」，或先在类上配置。</p>" +
                "<p class='empty panel-empty' id='instance-data-filter-empty' hidden>没有匹配的属性。</p>" +
                "<div id='instance-data-pager'>" + instancePager("data", allDataProps.length) + "</div>" +
                "</section>";

            var objectSection =
                "<section class='instance-table-section' id='instance-object-section'>" +
                "<div class='instance-section-toolbar'>" +
                "<div class='instance-section-meta'>" +
                "<span class='instance-facet-pill'>关系 <strong id='instance-object-count'>" +
                (state.instanceTab === "relation" ? allObjectProps.length : initialObjectFacetCount) +
                "</strong> · <span id='instance-object-filled'>已填 " + countFilledObject() + "</span></span>" +
                "</div>" +
                "<button type='button' class='primary' id='add-instance-object'>添加关系</button>" +
                "</div>" +
                "<div class='instance-search' data-instance-search='object'>" +
                "<input type='search' id='instance-object-filter' placeholder='按名称、目标类模糊搜索…' autocomplete='off'>" +
                "<button type='button' class='instance-search-btn' data-instance-search-btn='object'>搜索</button>" +
                "</div>" +
                "<div class='data-table-wrap'><table class='data-table instance-entry-table'>" +
                "<thead><tr><th>名称</th><th>来源</th><th>目标类</th><th>状态</th><th>选择实例</th><th>新建</th><th>操作</th></tr></thead>" +
                "<tbody id='instance-object-body'>" + (objectRows || "") + "</tbody></table></div>" +
                "<p class='empty panel-empty' id='instance-object-empty'" + (allObjectProps.length ? " hidden" : "") +
                ">还没有关系。可点「添加关系」，或先在类上配置。</p>" +
                "<p class='empty panel-empty' id='instance-object-filter-empty' hidden>没有匹配的关系。</p>" +
                "<div id='instance-object-pager'>" + instancePager("object", allObjectProps.length) + "</div>" +
                "</section>";

            var valueTabsHidden = state.instanceTab === "general"
                || state.instanceTab === "function"
                || state.instanceTab === "behavior";
            var showDataSection = !valueTabsHidden && state.instanceTab !== "relation";
            var showObjectSection = state.instanceTab === "relation";

            var fieldsPanel =
                "<div class='inst-tab-panel' data-inst-panel='fields'" +
                (valueTabsHidden ? " hidden" : "") + ">" +
                dataSection.replace(
                    "id='instance-data-section'>",
                    "id='instance-data-section'" + (showDataSection ? ">" : " hidden>")
                ) +
                objectSection.replace(
                    "id='instance-object-section'>",
                    "id='instance-object-section'" + (showObjectSection ? ">" : " hidden>")
                ) +
                "</div>";

            function buildInstanceFunctionPanelHtml() {
                var packed = propertiesForTab(fields, "function");
                var dataParts = partitionClassProperties(packed.data, typeIri);
                var objParts = partitionClassProperties(packed.object, typeIri);
                var rows = [];
                function pushRows(list, isData, inherited) {
                    (list || []).forEach(function (property) {
                        var sourceIri = inherited
                            ? fieldSourceIri(state.model, property, typeIri)
                            : typeIri;
                        var code = functionCodeOf(property, sourceIri, state.model);
                        var codePreview = code
                            ? escapeHtml(code.length > 72 ? code.slice(0, 72) + "…" : code)
                            : "—";
                        var actions = inherited
                            ? ("<span class='hint'>继承 · 只读</span>")
                            : ("<button type='button' data-inst-edit-function='" + escapeHtml(property.iri) +
                                "' data-kind='" + (isData ? "data" : "object") + "'>编辑功能代码</button>");
                        rows.push(
                            "<tr class='" + (inherited ? "is-inherited" : "is-local") + "'>" +
                            "<td>" + escapeHtml(labelOf(property)) +
                            (inherited ? " <span class='meta-chip inherited-chip'>继承</span>" : "") + "</td>" +
                            "<td class='function-code-cell' title='" + escapeHtml(code || "") + "'><code>" +
                            codePreview + "</code></td>" +
                            "<td class='col-actions'>" + actions + "</td></tr>"
                        );
                    });
                }
                pushRows(dataParts.local, true, false);
                pushRows(objParts.local, false, false);
                pushRows(dataParts.inherited, true, true);
                pushRows(objParts.inherited, false, true);
                var emptyMsg = "还没有功能。点击「添加功能」创建并填写功能代码（与类模式一致）。";
                return [
                    "<div class='instance-function-panel'>",
                    "<p class='hint'>功能与类模式一致：填写名称与功能代码，保存在本类 SubClassOf 的 <code>benti:functionCode</code> 注解中；此处不再按普通取值填写。</p>",
                    "<div class='behavior-list-toolbar'>",
                    "<button type='button' class='primary' id='inst-add-function'>+ 添加功能</button>",
                    "</div>",
                    "<div class='data-table-wrap'><table class='data-table'>",
                    "<thead><tr><th>名称</th><th>功能代码</th><th>操作</th></tr></thead>",
                    "<tbody>" + (rows.join("") || "<tr><td colspan='3' class='empty'>" + emptyMsg + "</td></tr>") +
                    "</tbody></table></div></div>"
                ].join("");
            }

            function buildInstanceBehaviorPanelHtml() {
                var rows = collectBehaviorRows(fields);
                var body = rows.map(function (row, index) {
                    var property = row.property;
                    var name = labelOf(property);
                    var desc = commentOf(property) || "";
                    var states = listBehaviorMachineStates(property, typeIri, state.model);
                    var hasGraph = states.length > 0;
                    var rawValue = currentData[property.iri] || "";
                    var selectedId = matchBehaviorStateId(states, rawValue);
                    var selectedLabel = behaviorStateLabel(states, selectedId);
                    var n = index + 1;
                    var seq = n < 10 ? ("0" + n) : String(n);
                    var marker = selectedId
                        ? ("<span class='behavior-state-chip' title='当前状态'>" +
                            escapeHtml(selectedLabel || selectedId) +
                            (selectedId !== selectedLabel
                                ? (" <code>" + escapeHtml(selectedId) + "</code>")
                                : "") +
                            "</span>")
                        : "<span class='behavior-state-chip is-empty'>未标记</span>";
                    var viewBtn = hasGraph
                        ? ("<button type='button' class='link' data-open-behavior-sm='" +
                            escapeHtml(property.iri) + "' data-kind='" +
                            (row.isData ? "data" : "object") + "'>查看状态机</button>")
                        : "<span class='hint'>未配置状态机</span>";
                    return "<tr class='behavior-row' data-behavior-iri='" + escapeHtml(property.iri) + "'>" +
                        "<td class='col-seq'>" + seq + "</td>" +
                        "<td><strong>" + escapeHtml(name) + "</strong>" +
                        (hasGraph ? "<span class='behavior-sm-badge'>状态机</span>" : "") +
                        (desc ? ("<div class='hint'>" + escapeHtml(desc) + "</div>") : "") +
                        "</td>" +
                        "<td class='col-state-mark'>" + marker + "</td>" +
                        "<td class='col-actions'>" + viewBtn + "</td></tr>";
                }).join("");
                var emptyMsg = "还没有行为。请先在元模型中为该类添加行为并配置状态机。";
                return [
                    "<div class='instance-behavior-panel'>",
                    "<p class='hint'>行为由类上的状态机描述；当前状态请在「查看状态机」中选中节点后点<strong>设为当前状态</strong>，本表仅展示已标记结果。</p>",
                    "<div class='data-table-wrap'>",
                    "<table class='data-table behavior-table instance-behavior-table'>",
                    "<thead><tr><th>#</th><th>行为</th><th>当前状态</th><th>操作</th></tr></thead>",
                    "<tbody>" + (body || "<tr><td colspan='4' class='empty'>" + emptyMsg + "</td></tr>") + "</tbody>",
                    "</table></div></div>"
                ].join("");
            }

            var functionPanel =
                "<div class='inst-tab-panel' data-inst-panel='function'" +
                (state.instanceTab === "function" ? "" : " hidden") + ">" +
                buildInstanceFunctionPanelHtml() +
                "</div>";

            var behaviorPanel =
                "<div class='inst-tab-panel' data-inst-panel='behavior'" +
                (state.instanceTab === "behavior" ? "" : " hidden") + ">" +
                buildInstanceBehaviorPanelHtml() +
                "</div>";

            var formHtml =
                "<form id='instance-form' class='instance-form" + (inlineHost ? " is-inline" : "") + "'>" +
                (inlineHost ? "" : ("<h2>" + (editing ? "编辑实例" : "新建实例") + "</h2>")) +
                (inlineHost
                    ? ""
                    : ("<p class='hint'>新建时：技术参数等填取值；功能/行为与类模式相同（功能代码、状态机）。" +
                        (inheritedCount ? "（含继承字段 " + inheritedCount + " 项）" : "") + "</p>")) +
                "<p class='hint form-error' id='instance-form-error' hidden></p>" +
                identityBlock +
                instanceTabsHtml +
                generalPanel +
                fieldsPanel +
                functionPanel +
                behaviorPanel +
                "<div class='actions'>" +
                (inlineHost ? "" : "<button type='button' id='cancel'>取消</button>") +
                (editing
                    ? "<button type='button' class='danger' id='delete-instance-inline'>删除</button>"
                    : "") +
                "<button type='submit'>" + (editing ? "保存" : "创建") + "</button></div>" +
                "</form>";

            var form;
            if (inlineHost) {
                inlineHost.innerHTML = formHtml;
                form = inlineHost.querySelector("#instance-form");
            } else {
                // Must bind the modal form — root may already contain an inline #instance-form.
                var modalRoot = showModal(formHtml);
                form = (modalRoot && modalRoot.querySelector("#instance-form"))
                    || root.querySelector("#modal #instance-form");
            }
            if (!form) {
                setStatus("无法打开实例编辑表单。", true);
                return;
            }
            var deleteInlineBtn = form.querySelector("#delete-instance-inline");
            if (deleteInlineBtn && editing) {
                deleteInlineBtn.addEventListener("click", function () {
                    confirmDeleteInstance(individualIri);
                });
            }
            var pageState = {data: 1, object: 1};
            var filterState = {data: "", object: ""};
            form.setAttribute("data-active-inst-tab", state.instanceTab || "technicalParam");
            var editNameBtn = form.querySelector("#edit-instance-name");
            var nameInput = form.querySelector("#instance-name-input");
            var nameField = form.querySelector(".instance-name-field");
            function setInstanceNameMode(mode) {
                if (!nameInput || !nameField) {
                    return;
                }
                var editingName = mode === "edit";
                nameField.setAttribute("data-name-mode", editingName ? "edit" : "view");
                nameInput.readOnly = !editingName;
                nameInput.classList.toggle("is-quiet", !editingName);
                if (editNameBtn) {
                    editNameBtn.hidden = editingName;
                }
            }
            function commitInstanceNameView() {
                var next = String(nameInput.value || "").trim();
                if (!next) {
                    setStatus("名称不能为空。", true);
                    nameInput.focus();
                    return false;
                }
                currentName = next;
                nameInput.value = next;
                var generalName = form.querySelector("#instance-general-name");
                if (generalName) {
                    generalName.textContent = next;
                }
                var heroTitle = root.querySelector("#detail .instance-hero h1");
                if (heroTitle && inlineHost) {
                    heroTitle.textContent = next;
                }
                setInstanceNameMode("view");
                return true;
            }
            function cancelInstanceNameEdit() {
                nameInput.value = currentName;
                setInstanceNameMode("view");
            }
            if (editNameBtn && nameInput) {
                editNameBtn.addEventListener("click", function () {
                    setInstanceNameMode("edit");
                    nameInput.focus();
                    try {
                        nameInput.select();
                    } catch (ignore) {}
                });
            }
            if (nameInput && editing) {
                nameInput.addEventListener("keydown", function (event) {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        cancelInstanceNameEdit();
                    } else if (event.key === "Enter") {
                        event.preventDefault();
                        commitInstanceNameView();
                    }
                });
                nameInput.addEventListener("blur", function () {
                    if (nameField && nameField.getAttribute("data-name-mode") === "edit") {
                        commitInstanceNameView();
                    }
                });
            }
            var editInstanceCommentBtn = form.querySelector("#edit-instance-comment");
            if (editInstanceCommentBtn && editing && individualIri) {
                editInstanceCommentBtn.addEventListener("click", function () {
                    showModal(
                        "<form id='edit-instance-comment-form'><h2>编辑描述</h2>" +
                        "<label class='field-row'><span>描述</span>" +
                        "<textarea name='comment' rows='3' placeholder='输入实例描述…'>" +
                        escapeHtml(instanceComment) + "</textarea></label>" +
                        "<div class='actions'><button type='button' id='cancel'>取消</button>" +
                        "<button type='submit'>保存</button></div></form>"
                    );
                    var commentForm = root.querySelector("#edit-instance-comment-form");
                    commentForm.addEventListener("submit", function (event) {
                        event.preventDefault();
                        var next = String(new FormData(commentForm).get("comment") || "").trim();
                        hideModal();
                        var toDelete = findAnnotationAxioms(state.axioms, individualIri, "rdf-schema#comment")
                            .concat(findAnnotationAxioms(state.axioms, individualIri, "rdfs:comment"));
                        replaceAxioms(
                            toDelete,
                            commentAxioms(individualIri, next),
                            "更新实例 " + (currentName || labelOf(individualEntity)) + " 的描述"
                        ).then(function () {
                            instanceComment = next;
                            var commentEl = form.querySelector("#instance-general-comment");
                            if (commentEl) {
                                commentEl.className = next ? "general-desc-text" : "general-empty";
                                commentEl.textContent = next || "暂无描述";
                            }
                        });
                    });
                });
            }
            form.querySelectorAll("[data-instance-tab]").forEach(function (button) {
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    var tabId = button.getAttribute("data-instance-tab") || "technicalParam";
                    state.instanceTab = tabId;
                    form.setAttribute("data-active-inst-tab", tabId);
                    pageState.data = 1;
                    pageState.object = 1;
                    syncInstanceTabs();
                    rebuildPager("data");
                    rebuildPager("object");
                    syncInstancePage("data");
                    syncInstancePage("object");
                });
            });

            function listForTable(tableKey) {
                return tableKey === "data" ? allDataProps : allObjectProps;
            }

            function propertyForRow(row, tableKey) {
                var iri = row.getAttribute("data-property-iri");
                var list = listForTable(tableKey);
                for (var i = 0; i < list.length; i++) {
                    if (list[i].iri === iri) {
                        return list[i];
                    }
                }
                return tableKey === "data"
                    ? state.model.dataProperties[iri]
                    : state.model.objectProperties[iri];
            }

            function activeInstanceTab() {
                return form.getAttribute("data-active-inst-tab") || state.instanceTab || "technicalParam";
            }

            function matchingRows(tableKey) {
                var isData = tableKey === "data";
                var query = filterState[tableKey] || "";
                var tabId = activeInstanceTab();
                return Array.prototype.slice.call(
                    form.querySelectorAll(".inst-page-row[data-inst-table='" + tableKey + "']")
                ).filter(function (row) {
                    if ((row.getAttribute("data-inst-facet") || "") !== tabId) {
                        return false;
                    }
                    return fuzzyTextMatch(
                        propertySearchText(state.model, propertyForRow(row, tableKey), isData),
                        query
                    );
                });
            }

            function syncInstanceTabs() {
                var tabId = activeInstanceTab();
                form.querySelectorAll("[data-instance-tab]").forEach(function (button) {
                    button.classList.toggle("active", button.getAttribute("data-instance-tab") === tabId);
                });
                form.querySelectorAll("[data-inst-panel]").forEach(function (panel) {
                    var kind = panel.getAttribute("data-inst-panel");
                    if (kind === "general") {
                        panel.hidden = tabId !== "general";
                    } else if (kind === "function") {
                        panel.hidden = tabId !== "function";
                    } else if (kind === "behavior") {
                        panel.hidden = tabId !== "behavior";
                    } else if (kind === "fields") {
                        panel.hidden = tabId === "general" || tabId === "function" || tabId === "behavior";
                    } else {
                        panel.hidden = tabId === "general";
                    }
                });
                var showData = tabId !== "general" && tabId !== "relation"
                    && tabId !== "function" && tabId !== "behavior";
                var showObject = tabId === "relation";
                var dataSec = form.querySelector("#instance-data-section");
                var objSec = form.querySelector("#instance-object-section");
                if (dataSec) {
                    dataSec.hidden = !showData;
                }
                if (objSec) {
                    objSec.hidden = !showObject;
                }
            }

            function refreshInstanceMetamodelPanels() {
                fields = fieldsOf(state.model, typeIri);
                fields.data.forEach(function (property) {
                    if (!classDataIris[property.iri]) {
                        classDataIris[property.iri] = true;
                        allDataProps.push(property);
                    }
                });
                fields.object.forEach(function (property) {
                    if (!classObjectIris[property.iri]) {
                        classObjectIris[property.iri] = true;
                        allObjectProps.push(property);
                    }
                });
                var fnPanel = form.querySelector("[data-inst-panel='function']");
                if (fnPanel) {
                    fnPanel.innerHTML = buildInstanceFunctionPanelHtml();
                    bindInstanceFunctionPanel();
                }
                var bhPanel = form.querySelector("[data-inst-panel='behavior']");
                if (bhPanel) {
                    bhPanel.innerHTML = buildInstanceBehaviorPanelHtml();
                    bindInstanceBehaviorPanel();
                }
                form.querySelectorAll("[data-instance-tab]").forEach(function (button) {
                    var tabId = button.getAttribute("data-instance-tab");
                    var n;
                    if (tabId === "general") {
                        n = 1;
                    } else if (tabId === "function" || tabId === "behavior") {
                        var packed = propertiesForTab(fields, tabId);
                        n = packed.data.length + packed.object.length;
                    } else {
                        n = facetPropertyCount(tabId);
                    }
                    var em = button.querySelector("em");
                    if (em) {
                        em.textContent = String(n);
                    }
                });
            }

            function instanceMetamodelOptions() {
                // Keep 新建实例 modal open: edit/add open as stacked overlays.
                return inlineHost
                    ? {}
                    : {stacked: true, onSaved: refreshInstanceMetamodelPanels};
            }

            function bindInstanceFunctionPanel() {
                var addBtn = form.querySelector("#inst-add-function");
                if (addBtn) {
                    addBtn.addEventListener("click", function (event) {
                        event.preventDefault();
                        openAddPropertyDialog(cls, true, "function", instanceMetamodelOptions());
                    });
                }
                form.querySelectorAll("[data-inst-edit-function]").forEach(function (button) {
                    button.addEventListener("click", function (event) {
                        event.preventDefault();
                        var opts = instanceMetamodelOptions();
                        opts.fixedFacet = "function";
                        openEditPropertyDialog(
                            button.getAttribute("data-inst-edit-function"),
                            button.getAttribute("data-kind") !== "object",
                            opts
                        );
                    });
                });
            }

            function bindInstanceBehaviorPanel() {
                form.querySelectorAll("[data-open-behavior-sm]").forEach(function (button) {
                    button.addEventListener("click", function (event) {
                        event.preventDefault();
                        if (button.disabled) {
                            return;
                        }
                        var propertyIri = button.getAttribute("data-open-behavior-sm");
                        var raw = currentData[propertyIri] || "";
                        var property = state.model.dataProperties[propertyIri]
                            || state.model.objectProperties[propertyIri];
                        var states = listBehaviorMachineStates(property, typeIri, state.model);
                        openBehaviorStateMachine(
                            propertyIri,
                            button.getAttribute("data-kind") !== "object",
                            {
                                instanceIri: individualIri || state.focusInstance || "",
                                instanceLabel: currentName || "",
                                currentStateId: matchBehaviorStateId(states, raw)
                            }
                        );
                    });
                });
            }

            function instancePagerHtml(tableKey, matchedTotal, allTotal) {
                var pages = Math.max(1, Math.ceil(matchedTotal / TABLE_PAGE_SIZE) || 1);
                if (!allTotal) {
                    return "";
                }
                var info = filterState[tableKey]
                    ? ("匹配 " + matchedTotal + " / 共 " + allTotal + " 项")
                    : ("共 " + allTotal + " 项");
                if (matchedTotal > TABLE_PAGE_SIZE) {
                    info += " · 每页 " + TABLE_PAGE_SIZE + " 条";
                }
                return [
                    "<div class='table-pager instance-pager' data-instance-pager='" + tableKey + "' data-pages='" + pages + "'>",
                    "<span class='pager-info'>" + info + "</span>",
                    matchedTotal > TABLE_PAGE_SIZE
                        ? "<div class='pager-actions'>" +
                            "<button type='button' data-inst-page-key='" + tableKey + "' data-inst-page-delta='-1'>上一页</button>" +
                            "<span class='pager-page-label'>第 <em data-inst-page-label='" + tableKey + "'>1</em> / " + pages + " 页</span>" +
                            "<button type='button' data-inst-page-key='" + tableKey + "' data-inst-page-delta='1'>下一页</button>" +
                          "</div>"
                        : "",
                    "</div>"
                ].join("");
            }

            function rebuildPager(tableKey) {
                var matched = matchingRows(tableKey);
                var host = form.querySelector(tableKey === "data" ? "#instance-data-pager" : "#instance-object-pager");
                if (host) {
                    host.innerHTML = instancePagerHtml(tableKey, matched.length, listForTable(tableKey).length);
                    host.querySelectorAll("[data-inst-page-key]").forEach(function (button) {
                        button.addEventListener("click", function (event) {
                            event.preventDefault();
                            if (button.disabled) {
                                return;
                            }
                            var key = button.getAttribute("data-inst-page-key");
                            pageState[key] = (pageState[key] || 1) + parseInt(button.getAttribute("data-inst-page-delta"), 10);
                            syncInstancePage(key);
                        });
                    });
                }
            }

            function reindexRows(tableKey) {
                var rows = form.querySelectorAll(".inst-page-row[data-inst-table='" + tableKey + "']");
                rows.forEach(function (row, index) {
                    var select = row.querySelector("[data-kind='object'], [data-kind='object-new'], [data-kind='data']");
                    if (select && select.hasAttribute("data-index")) {
                        select.setAttribute("data-index", String(index));
                    }
                    row.querySelectorAll("[data-index]").forEach(function (el) {
                        el.setAttribute("data-index", String(index));
                    });
                });
                pageState[tableKey] = 1;
                rebuildPager(tableKey);
                syncInstancePage(tableKey);
            }

            function syncInstancePage(tableKey) {
                var allRows = form.querySelectorAll(".inst-page-row[data-inst-table='" + tableKey + "']");
                var matched = matchingRows(tableKey);
                var total = matched.length;
                var pages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE) || 1);
                var page = pageState[tableKey] || 1;
                if (page < 1) {
                    page = 1;
                }
                if (page > pages) {
                    page = pages;
                }
                pageState[tableKey] = page;
                allRows.forEach(function (row) {
                    row.hidden = true;
                });
                matched.forEach(function (row, index) {
                    var rowPage = Math.floor(index / TABLE_PAGE_SIZE) + 1;
                    row.setAttribute("data-inst-page", String(rowPage));
                    row.hidden = rowPage !== page;
                });
                var label = form.querySelector("[data-inst-page-label='" + tableKey + "']");
                if (label) {
                    label.textContent = String(page);
                }
                form.querySelectorAll("[data-inst-page-key='" + tableKey + "']").forEach(function (button) {
                    var delta = parseInt(button.getAttribute("data-inst-page-delta"), 10);
                    button.disabled = (delta < 0 && page <= 1) || (delta > 0 && page >= pages);
                });
                var filterEmpty = form.querySelector(
                    tableKey === "data" ? "#instance-data-filter-empty" : "#instance-object-filter-empty"
                );
                var listEmpty = form.querySelector(
                    tableKey === "data" ? "#instance-data-empty" : "#instance-object-empty"
                );
                var hasFacetRows = Array.prototype.slice.call(allRows).some(function (row) {
                    return (row.getAttribute("data-inst-facet") || "") === activeInstanceTab();
                });
                if (filterEmpty) {
                    filterEmpty.hidden = !(hasFacetRows && filterState[tableKey] && !matched.length);
                }
                if (listEmpty) {
                    listEmpty.hidden = hasFacetRows;
                    if (!hasFacetRows) {
                        listEmpty.textContent = "该分面还没有字段。可点添加，或先在元模型中配置。";
                    }
                }
                var countEl = form.querySelector(
                    tableKey === "data" ? "#instance-data-count" : "#instance-object-count"
                );
                if (countEl) {
                    var facetTotal = Array.prototype.slice.call(allRows).filter(function (row) {
                        return (row.getAttribute("data-inst-facet") || "") === activeInstanceTab();
                    }).length;
                    countEl.textContent = filterState[tableKey]
                        ? (matched.length + " / " + facetTotal)
                        : String(facetTotal);
                }
            }

            function applyInstanceFilter(tableKey) {
                var input = form.querySelector(
                    tableKey === "data" ? "#instance-data-filter" : "#instance-object-filter"
                );
                filterState[tableKey] = input ? (input.value || "") : "";
                pageState[tableKey] = 1;
                rebuildPager(tableKey);
                syncInstancePage(tableKey);
            }

            function bindInstanceFilter(tableKey, inputId) {
                var input = form.querySelector(inputId);
                if (!input) {
                    return;
                }
                input.addEventListener("keydown", function (event) {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        applyInstanceFilter(tableKey);
                    }
                });
            }

            form.querySelectorAll("[data-instance-search-btn]").forEach(function (button) {
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    applyInstanceFilter(button.getAttribute("data-instance-search-btn") || "data");
                });
            });

            form.querySelectorAll("[data-inst-page-key]").forEach(function (button) {
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    if (button.disabled) {
                        return;
                    }
                    var key = button.getAttribute("data-inst-page-key");
                    pageState[key] = (pageState[key] || 1) + parseInt(button.getAttribute("data-inst-page-delta"), 10);
                    syncInstancePage(key);
                });
            });
            bindInstanceFilter("data", "#instance-data-filter");
            bindInstanceFilter("object", "#instance-object-filter");
            rebuildPager("data");
            rebuildPager("object");
            syncInstanceTabs();
            syncInstancePage("data");
            syncInstancePage("object");
            bindInstanceFunctionPanel();
            bindInstanceBehaviorPanel();

            function refreshDataFilledStatus(input) {
                var row = input.closest("tr");
                if (!row) {
                    return;
                }
                var pill = row.querySelector(".status-pill");
                var clearBtn = row.querySelector("[data-clear-data]");
                input.classList.remove("invalid");
                var filled = !!String(input.value || "").trim();
                if (pill) {
                    pill.classList.toggle("filled", filled);
                    pill.textContent = filled ? "已填" : "未填";
                }
                if (clearBtn) {
                    clearBtn.hidden = !filled;
                }
            }

            function refreshObjectFilledStatus(row) {
                if (!row) {
                    return;
                }
                var select = row.querySelector("[data-kind='object']");
                var newInput = row.querySelector("[data-kind='object-new']");
                var pill = row.querySelector(".status-pill");
                var clearBtn = row.querySelector("[data-clear-object]");
                var detailBtn = row.querySelector("[data-detail-object]");
                var selectedIri = select && select.value ? select.value : "";
                var filled = !!selectedIri || !!(newInput && newInput.value.trim());
                if (pill) {
                    pill.classList.toggle("filled", filled);
                    pill.textContent = filled ? "已填" : "未填";
                }
                if (clearBtn) {
                    clearBtn.hidden = !filled;
                }
                if (detailBtn) {
                    // 详情仅对已选中的已有实例开放（新建名尚未落库）
                    detailBtn.hidden = !selectedIri;
                }
            }

            function showInstanceFormMessage(text, isError) {
                var errorBox = form.querySelector("#instance-form-error");
                if (!errorBox) {
                    setStatus(text || "", !!isError);
                    return;
                }
                if (!text) {
                    errorBox.hidden = true;
                    errorBox.textContent = "";
                    return;
                }
                errorBox.hidden = false;
                errorBox.textContent = text;
                errorBox.classList.toggle("form-ok", !isError);
            }

            function refreshSectionMeta() {
                var dataCount = form.querySelector("#instance-data-count");
                var dataFilled = form.querySelector("#instance-data-filled");
                var dataEmpty = form.querySelector("#instance-data-empty");
                var objectCount = form.querySelector("#instance-object-count");
                var objectFilled = form.querySelector("#instance-object-filled");
                var objectEmpty = form.querySelector("#instance-object-empty");
                if (dataCount) {
                    dataCount.textContent = filterState.data
                        ? (matchingRows("data").length + " / " + allDataProps.length)
                        : String(allDataProps.length);
                }
                if (objectCount) {
                    objectCount.textContent = filterState.object
                        ? (matchingRows("object").length + " / " + allObjectProps.length)
                        : String(allObjectProps.length);
                }
                if (dataFilled) {
                    var filledD = 0;
                    allDataProps.forEach(function (property) {
                        var input = form.querySelector("[data-kind='data'][data-property='" + property.iri + "']");
                        if (input && String(input.value || "").trim()) {
                            filledD += 1;
                        } else if (!input && currentData[property.iri]) {
                            filledD += 1;
                        }
                    });
                    dataFilled.textContent = "已填 " + filledD;
                }
                if (objectFilled) {
                    var filledO = 0;
                    allObjectProps.forEach(function (property) {
                        var select = form.querySelector("[data-kind='object'][data-property='" + property.iri + "']");
                        var neu = form.querySelector("[data-kind='object-new'][data-property='" + property.iri + "']");
                        if ((select && select.value) || (neu && neu.value.trim()) || currentObject[property.iri]) {
                            filledO += 1;
                        }
                    });
                    objectFilled.textContent = "已填 " + filledO;
                }
                if (dataEmpty) {
                    dataEmpty.hidden = allDataProps.length > 0;
                }
                if (objectEmpty) {
                    objectEmpty.hidden = allObjectProps.length > 0;
                }
            }

            function bindDataRow(row) {
                if (!row) {
                    return;
                }
                var input = row.querySelector("[data-kind='data']");
                if (input) {
                    input.addEventListener("input", function () {
                        refreshDataFilledStatus(input);
                        refreshSectionMeta();
                    });
                    input.addEventListener("change", function () {
                        refreshDataFilledStatus(input);
                        refreshSectionMeta();
                    });
                }
                var clearBtn = row.querySelector("[data-clear-data]");
                if (clearBtn) {
                    clearBtn.addEventListener("click", function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                        var propertyIri = clearBtn.getAttribute("data-clear-data");
                        var property = state.model.dataProperties[propertyIri];
                        var field = row.querySelector("[data-kind='data']");
                        var previousValue = field ? String(field.value || "").trim() : (currentData[propertyIri] || "");
                        if (field) {
                            field.value = "";
                            refreshDataFilledStatus(field);
                        }
                        refreshSectionMeta();
                        if (!editing || !property || !individualIri) {
                            currentData[propertyIri] = "";
                            return;
                        }
                        clearBtn.disabled = true;
                        showInstanceFormMessage("正在清除「" + labelOf(property) + "」…", false);
                        clearInstancePropertyAssertion(
                            individualIri,
                            propertyIri,
                            true,
                            "清除实例属性 " + labelOf(property)
                        ).then(function (result) {
                            currentData[propertyIri] = "";
                            var removed = result && result.removedAxiomsCount ? result.removedAxiomsCount : 0;
                            showInstanceFormMessage(
                                removed
                                    ? ("已清除「" + labelOf(property) + "」的取值。")
                                    : ("「" + labelOf(property) + "」在本体中已无取值。"),
                                false
                            );
                            setStatus("已清除实例属性「" + labelOf(property) + "」。");
                        }).catch(function (error) {
                            showInstanceFormMessage(error.message || String(error), true);
                            setStatus(error.message || String(error), true);
                            if (field && previousValue) {
                                field.value = previousValue;
                                refreshDataFilledStatus(field);
                            }
                        }).then(function () {
                            clearBtn.disabled = false;
                            refreshSectionMeta();
                        });
                    });
                }
            }

            function bindObjectRow(row) {
                if (!row) {
                    return;
                }
                var select = row.querySelector("[data-kind='object']");
                var newInput = row.querySelector("[data-kind='object-new']");
                if (select) {
                    select.addEventListener("change", function () {
                        refreshObjectFilledStatus(row);
                        refreshSectionMeta();
                    });
                }
                if (newInput) {
                    newInput.addEventListener("input", function () {
                        refreshObjectFilledStatus(row);
                        refreshSectionMeta();
                    });
                }
                var detailBtn = row.querySelector("[data-detail-object]");
                if (detailBtn) {
                    detailBtn.addEventListener("click", function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                        var targetIri = select && select.value ? select.value : "";
                        if (!targetIri) {
                            showInstanceFormMessage("请先在「选择实例」中选中一个已有实例。", true);
                            return;
                        }
                        openInstanceDetailOverlay(
                            targetIri,
                            detailBtn.getAttribute("data-detail-range") || null
                        );
                    });
                }
                var clearBtn = row.querySelector("[data-clear-object]");
                if (clearBtn) {
                    clearBtn.addEventListener("click", function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                        var propertyIri = clearBtn.getAttribute("data-clear-object");
                        var property = state.model.objectProperties[propertyIri];
                        var previousTarget = (select && select.value) || currentObject[propertyIri] || "";
                        if (select) {
                            select.value = "";
                        }
                        if (newInput) {
                            newInput.value = "";
                        }
                        refreshObjectFilledStatus(row);
                        refreshSectionMeta();
                        if (!editing || !property || !individualIri) {
                            currentObject[propertyIri] = "";
                            showInstanceFormMessage("当前是新建实例，清除只会清空表单；保存前不会写入本体。", true);
                            return;
                        }
                        clearBtn.disabled = true;
                        showInstanceFormMessage("正在清除「" + labelOf(property) + "」…", false);
                        clearInstancePropertyAssertion(
                            individualIri,
                            propertyIri,
                            false,
                            "清除实例关系 " + labelOf(property)
                        ).then(function (result) {
                            currentObject[propertyIri] = "";
                            var removed = result && result.removedAxiomsCount ? result.removedAxiomsCount : 0;
                            showInstanceFormMessage(
                                removed
                                    ? ("已清除「" + labelOf(property) + "」。")
                                    : ("「" + labelOf(property) + "」在本体中已无该关系。"),
                                false
                            );
                            setStatus("已清除实例关系「" + labelOf(property) + "」。");
                        }).catch(function (error) {
                            showInstanceFormMessage(error.message || String(error), true);
                            setStatus(error.message || String(error), true);
                            if (select && previousTarget) {
                                select.value = previousTarget;
                                refreshObjectFilledStatus(row);
                            }
                        }).then(function () {
                            clearBtn.disabled = false;
                            refreshSectionMeta();
                        });
                    });
                }
            }

            function openAddInstancePropertyDialog(isData) {
                try {
                    var used = propertyUsed(isData);
                    var candidates = propertiesOutsideClassFields(state.model, typeIri, isData).filter(function (property) {
                        return !used[property.iri];
                    });
                    if (!candidates.length) {
                        candidates = allPropertiesOfKind(state.model, isData).filter(function (property) {
                            return property && property.iri && !used[property.iri];
                        });
                    }
                    if (!candidates.length) {
                        showInstanceFormMessage(
                            "没有可添加的" + (isData ? "属性" : "关系") + "。请先在类模式中创建，或确认尚未全部加入本表单。",
                            true
                        );
                        var tip = form.querySelector("#instance-form-error");
                        if (tip) {
                            tip.scrollIntoView({block: "nearest", behavior: "smooth"});
                        }
                        return;
                    }
                    document.querySelectorAll(".extra-property-picker-overlay").forEach(function (node) {
                        node.remove();
                    });
                    var selectedIri = candidates[0] ? candidates[0].iri : "";
                    var pickQuery = "";
                    var overlay = document.createElement("div");
                    overlay.className = "extra-property-picker-overlay";
                    overlay.setAttribute("role", "dialog");
                    overlay.setAttribute("aria-modal", "true");
                    overlay.innerHTML =
                        "<div class='extra-property-picker-card'>" +
                        "<h3>添加" + (isData ? "属性" : "关系") + "</h3>" +
                        "<p class='hint' id='extra-pick-hint'></p>" +
                        "<label class='field-row'><span>搜索</span>" +
                        "<input type='search' id='extra-pick-search' placeholder='按名称、类型、定义域模糊搜索…' autocomplete='off'></label>" +
                        "<div class='extra-pick-list' id='extra-pick-list' role='listbox'></div>" +
                        "<div class='actions'>" +
                        "<button type='button' id='extra-pick-cancel'>取消</button>" +
                        "<button type='button' id='extra-pick-ok'>添加</button>" +
                        "</div></div>";
                    document.body.appendChild(overlay);
                    var searchInput = overlay.querySelector("#extra-pick-search");
                    var listEl = overlay.querySelector("#extra-pick-list");
                    var hintEl = overlay.querySelector("#extra-pick-hint");

                    function filteredCandidates() {
                        return candidates.filter(function (property) {
                            return fuzzyTextMatch(propertySearchText(state.model, property, isData), pickQuery);
                        });
                    }

                    function renderPickList() {
                        var filtered = filteredCandidates();
                        if (selectedIri && !filtered.some(function (property) { return property.iri === selectedIri; })) {
                            selectedIri = filtered[0] ? filtered[0].iri : "";
                        }
                        hintEl.textContent = pickQuery
                            ? "匹配 " + filtered.length + " / 共 " + candidates.length + " 项"
                            : "共 " + candidates.length + " 项可选";
                        if (!filtered.length) {
                            var alreadyOnForm = (isData ? allDataProps : allObjectProps).filter(function (property) {
                                return fuzzyTextMatch(propertySearchText(state.model, property, isData), pickQuery);
                            });
                            if (pickQuery && alreadyOnForm.length) {
                                listEl.innerHTML =
                                    "<div class='extra-pick-empty'>" +
                                    "「" + escapeHtml(pickQuery) + "」已在当前表单中（本类/继承字段会自动带出），" +
                                    "无需再添加。请关闭此窗，在属性列表搜索框定位：<br><strong>" +
                                    escapeHtml(alreadyOnForm.map(function (p) { return labelOf(p); }).join("、")) +
                                    "</strong></div>";
                            } else {
                                listEl.innerHTML = "<div class='extra-pick-empty'>没有匹配项</div>";
                            }
                            return;
                        }
                        listEl.innerHTML = filtered.map(function (property) {
                            var hint = isData
                                ? datatypeLabel(property.ranges[0] || (XSD + "string"))
                                : labelOf(state.model.classes[property.ranges[0] || OWL_THING] || {iri: property.ranges[0] || OWL_THING, labels: []});
                            var domainHint = propertyDomainSummary(state.model, property);
                            var fit = propertyDomainFit(state.model, property, typeIri);
                            var active = property.iri === selectedIri ? " is-active" : "";
                            var fitChip = fit.fit === "conflict"
                                ? "<span class='meta-chip conflict-chip'>与当前类互斥</span>"
                                : (fit.fit === "cross"
                                    ? "<span class='meta-chip shared-chip'>跨定义域</span>"
                                    : "");
                            return "<button type='button' class='extra-pick-item" + active + (fit.fit === "conflict" ? " is-conflict" : "") +
                                "' role='option' data-iri='" + escapeHtml(property.iri) +
                                "' data-fit='" + fit.fit + "' aria-selected='" + (property.iri === selectedIri ? "true" : "false") + "'>" +
                                "<span class='extra-pick-name'>" + escapeHtml(labelOf(property)) + " " + fitChip + "</span>" +
                                "<span class='extra-pick-meta'>" + escapeHtml(hint) + " · " + escapeHtml(domainHint) + "</span>" +
                                "</button>";
                        }).join("");
                        listEl.querySelectorAll("[data-iri]").forEach(function (button) {
                            button.addEventListener("click", function () {
                                selectedIri = button.getAttribute("data-iri");
                                renderPickList();
                            });
                            button.addEventListener("dblclick", function (event) {
                                event.preventDefault();
                                selectedIri = button.getAttribute("data-iri");
                                confirmPick();
                            });
                        });
                        if (selectedIri) {
                            var selectedProp = isData
                                ? state.model.dataProperties[selectedIri]
                                : state.model.objectProperties[selectedIri];
                            var warn = propertyDomainFitMessage(state.model, selectedProp, typeIri);
                            if (warn) {
                                hintEl.innerHTML = escapeHtml(hintEl.textContent) + "<br><span class='form-error' style='display:inline'>" +
                                    escapeHtml(warn) + "</span>";
                            }
                        }
                    }

                    function closePicker() {
                        if (overlay.parentNode) {
                            overlay.parentNode.removeChild(overlay);
                        }
                    }

                    function confirmPick() {
                        var propertyIri = selectedIri;
                        if (!propertyIri || propertyUsed(isData)[propertyIri]) {
                            closePicker();
                            return;
                        }
                        var property = isData
                            ? state.model.dataProperties[propertyIri]
                            : state.model.objectProperties[propertyIri];
                        if (!property) {
                            closePicker();
                            return;
                        }
                        var fit = propertyDomainFit(state.model, property, typeIri);
                        if (fit.fit === "conflict") {
                            var msg = propertyDomainFitMessage(state.model, property, typeIri);
                            if (!window.confirm(msg + "\n\n仍要添加到表单吗？（填写并保存后通常会不一致）")) {
                                return;
                            }
                        } else if (fit.fit === "cross") {
                            var crossMsg = propertyDomainFitMessage(state.model, property, typeIri);
                            if (!window.confirm(crossMsg + "\n\n确认添加？")) {
                                return;
                            }
                        }
                        closePicker();
                        if (isData) {
                            allDataProps.push(property);
                            var dataBody = form.querySelector("#instance-data-body");
                            dataBody.insertAdjacentHTML("beforeend", buildDataRowHtml(property, allDataProps.length - 1));
                            bindDataRow(dataBody.lastElementChild);
                            filterState.data = labelOf(property);
                            var dataFilter = form.querySelector("#instance-data-filter");
                            if (dataFilter) {
                                dataFilter.value = filterState.data;
                            }
                            pageState.data = 1;
                            reindexRows("data");
                        } else {
                            allObjectProps.push(property);
                            var objectBody = form.querySelector("#instance-object-body");
                            objectBody.insertAdjacentHTML("beforeend", buildObjectRowHtml(property, allObjectProps.length - 1));
                            bindObjectRow(objectBody.lastElementChild);
                            filterState.object = labelOf(property);
                            var objectFilter = form.querySelector("#instance-object-filter");
                            if (objectFilter) {
                                objectFilter.value = filterState.object;
                            }
                            pageState.object = 1;
                            reindexRows("object");
                        }
                        refreshSectionMeta();
                        var fitNote = propertyDomainFitMessage(state.model, property, typeIri);
                        showInstanceFormMessage(
                            "已加入" + (isData ? "属性" : "关系") + "，填写取值后点保存即可写入本体。"
                            + (fitNote ? " " + fitNote : ""),
                            fit.fit === "conflict"
                        );
                    }

                    searchInput.addEventListener("input", function () {
                        pickQuery = searchInput.value || "";
                        renderPickList();
                    });
                    overlay.addEventListener("click", function (event) {
                        if (event.target === overlay) {
                            closePicker();
                        }
                    });
                    overlay.querySelector("#extra-pick-cancel").addEventListener("click", function (event) {
                        event.preventDefault();
                        closePicker();
                    });
                    overlay.querySelector("#extra-pick-ok").addEventListener("click", function (event) {
                        event.preventDefault();
                        confirmPick();
                    });
                    renderPickList();
                    searchInput.focus();
                } catch (error) {
                    showInstanceFormMessage(error.message || String(error), true);
                }
            }

            form.querySelectorAll("#instance-data-body tr").forEach(bindDataRow);
            form.querySelectorAll("#instance-object-body tr").forEach(bindObjectRow);

            form.querySelectorAll("[data-goto-class]").forEach(function (link) {
                link.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    var classIri = link.getAttribute("data-goto-class");
                    if (!classIri || !state.model.classes[classIri]) {
                        setStatus("类已不存在于当前本体。", true);
                        return;
                    }
                    hideModal();
                    state.selected = classIri;
                    state.focusInstance = null;
                    renderTree();
                    renderDetail();
                    focusTreeSelection();
                    setStatus("已定位到类「" + labelOf(state.model.classes[classIri]) + "」。");
                });
            });

            var addDataBtn = form.querySelector("#add-instance-data");
            if (addDataBtn) {
                addDataBtn.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    openAddInstancePropertyDialog(true);
                });
            }
            var addObjectBtn = form.querySelector("#add-instance-object");
            if (addObjectBtn) {
                addObjectBtn.addEventListener("click", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    openAddInstancePropertyDialog(false);
                });
            }
            refreshSectionMeta();

            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var nameInput = form.querySelector("input[name='name']");
                var name = nameInput ? String(nameInput.value || "").trim() : "";
                if (!name) {
                    showInstanceFormMessage("请填写实例名称。", true);
                    if (nameInput) {
                        nameInput.focus();
                    }
                    return;
                }
                var values = [];
                var errorBox = form.querySelector("#instance-form-error");
                var firstInvalid = null;
                var errorMessages = [];
                form.querySelectorAll("[data-kind='data'].invalid").forEach(function (input) {
                    input.classList.remove("invalid");
                });
                allDataProps.forEach(function (property) {
                    var facet = instanceFacetOf(property, true);
                    if (facet === "function") {
                        return;
                    }
                    if (facet === "behavior") {
                        var stateMark = String(currentData[property.iri] || "").trim();
                        if (stateMark) {
                            values.push({
                                kind: "data",
                                property: property.iri,
                                datatype: property.ranges[0] || (XSD + "string"),
                                text: stateMark
                            });
                        }
                        return;
                    }
                    var input = form.querySelector("[data-kind='data'][data-property='" + property.iri + "']");
                    var datatype = property.ranges[0] || (XSD + "string");
                    var checked = normalizeDataFieldValue(input ? input.value : "", datatype);
                    if (!checked.ok) {
                        if (input) {
                            input.classList.add("invalid");
                            if (!firstInvalid) {
                                firstInvalid = input;
                            }
                        }
                        errorMessages.push(labelOf(property) + "：" + checked.message);
                        return;
                    }
                    if (checked.text !== "") {
                        values.push({kind: "data", property: property.iri, datatype: datatype, text: checked.text});
                    }
                });
                if (errorMessages.length) {
                    if (errorBox) {
                        errorBox.hidden = false;
                        errorBox.textContent = errorMessages[0] + (errorMessages.length > 1 ? "（另有 " + (errorMessages.length - 1) + " 项）" : "");
                    }
                    if (firstInvalid) {
                        var invalidRow = firstInvalid.closest("tr");
                        if (invalidRow && invalidRow.hidden) {
                            pageState.data = parseInt(invalidRow.getAttribute("data-inst-page"), 10) || 1;
                            syncInstancePage("data");
                        }
                        firstInvalid.focus();
                    }
                    return;
                }
                if (errorBox) {
                    errorBox.hidden = true;
                    errorBox.textContent = "";
                }
                allObjectProps.forEach(function (property) {
                    var facet = instanceFacetOf(property, false);
                    if (facet === "function" || facet === "behavior") {
                        return;
                    }
                    var selectedTargetEl = form.querySelector("[data-kind='object'][data-property='" + property.iri + "']");
                    var createdNameEl = form.querySelector("[data-kind='object-new'][data-property='" + property.iri + "']");
                    var selectedTarget = selectedTargetEl ? selectedTargetEl.value : "";
                    var createdName = createdNameEl ? createdNameEl.value.trim() : "";
                    if (createdName) {
                        values.push({kind: "object-new", property: property.iri, range: property.ranges[0] || OWL_THING, name: createdName});
                    } else if (selectedTarget) {
                        values.push({kind: "object", property: property.iri, targetIri: selectedTarget});
                    }
                });
                if (!inlineHost) {
                    hideModal();
                }
                if (editing) {
                    var previousTypes = assertedClassIris(state.model, individualIri);
                    saveInstanceEdit(individualIri, name, values, fields).then(function () {
                        return classifyAfterSave(individualIri, name, previousTypes, true);
                    }).catch(function () { /* status already set */ });
                } else {
                    var created = axiomsForInstance(state.model, typeIri, name, values);
                    var primaryType = typeIri;
                    state.focusInstance = created.iri;
                    submitAxioms(created.axioms, "创建实例 " + name).then(function () {
                        return classifyAfterSave(created.iri, name, [primaryType], false);
                    }).catch(function () { /* status already set */ });
                }
            });
        }

        function assertedClassIris(model, individualIri) {
            var seen = {};
            return (model.classAssertions || []).filter(function (assertion) {
                return assertion.individual === individualIri && assertion.cls && assertion.cls !== OWL_THING;
            }).map(function (assertion) {
                return assertion.cls;
            }).filter(function (iri) {
                if (seen[iri]) {
                    return false;
                }
                seen[iri] = true;
                return true;
            });
        }

        function classLabel(iri) {
            return labelOf(state.model.classes[iri] || {iri: iri, labels: []});
        }

        function classifyAfterSave(individualIri, name, previousTypes, editing) {
            if (!individualIri) {
                return Promise.resolve();
            }
            setStatus("正在推理「" + name + "」的分类…");
            return fetch("/api/onto/reason/classify", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({projectId: state.projectId, individual: individualIri})
            }).then(function (response) {
                return response.json().then(function (body) {
                    return {ok: response.ok, status: response.status, body: body};
                });
            }).then(function (result) {
                if (!result.ok || (result.body && result.body.error)) {
                    setStatus((result.body && result.body.error) || ("分类失败（HTTP " + result.status + "）"), true);
                    showClassifyResultModal({
                        name: name,
                        individualIri: individualIri,
                        editing: editing,
                        consistent: false,
                        error: (result.body && result.body.error) || ("分类失败（HTTP " + result.status + "）"),
                        newTypes: [],
                        conflictTypes: [],
                        keptTypes: previousTypes || [],
                        elapsedMs: result.body && result.body.elapsedMs
                    });
                    return;
                }
                var inferred = (result.body.types || []).filter(function (iri) {
                    return iri && iri !== OWL_THING;
                });
                var previous = previousTypes || [];
                var previousSet = {};
                previous.forEach(function (iri) { previousSet[iri] = true; });
                var inferredSet = {};
                inferred.forEach(function (iri) { inferredSet[iri] = true; });
                var newTypes = inferred.filter(function (iri) {
                    if (previousSet[iri]) {
                        return false;
                    }
                    // Skip pure ancestor types already implied by an asserted subclass.
                    return !previous.some(function (asserted) {
                        var lineage = classLineage(state.model, asserted);
                        return lineage.indexOf(iri) >= 0 && iri !== asserted;
                    });
                });
                var conflictTypes = editing
                    ? previous.filter(function (iri) { return !inferredSet[iri]; })
                    : [];
                var keptTypes = previous.filter(function (iri) { return !!inferredSet[iri]; });
                if (!result.body.consistent) {
                    setStatus("本体不一致，未写入推断分类。", true);
                } else if (!newTypes.length && !conflictTypes.length) {
                    setStatus("已保存「" + name + "」，分类无变化" + (result.body.elapsedMs != null ? "（" + result.body.elapsedMs + " ms）" : "") + "。");
                } else {
                    setStatus("已保存「" + name + "」，请确认分类结果。");
                }
                showClassifyResultModal({
                    name: name,
                    individualIri: individualIri,
                    editing: editing,
                    consistent: !!result.body.consistent,
                    error: null,
                    newTypes: result.body.consistent ? newTypes : [],
                    conflictTypes: result.body.consistent ? conflictTypes : previous.slice(),
                    keptTypes: result.body.consistent ? keptTypes : previous.slice(),
                    elapsedMs: result.body.elapsedMs
                });
            }).catch(function (error) {
                setStatus(error.message || String(error), true);
            });
        }

        function showClassifyResultModal(info) {
            function typeList(iris, emptyText, chipClass) {
                if (!iris.length) {
                    return "<p class='empty panel-empty'>" + emptyText + "</p>";
                }
                return "<ul class='classify-list'>" + iris.map(function (iri) {
                    return "<li><span class='meta-chip " + chipClass + "'>" + escapeHtml(classLabel(iri)) + "</span>" +
                        "<code class='classify-iri'>" + escapeHtml(iri) + "</code></li>";
                }).join("") + "</ul>";
            }
            var elapsed = info.elapsedMs != null ? ("（推理 " + info.elapsedMs + " ms）") : "";
            var body;
            if (info.error && !info.consistent) {
                body = "<p class='hint form-error'>推理失败：" + escapeHtml(info.error) + "</p>";
            } else if (!info.consistent) {
                body = "<p class='hint form-error'>当前领域本体整体不一致，本次保存后的自动分类已跳过（实例数据本身通常已写入）。</p>" +
                    "<p class='hint'>这<strong>不一定</strong>是本次新建/编辑引起的：只要项目里已有冲突公理或冲突实例，" +
                    "之后<strong>任意</strong>保存都会在分类步骤看到同样提示。</p>" +
                    "<p class='hint'>请点右上角「推理」打开冲突表定位问题；修好本体一致性后，再保存即可正常获得推断类型。</p>" +
                    (info.editing
                        ? "<div class='classify-section'><h3>本次涉及的类型</h3>" + typeList(info.conflictTypes, "无", "conflict-chip") + "</div>"
                        : (info.keptTypes && info.keptTypes.length
                            ? "<div class='classify-section'><h3>本次断言类型</h3>" + typeList(info.keptTypes, "无", "") + "</div>"
                            : ""));
            } else {
                body = "<p class='hint'>主数据已保存。以下为 HermiT 根据当前公理算出的分类" + elapsed + "。</p>" +
                    "<p class='hint'>若出现「新推断类型」，常见原因是所用属性带有定义域（Domain）：填写取值后，推理器会把实例归入定义域类。</p>" +
                    "<div class='classify-section'><h3>保持的类型</h3>" + typeList(info.keptTypes, "无", "") + "</div>" +
                    "<div class='classify-section'><h3>新推断类型</h3>" + typeList(info.newTypes, "没有新的推断类型", "inferred-chip") + "</div>" +
                    (info.editing
                        ? "<div class='classify-section'><h3>不再成立 / 冲突的类型</h3>" + typeList(info.conflictTypes, "无", "conflict-chip") + "</div>"
                        : "");
            }
            var canApply = info.consistent && (info.newTypes.length || info.conflictTypes.length);
            showModal(
                "<div id='classify-form' class='classify-form'>" +
                "<h2>实例分类结果</h2>" +
                "<p class='hint'>实例：「" + escapeHtml(info.name) + "」</p>" +
                body +
                "<div class='actions'>" +
                "<button type='button' id='cancel'>" + (canApply ? "暂不应用" : "关闭") + "</button>" +
                (canApply ? "<button type='button' id='apply-classify'>应用分类变更</button>" : "") +
                "</div></div>"
            );
            var applyBtn = root.querySelector("#apply-classify");
            if (applyBtn) {
                applyBtn.addEventListener("click", function () {
                    applyClassifyChanges(info);
                });
            }
        }

        function applyClassifyChanges(info) {
            var toAdd = (info.newTypes || []).map(function (classIri) {
                return "ClassAssertion(" + iri(classIri) + " " + iri(info.individualIri) + ")";
            });
            var toDelete = (info.conflictTypes || []).map(function (classIri) {
                return "ClassAssertion(" + iri(classIri) + " " + iri(info.individualIri) + ")";
            }).filter(function (axiom) {
                return (state.axioms || []).indexOf(axiom) >= 0;
            });
            hideModal();
            setStatus("正在应用分类变更…");
            var deleteStep = toDelete.length
                ? deleteAxioms(toDelete, "移除不再成立的类型 " + info.name)
                : Promise.resolve();
            deleteStep.then(function () {
                if (!toAdd.length) {
                    return loadOntology();
                }
                return submitAxioms(toAdd, "应用推断类型 " + info.name);
            }).then(function () {
                setStatus("已应用「" + info.name + "」的分类变更（+" + toAdd.length + " / -" + toDelete.length + "）。");
            }).catch(function (error) {
                setStatus(error.message || String(error), true);
            });
        }

        function saveInstanceEdit(individualIri, name, values, fields) {
            var toDelete = findEditableInstanceAxioms(state.axioms, individualIri, fields);
            var toAdd = axiomsForInstanceUpdate(individualIri, name, values);
            setStatus("正在保存修改…");
            var deleteStep = toDelete.length
                ? deleteAxioms(toDelete, "编辑实例前移除旧值 " + name)
                : Promise.resolve();
            return deleteStep.then(function () {
                return submitAxioms(toAdd, "更新实例 " + name);
            }).catch(function (error) {
                setStatus(error.message || String(error), true);
                return Promise.reject(error);
            });
        }

        function confirmDeleteInstance(individualIri) {
            var individual = state.model.individuals[individualIri] || {iri: individualIri, labels: []};
            var name = labelOf(individual);
            var toDelete = findAllInstanceAxioms(state.axioms, individualIri);
            showModal(
                "<div id='delete-form'>" +
                "<h2>删除实例</h2>" +
                "<p>确认删除「" + escapeHtml(name) + "」？会一并移除它的类型、标签、属性值和相关关系（共 " + toDelete.length + " 条公理）。</p>" +
                "<div class='actions'><button type='button' id='cancel'>取消</button><button type='button' id='confirm-delete' class='danger'>确认删除</button></div>" +
                "</div>"
            );
            root.querySelector("#confirm-delete").addEventListener("click", function () {
                hideModal();
                if (state.focusInstance === individualIri) {
                    state.focusInstance = null;
                }
                deleteInstance(individualIri, name);
            });
        }

        function deleteInstance(individualIri, name) {
            if (!individualIri) {
                setStatus("没有找到要删除的实例。", true);
                return;
            }
            setStatus("正在删除实例…");
            fetch("/api/onto/delete-individual", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({projectId: state.projectId, iri: individualIri})
            }).then(function (response) {
                if (!response.ok) {
                    return response.text().then(function (text) {
                        throw new Error("删除实例失败（" + response.status + "）：" + text);
                    });
                }
                return response.json();
            }).then(function (result) {
                // Backend may return ok + removedAxiomsCount, or just ok after DeleteEntities.
                if (!result || result.ok === false) {
                    throw new Error((result && result.error) || "删除实例失败。");
                }
                return loadOntology();
            }).then(function () {
                if (state.model.individuals[individualIri]) {
                    throw new Error("删除没有作用到当前打开的本体，实例还在。请再试一次。");
                }
                setStatus("已删除实例 " + name + "。");
            }).catch(function (error) {
                setStatus(error.message || String(error), true);
            });
        }

        var activeStackedOverlay = null;

        function showModal(html, options) {
            options = options || {};
            var wide = html.indexOf("instance-form") >= 0 || html.indexOf("disjoint-form") >= 0
                || html.indexOf("union-form") >= 0 || html.indexOf("classify-form") >= 0
                || html.indexOf("add-field-form") >= 0
                || html.indexOf("edit-property-form") >= 0
                || html.indexOf("add-behavior-form") >= 0
                || html.indexOf("swrl-result-form") >= 0 || html.indexOf("swrl-rule-form") >= 0;
            // Stacked overlay keeps an existing #modal (e.g. 新建实例) underneath.
            if (options.stacked) {
                closeStackedModal();
                var overlay = document.createElement("div");
                overlay.className = "modeling-stack-overlay";
                overlay.setAttribute("role", "dialog");
                overlay.setAttribute("aria-modal", "true");
                overlay.innerHTML = "<div class='dialog" + (wide ? " dialog-wide" : "") + "'>" + html + "</div>";
                root.appendChild(overlay);
                activeStackedOverlay = overlay;
                var stackedCancel = overlay.querySelector("#cancel");
                if (stackedCancel) {
                    stackedCancel.addEventListener("click", hideModal);
                }
                overlay.addEventListener("click", function (event) {
                    if (event.target === overlay) {
                        hideModal();
                    }
                });
                return overlay;
            }
            var modal = root.querySelector("#modal");
            modal.innerHTML = "<div class='dialog" + (wide ? " dialog-wide" : "") + "'>" + html + "</div>";
            modal.classList.remove("hidden");
            var cancel = modal.querySelector("#cancel");
            if (cancel) {
                cancel.addEventListener("click", hideModal);
            }
            return modal;
        }

        function closeStackedModal() {
            if (!activeStackedOverlay) {
                return;
            }
            if (activeStackedOverlay.parentNode) {
                activeStackedOverlay.parentNode.removeChild(activeStackedOverlay);
            }
            activeStackedOverlay = null;
        }

        var instanceDetailStack = [];

        function closeInstanceDetailOverlays() {
            instanceDetailStack = [];
            document.querySelectorAll(".instance-detail-overlay").forEach(function (node) {
                node.remove();
            });
        }

        function openInstanceDetailOverlay(targetIri, preferredClassIri) {
            if (!targetIri || !isHttpIri(targetIri)) {
                setStatus("请先选择一个已有实例再查看详情。", true);
                return;
            }
            if (!state.model.individuals[targetIri]) {
                setStatus("找不到该实例，可能尚未保存或已被删除。", true);
                return;
            }
            instanceDetailStack.push({
                iri: targetIri,
                preferredClassIri: preferredClassIri || null
            });
            renderInstanceDetailOverlay();
        }

        function popInstanceDetailOverlay() {
            if (!instanceDetailStack.length) {
                closeInstanceDetailOverlays();
                return;
            }
            instanceDetailStack.pop();
            if (!instanceDetailStack.length) {
                closeInstanceDetailOverlays();
                return;
            }
            renderInstanceDetailOverlay();
        }

        function renderInstanceDetailOverlay() {
            if (!instanceDetailStack.length) {
                closeInstanceDetailOverlays();
                return;
            }
            var frame = instanceDetailStack[instanceDetailStack.length - 1];
            var targetIri = frame.iri;
            var individual = state.model.individuals[targetIri] || {iri: targetIri, labels: []};
            var classIri = primaryClassOfIndividual(state.model, targetIri, frame.preferredClassIri);
            var cls = state.model.classes[classIri] || {iri: classIri, labels: []};
            var fields = fieldsOf(state.model, classIri);
            var name = labelOf(individual);
            var typeText = individualTypeLabel(state.model, targetIri);

            var dataValues = {};
            state.model.dataAssertions.filter(function (assertion) {
                return assertion.individual === targetIri;
            }).forEach(function (assertion) {
                dataValues[assertion.property] = assertion.literal.value;
            });
            var objectValues = {};
            state.model.objectAssertions.filter(function (assertion) {
                return assertion.source === targetIri;
            }).forEach(function (assertion) {
                if (!objectValues[assertion.property]) {
                    objectValues[assertion.property] = [];
                }
                if (objectValues[assertion.property].indexOf(assertion.target) < 0) {
                    objectValues[assertion.property].push(assertion.target);
                }
            });

            var dataProps = fields.data.slice();
            Object.keys(dataValues).forEach(function (propertyIri) {
                if (!dataProps.some(function (p) { return p.iri === propertyIri; })
                        && state.model.dataProperties[propertyIri]) {
                    dataProps.push(state.model.dataProperties[propertyIri]);
                }
            });
            var objectProps = fields.object.slice();
            Object.keys(objectValues).forEach(function (propertyIri) {
                if (!objectProps.some(function (p) { return p.iri === propertyIri; })
                        && state.model.objectProperties[propertyIri]) {
                    objectProps.push(state.model.objectProperties[propertyIri]);
                }
            });

            var dataRows = dataProps.map(function (property) {
                var value = dataValues[property.iri];
                var display = value == null || value === "" ? "—" : String(value);
                return "<tr><td>" + escapeHtml(labelOf(property)) + "</td><td>" +
                    escapeHtml(datatypeLabel(property.ranges[0])) + "</td><td class='detail-value'>" +
                    escapeHtml(display) + "</td></tr>";
            }).join("");

            var objectRows = objectProps.map(function (property) {
                var targets = objectValues[property.iri] || [];
                var range = property.ranges[0] || OWL_THING;
                var cell;
                if (!targets.length) {
                    cell = "—";
                } else {
                    cell = targets.map(function (tIri) {
                        var tName = labelOf(state.model.individuals[tIri] || {iri: tIri, labels: []});
                        return "<button type='button' class='linkish' data-detail-drill='" +
                            escapeHtml(tIri) + "' data-detail-range='" + escapeHtml(range) + "'>" +
                            escapeHtml(tName) + "</button>";
                    }).join("、");
                }
                return "<tr><td>" + escapeHtml(labelOf(property)) + "</td><td>" +
                    escapeHtml(labelOf(state.model.classes[range] || {iri: range, labels: []})) +
                    "</td><td class='detail-value'>" + cell + "</td></tr>";
            }).join("");

            var depth = instanceDetailStack.length;
            var backLabel = depth > 1 ? "返回上一级" : "关闭";
            var html =
                "<div class='instance-detail-card' role='document'>" +
                "<div class='instance-detail-head'>" +
                "<div><h3>实例详情</h3>" +
                "<p class='hint'>只读浏览" + (depth > 1 ? " · 第 " + depth + " 层" : "") + "</p></div>" +
                "<button type='button' class='ghost' id='instance-detail-close'>" + backLabel + "</button>" +
                "</div>" +
                "<div class='instance-detail-meta'>" +
                "<div><span class='meta-label'>名称</span><strong>" + escapeHtml(name) + "</strong></div>" +
                "<div><span class='meta-label'>类型</span><span>" + escapeHtml(typeText) +
                (classIri && classIri !== OWL_THING ? "（按 " + escapeHtml(labelOf(cls)) + " 展示字段）" : "") +
                "</span></div>" +
                "</div>" +
                "<section class='instance-detail-section'>" +
                "<h4>属性 <span class='panel-count'>" + dataProps.length + "</span></h4>" +
                "<div class='data-table-wrap'><table class='data-table'>" +
                "<thead><tr><th>名称</th><th>类型</th><th>取值</th></tr></thead>" +
                "<tbody>" + (dataRows || "<tr><td colspan='3' class='empty'>暂无属性取值</td></tr>") +
                "</tbody></table></div></section>" +
                "<section class='instance-detail-section'>" +
                "<h4>关系 <span class='panel-count'>" + objectProps.length + "</span></h4>" +
                "<div class='data-table-wrap'><table class='data-table'>" +
                "<thead><tr><th>名称</th><th>目标类</th><th>目标实例</th></tr></thead>" +
                "<tbody>" + (objectRows || "<tr><td colspan='3' class='empty'>暂无关系</td></tr>") +
                "</tbody></table></div>" +
                "<p class='hint'>点击目标实例名称可继续查看其详情。</p>" +
                "</section>" +
                "<div class='actions'>" +
                "<button type='button' id='instance-detail-close-footer'>" + backLabel + "</button>" +
                "</div></div>";

            var overlay = document.querySelector(".instance-detail-overlay");
            if (!overlay) {
                overlay = document.createElement("div");
                overlay.className = "instance-detail-overlay";
                overlay.setAttribute("role", "dialog");
                overlay.setAttribute("aria-modal", "true");
                document.body.appendChild(overlay);
                overlay.addEventListener("click", function (event) {
                    if (event.target === overlay) {
                        popInstanceDetailOverlay();
                    }
                });
            }
            overlay.innerHTML = html;

            function bindClose(btn) {
                if (!btn) {
                    return;
                }
                btn.addEventListener("click", function (event) {
                    event.preventDefault();
                    popInstanceDetailOverlay();
                });
            }
            bindClose(overlay.querySelector("#instance-detail-close"));
            bindClose(overlay.querySelector("#instance-detail-close-footer"));
            overlay.querySelectorAll("[data-detail-drill]").forEach(function (button) {
                button.addEventListener("click", function (event) {
                    event.preventDefault();
                    openInstanceDetailOverlay(
                        button.getAttribute("data-detail-drill"),
                        button.getAttribute("data-detail-range")
                    );
                });
            });
        }

        function hideModal() {
            if (activeStackedOverlay) {
                closeStackedModal();
                return;
            }
            var modal = root.querySelector("#modal");
            modal.classList.add("hidden");
            modal.innerHTML = "";
            document.querySelectorAll(".extra-property-picker-overlay").forEach(function (node) {
                node.remove();
            });
            closeInstanceDetailOverlays();
        }

        function deleteAxioms(axioms, message) {
            return fetch("/api/onto/delete-axioms", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({
                    projectId: state.projectId,
                    msg: message,
                    owl: renderOntology(axioms)
                })
            }).then(function (response) {
                if (!response.ok) {
                    return response.text().then(function (text) {
                        throw new Error("删除旧值失败（" + response.status + "）：" + text);
                    });
                }
                return response.json();
            });
        }

        function clearInstancePropertyAssertion(individualIri, propertyIri, isData, message) {
            var kind = isData ? "data" : "object";
            return fetch("/api/onto/delete-property-assertions", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({
                    projectId: state.projectId,
                    individual: individualIri,
                    property: propertyIri,
                    kind: kind,
                    msg: message || ("清除实例" + (isData ? "属性" : "关系"))
                })
            }).then(function (response) {
                return response.text().then(function (text) {
                    var body = null;
                    var trimmed = String(text || "").trim();
                    if (trimmed) {
                        try {
                            body = JSON.parse(trimmed);
                        } catch (parseError) {
                            throw new Error(
                                "清除失败：服务器返回了非 JSON（HTTP " + response.status + "）。"
                                + (trimmed.charAt(0) === "<" ? "请检查 delete-property-assertions.jsp 是否编译失败。" : "")
                            );
                        }
                    }
                    if (!response.ok) {
                        throw new Error((body && body.error) || ("清除失败（HTTP " + response.status + "）"));
                    }
                    return body || {};
                });
            }).then(function (body) {
                return fetchOntologySnapshot(state.projectId).then(function (loaded) {
                    state.axioms = loaded.axioms;
                    state.model = parseOntology(loaded.text);
                    renderTree();
                    renderDetail();
                    return body;
                });
            });
        }

        function submitAxioms(axioms, message) {
            var illegal = (axioms || []).filter(function (axiom) {
                return /<[A-Za-z]:\\/.test(axiom) || /<[^>]*(?:\\|\/Users\/|file:)/.test(axiom);
            });
            if (illegal.length) {
                setStatus("拒绝保存：含有非法 IRI（不能是文件路径）。", true);
                return Promise.reject(new Error("非法 IRI"));
            }
            setStatus("正在保存…");
            return fetch("/api/onto/axioms", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=utf-8"
                },
                body: JSON.stringify({
                    projectId: state.projectId,
                    msg: message,
                    owl: renderOntology(axioms)
                })
            }).then(function (response) {
                if (!response.ok) {
                    throw new Error("保存失败（" + response.status + "）。");
                }
                return loadOntology();
            }).catch(function (error) {
                setStatus(error.message, true);
                return Promise.reject(error);
            });
        }

        emitSelectionChrome();

        return {
            setMode: applyMode,
            setProjectId: applyProjectId,
            setSelectedClass: selectClass,
            getMode: function () { return state.mode; },
            getProjectId: function () { return state.projectId; },
            destroy: function () {
                window.removeEventListener("class-state-machine-changed", onStateMachineChanged);
                window.removeEventListener("instance-behavior-state-changed", onInstanceBehaviorStateChanged);
                window.removeEventListener("modeling-navigate-class", onNavigateClass);
                window.removeEventListener("modeling-global-search", onGlobalSearch);
                window.removeEventListener("modeling-navigate-entity", onNavigateEntity);
                window.removeEventListener("modeling-run-consistency", onRunConsistencyEvent);
            }
        };
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    return {
        parseOntology: parseOntology,
        ontologyFromRevisions: ontologyFromRevisions,
        ontologyFromSnapshot: ontologyFromSnapshot,
        axiomsForClass: axiomsForClass,
        axiomsForModelClass: axiomsForModelClass,
        uiRoleOf: uiRoleOf,
        isModelClass: isModelClass,
        isMetamodelClass: isMetamodelClass,
        nearestMetamodelIri: nearestMetamodelIri,
        listAllModelClasses: listAllModelClasses,
        listModelChildren: listModelChildren,
        UI_ROLE: UI_ROLE,
        ROLE_METAMODEL: ROLE_METAMODEL,
        ROLE_MODEL: ROLE_MODEL,
        axiomsForDataField: axiomsForDataField,
        axiomsForObjectField: axiomsForObjectField,
        axiomsForAttachExistingField: axiomsForAttachExistingField,
        reusableProperties: reusableProperties,
        propertyLinkedToClass: propertyLinkedToClass,
        propertyRoleOnClass: propertyRoleOnClass,
        findClassPropertyLinkAxioms: findClassPropertyLinkAxioms,
        allPropertiesOfKind: allPropertiesOfKind,
        propertiesOutsideClassFields: propertiesOutsideClassFields,
        axiomsForInstance: axiomsForInstance,
        axiomsForInstanceUpdate: axiomsForInstanceUpdate,
        renderOntology: renderOntology,
        fieldsOf: fieldsOf,
        propertyTabOf: propertyTabOf,
        functionCodeOf: functionCodeOf,
        stateGraphOf: stateGraphOf,
        stateGraphRawOf: stateGraphRawOf,
        listBehaviorMachineStates: listBehaviorMachineStates,
        matchBehaviorStateId: matchBehaviorStateId,
        behaviorHasStateGraph: behaviorHasStateGraph,
        axiomsForBehaviorField: axiomsForBehaviorField,
        UI_STATE_GRAPH: UI_STATE_GRAPH,
        classLineage: classLineage,
        fieldSourceIri: fieldSourceIri,
        individualsOf: individualsOf,
        descendantClassesOf: descendantClassesOf,
        findAllInstanceAxioms: findAllInstanceAxioms,
        findPropertyAxioms: findPropertyAxioms,
        findPropertySchemaAxioms: findPropertySchemaAxioms,
        collectClassDeleteAxioms: collectClassDeleteAxioms,
        childrenOf: childrenOf,
        labelOf: labelOf,
        labelAxioms: labelAxioms,
        missingClassRestrictionAxioms: missingClassRestrictionAxioms,
        missingPlainLabelAxioms: missingPlainLabelAxioms,
        hasClassRestriction: hasClassRestriction,
        classRestrictionAxiom: classRestrictionAxiom,
        constraintLabel: constraintLabel,
        normalizeConstraint: normalizeConstraint,
        findRestrictionOnClass: findRestrictionOnClass,
        equivalentClassesAxiom: equivalentClassesAxiom,
        findEquivalentAxioms: findEquivalentAxioms,
        definitionOf: definitionOf,
        namedParentsOf: namedParentsOf,
        disjointPeersOf: disjointPeersOf,
        disjointClassesAxiom: disjointClassesAxiom,
        findDisjointAxioms: findDisjointAxioms,
        rewriteDisjointRemovingLink: rewriteDisjointRemovingLink,
        rewriteDisjointClearingClass: rewriteDisjointClearingClass,
        disjointUnionsOf: disjointUnionsOf,
        disjointUnionMembersOf: disjointUnionMembersOf,
        disjointUnionAxiom: disjointUnionAxiom,
        findDisjointUnionAxiomsForCover: findDisjointUnionAxiomsForCover,
        mount: mount,
        datatypeKind: datatypeKind,
        normalizeDataFieldValue: normalizeDataFieldValue,
        dataFieldControlHtml: dataFieldControlHtml,
        axiomsForSwrlClassRule: axiomsForSwrlClassRule,
        axiomsForSwrlPresentation: axiomsForSwrlPresentation,
        parseSwrlPresentation: parseSwrlPresentation,
        formatSwrlPresentation: formatSwrlPresentation,
        parseInferredObjectBindings: parseInferredObjectBindings,
        lookupSwrlObjectCandidateValues: lookupSwrlObjectCandidateValues,
        filterRelationTargetsBySwrlCandidates: filterRelationTargetsBySwrlCandidates,
        findSwrlRuleAxioms: findSwrlRuleAxioms,
        parseSwrlRuleSummary: parseSwrlRuleSummary,
        OWL_THING: OWL_THING,
        XSD: XSD
    };
});
