package com.benti.ontology.embed;

import com.benti.ontology.config.WebProtegeProperties;
import edu.stanford.bmir.protege.web.server.app.ApplicationDisposablesManager;
import edu.stanford.bmir.protege.web.server.app.DaggerServerComponent;
import edu.stanford.bmir.protege.web.server.app.ServerComponent;
import edu.stanford.bmir.protege.web.server.project.ProjectCache;
import edu.stanford.bmir.protege.web.server.project.ProjectCacheManager;
import edu.stanford.bmir.protege.web.server.revision.RevisionManager;
import edu.stanford.bmir.protege.web.shared.project.ProjectId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.annotation.PreDestroy;
import java.io.File;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Boots WebProtege {@link DaggerServerComponent} in-process so Spring Boot can use
 * ProjectCache / RevisionManager / Pellet / HermiT without calling Tomcat over HTTP.
 */
@Component
public class EmbeddedWebProtegeRuntime {

    private static final Logger log = LoggerFactory.getLogger(EmbeddedWebProtegeRuntime.class);

    private final WebProtegeProperties props;
    private ServerComponent serverComponent;
    private ProjectCache projectCache;
    private boolean started;

    public EmbeddedWebProtegeRuntime(WebProtegeProperties props) {
        this.props = props;
    }

    public synchronized void start() {
        if (started) {
            return;
        }
        if (!props.isEmbedded()) {
            log.info("WebProtege mode=remote; skip in-process bootstrap");
            return;
        }
        File dataDir = new File(props.getDataDirectory());
        if (!dataDir.isDirectory()) {
            throw new IllegalStateException("webprotege.data-directory does not exist: " + dataDir.getAbsolutePath());
        }

        System.setProperty("webprotege.data.directory", dataDir.getAbsolutePath());
        System.setProperty("webprotege.mongodb.host", props.getMongodbHost());
        System.setProperty("webprotege.mongodb.port", String.valueOf(props.getMongodbPort()));
        log.info("Starting embedded WebProtege: dataDirectory={}, mongo={}:{}",
                dataDir.getAbsolutePath(), props.getMongodbHost(), props.getMongodbPort());

        try {
            serverComponent = DaggerServerComponent.create();
            serverComponent.getWebProtegeConfigurationChecker().performConfiguration();

            ProjectCacheManager cacheManager = serverComponent.getProjectCacheManager();
            cacheManager.start();
            projectCache = cacheManager.getProjectCache();

            started = true;
            log.info("Embedded WebProtege runtime started successfully");
        } catch (NoClassDefFoundError | ExceptionInInitializerError e) {
            throw new IllegalStateException(
                    "DaggerServerComponent not on classpath. Install WebProtege into local Maven first: "
                            + "scripts/install-webprotege.ps1 "
                            + "(requires edu.stanford.protege:webprotege-server:classes).", e);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to start embedded WebProtege: " + e.getMessage(), e);
        }
    }

    public boolean isStarted() {
        return started;
    }

    public ProjectCache getProjectCache() {
        ensureStarted();
        return Objects.requireNonNull(projectCache, "projectCache");
    }

    public ServerComponent getServerComponent() {
        ensureStarted();
        return serverComponent;
    }

    public RevisionManager getRevisionManager(String projectId) {
        return getProjectCache().getRevisionManager(ProjectId.get(projectId));
    }

    /** WebProtege data root (contains {@code uploads/}, project storage, etc.). */
    public File getDataDirectory() {
        return new File(props.getDataDirectory());
    }

    public File getUploadsDirectory() {
        File dir = new File(getDataDirectory(), "uploads");
        // no-op mkdir here; callers create as needed
        return dir;
    }

    public Map<String, Object> status() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("mode", props.getMode());
        map.put("embeddedStarted", started);
        map.put("dataDirectory", props.getDataDirectory());
        map.put("mongodbHost", props.getMongodbHost());
        map.put("mongodbPort", props.getMongodbPort());
        map.put("daggerPresent", classPresent("edu.stanford.bmir.protege.web.server.app.DaggerServerComponent"));
        map.put("pelletPresent", classPresent("edu.stanford.bmir.protege.web.server.reasoner.PelletSwrlReasoner"));
        map.put("hermitPresent", classPresent("edu.stanford.bmir.protege.web.server.reasoner.HermitConsistencyChecker"));
        return map;
    }

    @PreDestroy
    public synchronized void shutdown() {
        if (!started || serverComponent == null) {
            return;
        }
        try {
            ApplicationDisposablesManager disposables = serverComponent.getApplicationDisposablesManager();
            disposables.dispose();
            log.info("Embedded WebProtege runtime shut down");
        } catch (Exception e) {
            log.warn("Error shutting down embedded WebProtege: {}", e.getMessage());
        } finally {
            started = false;
        }
    }

    private void ensureStarted() {
        if (!started) {
            start();
        }
    }

    private static boolean classPresent(String name) {
        try {
            Class.forName(name);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
