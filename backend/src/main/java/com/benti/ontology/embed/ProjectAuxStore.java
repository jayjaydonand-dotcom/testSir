package com.benti.ontology.embed;

import com.benti.ontology.config.WebProtegeProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Aux data for legacy modeling UI (SWRL candidates + consistency history).
 * Stored as JSON under the WebProtege data directory.
 */
@Service
public class ProjectAuxStore {

    private final WebProtegeProperties props;
    private final ObjectMapper objectMapper;

    public ProjectAuxStore(WebProtegeProperties props, ObjectMapper objectMapper) {
        this.props = props;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> getSwrlCandidates(String projectId) {
        Map<String, Object> doc = readJson(swrlPath(projectId));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("projectId", projectId);
        out.put("bindings", doc.getOrDefault("bindings", List.of()));
        out.put("revision", doc.get("revision"));
        out.put("updatedAt", doc.get("updatedAt"));
        return out;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> putSwrlCandidates(String projectId, String jsonBody) throws Exception {
        Map<String, Object> body = objectMapper.readValue(
                jsonBody == null || jsonBody.isEmpty() ? "{}" : jsonBody, Map.class);
        long now = System.currentTimeMillis();
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("projectId", projectId);
        doc.put("revision", body.get("revision"));
        doc.put("bindings", body.get("bindings") == null ? List.of() : body.get("bindings"));
        doc.put("updatedAt", now);
        writeJson(swrlPath(projectId), doc);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("projectId", projectId);
        out.put("updatedAt", now);
        out.put("revision", body.get("revision"));
        return out;
    }

    public Map<String, Object> getConsistencyResults(String projectId) {
        Map<String, Object> doc = readJson(consistencyPath(projectId));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("projectId", projectId);
        out.put("latest", doc.get("latest"));
        out.put("history", doc.getOrDefault("history", List.of()));
        return out;
    }

    @SuppressWarnings("unchecked")
    public void saveConsistencyResult(String projectId, String userName, Map<String, Object> result) {
        if (result == null || result.get("error") != null) {
            return;
        }
        try {
            Map<String, Object> doc = readJson(consistencyPath(projectId));
            List<Map<String, Object>> history = new ArrayList<>();
            Object existing = doc.get("history");
            if (existing instanceof List) {
                for (Object item : (List<?>) existing) {
                    if (item instanceof Map) {
                        history.add(new LinkedHashMap<>((Map<String, Object>) item));
                    }
                }
            }
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", UUID.randomUUID().toString());
            entry.put("checkedAt", System.currentTimeMillis());
            entry.put("checkedBy", userName == null ? "admin" : userName);
            entry.put("consistent", Boolean.TRUE.equals(result.get("consistent")));
            entry.put("revision", result.get("revision"));
            entry.put("elapsedMs", result.get("elapsedMs"));
            entry.put("ontologyCount", result.get("ontologyCount"));
            entry.put("axiomCount", result.get("axiomCount"));
            entry.put("ignoredSwrlRules", result.get("ignoredSwrlRules"));
            entry.put("conflicts", result.getOrDefault("conflicts", List.of()));
            history.add(0, entry);
            while (history.size() > 20) {
                history.remove(history.size() - 1);
            }
            Map<String, Object> next = new LinkedHashMap<>();
            next.put("projectId", projectId);
            next.put("updatedAt", System.currentTimeMillis());
            next.put("updatedBy", userName == null ? "admin" : userName);
            next.put("latest", entry);
            next.put("history", history);
            writeJson(consistencyPath(projectId), next);
        } catch (Exception ignored) {
            // keep UI usable even if persistence fails
        }
    }

    private Path auxRoot() {
        String data = props.getDataDirectory();
        if (data == null || data.isEmpty()) {
            data = System.getProperty("webprotege.data.directory", ".");
        }
        return Paths.get(data, "platform-aux");
    }

    private Path swrlPath(String projectId) {
        return auxRoot().resolve("swrl-candidates-" + safe(projectId) + ".json");
    }

    private Path consistencyPath(String projectId) {
        return auxRoot().resolve("consistency-" + safe(projectId) + ".json");
    }

    private Path semanticBasePath(String projectId) {
        return auxRoot().resolve("semantic-base-" + safe(projectId) + ".json");
    }

    /**
     * Unified semantic base MVP (terms / indicators / standards).
     * Stored as JSON under platform-aux; not yet OWL/SHACL. Trace chain deferred.
     */
    public Map<String, Object> getSemanticBase(String projectId) {
        Map<String, Object> doc = readJson(semanticBasePath(projectId));
        return normalizeSemanticBase(projectId, doc);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> saveSemanticBase(String projectId, String jsonBody) throws Exception {
        Map<String, Object> body = objectMapper.readValue(
                jsonBody == null || jsonBody.isEmpty() ? "{}" : jsonBody, Map.class);
        Map<String, Object> doc = normalizeSemanticBase(projectId, body);
        doc.put("updatedAt", System.currentTimeMillis());
        writeJson(semanticBasePath(projectId), doc);
        Map<String, Object> out = new LinkedHashMap<>(doc);
        out.put("ok", true);
        return out;
    }

    public Map<String, Object> seedSemanticBase(String projectId) throws Exception {
        Map<String, Object> existing = readJson(semanticBasePath(projectId));
        boolean empty = listSize(existing.get("terms")) == 0
                && listSize(existing.get("indicators")) == 0
                && listSize(existing.get("standards")) == 0;
        if (!empty && !Boolean.TRUE.equals(existing.get("allowReseed"))) {
            Map<String, Object> out = normalizeSemanticBase(projectId, existing);
            out.put("ok", true);
            out.put("seeded", false);
            out.put("message", "语义底座已有数据，未覆盖。如需重种可先清空或设 allowReseed=true。");
            return out;
        }
        Map<String, Object> seeded = SemanticBaseSeed.build(projectId);
        writeJson(semanticBasePath(projectId), seeded);
        Map<String, Object> out = new LinkedHashMap<>(seeded);
        out.put("ok", true);
        out.put("seeded", true);
        return out;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeSemanticBase(String projectId, Map<String, Object> raw) {
        Map<String, Object> doc = raw == null ? new LinkedHashMap<>() : new LinkedHashMap<>(raw);
        // Drop deferred trace-chain fields from older MVP payloads.
        doc.remove("requirements");
        doc.remove("schemeLinks");
        doc.remove("evidence");
        doc.put("projectId", projectId);
        doc.putIfAbsent("version", 1);
        doc.putIfAbsent("domain", "helicopter");
        doc.putIfAbsent("terms", List.of());
        doc.putIfAbsent("indicators", List.of());
        doc.putIfAbsent("standards", List.of());
        if (!(doc.get("terms") instanceof List)) {
            doc.put("terms", List.of());
        }
        if (!(doc.get("indicators") instanceof List)) {
            doc.put("indicators", List.of());
        }
        if (!(doc.get("standards") instanceof List)) {
            doc.put("standards", List.of());
        }
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("terms", listSize(doc.get("terms")));
        stats.put("indicators", listSize(doc.get("indicators")));
        stats.put("standards", listSize(doc.get("standards")));
        doc.put("stats", stats);
        return doc;
    }

    private static int listSize(Object value) {
        return value instanceof List ? ((List<?>) value).size() : 0;
    }

    private static String safe(String projectId) {
        return projectId == null ? "unknown" : projectId.replaceAll("[^a-zA-Z0-9._-]", "_");
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
