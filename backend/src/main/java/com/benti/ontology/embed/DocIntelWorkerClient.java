package com.benti.ontology.embed;

import com.benti.ontology.config.DocIntelProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * HTTP client for optional Python doc-intel-worker (parse/extract/pipeline).
 */
@Component
public class DocIntelWorkerClient {

    private final DocIntelProperties props;
    private final ObjectMapper objectMapper;
    private final HttpClient http;

    public DocIntelWorkerClient(DocIntelProperties props, ObjectMapper objectMapper) {
        this.props = props;
        this.objectMapper = objectMapper;
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(Math.max(500, props.getConnectTimeoutMs())))
                .build();
    }

    public Map<String, Object> health() {
        if (!props.isWorkerConfigured()) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", false);
            out.put("reachable", false);
            out.put("message", "worker-url not configured");
            return out;
        }
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(trimSlash(props.getWorkerUrl()) + "/health"))
                    .timeout(Duration.ofMillis(props.getConnectTimeoutMs()))
                    .GET()
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (resp.statusCode() >= 200 && resp.statusCode() < 300) {
                @SuppressWarnings("unchecked")
                Map<String, Object> body = objectMapper.readValue(resp.body(), Map.class);
                body.put("reachable", true);
                return body;
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", false);
            out.put("reachable", false);
            out.put("message", "HTTP " + resp.statusCode());
            return out;
        } catch (Exception e) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", false);
            out.put("reachable", false);
            out.put("message", e.getMessage());
            return out;
        }
    }

    /**
     * Call worker parse-path + extract (JSON). Worker must read the absolute path
     * (same machine). Falls back to multipart /pipeline upload.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> pipeline(String docId, Path filePath, String fileName) throws Exception {
        return pipeline(docId, filePath, fileName, null);
    }

    public Map<String, Object> pipeline(String docId, Path filePath, String fileName,
                                        Map<String, Object> context) throws Exception {
        if (!props.isWorkerConfigured()) {
            throw new IllegalStateException("worker not configured");
        }
        String base = trimSlash(props.getWorkerUrl());
        String abs = filePath.toAbsolutePath().toString();
        String name = fileName == null ? filePath.getFileName().toString() : fileName;

        // 1) Preferred: JSON parse-path + extract (OntoGPT + context pack)
        try {
            Map<String, Object> parseBody = new LinkedHashMap<>();
            parseBody.put("path", abs);
            parseBody.put("fileName", name);
            Map<String, Object> parsed = postJson(base + "/parse-path", parseBody);
            List<Map<String, Object>> chunks = castList(parsed.get("chunks"));
            String idPrefix = docId == null ? "doc" : docId;
            int i = 0;
            for (Map<String, Object> c : chunks) {
                i++;
                c.putIfAbsent("id", "chk." + idPrefix.replace("doc.", "") + "." + i);
                c.put("docId", idPrefix);
            }
            Map<String, Object> extractBody = new LinkedHashMap<>();
            extractBody.put("docId", idPrefix);
            extractBody.put("chunks", chunks);
            if (context != null && !context.isEmpty()) {
                extractBody.put("context", context);
            }
            Map<String, Object> extracted = postJson(base + "/extract", extractBody);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("parseEngine", parsed.get("engine"));
            out.put("extractEngine", extracted.get("engine"));
            out.put("chunks", chunks);
            out.put("candidates", extracted.getOrDefault("candidates", List.of()));
            out.put("evidence", extracted.getOrDefault("evidence", List.of()));
            out.put("chunkCount", chunks.size());
            out.put("candidateCount", extracted.getOrDefault("candidateCount", 0));
            out.put("message", "pipeline ok: parse=" + parsed.get("engine")
                    + ", candidates=" + extracted.getOrDefault("candidateCount", 0));
            return out;
        } catch (Exception first) {
            // 2) Fallback: multipart upload
            byte[] bytes = Files.readAllBytes(filePath);
            String boundary = "----benti" + UUID.randomUUID().toString().replace("-", "");
            byte[] multipart = multipartFile(boundary, "file", name, bytes,
                    Map.of("docId", docId == null ? "doc" : docId));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(base + "/pipeline"))
                    .timeout(Duration.ofMillis(props.getReadTimeoutMs()))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(multipart))
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
                throw new IllegalStateException("worker pipeline failed: " + first.getMessage()
                        + "; upload HTTP " + resp.statusCode() + ": " + resp.body());
            }
            return objectMapper.readValue(resp.body(), Map.class);
        }
    }

    /** Push candidates to Argilla via worker bridge. */
    public Map<String, Object> argillaPush(String projectId, List<Map<String, Object>> candidates,
                                           List<Map<String, Object>> evidence) throws Exception {
        if (!props.isWorkerConfigured()) {
            throw new IllegalStateException("worker not configured");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId);
        body.put("candidates", candidates == null ? List.of() : candidates);
        body.put("evidence", evidence == null ? List.of() : evidence);
        return postJson(trimSlash(props.getWorkerUrl()) + "/argilla/push", body);
    }

    /** Pull annotated decisions from Argilla via worker bridge. */
    public Map<String, Object> argillaPull(String projectId) throws Exception {
        if (!props.isWorkerConfigured()) {
            throw new IllegalStateException("worker not configured");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId);
        return postJson(trimSlash(props.getWorkerUrl()) + "/argilla/pull", body);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> postJson(String url, Object body) throws Exception {
        String json = objectMapper.writeValueAsString(body);
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofMillis(props.getReadTimeoutMs()))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
            throw new IllegalStateException("HTTP " + resp.statusCode() + " " + url + ": " + resp.body());
        }
        return objectMapper.readValue(resp.body(), Map.class);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> castList(Object value) {
        List<Map<String, Object>> out = new java.util.ArrayList<>();
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

    private static String trimSlash(String url) {
        if (url == null) {
            return "";
        }
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    private static String multipartText(String boundary, Map<String, String> fields) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : fields.entrySet()) {
            sb.append("--").append(boundary).append("\r\n");
            sb.append("Content-Disposition: form-data; name=\"").append(e.getKey()).append("\"\r\n\r\n");
            sb.append(e.getValue() == null ? "" : e.getValue()).append("\r\n");
        }
        sb.append("--").append(boundary).append("--\r\n");
        return sb.toString();
    }

    private static byte[] multipartFile(String boundary, String field, String filename, byte[] fileBytes,
                                        Map<String, String> fields) {
        try {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            for (Map.Entry<String, String> e : fields.entrySet()) {
                bos.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
                bos.write(("Content-Disposition: form-data; name=\"" + e.getKey() + "\"\r\n\r\n")
                        .getBytes(StandardCharsets.UTF_8));
                bos.write((e.getValue() + "\r\n").getBytes(StandardCharsets.UTF_8));
            }
            bos.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
            bos.write(("Content-Disposition: form-data; name=\"" + field + "\"; filename=\""
                    + filename + "\"\r\n").getBytes(StandardCharsets.UTF_8));
            bos.write("Content-Type: application/octet-stream\r\n\r\n".getBytes(StandardCharsets.UTF_8));
            bos.write(fileBytes);
            bos.write("\r\n".getBytes(StandardCharsets.UTF_8));
            bos.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            return bos.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
