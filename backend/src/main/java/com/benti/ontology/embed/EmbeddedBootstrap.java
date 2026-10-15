package com.benti.ontology.embed;

import com.benti.ontology.config.WebProtegeProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class EmbeddedBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(EmbeddedBootstrap.class);

    private final WebProtegeProperties props;
    private final EmbeddedWebProtegeRuntime runtime;

    public EmbeddedBootstrap(WebProtegeProperties props, EmbeddedWebProtegeRuntime runtime) {
        this.props = props;
        this.runtime = runtime;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!props.isEmbedded()) {
            log.info("webprotege.mode=remote — not bootstrapping DaggerServerComponent");
            return;
        }
        runtime.start();
        log.info("Embedded WebProtege ready: {}", runtime.status());
    }
}
