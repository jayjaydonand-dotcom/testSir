package com.benti.ontology.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "webprotege")
public class WebProtegeProperties {

    /** embedded = in-process DaggerServerComponent; remote = HTTP to WP Tomcat */
    private String mode = "embedded";
    private String dataDirectory = "";
    private String mongodbHost = "localhost";
    private int mongodbPort = 27017;
    private String baseUrl = "http://localhost:5000";
    private String apiKey = "";
    private int connectTimeoutMs = 10000;
    private int readTimeoutMs = 300000;

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public boolean isEmbedded() {
        return !"remote".equalsIgnoreCase(mode);
    }

    public String getDataDirectory() {
        return dataDirectory;
    }

    public void setDataDirectory(String dataDirectory) {
        this.dataDirectory = dataDirectory;
    }

    public String getMongodbHost() {
        return mongodbHost;
    }

    public void setMongodbHost(String mongodbHost) {
        this.mongodbHost = mongodbHost;
    }

    public int getMongodbPort() {
        return mongodbPort;
    }

    public void setMongodbPort(int mongodbPort) {
        this.mongodbPort = mongodbPort;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
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
}
