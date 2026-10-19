package com.benti.ontology.embed;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Server-side hard gates mirroring doc-intel-worker/populate_gates.py.
 * Defense in depth after worker extraction (populate mode).
 */
public final class PopulateGates {

    private PopulateGates() {
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> apply(List<Map<String, Object>> candidates,
                                           List<Map<String, Object>> evidence,
                                           Map<String, Object> context) {
        Map<String, Object> stats = new LinkedHashMap<>();
        String mode = String.valueOf(context == null ? "populate"
                : context.getOrDefault("extractMode", "populate")).trim().toLowerCase(Locale.ROOT);
        boolean populate = mode.isBlank() || "populate".equals(mode) || "fill".equals(mode) || "framework".equals(mode);
        stats.put("mode", populate ? "populate" : "open");
        stats.put("input", candidates == null ? 0 : candidates.size());
        if (!populate || candidates == null || candidates.isEmpty()) {
            stats.put("kept", candidates == null ? 0 : candidates.size());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("candidates", candidates == null ? List.of() : candidates);
            out.put("evidence", evidence == null ? List.of() : evidence);
            out.put("gateStats", stats);
            return out;
        }

        boolean allowMeta = bool(context.get("allowCreateMetamodel"), false);
        Indexes idx = Indexes.from(context);

        Map<String, List<Map<String, Object>>> evByCand = new LinkedHashMap<>();
        if (evidence != null) {
            for (Map<String, Object> e : evidence) {
                if (e == null) {
                    continue;
                }
                String cid = String.valueOf(e.getOrDefault("candidateId", ""));
                evByCand.computeIfAbsent(cid, k -> new ArrayList<>()).add(e);
            }
        }

        int forcedReuse = 0;
        int droppedNoParent = 0;
        int droppedIllegal = 0;
        int droppedNoEvidence = 0;
        int alignedIndicator = 0;
        int alignedTerm = 0;

        List<Map<String, Object>> kept = new ArrayList<>();
        Set<String> keepIds = new LinkedHashSet<>();

        for (Map<String, Object> cand : candidates) {
            if (cand == null) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>(cand);
            String kind = String.valueOf(row.getOrDefault("kind", "Class")).trim();
            String label = String.valueOf(row.getOrDefault("label", "")).trim();
            String action = String.valueOf(row.getOrDefault("action", "create")).trim().toLowerCase(Locale.ROOT);
            String role = String.valueOf(row.getOrDefault("uiRole",
                    row.getOrDefault("role", ""))).trim().toLowerCase(Locale.ROOT);
            String parentLabel = String.valueOf(row.getOrDefault("parentLabel", "")).trim();
            String parentIri = String.valueOf(row.getOrDefault("parentIri", "")).trim();
            String existing = String.valueOf(row.getOrDefault("existingIri", "")).trim();

            String linked = idx.lookup(label, existing);
            if (!linked.isBlank()) {
                row.put("existingIri", linked);
                row.put("action", "reuse");
                action = "reuse";
                forcedReuse++;
            }

            if ("DataProperty".equals(kind) || "ObjectProperty".equals(kind)) {
                Map<String, Object> ind = idx.indicators.get(normalize(label));
                if (ind != null) {
                    row.putIfAbsent("uiFacet", "technicalParam");
                    row.putIfAbsent("facetLabel", "技术参数");
                    if (ind.get("unit") != null && isBlank(row.get("rangeHint"))) {
                        row.put("rangeHint", ind.get("unit"));
                    }
                    row.put("semanticBaseAligned", true);
                    row.put("semanticBaseKind", "indicator");
                    alignedIndicator++;
                }
            }
            if ("Class".equals(kind) || "Model".equals(kind) || "SubClassOf".equals(kind)) {
                Map<String, Object> term = idx.terms.get(normalize(label));
                if (term != null) {
                    row.put("semanticBaseAligned", true);
                    row.put("semanticBaseKind", "term");
                    if (isBlank(row.get("definition")) && term.get("definition") != null) {
                        row.put("definition", term.get("definition"));
                    }
                    alignedTerm++;
                }
            }

            if (parentIri.isBlank() && !parentLabel.isBlank()) {
                parentIri = idx.lookup(parentLabel, "");
                if (!parentIri.isBlank()) {
                    row.put("parentIri", parentIri);
                }
            }

            boolean isModel = "model".equals(role) || "Model".equals(kind);
            boolean classLike = "Class".equals(kind) || "Model".equals(kind) || "SubClassOf".equals(kind)
                    || "model".equals(role) || "metamodel".equals(role);
            boolean metamodelCreate = classLike && !"reuse".equals(action) && !isModel
                    && !"DataProperty".equals(kind) && !"ObjectProperty".equals(kind) && !"Relation".equals(kind);

            if (!"reuse".equals(action) && !hasEvidence(row, evByCand)) {
                droppedNoEvidence++;
                continue;
            }

            if ("reuse".equals(action)) {
                kept.add(row);
                keepIds.add(String.valueOf(row.getOrDefault("id", "")));
                continue;
            }

            if (isModel || (classLike && !isBlank(row.get("parentIri")))) {
                String pIri = String.valueOf(row.getOrDefault("parentIri", "")).trim();
                if (pIri.isBlank() || !idx.allowedParents.contains(pIri)) {
                    String resolved = idx.lookup(parentLabel, "");
                    if (!resolved.isBlank() && idx.allowedParents.contains(resolved)) {
                        row.put("parentIri", resolved);
                    } else {
                        droppedNoParent++;
                        continue;
                    }
                }
                if (isModel) {
                    row.put("kind", "Model");
                    row.put("uiRole", "model");
                }
                kept.add(row);
                keepIds.add(String.valueOf(row.getOrDefault("id", "")));
                continue;
            }

            if ("DataProperty".equals(kind) || "ObjectProperty".equals(kind) || "Relation".equals(kind)) {
                String domain = String.valueOf(row.getOrDefault("domainHint", parentLabel)).trim();
                String domainIri = idx.lookup(domain, "");
                if (!domainIri.isBlank()) {
                    row.put("domainHint", idx.iriToLabel.getOrDefault(domainIri, domain));
                    row.putIfAbsent("parentIri", domainIri);
                }
                kept.add(row);
                keepIds.add(String.valueOf(row.getOrDefault("id", "")));
                continue;
            }

            if (metamodelCreate && !allowMeta) {
                droppedIllegal++;
                continue;
            }

            if (metamodelCreate && allowMeta) {
                String pIri = String.valueOf(row.getOrDefault("parentIri", "")).trim();
                if (!pIri.isBlank() && !idx.allowedParents.contains(pIri)) {
                    droppedNoParent++;
                    continue;
                }
            }

            kept.add(row);
            keepIds.add(String.valueOf(row.getOrDefault("id", "")));
        }

        List<Map<String, Object>> keptEv = new ArrayList<>();
        if (evidence != null) {
            for (Map<String, Object> e : evidence) {
                if (e != null && keepIds.contains(String.valueOf(e.getOrDefault("candidateId", "")))) {
                    keptEv.add(e);
                }
            }
        }

        stats.put("kept", kept.size());
        stats.put("forcedReuse", forcedReuse);
        stats.put("droppedNoParent", droppedNoParent);
        stats.put("droppedIllegalMetamodelCreate", droppedIllegal);
        stats.put("droppedNoEvidence", droppedNoEvidence);
        stats.put("alignedIndicator", alignedIndicator);
        stats.put("alignedTerm", alignedTerm);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("candidates", kept);
        out.put("evidence", keptEv);
        out.put("gateStats", stats);
        return out;
    }

    public static void enrichContext(Map<String, Object> ctx, Map<String, Object> options) {
        if (ctx == null) {
            return;
        }
        Map<String, Object> opt = options == null ? Map.of() : options;
        String mode = String.valueOf(opt.getOrDefault("extractMode",
                opt.getOrDefault("mode", "populate"))).trim().toLowerCase(Locale.ROOT);
        if (mode.isBlank()) {
            mode = "populate";
        }
        boolean allowMeta = bool(opt.get("allowCreateMetamodel"), false);
        ctx.put("extractMode", mode);
        ctx.put("allowCreateMetamodel", allowMeta);

        List<String> scope = new ArrayList<>();
        Object rawScope = opt.get("scopeParentIris");
        if (rawScope instanceof List) {
            for (Object o : (List<?>) rawScope) {
                if (o != null && !String.valueOf(o).isBlank()) {
                    scope.add(String.valueOf(o).trim());
                }
            }
        }
        if (scope.isEmpty()) {
            for (Map<String, Object> c : listOfMaps(ctx.get("metamodelClasses"))) {
                String iri = String.valueOf(c.getOrDefault("iri", "")).trim();
                if (!iri.isBlank()) {
                    scope.add(iri);
                }
            }
            if (scope.isEmpty()) {
                for (Map<String, Object> c : listOfMaps(ctx.get("classes"))) {
                    String role = String.valueOf(c.getOrDefault("uiRole", "metamodel")).trim().toLowerCase(Locale.ROOT);
                    String iri = String.valueOf(c.getOrDefault("iri", "")).trim();
                    if (!iri.isBlank() && !"model".equals(role)) {
                        scope.add(iri);
                    }
                }
            }
        }
        ctx.put("allowedParentIris", scope);
        ctx.put("scopeParentIris", scope);
    }

    private static boolean hasEvidence(Map<String, Object> row, Map<String, List<Map<String, Object>>> evByCand) {
        String id = String.valueOf(row.getOrDefault("id", ""));
        if (evByCand.containsKey(id) && !evByCand.get(id).isEmpty()) {
            return true;
        }
        Object chunks = row.get("chunkIds");
        if (chunks instanceof List && !((List<?>) chunks).isEmpty()) {
            return true;
        }
        return !isBlank(row.get("evidence")) || !isBlank(row.get("excerpt"));
    }

    private static boolean isBlank(Object v) {
        return v == null || String.valueOf(v).trim().isBlank() || "null".equals(String.valueOf(v));
    }

    private static boolean bool(Object v, boolean defaultValue) {
        if (v == null) {
            return defaultValue;
        }
        if (v instanceof Boolean) {
            return (Boolean) v;
        }
        String s = String.valueOf(v).trim().toLowerCase(Locale.ROOT);
        if (s.isBlank()) {
            return defaultValue;
        }
        return "1".equals(s) || "true".equals(s) || "yes".equals(s) || "on".equals(s);
    }

    static String normalize(String raw) {
        if (raw == null) {
            return "";
        }
        String s = Normalizer.normalize(raw, Normalizer.Form.NFKC)
                .replace('\u3000', ' ')
                .trim()
                .toLowerCase(Locale.ROOT);
        s = s.replaceAll("\\s+", "");
        s = s.replaceAll("[（）()【】\\[\\]{}<>《》\"'‘’“”、,，.。;；:：/\\\\|_—\\-]+", "");
        return s;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOfMaps(Object raw) {
        if (!(raw instanceof List)) {
            return List.of();
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : (List<?>) raw) {
            if (o instanceof Map) {
                out.add((Map<String, Object>) o);
            }
        }
        return out;
    }

    private static final class Indexes {
        final Map<String, String> labelToIri = new LinkedHashMap<>();
        final Map<String, String> iriToLabel = new LinkedHashMap<>();
        final Map<String, Map<String, Object>> terms = new LinkedHashMap<>();
        final Map<String, Map<String, Object>> indicators = new LinkedHashMap<>();
        final Set<String> allowedParents = new LinkedHashSet<>();

        String lookup(String label, String existing) {
            if (existing != null && !existing.isBlank()) {
                return existing.trim();
            }
            if (label == null || label.isBlank()) {
                return "";
            }
            return labelToIri.getOrDefault(normalize(label), "");
        }

        static Indexes from(Map<String, Object> context) {
            Indexes idx = new Indexes();
            if (context == null) {
                return idx;
            }
            List<Map<String, Object>> all = new ArrayList<>();
            all.addAll(listOfMaps(context.get("classes")));
            all.addAll(listOfMaps(context.get("metamodelClasses")));
            all.addAll(listOfMaps(context.get("modelClasses")));
            for (Map<String, Object> c : all) {
                String label = String.valueOf(c.getOrDefault("label", "")).trim();
                String iri = String.valueOf(c.getOrDefault("iri", "")).trim();
                if (!iri.isBlank()) {
                    idx.iriToLabel.put(iri, label.isBlank() ? iri : label);
                }
                if (!label.isBlank() && !iri.isBlank()) {
                    idx.labelToIri.putIfAbsent(normalize(label), iri);
                }
            }
            for (Map<String, Object> p : listOfMaps(context.get("properties"))) {
                String label = String.valueOf(p.getOrDefault("label", "")).trim();
                String iri = String.valueOf(p.getOrDefault("iri", "")).trim();
                if (!label.isBlank() && !iri.isBlank()) {
                    idx.labelToIri.putIfAbsent(normalize(label), iri);
                }
            }
            for (Map<String, Object> t : listOfMaps(context.get("terms"))) {
                String label = String.valueOf(t.getOrDefault("label", "")).trim();
                if (!label.isBlank()) {
                    idx.terms.putIfAbsent(normalize(label), t);
                }
            }
            for (Map<String, Object> ind : listOfMaps(context.get("indicators"))) {
                String label = String.valueOf(ind.getOrDefault("label", "")).trim();
                String code = String.valueOf(ind.getOrDefault("code", "")).trim();
                if (!label.isBlank()) {
                    idx.indicators.putIfAbsent(normalize(label), ind);
                }
                if (!code.isBlank()) {
                    idx.indicators.putIfAbsent(normalize(code), ind);
                }
            }
            Object raw = context.get("allowedParentIris");
            if (!(raw instanceof List) || ((List<?>) raw).isEmpty()) {
                raw = context.get("scopeParentIris");
            }
            if (raw instanceof List && !((List<?>) raw).isEmpty()) {
                for (Object o : (List<?>) raw) {
                    if (o != null && !String.valueOf(o).isBlank()) {
                        idx.allowedParents.add(String.valueOf(o).trim());
                    }
                }
            } else {
                for (Map<String, Object> c : listOfMaps(context.get("metamodelClasses"))) {
                    String iri = String.valueOf(c.getOrDefault("iri", "")).trim();
                    if (!iri.isBlank()) {
                        idx.allowedParents.add(iri);
                    }
                }
                if (idx.allowedParents.isEmpty()) {
                    for (Map<String, Object> c : listOfMaps(context.get("classes"))) {
                        String role = String.valueOf(c.getOrDefault("uiRole", "metamodel"))
                                .trim().toLowerCase(Locale.ROOT);
                        String iri = String.valueOf(c.getOrDefault("iri", "")).trim();
                        if (!iri.isBlank() && !"model".equals(role)) {
                            idx.allowedParents.add(iri);
                        }
                    }
                }
            }
            return idx;
        }
    }
}
