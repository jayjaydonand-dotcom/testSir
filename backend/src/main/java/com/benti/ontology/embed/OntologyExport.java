package com.benti.ontology.embed;

/**
 * Binary ontology download payload (single file or zip of multiple ontologies).
 */
public final class OntologyExport {

    private final byte[] bytes;
    private final String fileName;
    private final String contentType;
    private final String format;
    private final boolean zip;

    public OntologyExport(byte[] bytes, String fileName, String contentType, String format, boolean zip) {
        this.bytes = bytes;
        this.fileName = fileName;
        this.contentType = contentType;
        this.format = format;
        this.zip = zip;
    }

    public byte[] getBytes() {
        return bytes;
    }

    public String getFileName() {
        return fileName;
    }

    public String getContentType() {
        return contentType;
    }

    public String getFormat() {
        return format;
    }

    public boolean isZip() {
        return zip;
    }
}
