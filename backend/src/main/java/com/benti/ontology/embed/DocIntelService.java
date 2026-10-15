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
    /** Same annotation as modeling-app (元模型 / 型号). */
    private static final String BENTI_UI_ROLE = "http://example.org/benti#uiRole";
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
            return out;
        }

        String label = String.valueOf(cand.getOrDefault("label", "未命名"));
        String kind = String.valueOf(cand.getOrDefault("kind", "Class"));
        String action = String.valueOf(cand.getOrDefault("action", "create")).trim().toLowerCase(Locale.ROOT);
        String existingIri = String.valueOf(cand.getOrDefault("existingIri", "")).trim();
        String suffix = candidateId.replace("cand.", "");
        String iri;
        String owl;
        Object axiomResult = null;

        // reuse: map evidence to existing entity, do not re-declare
        if ("reuse".equals(action) && !existingIri.isBlank()) {
            iri = existingIri;
            owl = "";
            cand.put("status", "accepted");
            cand.put("decidedAt", now);
            cand.put("acceptedIri", iri);
            cand.put("owl", "");
            cand.put("reuse", true);
            List<Map<String, Object>> evidenceReuse = (List<Map<String, Object>>) store.get("evidence");
            for (Map<String, Object> e : evidenceReuse) {
                if (candidateId.equals(String.valueOf(e.get("candidateId")))) {
                    e.put("acceptedIri", iri);
                }
            }
            writeJson(storePath(projectId), normalize(projectId, store));
            out.put("status", "accepted");
            out.put("acceptedIri", iri);
            out.put("reuse", true);
            out.put("axiomResult", Map.of("ok", true, "skipped", "reuse existing IRI"));
            return out;
        }

        boolean asModel = isModelCandidate(cand);
        if ("Relation".equals(kind)) {
            String predicate = String.valueOf(cand.getOrDefault("predicate", label));
            String subj = String.valueOf(cand.getOrDefault("relationSubject", ""));
            String obj = String.valueOf(cand.getOrDefault("relationObject", ""));
            iri = NS + "OP_" + suffix;
            owl = buildRelationOwl(iri, predicate, subj, obj,
                    String.valueOf(cand.getOrDefault("definition", "")));
        } else if ("DataProperty".equals(kind) || "ObjectProperty".equals(kind)) {
            iri = NS + ("DataProperty".equals(kind) ? "DP_" : "OP_") + suffix;
            owl = buildPropertyOwl(kind, iri, label, String.valueOf(cand.getOrDefault("definition", "")));
        } else {
            // Class / SubClassOf / Model → OWL class; Model gets benti:uiRole=model
            iri = NS + (asModel ? "M_" : "C_") + suffix;
            String parentIri = String.valueOf(cand.getOrDefault("parentIri", "")).trim();
            String parentLabel = String.valueOf(cand.getOrDefault("parentLabel", "")).trim();
            if (parentIri.isBlank() && !parentLabel.isBlank()) {
                parentIri = NS + "C_parent_" + Integer.toHexString(parentLabel.hashCode());
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
                owl = buildSubClassOwl(iri, label, parentIri, parentLabel,
                        String.valueOf(cand.getOrDefault("definition", "")), role);
            } else {
                owl = buildClassOwl(iri, label, String.valueOf(cand.getOrDefault("definition", "")), role);
            }
        }
        axiomResult = ontology.addAxioms(projectId, "doc-intel accept " + candidateId, owl);

        cand.put("status", "accepted");
        cand.put("decidedAt", now);
        cand.put("acceptedIri", iri);
        cand.put("owl", owl);

        List<Map<String, Object>> evidence = (List<Map<String, Object>>) store.get("evidence");
        for (Map<String, Object> e : evidence) {
            if (candidateId.equals(String.valueOf(e.get("candidateId")))) {
                e.put("acceptedIri", iri);
            }
        }
        writeJson(storePath(projectId), normalize(projectId, store));
        out.put("status", "accepted");
        out.put("acceptedIri", iri);
        out.put("axiomResult", axiomResult);
        return out;
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
     * Current metamodel tree + pending candidate overlays (add/modify/delete)
     * for the structure-diff review UI.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> structureReview(String projectId) throws Exception {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        List<Map<String, Object>> candidates = listOf(store.get("candidates"));
        List<Map<String, Object>> tree = contextPack.buildClassTree(projectId);
        Map<String, Object> pack = contextPack.build(projectId);
        Map<String, String> labelToIri = new LinkedHashMap<>();
        for (Map<String, Object> c : listOf(pack.get("classes"))) {
            String label = String.valueOf(c.getOrDefault("label", "")).trim();
            String iri = String.valueOf(c.getOrDefault("iri", "")).trim();
            if (!label.isBlank() && !iri.isBlank()) {
                labelToIri.putIfAbsent(label, iri);
            }
        }
        for (Map<String, Object> p : listOf(pack.get("properties"))) {
            String label = String.valueOf(p.getOrDefault("label", "")).trim();
            String iri = String.valueOf(p.getOrDefault("iri", "")).trim();
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
            } else if ("reuse".equals(action) || (!existingIri.isBlank() && labelToIri.containsValue(existingIri))
                    || labelToIri.containsKey(label)) {
                changeType = "modify";
                if (existingIri.isBlank()) {
                    existingIri = labelToIri.getOrDefault(label, "");
                }
            } else {
                changeType = "add";
            }

            Map<String, Object> ch = new LinkedHashMap<>();
            ch.put("candidateId", cand.get("id"));
            boolean asModel = isModelCandidate(cand);
            String displayKind = asModel ? "Model" : kind;
            ch.put("kind", displayKind);
            ch.put("uiRole", asModel ? "model" : cand.getOrDefault("uiRole", ""));
            ch.put("label", label);
            ch.put("change", changeType);
            ch.put("definition", cand.getOrDefault("definition", ""));
            ch.put("parentLabel", parentLabel);
            ch.put("parentIri", parentIri);
            ch.put("existingIri", existingIri);
            ch.put("action", action.isBlank() ? ("modify".equals(changeType) ? "reuse" : "create") : action);
            changes.add(ch);

            // Overlay onto tree
            if ("modify".equals(changeType) || "delete".equals(changeType)) {
                String targetIri = !existingIri.isBlank() ? existingIri : labelToIri.get(label);
                markTreeNode(tree, targetIri, label, changeType, cand);
            } else {
                insertAddNode(tree, cand, parentIri, parentLabel, changeType, asModel);
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("projectId", projectId);
        out.put("tree", tree);
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

    @SuppressWarnings("unchecked")
    private static void markTreeNode(List<Map<String, Object>> nodes, String iri, String label,
                                     String changeType, Map<String, Object> cand) {
        if (nodes == null) {
            return;
        }
        for (Map<String, Object> n : nodes) {
            String nIri = String.valueOf(n.getOrDefault("iri", ""));
            String nLabel = String.valueOf(n.getOrDefault("label", ""));
            boolean hit = (!iri.isBlank() && iri.equals(nIri))
                    || (!label.isBlank() && label.equals(nLabel) && "Class".equals(String.valueOf(n.get("kind"))));
            if (hit) {
                n.put("change", changeType);
                n.put("candidateId", cand.get("id"));
                n.put("pendingKind", cand.get("kind"));
                n.put("definition", cand.getOrDefault("definition", n.get("definition")));
                if (isModelCandidate(cand)) {
                    n.put("kind", "Model");
                    n.put("uiRole", "model");
                }
                return;
            }
            markTreeNode(listOf(n.get("children")), iri, label, changeType, cand);
        }
    }

    @SuppressWarnings("unchecked")
    private static void insertAddNode(List<Map<String, Object>> roots, Map<String, Object> cand,
                                      String parentIri, String parentLabel, String changeType) {
        insertAddNode(roots, cand, parentIri, parentLabel, changeType, isModelCandidate(cand));
    }

    private static void insertAddNode(List<Map<String, Object>> roots, Map<String, Object> cand,
                                      String parentIri, String parentLabel, String changeType,
                                      boolean asModel) {
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
        node.put("children", new ArrayList<>());

        if (!parentIri.isBlank() && attachUnder(roots, parentIri, null, node)) {
            return;
        }
        if (!parentLabel.isBlank() && attachUnder(roots, null, parentLabel, node)) {
            return;
        }
        // Bucket for unattached proposals
        String bucketId = asModel ? "virtual:proposed-models" : "virtual:proposed";
        String bucketLabel = asModel ? "待挂接型号" : "待挂接变更";
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

    /** Demo without upload: seed a short Chinese spec + candidates. Always refreshes demo doc. */
    public Map<String, Object> seedDemo(String projectId) throws Exception {
        Map<String, Object> store = normalize(projectId, readJson(storePath(projectId)));
        String docId = "doc.demo";

        String sample = ""
                + "# 旋翼平台论证摘录（示范）\n\n"
                + "直升机是一种以旋翼提供升力的飞行器。\n"
                + "武装直升机属于直升机的一种。\n"
                + "主旋翼是提供升力和部分推进的气动装置。\n"
                + "尾桨是用于抗扭与航向控制的装置。\n"
                + "最大起飞重量指允许起飞的最大重量。\n"
                + "最大起飞重量的单位是千克。\n"
                + "续航时间是在规定任务剖面下可持续飞行的时间。\n"
                + "任务载荷是可装载的任务设备与物资质量。\n"
                + "主旋翼安装于机身。\n"
                + "尾桨安装于机尾。\n";

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
        meta.put("status", "uploaded");
        meta.put("createdAt", System.currentTimeMillis());
        meta.put("note", "内置演示文档");

        // replace demo doc if reseed
        List<Map<String, Object>> docs = listOf(store.get("docs"));
        docs.removeIf(d -> docId.equals(String.valueOf(d.get("id"))));
        docs.add(0, meta);
        store.put("docs", docs);
        // clear previous demo artefacts
        store.put("chunks", filterOutDoc(listOf(store.get("chunks")), docId));
        store.put("candidates", filterOutDoc(listOf(store.get("candidates")), docId));
        store.put("evidence", filterOutDoc(listOf(store.get("evidence")), docId));
        store.put("jobs", filterOutDoc(listOf(store.get("jobs")), docId));
        writeJson(storePath(projectId), store);

        return startJob(projectId, docId);
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
