package com.benti.ontology.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "doc-intel")
public class DocIntelProperties {

    /**
     * Base URL of Python worker, e.g. http://127.0.0.1:18100
     * Empty = local-heuristic only.
     */
    private String workerUrl = "http://127.0.0.1:18100";

    private int connectTimeoutMs = 3000;
    private int readTimeoutMs = 180000;

    public String getWorkerUrl() {
        String env = System.getenv("DOC_INTEL_WORKER_URL");
        if (env != null && !env.isBlank()) {
            return env.trim();
        }
        return workerUrl;
    }

    public void setWorkerUrl(String workerUrl) {
        this.workerUrl = workerUrl;
    }

    public int getConnectTimeoutMs() {
        return connectTimeoutMs;
    }

    public void setConnectTimeoutMs(int connectTimeoutMs) {
        this.connectTimeoutMs = connectTimeoutMs;
    }

    public int getReadTimeoutMs() {
        return readTimeoutMs;
    }

    public void setReadTimeoutMs(int readTimeoutMs) {
        this.readTimeoutMs = readTimeoutMs;
    }

    public boolean isWorkerConfigured() {
        String u = getWorkerUrl();
        return u != null && !u.isBlank();
    }
}
