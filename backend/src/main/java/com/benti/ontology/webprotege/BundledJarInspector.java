package com.benti.ontology.webprotege;

import org.springframework.stereotype.Component;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class BundledJarInspector {

    public Map<String, Object> inspect() {
        Map<String, Object> result = new LinkedHashMap<>();
        File libDir = new File("lib");
        if (!libDir.isDirectory()) {
            // when running from backend/, lib is relative; also try basedir from user.dir
            libDir = new File(System.getProperty("user.dir"), "lib");
        }
        List<Map<String, Object>> jars = new ArrayList<>();
        if (libDir.isDirectory()) {
            File[] files = libDir.listFiles((dir, name) -> name.endsWith(".jar"));
            if (files != null) {
                for (File file : files) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("name", file.getName());
                    row.put("bytes", file.length());
                    jars.add(row);
                }
            }
        }
        result.put("libDirectory", libDir.getAbsolutePath());
        result.put("jars", jars);
        result.put("reasonerClassPresent", classPresent(
                "edu.stanford.bmir.protege.web.server.reasoner.PelletSwrlReasoner"));
        result.put("hermitClassPresent", classPresent(
                "edu.stanford.bmir.protege.web.server.reasoner.HermitConsistencyChecker"));
        result.put("note", "Bundled jars are packaged with this app. Ontology persistence " +
                "(MongoDB + BinaryOWL data-directory) still runs in WebProtege; this service " +
                "exposes a clean REST API and delegates operations upstream.");
        return result;
    }

    private boolean classPresent(String name) {
        try {
            Class.forName(name);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
