package com.benti.ontology.embed;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Compact context for OntoGPT: existing class tree + semantic-base terms/indicators.
 */
@Component
public class OntologyContextPack {

    private static final Pattern DECL_CLASS = Pattern.compile(
            "Declaration\\(Class\\(<([^>]+)>\\)\\)");
    private static final Pattern LABEL_ASSERT = Pattern.compile(
            "AnnotationAssertion\\([^\\s]*rdfs:label\\s+<([^>]+)>\\s+\\\"([^\\\"]+)\\\"",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern COMMENT_ASSERT = Pattern.compile(
            "AnnotationAssertion\\([^\\s]*rdfs:comment\\s+<([^>]+)>\\s+\\\"([^\\\"]+)\\\"",
            Pattern.CASE_INSENSITIVE);
    /** AnnotationAssertion(<...#uiRole> <classIri> "model"|"metamodel") — full or prefixed. */
    private static final Pattern UI_ROLE_ASSERT = Pattern.compile(
            "AnnotationAssertion\\([^\\s]*uiRole[^<]*<([^>]+)>\\s+\\\"([^\\\"]+)\\\"",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern SUBCLASS = Pattern.compile(
            "SubClassOf\\(<([^>]+)>\\s+<([^>]+)>\\)");
    private static final Pattern DECL_DP = Pattern.compile(
            "Declaration\\(DataProperty\\(<([^>]+)>\\)\\)");
    private static final Pattern DECL_OP = Pattern.compile(
            "Declaration\\(ObjectProperty\\(<([^>]+)>\\)\\)");
    private static final Pattern UNIT_ASSERT = Pattern.compile(
            "AnnotationAssertion\\([^\\s]*uiUnit[^<]*<([^>]+)>\\s+\\\"([^\\\"]+)\\\"",
            Pattern.CASE_INSENSITIVE);
    /** Annotation(<...#uiFacet> "技术参数") — may include > between property and literal. */
    private static final Pattern FACET_ANN = Pattern.compile(
            "Annotation\\([^\\s]*uiFacet[^\\\"]*\\\"([^\\\"]+)\\\"\\)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern FUNCTION_CODE_ANN = Pattern.compile(
            "Annotation\\([^\\s]*functionCode[^\\\"]*\\\"([^\\\"]+)\\\"\\)",
            Pattern.CASE_INSENSITIVE);
    /** … <classIri> Data|ObjectSomeValuesFrom(<propIri> …) — range may be xsd:decimal without <>. */
    private static final Pattern CLASS_SOME_VALUES = Pattern.compile(
            "<([^>]+)>\\s+(Data|Object)SomeValuesFrom\\(<([^>]+)>",
            Pattern.CASE_INSENSITIVE);

    private final EmbeddedOntologyService ontology;
    private final ProjectAuxStore auxStore;

    public OntologyContextPack(EmbeddedOntologyService ontology, ProjectAuxStore auxStore) {
        this.ontology = ontology;
        this.auxStore = auxStore;
    }

    public Map<String, Object> build(String projectId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("projectId", projectId);
        List<Map<String, Object>> classes = new ArrayList<>();
        List<Map<String, Object>> properties = new ArrayList<>();
        try {
            Map<String, Object> snap = ontology.getOntologySnapshot(projectId);
            @SuppressWarnings("unchecked")
            List<String> axioms = snap.get("axioms") instanceof List
                    ? (List<String>) snap.get("axioms")
                    : List.of();
            Map<String, String> iriToLabel = new LinkedHashMap<>();
            Map<String, String> iriToComment = new LinkedHashMap<>();
            Map<String, String> childToParent = new LinkedHashMap<>();
            Map<String, String> iriToRole = new LinkedHashMap<>();
            Map<String, String> iriToUnit = new LinkedHashMap<>();
            /** classIri -> list of facet field rows */
            Map<String, List<Map<String, Object>>> classFacets = new LinkedHashMap<>();
            Set<String> classIris = new LinkedHashSet<>();
            Set<String> dpIris = new LinkedHashSet<>();
            Set<String> opIris = new LinkedHashSet<>();
            for (String ax : axioms) {
                if (ax == null) {
                    continue;
                }
                String compact = ax.replaceAll("\\s+", " ").trim();
                Matcher m = DECL_CLASS.matcher(compact);
                while (m.find()) {
                    classIris.add(m.group(1));
                }
                m = DECL_DP.matcher(compact);
                while (m.find()) {
                    dpIris.add(m.group(1));
                }
                m = DECL_OP.matcher(compact);
                while (m.find()) {
                    opIris.add(m.group(1));
                }
                m = LABEL_ASSERT.matcher(compact);
                while (m.find()) {
                    iriToLabel.put(m.group(1), m.group(2));
                }
                m = COMMENT_ASSERT.matcher(compact);
                while (m.find()) {
                    // last write wins so doc-intel modify patches are visible
                    iriToComment.put(m.group(1), m.group(2));
                }
                m = UI_ROLE_ASSERT.matcher(compact);
                while (m.find()) {
                    String role = m.group(2).trim().toLowerCase();
                    if ("model".equals(role) || "metamodel".equals(role)) {
                        iriToRole.put(m.group(1), role);
                    }
                }
                m = UNIT_ASSERT.matcher(compact);
                while (m.find()) {
                    iriToUnit.put(m.group(1), m.group(2));
                }
                m = SUBCLASS.matcher(compact);
                while (m.find()) {
                    childToParent.put(m.group(1), m.group(2));
                }
            }
            // Second pass: facet restrictions (OWLAPI may reorder Annotation(*) before class)
            for (String ax : axioms) {
                if (ax == null || !ax.contains("uiFacet") || !ax.contains("SomeValuesFrom")) {
                    continue;
                }
                String compact = ax.replaceAll("\\s+", " ").trim();
                Matcher fa = FACET_ANN.matcher(compact);
                if (!fa.find()) {
                    continue;
                }
                String facetZh = fa.group(1);
                String functionCode = "";
                Matcher fc = FUNCTION_CODE_ANN.matcher(compact);
                if (fc.find()) {
                    functionCode = fc.group(1);
                }
                Matcher sm = CLASS_SOME_VALUES.matcher(compact);
                if (!sm.find()) {
                    continue;
                }
                String classIri = sm.group(1);
                String propKind = sm.group(2);
                String propIri = sm.group(3);
                Map<String, Object> field = new LinkedHashMap<>();
                field.put("facet", normalizeFacetId(facetZh));
                field.put("facetLabel", facetZh);
                field.put("propertyIri", propIri);
                field.put("label", iriToLabel.getOrDefault(propIri, shortName(propIri)));
                field.put("definition", iriToComment.getOrDefault(propIri, ""));
                field.put("unit", iriToUnit.getOrDefault(propIri, ""));
                field.put("functionCode", functionCode);
                field.put("kind", "Data".equalsIgnoreCase(propKind) ? "DataProperty" : "ObjectProperty");
                classFacets.computeIfAbsent(classIri, k -> new ArrayList<>()).add(field);
            }
            // Prefer models + their parents, then other classes (never drop models for cap)
            Set<String> mustKeep = new LinkedHashSet<>();
            for (String iri : classIris) {
                if ("model".equals(iriToRole.get(iri))) {
                    mustKeep.add(iri);
                    String p = childToParent.get(iri);
                    if (p != null && classIris.contains(p)) {
                        mustKeep.add(p);
                    }
                }
            }
            List<String> orderedIris = new ArrayList<>(mustKeep);
            for (String iri : classIris) {
                if (!mustKeep.contains(iri)) {
                    orderedIris.add(iri);
                }
            }
            int n = 0;
            int modelCount = 0;
            final int maxClasses = 400;
            Set<String> emitted = new LinkedHashSet<>();
            for (String iri : orderedIris) {
                boolean forced = mustKeep.contains(iri);
                boolean isModel = "model".equals(iriToRole.getOrDefault(iri, ""));
                if (!forced && n >= maxClasses) {
                    continue;
                }
                if (!emitted.add(iri)) {
                    continue;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                String label = iriToLabel.getOrDefault(iri, shortName(iri));
                String uiRole = iriToRole.getOrDefault(iri, "metamodel");
                row.put("iri", iri);
                row.put("label", label);
                row.put("definition", iriToComment.getOrDefault(iri, ""));
                row.put("uiRole", uiRole);
                row.put("kind", isModel ? "Model" : "Class");
                List<Map<String, Object>> facets = classFacets.getOrDefault(iri, List.of());
                row.put("facets", groupFacets(facets));
                row.put("facetFields", facets);
                String parentIri = childToParent.get(iri);
                if (parentIri != null) {
                    row.put("parentIri", parentIri);
                    row.put("parentLabel", iriToLabel.getOrDefault(parentIri, shortName(parentIri)));
                } else {
                    row.put("parentLabel", "");
                    row.put("parentIri", "");
                }
                classes.add(row);
                if (isModel) {
                    modelCount++;
                }
                n++;
            }
            out.put("modelClassCount", modelCount);
            for (String iri : dpIris) {
                if (properties.size() >= 120) {
                    break;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("kind", "DataProperty");
                row.put("iri", iri);
                row.put("label", iriToLabel.getOrDefault(iri, shortName(iri)));
                row.put("definition", iriToComment.getOrDefault(iri, ""));
                row.put("unit", iriToUnit.getOrDefault(iri, ""));
                properties.add(row);
            }
            for (String iri : opIris) {
                if (properties.size() >= 160) {
                    break;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("kind", "ObjectProperty");
                row.put("iri", iri);
                row.put("label", iriToLabel.getOrDefault(iri, shortName(iri)));
                row.put("definition", iriToComment.getOrDefault(iri, ""));
                properties.add(row);
            }
            out.put("axiomCount", axioms.size());
            out.put("revision", snap.get("revision"));
        } catch (Exception e) {
            out.put("ontologyError", e.getMessage());
        }

        List<Map<String, Object>> terms = new ArrayList<>();
        List<Map<String, Object>> indicators = new ArrayList<>();
        try {
            Map<String, Object> base = auxStore.getSemanticBase(projectId);
            for (Map<String, Object> t : castList(base.get("terms"))) {
                if (terms.size() >= 80) {
                    break;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", t.get("id"));
                row.put("label", t.get("label"));
                row.put("definition", t.get("definition"));
                row.put("category", t.get("category"));
                row.put("skosConceptIri", t.get("skosConceptIri"));
                terms.add(row);
            }
            for (Map<String, Object> ind : castList(base.get("indicators"))) {
                if (indicators.size() >= 60) {
                    break;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", ind.get("id"));
                row.put("label", ind.get("label"));
                row.put("code", ind.get("code"));
                row.put("unit", ind.get("unit"));
                row.put("dataType", ind.get("dataType"));
                indicators.add(row);
            }
        } catch (Exception e) {
            out.put("semanticBaseError", e.getMessage());
        }

        List<Map<String, Object>> metamodelClasses = new ArrayList<>();
        List<Map<String, Object>> modelClasses = new ArrayList<>();
        for (Map<String, Object> c : classes) {
            if ("model".equals(String.valueOf(c.getOrDefault("uiRole", "")))) {
                modelClasses.add(c);
            } else {
                metamodelClasses.add(c);
            }
        }

        out.put("classes", classes);
        out.put("metamodelClasses", metamodelClasses);
        out.put("modelClasses", modelClasses);
        out.put("properties", properties);
        out.put("terms", terms);
        out.put("indicators", indicators);
        out.put("stats", Map.of(
                "classes", classes.size(),
                "metamodelClasses", metamodelClasses.size(),
                "modelClasses", modelClasses.size(),
                "properties", properties.size(),
                "terms", terms.size(),
                "indicators", indicators.size()));
        return out;
    }

    /**
     * Build a forest for structure-diff UI (metamodel + model children + properties folder).
     * Model classes (benti:uiRole=model) nest under their parent metamodel as kind=Model.
     * Each node: { id, iri, label, kind, uiRole, parentIri, children[] }.
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> buildClassTree(String projectId) {
        Map<String, Object> pack = build(projectId);
        List<Map<String, Object>> classes = castList(pack.get("classes"));
        List<Map<String, Object>> properties = castList(pack.get("properties"));

        Map<String, Map<String, Object>> byIri = new LinkedHashMap<>();
        for (Map<String, Object> c : classes) {
            String iri = String.valueOf(c.getOrDefault("iri", ""));
            if (iri.isBlank()) {
                continue;
            }
            boolean isModel = "model".equals(String.valueOf(c.getOrDefault("uiRole", "")))
                    || "Model".equals(String.valueOf(c.getOrDefault("kind", "")));
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", iri);
            node.put("iri", iri);
            node.put("label", c.getOrDefault("label", shortName(iri)));
            node.put("definition", c.getOrDefault("definition", ""));
            node.put("kind", isModel ? "Model" : "Class");
            node.put("uiRole", isModel ? "model" : "metamodel");
            node.put("facets", c.getOrDefault("facets", Map.of()));
            node.put("facetFields", c.getOrDefault("facetFields", List.of()));
            node.put("parentIri", c.getOrDefault("parentIri", ""));
            node.put("parentLabel", c.getOrDefault("parentLabel", ""));
            node.put("change", "stable");
            node.put("children", new ArrayList<Map<String, Object>>());
            byIri.put(iri, node);
        }

        List<Map<String, Object>> roots = new ArrayList<>();
        for (Map<String, Object> node : byIri.values()) {
            String parentIri = String.valueOf(node.getOrDefault("parentIri", "")).trim();
            if (!parentIri.isBlank() && byIri.containsKey(parentIri) && !parentIri.equals(node.get("iri"))) {
                List<Map<String, Object>> kids = (List<Map<String, Object>>) byIri.get(parentIri).get("children");
                kids.add(node);
            } else {
                roots.add(node);
            }
        }

        if (!properties.isEmpty()) {
            Map<String, Object> propRoot = new LinkedHashMap<>();
            propRoot.put("id", "virtual:properties");
            propRoot.put("iri", "");
            propRoot.put("label", "属性");
            propRoot.put("kind", "Folder");
            propRoot.put("change", "stable");
            List<Map<String, Object>> propKids = new ArrayList<>();
            for (Map<String, Object> p : properties) {
                Map<String, Object> n = new LinkedHashMap<>();
                String iri = String.valueOf(p.getOrDefault("iri", ""));
                n.put("id", iri.isBlank() ? "prop:" + p.get("label") : iri);
                n.put("iri", iri);
                n.put("label", p.getOrDefault("label", shortName(iri)));
                n.put("kind", p.getOrDefault("kind", "Property"));
                n.put("change", "stable");
                n.put("children", new ArrayList<>());
                propKids.add(n);
            }
            propRoot.put("children", propKids);
            roots.add(propRoot);
        }
        return roots;
    }

    private static String normalizeFacetId(String facetZhOrId) {
        if (facetZhOrId == null) {
            return "";
        }
        String v = facetZhOrId.trim();
        if ("技术参数".equals(v) || "technicalParam".equals(v)) {
            return "technicalParam";
        }
        if ("状态变量".equals(v) || "stateVariable".equals(v)) {
            return "stateVariable";
        }
        if ("关系".equals(v) || "relation".equals(v)) {
            return "relation";
        }
        if ("功能".equals(v) || "function".equals(v)) {
            return "function";
        }
        if ("行为".equals(v) || "behavior".equals(v)) {
            return "behavior";
        }
        return v;
    }

    private static Map<String, List<Map<String, Object>>> groupFacets(List<Map<String, Object>> fields) {
        Map<String, List<Map<String, Object>>> out = new LinkedHashMap<>();
        out.put("technicalParam", new ArrayList<>());
        out.put("stateVariable", new ArrayList<>());
        out.put("relation", new ArrayList<>());
        out.put("function", new ArrayList<>());
        out.put("behavior", new ArrayList<>());
        for (Map<String, Object> f : fields) {
            String id = String.valueOf(f.getOrDefault("facet", ""));
            out.computeIfAbsent(id, k -> new ArrayList<>()).add(f);
        }
        return out;
    }

    private static String shortName(String iri) {
        if (iri == null) {
            return "";
        }
        int hash = iri.lastIndexOf('#');
        int slash = iri.lastIndexOf('/');
        int i = Math.max(hash, slash);
        return i >= 0 && i + 1 < iri.length() ? iri.substring(i + 1) : iri;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> castList(Object value) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!(value instanceof List)) {
            return out;
        }
        for (Object item : (List<?>) value) {
            if (item instanceof Map) {
                out.add(new LinkedHashMap<>((Map<String, Object>) item));
            }
        }
        return out;
    }
}
