package com.benti.ontology.web;

import com.benti.ontology.embed.OntologyExport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Ontology API: fixed paths + JSON body parameters (no projectId in URL path/query).
 */
@RestController
@RequestMapping("/api/onto")
public class OntologyApiController {

    private final OntologyGateway gateway;
    private final ObjectMapper objectMapper;

    public OntologyApiController(OntologyGateway gateway, ObjectMapper objectMapper) {
        this.gateway = gateway;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return gateway.health();
    }

    @GetMapping("/projects")
    public Object listProjects() {
        return gateway.listProjects();
    }

    @PostMapping(value = "/projects", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object createProject(@RequestBody Map<String, String> body) {
        return gateway.createProject(
                str(body, "displayName"),
                str(body, "description"),
                str(body, "documentId"));
    }

    @PostMapping(value = "/uploads", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object uploadSource(@RequestParam("file") MultipartFile file) {
        return gateway.uploadSource(file);
    }

    @PostMapping(value = "/projects/update", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object updateProject(@RequestBody Map<String, String> body) {
        return gateway.updateProject(
                require(body, "projectId"),
                str(body, "displayName"),
                str(body, "description"));
    }

    @PostMapping(value = "/projects/trash", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object trashProject(@RequestBody Map<String, String> body) {
        return gateway.trashProject(require(body, "projectId"));
    }

    @PostMapping(value = "/projects/restore", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object restoreProject(@RequestBody Map<String, String> body) {
        return gateway.restoreProject(require(body, "projectId"));
    }

    @PostMapping(value = "/revisions", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object revisions(@RequestBody Map<String, Object> body) {
        String projectId = require(body, "projectId");
        int from = intVal(body.get("from"), 1);
        String to = body.get("to") == null ? "HEAD" : String.valueOf(body.get("to"));
        return gateway.getRevisions(projectId, from, to);
    }

    /** HEAD axiom snapshot for modeling UI (no full revision replay). */
    @PostMapping(value = "/ontology-snapshot", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object ontologySnapshot(@RequestBody Map<String, String> body) {
        return gateway.getOntologySnapshot(require(body, "projectId"));
    }

    /**
     * Download HEAD ontology as OWL / OWX / Turtle / Manchester / Functional
     * (or a zip when the project contains multiple ontologies).
     */
    @PostMapping(value = "/export", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> exportOntology(@RequestBody Map<String, String> body) {
        OntologyExport exported = gateway.exportOntology(
                require(body, "projectId"),
                str(body, "format"));
        String fileName = exported.getFileName();
        String asciiName = fileName.replaceAll("[^\\x20-\\x7E]", "_");
        String encoded = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + asciiName + "\"; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType(exported.getContentType()))
                .contentLength(exported.getBytes().length)
                .body(exported.getBytes());
    }

    @PostMapping(value = "/axioms", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object addAxioms(@RequestBody Map<String, String> body) {
        return gateway.addAxioms(
                require(body, "projectId"),
                str(body, "msg") == null || str(body, "msg").isBlank() ? "Added axioms" : str(body, "msg"),
                require(body, "owl"));
    }

    @PostMapping(value = "/delete-axioms", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object deleteAxioms(@RequestBody Map<String, String> body) {
        return gateway.deleteAxioms(
                require(body, "projectId"),
                str(body, "msg") == null || str(body, "msg").isBlank() ? "Deleted axioms" : str(body, "msg"),
                require(body, "owl"));
    }

    @PostMapping(value = "/reason/consistency", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object consistency(@RequestBody Map<String, String> body) {
        return gateway.reasonConsistency(require(body, "projectId"));
    }

    @PostMapping(value = "/reason/classify", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object classify(@RequestBody Map<String, String> body) {
        return gateway.reasonClassify(require(body, "projectId"), str(body, "individual"));
    }

    @PostMapping(value = "/reason/swrl", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object swrl(@RequestBody Map<String, String> body) {
        return gateway.reasonSwrl(require(body, "projectId"));
    }

    @PostMapping(value = "/swrl-candidates/get", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object getSwrlCandidates(@RequestBody Map<String, String> body) {
        return gateway.getSwrlCandidates(require(body, "projectId"));
    }

    @PostMapping(value = "/swrl-candidates", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object putSwrlCandidates(@RequestBody Map<String, Object> body) {
        String projectId = require(body, "projectId");
        Map<String, Object> payload = new LinkedHashMap<>(body);
        payload.remove("projectId");
        try {
            return gateway.putSwrlCandidates(projectId, objectMapper.writeValueAsString(payload));
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage(), e);
        }
    }

    @PostMapping(value = "/consistency-results", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object consistencyResults(@RequestBody Map<String, String> body) {
        return gateway.getConsistencyResults(require(body, "projectId"));
    }

    /** Unified semantic base MVP snapshot (terms / indicators / standards). */
    @PostMapping(value = "/semantic-base/get", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object getSemanticBase(@RequestBody Map<String, String> body) {
        return gateway.getSemanticBase(require(body, "projectId"));
    }

    @PostMapping(value = "/semantic-base/save", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object saveSemanticBase(@RequestBody Map<String, Object> body) {
        try {
            String projectId = require(body, "projectId");
            return gateway.saveSemanticBase(projectId, objectMapper.writeValueAsString(body));
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage(), e);
        }
    }

    @PostMapping(value = "/semantic-base/seed", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object seedSemanticBase(@RequestBody Map<String, String> body) {
        return gateway.seedSemanticBase(require(body, "projectId"));
    }

    /** Doc-intel: upload → chunk → candidates → review → axioms. */
    @GetMapping("/doc-intel/engines")
    public Object getDocIntelEngines() {
        return gateway.getDocIntelEngines();
    }

    @PostMapping(value = "/doc-intel/get", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object getDocIntel(@RequestBody Map<String, String> body) {
        return gateway.getDocIntel(require(body, "projectId"));
    }

    @PostMapping(value = "/doc-intel/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object uploadDocIntel(@RequestParam("projectId") String projectId,
                                 @RequestParam("file") MultipartFile file) {
        try {
            return gateway.uploadDocIntel(projectId, file);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage(), e);
        }
    }

    @PostMapping(value = "/doc-intel/jobs", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object startDocIntelJob(@RequestBody Map<String, String> body) {
        return gateway.startDocIntelJob(require(body, "projectId"), require(body, "docId"));
    }

    @PostMapping(value = "/doc-intel/jobs/get", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object getDocIntelJob(@RequestBody Map<String, String> body) {
        return gateway.getDocIntelJob(require(body, "projectId"), require(body, "jobId"));
    }

    @PostMapping(value = "/doc-intel/chunks", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object listDocIntelChunks(@RequestBody Map<String, String> body) {
        return gateway.listDocIntelChunks(require(body, "projectId"), str(body, "docId"));
    }

    @PostMapping(value = "/doc-intel/candidates/list", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object listDocIntelCandidates(@RequestBody Map<String, String> body) {
        return gateway.listDocIntelCandidates(require(body, "projectId"), str(body, "status"));
    }

    @PostMapping(value = "/doc-intel/candidates/decide", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object decideDocIntelCandidate(@RequestBody Map<String, String> body) {
        return gateway.decideDocIntelCandidate(
                require(body, "projectId"),
                require(body, "candidateId"),
                require(body, "decision"),
                str(body, "editedLabel"));
    }

    /** Batch-write all pending candidates into the project ontology as OWL classes. */
    @PostMapping(value = "/doc-intel/candidates/accept-pending", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object acceptDocIntelPending(@RequestBody Map<String, String> body) {
        return gateway.acceptDocIntelPending(require(body, "projectId"));
    }

    @PostMapping(value = "/doc-intel/evidence/get", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object getDocIntelEvidence(@RequestBody Map<String, String> body) {
        return gateway.getDocIntelEvidence(require(body, "projectId"), require(body, "candidateId"));
    }

    @PostMapping(value = "/doc-intel/seed-demo", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object seedDocIntelDemo(@RequestBody Map<String, String> body) {
        return gateway.seedDocIntelDemo(require(body, "projectId"));
    }

    /** Optional: push pending candidates to Argilla for external review. */
    @PostMapping(value = "/doc-intel/argilla/push", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object pushDocIntelArgilla(@RequestBody Map<String, String> body) {
        return gateway.pushDocIntelArgilla(require(body, "projectId"));
    }

    /** Optional: pull Argilla decisions and apply accept/reject (+ OWL write). */
    @PostMapping(value = "/doc-intel/argilla/sync", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object syncDocIntelArgilla(@RequestBody Map<String, String> body) {
        return gateway.syncDocIntelArgilla(require(body, "projectId"));
    }

    /** Metamodel tree + pending add/modify/delete overlays for structure-diff UI. */
    @PostMapping(value = "/doc-intel/structure-review", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object docIntelStructureReview(@RequestBody Map<String, String> body) {
        return gateway.docIntelStructureReview(require(body, "projectId"));
    }

    /** Batch accept/reject selected candidates (tree checkboxes / 全部接受|取消). */
    @PostMapping(value = "/doc-intel/candidates/decide-batch", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object decideDocIntelBatch(@RequestBody Map<String, Object> body) {
        String projectId = require(body, "projectId");
        String decision = require(body, "decision");
        java.util.List<String> ids = new java.util.ArrayList<>();
        Object rawIds = body.get("candidateIds");
        if (rawIds instanceof java.util.List) {
            for (Object item : (java.util.List<?>) rawIds) {
                if (item != null) {
                    ids.add(String.valueOf(item));
                }
            }
        }
        return gateway.decideDocIntelBatch(projectId, ids, decision);
    }

    @PostMapping(value = "/delete-individual", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object deleteIndividual(@RequestBody Map<String, String> body) {
        return gateway.deleteIndividual(require(body, "projectId"), require(body, "iri"));
    }

    @PostMapping(value = "/delete-property-assertions", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object deletePropertyAssertions(@RequestBody Map<String, String> body) {
        String kind = str(body, "kind");
        String msg = str(body, "msg");
        return gateway.deletePropertyAssertions(
                require(body, "projectId"),
                require(body, "individual"),
                require(body, "property"),
                kind == null || kind.isBlank() ? "data" : kind,
                msg == null || msg.isBlank() ? "Cleared instance property assertion" : msg);
    }

    @PostMapping(value = "/cleanup-invalid-individuals", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object cleanupInvalidIndividuals(@RequestBody Map<String, String> body) {
        return gateway.cleanupInvalidIndividuals(require(body, "projectId"));
    }

    /**
     * Load behavior state machine JSON from the class×behavior SubClassOf annotation.
     * Requires both {@code classIri} and {@code behaviorIri}.
     */
    @PostMapping(value = "/class-behavior/get", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object getClassBehavior(@RequestBody Map<String, Object> body) {
        return gateway.getClassBehavior(
                require(body, "projectId"),
                require(body, "classIri"),
                require(body, "behaviorIri"),
                str(body, "kind"));
    }

    /** Save behavior stateGraph onto the class×behavior SubClassOf axiom. */
    @PostMapping(value = "/class-behavior/save", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object saveClassBehavior(@RequestBody Map<String, Object> body) {
        return gateway.saveClassBehavior(
                require(body, "projectId"),
                require(body, "classIri"),
                require(body, "behaviorIri"),
                str(body, "kind"),
                body);
    }

    @PostMapping(value = "/class-behavior/delete", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object deleteClassBehavior(@RequestBody Map<String, Object> body) {
        return gateway.deleteClassBehavior(
                require(body, "projectId"),
                require(body, "classIri"),
                require(body, "behaviorIri"),
                str(body, "kind"));
    }

    private static String require(Map<String, ?> body, String key) {
        String v = str(body, key);
        if (v == null || v.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "missing " + key);
        }
        return v;
    }

    private static String str(Map<String, ?> body, String key) {
        if (body == null || body.get(key) == null) {
            return null;
        }
        return String.valueOf(body.get(key));
    }

    private static int intVal(Object value, int defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
}
