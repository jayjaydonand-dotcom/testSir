package com.benti.ontology.embed;

import com.benti.ontology.util.ProjectListOrders;
import com.fasterxml.jackson.databind.ObjectMapper;
import edu.stanford.bmir.protege.web.server.api.ActionExecutor;
import edu.stanford.bmir.protege.web.server.dispatch.actions.AddAxiomsAction;
import edu.stanford.bmir.protege.web.server.dispatch.actions.DeleteAxiomsAction;
import edu.stanford.bmir.protege.web.server.dispatch.actions.GetRevisionsAction;
import edu.stanford.bmir.protege.web.server.dispatch.actions.GetRevisionsResult;
import edu.stanford.bmir.protege.web.server.download.DownloadFormat;
import edu.stanford.bmir.protege.web.server.reasoner.HermitClassifyResult;
import edu.stanford.bmir.protege.web.server.reasoner.HermitConsistencyChecker;
import edu.stanford.bmir.protege.web.server.reasoner.HermitConsistencyResult;
import edu.stanford.bmir.protege.web.server.reasoner.HermitIndividualClassifier;
import edu.stanford.bmir.protege.web.server.reasoner.PelletSwrlReasoner;
import edu.stanford.bmir.protege.web.server.reasoner.PelletSwrlResult;
import edu.stanford.bmir.protege.web.server.revision.RevisionManager;
import edu.stanford.bmir.protege.web.shared.dispatch.Action;
import edu.stanford.bmir.protege.web.shared.dispatch.Result;
import edu.stanford.bmir.protege.web.shared.entity.DeleteEntitiesAction;
import edu.stanford.bmir.protege.web.shared.csv.DocumentId;
import edu.stanford.bmir.protege.web.shared.project.CreateNewProjectAction;
import edu.stanford.bmir.protege.web.shared.project.CreateNewProjectResult;
import edu.stanford.bmir.protege.web.shared.project.GetAvailableProjectsAction;
import edu.stanford.bmir.protege.web.shared.project.GetAvailableProjectsResult;
import edu.stanford.bmir.protege.web.shared.project.MoveProjectsToTrashAction;
import edu.stanford.bmir.protege.web.shared.project.NewProjectSettings;
import edu.stanford.bmir.protege.web.shared.project.ProjectId;
import edu.stanford.bmir.protege.web.shared.project.RemoveProjectFromTrashAction;
import edu.stanford.bmir.protege.web.shared.projectsettings.GetProjectSettingsAction;
import edu.stanford.bmir.protege.web.shared.projectsettings.GetProjectSettingsResult;
import edu.stanford.bmir.protege.web.shared.projectsettings.ProjectSettings;
import edu.stanford.bmir.protege.web.shared.projectsettings.SetProjectSettingsAction;
import edu.stanford.bmir.protege.web.shared.revision.RevisionNumber;
import edu.stanford.bmir.protege.web.shared.user.UserId;
import org.semanticweb.owlapi.apibinding.OWLManager;
import org.semanticweb.owlapi.model.IRI;
import org.semanticweb.owlapi.model.OWLAnnotation;
import org.semanticweb.owlapi.model.OWLAnnotationAssertionAxiom;
import org.semanticweb.owlapi.model.OWLAnnotationProperty;
import org.semanticweb.owlapi.model.OWLAnnotationValue;
import org.semanticweb.owlapi.model.OWLAxiom;
import org.semanticweb.owlapi.model.OWLClass;
import org.semanticweb.owlapi.model.OWLClassExpression;
import org.semanticweb.owlapi.model.OWLDataFactory;
import org.semanticweb.owlapi.model.OWLDataProperty;
import org.semanticweb.owlapi.model.OWLDataPropertyAssertionAxiom;
import org.semanticweb.owlapi.model.OWLDataPropertyExpression;
import org.semanticweb.owlapi.model.OWLEntity;
import org.semanticweb.owlapi.model.OWLLiteral;
import org.semanticweb.owlapi.model.OWLNamedIndividual;
import org.semanticweb.owlapi.model.OWLObjectProperty;
import org.semanticweb.owlapi.model.OWLObjectPropertyAssertionAxiom;
import org.semanticweb.owlapi.model.OWLObjectPropertyExpression;
import org.semanticweb.owlapi.model.OWLDocumentFormat;
import org.semanticweb.owlapi.model.OWLOntology;
import org.semanticweb.owlapi.model.OWLOntologyManager;
import org.semanticweb.owlapi.model.OWLPropertyExpression;
import org.semanticweb.owlapi.model.OWLSubClassOfAxiom;
import org.semanticweb.owlapi.util.OntologyIRIShortFormProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * In-process ontology operations via embedded WebProtege ActionExecutor + reasoners.
 */
@Service
public class EmbeddedOntologyService {

    private static final UserId ADMIN = UserId.getUserId("admin");

    /**
     * JSON blob for a behavior state machine, stored as an annotation on the
     * class's {@code SubClassOf} restriction axiom for that behavior property
     * (same pattern as {@code benti:functionCode}).
     */
    public static final String STATE_GRAPH_IRI = "http://example.org/benti#stateGraph";
    public static final String KIND_STATE_MACHINE = "stateMachine";
    public static final String KIND_BEHAVIOR_TREE = "behaviorTree";

    private final EmbeddedWebProtegeRuntime runtime;
    private final ObjectMapper objectMapper;

    public EmbeddedOntologyService(EmbeddedWebProtegeRuntime runtime, ObjectMapper objectMapper) {
        this.runtime = runtime;
        this.objectMapper = objectMapper;
    }

    public List<Map<String, Object>> listProjects() {
        runtime.start();
        try {
            GetAvailableProjectsResult result = execute(new GetAvailableProjectsAction());
            List<Map<String, Object>> list = objectMapper.convertValue(result.getDetails(), List.class);
            if (list == null) {
                return List.of();
            }
            List<Map<String, Object>> normalized = new ArrayList<>();
            for (Map<String, Object> item : list) {
                normalized.add(normalizeProjectMap(item));
            }
            ProjectListOrders.sortByCreatedAtDesc(normalized);
            return normalized;
        } catch (Exception e) {
            throw wrap("listProjects", e);
        }
    }

    public Map<String, Object> createProject(String displayName, String description) {
        return createProject(displayName, description, null);
    }

    /**
     * Create a project. When {@code documentId} is set (from {@link #uploadSource}),
     * WebProtege imports ontology sources the same way as the classic UI.
     */
    public Map<String, Object> createProject(String displayName, String description, String documentId) {
        runtime.start();
        try {
            String name = displayName == null || displayName.isBlank() ? "untitled" : displayName.trim();
            String desc = description == null ? "" : description;
            NewProjectSettings settings;
            if (documentId != null && !documentId.isBlank()) {
                settings = NewProjectSettings.get(ADMIN, name, "zh", desc, new DocumentId(documentId.trim()));
            } else {
                settings = NewProjectSettings.get(ADMIN, name, "zh", desc);
            }
            CreateNewProjectResult result = execute(new CreateNewProjectAction(settings));
            return normalizeProjectMap(objectMapper.convertValue(result.getProjectDetails(), Map.class));
        } catch (Exception e) {
            throw wrap("createProject", e);
        }
    }

    /**
     * Store an ontology source file under WebProtege {@code dataDirectory/uploads}
     * (same layout as {@code FileUploadServlet}) and return the document id.
     */
    public Map<String, Object> uploadSource(MultipartFile file) {
        runtime.start();
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择要上传的本体文件");
        }
        String original = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().trim();
        // Some browsers strip / garble non-ASCII filenames; fall back to content sniffing.
        String lower = original.toLowerCase(Locale.ROOT);
        String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase(Locale.ROOT);
        boolean allowedByName = isAllowedOntologyFile(lower);
        boolean allowedByType = isAllowedOntologyContentType(contentType);
        byte[] payload = null;
        if (!allowedByName && !allowedByType) {
            // Last resort: peek at payload (RDF/XML, Turtle, Functional).
            // Cache bytes so we can write them later (stream may only be readable once).
            try {
                payload = file.getBytes();
                if (!looksLikeOntologyBytes(payload)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "不支持的文件类型，请上传 .owl / .owx / .rdf / .ttl / .obo / .ofn / .omn / .xml / .zip"
                                    + (original.isEmpty() ? "（未识别到文件名，请确认选择的是本体文件）" : ""));
                }
            } catch (ResponseStatusException e) {
                throw e;
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "无法读取上传文件：" + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
            }
        }
        try {
            File uploadsDir = runtime.getUploadsDirectory();
            Files.createDirectories(uploadsDir.toPath());
            // Match FileUploadServlet: upload-<random> with empty suffix; DocumentId = file name
            File dest = File.createTempFile("upload-", "", uploadsDir);
            if (payload != null) {
                Files.write(dest.toPath(), payload);
            } else {
                file.transferTo(dest);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("documentId", dest.getName());
            out.put("fileName", original.isEmpty() ? dest.getName() + ".owl" : original);
            out.put("size", dest.length());
            out.put("ok", true);
            return out;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw wrap("uploadSource", e);
        }
    }

    private static boolean isAllowedOntologyFile(String lowerName) {
        if (lowerName == null || lowerName.isEmpty()) {
            return false;
        }
        // Windows may send a full path; only check the last segment.
        String base = lowerName;
        int slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
        if (slash >= 0 && slash + 1 < base.length()) {
            base = base.substring(slash + 1);
        }
        return base.endsWith(".owl")
                || base.endsWith(".owx")
                || base.endsWith(".rdf")
                || base.endsWith(".ttl")
                || base.endsWith(".obo")
                || base.endsWith(".ofn")
                || base.endsWith(".omn")
                || base.endsWith(".xml")
                || base.endsWith(".zip");
    }

    private static boolean isAllowedOntologyContentType(String contentType) {
        if (contentType == null || contentType.isBlank()) {
            return false;
        }
        return contentType.contains("rdf")
                || contentType.contains("owl")
                || contentType.contains("turtle")
                || contentType.contains("xml")
                || contentType.contains("octet-stream");
    }

    private static boolean looksLikeOntologyBytes(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return false;
        }
        int n = Math.min(bytes.length, 4096);
        // Skip UTF-8 BOM
        int offset = 0;
        if (n >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            offset = 3;
        }
        String head = new String(bytes, offset, Math.min(n - offset, 2048), StandardCharsets.UTF_8)
                .replace("\u0000", "")
                .trim();
        String lower = head.toLowerCase(Locale.ROOT);
        return lower.startsWith("<?xml")
                || lower.contains("<rdf:rdf")
                || lower.contains("<owl:ontology")
                || lower.startsWith("@prefix")
                || lower.startsWith("prefix(")
                || lower.startsWith("ontology(");
    }

    public Map<String, Object> updateProject(String projectId, String displayName, String description) {
        runtime.start();
        try {
            ProjectId pid = ProjectId.get(projectId);
            GetProjectSettingsResult getResult = execute(new GetProjectSettingsAction(pid));
            ProjectSettings current = getResult.getProjectSettings();

            String name = displayName != null ? displayName : current.getProjectDisplayName();
            String desc = description != null ? description : current.getProjectDescription();
            ProjectSettings updated = ProjectSettings.get(
                    pid,
                    name,
                    desc,
                    current.getDefaultLanguage(),
                    current.getDefaultDisplayNameSettings(),
                    current.getSlackIntegrationSettings(),
                    current.getWebhookSettings());

            execute(new SetProjectSettingsAction(updated));

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("projectId", projectId);
            out.put("displayName", name);
            out.put("description", desc);
            out.put("ok", true);
            return out;
        } catch (Exception e) {
            throw wrap("updateProject", e);
        }
    }

    public Map<String, Object> trashProject(String projectId) {
        return setProjectTrash(projectId, true);
    }

    public Map<String, Object> restoreProject(String projectId) {
        return setProjectTrash(projectId, false);
    }

    private Map<String, Object> setProjectTrash(String projectId, boolean trash) {
        runtime.start();
        try {
            ProjectId pid = ProjectId.get(projectId);
            if (trash) {
                execute(new MoveProjectsToTrashAction(pid));
            } else {
                execute(new RemoveProjectFromTrashAction(pid));
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("projectId", projectId);
            out.put("inTrash", trash);
            out.put("ok", true);
            return out;
        } catch (Exception e) {
            throw wrap(trash ? "trashProject" : "restoreProject", e);
        }
    }

    private Map<String, Object> normalizeProjectMap(Map<String, Object> map) {
        if (map == null) {
            return new LinkedHashMap<>();
        }
        Map<String, Object> copy = new LinkedHashMap<>(map);
        if (!copy.containsKey("projectId") && copy.get("_id") != null) {
            copy.put("projectId", String.valueOf(copy.get("_id")));
        }
        return copy;
    }

    public Object getRevisions(String projectId, long from, String to) {
        runtime.start();
        try {
            ProjectId pid = ProjectId.get(projectId);
            RevisionNumber fromRev = RevisionNumber.getRevisionNumber(from);
            RevisionNumber toRev;
            if (to == null || to.isEmpty() || "HEAD".equalsIgnoreCase(to)) {
                toRev = runtime.getRevisionManager(projectId).getCurrentRevision();
            } else {
                toRev = RevisionNumber.getRevisionNumber(Long.parseLong(to));
            }
            GetRevisionsResult result = execute(new GetRevisionsAction(pid, fromRev, toRev, null));
            String json = objectMapper.writeValueAsString(result.getRevisions());
            return objectMapper.readValue(json, Object.class);
        } catch (Exception e) {
            throw wrap("getRevisions", e);
        }
    }

    /**
     * Current HEAD axiom list as OWLAPI {@code toString()} functional forms
     * (same rendering as revision change details). Avoids replaying full history.
     */
    public Map<String, Object> getOntologySnapshot(String projectId) {
        runtime.start();
        try {
            RevisionManager revisionManager = runtime.getRevisionManager(projectId);
            RevisionNumber currentRevision = revisionManager.getCurrentRevision();
            OWLOntologyManager ontologyManager = revisionManager.getOntologyManagerForRevision(currentRevision);

            // Stable order: largest ontology first (imports / fragments after)
            List<OWLOntology> ontologies = new ArrayList<>(ontologyManager.getOntologies());
            ontologies.sort((a, b) -> Integer.compare(b.getAxiomCount(), a.getAxiomCount()));

            LinkedHashMap<String, String> unique = new LinkedHashMap<>();
            for (OWLOntology ontology : ontologies) {
                for (OWLAxiom axiom : ontology.getAxioms()) {
                    String rendered = String.valueOf(axiom);
                    unique.putIfAbsent(rendered.replaceAll("\\s+", " ").trim(), rendered);
                }
            }
            List<String> axioms = new ArrayList<>(unique.values());

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("projectId", projectId);
            out.put("revision", currentRevision.getValue());
            out.put("axiomCount", axioms.size());
            out.put("ontologyCount", ontologies.size());
            out.put("axioms", axioms);
            return out;
        } catch (Exception e) {
            throw wrap("getOntologySnapshot", e);
        }
    }

    /**
     * Export HEAD revision ontologies in the requested OWLAPI format.
     * Single ontology → raw file; multiple → zip (same idea as WebProtege download).
     */
    public OntologyExport exportOntology(String projectId, String formatKey) {
        runtime.start();
        try {
            DownloadFormat format = resolveDownloadFormat(formatKey);
            ProjectId pid = ProjectId.get(projectId);
            GetProjectSettingsResult settingsResult = execute(new GetProjectSettingsAction(pid));
            String displayName = settingsResult.getProjectSettings().getProjectDisplayName();
            if (displayName == null || displayName.isBlank()) {
                displayName = "ontology";
            }

            RevisionManager revisionManager = runtime.getRevisionManager(projectId);
            RevisionNumber currentRevision = revisionManager.getCurrentRevision();
            OWLOntologyManager ontologyManager = revisionManager.getOntologyManagerForRevision(currentRevision);
            List<OWLOntology> ontologies = new ArrayList<>(ontologyManager.getOntologies());
            if (ontologies.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "project has no ontologies to export");
            }
            ontologies.sort((a, b) -> Integer.compare(b.getAxiomCount(), a.getAxiomCount()));

            String baseName = sanitizeFileBase(displayName);
            String extension = format.getExtension();

            if (ontologies.size() == 1) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                saveOntology(ontologies.get(0), format, out);
                return new OntologyExport(
                        out.toByteArray(),
                        baseName + "." + extension,
                        format.getMimeType(),
                        extension,
                        false);
            }

            ByteArrayOutputStream zipBytes = new ByteArrayOutputStream();
            String folder = (baseName + "-ontologies-" + extension + "-REVISION-"
                    + (currentRevision.isHead() ? "HEAD" : currentRevision.getValue()))
                    .toLowerCase(Locale.ROOT);
            OntologyIRIShortFormProvider shortForms = new OntologyIRIShortFormProvider();
            try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(zipBytes))) {
                for (OWLOntology ontology : ontologies) {
                    String shortForm = shortForms.getShortForm(ontology).replace(':', '_');
                    ZipEntry entry = new ZipEntry(folder + "/" + shortForm + "." + extension);
                    zip.putNextEntry(entry);
                    saveOntology(ontology, format, zip);
                    zip.closeEntry();
                }
                zip.finish();
            }
            return new OntologyExport(
                    zipBytes.toByteArray(),
                    baseName + "-" + extension + ".zip",
                    "application/zip",
                    extension,
                    true);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw wrap("exportOntology", e);
        }
    }

    private static void saveOntology(OWLOntology ontology, DownloadFormat format, java.io.OutputStream out)
            throws Exception {
        OWLDocumentFormat documentFormat = format.getDocumentFormat();
        ontology.getOWLOntologyManager().saveOntology(ontology, documentFormat, out);
    }

    private static DownloadFormat resolveDownloadFormat(String formatKey) {
        if (formatKey == null || formatKey.isBlank()) {
            return DownloadFormat.getDefaultFormat();
        }
        String key = formatKey.trim().toLowerCase(Locale.ROOT);
        if ("rdf".equals(key) || "rdfxml".equals(key) || "rdf/xml".equals(key)) {
            key = "owl";
        }
        return DownloadFormat.getDownloadFormatFromParameterName(key);
    }

    private static String sanitizeFileBase(String name) {
        String cleaned = name.trim()
                .replaceAll("[\\\\/:*?\"<>|]+", "-")
                .replaceAll("\\s+", "-");
        if (cleaned.isBlank()) {
            return "ontology";
        }
        return cleaned;
    }

    public Object addAxioms(String projectId, String message, String owlFunctional) {
        return mutateAxioms(projectId, message, owlFunctional, true);
    }

    public Object deleteAxioms(String projectId, String message, String owlFunctional) {
        return mutateAxioms(projectId, message, owlFunctional, false);
    }

    /**
     * Delete a named class / data property / object property (and referencing axioms).
     * kind: Class | DataProperty | ObjectProperty | Relation | Model
     */
    public Map<String, Object> deleteNamedEntity(String projectId, String entityIri, String kind) {
        runtime.start();
        try {
            ProjectId pid = ProjectId.get(projectId);
            OWLDataFactory df = OWLManager.getOWLDataFactory();
            IRI iri = IRI.create(entityIri);
            String k = kind == null ? "Class" : kind.trim();
            OWLEntity entity;
            if ("DataProperty".equalsIgnoreCase(k)) {
                entity = df.getOWLDataProperty(iri);
            } else if ("ObjectProperty".equalsIgnoreCase(k) || "Relation".equalsIgnoreCase(k)) {
                entity = df.getOWLObjectProperty(iri);
            } else {
                entity = df.getOWLClass(iri);
            }
            OWLOntology ontology = largestOntology(projectId);
            int referencing = ontology == null ? 0 : ontology.getReferencingAxioms(entity).size();
            execute(new DeleteEntitiesAction(pid, Collections.singleton(entity)));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("operation", "DELETE_ENTITY");
            out.put("iri", entityIri);
            out.put("kind", k);
            out.put("referencingAxioms", referencing);
            return out;
        } catch (Exception e) {
            throw wrap("deleteNamedEntity", e);
        }
    }

    /**
     * Replace string annotation assertions on a subject (e.g. rdfs:comment, uiUnit).
     * Removes existing assertions for each annotation property, then adds the new literals.
     */
    public Map<String, Object> replaceStringAnnotations(String projectId,
                                                        String subjectIri,
                                                        Map<String, String> annPropToLiteral,
                                                        String message) {
        runtime.start();
        try {
            ProjectId pid = ProjectId.get(projectId);
            OWLOntology ontology = largestOntology(projectId);
            if (ontology == null) {
                throw new IllegalStateException("No ontology in revision snapshot");
            }
            OWLDataFactory df = OWLManager.getOWLDataFactory();
            IRI subject = IRI.create(subjectIri);
            List<OWLAxiom> toRemove = new ArrayList<>();
            List<OWLAxiom> toAdd = new ArrayList<>();
            for (Map.Entry<String, String> e : annPropToLiteral.entrySet()) {
                if (e.getKey() == null || e.getKey().isBlank()) {
                    continue;
                }
                OWLAnnotationProperty prop = df.getOWLAnnotationProperty(IRI.create(e.getKey()));
                for (OWLAnnotationAssertionAxiom ax : ontology.getAnnotationAssertionAxioms(subject)) {
                    if (ax.getProperty().equals(prop)) {
                        toRemove.add(ax);
                    }
                }
                String lit = e.getValue() == null ? "" : e.getValue();
                if (!lit.isBlank()) {
                    OWLLiteral value = df.getOWLLiteral(lit, "zh");
                    toAdd.add(df.getOWLAnnotationAssertionAxiom(prop, subject, value));
                }
            }
            String msg = message == null || message.isEmpty() ? "Replace annotations" : message;
            if (!toRemove.isEmpty()) {
                execute(new DeleteAxiomsAction(pid, toRemove.stream(), msg + " (remove)"));
            }
            if (!toAdd.isEmpty()) {
                execute(new AddAxiomsAction(pid, toAdd.stream(), msg + " (add)"));
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("removed", toRemove.size());
            out.put("added", toAdd.size());
            out.put("iri", subjectIri);
            return out;
        } catch (Exception e) {
            throw wrap("replaceStringAnnotations", e);
        }
    }

    private Object mutateAxioms(String projectId, String message, String owlFunctional, boolean add) {
        runtime.start();
        try {
            ProjectId pid = ProjectId.get(projectId);
            Stream<OWLAxiom> axiomStream = loadAxiomStream(owlFunctional);
            String msg = message == null || message.isEmpty()
                    ? (add ? "Added axioms" : "Deleted axioms")
                    : message;
            Result result = add
                    ? execute(new AddAxiomsAction(pid, axiomStream, msg))
                    : execute(new DeleteAxiomsAction(pid, axiomStream, msg));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("operation", add ? "ADD" : "DELETE");
            out.put("result", String.valueOf(result));
            return out;
        } catch (Exception e) {
            throw wrap(add ? "addAxioms" : "deleteAxioms", e);
        }
    }

    private Stream<OWLAxiom> loadAxiomStream(String owlFunctional) throws Exception {
        OWLOntologyManager manager = OWLManager.createOWLOntologyManager();
        OWLOntology ontology = manager.loadOntologyFromOntologyDocument(
                new ByteArrayInputStream(owlFunctional.getBytes(StandardCharsets.UTF_8)));
        return ontology.getAxioms().stream();
    }

    public Object reasonConsistency(String projectId) {
        runtime.start();
        try {
            RevisionManager revisionManager = runtime.getRevisionManager(projectId);
            RevisionNumber currentRevision = revisionManager.getCurrentRevision();
            OWLOntologyManager ontologyManager = revisionManager.getOntologyManagerForRevision(currentRevision);
            HermitConsistencyResult result = new HermitConsistencyChecker()
                    .check(ontologyManager, currentRevision.getValue());
            return objectMapper.readValue(result.toJson(), Object.class);
        } catch (Exception e) {
            throw wrap("check", e);
        }
    }

    public Map<String, Object> deleteIndividual(String projectId, String individualIri) {
        runtime.start();
        try {
            ProjectId pid = ProjectId.get(projectId);
            RevisionManager revisionManager = runtime.getRevisionManager(projectId);
            RevisionNumber currentRevision = revisionManager.getCurrentRevision();
            OWLOntologyManager ontologyManager = revisionManager.getOntologyManagerForRevision(currentRevision);
            OWLOntology ontology = null;
            int best = -1;
            for (OWLOntology candidate : ontologyManager.getOntologies()) {
                int count = candidate.getAxiomCount();
                if (ontology == null || count > best) {
                    ontology = candidate;
                    best = count;
                }
            }
            OWLDataFactory df = OWLManager.getOWLDataFactory();
            OWLNamedIndividual individual = df.getOWLNamedIndividual(IRI.create(individualIri));
            int referencingBefore = 0;
            if (ontology != null) {
                referencingBefore = ontology.getReferencingAxioms(individual).size();
            }
            Set<OWLEntity> entities = Collections.singleton(individual);
            execute(new DeleteEntitiesAction(pid, entities));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("projectId", projectId);
            out.put("iri", individualIri);
            // Frontend historically checks removedAxiomsCount; expose referencing axiom count.
            out.put("removedAxiomsCount", Math.max(referencingBefore, 1));
            return out;
        } catch (Exception e) {
            throw wrap("deleteIndividual", e);
        }
    }

    public Map<String, Object> deletePropertyAssertions(String projectId,
                                                        String individualIri,
                                                        String propertyIri,
                                                        String kind,
                                                        String message) {
        runtime.start();
        try {
            RevisionManager revisionManager = runtime.getRevisionManager(projectId);
            RevisionNumber currentRevision = revisionManager.getCurrentRevision();
            OWLOntologyManager ontologyManager = revisionManager.getOntologyManagerForRevision(currentRevision);

            OWLOntology ontology = null;
            int best = -1;
            for (OWLOntology candidate : ontologyManager.getOntologies()) {
                int count = candidate.getAxiomCount();
                if (ontology == null || count > best) {
                    ontology = candidate;
                    best = count;
                }
            }
            if (ontology == null) {
                throw new IllegalStateException("No ontology in revision snapshot");
            }

            OWLDataFactory df = ontologyManager.getOWLDataFactory();
            OWLNamedIndividual individual = df.getOWLNamedIndividual(IRI.create(individualIri));
            boolean isData = kind == null || !"object".equalsIgnoreCase(kind.trim());
            List<OWLAxiom> toRemove = new ArrayList<>();
            if (isData) {
                OWLDataProperty property = df.getOWLDataProperty(IRI.create(propertyIri));
                for (OWLDataPropertyAssertionAxiom axiom : ontology.getDataPropertyAssertionAxioms(individual)) {
                    if (axiom.getProperty().equals(property) || propertyIriEquals(axiom.getProperty(), propertyIri)) {
                        toRemove.add(axiom);
                    }
                }
            } else {
                OWLObjectProperty property = df.getOWLObjectProperty(IRI.create(propertyIri));
                for (OWLObjectPropertyAssertionAxiom axiom : ontology.getObjectPropertyAssertionAxioms(individual)) {
                    if (axiom.getProperty().equals(property) || propertyIriEquals(axiom.getProperty(), propertyIri)) {
                        toRemove.add(axiom);
                    }
                }
            }

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("projectId", projectId);
            out.put("individual", individualIri);
            out.put("property", propertyIri);
            out.put("kind", isData ? "data" : "object");
            if (toRemove.isEmpty()) {
                out.put("ok", true);
                out.put("removed", 0);
                return out;
            }
            String msg = message == null || message.isEmpty() ? "Cleared instance property assertion" : message;
            execute(new DeleteAxiomsAction(ProjectId.get(projectId), toRemove.stream(), msg));
            out.put("ok", true);
            out.put("removed", toRemove.size());
            return out;
        } catch (Exception e) {
            throw wrap("deletePropertyAssertions", e);
        }
    }

    private static boolean propertyIriEquals(OWLPropertyExpression propertyExpr, String propertyIri) {
        try {
            if (propertyExpr.isAnonymous()) {
                return false;
            }
            if (propertyExpr instanceof OWLDataPropertyExpression) {
                return propertyIri.equals(
                        ((OWLDataPropertyExpression) propertyExpr).asOWLDataProperty().getIRI().toString());
            }
            if (propertyExpr instanceof OWLObjectPropertyExpression) {
                return propertyIri.equals(
                        ((OWLObjectPropertyExpression) propertyExpr).asOWLObjectProperty().getIRI().toString());
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    public Map<String, Object> cleanupInvalidIndividuals(String projectId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("projectId", projectId);
        out.put("removedIndividualsCount", 0);
        return out;
    }

    /**
     * Read {@code benti:stateGraph} from the class's SubClassOf restriction that uses
     * the given behavior property. Legacy property-level AnnotationAssertion values are
     * migrated onto that SubClassOf when present.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getClassStateGraph(String projectId, String classIri, String behaviorIri, String kind) {
        runtime.start();
        try {
            requireIri(classIri, "classIri");
            requireIri(behaviorIri, "behaviorIri");
            String k = normalizeBehaviorKind(kind);
            OWLOntology ontology = largestOntology(projectId);
            OWLDataFactory df = ontology.getOWLOntologyManager().getOWLDataFactory();
            OWLAnnotationProperty prop = df.getOWLAnnotationProperty(IRI.create(STATE_GRAPH_IRI));
            OWLSubClassOfAxiom found = findBehaviorRestrictionAxiom(ontology, df, classIri, behaviorIri);
            Map<String, Object> out = baseBehaviorResponse(projectId, classIri, behaviorIri, k);
            out.put("storage", "owl-subclassof");

            String literal = found == null ? null : annotationLiteral(found, prop);
            if ((literal == null || literal.isBlank()) && found != null) {
                literal = migrateLegacyPropertyStateGraph(projectId, ontology, df, prop, found, behaviorIri);
            }

            if (literal == null || literal.isBlank()) {
                // Still drop orphan property-level leftovers for this behavior.
                removeLegacyPropertyStateGraphs(projectId, ontology, df, prop, behaviorIri);
                out.put("exists", false);
                out.put("machine", null);
                out.put("graph", null);
                out.put("updatedAt", null);
                return out;
            }
            Map<String, Object> doc = objectMapper.readValue(literal, Map.class);
            String docKind = doc.get("kind") == null ? k : String.valueOf(doc.get("kind"));
            if (!k.equals(normalizeBehaviorKind(docKind))) {
                out.put("exists", false);
                out.put("machine", null);
                out.put("graph", null);
                out.put("updatedAt", null);
                return out;
            }
            out.put("exists", true);
            out.put("updatedAt", doc.get("updatedAt"));
            out.put("machine", doc.get("machine"));
            out.put("graph", doc.get("graph"));
            return out;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw wrap("getClassStateGraph", e);
        }
    }

    /**
     * Write {@code benti:stateGraph} onto the class×behavior SubClassOf restriction axiom.
     * Also removes any legacy property-level AnnotationAssertion for the behavior.
     */
    public Map<String, Object> setClassStateGraph(String projectId, String classIri, String behaviorIri,
                                                 String kind, Map<String, Object> body) {
        runtime.start();
        try {
            requireIri(classIri, "classIri");
            requireIri(behaviorIri, "behaviorIri");
            String k = normalizeBehaviorKind(kind);
            long now = System.currentTimeMillis();
            Map<String, Object> doc = new LinkedHashMap<>();
            doc.put("kind", k);
            doc.put("updatedAt", now);
            if (body != null && body.get("machine") != null) {
                doc.put("machine", body.get("machine"));
            }
            if (body != null && body.get("graph") != null) {
                doc.put("graph", body.get("graph"));
            }
            String json = objectMapper.writeValueAsString(doc);

            ProjectId pid = ProjectId.get(projectId);
            OWLOntology ontology = largestOntology(projectId);
            OWLDataFactory df = ontology.getOWLOntologyManager().getOWLDataFactory();
            OWLAnnotationProperty prop = df.getOWLAnnotationProperty(IRI.create(STATE_GRAPH_IRI));
            OWLSubClassOfAxiom found = findBehaviorRestrictionAxiom(ontology, df, classIri, behaviorIri);
            if (found == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "该类上没有该行为的 SubClassOf 限制，请先在行为 Tab 创建行为");
            }

            Set<OWLAnnotation> nextAnns = found.getAnnotations().stream()
                    .filter(a -> !a.getProperty().equals(prop))
                    .collect(Collectors.toCollection(HashSet::new));
            nextAnns.add(df.getOWLAnnotation(prop, df.getOWLLiteral(json)));
            OWLAxiom replacement = found.getAxiomWithoutAnnotations().getAnnotatedAxiom(nextAnns);

            execute(new DeleteAxiomsAction(pid, Stream.of(found),
                    "Replace SubClassOf before saving benti:stateGraph"));
            List<OWLAxiom> toAdd = new ArrayList<>();
            toAdd.add(df.getOWLDeclarationAxiom(prop));
            toAdd.add(replacement);
            execute(new AddAxiomsAction(pid, toAdd.stream(),
                    "Save behavior stateGraph on SubClassOf (" + k + ")"));
            removeLegacyPropertyStateGraphs(projectId, largestOntology(projectId), df, prop, behaviorIri);

            Map<String, Object> out = baseBehaviorResponse(projectId, classIri, behaviorIri, k);
            out.put("updatedAt", now);
            out.put("storage", "owl-subclassof");
            return out;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw wrap("setClassStateGraph", e);
        }
    }

    public Map<String, Object> deleteClassStateGraph(String projectId, String classIri, String behaviorIri, String kind) {
        runtime.start();
        try {
            requireIri(classIri, "classIri");
            requireIri(behaviorIri, "behaviorIri");
            String k = normalizeBehaviorKind(kind);
            ProjectId pid = ProjectId.get(projectId);
            OWLOntology ontology = largestOntology(projectId);
            OWLDataFactory df = ontology.getOWLOntologyManager().getOWLDataFactory();
            OWLAnnotationProperty prop = df.getOWLAnnotationProperty(IRI.create(STATE_GRAPH_IRI));
            OWLSubClassOfAxiom found = findBehaviorRestrictionAxiom(ontology, df, classIri, behaviorIri);
            int removed = 0;
            if (found != null && annotationLiteral(found, prop) != null) {
                Set<OWLAnnotation> nextAnns = found.getAnnotations().stream()
                        .filter(a -> !a.getProperty().equals(prop))
                        .collect(Collectors.toCollection(HashSet::new));
                OWLAxiom replacement = found.getAxiomWithoutAnnotations().getAnnotatedAxiom(nextAnns);
                execute(new DeleteAxiomsAction(pid, Stream.of(found),
                        "Remove benti:stateGraph from SubClassOf"));
                execute(new AddAxiomsAction(pid, Stream.of(replacement),
                        "Rewrite SubClassOf without stateGraph"));
                removed = 1;
            }
            int legacyRemoved = removeLegacyPropertyStateGraphs(
                    projectId, largestOntology(projectId), df, prop, behaviorIri);
            Map<String, Object> out = baseBehaviorResponse(projectId, classIri, behaviorIri, k);
            out.put("deleted", true);
            out.put("storage", "owl-subclassof");
            out.put("removed", removed + legacyRemoved);
            return out;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw wrap("deleteClassStateGraph", e);
        }
    }

    /**
     * Copy a legacy property-level {@code AnnotationAssertion(stateGraph, behavior)} onto the
     * class×behavior SubClassOf, then delete the property-level axiom(s).
     *
     * @return the migrated JSON literal, or null if nothing to migrate
     */
    private String migrateLegacyPropertyStateGraph(String projectId,
                                                   OWLOntology ontology,
                                                   OWLDataFactory df,
                                                   OWLAnnotationProperty prop,
                                                   OWLSubClassOfAxiom restriction,
                                                   String behaviorIri) {
        List<OWLAnnotationAssertionAxiom> legacy = findLegacyPropertyStateGraphs(ontology, df, prop, behaviorIri);
        if (legacy.isEmpty()) {
            return null;
        }
        String literal = null;
        for (OWLAnnotationAssertionAxiom axiom : legacy) {
            OWLAnnotationValue value = axiom.getValue();
            if (value instanceof OWLLiteral) {
                literal = ((OWLLiteral) value).getLiteral();
                if (literal != null && !literal.isBlank()) {
                    break;
                }
            }
        }
        if (literal == null || literal.isBlank()) {
            removeLegacyPropertyStateGraphs(projectId, ontology, df, prop, behaviorIri);
            return null;
        }

        ProjectId pid = ProjectId.get(projectId);
        Set<OWLAnnotation> nextAnns = restriction.getAnnotations().stream()
                .filter(a -> !a.getProperty().equals(prop))
                .collect(Collectors.toCollection(HashSet::new));
        nextAnns.add(df.getOWLAnnotation(prop, df.getOWLLiteral(literal)));
        OWLAxiom replacement = restriction.getAxiomWithoutAnnotations().getAnnotatedAxiom(nextAnns);
        execute(new DeleteAxiomsAction(pid, Stream.of(restriction),
                "Replace SubClassOf before migrating benti:stateGraph"));
        List<OWLAxiom> toAdd = new ArrayList<>();
        toAdd.add(df.getOWLDeclarationAxiom(prop));
        toAdd.add(replacement);
        execute(new AddAxiomsAction(pid, toAdd.stream(),
                "Migrate benti:stateGraph onto SubClassOf"));
        removeLegacyPropertyStateGraphs(projectId, largestOntology(projectId), df, prop, behaviorIri);
        return literal;
    }

    private static List<OWLAnnotationAssertionAxiom> findLegacyPropertyStateGraphs(OWLOntology ontology,
                                                                                   OWLDataFactory df,
                                                                                   OWLAnnotationProperty prop,
                                                                                   String behaviorIri) {
        IRI subject = IRI.create(behaviorIri);
        List<OWLAnnotationAssertionAxiom> out = new ArrayList<>();
        for (OWLAnnotationAssertionAxiom axiom : ontology.getAnnotationAssertionAxioms(subject)) {
            if (axiom.getProperty().equals(prop)) {
                out.add(axiom);
            }
        }
        return out;
    }

    /** @return number of deleted legacy property-level axioms */
    private int removeLegacyPropertyStateGraphs(String projectId,
                                                OWLOntology ontology,
                                                OWLDataFactory df,
                                                OWLAnnotationProperty prop,
                                                String behaviorIri) {
        List<OWLAnnotationAssertionAxiom> legacy = findLegacyPropertyStateGraphs(ontology, df, prop, behaviorIri);
        if (legacy.isEmpty()) {
            return 0;
        }
        List<OWLAxiom> toDelete = new ArrayList<>(legacy);
        execute(new DeleteAxiomsAction(ProjectId.get(projectId), toDelete.stream(),
                "Remove legacy property-level benti:stateGraph"));
        return legacy.size();
    }

    private static Map<String, Object> baseBehaviorResponse(String projectId, String classIri,
                                                            String behaviorIri, String kind) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("projectId", projectId);
        out.put("classIri", classIri);
        out.put("behaviorIri", behaviorIri);
        out.put("kind", kind);
        return out;
    }

    private static void requireIri(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "missing " + name);
        }
    }

    private static String annotationLiteral(OWLSubClassOfAxiom axiom, OWLAnnotationProperty prop) {
        for (OWLAnnotation annotation : axiom.getAnnotations()) {
            if (!annotation.getProperty().equals(prop)) {
                continue;
            }
            OWLAnnotationValue value = annotation.getValue();
            if (value instanceof OWLLiteral) {
                return ((OWLLiteral) value).getLiteral();
            }
        }
        return null;
    }

    private static OWLSubClassOfAxiom findBehaviorRestrictionAxiom(OWLOntology ontology, OWLDataFactory df,
                                                                   String classIri, String behaviorIri) {
        OWLClass cls = df.getOWLClass(IRI.create(classIri));
        IRI propIri = IRI.create(behaviorIri);
        for (OWLSubClassOfAxiom axiom : ontology.getSubClassAxiomsForSubClass(cls)) {
            if (restrictionMentionsProperty(axiom.getSuperClass(), propIri)) {
                return axiom;
            }
        }
        return null;
    }

    private static boolean restrictionMentionsProperty(OWLClassExpression expression, IRI propertyIri) {
        if (expression == null || propertyIri == null) {
            return false;
        }
        return expression.getDataPropertiesInSignature().stream().anyMatch(p -> p.getIRI().equals(propertyIri))
                || expression.getObjectPropertiesInSignature().stream().anyMatch(p -> p.getIRI().equals(propertyIri));
    }

    private OWLOntology largestOntology(String projectId) {
        RevisionManager revisionManager = runtime.getRevisionManager(projectId);
        RevisionNumber currentRevision = revisionManager.getCurrentRevision();
        OWLOntologyManager ontologyManager = revisionManager.getOntologyManagerForRevision(currentRevision);
        OWLOntology ontology = null;
        int best = -1;
        for (OWLOntology candidate : ontologyManager.getOntologies()) {
            int count = candidate.getAxiomCount();
            if (ontology == null || count > best) {
                ontology = candidate;
                best = count;
            }
        }
        if (ontology == null) {
            throw new IllegalStateException("No ontology in revision snapshot");
        }
        return ontology;
    }

    private static String normalizeBehaviorKind(String kind) {
        if (kind == null || kind.isBlank() || KIND_STATE_MACHINE.equalsIgnoreCase(kind)) {
            return KIND_STATE_MACHINE;
        }
        if (KIND_BEHAVIOR_TREE.equalsIgnoreCase(kind)) {
            return KIND_BEHAVIOR_TREE;
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unsupported kind: " + kind);
    }

    /**
     * HermiT individual classification requires an individual IRI.
     * Without one, returns a structured failure (API kept project-scoped for compatibility).
     */
    public Object reasonClassify(String projectId) {
        return reasonClassify(projectId, null);
    }

    public Object reasonClassify(String projectId, String individualIri) {
        runtime.start();
        try {
            RevisionManager revisionManager = runtime.getRevisionManager(projectId);
            RevisionNumber currentRevision = revisionManager.getCurrentRevision();
            OWLOntologyManager ontologyManager = revisionManager.getOntologyManagerForRevision(currentRevision);
            HermitClassifyResult result = new HermitIndividualClassifier()
                    .classify(ontologyManager, currentRevision.getValue(),
                            individualIri == null ? "" : individualIri);
            return objectMapper.readValue(result.toJson(), Object.class);
        } catch (Exception e) {
            throw wrap("classify", e);
        }
    }

    public Object reasonSwrl(String projectId) {
        runtime.start();
        try {
            RevisionManager revisionManager = runtime.getRevisionManager(projectId);
            RevisionNumber currentRevision = revisionManager.getCurrentRevision();
            OWLOntologyManager ontologyManager = revisionManager.getOntologyManagerForRevision(currentRevision);
            PelletSwrlResult result = new PelletSwrlReasoner()
                    .run(ontologyManager, currentRevision.getValue());
            return objectMapper.readValue(result.toJson(), Object.class);
        } catch (Exception e) {
            throw wrap("run", e);
        }
    }

    private <A extends Action<R>, R extends Result> R execute(A action) {
        ActionExecutor executor = new ActionExecutor(runtime.getServerComponent().getDispatchServlet().getExecutor());
        return executor.execute(action, ADMIN);
    }

    private static ResponseStatusException wrap(String op, Exception e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) {
            t = t.getCause();
        }
        String msg = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
        return new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, op + " failed: " + msg, e);
    }
}
