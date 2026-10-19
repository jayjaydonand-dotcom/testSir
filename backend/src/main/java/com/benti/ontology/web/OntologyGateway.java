package com.benti.ontology.web;

import com.benti.ontology.config.WebProtegeProperties;
import com.benti.ontology.embed.DocIntelService;
import com.benti.ontology.embed.EmbeddedOntologyService;
import com.benti.ontology.embed.EmbeddedWebProtegeRuntime;
import com.benti.ontology.embed.OntologyExport;
import com.benti.ontology.embed.ProjectAuxStore;
import com.benti.ontology.webprotege.WebProtegeClient;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class OntologyGateway {

    private final WebProtegeProperties props;
    private final EmbeddedWebProtegeRuntime runtime;
    private final EmbeddedOntologyService embedded;
    private final WebProtegeClient remote;
    private final ProjectAuxStore auxStore;
    private final DocIntelService docIntel;

    public OntologyGateway(WebProtegeProperties props,
                           EmbeddedWebProtegeRuntime runtime,
                           EmbeddedOntologyService embedded,
                           WebProtegeClient remote,
                           ProjectAuxStore auxStore,
                           DocIntelService docIntel) {
        this.props = props;
        this.runtime = runtime;
        this.embedded = embedded;
        this.remote = remote;
        this.auxStore = auxStore;
        this.docIntel = docIntel;
    }

    public Map<String, Object> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "UP");
        body.put("mode", props.getMode());
        body.put("embedded", runtime.status());
        body.put("webprotegeUpstream", props.isEmbedded() ? "n/a-embedded" : remote.isUpstreamHealthy());
        return body;
    }

    public List<?> listProjects() {
        return props.isEmbedded() ? embedded.listProjects() : remote.listProjects();
    }

    public Map<String, Object> createProject(String displayName, String description) {
        return createProject(displayName, description, null);
    }

    public Map<String, Object> createProject(String displayName, String description, String documentId) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("createProject requires embedded mode");
        }
        return embedded.createProject(displayName, description, documentId);
    }

    public Map<String, Object> uploadSource(MultipartFile file) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("uploadSource requires embedded mode");
        }
        return embedded.uploadSource(file);
    }

    public Map<String, Object> updateProject(String projectId, String displayName, String description) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("updateProject requires embedded mode");
        }
        return embedded.updateProject(projectId, displayName, description);
    }

    public Map<String, Object> trashProject(String projectId) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("trashProject requires embedded mode");
        }
        return embedded.trashProject(projectId);
    }

    public Map<String, Object> restoreProject(String projectId) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("restoreProject requires embedded mode");
        }
        return embedded.restoreProject(projectId);
    }

    public Object getRevisions(String projectId, int from, String to) {
        return props.isEmbedded()
                ? embedded.getRevisions(projectId, from, to)
                : remote.getRevisions(projectId, from, to);
    }

    public Map<String, Object> getOntologySnapshot(String projectId) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("ontology-snapshot requires embedded mode");
        }
        return embedded.getOntologySnapshot(projectId);
    }

    public OntologyExport exportOntology(String projectId, String format) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("export requires embedded mode");
        }
        return embedded.exportOntology(projectId, format);
    }

    public Object addAxioms(String projectId, String msg, String body) {
        return props.isEmbedded()
                ? embedded.addAxioms(projectId, msg, body)
                : remote.addAxioms(projectId, msg, body);
    }

    public Object deleteAxioms(String projectId, String msg, String body) {
        return props.isEmbedded()
                ? embedded.deleteAxioms(projectId, msg, body)
                : remote.deleteAxioms(projectId, msg, body);
    }

    @SuppressWarnings("unchecked")
    public Object reasonConsistency(String projectId) {
        Object result = props.isEmbedded()
                ? embedded.reasonConsistency(projectId)
                : remote.reasonConsistency(projectId);
        if (result instanceof Map) {
            auxStore.saveConsistencyResult(projectId, "admin", (Map<String, Object>) result);
        }
        return result;
    }

    public Object reasonClassify(String projectId) {
        return reasonClassify(projectId, null);
    }

    public Object reasonClassify(String projectId, String individualIri) {
        if (props.isEmbedded()) {
            return embedded.reasonClassify(projectId, individualIri);
        }
        return remote.reasonClassify(projectId);
    }

    public Object reasonSwrl(String projectId) {
        return props.isEmbedded() ? embedded.reasonSwrl(projectId) : remote.reasonSwrl(projectId);
    }

    public Object getSwrlCandidates(String projectId) {
        return auxStore.getSwrlCandidates(projectId);
    }

    public Object putSwrlCandidates(String projectId, String body) {
        try {
            return auxStore.putSwrlCandidates(projectId, body);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object getConsistencyResults(String projectId) {
        return auxStore.getConsistencyResults(projectId);
    }

    public Object getSemanticBase(String projectId) {
        return auxStore.getSemanticBase(projectId);
    }

    public Object saveSemanticBase(String projectId, String body) {
        try {
            return auxStore.saveSemanticBase(projectId, body);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object seedSemanticBase(String projectId) {
        try {
            return auxStore.seedSemanticBase(projectId);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object getDocIntel(String projectId) {
        return docIntel.snapshot(projectId);
    }

    public Object getDocIntelEngines() {
        return docIntel.engines();
    }

    public Object uploadDocIntel(String projectId, MultipartFile file) {
        try {
            return docIntel.upload(projectId, file);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object startDocIntelJob(String projectId, String docId) {
        return startDocIntelJob(projectId, docId, Map.of());
    }

    public Object startDocIntelJob(String projectId, String docId, Map<String, Object> options) {
        try {
            return docIntel.startJob(projectId, docId, options);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object promoteDocIntelIntake(String projectId, String candidateId, String asKind) {
        try {
            return docIntel.promoteIntake(projectId, candidateId, asKind);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object dismissDocIntelIntake(String projectId, String candidateId) {
        try {
            return docIntel.dismissIntake(projectId, candidateId);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object getDocIntelJob(String projectId, String jobId) {
        return docIntel.getJob(projectId, jobId);
    }

    public Object listDocIntelChunks(String projectId, String docId) {
        return docIntel.listChunks(projectId, docId);
    }

    public Object listDocIntelCandidates(String projectId, String status) {
        return docIntel.listCandidates(projectId, status);
    }

    public Object decideDocIntelCandidate(String projectId, String candidateId, String decision, String editedLabel) {
        try {
            return docIntel.decide(projectId, candidateId, decision, editedLabel);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object acceptDocIntelPending(String projectId) {
        try {
            return docIntel.acceptPending(projectId);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object getDocIntelEvidence(String projectId, String candidateId) {
        return docIntel.getEvidence(projectId, candidateId);
    }

    public Object seedDocIntelDemo(String projectId) {
        try {
            return docIntel.seedDemo(projectId);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object pushDocIntelArgilla(String projectId) {
        try {
            return docIntel.pushToArgilla(projectId);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object syncDocIntelArgilla(String projectId) {
        try {
            return docIntel.syncFromArgilla(projectId);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object docIntelStructureReview(String projectId) {
        try {
            return docIntel.structureReview(projectId);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object decideDocIntelBatch(String projectId, java.util.List<String> candidateIds, String decision) {
        try {
            return docIntel.decideBatch(projectId, candidateIds, decision);
        } catch (Exception e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    public Object deleteIndividual(String projectId, String iri) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("deleteIndividual requires embedded mode");
        }
        return embedded.deleteIndividual(projectId, iri);
    }

    public Object deletePropertyAssertions(String projectId, String individual, String property, String kind, String msg) {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("deletePropertyAssertions requires embedded mode");
        }
        return embedded.deletePropertyAssertions(projectId, individual, property, kind, msg);
    }

    public Object cleanupInvalidIndividuals(String projectId) {
        if (!props.isEmbedded()) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("removedIndividualsCount", 0);
            return out;
        }
        return embedded.cleanupInvalidIndividuals(projectId);
    }

    /**
     * {@code benti:stateGraph} on the class×behavior {@code SubClassOf} restriction
     * (aligned with {@code benti:functionCode}).
     */
    public Map<String, Object> getClassBehavior(String projectId, String classIri, String behaviorIri, String kind) {
        requireEmbedded();
        return embedded.getClassStateGraph(projectId, classIri, behaviorIri, kind);
    }

    public Map<String, Object> saveClassBehavior(String projectId, String classIri, String behaviorIri,
                                                String kind, Map<String, Object> body) {
        requireEmbedded();
        return embedded.setClassStateGraph(projectId, classIri, behaviorIri, kind, body);
    }

    public Map<String, Object> deleteClassBehavior(String projectId, String classIri, String behaviorIri, String kind) {
        requireEmbedded();
        return embedded.deleteClassStateGraph(projectId, classIri, behaviorIri, kind);
    }

    private void requireEmbedded() {
        if (!props.isEmbedded()) {
            throw new UnsupportedOperationException("class behavior requires embedded mode");
        }
    }
}
