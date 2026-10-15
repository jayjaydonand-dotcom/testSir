package com.benti.ontology;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties
public class OntologyBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(OntologyBackendApplication.class, args);
    }
}
