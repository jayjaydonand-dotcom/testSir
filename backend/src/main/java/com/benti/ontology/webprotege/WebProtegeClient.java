package com.benti.ontology.webprotege;

import com.benti.ontology.config.WebProtegeProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * HTTP facade to the running WebProtege backend (/data + /modeling).
 * Bundled WP jars live on the classpath for packaging/migration; runtime
 * ontology state (Mongo + BinaryOWL) is still owned by the WP process.
 */
@Service
public class WebProtegeClient {

    private final RestTemplate restTemplate;
    private final WebProtegeProperties props;
    private final ObjectMapper objectMapper;

    public WebProtegeClient(RestTemplate webProtegeRestTemplate,
                            WebProtegeProperties props,
                            ObjectMapper objectMapper) {
        this.restTemplate = webProtegeRestTemplate;
        this.props = props;
        this.objectMapper = objectMapper;
    }

    public List<Map<String, Object>> listProjects() {
        JsonNode node = getJson("/data/projects");
        if (node != null && node.isArray()) {
            return objectMapper.convertValue(node, List.class);
        }
        return Collections.emptyList();
    }

    public Object getRevisions(String projectId, int from, String to) {
        URI uri = UriComponentsBuilder
                .fromHttpUrl(props.getBaseUrl() + "/data/projects/" + projectId + "/revisions")
                .queryParam("from", from)
                .queryParam("to", to)
                .build(true)
                .toUri();
        return exchange(uri, HttpMethod.GET, null, null, Object.class);
    }

    public Object addAxioms(String projectId, String message, String owlFunctionalBody) {
        URI uri = UriComponentsBuilder
                .fromHttpUrl(props.getBaseUrl() + "/data/projects/" + projectId + "/axioms")
                .queryParam("msg", message == null ? "Added axioms" : message)
                .build(true)
                .toUri();
        HttpHeaders headers = authHeaders();
        headers.setContentType(new MediaType("text", "owl-functional", StandardCharsets.UTF_8));
        HttpEntity<String> entity = new HttpEntity<>(owlFunctionalBody, headers);
        return exchange(uri, HttpMethod.POST, entity, null, Object.class);
    }

    public Object deleteAxioms(String projectId, String message, String owlFunctionalBody) {
        URI uri = UriComponentsBuilder
                .fromHttpUrl(props.getBaseUrl() + "/data/projects/" + projectId + "/delete-axioms")
                .queryParam("msg", message == null ? "Deleted axioms" : message)
                .build(true)
                .toUri();
        HttpHeaders headers = authHeaders();
        headers.setContentType(new MediaType("text", "owl-functional", StandardCharsets.UTF_8));
        HttpEntity<String> entity = new HttpEntity<>(owlFunctionalBody, headers);
        return exchange(uri, HttpMethod.POST, entity, null, Object.class);
    }

    public Object reasonConsistency(String projectId) {
        return getModelingJson("/modeling/reason-consistency.jsp", projectId);
    }

    public Object reasonClassify(String projectId) {
        return getModelingJson("/modeling/reason-classify.jsp", projectId);
    }

    public Object reasonSwrl(String projectId) {
        return getModelingJson("/modeling/reason-swrl.jsp", projectId);
    }

    public Object getSwrlCandidates(String projectId) {
        return getModelingJson("/modeling/swrl-candidates.jsp", projectId);
    }

    public Object putSwrlCandidates(String projectId, String jsonBody) {
        URI uri = UriComponentsBuilder
                .fromHttpUrl(props.getBaseUrl() + "/modeling/swrl-candidates.jsp")
                .queryParam("project", projectId)
                .build(true)
                .toUri();
        HttpHeaders headers = authHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<String> entity = new HttpEntity<>(jsonBody, headers);
        return exchange(uri, HttpMethod.POST, entity, null, Object.class);
    }

    public Object getConsistencyResults(String projectId) {
        return getModelingJson("/modeling/consistency-results.jsp", projectId);
    }

    public boolean isUpstreamHealthy() {
        try {
            URI uri = URI.create(props.getBaseUrl() + "/");
            ResponseEntity<String> response = restTemplate.exchange(uri, HttpMethod.GET, new HttpEntity<>(authHeaders()), String.class);
            return response.getStatusCode().is2xxSuccessful() || response.getStatusCode().is3xxRedirection();
        } catch (Exception e) {
            return false;
        }
    }

    private Object getModelingJson(String path, String projectId) {
        URI uri = UriComponentsBuilder
                .fromHttpUrl(props.getBaseUrl() + path)
                .queryParam("project", projectId)
                .build(true)
                .toUri();
        return exchange(uri, HttpMethod.GET, new HttpEntity<>(authHeaders()), null, Object.class);
    }

    private JsonNode getJson(String path) {
        URI uri = URI.create(props.getBaseUrl() + path);
        return exchange(uri, HttpMethod.GET, new HttpEntity<>(authHeaders()), null, JsonNode.class);
    }

    private HttpHeaders authHeaders() {
        HttpHeaders headers = new HttpHeaders();
        if (props.getApiKey() != null && !props.getApiKey().trim().isEmpty()) {
            headers.set(HttpHeaders.AUTHORIZATION, "apikey " + props.getApiKey().trim());
        }
        headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));
        return headers;
    }

    private <T> T exchange(URI uri, HttpMethod method, HttpEntity<?> entity, Class<?> ignored, Class<T> responseType) {
        try {
            HttpEntity<?> request = entity == null ? new HttpEntity<>(authHeaders()) : entity;
            ResponseEntity<T> response = restTemplate.exchange(uri, method, request, responseType);
            return response.getBody();
        } catch (HttpStatusCodeException e) {
            String body = e.getResponseBodyAsString();
            throw new ResponseStatusException(e.getStatusCode(),
                    body == null || body.isEmpty() ? e.getStatusText() : body);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "WebProtege upstream error: " + e.getMessage(), e);
        }
    }
}
