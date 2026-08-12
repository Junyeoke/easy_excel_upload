// ExcelUploadHistoryActionController.java
package com.steg.lit.controller;

import com.steg.lit.repository.ExcelUploadEngineRepository;
import com.steg.lit.service.ExcelUploadEngineService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/**
 * Handles upload history lookup and comparison actions for the legacy
 * /api/excel/engine endpoint.
 */
@Component
public class ExcelUploadHistoryActionController {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadHistoryActionController.class);

    private final ExcelUploadEngineService service;
    private final ExcelUploadEngineRepository repository;

    public ExcelUploadHistoryActionController(ExcelUploadEngineService service,
            ExcelUploadEngineRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    public void handleGetHistory(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        try (Connection conn = ds.getConnection()) {
            List<Map<String, Object>> list = repository.getHistory(
                    conn,
                    (String) params.get("upload_id"),
                    (String) params.get("period"),
                    (String) params.get("result_status"),
                    (String) params.get("keyword"));
            result.put("status", "ok");
            result.put("list", list);
        }
    }

    public void handleGetHistoryDetail(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        String histId = (String) params.get("hist_id");
        String uploadId = (String) params.get("upload_id");
        if (histId == null || histId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "hist_id is required.");
            return;
        }
        try (Connection conn = ds.getConnection()) {
            log.info("[ExcelUpload] history detail lookup hist_id={}, upload_id={}",
                    histId.trim(), uploadId == null ? "" : uploadId.trim());
            Map<String, Object> row = repository.getHistoryDetail(conn, histId.trim(),
                    uploadId == null ? null : uploadId.trim());
            if (row == null) {
                result.put("status", "none");
                return;
            }
            List<Map<String, Object>> changes = repository.getUpdateAuditHistory(conn, histId.trim());
            row.put("change_history", changes);
            row.put("change_count", changes.size());
            result.put("status", "ok");
            result.put("row", row);
        }
    }

    @SuppressWarnings("unchecked")
    public void handleGetHistoryCompare(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        String leftHistId = (String) params.get("left_hist_id");
        String rightHistId = (String) params.get("right_hist_id");
        try (Connection conn = ds.getConnection()) {
            Map<String, Object> compare = repository.getHistoryCompare(conn, leftHistId, rightHistId);
            Map<String, Object> left = (Map<String, Object>) compare.get("left");
            Map<String, Object> right = (Map<String, Object>) compare.get("right");

            Map<String, Object> sectionDiffs = new LinkedHashMap<>();
            sectionDiffs.put("struct_json", buildSectionDiff("struct_json", left, right));
            sectionDiffs.put("mapping_json", buildSectionDiff("mapping_json", left, right));
            sectionDiffs.put("pre_sql_json", buildSectionDiff("pre_sql_json", left, right));
            sectionDiffs.put("post_sql_json", buildSectionDiff("post_sql_json", left, right));
            sectionDiffs.put("row_sql_json", buildSectionDiff("row_sql_json", left, right));

            compare.put("section_diffs", sectionDiffs);
            result.put("status", "ok");
            result.putAll(compare);
        }
    }

    private Map<String, Object> buildSectionDiff(String sectionKey, Map<String, Object> left,
            Map<String, Object> right) {
        String leftJson = left == null ? null : (String) left.get(sectionKey);
        String rightJson = right == null ? null : (String) right.get(sectionKey);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("section", sectionKey);

        if (leftJson == null || leftJson.trim().isEmpty()
                || rightJson == null || rightJson.trim().isEmpty()) {
            out.put("available", false);
            out.put("msg", "Source JSON is missing, so detail comparison is unavailable.");
            out.put("items", Collections.emptyList());
            out.put("added_cnt", 0);
            out.put("removed_cnt", 0);
            out.put("changed_cnt", 0);
            out.put("total_changes", 0);
            return out;
        }

        try {
            Object leftObj = service.parseJson(leftJson);
            Object rightObj = service.parseJson(rightJson);
            Map<String, String> leftFlat = new LinkedHashMap<>();
            Map<String, String> rightFlat = new LinkedHashMap<>();
            flattenJson(leftObj, "$", leftFlat);
            flattenJson(rightObj, "$", rightFlat);

            List<Map<String, Object>> items = new ArrayList<>();
            int addedCnt = 0;
            int removedCnt = 0;
            int changedCnt = 0;

            Set<String> allKeys = new TreeSet<>();
            allKeys.addAll(leftFlat.keySet());
            allKeys.addAll(rightFlat.keySet());

            for (String k : allKeys) {
                boolean inL = leftFlat.containsKey(k);
                boolean inR = rightFlat.containsKey(k);
                String lv = leftFlat.get(k);
                String rv = rightFlat.get(k);
                if (inL && !inR) {
                    removedCnt++;
                    if (items.size() < 200) {
                        items.add(diffItem("removed", k, lv, ""));
                    }
                } else if (!inL && inR) {
                    addedCnt++;
                    if (items.size() < 200) {
                        items.add(diffItem("added", k, "", rv));
                    }
                } else if (!Objects.equals(lv, rv)) {
                    changedCnt++;
                    if (items.size() < 200) {
                        items.add(diffItem("changed", k, lv, rv));
                    }
                }
            }

            out.put("available", true);
            out.put("items", items);
            out.put("added_cnt", addedCnt);
            out.put("removed_cnt", removedCnt);
            out.put("changed_cnt", changedCnt);
            out.put("total_changes", addedCnt + removedCnt + changedCnt);
            return out;
        } catch (Throwable e) {
            out.put("available", false);
            out.put("msg", "Source JSON parsing failed: " + e.getMessage());
            out.put("items", Collections.emptyList());
            out.put("added_cnt", 0);
            out.put("removed_cnt", 0);
            out.put("changed_cnt", 0);
            out.put("total_changes", 0);
            return out;
        }
    }

    private Map<String, Object> diffItem(String type, String path, String leftVal, String rightVal) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("type", type);
        item.put("path", path);
        item.put("left", shrink(leftVal, 240));
        item.put("right", shrink(rightVal, 240));
        return item;
    }

    private String shrink(String s, int max) {
        if (s == null) {
            return "";
        }
        String v = s.replace("\r", "\\r").replace("\n", "\\n");
        if (v.length() <= max) {
            return v;
        }
        return v.substring(0, max) + "...";
    }

    private void flattenJson(Object node, String path, Map<String, String> out) {
        if (node == null) {
            out.put(path, "null");
            return;
        }
        if (node instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) node;
            if (m.isEmpty()) {
                out.put(path, "{}");
                return;
            }
            for (Map.Entry<?, ?> e : m.entrySet()) {
                String k = String.valueOf(e.getKey());
                flattenJson(e.getValue(), path + "." + k, out);
            }
            return;
        }
        if (node instanceof List) {
            List<?> l = (List<?>) node;
            if (l.isEmpty()) {
                out.put(path, "[]");
                return;
            }
            for (int i = 0; i < l.size(); i++) {
                flattenJson(l.get(i), path + "[" + i + "]", out);
            }
            return;
        }
        out.put(path, String.valueOf(node));
    }
}
