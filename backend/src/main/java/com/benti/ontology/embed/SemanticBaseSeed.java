package com.benti.ontology.embed;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Helicopter-oriented sample content for the semantic-base MVP scaffold.
 * Terms / indicators / standards only — trace chain deferred.
 */
final class SemanticBaseSeed {

    private SemanticBaseSeed() {
    }

    static Map<String, Object> build(String projectId) {
        long now = System.currentTimeMillis();
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("projectId", projectId);
        doc.put("version", 1);
        doc.put("domain", "helicopter");
        doc.put("title", "直升机论证研制 · 统一语义底座 MVP");
        doc.put("description", "最小可运行架子：术语 / 指标 / 标准挂载。后续扩至 500+ 术语、SHACL 与追溯链。");
        doc.put("updatedAt", now);
        doc.put("seededAt", now);

        List<Map<String, Object>> terms = new ArrayList<>();
        terms.add(term("term.helicopter", "直升机", "Helicopter", "装备", "旋翼类飞行器装备统称"));
        terms.add(term("term.main_rotor", "主旋翼", "Main Rotor", "气动/结构", "提供升力与部分推进的主旋翼系统"));
        terms.add(term("term.tail_rotor", "尾桨", "Tail Rotor", "气动/结构", "抗扭与航向控制装置"));
        terms.add(term("term.fuselage", "机身", "Fuselage", "结构", "承载乘员、任务载荷与各分系统的结构主体"));
        terms.add(term("term.powerplant", "动力装置", "Powerplant", "动力", "发动机及其附件、传动相关组件"));
        terms.add(term("term.avionics", "航电系统", "Avionics", "航电", "飞行、任务、通信导航等电子设备集合"));
        terms.add(term("term.mission_system", "任务系统", "Mission System", "任务", "面向作战/勤务任务的传感器与载荷系统"));
        terms.add(term("term.endurance", "续航时间", "Endurance", "指标术语", "在规定任务剖面下可持续飞行的时间"));
        terms.add(term("term.range", "航程", "Range", "指标术语", "在规定条件下可飞行的水平距离"));
        terms.add(term("term.hover_ceiling", "悬停升限", "Hover Ceiling", "指标术语", "可保持悬停的最大气压高度"));
        terms.add(term("term.max_takeoff_weight", "最大起飞重量", "MTOW", "指标术语", "允许起飞的最大重量"));
        terms.add(term("term.cruise_speed", "巡航速度", "Cruise Speed", "指标术语", "经济或任务巡航状态下的飞行速度"));
        terms.add(term("term.payload", "任务载荷", "Payload", "指标术语", "可装载的任务设备与物资质量"));
        terms.add(term("term.scheme", "装备方案", "Equipment Scheme", "过程", "研制/论证形成的方案或型号方案"));
        doc.put("terms", terms);

        List<Map<String, Object>> indicators = new ArrayList<>();
        indicators.add(indicator(
                "ind.mtow", "最大起飞重量", "max_takeoff_weight", "千克", "double",
                "动力/结构", "term.max_takeoff_weight",
                Map.of("required", true, "min", 0, "unitCode", "kg")));
        indicators.add(indicator(
                "ind.cruise_speed", "巡航速度", "cruise_speed", "千米/小时", "double",
                "气动/动力", "term.cruise_speed",
                Map.of("required", true, "min", 0, "unitCode", "km/h")));
        indicators.add(indicator(
                "ind.endurance", "续航时间", "endurance", "小时", "double",
                "任务/动力", "term.endurance",
                Map.of("required", true, "min", 0, "unitCode", "h")));
        indicators.add(indicator(
                "ind.range", "航程", "range", "千米", "double",
                "任务/动力", "term.range",
                Map.of("required", false, "min", 0, "unitCode", "km")));
        indicators.add(indicator(
                "ind.hover_ceiling_oge", "无地效悬停升限", "hover_ceiling_oge", "米", "double",
                "气动/动力", "term.hover_ceiling",
                Map.of("required", false, "min", 0, "unitCode", "m")));
        indicators.add(indicator(
                "ind.payload", "任务载荷", "payload_mass", "千克", "double",
                "任务", "term.payload",
                Map.of("required", true, "min", 0, "unitCode", "kg")));
        indicators.add(indicator(
                "ind.crew", "乘员数", "crew_count", "人", "integer",
                "人机", null,
                Map.of("required", false, "min", 1, "max", 20, "unitCode", "person")));
        indicators.add(indicator(
                "ind.domain", "使用空间域", "spatial_domain", "", "enum",
                "总体", null,
                Map.of("required", true, "enumValues", List.of("air", "land", "surface", "amphibious"))));
        doc.put("indicators", indicators);

        List<Map<String, Object>> standards = new ArrayList<>();
        standards.add(standard(
                "std.gjb.demo-1",
                "GJB/Z 示例-直升机论证总体要求（示范）",
                "示范标准条目，用于挂载与手工映射；正式标准请替换为真实文号与文件。",
                "GJB",
                "draft",
                null));
        standards.add(standard(
                "std.org.top-req",
                "顶层研制总要求（示范摘录）",
                "占位：后续支持上传 PDF/条文并映射到指标。",
                "ORG",
                "placeholder",
                null));
        doc.put("standards", standards);

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("terms", terms.size());
        stats.put("indicators", indicators.size());
        stats.put("standards", standards.size());
        doc.put("stats", stats);
        return doc;
    }

    private static Map<String, Object> term(String id, String label, String labelEn, String category, String definition) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("label", label);
        m.put("labelEn", labelEn);
        m.put("category", category);
        m.put("definition", definition);
        m.put("status", "draft");
        m.put("skosConceptIri", "");
        return m;
    }

    private static Map<String, Object> indicator(String id, String label, String code, String unit,
                                                 String dataType, String subsystem, String termId,
                                                 Map<String, Object> constraint) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("label", label);
        m.put("code", code);
        m.put("unit", unit);
        m.put("dataType", dataType);
        m.put("subsystem", subsystem);
        m.put("termId", termId == null ? "" : termId);
        m.put("constraint", constraint);
        m.put("owlPropertyIri", "");
        m.put("status", "draft");
        return m;
    }

    private static Map<String, Object> standard(String id, String title, String summary, String source,
                                                String status, String fileName) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("title", title);
        m.put("summary", summary);
        m.put("source", source);
        m.put("status", status);
        m.put("fileName", fileName == null ? "" : fileName);
        m.put("fileRef", "");
        return m;
    }
}
