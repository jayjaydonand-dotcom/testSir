package com.benti.ontology.embed;

import com.benti.ontology.config.WebProtegeProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Doc-intel: upload → parse/chunk → candidates → human decide → OWL axioms.
 * Prefers Python worker (Docling/pypdf + schema extract); falls back to local heuristics.
 */
@Service
public class DocIntelService {

    private static final String NS = "http://example.org/doc-intel#";
    /** Same annotations as modeling-app (元模型 / 型号 / 五类分面). */
    private static final String BENTI_UI_ROLE = "http://example.org/benti#uiRole";
    private static final String BENTI_UI_FACET = "http://example.org/benti#uiFacet";
    private static final String BENTI_UI_UNIT = "http://example.org/benti#uiUnit";
    private static final String BENTI_UI_FUNCTION_CODE = "http://example.org/benti#functionCode";
    private static final String XSD_DECIMAL = "http://www.w3.org/2001/XMLSchema#decimal";
    private static final String XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
    private static final Pattern HEADING = Pattern.compile("^#{1,3}\\s+(.+)$");
    private static final Pattern CN_DEF = Pattern.compile(
            "([\u4e00-\u9fffA-Za-z0-9\\-]{2,32})(?:是一种|是|指|定义为)([\u4e00-\u9fffA-Za-z0-9\\-、，,]{2,80})");
    private static final Pattern CN_SUBCLASS = Pattern.compile(
            "([\u4e00-\u9fffA-Za-z0-9\\-]{2,24})(?:属于|是)([\u4e00-\u9fffA-Za-z0-9\\-]{2,24})(?:的一种|类|的子类)");
    private static final Pattern CN_PROP = Pattern.compile(
            "([\u4e00-\u9fffA-Za-z0-9\\-]{2,24})的(?:单位|取值|类型|属性)(?:是|为)([\u4e00-\u9fffA-Za-z0-9\\-/%]{1,32})");

    private final WebProtegeProperties props;
    private final ObjectMapper objectMapper;
    private final EmbeddedOntologyService ontology;
    private final DocIntelWorkerClient worker;
    private final OntologyContextPack contextPack;

    public DocIntelService(WebProtegeProperties props,
                           ObjectMapper objectMapper,
                           EmbeddedOntologyService ontology,
                           DocIntelWorkerClient worker,
                           OntologyContextPack contextPack) {
        this.props = props;
        this.objectMapper = objectMapper;
        this.ontology = ontology;
        this.worker = worker;
        this.contextPack = contextPack;
    }

    public Map<String, Object> engines() {
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> wh = worker.health();
        boolean reachable = Boolean.TRUE.equals(wh.get("reachable")) || Boolean.TRUE.equals(wh.get("ok"));
        boolean llm = Boolean.TRUE.equals(wh.get("llmConfigured"));
        boolean ontogpt = Boolean.TRUE.equals(wh.get("ontogptConfigured"))
                || "ontogpt".equals(String.valueOf(wh.get("extractEngine")));
        boolean argilla = Boolean.TRUE.equals(wh.get("argillaConfigured"));
        out.put("ok", true);
        out.put("workerConfigured", true);
        out.put("workerReachable", reachable);
        out.put("llmConfigured", llm);
        out.put("ontogptConfigured", ontogpt);
        out.put("argillaConfigured", argilla);
        out.put("argillaApiUrl", wh.get("argillaApiUrl"));
        out.put("argillaDataset", wh.get("argillaDataset"));
        out.put("argillaMock", wh.get("argillaMock"));
        out.put("extractEngine", wh.getOrDefault("extractEngine", reachable ? "unknown" : "unavailable"));
        out.put("llmModel", wh.get("llmModel"));
        out.put("worker", wh);
        out.put("reviewMode", "argilla");
        out.put("pdfSupported", reachable);
        if (!reachable) {
            out.put("message", "Worker 不可达。请启动 doc-intel-worker（OntoGPT + Argilla）。");
        } else if (!argilla) {
            out.put("message", "Worker 在线，但 Argilla 未配置（审核仅走 Argilla，请设 ARGILLA_API_KEY 或 ARGILLA_MOCK=1）");
        } else if (ontogpt || llm) {
            out.put("message", "OntoGPT 抽取 + Argilla 审核（" + wh.getOrDefault("extractEngine", "ontogpt") + "）");
        } else {
            out.put("message", "Worker 在线，但 OntoGPT/API Key 未就绪");
        }
        return out;
    }

    public Map<String, Object> snapshot(String projectId) {
        return normalize(projectId, readJson(storePath(projectId)));
    }

    public Map<String, Object> upload(String projectId, MultipartFile file) throws Exception {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("empty file");
        }
        Map<String, Object> doc = normalize(projectId, readJson(storePath(projectId)));
        String docId = "doc." + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String originalName = file.getOriginalFilename() == null ? "upload.bin" : file.getOriginalFilename();
        Path fileDir = filesRoot(projectId).resolve(docId);
        Files.createDirectories(fileDir);
        Path stored = fileDir.resolve(safeFileName(originalName));
        Files.write(stored, file.getBytes());

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("id", docId);
        meta.put("fileName", originalName);
        meta.put("storedPath", stored.toString());
        meta.put("size", file.getSize());
        meta.put("contentType", file.getContentType() == null ? "" : file.getContentType());
        meta.put("status", "uploaded");
        meta.put("createdAt", System.currentTimeMillis());
        meta.put("note", "支持 .txt/.md；PDF 需 doc-intel-worker（pypdf/Docling）");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> docs = (List<Map<String, Object>>) doc.get("docs");
        docs.add(0, meta);
        writeJson(storePath(projectId), doc);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("doc", meta);
        return out;
    }

    public Map<String, Object> startJob(String projectId, String docId) throws Exception {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> docs = (List<Map<String, Object>>) store.get("docs");
        Map<String, Object> meta = findById(docs, docId);
        if (meta == null) {
            throw new IllegalArgumentException("doc not found: " + docId);
        }
        String jobId = "job." + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        long now = System.currentTimeMillis();
        Map<String, Object> job = new LinkedHashMap<>();
        job.put("id", jobId);
        job.put("docId", docId);
        job.put("status", "running");
        job.put("engine", "pending");
        job.put("createdAt", now);
        job.put("updatedAt", now);
        job.put("message", "流水线执行中…");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> jobs = (List<Map<String, Object>>) store.get("jobs");
        jobs.add(0, job);
        meta.put("status", "processing");
        meta.put("latestJobId", jobId);
        writeJson(storePath(projectId), store);

        Map<String, Object> result = runPipeline(projectId, meta, jobId);
        return result;
    }

    public Map<String, Object> getJob(String projectId, String jobId) {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> jobs = (List<Map<String, Object>>) store.get("jobs");
        Map<String, Object> job = findById(jobs, jobId);
        if (job == null) {
            throw new IllegalArgumentException("job not found: " + jobId);
        }
        Map<String, Object> out = new LinkedHashMap<>(job);
        out.put("ok", true);
        return out;
    }

    public Map<String, Object> listCandidates(String projectId, String status) {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> all = listOf(store.get("candidates"));
        List<Map<String, Object>> filtered = new ArrayList<>();
        for (Map<String, Object> c : all) {
            if (status == null || status.isBlank() || status.equals(String.valueOf(c.get("status")))) {
                filtered.add(c);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("projectId", projectId);
        out.put("candidates", filtered);
        out.put("total", filtered.size());
        return out;
    }

    public Map<String, Object> listChunks(String projectId, String docId) {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> all = listOf(store.get("chunks"));
        List<Map<String, Object>> filtered = new ArrayList<>();
        for (Map<String, Object> c : all) {
            if (docId == null || docId.isBlank() || docId.equals(String.valueOf(c.get("docId")))) {
                filtered.add(c);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("chunks", filtered);
        return out;
    }

    public Map<String, Object> getEvidence(String projectId, String candidateId) {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> ev = listOf(store.get("evidence"));
        List<Map<String, Object>> hit = new ArrayList<>();
        for (Map<String, Object> e : ev) {
            if (candidateId.equals(String.valueOf(e.get("candidateId")))) {
                hit.add(e);
            }
        }
        Map<String, Object> cand = findById(listOf(store.get("candidates")), candidateId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("candidate", cand);
        out.put("evidence", hit);
        return out;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> decide(String projectId, String candidateId, String decision, String editedLabel)
            throws Exception {
        if (!"accept".equals(decision) && !"reject".equals(decision)) {
            throw new IllegalArgumentException("decision must be accept|reject");
        }
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> candidates = (List<Map<String, Object>>) store.get("candidates");
        Map<String, Object> cand = findById(candidates, candidateId);
        if (cand == null) {
            throw new IllegalArgumentException("candidate not found: " + candidateId);
        }
        if (!"pending".equals(String.valueOf(cand.get("status")))) {
            throw new IllegalStateException("candidate already decided: " + cand.get("status"));
        }
        long now = System.currentTimeMillis();
        if (editedLabel != null && !editedLabel.isBlank()) {
            cand.put("label", editedLabel.trim());
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("candidateId", candidateId);
        out.put("decision", decision);

        if ("reject".equals(decision)) {
            cand.put("status", "rejected");
            cand.put("decidedAt", now);
            writeJson(storePath(projectId), normalize(projectId, store));
            out.put("status", "rejected");
            out.put("message", "已取消该变更（未写入本体）");
            return out;
        }

        String label = String.valueOf(cand.getOrDefault("label", "未命名"));
        String kind = String.valueOf(cand.getOrDefault("kind", "Class"));
        String action = String.valueOf(cand.getOrDefault("action", "create")).trim().toLowerCase(Locale.ROOT);
        String existingIri = String.valueOf(cand.getOrDefault("existingIri", "")).trim();
        String suffix = candidateId.replace("cand.", "");
        String definition = String.valueOf(cand.getOrDefault("definition", ""));
        String rangeHint = String.valueOf(cand.getOrDefault("rangeHint", "")).trim();
        String functionCode = String.valueOf(cand.getOrDefault("functionCode", "")).trim();
        String uiFacet = String.valueOf(cand.getOrDefault("uiFacet", "")).trim();
        String parentIri = String.valueOf(cand.getOrDefault("parentIri", "")).trim();
        String parentLabel = String.valueOf(cand.getOrDefault("parentLabel", "")).trim();
        String domainHint = String.valueOf(cand.getOrDefault("domainHint", "")).trim();
        if (domainHint.isBlank()) {
            domainHint = parentLabel;
        }
        boolean asModel = isModelCandidate(cand);
        String iri;
        String owl = "";
        Object axiomResult = null;

        // --- DELETE: remove entity from ontology ---
        if ("delete".equals(action) || "Delete".equals(kind)) {
            iri = existingIri;
            if (iri.isBlank()) {
                iri = resolveLabelIri(projectId, label);
            }
            if (iri.isBlank()) {
                throw new IllegalStateException("delete target IRI missing for " + label);
            }
            axiomResult = ontology.deleteNamedEntity(projectId, iri, asModel ? "Class" : kind);
            return finishAccept(projectId, store, cand, candidateId, now, iri, owl, axiomResult, out,
                    "已删除并写入本体：" + label);
        }

        // --- MODIFY / REUSE: update annotations on existing IRI ---
        boolean isModify = "reuse".equals(action)
                || (!existingIri.isBlank() && !"create".equals(action));
        if (isModify && !existingIri.isBlank()) {
            iri = existingIri;
            Map<String, String> ann = new LinkedHashMap<>();
            if (!definition.isBlank()) {
                ann.put("http://www.w3.org/2000/01/rdf-schema#comment", definition);
            }
            if (!label.isBlank()) {
                ann.put("http://www.w3.org/2000/01/rdf-schema#label", label);
            }
            if (!rangeHint.isBlank() && ("DataProperty".equals(kind) || kind.toLowerCase(Locale.ROOT).contains("data"))) {
                ann.put(BENTI_UI_UNIT, rangeHint);
            }
            if (!functionCode.isBlank()) {
                ann.put(BENTI_UI_FUNCTION_CODE, functionCode);
            }
            if (!ann.isEmpty()) {
                axiomResult = ontology.replaceStringAnnotations(
                        projectId, iri, ann, "doc-intel modify " + candidateId);
            } else {
                axiomResult = Map.of("ok", true, "skipped", "no annotation fields");
            }
            return finishAccept(projectId, store, cand, candidateId, now, iri, owl, axiomResult, out,
                    "已修改并写入本体：" + label);
        }

        // --- ADD / CREATE ---
        if ("Relation".equals(kind)) {
            String predicate = String.valueOf(cand.getOrDefault("predicate", label));
            String subj = String.valueOf(cand.getOrDefault("relationSubject",
                    domainHint.isBlank() ? parentLabel : domainHint));
            String obj = String.valueOf(cand.getOrDefault("relationObject", rangeHint));
            iri = NS + "OP_" + suffix;
            String domainIri = resolveClassIri(projectId, parentIri, subj);
            owl = buildFacetPropertyOwl("ObjectProperty", iri, label, definition,
                    domainIri, uiFacet, "", functionCode, obj);
        } else if ("DataProperty".equals(kind) || "ObjectProperty".equals(kind)) {
            iri = NS + ("DataProperty".equals(kind) ? "DP_" : "OP_") + suffix;
            String domainIri = resolveClassIri(projectId, parentIri,
                    domainHint.isBlank() ? parentLabel : domainHint);
            owl = buildFacetPropertyOwl(kind, iri, label, definition,
                    domainIri, uiFacet, rangeHint, functionCode, rangeHint);
        } else {
            iri = NS + (asModel ? "M_" : "C_") + suffix;
            if (parentIri.isBlank() && !parentLabel.isBlank()) {
                parentIri = resolveClassIri(projectId, "", parentLabel);
                if (parentIri.isBlank()) {
                    parentIri = NS + "C_parent_" + Integer.toHexString(parentLabel.hashCode());
                }
            }
            if ("SubClassOf".equals(kind) && parentLabel.isBlank()) {
                parentLabel = "Thing";
            }
            if (asModel && parentIri.isBlank() && parentLabel.isBlank()) {
                parentLabel = "Thing";
                parentIri = "http://www.w3.org/2002/07/owl#Thing";
            }
            String role = asModel ? "model" : "metamodel";
            if (!parentIri.isBlank() || !parentLabel.isBlank()) {
                if (parentLabel.isBlank()) {
                    parentLabel = "Parent";
                }
                owl = buildSubClassOwl(iri, label, parentIri, parentLabel, definition, role);
            } else {
                owl = buildClassOwl(iri, label, definition, role);
            }
        }
        axiomResult = ontology.addAxioms(projectId, "doc-intel accept " + candidateId, owl);
        return finishAccept(projectId, store, cand, candidateId, now, iri, owl, axiomResult, out,
                "已新增并写入本体：" + label);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> finishAccept(String projectId,
                                             Map<String, Object> store,
                                             Map<String, Object> cand,
                                             String candidateId,
                                             long now,
                                             String iri,
                                             String owl,
                                             Object axiomResult,
                                             Map<String, Object> out,
                                             String message) throws Exception {
        cand.put("status", "accepted");
        cand.put("decidedAt", now);
        cand.put("acceptedIri", iri);
        cand.put("owl", owl == null ? "" : owl);
        List<Map<String, Object>> evidence = (List<Map<String, Object>>) store.get("evidence");
        if (evidence != null) {
            for (Map<String, Object> e : evidence) {
                if (candidateId.equals(String.valueOf(e.get("candidateId")))) {
                    e.put("acceptedIri", iri);
                }
            }
        }
        writeJson(storePath(projectId), normalize(projectId, store));
        out.put("status", "accepted");
        out.put("acceptedIri", iri);
        out.put("axiomResult", axiomResult);
        out.put("message", message);
        return out;
    }

    private String resolveLabelIri(String projectId, String label) {
        if (label == null || label.isBlank()) {
            return "";
        }
        try {
            Map<String, Object> pack = contextPack.build(projectId);
            for (Map<String, Object> c : listOf(pack.get("classes"))) {
                if (label.equals(String.valueOf(c.getOrDefault("label", "")).trim())) {
                    return String.valueOf(c.getOrDefault("iri", ""));
                }
            }
            for (Map<String, Object> p : listOf(pack.get("properties"))) {
                if (label.equals(String.valueOf(p.getOrDefault("label", "")).trim())) {
                    return String.valueOf(p.getOrDefault("iri", ""));
                }
            }
        } catch (Exception ignored) {
            // fall through
        }
        return "";
    }

    private String resolveClassIri(String projectId, String parentIri, String label) {
        if (parentIri != null && !parentIri.isBlank()) {
            return parentIri;
        }
        return resolveLabelIri(projectId, label);
    }

    private static String facetZhOf(String uiFacet) {
        if (uiFacet == null || uiFacet.isBlank()) {
            return "技术参数";
        }
        String f = uiFacet.trim();
        if ("technicalParam".equals(f) || "技术参数".equals(f)) return "技术参数";
        if ("stateVariable".equals(f) || "状态变量".equals(f)) return "状态变量";
        if ("relation".equals(f) || "关系".equals(f)) return "关系";
        if ("function".equals(f) || "功能".equals(f)) return "功能";
        if ("behavior".equals(f) || "行为".equals(f)) return "行为";
        return f;
    }

    /** Create property + domain + facet restriction so it appears under the class in 结构审核. */
    private static String buildFacetPropertyOwl(String kind, String propIri, String label, String definition,
                                                String domainIri, String uiFacet, String unit,
                                                String functionCode, String rangeHint) {
        boolean isData = !"ObjectProperty".equals(kind) && !"Relation".equals(kind);
        String facetZh = facetZhOf(uiFacet);
        StringBuilder sb = new StringBuilder();
        sb.append("Ontology(<http://example.org/doc-intel-patch>\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_FACET).append(">))\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_UNIT).append(">))\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_FUNCTION_CODE).append(">))\n");
        if (isData) {
            sb.append("Declaration(DataProperty(<").append(propIri).append(">))\n");
        } else {
            sb.append("Declaration(ObjectProperty(<").append(propIri).append(">))\n");
        }
        sb.append("AnnotationAssertion(rdfs:label <").append(propIri).append("> \"")
                .append(escape(label)).append("\"@zh)\n");
        if (definition != null && !definition.isBlank()) {
            sb.append("AnnotationAssertion(rdfs:comment <").append(propIri).append("> \"")
                    .append(escape(definition)).append("\"@zh)\n");
        }
        if (unit != null && !unit.isBlank() && isData) {
            sb.append("AnnotationAssertion(<").append(BENTI_UI_UNIT).append("> <").append(propIri).append("> \"")
                    .append(escape(unit)).append("\")\n");
        }
        if (domainIri != null && !domainIri.isBlank()) {
            sb.append("Declaration(Class(<").append(domainIri).append(">))\n");
            if (isData) {
                String range = (functionCode != null && !functionCode.isBlank())
                        || "功能".equals(facetZh) || "行为".equals(facetZh)
                        ? XSD_STRING : XSD_DECIMAL;
                sb.append("DataPropertyDomain(<").append(propIri).append("> <").append(domainIri).append(">)\n");
                sb.append("DataPropertyRange(<").append(propIri).append("> <").append(range).append(">)\n");
                sb.append("SubClassOf(Annotation(<").append(BENTI_UI_FACET).append("> \"")
                        .append(escape(facetZh)).append("\")");
                if (functionCode != null && !functionCode.isBlank()) {
                    sb.append(" Annotation(<").append(BENTI_UI_FUNCTION_CODE).append("> \"")
                            .append(escape(functionCode)).append("\")");
                }
                sb.append(" <").append(domainIri).append("> DataSomeValuesFrom(<").append(propIri)
                        .append("> <").append(range).append(">))\n");
            } else {
                String rangeIri = (rangeHint != null && rangeHint.startsWith("http"))
                        ? rangeHint
                        : (NS + "C_range_" + Integer.toHexString(String.valueOf(rangeHint).hashCode()));
                sb.append("Declaration(Class(<").append(rangeIri).append(">))\n");
                if (rangeHint != null && !rangeHint.isBlank() && !rangeHint.startsWith("http")) {
                    sb.append("AnnotationAssertion(rdfs:label <").append(rangeIri).append("> \"")
                            .append(escape(rangeHint)).append("\"@zh)\n");
                }
                sb.append("ObjectPropertyDomain(<").append(propIri).append("> <").append(domainIri).append(">)\n");
                sb.append("ObjectPropertyRange(<").append(propIri).append("> <").append(rangeIri).append(">)\n");
                sb.append("SubClassOf(Annotation(<").append(BENTI_UI_FACET).append("> \"")
                        .append(escape(facetZh)).append("\") <").append(domainIri)
                        .append("> ObjectSomeValuesFrom(<").append(propIri).append("> <")
                        .append(rangeIri).append(">))\n");
            }
        }
        sb.append(")");
        return sb.toString();
    }

    /**
     * Accept all pending candidates and write Declaration(Class) axioms into the project ontology.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> acceptPending(String projectId) throws Exception {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> candidates = (List<Map<String, Object>>) store.get("candidates");
        List<String> pendingIds = new ArrayList<>();
        for (Map<String, Object> c : candidates) {
            if ("pending".equals(String.valueOf(c.get("status")))) {
                pendingIds.add(String.valueOf(c.get("id")));
            }
        }
        List<Map<String, Object>> accepted = new ArrayList<>();
        List<Map<String, Object>> failed = new ArrayList<>();
        for (String id : pendingIds) {
            try {
                Map<String, Object> one = decide(projectId, id, "accept", null);
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("candidateId", id);
                row.put("acceptedIri", one.get("acceptedIri"));
                accepted.add(row);
            } catch (Exception e) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("candidateId", id);
                row.put("error", e.getMessage());
                failed.add(row);
            }
        }
        Map<String, Object> out = snapshot(projectId);
        out.put("ok", failed.isEmpty());
        out.put("acceptedCount", accepted.size());
        out.put("failedCount", failed.size());
        out.put("accepted", accepted);
        out.put("failed", failed);
        out.put("message", "已将 " + accepted.size() + " 条候选写入本体"
                + (failed.isEmpty() ? "" : ("，失败 " + failed.size() + " 条")));
        return out;
    }

    /**
     * Full metamodel + model inventory with pending add/modify/delete overlays
     * for structure review (mirrors 元模型管理 + 模型管理).
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> structureReview(String projectId) throws Exception {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> candidates = listOf(store.get("candidates"));
        List<Map<String, Object>> evidenceAll = listOf(store.get("evidence"));
        List<Map<String, Object>> tree = contextPack.buildClassTree(projectId);
        Map<String, Object> pack = contextPack.build(projectId);

        Map<String, Map<String, Object>> entityByIri = new LinkedHashMap<>();
        Map<String, String> labelToIri = new LinkedHashMap<>();
        for (Map<String, Object> c : listOf(pack.get("classes"))) {
            String label = String.valueOf(c.getOrDefault("label", "")).trim();
            String iri = String.valueOf(c.getOrDefault("iri", "")).trim();
            if (!iri.isBlank()) {
                entityByIri.put(iri, c);
            }
            if (!label.isBlank() && !iri.isBlank()) {
                labelToIri.putIfAbsent(label, iri);
            }
        }
        for (Map<String, Object> p : listOf(pack.get("properties"))) {
            String label = String.valueOf(p.getOrDefault("label", "")).trim();
            String iri = String.valueOf(p.getOrDefault("iri", "")).trim();
            if (!iri.isBlank()) {
                entityByIri.put(iri, p);
            }
            if (!label.isBlank() && !iri.isBlank()) {
                labelToIri.putIfAbsent(label, iri);
            }
        }

        List<Map<String, Object>> changes = new ArrayList<>();
        List<Map<String, Object>> pendingOnly = new ArrayList<>();
        for (Map<String, Object> cand : candidates) {
            if (!"pending".equals(String.valueOf(cand.get("status")))) {
                continue;
            }
            pendingOnly.add(cand);
            String kind = String.valueOf(cand.getOrDefault("kind", "Class"));
            String label = String.valueOf(cand.getOrDefault("label", "")).trim();
            String action = String.valueOf(cand.getOrDefault("action", "")).trim().toLowerCase(Locale.ROOT);
            String existingIri = String.valueOf(cand.getOrDefault("existingIri", "")).trim();
            String parentLabel = String.valueOf(cand.getOrDefault("parentLabel", "")).trim();
            String parentIri = String.valueOf(cand.getOrDefault("parentIri", "")).trim();
            if (parentIri.isBlank() && !parentLabel.isBlank()) {
                parentIri = labelToIri.getOrDefault(parentLabel, "");
            }

            String changeType;
            if ("delete".equals(action) || "Delete".equals(kind)) {
                changeType = "delete";
            } else if ("create".equals(action)) {
                // Explicit create stays「新增」, even if a same-label class already exists
                changeType = "add";
            } else if ("reuse".equals(action)
                    || (!existingIri.isBlank() && entityByIri.containsKey(existingIri))
                    || (action.isBlank() && labelToIri.containsKey(label))) {
                changeType = "modify";
                if (existingIri.isBlank()) {
                    existingIri = labelToIri.getOrDefault(label, "");
                }
            } else {
                changeType = "add";
            }

            boolean asModel = isModelCandidate(cand);
            String displayKind = asModel ? "Model" : kind;
            List<Map<String, Object>> evidence = evidenceForCandidate(evidenceAll, String.valueOf(cand.get("id")));
            List<Map<String, Object>> fieldDiffs = List.of();
            if ("modify".equals(changeType)) {
                Map<String, Object> existing = !existingIri.isBlank()
                        ? entityByIri.get(existingIri)
                        : entityByIri.get(labelToIri.getOrDefault(label, ""));
                fieldDiffs = buildFieldDiffs(existing, cand, evidence);
            } else if ("add".equals(changeType)) {
                fieldDiffs = buildAddFieldPreview(cand, evidence);
            } else if ("delete".equals(changeType)) {
                Map<String, Object> existing = entityByIri.get(existingIri);
                fieldDiffs = buildDeleteFieldPreview(existing != null ? existing : cand, evidence);
            }

            Map<String, Object> ch = new LinkedHashMap<>();
            ch.put("candidateId", cand.get("id"));
            ch.put("kind", displayKind);
            ch.put("uiRole", asModel ? "model" : String.valueOf(cand.getOrDefault("uiRole", "metamodel")));
            ch.put("label", label);
            ch.put("change", changeType);
            ch.put("definition", cand.getOrDefault("definition", ""));
            ch.put("parentLabel", parentLabel);
            ch.put("parentIri", parentIri);
            ch.put("existingIri", existingIri);
            ch.put("action", action.isBlank() ? ("modify".equals(changeType) ? "reuse" : "create") : action);
            ch.put("uiFacet", cand.getOrDefault("uiFacet", ""));
            ch.put("facetLabel", cand.getOrDefault("facetLabel",
                    facetDisplay(cand.get("uiFacet"), cand.get("facetLabel"))));
            ch.put("functionCode", cand.getOrDefault("functionCode", ""));
            // Prefer explicit domainHint; fall back to parentLabel (seed uses parent as domain)
            Object domainHint = cand.get("domainHint");
            if (domainHint == null || String.valueOf(domainHint).isBlank()) {
                domainHint = parentLabel;
            }
            ch.put("domainHint", domainHint == null ? "" : domainHint);
            ch.put("rangeHint", cand.getOrDefault("rangeHint", ""));
            ch.put("fieldDiffs", fieldDiffs);
            ch.put("evidence", evidence);
            changes.add(ch);

            if ("modify".equals(changeType) || "delete".equals(changeType)) {
                String targetIri = !existingIri.isBlank() ? existingIri : labelToIri.get(label);
                markTreeNode(tree, targetIri, label, changeType, cand, fieldDiffs, evidence);
            } else {
                insertAddNode(tree, cand, parentIri, parentLabel, changeType, asModel, fieldDiffs, evidence);
            }
        }

        List<Map<String, Object>> models = flattenModelNodes(tree);
        // Ensure pending model changes appear even if tree overlay missed them
        Map<String, Map<String, Object>> modelsByKey = new LinkedHashMap<>();
        for (Map<String, Object> m : models) {
            String key = String.valueOf(m.getOrDefault("candidateId", m.getOrDefault("iri", m.get("id"))));
            modelsByKey.put(key, m);
        }
        for (Map<String, Object> ch : changes) {
            boolean isModelCh = "Model".equals(String.valueOf(ch.get("kind")))
                    || "model".equals(String.valueOf(ch.get("uiRole")));
            if (!isModelCh) {
                continue;
            }
            String key = String.valueOf(ch.getOrDefault("candidateId", ch.get("label")));
            if (modelsByKey.containsKey(key)) {
                continue;
            }
            boolean already = models.stream().anyMatch(m ->
                    String.valueOf(m.get("label")).equals(String.valueOf(ch.get("label")))
                            && String.valueOf(m.getOrDefault("candidateId", "")).equals(String.valueOf(ch.get("candidateId"))));
            if (already) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", "pending:" + ch.get("candidateId"));
            row.put("iri", ch.getOrDefault("existingIri", ""));
            row.put("label", ch.get("label"));
            row.put("kind", "Model");
            row.put("uiRole", "model");
            row.put("change", ch.get("change"));
            row.put("candidateId", ch.get("candidateId"));
            row.put("definition", ch.get("definition"));
            row.put("parentLabel", ch.get("parentLabel"));
            row.put("parentIri", ch.get("parentIri"));
            row.put("fieldDiffs", ch.get("fieldDiffs"));
            row.put("evidence", ch.get("evidence"));
            row.put("children", List.of());
            models.add(row);
            modelsByKey.put(key, row);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("projectId", projectId);
        out.put("tree", tree);
        out.put("models", models);
        out.put("changes", changes);
        out.put("pendingCount", pendingOnly.size());
        Map<String, Integer> byType = new LinkedHashMap<>();
        byType.put("add", 0);
        byType.put("modify", 0);
        byType.put("delete", 0);
        for (Map<String, Object> ch : changes) {
            String t = String.valueOf(ch.get("change"));
            byType.put(t, byType.getOrDefault(t, 0) + 1);
        }
        out.put("changeStats", byType);
        out.put("contextStats", pack.get("stats"));
        return out;
    }

    private static List<Map<String, Object>> evidenceForCandidate(List<Map<String, Object>> all, String candidateId) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (candidateId == null || candidateId.isBlank()) {
            return out;
        }
        for (Map<String, Object> e : all) {
            if (candidateId.equals(String.valueOf(e.get("candidateId")))) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("id", e.get("id"));
                row.put("excerpt", e.getOrDefault("excerpt", ""));
                row.put("page", e.getOrDefault("page", ""));
                row.put("docId", e.getOrDefault("docId", ""));
                row.put("chunkId", e.getOrDefault("chunkId", ""));
                out.add(row);
            }
        }
        return out;
    }

    private static String evidenceBasis(List<Map<String, Object>> evidence) {
        if (evidence == null || evidence.isEmpty()) {
            return "文档抽取候选（无摘录）";
        }
        StringBuilder sb = new StringBuilder();
        int i = 0;
        for (Map<String, Object> e : evidence) {
            if (i >= 2) {
                break;
            }
            String excerpt = String.valueOf(e.getOrDefault("excerpt", "")).trim();
            Object page = e.get("page");
            if (!excerpt.isBlank()) {
                if (sb.length() > 0) {
                    sb.append("；");
                }
                if (page != null && !String.valueOf(page).isBlank()) {
                    sb.append("p.").append(page).append(" ");
                }
                sb.append(excerpt.length() > 120 ? excerpt.substring(0, 120) + "…" : excerpt);
                i++;
            }
        }
        return sb.length() == 0 ? "文档抽取候选（无摘录）" : sb.toString();
    }

    private static String facetDisplay(Object facetId, Object facetLabel) {
        String label = firstNonBlank(facetLabel);
        if (!label.isBlank()) {
            return label;
        }
        String id = firstNonBlank(facetId);
        if (id.isBlank()) {
            return "";
        }
        if ("technicalParam".equals(id)) {
            return "技术参数";
        }
        if ("stateVariable".equals(id)) {
            return "状态变量";
        }
        if ("relation".equals(id)) {
            return "关系";
        }
        if ("function".equals(id)) {
            return "功能";
        }
        if ("behavior".equals(id)) {
            return "行为";
        }
        return id;
    }

    private static String firstNonBlank(Object... values) {
        if (values == null) {
            return "";
        }
        for (Object v : values) {
            if (v == null) {
                continue;
            }
            String s = String.valueOf(v).trim();
            if (!s.isBlank() && !"null".equals(s)) {
                return s;
            }
        }
        return "";
    }

    private static void addFieldDiff(List<Map<String, Object>> diffs, String field, String fieldLabel,
                                     String before, String after, String basis) {
        String b = before == null ? "" : before.trim();
        String a = after == null ? "" : after.trim();
        if (b.equals(a)) {
            return;
        }
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("field", field);
        row.put("fieldLabel", fieldLabel);
        row.put("before", b.isBlank() ? "（空）" : b);
        row.put("after", a.isBlank() ? "（空）" : a);
        row.put("basis", basis);
        diffs.add(row);
    }

    /** Compare existing ontology entity vs candidate for attribute-level modify review. */
    private static List<Map<String, Object>> buildFieldDiffs(Map<String, Object> existing,
                                                             Map<String, Object> cand,
                                                             List<Map<String, Object>> evidence) {
        List<Map<String, Object>> diffs = new ArrayList<>();
        String basis = evidenceBasis(evidence);
        Map<String, Object> ex = existing != null ? existing : Map.of();
        addFieldDiff(diffs, "label", "名称",
                String.valueOf(ex.getOrDefault("label", "")),
                String.valueOf(cand.getOrDefault("label", "")), basis);
        // Prefer candidate definition; fall back to comment-style keys from pack
        String beforeDef = firstNonBlank(ex.get("definition"), ex.get("comment"));
        String afterDef = firstNonBlank(cand.get("definition"), cand.get("comment"));
        addFieldDiff(diffs, "definition", "定义", beforeDef, afterDef, basis);
        addFieldDiff(diffs, "parentLabel", "所属父类/元模型",
                String.valueOf(ex.getOrDefault("parentLabel", "")),
                String.valueOf(cand.getOrDefault("parentLabel", "")), basis);
        String beforeRole = String.valueOf(ex.getOrDefault("uiRole",
                "Model".equals(String.valueOf(ex.get("kind"))) ? "model" : "metamodel"))
                .trim().toLowerCase(Locale.ROOT);
        String afterRole = isModelCandidate(cand) ? "model"
                : String.valueOf(cand.getOrDefault("uiRole",
                "Model".equals(String.valueOf(cand.get("kind"))) ? "model" : "metamodel"))
                .trim().toLowerCase(Locale.ROOT);
        if (!beforeRole.equals(afterRole)) {
            addFieldDiff(diffs, "uiRole", "类别（元模型/模型）",
                    "model".equals(beforeRole) ? "模型" : "元模型",
                    "model".equals(afterRole) ? "模型" : "元模型", basis);
        }
        addFieldDiff(diffs, "domainHint", "定义域提示",
                String.valueOf(ex.getOrDefault("domainHint", "")),
                String.valueOf(cand.getOrDefault("domainHint", "")), basis);
        addFieldDiff(diffs, "rangeHint", "值域/单位提示",
                firstNonBlank(ex.get("rangeHint"), ex.get("unit")),
                firstNonBlank(cand.get("rangeHint"), cand.get("unit")), basis);
        addFieldDiff(diffs, "uiFacet", "所属分面",
                facetDisplay(ex.get("uiFacet"), ex.get("facetLabel")),
                facetDisplay(cand.get("uiFacet"), cand.get("facetLabel")), basis);
        addFieldDiff(diffs, "functionCode", "功能编码",
                String.valueOf(ex.getOrDefault("functionCode", "")),
                String.valueOf(cand.getOrDefault("functionCode", "")), basis);
        if (diffs.isEmpty()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("field", "match");
            row.put("fieldLabel", "匹配说明");
            row.put("before", String.valueOf(ex.getOrDefault("label", cand.getOrDefault("label", ""))));
            row.put("after", "文档命中已有实体（复用，无字段差异）");
            row.put("basis", basis);
            diffs.add(row);
        }
        return diffs;
    }

    private static List<Map<String, Object>> buildAddFieldPreview(Map<String, Object> cand,
                                                                  List<Map<String, Object>> evidence) {
        List<Map<String, Object>> diffs = new ArrayList<>();
        String basis = evidenceBasis(evidence);
        addFieldDiff(diffs, "label", "名称", "", String.valueOf(cand.getOrDefault("label", "")), basis);
        addFieldDiff(diffs, "definition", "定义", "", String.valueOf(cand.getOrDefault("definition", "")), basis);
        addFieldDiff(diffs, "parentLabel", "所属父类/元模型", "",
                String.valueOf(cand.getOrDefault("parentLabel", "")), basis);
        String role = isModelCandidate(cand) ? "模型" : "元模型";
        addFieldDiff(diffs, "uiRole", "类别（元模型/模型）", "", role, basis);
        addFieldDiff(diffs, "domainHint", "定义域提示", "",
                String.valueOf(cand.getOrDefault("domainHint", "")), basis);
        addFieldDiff(diffs, "rangeHint", "值域/单位提示", "",
                String.valueOf(cand.getOrDefault("rangeHint", "")), basis);
        return diffs;
    }

    private static List<Map<String, Object>> buildDeleteFieldPreview(Map<String, Object> entity,
                                                                     List<Map<String, Object>> evidence) {
        List<Map<String, Object>> diffs = new ArrayList<>();
        String basis = evidenceBasis(evidence);
        addFieldDiff(diffs, "label", "名称",
                String.valueOf(entity.getOrDefault("label", "")), "（删除）", basis);
        addFieldDiff(diffs, "definition", "定义",
                String.valueOf(entity.getOrDefault("definition", "")), "（删除）", basis);
        return diffs;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> flattenModelNodes(List<Map<String, Object>> nodes) {
        List<Map<String, Object>> out = new ArrayList<>();
        flattenModelNodesRec(nodes, out);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static void flattenModelNodesRec(List<Map<String, Object>> nodes, List<Map<String, Object>> out) {
        if (nodes == null) {
            return;
        }
        for (Map<String, Object> n : nodes) {
            String id = String.valueOf(n.getOrDefault("id", ""));
            if ("virtual:proposed-models".equals(id) || isModelNodeMap(n)) {
                if (isModelNodeMap(n)) {
                    out.add(n);
                } else {
                    flattenModelNodesRec(listOf(n.get("children")), out);
                }
            } else {
                flattenModelNodesRec(listOf(n.get("children")), out);
            }
        }
    }

    private static boolean isModelNodeMap(Map<String, Object> n) {
        return "Model".equals(String.valueOf(n.getOrDefault("kind", "")))
                || "model".equals(String.valueOf(n.getOrDefault("uiRole", "")));
    }

    @SuppressWarnings("unchecked")
    private static void markTreeNode(List<Map<String, Object>> nodes, String iri, String label,
                                     String changeType, Map<String, Object> cand,
                                     List<Map<String, Object>> fieldDiffs,
                                     List<Map<String, Object>> evidence) {
        if (nodes == null) {
            return;
        }
        for (Map<String, Object> n : nodes) {
            String nIri = String.valueOf(n.getOrDefault("iri", ""));
            String nLabel = String.valueOf(n.getOrDefault("label", ""));
            String nKind = String.valueOf(n.get("kind"));
            boolean hit = (!iri.isBlank() && iri.equals(nIri))
                    || (!label.isBlank() && label.equals(nLabel)
                    && ("Class".equals(nKind) || "Model".equals(nKind)
                    || "ObjectProperty".equals(nKind) || "DataProperty".equals(nKind)));
            if (hit) {
                n.put("change", changeType);
                n.put("candidateId", cand.get("id"));
                n.put("pendingKind", cand.get("kind"));
                n.put("definition", cand.getOrDefault("definition", n.get("definition")));
                n.put("fieldDiffs", fieldDiffs);
                n.put("evidence", evidence);
                if (isModelCandidate(cand)) {
                    n.put("kind", "Model");
                    n.put("uiRole", "model");
                }
                return;
            }
            markTreeNode(listOf(n.get("children")), iri, label, changeType, cand, fieldDiffs, evidence);
        }
    }

    @SuppressWarnings("unchecked")
    private static void insertAddNode(List<Map<String, Object>> roots, Map<String, Object> cand,
                                      String parentIri, String parentLabel, String changeType,
                                      boolean asModel, List<Map<String, Object>> fieldDiffs,
                                      List<Map<String, Object>> evidence) {
        Map<String, Object> node = new LinkedHashMap<>();
        String cid = String.valueOf(cand.get("id"));
        node.put("id", "pending:" + cid);
        node.put("iri", "");
        node.put("label", cand.getOrDefault("label", "未命名"));
        node.put("kind", asModel ? "Model" : cand.getOrDefault("kind", "Class"));
        node.put("uiRole", asModel ? "model" : "metamodel");
        node.put("change", changeType);
        node.put("candidateId", cid);
        node.put("definition", cand.getOrDefault("definition", ""));
        node.put("parentIri", parentIri);
        node.put("parentLabel", parentLabel);
        node.put("fieldDiffs", fieldDiffs);
        node.put("evidence", evidence);
        node.put("children", new ArrayList<>());

        if (!parentIri.isBlank() && attachUnder(roots, parentIri, null, node)) {
            return;
        }
        if (!parentLabel.isBlank() && attachUnder(roots, null, parentLabel, node)) {
            return;
        }
        String bucketId = asModel ? "virtual:proposed-models" : "virtual:proposed";
        String bucketLabel = asModel ? "待挂接模型" : "待挂接变更";
        Map<String, Object> bucket = null;
        for (Map<String, Object> r : roots) {
            if (bucketId.equals(String.valueOf(r.get("id")))) {
                bucket = r;
                break;
            }
        }
        if (bucket == null) {
            bucket = new LinkedHashMap<>();
            bucket.put("id", bucketId);
            bucket.put("iri", "");
            bucket.put("label", bucketLabel);
            bucket.put("kind", "Folder");
            bucket.put("change", "stable");
            bucket.put("children", new ArrayList<Map<String, Object>>());
            roots.add(0, bucket);
        }
        ((List<Map<String, Object>>) bucket.get("children")).add(node);
    }

    @SuppressWarnings("unchecked")
    private static boolean attachUnder(List<Map<String, Object>> nodes, String parentIri, String parentLabel,
                                       Map<String, Object> child) {
        if (nodes == null) {
            return false;
        }
        for (Map<String, Object> n : nodes) {
            String nIri = String.valueOf(n.getOrDefault("iri", ""));
            String nLabel = String.valueOf(n.getOrDefault("label", ""));
            boolean hit = (parentIri != null && !parentIri.isBlank() && parentIri.equals(nIri))
                    || (parentLabel != null && !parentLabel.isBlank() && parentLabel.equals(nLabel));
            if (hit) {
                List<Map<String, Object>> kids = listOf(n.get("children"));
                // ensure mutable
                if (!(n.get("children") instanceof ArrayList)) {
                    n.put("children", new ArrayList<>(kids));
                    kids = (List<Map<String, Object>>) n.get("children");
                }
                kids.add(child);
                return true;
            }
            if (attachUnder(listOf(n.get("children")), parentIri, parentLabel, child)) {
                return true;
            }
        }
        return false;
    }

    /** Batch accept/reject selected candidate ids. */
    public Map<String, Object> decideBatch(String projectId, List<String> candidateIds, String decision)
            throws Exception {
        if (!"accept".equals(decision) && !"reject".equals(decision)) {
            throw new IllegalArgumentException("decision must be accept|reject");
        }
        List<Map<String, Object>> applied = new ArrayList<>();
        List<Map<String, Object>> failed = new ArrayList<>();
        if (candidateIds != null) {
            for (String id : candidateIds) {
                if (id == null || id.isBlank()) {
                    continue;
                }
                try {
                    Map<String, Object> one = decide(projectId, id, decision, null);
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("candidateId", id);
                    row.put("status", one.get("status"));
                    row.put("acceptedIri", one.get("acceptedIri"));
                    applied.add(row);
                } catch (Exception e) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("candidateId", id);
                    row.put("error", e.getMessage());
                    failed.add(row);
                }
            }
        }
        Map<String, Object> out = structureReview(projectId);
        out.put("ok", failed.isEmpty());
        out.put("decision", decision);
        out.put("appliedCount", applied.size());
        out.put("failedCount", failed.size());
        out.put("applied", applied);
        out.put("failed", failed);
        out.put("message", ("accept".equals(decision) ? "已接受 " : "已取消 ")
                + applied.size() + " 条"
                + (failed.isEmpty() ? "" : ("，失败 " + failed.size() + " 条")));
        return out;
    }

    /** Push pending candidates to Argilla for external human review. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> pushToArgilla(String projectId) throws Exception {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> candidates = listOf(store.get("candidates"));
        List<Map<String, Object>> pending = new ArrayList<>();
        for (Map<String, Object> c : candidates) {
            if ("pending".equals(String.valueOf(c.get("status")))) {
                pending.add(c);
            }
        }
        List<Map<String, Object>> evidence = listOf(store.get("evidence"));
        Map<String, Object> pushed = worker.argillaPush(projectId, pending, evidence);
        Map<String, Object> out = new LinkedHashMap<>(pushed);
        out.put("projectId", projectId);
        out.put("pendingCount", pending.size());
        return out;
    }

    /**
     * Pull Argilla annotations and apply decide(accept|reject) for matching pending candidates.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> syncFromArgilla(String projectId) throws Exception {
        Map<String, Object> pulled = worker.argillaPull(projectId);
        List<Map<String, Object>> decisions = listOf(pulled.get("decisions"));
        List<Map<String, Object>> applied = new ArrayList<>();
        List<Map<String, Object>> skipped = new ArrayList<>();
        List<Map<String, Object>> failed = new ArrayList<>();
        for (Map<String, Object> d : decisions) {
            String candidateId = String.valueOf(d.getOrDefault("candidateId", ""));
            String decision = String.valueOf(d.getOrDefault("decision", "")).trim().toLowerCase(Locale.ROOT);
            if (candidateId.isBlank() || (!"accept".equals(decision) && !"reject".equals(decision))) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("candidateId", candidateId);
                row.put("reason", "invalid decision");
                skipped.add(row);
                continue;
            }
            try {
                Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
                Map<String, Object> cand = findById(listOf(store.get("candidates")), candidateId);
                if (cand == null) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("candidateId", candidateId);
                    row.put("reason", "candidate not found");
                    skipped.add(row);
                    continue;
                }
                if (!"pending".equals(String.valueOf(cand.get("status")))) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("candidateId", candidateId);
                    row.put("reason", "already " + cand.get("status"));
                    skipped.add(row);
                    continue;
                }
                Map<String, Object> one = decide(projectId, candidateId, decision, null);
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("candidateId", candidateId);
                row.put("decision", decision);
                row.put("status", one.get("status"));
                row.put("acceptedIri", one.get("acceptedIri"));
                applied.add(row);
            } catch (Exception e) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("candidateId", candidateId);
                row.put("decision", decision);
                row.put("error", e.getMessage());
                failed.add(row);
            }
        }
        Map<String, Object> out = snapshot(projectId);
        out.put("ok", failed.isEmpty());
        out.put("pulledCount", decisions.size());
        out.put("appliedCount", applied.size());
        out.put("skippedCount", skipped.size());
        out.put("failedCount", failed.size());
        out.put("applied", applied);
        out.put("skipped", skipped);
        out.put("failed", failed);
        out.put("argilla", pulled);
        out.put("message", "Argilla 同步：应用 " + applied.size() + " 条"
                + (failed.isEmpty() ? "" : ("，失败 " + failed.size() + " 条")));
        return out;
    }

    /**
     * Curated structure-review demo: baseline metamodel+models in OWL, then pending
     * add/modify/delete candidates with explicit attribute diffs + evidence.
     * Deterministic (no OntoGPT) so 结构审核 can show clear field-level changes.
     */
    public Map<String, Object> seedDemo(String projectId) throws Exception {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        String docId = "doc.demo";

        String iriHeli = NS + "C_Helicopter";
        String iriRotor = NS + "C_MainRotor";
        String iriTail = NS + "C_TailRotor";
        String iriMTOW = NS + "DP_MaxTakeoffWeight";
        String iriRotorDia = NS + "DP_RotorDiameter";
        String iriEndurance = NS + "DP_Endurance";
        String iriAltitude = NS + "DP_Altitude";
        String iriHeading = NS + "DP_Heading";
        String iriHasRotor = NS + "OP_HasMainRotor";
        String iriHasTail = NS + "OP_HasTailRotor";
        String iriVtol = NS + "DP_CapabilityVTOL";
        String iriHover = NS + "DP_CapabilityHover";
        String iriTakeoffBeh = NS + "DP_BehaviorTakeoff";
        String iriCruiseBeh = NS + "DP_BehaviorCruise";
        String iriTransport = NS + "M_TransportHeli";
        String iriScout = NS + "M_ScoutHeli";

        // 1) Baseline：直升机元模型五类分面 + 型号，便于在元模型管理/结构审核中验证
        String baselineOwl = buildHelicopterBaselineOwl(
                iriHeli, iriRotor, iriTail,
                iriMTOW, iriRotorDia, iriEndurance,
                iriAltitude, iriHeading,
                iriHasRotor, iriHasTail,
                iriVtol, iriHover, iriTakeoffBeh, iriCruiseBeh,
                iriTransport, iriScout);
        ontology.addAxioms(projectId, "doc-intel seed helicopter metamodel facets + models", baselineOwl);

        String sample = ""
                + "# 旋翼平台论证摘录（结构审核示范）\n\n"
                + "【元模型·修改】直升机是一种以旋翼系统提供升力与部分推进力的垂直起降飞行器，用于运输、攻击与特种作战。\n"
                + "【元模型·新增】动力系统是为旋翼与尾桨提供功率的成套装置。\n"
                + "【技术参数·修改】最大起飞重量指航空器允许起飞的最大重量，单位为千克（kg）。\n"
                + "【技术参数·新增】任务载荷是可装载的任务设备与物资质量，单位千克。\n"
                + "【状态变量·修改】当前高度指飞行中相对起飞点的气压高度，单位米。\n"
                + "【关系·新增】挂载武器系统描述直升机与武器吊舱/火控的对象关系。\n"
                + "【关系·删除】论证建议取消独立「安装尾桨」关系条目，并入尾桨组件装配约束。\n"
                + "【功能·修改】垂直起降能力指无需跑道完成起降的功能（编码 VTOL）。\n"
                + "【行为·新增】攻击机动是进入射击航线并完成火力投送的行为描述。\n"
                + "【模型·新增】武装直升机属于直升机，是配备对地/对空武器系统的作战型号。\n"
                + "【模型·修改】运输直升机是以人员和物资运输为主要任务的直升机型号，强调舱容与外吊能力。\n"
                + "【模型·删除】论证结论建议不再保留「侦察直升机」作为独立型号条目，其能力并入多用途型号。\n"
                + "主旋翼是提供升力和部分推进的气动装置。\n"
                + "尾桨是用于抗扭与航向控制的装置。\n";

        Path fileDir = filesRoot(projectId).resolve(docId);
        Files.createDirectories(fileDir);
        Path stored = fileDir.resolve("demo-spec.md");
        Files.writeString(stored, sample, StandardCharsets.UTF_8);

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("id", docId);
        meta.put("fileName", "demo-spec.md");
        meta.put("storedPath", stored.toString());
        meta.put("size", (long) sample.getBytes(StandardCharsets.UTF_8).length);
        meta.put("contentType", "text/markdown");
        meta.put("status", "ready");
        meta.put("createdAt", System.currentTimeMillis());
        meta.put("note", "结构审核示范：含元模型与模型的增删改");
        meta.put("engine", "curated-demo");

        List<Map<String, Object>> chunks = chunkText(docId, sample);
        List<Map<String, Object>> candidates = new ArrayList<>();
        List<Map<String, Object>> evidence = new ArrayList<>();

        // --- 元模型：修改直升机定义 ---
        addCuratedCandidate(candidates, evidence, docId, chunks,
                "Class", "直升机",
                "以旋翼系统提供升力与部分推进力的垂直起降飞行器，用于运输、攻击与特种作战",
                null, iriHeli, "reuse", "metamodel",
                "直升机是一种以旋翼系统提供升力与部分推进力的垂直起降飞行器，用于运输、攻击与特种作战。", 1);

        // --- 元模型：新增动力系统 ---
        addCuratedCandidate(candidates, evidence, docId, chunks,
                "Class", "动力系统",
                "为旋翼与尾桨提供功率的成套装置",
                null, null, "create", "metamodel",
                "动力系统是为旋翼与尾桨提供功率的成套装置。", 1);

        // --- 技术参数：修改最大起飞重量 ---
        Map<String, Object> mtow = addCuratedCandidate(candidates, evidence, docId, chunks,
                "DataProperty", "最大起飞重量",
                "航空器允许起飞的最大重量",
                "直升机", iriMTOW, "reuse", null,
                "最大起飞重量指航空器允许起飞的最大重量，单位为千克（kg）。", 1);
        mtow.put("rangeHint", "千克(kg)");
        mtow.put("uiFacet", "technicalParam");
        mtow.put("facetLabel", "技术参数");
        mtow.put("domainHint", "直升机");

        // --- 技术参数：新增任务载荷 ---
        Map<String, Object> payload = addCuratedCandidate(candidates, evidence, docId, chunks,
                "DataProperty", "任务载荷",
                "可装载的任务设备与物资质量",
                "直升机", null, "create", null,
                "任务载荷是可装载的任务设备与物资质量，单位千克。", 1);
        payload.put("rangeHint", "千克");
        payload.put("uiFacet", "technicalParam");
        payload.put("facetLabel", "技术参数");
        payload.put("domainHint", "直升机");
        payload.put("existingIri", ""); // force add
        // reuse fixed IRI only after accept; keep create

        // --- 状态变量：修改当前高度 ---
        Map<String, Object> alt = addCuratedCandidate(candidates, evidence, docId, chunks,
                "DataProperty", "当前高度",
                "飞行中相对起飞点的气压高度",
                "直升机", iriAltitude, "reuse", null,
                "当前高度指飞行中相对起飞点的气压高度，单位米。", 1);
        alt.put("rangeHint", "米");
        alt.put("uiFacet", "stateVariable");
        alt.put("facetLabel", "状态变量");
        alt.put("domainHint", "直升机");

        // --- 关系：新增挂载武器系统 ---
        Map<String, Object> weapon = addCuratedCandidate(candidates, evidence, docId, chunks,
                "ObjectProperty", "挂载武器系统",
                "直升机与武器吊舱/火控之间的挂载关系",
                "直升机", null, "create", null,
                "挂载武器系统描述直升机与武器吊舱/火控的对象关系。", 1);
        weapon.put("uiFacet", "relation");
        weapon.put("facetLabel", "关系");
        weapon.put("domainHint", "直升机");
        weapon.put("rangeHint", "武器系统");

        // --- 关系：删除安装尾桨 ---
        Map<String, Object> dropTail = addCuratedCandidate(candidates, evidence, docId, chunks,
                "ObjectProperty", "安装尾桨",
                "直升机与尾桨的安装关系",
                "直升机", iriHasTail, "delete", null,
                "论证建议取消独立「安装尾桨」关系条目，并入尾桨组件装配约束。", 1);
        dropTail.put("uiFacet", "relation");
        dropTail.put("facetLabel", "关系");
        dropTail.put("domainHint", "直升机");

        // --- 功能：修改垂直起降 ---
        Map<String, Object> vtol = addCuratedCandidate(candidates, evidence, docId, chunks,
                "DataProperty", "垂直起降",
                "无需跑道完成起降的功能",
                "直升机", iriVtol, "reuse", null,
                "垂直起降能力指无需跑道完成起降的功能（编码 VTOL）。", 1);
        vtol.put("uiFacet", "function");
        vtol.put("facetLabel", "功能");
        vtol.put("functionCode", "VTOL");
        vtol.put("domainHint", "直升机");

        // --- 行为：新增攻击机动 ---
        Map<String, Object> attack = addCuratedCandidate(candidates, evidence, docId, chunks,
                "DataProperty", "攻击机动",
                "进入射击航线并完成火力投送的行为",
                "直升机", null, "create", null,
                "攻击机动是进入射击航线并完成火力投送的行为描述。", 1);
        attack.put("uiFacet", "behavior");
        attack.put("facetLabel", "行为");
        attack.put("domainHint", "直升机");

        // --- 模型：新增武装直升机 ---
        addCuratedCandidate(candidates, evidence, docId, chunks,
                "Model", "武装直升机",
                "配备对地/对空武器系统的作战型号",
                "直升机", null, "create", "model",
                "武装直升机属于直升机，是配备对地/对空武器系统的作战型号。", 1)
                .put("parentIri", iriHeli);

        // --- 模型：修改运输直升机定义 ---
        addCuratedCandidate(candidates, evidence, docId, chunks,
                "Model", "运输直升机",
                "以人员和物资运输为主要任务的直升机型号，强调舱容与外吊能力",
                "直升机", iriTransport, "reuse", "model",
                "运输直升机是以人员和物资运输为主要任务的直升机型号，强调舱容与外吊能力。", 1)
                .put("parentIri", iriHeli);

        // --- 模型：删除侦察直升机 ---
        addCuratedCandidate(candidates, evidence, docId, chunks,
                "Model", "侦察直升机",
                "用于战场侦察的轻型直升机",
                "直升机", iriScout, "delete", "model",
                "论证结论建议不再保留「侦察直升机」作为独立型号条目，其能力并入多用途型号。", 1)
                .put("parentIri", iriHeli);

        List<Map<String, Object>> docs = listOf(store.get("docs"));
        docs.removeIf(d -> docId.equals(String.valueOf(d.get("id"))));
        docs.add(0, meta);
        store.put("docs", docs);
        List<Map<String, Object>> nextChunks = filterOutDoc(listOf(store.get("chunks")), docId);
        nextChunks.addAll(0, chunks);
        store.put("chunks", nextChunks);
        // Fresh demo: replace all candidates/evidence so decided overlays match this seed only
        store.put("candidates", new ArrayList<>(candidates));
        store.put("evidence", new ArrayList<>(evidence));

        String jobId = "job.demo." + System.currentTimeMillis();
        Map<String, Object> job = new LinkedHashMap<>();
        job.put("id", jobId);
        job.put("docId", docId);
        job.put("status", "done");
        job.put("engine", "curated-demo");
        job.put("createdAt", System.currentTimeMillis());
        job.put("updatedAt", System.currentTimeMillis());
        job.put("chunkCount", chunks.size());
        job.put("candidateCount", candidates.size());
        job.put("message", "结构审核示范已就绪：直升机五类分面齐全；元模型/分面/模型均含增删改");
        List<Map<String, Object>> jobs = listOf(store.get("jobs"));
        jobs.removeIf(j -> docId.equals(String.valueOf(j.get("docId"))));
        jobs.add(0, job);
        store.put("jobs", jobs);
        meta.put("latestJobId", jobId);

        writeJson(storePath(projectId), normalize(projectId, store));

        Map<String, Object> out = snapshot(projectId);
        out.put("ok", true);
        out.put("job", job);
        out.put("engine", "curated-demo");
        out.put("structureReview", structureReview(projectId));
        out.put("message", String.valueOf(job.get("message")));
        return out;
    }

    /**
     * Helicopter metamodel with modeling-app 五类分面 (技术参数/状态变量/关系/功能/行为)
     * written as SubClassOf(Annotation(uiFacet "…") Class Data/ObjectSomeValuesFrom(…)).
     */
    private static String buildHelicopterBaselineOwl(
            String iriHeli, String iriRotor, String iriTail,
            String iriMTOW, String iriRotorDia, String iriEndurance,
            String iriAltitude, String iriHeading,
            String iriHasRotor, String iriHasTail,
            String iriVtol, String iriHover, String iriTakeoffBeh, String iriCruiseBeh,
            String iriTransport, String iriScout) {
        StringBuilder sb = new StringBuilder();
        sb.append("Ontology(<http://example.org/doc-intel-baseline>\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_ROLE).append(">))\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_FACET).append(">))\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_UNIT).append(">))\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_FUNCTION_CODE).append(">))\n");

        // Classes
        appendMetaClass(sb, iriHeli, "直升机", "以旋翼提供升力的飞行器");
        appendMetaClass(sb, iriRotor, "主旋翼", "提供升力的气动装置");
        appendMetaClass(sb, iriTail, "尾桨", "抗扭与航向控制装置");

        // 技术参数
        appendDataFacet(sb, iriHeli, iriMTOW, "最大起飞重量", "允许起飞的最大重量", "kg", "技术参数", null);
        appendDataFacet(sb, iriHeli, iriRotorDia, "旋翼直径", "主旋翼桨盘直径", "m", "技术参数", null);
        appendDataFacet(sb, iriHeli, iriEndurance, "续航时间", "规定任务剖面下可持续飞行时间", "h", "技术参数", null);

        // 状态变量
        appendDataFacet(sb, iriHeli, iriAltitude, "当前高度", "相对起飞点的气压高度", "m", "状态变量", null);
        appendDataFacet(sb, iriHeli, iriHeading, "当前航向", "机头方位角", "deg", "状态变量", null);

        // 关系
        appendObjectFacet(sb, iriHeli, iriHasRotor, "安装主旋翼", "直升机与主旋翼的安装关系", iriRotor, "关系");
        appendObjectFacet(sb, iriHeli, iriHasTail, "安装尾桨", "直升机与尾桨的安装关系", iriTail, "关系");

        // 功能
        appendDataFacet(sb, iriHeli, iriVtol, "垂直起降", "无需跑道完成起降", null, "功能", "VTOL");
        appendDataFacet(sb, iriHeli, iriHover, "悬停", "空中定点悬停能力", null, "功能", "HOVER");

        // 行为
        appendDataFacet(sb, iriHeli, iriTakeoffBeh, "起飞流程", "从地面滑跑/离地到爬升的行为过程", null, "行为", null);
        appendDataFacet(sb, iriHeli, iriCruiseBeh, "巡航行为", "定常巡航段的姿态与功率控制行为", null, "行为", null);

        // Models
        appendModelClass(sb, iriTransport, "运输直升机", "用于人员和物资运输的直升机", iriHeli);
        appendModelClass(sb, iriScout, "侦察直升机", "用于战场侦察的轻型直升机", iriHeli);

        sb.append(")");
        return sb.toString();
    }

    private static void appendMetaClass(StringBuilder sb, String iri, String label, String comment) {
        sb.append("Declaration(Class(<").append(iri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(iri).append("> \"").append(escape(label)).append("\"@zh)\n");
        sb.append("AnnotationAssertion(rdfs:comment <").append(iri).append("> \"").append(escape(comment)).append("\"@zh)\n");
        sb.append("AnnotationAssertion(<").append(BENTI_UI_ROLE).append("> <").append(iri).append("> \"metamodel\")\n");
    }

    private static void appendModelClass(StringBuilder sb, String iri, String label, String comment, String parentIri) {
        sb.append("Declaration(Class(<").append(iri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(iri).append("> \"").append(escape(label)).append("\"@zh)\n");
        sb.append("AnnotationAssertion(rdfs:comment <").append(iri).append("> \"").append(escape(comment)).append("\"@zh)\n");
        sb.append("AnnotationAssertion(<").append(BENTI_UI_ROLE).append("> <").append(iri).append("> \"model\")\n");
        sb.append("SubClassOf(<").append(iri).append("> <").append(parentIri).append(">)\n");
    }

    private static void appendDataFacet(StringBuilder sb, String classIri, String propIri,
                                        String label, String comment, String unit,
                                        String facetZh, String functionCode) {
        sb.append("Declaration(DataProperty(<").append(propIri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(propIri).append("> \"").append(escape(label)).append("\"@zh)\n");
        sb.append("AnnotationAssertion(rdfs:comment <").append(propIri).append("> \"").append(escape(comment)).append("\"@zh)\n");
        if (unit != null && !unit.isBlank()) {
            sb.append("AnnotationAssertion(<").append(BENTI_UI_UNIT).append("> <").append(propIri).append("> \"")
                    .append(escape(unit)).append("\")\n");
        }
        String range = (functionCode != null || "功能".equals(facetZh) || "行为".equals(facetZh))
                ? XSD_STRING : XSD_DECIMAL;
        sb.append("DataPropertyDomain(<").append(propIri).append("> <").append(classIri).append(">)\n");
        sb.append("DataPropertyRange(<").append(propIri).append("> <").append(range).append(">)\n");
        sb.append("SubClassOf(Annotation(<").append(BENTI_UI_FACET).append("> \"").append(escape(facetZh)).append("\")");
        if (functionCode != null && !functionCode.isBlank()) {
            sb.append(" Annotation(<").append(BENTI_UI_FUNCTION_CODE).append("> \"")
                    .append(escape(functionCode)).append("\")");
        }
        sb.append(" <").append(classIri).append("> DataSomeValuesFrom(<").append(propIri)
                .append("> <").append(range).append(">))\n");
    }

    private static void appendObjectFacet(StringBuilder sb, String classIri, String propIri,
                                          String label, String comment, String rangeIri, String facetZh) {
        sb.append("Declaration(ObjectProperty(<").append(propIri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(propIri).append("> \"").append(escape(label)).append("\"@zh)\n");
        sb.append("AnnotationAssertion(rdfs:comment <").append(propIri).append("> \"").append(escape(comment)).append("\"@zh)\n");
        sb.append("ObjectPropertyDomain(<").append(propIri).append("> <").append(classIri).append(">)\n");
        sb.append("ObjectPropertyRange(<").append(propIri).append("> <").append(rangeIri).append(">)\n");
        sb.append("SubClassOf(Annotation(<").append(BENTI_UI_FACET).append("> \"").append(escape(facetZh)).append("\") <")
                .append(classIri).append("> ObjectSomeValuesFrom(<").append(propIri).append("> <")
                .append(rangeIri).append(">))\n");
    }

    /** Helper: append curated candidate + evidence; returns the candidate map for extra fields. */
    private Map<String, Object> addCuratedCandidate(List<Map<String, Object>> candidates,
                                                    List<Map<String, Object>> evidence,
                                                    String docId,
                                                    List<Map<String, Object>> chunks,
                                                    String kind, String label, String definition,
                                                    String parentLabel, String existingIri,
                                                    String action, String uiRole,
                                                    String excerpt, int page) {
        String candId = "cand.demo." + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String chunkId = chunks.isEmpty() ? "" : String.valueOf(chunks.get(0).get("id"));
        Map<String, Object> cand = new LinkedHashMap<>();
        cand.put("id", candId);
        cand.put("docId", docId);
        cand.put("kind", kind);
        cand.put("label", label);
        cand.put("definition", definition);
        cand.put("status", "pending");
        cand.put("action", action);
        cand.put("chunkIds", chunkId.isBlank() ? List.of() : List.of(chunkId));
        cand.put("engine", "curated-demo");
        cand.put("createdAt", System.currentTimeMillis());
        if (parentLabel != null && !parentLabel.isBlank()) {
            cand.put("parentLabel", parentLabel);
        }
        if (existingIri != null && !existingIri.isBlank()) {
            cand.put("existingIri", existingIri);
        }
        if (uiRole != null && !uiRole.isBlank()) {
            cand.put("uiRole", uiRole);
            cand.put("role", uiRole);
        }
        candidates.add(cand);

        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("id", "ev." + candId.substring(5));
        ev.put("candidateId", candId);
        ev.put("docId", docId);
        ev.put("chunkId", chunkId);
        ev.put("page", page);
        String ex = excerpt == null ? "" : excerpt;
        ev.put("excerpt", ex.length() > 200 ? ex.substring(0, 200) + "…" : ex);
        evidence.add(ev);
        return cand;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> runPipeline(String projectId, Map<String, Object> meta, String jobId)
            throws Exception {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> jobs = (List<Map<String, Object>>) store.get("jobs");
        Map<String, Object> job = findById(jobs, jobId);
        String docId = String.valueOf(meta.get("id"));
        Path path = Paths.get(String.valueOf(meta.get("storedPath")));
        String fileName = String.valueOf(meta.get("fileName"));

        List<Map<String, Object>> chunks;
        List<Map<String, Object>> candidates;
        List<Map<String, Object>> evidence;
        String engineLabel = "ontogpt";

        Map<String, Object> workerHealth = worker.health();
        boolean workerOk = Boolean.TRUE.equals(workerHealth.get("reachable"))
                || Boolean.TRUE.equals(workerHealth.get("ok"));
        if (workerOk) {
            try {
                Map<String, Object> ctx = contextPack.build(projectId);
                Map<String, Object> pipe = worker.pipeline(docId, path, fileName, ctx);
                chunks = listOf(pipe.get("chunks"));
                candidates = listOf(pipe.get("candidates"));
                evidence = listOf(pipe.get("evidence"));
                for (Map<String, Object> c : candidates) {
                    c.putIfAbsent("status", "pending");
                    c.putIfAbsent("docId", docId);
                }
                engineLabel = String.valueOf(pipe.getOrDefault("parseEngine", "worker"))
                        + "+" + pipe.getOrDefault("extractEngine", "ontogpt");
                if (job != null) {
                    job.put("engine", engineLabel);
                    job.put("contextStats", ctx.get("stats"));
                    job.put("message", String.valueOf(pipe.getOrDefault("message", "worker pipeline ok")));
                }
            } catch (Exception ex) {
                return failJob(projectId, store, job, docId,
                        "OntoGPT 抽取失败：" + ex.getMessage() + "。请检查 doc-intel-worker / API Key。");
            }
        } else {
            return failJob(projectId, store, job, docId,
                    "需要 doc-intel-worker（OntoGPT）。请启动 start.ps1（:18100）。");
        }

        List<Map<String, Object>> allChunks = filterOutDoc((List<Map<String, Object>>) store.get("chunks"), docId);
        allChunks.addAll(0, chunks);
        List<Map<String, Object>> allCand = filterOutDoc((List<Map<String, Object>>) store.get("candidates"), docId);
        allCand.addAll(0, candidates);
        List<Map<String, Object>> allEv = filterOutDoc((List<Map<String, Object>>) store.get("evidence"), docId);
        allEv.addAll(0, evidence);

        store.put("chunks", allChunks);
        store.put("candidates", allCand);
        store.put("evidence", allEv);
        if (job != null) {
            job.put("status", "done");
            job.put("updatedAt", System.currentTimeMillis());
            job.put("chunkCount", chunks.size());
            job.put("candidateCount", candidates.size());
            if (job.get("message") == null) {
                job.put("message", "完成：" + engineLabel + " 分块 " + chunks.size() + "，候选 " + candidates.size());
            }
        }
        List<Map<String, Object>> docs = (List<Map<String, Object>>) store.get("docs");
        Map<String, Object> docMeta = findById(docs, docId);
        if (docMeta != null) {
            docMeta.put("status", "ready");
            docMeta.put("latestJobId", jobId);
            docMeta.put("engine", engineLabel);
        }
        writeJson(storePath(projectId), normalize(projectId, store));

        // Auto-push pending candidates to Argilla (review is Argilla-only).
        Map<String, Object> argillaPush = null;
        try {
            List<Map<String, Object>> pending = new ArrayList<>();
            for (Map<String, Object> c : candidates) {
                if ("pending".equals(String.valueOf(c.get("status")))) {
                    pending.add(c);
                }
            }
            if (!pending.isEmpty()) {
                argillaPush = worker.argillaPush(projectId, pending, evidence);
                if (job != null) {
                    job.put("argillaPush", argillaPush);
                    Object pushed = argillaPush.get("pushed");
                    job.put("message", String.valueOf(job.getOrDefault("message", ""))
                            + "；已推送 Argilla " + pushed + " 条");
                    writeJson(storePath(projectId), normalize(projectId, store));
                }
            }
        } catch (Exception pushEx) {
            if (job != null) {
                job.put("argillaPushError", pushEx.getMessage());
                job.put("message", String.valueOf(job.getOrDefault("message", ""))
                        + "；Argilla 自动推送失败：" + pushEx.getMessage());
                writeJson(storePath(projectId), normalize(projectId, store));
            }
        }

        Map<String, Object> out = snapshot(projectId);
        out.put("ok", true);
        out.put("job", job);
        out.put("engine", engineLabel);
        if (argillaPush != null) {
            out.put("argillaPush", argillaPush);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> failJob(String projectId, Map<String, Object> store, Map<String, Object> job,
                                        String docId, String message) throws Exception {
        if (job != null) {
            job.put("status", "failed");
            job.put("message", message);
            job.put("updatedAt", System.currentTimeMillis());
        }
        List<Map<String, Object>> docsFail = (List<Map<String, Object>>) store.get("docs");
        Map<String, Object> docFail = findById(docsFail, docId);
        if (docFail != null) {
            docFail.put("status", "failed");
        }
        writeJson(storePath(projectId), normalize(projectId, store));
        Map<String, Object> out = new LinkedHashMap<>(job == null ? Map.of() : job);
        out.put("ok", false);
        out.put("message", message);
        return out;
    }

    private List<Map<String, Object>> chunkText(String docId, String text) {
        List<Map<String, Object>> chunks = new ArrayList<>();
        String[] paras = text.replace("\r\n", "\n").split("\n{2,}");
        int page = 1;
        int idx = 0;
        for (String raw : paras) {
            String t = raw.trim();
            if (t.isEmpty()) {
                continue;
            }
            // soft-split long paragraphs
            List<String> parts = splitLong(t, 480);
            for (String part : parts) {
                Map<String, Object> c = new LinkedHashMap<>();
                String chunkId = "chk." + docId.replace("doc.", "") + "." + (++idx);
                c.put("id", chunkId);
                c.put("docId", docId);
                c.put("page", page);
                c.put("locator", "page:" + page + "/block:" + idx);
                c.put("text", part);
                c.put("engine", "local-paragraph");
                chunks.add(c);
                if (idx % 3 == 0) {
                    page++;
                }
            }
        }
        if (chunks.isEmpty() && text != null && !text.isBlank()) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("id", "chk." + docId.replace("doc.", "") + ".1");
            c.put("docId", docId);
            c.put("page", 1);
            c.put("locator", "page:1/block:1");
            c.put("text", text.trim());
            c.put("engine", "local-paragraph");
            chunks.add(c);
        }
        return chunks;
    }

    private void extractFromChunk(String docId, Map<String, Object> chunk,
                                  List<Map<String, Object>> candidates,
                                  List<Map<String, Object>> evidence) {
        String text = String.valueOf(chunk.get("text"));
        String chunkId = String.valueOf(chunk.get("id"));
        int page = chunk.get("page") instanceof Number ? ((Number) chunk.get("page")).intValue() : 1;

        Matcher hm = HEADING.matcher(text);
        if (hm.find()) {
            addCandidate(docId, chunkId, page, text, "Class", hm.group(1).trim(), "文档标题抽取",
                    null, null, candidates, evidence);
        }
        String flat = text.replace("\n", "");
        Matcher dm = CN_DEF.matcher(flat);
        while (dm.find()) {
            addCandidate(docId, chunkId, page, excerpt(text, dm.group(1)), "Class",
                    dm.group(1).trim(), dm.group(2).trim(), null, null, candidates, evidence);
        }
        Matcher sm = CN_SUBCLASS.matcher(flat);
        while (sm.find()) {
            addCandidate(docId, chunkId, page, excerpt(text, sm.group(1)), "SubClassOf",
                    sm.group(1).trim(), "是 " + sm.group(2).trim() + " 的子类",
                    sm.group(2).trim(), null, candidates, evidence);
        }
        Matcher pm = CN_PROP.matcher(flat);
        while (pm.find()) {
            addCandidate(docId, chunkId, page, excerpt(text, pm.group(1)), "DataProperty",
                    pm.group(1).trim(), "取值/单位相关：" + pm.group(2).trim(),
                    null, pm.group(2).trim(), candidates, evidence);
        }
    }

    private void addCandidate(String docId, String chunkId, int page, String excerptText,
                              String kind, String label, String definition,
                              String parentLabel, String rangeHint,
                              List<Map<String, Object>> candidates,
                              List<Map<String, Object>> evidence) {
        if (label == null || label.length() < 2) {
            return;
        }
        for (Map<String, Object> existing : candidates) {
            if (kind.equals(String.valueOf(existing.get("kind")))
                    && label.equals(String.valueOf(existing.get("label")))
                    && String.valueOf(parentLabel == null ? "" : parentLabel)
                    .equals(String.valueOf(existing.getOrDefault("parentLabel", "")))) {
                return;
            }
        }
        String candId = "cand." + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        Map<String, Object> cand = new LinkedHashMap<>();
        cand.put("id", candId);
        cand.put("docId", docId);
        cand.put("kind", kind);
        cand.put("label", label);
        cand.put("definition", definition);
        cand.put("status", "pending");
        cand.put("chunkIds", List.of(chunkId));
        cand.put("engine", "local-heuristic");
        cand.put("createdAt", System.currentTimeMillis());
        if (parentLabel != null && !parentLabel.isBlank()) {
            cand.put("parentLabel", parentLabel);
        }
        if (rangeHint != null && !rangeHint.isBlank()) {
            cand.put("rangeHint", rangeHint);
        }
        candidates.add(cand);

        String excerpt = excerptText == null ? "" : excerptText;
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("id", "ev." + candId.substring(5));
        ev.put("candidateId", candId);
        ev.put("docId", docId);
        ev.put("chunkId", chunkId);
        ev.put("page", page);
        ev.put("excerpt", excerpt.length() > 200 ? excerpt.substring(0, 200) + "…" : excerpt);
        evidence.add(ev);
    }

    /** True when candidate is a 型号 (model class under metamodel), not a metamodel skeleton. */
    private static boolean isModelCandidate(Map<String, Object> cand) {
        if (cand == null) {
            return false;
        }
        String kind = String.valueOf(cand.getOrDefault("kind", "")).trim();
        if ("Model".equalsIgnoreCase(kind)) {
            return true;
        }
        String role = String.valueOf(cand.getOrDefault("uiRole", cand.getOrDefault("role", "")))
                .trim().toLowerCase(Locale.ROOT);
        return "model".equals(role);
    }

    private static String buildClassOwl(String iri, String label, String definition) {
        return buildClassOwl(iri, label, definition, "metamodel");
    }

    private static String buildClassOwl(String iri, String label, String definition, String uiRole) {
        StringBuilder sb = new StringBuilder();
        sb.append("Ontology(<http://example.org/doc-intel-patch>\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_ROLE).append(">))\n");
        sb.append("Declaration(Class(<").append(iri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(iri).append("> \"")
                .append(escape(label)).append("\"@zh)\n");
        if (definition != null && !definition.isBlank()) {
            sb.append("AnnotationAssertion(rdfs:comment <").append(iri).append("> \"")
                    .append(escape(definition)).append("\"@zh)\n");
        }
        String role = (uiRole == null || uiRole.isBlank()) ? "metamodel" : uiRole.trim().toLowerCase(Locale.ROOT);
        sb.append("AnnotationAssertion(<").append(BENTI_UI_ROLE).append("> <").append(iri).append("> \"")
                .append(escape(role)).append("\")\n");
        sb.append(")");
        return sb.toString();
    }

    private static String buildPropertyOwl(String kind, String iri, String label, String definition) {
        String decl = "DataProperty".equals(kind) ? "DataProperty" : "ObjectProperty";
        StringBuilder sb = new StringBuilder();
        sb.append("Ontology(<http://example.org/doc-intel-patch>\n");
        sb.append("Declaration(").append(decl).append("(<").append(iri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(iri).append("> \"")
                .append(escape(label)).append("\"@zh)\n");
        if (definition != null && !definition.isBlank()) {
            sb.append("AnnotationAssertion(rdfs:comment <").append(iri).append("> \"")
                    .append(escape(definition)).append("\"@zh)\n");
        }
        sb.append(")");
        return sb.toString();
    }

    /** ObjectProperty + optional domain/range class stubs for an extracted triple. */
    private static String buildRelationOwl(String propIri, String predicate, String subjectLabel,
                                           String objectLabel, String definition) {
        StringBuilder sb = new StringBuilder();
        sb.append("Ontology(<http://example.org/doc-intel-patch>\n");
        sb.append("Declaration(ObjectProperty(<").append(propIri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(propIri).append("> \"")
                .append(escape(predicate)).append("\"@zh)\n");
        String comment = (definition != null && !definition.isBlank())
                ? definition
                : (subjectLabel + " —" + predicate + "→ " + objectLabel);
        sb.append("AnnotationAssertion(rdfs:comment <").append(propIri).append("> \"")
                .append(escape(comment)).append("\"@zh)\n");
        if (subjectLabel != null && !subjectLabel.isBlank()) {
            String domainIri = NS + "C_rel_" + Integer.toHexString(subjectLabel.hashCode());
            sb.append("Declaration(Class(<").append(domainIri).append(">))\n");
            sb.append("AnnotationAssertion(rdfs:label <").append(domainIri).append("> \"")
                    .append(escape(subjectLabel)).append("\"@zh)\n");
            sb.append("ObjectPropertyDomain(<").append(propIri).append("> <").append(domainIri).append(">)\n");
        }
        if (objectLabel != null && !objectLabel.isBlank()) {
            String rangeIri = NS + "C_rel_" + Integer.toHexString(objectLabel.hashCode());
            sb.append("Declaration(Class(<").append(rangeIri).append(">))\n");
            sb.append("AnnotationAssertion(rdfs:label <").append(rangeIri).append("> \"")
                    .append(escape(objectLabel)).append("\"@zh)\n");
            sb.append("ObjectPropertyRange(<").append(propIri).append("> <").append(rangeIri).append(">)\n");
        }
        sb.append(")");
        return sb.toString();
    }

    private static String buildSubClassOwl(String iri, String label, String parentIri, String parentLabel,
                                           String definition) {
        return buildSubClassOwl(iri, label, parentIri, parentLabel, definition, "metamodel");
    }

    private static String buildSubClassOwl(String iri, String label, String parentIri, String parentLabel,
                                           String definition, String uiRole) {
        StringBuilder sb = new StringBuilder();
        sb.append("Ontology(<http://example.org/doc-intel-patch>\n");
        sb.append("Declaration(AnnotationProperty(<").append(BENTI_UI_ROLE).append(">))\n");
        sb.append("Declaration(Class(<").append(parentIri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(parentIri).append("> \"")
                .append(escape(parentLabel)).append("\"@zh)\n");
        sb.append("Declaration(Class(<").append(iri).append(">))\n");
        sb.append("AnnotationAssertion(rdfs:label <").append(iri).append("> \"")
                .append(escape(label)).append("\"@zh)\n");
        if (definition != null && !definition.isBlank()) {
            sb.append("AnnotationAssertion(rdfs:comment <").append(iri).append("> \"")
                    .append(escape(definition)).append("\"@zh)\n");
        }
        String role = (uiRole == null || uiRole.isBlank()) ? "metamodel" : uiRole.trim().toLowerCase(Locale.ROOT);
        sb.append("AnnotationAssertion(<").append(BENTI_UI_ROLE).append("> <").append(iri).append("> \"")
                .append(escape(role)).append("\")\n");
        sb.append("SubClassOf(<").append(iri).append("> <").append(parentIri).append(">)\n");
        sb.append(")");
        return sb.toString();
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String slug(String label) {
        String s = label.replaceAll("[^\\p{IsHan}A-Za-z0-9]+", "_");
        if (s.isBlank()) {
            s = "Term";
        }
        if (s.length() > 40) {
            s = s.substring(0, 40);
        }
        return s;
    }

    private static List<String> splitLong(String text, int max) {
        List<String> out = new ArrayList<>();
        if (text.length() <= max) {
            out.add(text);
            return out;
        }
        int i = 0;
        while (i < text.length()) {
            int end = Math.min(text.length(), i + max);
            out.add(text.substring(i, end));
            i = end;
        }
        return out;
    }

    private static String excerpt(String text, String label) {
        int i = text.indexOf(label);
        if (i < 0) {
            return text.length() > 160 ? text.substring(0, 160) + "…" : text;
        }
        int from = Math.max(0, i - 20);
        int to = Math.min(text.length(), i + label.length() + 80);
        return text.substring(from, to);
    }

    private static List<Map<String, Object>> filterOutDoc(List<Map<String, Object>> list, String docId) {
        List<Map<String, Object>> next = new ArrayList<>();
        for (Map<String, Object> item : list) {
            Object d = item.get("docId");
            if (d == null || !docId.equals(String.valueOf(d))) {
                // keep accepted candidates even if same doc? for reseed we wipe demo doc fully
                next.add(item);
            }
        }
        return next;
    }

    private Map<String, Object> normalize(String projectId, Map<String, Object> raw) {
        Map<String, Object> doc = raw == null ? new LinkedHashMap<>() : new LinkedHashMap<>(raw);
        doc.put("projectId", projectId);
        doc.putIfAbsent("version", 1);
        doc.putIfAbsent("docs", List.of());
        doc.putIfAbsent("jobs", List.of());
        doc.putIfAbsent("chunks", List.of());
        doc.putIfAbsent("candidates", List.of());
        doc.putIfAbsent("evidence", List.of());
        if (!(doc.get("docs") instanceof List)) {
            doc.put("docs", List.of());
        }
        if (!(doc.get("jobs") instanceof List)) {
            doc.put("jobs", List.of());
        }
        if (!(doc.get("chunks") instanceof List)) {
            doc.put("chunks", List.of());
        }
        if (!(doc.get("candidates") instanceof List)) {
            doc.put("candidates", List.of());
        }
        if (!(doc.get("evidence") instanceof List)) {
            doc.put("evidence", List.of());
        }
        // materialize mutable lists
        doc.put("docs", new ArrayList<>(listOf(doc.get("docs"))));
        doc.put("jobs", new ArrayList<>(listOf(doc.get("jobs"))));
        doc.put("chunks", new ArrayList<>(listOf(doc.get("chunks"))));
        doc.put("candidates", new ArrayList<>(listOf(doc.get("candidates"))));
        doc.put("evidence", new ArrayList<>(listOf(doc.get("evidence"))));
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("docs", listOf(doc.get("docs")).size());
        stats.put("jobs", listOf(doc.get("jobs")).size());
        stats.put("chunks", listOf(doc.get("chunks")).size());
        stats.put("candidates", listOf(doc.get("candidates")).size());
        stats.put("pending", countStatus(listOf(doc.get("candidates")), "pending"));
        stats.put("accepted", countStatus(listOf(doc.get("candidates")), "accepted"));
        stats.put("rejected", countStatus(listOf(doc.get("candidates")), "rejected"));
        doc.put("stats", stats);
        return doc;
    }

    private static int countStatus(List<Map<String, Object>> list, String status) {
        int n = 0;
        for (Map<String, Object> c : list) {
            if (status.equals(String.valueOf(c.get("status")))) {
                n++;
            }
        }
        return n;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOf(Object value) {
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

    private static Map<String, Object> findById(List<Map<String, Object>> list, String id) {
        for (Map<String, Object> item : list) {
            if (id.equals(String.valueOf(item.get("id")))) {
                return item;
            }
        }
        return null;
    }

    private Path auxRoot() {
        String data = props.getDataDirectory();
        if (data == null || data.isEmpty()) {
            data = System.getProperty("webprotege.data.directory", ".");
        }
        return Paths.get(data, "platform-aux");
    }

    private Path storePath(String projectId) {
        return auxRoot().resolve("doc-intel-" + safe(projectId) + ".json");
    }

    private Path filesRoot(String projectId) {
        return auxRoot().resolve("doc-intel-files").resolve(safe(projectId));
    }

    private static String safe(String projectId) {
        return projectId == null ? "unknown" : projectId.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static String safeFileName(String name) {
        String n = name == null ? "upload.bin" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return n.isBlank() ? "upload.bin" : n;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readJson(Path path) {
        try {
            if (!Files.exists(path)) {
                return new LinkedHashMap<>();
            }
            return objectMapper.readValue(Files.readAllBytes(path), Map.class);
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    private void writeJson(Path path, Map<String, Object> doc) throws Exception {
        Files.createDirectories(path.getParent());
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), doc);
    }
}
