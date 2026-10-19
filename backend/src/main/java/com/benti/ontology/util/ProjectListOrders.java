package com.benti.ontology.util;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Shared ordering for project list responses.
 */
public final class ProjectListOrders {

    private ProjectListOrders() {
    }

    /**
     * Newest {@code createdAt} first. Missing / non-numeric / zero timestamps
     * sort last; ties break on {@code projectId} for stable paging.
     */
    public static void sortByCreatedAtDesc(List<Map<String, Object>> projects) {
        if (projects == null || projects.size() < 2) {
            return;
        }
        projects.sort(BY_CREATED_AT_DESC);
    }

    private static final Comparator<Map<String, Object>> BY_CREATED_AT_DESC =
            Comparator
                    .comparingLong(ProjectListOrders::createdAtOrZero)
                    .reversed()
                    .thenComparing(ProjectListOrders::projectIdKey);

    private static long createdAtOrZero(Map<String, Object> project) {
        Object raw = project == null ? null : project.get("createdAt");
        if (raw instanceof Number) {
            long value = ((Number) raw).longValue();
            return value > 0 ? value : 0L;
        }
        if (raw instanceof String) {
            String text = ((String) raw).trim();
            if (!text.isEmpty()) {
                try {
                    long value = Long.parseLong(text);
                    return value > 0 ? value : 0L;
                } catch (NumberFormatException ignored) {
                    return 0L;
                }
            }
        }
        return 0L;
    }

    private static String projectIdKey(Map<String, Object> project) {
        if (project == null) {
            return "";
        }
        Object id = project.get("projectId");
        if (id == null) {
            id = project.get("_id");
        }
        return id == null ? "" : String.valueOf(id);
    }
}
