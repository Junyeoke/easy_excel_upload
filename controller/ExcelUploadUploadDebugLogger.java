// ExcelUploadUploadDebugLogger.java
package com.steg.lit.controller;

import com.steg.lit.service.ExcelUploadEngineService;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Builds detailed debug logs for upload cascade plans.
 */
@Component
public class ExcelUploadUploadDebugLogger {

    private final ExcelUploadEngineService service;

    public ExcelUploadUploadDebugLogger(ExcelUploadEngineService service) {
        this.service = service;
    }

    @SuppressWarnings("unchecked")
    public void debugCascadePlan(
            org.apache.poi.ss.usermodel.Row row,
            List<?> structs,
            Map<?, ?> allMaps,
            String currentAlias,
            String parentIdPlaceholder,
            List<?> rowSqls,
            Map<String, Set<String>> metaMap,
            boolean keepEmptyValues,
            Consumer<String> addLog,
            int dataRowNum
    ) throws Exception {
        Map<String, Object> currentStruct = null;
        for (Object sObj : structs) {
            Map<String, Object> candidate = (Map<String, Object>) sObj;
            if (currentAlias.equals(candidate.get("alias"))) {
                currentStruct = candidate;
                break;
            }
        }
        if (currentStruct == null) {
            return;
        }

        String tableName = (String) currentStruct.get("table");
        Map<?, ?> aliasMap = (Map<?, ?>) allMaps.get(currentAlias);
        if (aliasMap == null) {
            aliasMap = new LinkedHashMap<>();
        }

        String generatedId = "<AUTO_ID:" + currentAlias + ":" + dataRowNum + ">";
        Map<String, Object> data = new LinkedHashMap<>();

        for (Map.Entry<?, ?> entry : aliasMap.entrySet()) {
            String dbCol = String.valueOf(entry.getKey());
            String mappingVal = String.valueOf(entry.getValue());
            if (mappingVal == null || mappingVal.trim().isEmpty() || "null".equals(mappingVal)) {
                continue;
            }
            if (!service.isValidSqlIdentifier(dbCol)) {
                continue;
            }

            if ("_AUTO_SEQ_".equals(mappingVal)) {
                data.put(dbCol, generatedId);
            } else if (isCurrentDateMapping(mappingVal)) {
                // 2026-06-20: 디버그 미리보기에서도 현재 날짜 특수값을 선택한 포맷으로 표시한다.
                data.put(dbCol, getCurrentDateValue(mappingVal));
            } else if ("_LOGIN_USER_".equals(mappingVal)) {
                // 2026-06-20: 실제 업로드 시 현재 로그인 사용자로 치환되는 컬럼임을 표시한다.
                data.put(dbCol, "<CURRENT_LOGIN_USER>");
            } else if ("_LOGIN_MTN_".equals(mappingVal)) {
                // 2026-06-20: 실제 업로드 시 현재 로그인 MTN으로 치환되는 컬럼임을 표시한다.
                data.put(dbCol, "<CURRENT_LOGIN_MTN>");
            } else if (mappingVal.startsWith("_FIXED_:")) {
                data.put(dbCol, mappingVal.substring(8));
            } else if (mappingVal.startsWith("_REPLACE_:")) {
                String[] parts = mappingVal.split(":", 3);
                int excelIdx = Integer.parseInt(parts[1]);
                String rawVal = service.getCellValue(row.getCell(excelIdx)).trim();
                String rulesStr = parts.length > 2 ? parts[2] : "";
                for (String rule : rulesStr.split("\\|\\|")) {
                    String[] kv = rule.split("==", 2);
                    if (kv.length == 2 && rawVal.equals(kv[0].trim())) {
                        rawVal = kv[1].trim();
                        break;
                    }
                }
                data.put(dbCol, rawVal);
            } else if (mappingVal.startsWith("_UNIQUE_:")) {
                int excelIdx = Integer.parseInt(mappingVal.split(":", 2)[1]);
                data.put(dbCol, service.getCellValue(row.getCell(excelIdx)).trim());
            } else {
                int excelIdx = Integer.parseInt(mappingVal);
                data.put(dbCol, service.getCellValue(row.getCell(excelIdx)));
            }
        }

        String pkCol = (String) currentStruct.get("pk_col");
        if (pkCol != null && !pkCol.trim().isEmpty()) {
            data.put(pkCol, generatedId);
        }
        String fkCol = (String) currentStruct.get("fk");
        if (parentIdPlaceholder != null && fkCol != null && !fkCol.trim().isEmpty()) {
            data.put(fkCol, parentIdPlaceholder);
        }

        List<String> upsertKeys = new ArrayList<>();
        Object upsertKeysObj = currentStruct.get("upsert_keys");
        if (upsertKeysObj instanceof List) {
            for (Object k : (List<?>) upsertKeysObj) {
                String key = String.valueOf(k).trim();
                if (!key.isEmpty() && service.isValidSqlIdentifier(key)) {
                    upsertKeys.add(key);
                }
            }
        }

        addLog.accept("  >> alias=" + currentAlias
                + ", table=" + safeLogValue(tableName)
                + (pkCol != null && !pkCol.trim().isEmpty() ? ", pk=" + pkCol : "")
                + (fkCol != null && !fkCol.trim().isEmpty() ? ", fk=" + fkCol : "")
                + (!upsertKeys.isEmpty() ? ", upsertKeys=" + upsertKeys : ""));
        addLog.accept("    - column mapping: " + formatDebugMap(data));

        Set<String> numericColumns = metaMap.get(tableName);
        if (tableName != null && service.isValidSqlIdentifier(tableName) && !data.isEmpty()) {
            try {
                Object[] insertSqlInfo = service.makeInsertSql(tableName, data, numericColumns);
                String insertSql = (String) insertSqlInfo[0];
                String[] insertParams = (String[]) insertSqlInfo[1];
                addLog.accept("    - INSERT SQL: " + safeLogValue(insertSql));
                addLog.accept("    - INSERT PARAM ORDER: " + Arrays.toString(insertParams));
            } catch (Throwable insertEx) {
                addLog.accept("    - INSERT SQL build failed: " + safeLogValue(insertEx.getMessage()));
            }

            if (!upsertKeys.isEmpty()) {
                try {
                    Object[] updateSqlInfo = service.makeUpdateSql(tableName, data, upsertKeys, numericColumns, keepEmptyValues);
                    String updateSql = (String) updateSqlInfo[0];
                    List<String> updateParams = (List<String>) updateSqlInfo[1];
                    addLog.accept("    - UPDATE SQL: " + safeLogValue(updateSql));
                    addLog.accept("    - UPDATE PARAM ORDER: " + updateParams);
                } catch (Throwable updateEx) {
                    addLog.accept("    - UPDATE SQL build failed: " + safeLogValue(updateEx.getMessage()));
                }
            }
        }

        if (rowSqls != null && !rowSqls.isEmpty()) {
            Map<String, String> tokens = new LinkedHashMap<>();
            tokens.put("ALIAS", currentAlias);
            tokens.put("TABLE", tableName == null ? "" : tableName);
            tokens.put("PK_COL", pkCol == null ? "" : pkCol);
            tokens.put("NEW_ID", generatedId);
            tokens.put("PARENT_ID", parentIdPlaceholder == null ? "" : parentIdPlaceholder);
            if (row != null) {
                for (int ci = 0; ci < row.getLastCellNum(); ci++) {
                    tokens.put("COL_" + ci, service.getCellValue(row.getCell(ci)));
                }
            }
            for (Map.Entry<String, Object> de : data.entrySet()) {
                tokens.put(de.getKey(), de.getValue() == null ? "" : String.valueOf(de.getValue()));
            }
            int rowSqlIdx = 1;
            for (Object obj : rowSqls) {
                if (!(obj instanceof Map)) {
                    continue;
                }
                String sql = (String) ((Map<?, ?>) obj).get("sql");
                if (sql == null || sql.trim().isEmpty()) {
                    continue;
                }
                String resolved = service.replaceTokens(sql.trim(), tokens).trim();
                addLog.accept("    - ROW SQL #" + rowSqlIdx + ": " + safeLogValue(resolved));
                rowSqlIdx++;
            }
        }

        for (Object sObj : structs) {
            Map<String, Object> childStruct = (Map<String, Object>) sObj;
            if (currentAlias.equals(childStruct.get("parent"))) {
                debugCascadePlan(
                        row,
                        structs,
                        allMaps,
                        (String) childStruct.get("alias"),
                        generatedId,
                        rowSqls,
                        metaMap,
                        keepEmptyValues,
                        addLog,
                        dataRowNum
                );
            }
        }
    }

    private String formatDebugMap(Map<String, Object> map) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : map.entrySet()) {
            if (!first) {
                sb.append(", ");
            }
            sb.append(entry.getKey()).append("=").append(safeLogValue(entry.getValue()));
            first = false;
        }
        sb.append("}");
        return sb.toString();
    }

    // 2026-06-20: 디버그 미리보기에서 지원하는 현재 날짜 특수값 여부를 판별한다.
    private boolean isCurrentDateMapping(String mappingVal) {
        return "_CURRENT_DTM_COMPACT_".equals(mappingVal)
                || "_CURRENT_DATE_COMPACT_".equals(mappingVal)
                || "_CURRENT_DATE_".equals(mappingVal)
                || "_CURRENT_DATETIME_MIN_".equals(mappingVal)
                || "_CURRENT_DATETIME_SEC_".equals(mappingVal);
    }

    // 2026-06-20: 디버그 미리보기용 현재 날짜 값을 선택한 포맷으로 생성한다.
    private String getCurrentDateValue(String mappingVal) {
        String pattern = "yyyy-MM-dd";
        if ("_CURRENT_DTM_COMPACT_".equals(mappingVal)) {
            pattern = "yyyyMMddHHmmss";
        } else if ("_CURRENT_DATE_COMPACT_".equals(mappingVal)) {
            pattern = "yyyyMMdd";
        } else if ("_CURRENT_DATETIME_MIN_".equals(mappingVal)) {
            pattern = "yyyy-MM-dd HH:mm";
        } else if ("_CURRENT_DATETIME_SEC_".equals(mappingVal)) {
            pattern = "yyyy-MM-dd HH:mm:ss";
        }
        return new java.text.SimpleDateFormat(pattern).format(new java.util.Date());
    }

    private String safeLogValue(Object value) {
        if (value == null) {
            return "null";
        }
        String s = String.valueOf(value)
                .replace("\r", "\\r")
                .replace("\n", "\\n")
                .replace("\t", "\\t");
        if (s.length() > 160) {
            return s.substring(0, 160) + "...(" + s.length() + " chars)";
        }
        return s;
    }
}
