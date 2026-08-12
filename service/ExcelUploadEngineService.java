// ExcelUploadEngineService.java
package com.steg.lit.service;

import com.steg.lit.repository.ExcelUploadEngineRepository;  // 추�?

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.*;
import java.sql.*;
import java.util.*;

/**
 * =====================================================================
 * [ExcelUploadEngineService]
 * ??��: ?��? ?�로??관??모든 비즈?�스 로직???�당?�니??
 *   - ?��? ?�일 ?�싱 / ?� �?추출
 *   - 계층??Cascade INSERT / UPSERT 처리
 *   - Batch ?�행 / ?�류 추적 / ?�류 리포???�성
 *   - Pre/Post/Row SQL ?�행
 *   - JSON ?�싱 / 직렬??
 *   - Base64 ?�코??�?문자???�틸
 * =====================================================================
 */
@Service
public class ExcelUploadEngineService {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadEngineService.class);
    private static final Logger sqlLog = LoggerFactory.getLogger("com.steg.sql");

    private static final int BATCH_SIZE = 5000;
    private static final String SQL_TEXT_CACHE_PREFIX = "_SQL_TEXT_";

    private final ExcelUploadEngineRepository repository;

    public ExcelUploadEngineService(ExcelUploadEngineRepository repository) {
        this.repository = repository;
    }

    private void cacheSqlText(Map<String, Object> psCache, String key, String sql) {
        if (psCache == null || key == null || sql == null) {
            return;
        }
        psCache.put(SQL_TEXT_CACHE_PREFIX + key, sql);
    }

    private String getCachedSqlText(Map<String, Object> psCache, String key) {
        if (psCache == null || key == null) {
            return null;
        }
        Object sql = psCache.get(SQL_TEXT_CACHE_PREFIX + key);
        return sql == null ? null : String.valueOf(sql);
    }

    private void logPreparedSql(String sql, List<?> params) {
        if (sql == null || sql.trim().isEmpty()) {
            return;
        }
        sqlLog.info(renderSql(sql.trim(), params));
    }

    private void logPlainSql(String sql) {
        if (sql == null || sql.trim().isEmpty()) {
            return;
        }
        sqlLog.info(sql.trim());
    }

    private String renderSql(String sql, List<?> params) {
        if (sql == null || params == null || params.isEmpty()) {
            return sql;
        }
        StringBuilder out = new StringBuilder(sql.length() + (params.size() * 16));
        int paramIndex = 0;
        for (int i = 0; i < sql.length(); i++) {
            char ch = sql.charAt(i);
            if (ch == '?' && paramIndex < params.size()) {
                out.append(toSqlLiteral(params.get(paramIndex++)));
            } else {
                out.append(ch);
            }
        }
        return out.toString();
    }

    private String toSqlLiteral(Object value) {
        if (value == null) {
            return "NULL";
        }
        if (value instanceof Number || value instanceof Boolean) {
            return String.valueOf(value);
        }
        String text = String.valueOf(value)
                .replace("'", "''")
                .replace("\r", "\\r")
                .replace("\n", "\\n");
        if (text.length() > 500) {
            text = text.substring(0, 500) + "...";
        }
        return "'" + text + "'";
    }

    // =====================================================================
    // 1. ?��? ?�일 ?�싱 ?�틸
    // =====================================================================

    /**
     * Cell ?�??문자??반환 (POI 버전 ?�환)
     *
     * ??[Fix] 기존 ?�일 메서??캐싱 버그 ?�정
     * - ?�상/?�식???�는 ?�?� ?��? 구현 ?�래?��? ?��? ???�음
     *   (XSSFCell, XSSFFormulaEvaluatingCell ??
     * - �?번째 ?� ?�래?�로 캐싱??Method�??�른 ?�래???�스?�스??invoke?�면
     *   IllegalArgumentException 발생 ??catch?�서 "BLANK" 반환 ??�?무시
     * - ?�래?�별�?Method�?캐싱?�도�??�정
     */
    private final java.util.concurrent.ConcurrentHashMap<String, java.lang.reflect.Method>
        _cellTypeMethodCache = new java.util.concurrent.ConcurrentHashMap<>();

    public String getCellTypeStr(org.apache.poi.ss.usermodel.Cell cell) {
        try {
            String className = cell.getClass().getName();
            java.lang.reflect.Method m = _cellTypeMethodCache.computeIfAbsent(
                className, k -> {
                    try { return cell.getClass().getMethod("getCellType"); }
                    catch (Throwable e) { return null; }
                });
            if (m == null) return "BLANK";
            Object typeObj = m.invoke(cell);
            String raw = String.valueOf(typeObj);
            if ("NUMERIC".equals(raw)  || "0".equals(raw)) return "NUMERIC";
            if ("STRING".equals(raw)   || "1".equals(raw)) return "STRING";
            if ("FORMULA".equals(raw)  || "2".equals(raw)) return "FORMULA";
            if ("BLANK".equals(raw)    || "3".equals(raw)) return "BLANK";
            if ("BOOLEAN".equals(raw)  || "4".equals(raw)) return "BOOLEAN";
            if ("ERROR".equals(raw)    || "5".equals(raw)) return "ERROR";
            return "BLANK";
        } catch (Throwable e) { return "BLANK"; }
    }

    /**
     * ?� �?문자??반환
     *
     * ??[Fix] ?�상/배경???� ?�식 강화
     * - getCellTypeStr 캐싱 버그 ?�정?�로 ?�식 ?� ?�???�상 ?�식
     * - DataFormatter �?추�? ?�백?�로 ?�용??커스?� ?�자 ?�맷
     *   ([Red]0, [??]#,##0 ?????�용???�??�?추출 가??
     * - 리치?�스??글?�별 ?�상) ?�??getStringCellValue()�??�스???�상 반환
     */
    public String getCellValue(org.apache.poi.ss.usermodel.Cell cell) {
        if (cell == null) return "";
        try {
            String typeStr = getCellTypeStr(cell);

            if ("STRING".equals(typeStr)) {
                // 리치?�스??글?�별 ?�상 ?�용)??getStringCellValue()�?plain text 반환
                return cell.getStringCellValue();
            }

            if ("NUMERIC".equals(typeStr)) {
                if (org.apache.poi.ss.usermodel.DateUtil.isCellDateFormatted(cell)) {
                    return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(cell.getDateCellValue());
                }
                double dVal = cell.getNumericCellValue();
                // ??커스?� ?�자 ?�맷([Red]0 ?????�용???�: DataFormatter�??�시�??�기 ??
                //    ?�자�?추출 ?�도, ?�패?�면 ?�시 ?�자�??�용
                try {
                    org.apache.poi.ss.usermodel.DataFormatter df =
                        new org.apache.poi.ss.usermodel.DataFormatter();
                    String formatted = df.formatCellValue(cell).trim();
                    if (!formatted.isEmpty() && !"0".equals(formatted)) {
                        // ?�맷 문자?�에???�상 코드([Red],[Blue] ?? ?�거 ??반환
                        formatted = formatted.replaceAll("^\\[.*?\\]", "").trim();
                        if (!formatted.isEmpty()) return formatted;
                    }
                } catch (Throwable ignore) {}
                if (dVal == (long) dVal) return String.format("%d", (long) dVal);
                return String.valueOf(dVal);
            }

            if ("BOOLEAN".equals(typeStr)) return String.valueOf(cell.getBooleanCellValue());

            if ("FORMULA".equals(typeStr)) {
                // ??FormulaEvaluator�??�식 결과값을 직접 ?��?
                try {
                    org.apache.poi.ss.usermodel.FormulaEvaluator evaluator =
                        cell.getSheet().getWorkbook().getCreationHelper().createFormulaEvaluator();
                    org.apache.poi.ss.usermodel.CellValue evaluated = evaluator.evaluate(cell);
                    if (evaluated == null) return "";
                    String evalType = String.valueOf(evaluated.getCellType());
                    if ("NUMERIC".equals(evalType) || "0".equals(evalType)) {
                        double v = evaluated.getNumberValue();
                        if (org.apache.poi.ss.usermodel.DateUtil.isCellDateFormatted(cell)) {
                            return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss")
                                .format(org.apache.poi.ss.usermodel.DateUtil.getJavaDate(v));
                        }
                        return v == (long) v ? String.format("%d", (long) v) : String.valueOf(v);
                    }
                    if ("STRING".equals(evalType)  || "1".equals(evalType)) return evaluated.getStringValue();
                    if ("BOOLEAN".equals(evalType) || "4".equals(evalType)) return String.valueOf(evaluated.getBooleanValue());
                    // ?��? ?�에???�??불명?�하�?DataFormatter�?마�?�??�도
                    try {
                        org.apache.poi.ss.usermodel.DataFormatter df =
                            new org.apache.poi.ss.usermodel.DataFormatter();
                        String formatted = df.formatCellValue(cell, evaluator).trim();
                        if (!formatted.isEmpty()) return formatted;
                    } catch (Throwable ignore) {}
                    return "";
                } catch (Throwable evalEx) {
                    // FormulaEvaluator ?�패 ???�시값으�??�백
                    try { return cell.getStringCellValue(); } catch (Throwable ig) {}
                    try {
                        double v = cell.getNumericCellValue();
                        return v == (long) v ? String.format("%d", (long) v) : String.valueOf(v);
                    } catch (Throwable ig) {}
                }
            }
        } catch (Exception e) { return ""; }
        return "";
    }

    public org.apache.poi.ss.usermodel.Workbook createWorkbook(byte[] fileBytes) throws Exception {
        java.io.ByteArrayInputStream bis = new java.io.ByteArrayInputStream(fileBytes);
        try {
            return org.apache.poi.ss.usermodel.WorkbookFactory.create(bis);
        } catch (Throwable e) {
            throw new Exception("?��? ?�일???????�습?�다: " + e.getMessage());
        }
    }

    public org.apache.poi.ss.usermodel.Workbook createNewXlsxWorkbook() throws Exception {
        try { return new org.apache.poi.xssf.usermodel.XSSFWorkbook(); }
        catch (Throwable e) {
            try {
                Class<?> cls = Class.forName("org.apache.poi.xssf.usermodel.XSSFWorkbook");
                return (org.apache.poi.ss.usermodel.Workbook) cls.getDeclaredConstructor().newInstance();
            } catch (Throwable ex) { throw new Exception("XSSFWorkbook ?�성 ?�패"); }
        }
    }

    public void closeWorkbook(org.apache.poi.ss.usermodel.Workbook wb) {
        if (wb == null) return;
        try { wb.getClass().getMethod("close").invoke(wb); } catch (Throwable ignore) {}
    }

    // =====================================================================
    // 2. 계층??Cascade INSERT / UPSERT (?�심 로직)
    // =====================================================================

    @SuppressWarnings("unchecked")
    public void cascadeExcelInsert(
            Connection conn, org.apache.poi.ss.usermodel.Row row, List<?> structs, Map<?, ?> allMaps,
            String currentAlias, String parentId, Object iceObj, Object ukeyObj,
            Map<String, Set<String>> metaMap, List<?> rowSqls,
            Map<String, Object> psCache, Map<String, List<String>> sqlParamOrderCache,
            ExcelUploadEngineRepository.FastSequenceManager seqMgr,
            boolean keepEmptyValues
    ) throws Exception {

        // ?�재 alias???�당?�는 struct ?�색
        Map<String, Object> currentStruct = null;
        for (Object sObj : structs) {
            Map<String, Object> candidate = (Map<String, Object>) sObj;
            if (currentAlias.equals(candidate.get("alias"))) { currentStruct = candidate; break; }
        }
        if (currentStruct == null) return;

        String tableName = (String) currentStruct.get("table");
        if (!isValidSqlIdentifier(tableName)) throw new Exception("Invalid table name: " + tableName);

        Map<?, ?> aliasMap = (Map<?, ?>) allMaps.get(currentAlias);
        if (aliasMap == null) aliasMap = new java.util.LinkedHashMap<>();

        // ?�?� ?�데?�트 ??컬럼 ?�싱 ?�?�
        // struct??"upsert_keys": ["col1","col2"] ?�태�?지??
        List<String> upsertKeys = new ArrayList<>();
        Object upsertKeysObj = currentStruct.get("upsert_keys");
        if (upsertKeysObj instanceof List) {
            for (Object k : (List<?>) upsertKeysObj) {
                String ks = String.valueOf(k).trim();
                if (!ks.isEmpty() && isValidSqlIdentifier(ks)) upsertKeys.add(ks);
            }
        }
        boolean isUpsertMode = !upsertKeys.isEmpty();

        // ?�?� ?�규 PK 채번 ?�?�
        Map<String, Object> data = new HashMap<>();
        String newId = "", entityId = (String) currentStruct.get("ent_id");
        if (entityId == null || entityId.trim().isEmpty()) {
            String entCacheKey = "_ENT_ID_:" + tableName;
            entityId = (String) psCache.get(entCacheKey);
            if (entityId == null) {
                String fetched = repository.getEntityIdByTableName(conn, tableName);
                entityId = fetched != null ? fetched : "";
                psCache.put(entCacheKey, entityId);
            }
        }

        if (entityId != null && !entityId.trim().isEmpty()) {
            try {
                newId = seqMgr.getNextId(entityId);
            } catch (Exception se) {
                try {
                    java.lang.reflect.Method getEnt = (java.lang.reflect.Method) psCache.get("_ICE_ENT_METHOD_");
                    Object mapObj = psCache.get("_ICE_MAP_OBJ_");
                    if (getEnt != null && mapObj != null) {
                        Object entObj = getEnt.invoke(mapObj, entityId);
                        if (entObj != null) newId = (String) entObj.getClass().getMethod("fetchNewKey").invoke(entObj);
                    }
                } catch (Throwable iceEx) {
                    log.info("[ExcelUpload] ICE 채번 ?�패 (UniqueKey�??�백): entityId={}, err={}", entityId, iceEx.getMessage());
                }
            }
        }
        if (newId == null || newId.trim().isEmpty()) {
            try {
                java.lang.reflect.Method ukeyFetch = (java.lang.reflect.Method) psCache.get("_UKEY_METHOD_");
                if (ukeyFetch != null) newId = (String) ukeyFetch.invoke(ukeyObj);
            } catch (Throwable ukEx) {
                log.error("[ExcelUpload] ??UniqueKey 채번 ?�패 - PK ?�성 불�?: {}", ukEx.getMessage());
                throw new Exception("PK 채번 ?�류: " + ukEx.getMessage());
                // ???�기??throw???��? - ?�별 catch(Exception rowEx)?�서 ?��? ?�별 ?�류�??�시??
            }
        }

        // ?�?� 컬럼 매핑 처리 ?�?�
        for (Map.Entry<?, ?> entry : aliasMap.entrySet()) {
            String dbCol    = (String) entry.getKey();
            String mappingVal = String.valueOf(entry.getValue());
            if (mappingVal == null || mappingVal.trim().isEmpty() || "null".equals(mappingVal)) continue;
            if (!isValidSqlIdentifier(dbCol)) throw new Exception("Invalid dest column: [" + dbCol + "]");

            if ("_AUTO_SEQ_".equals(mappingVal)) {
                data.put(dbCol, newId);
            } else if (isCurrentDateMapping(mappingVal)) {
                // 2026-06-20: 관리자 컬럼 매핑의 현재 날짜 특수값을 선택한 포맷으로 치환한다.
                data.put(dbCol, getCurrentDateValue(mappingVal));
            } else if ("_LOGIN_USER_".equals(mappingVal)) {
                // 2026-06-20: 관리자 컬럼 매핑의 현재 로그인 사용자 특수값을 업로드 요청값으로 치환한다.
                data.put(dbCol, getRuntimeMappingValue(psCache, "_LOGIN_USER_"));
            } else if ("_LOGIN_MTN_".equals(mappingVal)) {
                // 2026-06-20: 관리자 컬럼 매핑의 현재 로그인 MTN 특수값을 업로드 요청값으로 치환한다.
                data.put(dbCol, getRuntimeMappingValue(psCache, "_LOGIN_MTN_"));
            } else if (mappingVal.startsWith("_FIXED_:")) {
                data.put(dbCol, mappingVal.substring(8));
            } else if (mappingVal.startsWith("_REPLACE_:")) {
                String[] parts = mappingVal.split(":", 3);
                int excelIdx = Integer.parseInt(parts[1]);
                String rawVal = getCellValue(row.getCell(excelIdx)).trim();
                String rulesStr = parts.length > 2 ? parts[2] : "";
                for (String rule : rulesStr.split("\\|\\|")) {
                    String[] kv = rule.split("==", 2);
                    if (kv.length == 2 && rawVal.equals(kv[0].trim())) { rawVal = kv[1].trim(); break; }
                }
                data.put(dbCol, rawVal);
            } else if (mappingVal.startsWith("_UNIQUE_:")) {
                int excelIdx = Integer.parseInt(mappingVal.split(":", 2)[1]);
                String rawVal = getCellValue(row.getCell(excelIdx)).trim();
                if (!rawVal.isEmpty()) {
                    Map<String, Integer> uTrack = (Map<String, Integer>) psCache.get("_UNIQUE_TRACKER_");
                    if (uTrack == null) { uTrack = new HashMap<>(); psCache.put("_UNIQUE_TRACKER_", uTrack); }
                    String tKey = currentAlias + "." + dbCol + "::" + rawVal;
                    Integer cnt = uTrack.get(tKey);
                    if (cnt == null) { uTrack.put(tKey, 1); data.put(dbCol, rawVal); }
                    else { uTrack.put(tKey, cnt + 1); data.put(dbCol, rawVal + " (" + cnt + ")"); }
                } else { data.put(dbCol, ""); }
            } else {
                int excelIdx = Integer.parseInt(mappingVal);
                data.put(dbCol, getCellValue(row.getCell(excelIdx)));
            }
        }

        // ?�?� PK / FK ?�팅 ?�?�
        String pkCol = (String) currentStruct.get("pk_col");
        if (pkCol != null && !pkCol.trim().isEmpty()) {
            if (!isValidSqlIdentifier(pkCol)) throw new Exception("Invalid PK column: [" + pkCol + "]");
            // upsert 모드????PK??UPDATE 분기?�서 ?�용 ????(??채번 불필??
            if (!isUpsertMode) {
                data.put(pkCol, newId);
            }
        }
        if (parentId != null) {
            String fkCol = (String) currentStruct.get("fk");
            if (fkCol != null && !fkCol.isEmpty()) {
                if (!isValidSqlIdentifier(fkCol)) throw new Exception("Invalid FK column: [" + fkCol + "]");
                data.put(fkCol, parentId);
            }
        }
        boolean recordExists = false;
        if (isUpsertMode) {
            recordExists = checkRecordExists(conn, tableName, upsertKeys, data, psCache);
        }
        String cascadeRecordId = newId;
        if (isUpsertMode && recordExists && pkCol != null && !pkCol.trim().isEmpty()) {
            // 2026-08-12 이준혁: 기존 행 UPDATE 시 자식 FK에 신규 채번값이 넘어가지 않도록 실제 PK를 사용한다.
            cascadeRecordId = resolveExistingRecordId(conn, tableName, pkCol, upsertKeys, data);
        }

        // ?�?� 컬럼 ?�약 ?�전 검�?(DB ?�송 ??모든 ?�류 컬럼 ?��?) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�
        if (!data.isEmpty()) {
            Map<String, Object> colConstraints = (Map<String, Object>) psCache.get("_COL_CONSTRAINTS_:" + tableName);
            if (colConstraints == null) {
                colConstraints = repository.getColumnConstraints(conn, tableName);
                psCache.put("_COL_CONSTRAINTS_:" + tableName, colConstraints);
                log.info("[ExcelUpload][PreValid] \uC774\uC804 '{}' \uCEF4\uB7FC \uC81C\uC57D \uB85C\uB4DC \uC644\uB8CC - lengths={}, notnulls={}",
                        tableName,
                        ((Map<?,?>)colConstraints.get("lengths")).size(),
                        ((Set<?>)colConstraints.get("notnulls")).size());
            }
            @SuppressWarnings("unchecked")
            Map<String, Integer> colLengths  = (Map<String, Integer>) colConstraints.get("lengths");
            @SuppressWarnings("unchecked")
            Set<String>          colNotNulls = (Set<String>)          colConstraints.get("notnulls");

            List<String> colErrors = new ArrayList<>();
            for (Map.Entry<String, Object> entry : data.entrySet()) {
                String colLower = entry.getKey().toLowerCase();
                // String.length() = Java 문자 ??(character count, not bytes)
                // colLengths??maxLen??getPrecision() 기�? character count
                String val = entry.getValue() == null ? "" : String.valueOf(entry.getValue()).trim();

                // 길이 초과 검??(문자 ??기�?)
                if (colLengths != null) {
                    Integer maxLen = colLengths.get(colLower);
                    if (maxLen != null && maxLen > 0 && val.length() > maxLen) {
                        log.info("[ExcelUpload][PreValid] 길이 초과 감�?: col={}, maxLen={}, inputLen={}", colLower, maxLen, val.length());
                        colErrors.add(entry.getKey() + ":길이초과(최대" + maxLen + "자,입력" + val.length() + "자)");
                    }
                }
                // NOT NULL 검??(PK/FK 컬럼?� ?�스???�성?��?�??�외)
                if (colNotNulls != null && colNotNulls.contains(colLower)) {
                    boolean isPkOrFk = colLower.equals(
                            currentStruct.get("pk_col") != null ? ((String)currentStruct.get("pk_col")).toLowerCase() : "__none__")
                            || (parentId != null && colLower.equals(
                            currentStruct.get("fk") != null ? ((String)currentStruct.get("fk")).toLowerCase() : "__none__"));
                    boolean preserveExistingValue = keepEmptyValues && isUpsertMode && recordExists && val.isEmpty();
                    if (!isPkOrFk && val.isEmpty() && !preserveExistingValue) {
                        log.info("[ExcelUpload][PreValid] NOT NULL ?�반 감�?: col={}", colLower);
                        colErrors.add(entry.getKey() + ":NOT_NULL");
                    }
                }
            }
            if (!colErrors.isEmpty()) {
                throw new Exception("[MULTI_COL] " + String.join("|", colErrors));
            }
        }


        // ?�?� UPSERT 분기 처리 ?�?�
        if (!data.isEmpty()) {

            if (isUpsertMode) {
                if (recordExists) {
                    // ?�?�?� UPDATE 경로 ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
                    String updCacheKey = "UPD::" + tableName + "::" + currentAlias + "::" + (keepEmptyValues ? "KEEP_EMPTY" : "OVERWRITE");
                    PreparedStatement updPs = (PreparedStatement) psCache.get(updCacheKey);
                    List<String> updParamOrder = sqlParamOrderCache.get(updCacheKey);

                    if (updPs == null) {
                        Set<String> numericColumns = metaMap.get(tableName);
                        Object[] sqlInfo = makeUpdateSql(tableName, data, upsertKeys, numericColumns, keepEmptyValues);
                        String updateSql = (String) sqlInfo[0];
                        updPs = conn.prepareStatement(updateSql);
                        psCache.put(updCacheKey, updPs);
                        cacheSqlText(psCache, updCacheKey, updateSql);
                        updParamOrder = (List<String>) sqlInfo[1];
                        sqlParamOrderCache.put(updCacheKey, updParamOrder);
                        log.info("[ExcelUpload][UPDATE] Statement Cached - SQL: {}", updateSql);
                    }

                    Set<String> numericColumns = metaMap.get(tableName);
                    for (int pi = 0; pi < updParamOrder.size(); pi++) {
                        String col = updParamOrder.get(pi);
                        String val = data.get(col) == null ? "" : String.valueOf(data.get(col));
                        val = val.trim();
                        if (!keepEmptyValues && val.isEmpty() && numericColumns != null && numericColumns.contains(col.toLowerCase())) val = "0";
                        updPs.setString(pi + 1, val);
                    }
                    List<String> updLogParams = new ArrayList<>();
                    for (String col : updParamOrder) {
                        updLogParams.add(data.get(col) == null ? null : String.valueOf(data.get(col)).trim());
                    }
                    logPreparedSql(getCachedSqlText(psCache, updCacheKey), updLogParams);
                    Map<String, Object> updateAudit = buildUpdateAudit(conn, tableName, upsertKeys,
                            data, numericColumns, keepEmptyValues, row, psCache);
                    updPs.addBatch();

                    // 배치 ?�래커에 UPDATE ???�록
                    Map<String, List<org.apache.poi.ss.usermodel.Row>> batchTracker =
                        (Map<String, List<org.apache.poi.ss.usermodel.Row>>) psCache.get("_BATCH_TRACKER_");
                    if (batchTracker == null) {
                        batchTracker = new java.util.LinkedHashMap<>();
                        psCache.put("_BATCH_TRACKER_", batchTracker);
                    }
                    List<org.apache.poi.ss.usermodel.Row> rowQueue = batchTracker.get(updCacheKey);
                    if (rowQueue == null) { rowQueue = new ArrayList<>(); batchTracker.put(updCacheKey, rowQueue); }
                    rowQueue.add(row);

                    Map<String, List<Map<String, Object>>> auditTracker =
                            (Map<String, List<Map<String, Object>>>) psCache.get("_UPDATE_AUDIT_TRACKER_");
                    if (auditTracker == null) {
                        auditTracker = new LinkedHashMap<>();
                        psCache.put("_UPDATE_AUDIT_TRACKER_", auditTracker);
                    }
                    List<Map<String, Object>> auditQueue = auditTracker.get(updCacheKey);
                    if (auditQueue == null) {
                        auditQueue = new ArrayList<>();
                        auditTracker.put(updCacheKey, auditQueue);
                    }
                    // 2026-08-12 이준혁: 배치 결과 순서와 맞추기 위해 변경이 없는 UPDATE도 null로 자리를 유지한다.
                    auditQueue.add(updateAudit);

                    log.info("[ExcelUpload][UPDATE] ?�코???�데?�트 배치 ?�록 ?�료 (?? {})", upsertKeys);

                } else {
                    // ?�?�?� INSERT 경로 (?�규) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
                    // ?�규 INSERT ?�에??PK 채번�??�팅
                    if (pkCol != null && !pkCol.trim().isEmpty()) {
                        data.put(pkCol, newId);
                    }
                    addInsertBatch(conn, tableName, currentAlias, pkCol, newId, data, metaMap, psCache, sqlParamOrderCache, row);
                    log.info("[ExcelUpload][INSERT] \uCD08\uae30 \uC778\uc2a4\ud134\uc2a4 \ubc30\uce58 \ub4f1\ub85d (upsert \ubaa8\ub4dc)");
                }

            } else {
                // ?�?�?� ?�수 INSERT 경로 (기존 ?�작) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
                addInsertBatch(conn, tableName, currentAlias, pkCol, newId, data, metaMap, psCache, sqlParamOrderCache, row);
            }

            // ?�시 ???�이�?기록 (INSERT ?�에�??��? ?�음)
            if (!isUpsertMode && pkCol != null && !pkCol.trim().isEmpty() && newId != null && !newId.trim().isEmpty()) {
                repository.insertTempUploadKey(conn, currentAlias, tableName, pkCol, newId, psCache);
            }

            // Row-SQL 배치 추�?
            if (rowSqls != null && !rowSqls.isEmpty()) {
                Map<String, String> tokens = new HashMap<>();
                tokens.put("ALIAS",     currentAlias);
                tokens.put("TABLE",     tableName);
                tokens.put("PK_COL",    pkCol == null ? "" : pkCol);
                tokens.put("NEW_ID",    cascadeRecordId == null ? "" : cascadeRecordId);
                tokens.put("PARENT_ID", parentId == null ? "" : parentId);
                if (row != null) {
                    for (int ci = 0; ci < row.getLastCellNum(); ci++) {
                        tokens.put("COL_" + ci, getCellValue(row.getCell(ci)));
                    }
                }
                for (Map.Entry<String, Object> de : data.entrySet()) {
                    tokens.put(de.getKey(), de.getValue() == null ? "" : String.valueOf(de.getValue()));
                }
                try {
                    Statement rowStmt = (Statement) psCache.get("_ROW_SQL_STMT_");
                    if (rowStmt == null) { rowStmt = conn.createStatement(); psCache.put("_ROW_SQL_STMT_", rowStmt); }
                    for (Object obj : rowSqls) {
                        Map<?, ?> sqlObj = (Map<?, ?>) obj;
                        String sql = (String) sqlObj.get("sql");
                        if (sql != null && !sql.trim().isEmpty()) {
                            String trimmedSql = replaceTokens(sql.trim(), tokens).trim();
                            if (!trimmedSql.startsWith("--")) {
                                logPlainSql(trimmedSql);
                                rowStmt.addBatch(trimmedSql);
                            }
                        }
                    }
                } catch (Throwable rowSqlEx) {
                    throw new Exception("Row-SQL 쿼리 배치 추�? ?�류 (NEW_ID=" + newId + "): " + rowSqlEx.getMessage());
                }
            }
        }

        // ?�?� ?�식 구조 ?��? 처리 ?�?�
        for (Object sObj : structs) {
            Map<String, Object> s = (Map<String, Object>) sObj;
            if (currentAlias.equals(s.get("parent"))) {
                cascadeExcelInsert(conn, row, structs, allMaps, (String) s.get("alias"),
                        cascadeRecordId, iceObj, ukeyObj, metaMap, rowSqls, psCache, sqlParamOrderCache, seqMgr, keepEmptyValues);
            }
        }
    }

    private String resolveExistingRecordId(Connection conn, String tableName, String pkCol,
            List<String> upsertKeys, Map<String, Object> data) throws Exception {
        Object mappedPk = data.get(pkCol);
        if (mappedPk != null && !String.valueOf(mappedPk).trim().isEmpty()) {
            return String.valueOf(mappedPk).trim();
        }

        StringBuilder sql = new StringBuilder("SELECT ").append(pkCol)
                .append(" FROM ").append(tableName).append(" WHERE ");
        for (int i = 0; i < upsertKeys.size(); i++) {
            if (i > 0) sql.append(" AND ");
            sql.append(upsertKeys.get(i)).append(" = ?");
        }
        try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
            for (int i = 0; i < upsertKeys.size(); i++) {
                Object value = data.get(upsertKeys.get(i));
                ps.setString(i + 1, value == null ? "" : String.valueOf(value).trim());
            }
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    String existingId = rs.getString(1);
                    if (existingId != null && !existingId.trim().isEmpty()) return existingId.trim();
                }
            }
        }
        throw new Exception("기존 행의 PK를 확인할 수 없습니다: " + tableName + "." + pkCol);
    }

    /**
     * [?��? ?�퍼] INSERT 배치????추�? (공통??
     */
    @SuppressWarnings("unchecked")
    private void addInsertBatch(
            Connection conn, String tableName, String currentAlias,
            String pkCol, String newId, Map<String, Object> data,
            Map<String, Set<String>> metaMap,
            Map<String, Object> psCache,
            Map<String, List<String>> sqlParamOrderCache,
            org.apache.poi.ss.usermodel.Row row
    ) throws Exception {
        String cacheKey = tableName + "::" + currentAlias;
        PreparedStatement ps = (PreparedStatement) psCache.get(cacheKey);
        List<String> paramOrder = sqlParamOrderCache.get(cacheKey);

        if (ps == null) {
            Set<String> numericColumns = metaMap.get(tableName);
            Object[] sqlInfo = makeInsertSql(tableName, data, numericColumns);
            String insertSql = (String) sqlInfo[0];
            ps = conn.prepareStatement(insertSql);
            psCache.put(cacheKey, ps);
            cacheSqlText(psCache, cacheKey, insertSql);
            paramOrder = new ArrayList<>(data.keySet());
            sqlParamOrderCache.put(cacheKey, paramOrder);
            log.info("[ExcelUpload][INSERT] Statement Cached - SQL: {}", insertSql);
        }

        Set<String> numericColumns = metaMap.get(tableName);
        for (int pi = 0; pi < paramOrder.size(); pi++) {
            String col = paramOrder.get(pi);
            String val = data.get(col) == null ? "" : String.valueOf(data.get(col));
            val = val.trim();
            if (val.isEmpty() && numericColumns != null && numericColumns.contains(col.toLowerCase())) val = "0";
            ps.setString(pi + 1, val);
        }
        List<String> insertLogParams = new ArrayList<>();
        for (String col : paramOrder) {
            insertLogParams.add(data.get(col) == null ? null : String.valueOf(data.get(col)).trim());
        }
        logPreparedSql(getCachedSqlText(psCache, cacheKey), insertLogParams);
        ps.addBatch();

        // Row 추적 (배치 ?�류 ?�별??
        Map<String, List<org.apache.poi.ss.usermodel.Row>> batchTracker =
            (Map<String, List<org.apache.poi.ss.usermodel.Row>>) psCache.get("_BATCH_TRACKER_");
        if (batchTracker == null) {
            batchTracker = new java.util.LinkedHashMap<>();
            psCache.put("_BATCH_TRACKER_", batchTracker);
        }
        List<org.apache.poi.ss.usermodel.Row> rowQueue = batchTracker.get(cacheKey);
        if (rowQueue == null) { rowQueue = new ArrayList<>(); batchTracker.put(cacheKey, rowQueue); }
        rowQueue.add(row);
    }

    /**
     * [?�규] DB???�당 ??값으�??�코?��? 존재?�는지 ?�인?�니??
     * 존재 ?�인??PreparedStatement??"_CHK_" ?�두?�로 캐싱?�여
     * flushBatch ??배치 ?�행 ?�?�에???�외?�니??
     */
    private Map<String, Object> buildUpdateAudit(
            Connection conn, String tableName, List<String> upsertKeys,
            Map<String, Object> data, Set<String> numericColumns, boolean keepEmptyValues,
            org.apache.poi.ss.usermodel.Row row, Map<String, Object> psCache
    ) throws Exception {
        List<String> selectedColumns = new ArrayList<>(data.keySet());
        if (selectedColumns.isEmpty()) return null;

        StringBuilder sql = new StringBuilder("SELECT ");
        sql.append(String.join(", ", selectedColumns)).append(" FROM ").append(tableName).append(" WHERE ");
        for (int i = 0; i < upsertKeys.size(); i++) {
            if (i > 0) sql.append(" AND ");
            sql.append(upsertKeys.get(i)).append(" = ?");
        }

        Map<String, Object> existing = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
            for (int i = 0; i < upsertKeys.size(); i++) {
                Object keyValue = data.get(upsertKeys.get(i));
                ps.setString(i + 1, keyValue == null ? "" : String.valueOf(keyValue).trim());
            }
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                for (String col : selectedColumns) existing.put(col, rs.getObject(col));
            }
        }

        Map<String, Object> keys = new LinkedHashMap<>();
        Map<String, Object> before = new LinkedHashMap<>();
        Map<String, Object> after = new LinkedHashMap<>();
        List<String> changedColumns = new ArrayList<>();
        for (String key : upsertKeys) keys.put(key, existing.get(key));

        for (String col : selectedColumns) {
            if (upsertKeys.contains(col)) continue;
            Object oldObject = existing.get(col);
            String oldValue = oldObject == null ? "" : String.valueOf(oldObject);
            String requested = data.get(col) == null ? "" : String.valueOf(data.get(col)).trim();
            String effective = requested;
            if (keepEmptyValues && requested.isEmpty()) effective = oldValue;
            if (!keepEmptyValues && requested.isEmpty()
                    && numericColumns != null && numericColumns.contains(col.toLowerCase(Locale.ROOT))) {
                effective = "0";
            }
            if (!Objects.equals(oldValue, effective)) {
                changedColumns.add(col);
                before.put(col, oldObject);
                after.put(col, effective);
            }
        }
        if (changedColumns.isEmpty()) return null;

        Map<String, Object> audit = new LinkedHashMap<>();
        audit.put("hist_id", contextValue(psCache, "_AUDIT_HIST_ID_"));
        audit.put("upload_id", contextValue(psCache, "_AUDIT_UPLOAD_ID_"));
        audit.put("job_id", contextValue(psCache, "_AUDIT_JOB_ID_"));
        audit.put("table_name", tableName);
        audit.put("key_json", toAuditJson(keys));
        audit.put("before_json", toAuditJson(before));
        audit.put("after_json", toAuditJson(after));
        audit.put("changed_columns_json", toAuditJson(changedColumns));
        audit.put("excel_row_no", row == null ? 0 : row.getRowNum() + 1);
        audit.put("updated_emp_id", contextValue(psCache, "_AUDIT_UPDATED_EMP_ID_"));
        return audit;
    }

    private String contextValue(Map<String, Object> context, String key) {
        Object value = context == null ? null : context.get(key);
        return value == null ? "" : String.valueOf(value).trim();
    }

    private String toAuditJson(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return String.valueOf(value);
        if (value instanceof Map) {
            StringBuilder out = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                if (!first) out.append(',');
                out.append(toAuditJson(String.valueOf(entry.getKey()))).append(':').append(toAuditJson(entry.getValue()));
                first = false;
            }
            return out.append('}').toString();
        }
        if (value instanceof Iterable) {
            StringBuilder out = new StringBuilder("[");
            boolean first = true;
            for (Object item : (Iterable<?>) value) {
                if (!first) out.append(',');
                out.append(toAuditJson(item));
                first = false;
            }
            return out.append(']').toString();
        }
        String text = String.valueOf(value);
        StringBuilder escaped = new StringBuilder(text.length() + 2).append('"');
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            switch (ch) {
                case '"': escaped.append("\\\""); break;
                case '\\': escaped.append("\\\\"); break;
                case '\b': escaped.append("\\b"); break;
                case '\f': escaped.append("\\f"); break;
                case '\n': escaped.append("\\n"); break;
                case '\r': escaped.append("\\r"); break;
                case '\t': escaped.append("\\t"); break;
                default:
                    if (ch < 0x20) escaped.append(String.format("\\u%04x", (int) ch));
                    else escaped.append(ch);
            }
        }
        return escaped.append('"').toString();
    }

    @SuppressWarnings("unchecked")
    private boolean checkRecordExists(
            Connection conn, String tableName,
            List<String> keyCols, Map<String, Object> data,
            Map<String, Object> psCache
    ) {
        // ??컬럼 �??�나?�도 값이 ?�으�?존재 ?�인 불�? ??INSERT�?처리
        for (String keyCol : keyCols) {
            Object val = data.get(keyCol);
            if (val == null || String.valueOf(val).trim().isEmpty()) {
                log.info("[ExcelUpload][UPSERT] \uB370\uC774\uD130\uC14B \uAD6C\uC131 \uCEF4\uB7FC '{}' \uAC12\uC774 \uBE44\uC5B4\uC11C INSERT\uB85C \uCC98\uB9AC\uD569\uB2C8\uB2E4.", keyCol);
                return false;
            }
        }

        // 캐시 ?? "_CHK_" ?�두????flushBatch?�서 ?�동 ?�외??
        String chkKey = "_CHK_" + tableName + "_" + String.join("_", keyCols);
        try {
            PreparedStatement chkPs = (PreparedStatement) psCache.get(chkKey);
            String chkSql = getCachedSqlText(psCache, chkKey);
            if (chkPs == null) {
                StringBuilder whereSb = new StringBuilder();
                for (int i = 0; i < keyCols.size(); i++) {
                    if (i > 0) whereSb.append(" AND ");
                    whereSb.append(keyCols.get(i)).append(" = ?");
                }
                chkSql = "SELECT COUNT(*) FROM " + tableName + " WHERE " + whereSb;
                chkPs = conn.prepareStatement(chkSql);
                psCache.put(chkKey, chkPs);
                cacheSqlText(psCache, chkKey, chkSql);
                log.info("[ExcelUpload][UPSERT] \uC874\uC7AC \uD655\uC778 SQL \uCE90\uC2F1: {}", chkSql);
            }

            for (int i = 0; i < keyCols.size(); i++) {
                String val = String.valueOf(data.get(keyCols.get(i))).trim();
                chkPs.setString(i + 1, val);
            }
            List<String> chkLogParams = new ArrayList<>();
            for (String keyCol : keyCols) {
                chkLogParams.add(data.get(keyCol) == null ? null : String.valueOf(data.get(keyCol)).trim());
            }
            logPreparedSql(chkSql, chkLogParams);

            try (ResultSet rs = chkPs.executeQuery()) {
                return rs.next() && rs.getInt(1) > 0;
            }
        } catch (Exception e) {
            log.info("[ExcelUpload][UPSERT] \uC874\uC7AC \uD655\uC778 \uC2E4\uD328 (INSERT\uB85C \uCC98\uB9AC): {}", e.getMessage());
            return false;
        }
    }

    // =====================================================================
    // 2-1. ?�로????검�??�용 (DB ?�???�음)
    // =====================================================================
    @SuppressWarnings("unchecked")
    public void validateCascadeRow(
            Connection conn,
            org.apache.poi.ss.usermodel.Row row,
            List<?> structs,
            Map<?, ?> allMaps,
            String currentAlias,
            String parentId,
            Map<String, Object> validateCache
    ) throws Exception {
        Map<String, Object> currentStruct = null;
        for (Object sObj : structs) {
            Map<String, Object> candidate = (Map<String, Object>) sObj;
            if (currentAlias.equals(candidate.get("alias"))) {
                currentStruct = candidate;
                break;
            }
        }
        if (currentStruct == null) return;

        String tableName = (String) currentStruct.get("table");
        if (!isValidSqlIdentifier(tableName)) throw new Exception("Invalid table name: " + tableName);

        Map<?, ?> aliasMap = (Map<?, ?>) allMaps.get(currentAlias);
        if (aliasMap == null) aliasMap = new LinkedHashMap<>();

        Map<String, Object> data = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : aliasMap.entrySet()) {
            String dbCol = String.valueOf(entry.getKey());
            if (!isValidSqlIdentifier(dbCol)) throw new Exception("Invalid dest column: [" + dbCol + "]");

            String mappingVal = String.valueOf(entry.getValue());
            if (mappingVal == null || mappingVal.trim().isEmpty() || "null".equals(mappingVal)) continue;

            data.put(dbCol, resolveMappingValueForValidation(row, mappingVal.trim()));
        }

        String pkCol = (String) currentStruct.get("pk_col");
        if (pkCol != null && !pkCol.trim().isEmpty()) data.put(pkCol, "__AUTO__");
        if (parentId != null) {
            String fkCol = (String) currentStruct.get("fk");
            if (fkCol != null && !fkCol.trim().isEmpty()) data.put(fkCol, parentId);
        }

        Map<String, Object> colConstraints = (Map<String, Object>) validateCache.get("_VAL_COL_CONSTRAINTS_:" + tableName);
        if (colConstraints == null) {
            colConstraints = repository.getColumnConstraints(conn, tableName);
            validateCache.put("_VAL_COL_CONSTRAINTS_:" + tableName, colConstraints);
        }
        Map<String, Integer> colLengths = (Map<String, Integer>) colConstraints.get("lengths");
        Set<String> colNotNulls = (Set<String>) colConstraints.get("notnulls");

        List<String> colErrors = new ArrayList<>();
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            String colLower = entry.getKey().toLowerCase();
            String val = entry.getValue() == null ? "" : String.valueOf(entry.getValue()).trim();

            if (colLengths != null) {
                Integer maxLen = colLengths.get(colLower);
                if (maxLen != null && maxLen > 0 && val.length() > maxLen) {
                    colErrors.add(entry.getKey() + ":길이초과(최대" + maxLen + "자,입력" + val.length() + "자)");
                }
            }
            if (colNotNulls != null && colNotNulls.contains(colLower)) {
                boolean isPkOrFk = colLower.equals(pkCol != null ? pkCol.toLowerCase() : "__none__")
                        || (parentId != null && colLower.equals(
                                currentStruct.get("fk") != null ? String.valueOf(currentStruct.get("fk")).toLowerCase() : "__none__"));
                if (!isPkOrFk && val.isEmpty()) {
                    colErrors.add(entry.getKey() + ":NOT_NULL");
                }
            }
        }
        if (!colErrors.isEmpty()) throw new Exception("[MULTI_COL] " + String.join("|", colErrors));

        for (Object sObj : structs) {
            Map<String, Object> child = (Map<String, Object>) sObj;
            String parentAlias = String.valueOf(child.get("parent"));
            String childAlias = String.valueOf(child.get("alias"));
            if (currentAlias.equals(parentAlias)
                    && childAlias != null && !childAlias.trim().isEmpty()
                    && !currentAlias.equals(childAlias)) {
                validateCascadeRow(conn, row, structs, allMaps, childAlias, "__PARENT__", validateCache);
            }
        }
    }

    private String resolveMappingValueForValidation(org.apache.poi.ss.usermodel.Row row, String mappingVal) throws Exception {
        if ("_AUTO_SEQ_".equals(mappingVal)) return "__AUTO__";
        // 2026-06-20: 시스템 매핑값은 엑셀 인덱스가 아니므로 검증 단계에서 대표값으로 치환한다.
        if (isCurrentDateMapping(mappingVal)) return getCurrentDateValue(mappingVal);
        if ("_LOGIN_USER_".equals(mappingVal) || "_LOGIN_MTN_".equals(mappingVal)) return "__SYSTEM__";
        if (mappingVal.startsWith("_FIXED_:")) return mappingVal.substring(8);

        if (mappingVal.startsWith("_REPLACE_:")) {
            String[] parts = mappingVal.split(":", 3);
            if (parts.length < 3) return "";
            int excelIdx = parseExcelIndex(parts[1]);
            String rawVal = getCellValue(row.getCell(excelIdx)).trim();
            String rulesStr = parts[2];
            for (String rule : rulesStr.split("\\|\\|")) {
                String[] kv = rule.split("==", 2);
                if (kv.length == 2 && rawVal.equals(kv[0].trim())) {
                    rawVal = kv[1].trim();
                    break;
                }
            }
            return rawVal;
        }

        if (mappingVal.startsWith("_UNIQUE_:")) {
            int excelIdx = parseExcelIndex(mappingVal.split(":", 2)[1]);
            return getCellValue(row.getCell(excelIdx)).trim();
        }

        int excelIdx = parseExcelIndex(mappingVal);
        return getCellValue(row.getCell(excelIdx)).trim();
    }

    // 2026-06-20: 관리자 컬럼 매핑의 현재 날짜 특수값 여부를 판별한다.
    private boolean isCurrentDateMapping(String mappingVal) {
        return "_CURRENT_DTM_COMPACT_".equals(mappingVal)
                || "_CURRENT_DATE_COMPACT_".equals(mappingVal)
                || "_CURRENT_DATE_".equals(mappingVal)
                || "_CURRENT_DATETIME_MIN_".equals(mappingVal)
                || "_CURRENT_DATETIME_SEC_".equals(mappingVal);
    }

    // 2026-06-20: 관리자 컬럼 매핑의 현재 날짜 특수값을 선택한 날짜 포맷으로 제공한다.
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

    // 2026-06-20: 업로드 요청 시 캐시에 담아둔 로그인 사용자/MTN 값을 컬럼 매핑에 사용한다.
    private String getRuntimeMappingValue(Map<String, Object> psCache, String key) {
        if (psCache == null || key == null) {
            return "";
        }
        Object value = psCache.get(key);
        return value == null ? "" : String.valueOf(value).trim();
    }

    private int parseExcelIndex(String raw) throws Exception {
        try {
            return Integer.parseInt(raw.trim());
        } catch (Throwable e) {
            throw new Exception("Invalid excel column index: " + raw);
        }
    }

    // =====================================================================
    // 3. Batch ?�행 / 캐시 ?�리
    // =====================================================================

    @SuppressWarnings("unchecked")
    public void flushBatch(
            Connection conn,
            Map<String, Object> psCache,
            List<org.apache.poi.ss.usermodel.Row> errorRows,
            List<String> errorMsgs,
            int[] counters  // [0]=?�공 증분, [1]=?�패 증분
    ) throws Exception {
        Map<String, List<org.apache.poi.ss.usermodel.Row>> batchTracker =
            (Map<String, List<org.apache.poi.ss.usermodel.Row>>) psCache.get("_BATCH_TRACKER_");
        Map<String, List<Map<String, Object>>> auditTracker =
            (Map<String, List<Map<String, Object>>>) psCache.get("_UPDATE_AUDIT_TRACKER_");

        for (Map.Entry<String, Object> entry : psCache.entrySet()) {
            String key = entry.getKey();

            // "_CHK_" ?�두???�는 존재 ?�인??PS ??배치 ?�행 ?�외
            if (key.startsWith("_CHK_")) continue;

            // 기�? ?��? 캐시 ???�외 (기존 ?�작 ?��?)
            if (key.startsWith("_") && !key.equals("_TMP_KEY_PS_") && !key.equals("_ROW_SQL_STMT_")) continue;

            Object obj = entry.getValue();
            List<org.apache.poi.ss.usermodel.Row> trackedRows = (batchTracker != null) ? batchTracker.get(key) : null;
            List<Map<String, Object>> trackedAudits = (auditTracker != null) ? auditTracker.get(key) : null;

            if (obj instanceof PreparedStatement) {
                PreparedStatement ps = (PreparedStatement) obj;

                if ("_TMP_KEY_PS_".equals(key)) {
                    try {
                        ps.executeBatch();
                    } catch (Throwable ignore) {
                        log.info("[ExcelUpload] _TMP_KEY_PS_ 배치 ?�행 �?무시???�류: {}", ignore.getMessage());
                    }
                    continue;
                }

                // UPD:: ?�두???��?�?INSERT/UPDATE 구분 로그 출력
                boolean isUpdateBatch = key.startsWith("UPD::");

                try {
                    int[] updateCounts = ps.executeBatch();
                    counters[0] += (trackedRows != null) ? trackedRows.size() : updateCounts.length;
                    if (isUpdateBatch) persistSuccessfulUpdateAudits(conn, trackedAudits, updateCounts);
                    if (isUpdateBatch) log.info("[ExcelUpload] UPDATE 배치 {}�??�료", updateCounts.length);

                } catch (java.sql.BatchUpdateException bue) {
                    int[] updateCounts = bue.getUpdateCounts();
                    String batchType = isUpdateBatch ? "UPDATE" : "INSERT";
                    log.error("[ExcelUpload] BatchUpdateException [{}][{}] - updateCounts 길이={}, ?�체 ????{}",
                            batchType, key, updateCounts.length, trackedRows != null ? trackedRows.size() : "unknown");

                    if (trackedRows != null) {
                        for (int idx = 0; idx < trackedRows.size(); idx++) {
                            if (idx < updateCounts.length) {
                                if (updateCounts[idx] == Statement.EXECUTE_FAILED) {
                                    // 명확???�패
                                    counters[1]++;
                                    errorRows.add(trackedRows.get(idx));
                                    errorMsgs.add(batchType + " 배치 ?�패: " + bue.getMessage());
                                    log.error("[ExcelUpload] ??배치 ??{}번째 ???�패 (EXECUTE_FAILED): {}", idx + 1, bue.getMessage());
                                } else {
                                    // SUCCESS_NO_INFO(-2) ?�함, 0 초과 ???�공?�로 처리
                                    counters[0]++;
                                }
                            } else {
                                // updateCounts 배열 범위 �????�라?�버가 중단?�여 미실?�된 ??
                                counters[1]++;
                                errorRows.add(trackedRows.get(idx));
                                errorMsgs.add(batchType + " 배치 ?�행 ?�류�?취소 (미실??: " + bue.getMessage());
                                log.info("[ExcelUpload] ??배치 ??{}번째 ?��? ?�행 ?�류�?취소 처리", idx + 1);
                            }
                        }
                    } else {
                        // ??[Fix] trackedRows==null: ???�정?� 불�??��?�?카운??메시지??기록
                        counters[1]++;
                        errorRows.add(null); // null placeholder - failedRowMsgMap 루프?�서 null 체크??
                        errorMsgs.add("배치 ?�패 (???�정 불�?): " + bue.getMessage());
                        log.error("[ExcelUpload] ??배치 ?�류 (Row 추적 ?�음): {}", bue.getMessage());
                    }
                    if (isUpdateBatch) persistSuccessfulUpdateAudits(conn, trackedAudits, updateCounts);

                } catch (UpdateAuditPersistenceException e) {
                    throw e;
                } catch (Throwable e) {
                    String errMsg = (e.getMessage() != null) ? e.getMessage() : e.toString();
                    log.error("[ExcelUpload] ??executeBatch() 미분�??�류 [{}]: {}", key, errMsg);
                    if (trackedRows != null) {
                        for (org.apache.poi.ss.usermodel.Row r : trackedRows) {
                            counters[1]++;
                            errorRows.add(r);
                            errorMsgs.add("배치 ?�행 ?�류: " + errMsg);
                        }
                    } else {
                        // ??[Fix] trackedRows==null: ???�정 불�??��?�?카운??메시지 기록
                        counters[1]++;
                        errorRows.add(null); // null placeholder
                        errorMsgs.add("배치 ?�행 ?�류 (???�정 불�?): " + errMsg);
                        log.error("[ExcelUpload] ??배치 ?�류 (Row 추적 ?�음): {}", errMsg);
                    }
                }

            } else if (obj instanceof Statement) {
                try {
                    ((Statement) obj).executeBatch();
                }
                catch (Throwable e) {
                    log.error("[ExcelUpload] ??Row-SQL Statement 배치 ?�행 ?�류 [{}]: {}", key, e.getMessage());
                    counters[1]++;
                    errorRows.addAll(trackedRows != null ? trackedRows : java.util.Collections.emptyList());
                    errorMsgs.add("Row-SQL 배치 ?�행 ?�류: " + e.getMessage());
                }
            }

            if (batchTracker != null) batchTracker.remove(key);
            if (auditTracker != null) auditTracker.remove(key);
        }
    }

    private void persistSuccessfulUpdateAudits(Connection conn, List<Map<String, Object>> audits,
            int[] updateCounts) throws UpdateAuditPersistenceException {
        if (audits == null || audits.isEmpty() || updateCounts == null) return;
        List<Map<String, Object>> successful = new ArrayList<>();
        int count = Math.min(audits.size(), updateCounts.length);
        for (int i = 0; i < count; i++) {
            int result = updateCounts[i];
            if (result != Statement.EXECUTE_FAILED && result != 0 && audits.get(i) != null) {
                successful.add(audits.get(i));
            }
        }
        if (successful.isEmpty()) return;
        try {
            repository.insertUpdateAudits(conn, successful);
        } catch (Exception e) {
            throw new UpdateAuditPersistenceException("업데이트 변경 이력 저장에 실패했습니다: " + e.getMessage(), e);
        }
    }

    private static final class UpdateAuditPersistenceException extends Exception {
        private UpdateAuditPersistenceException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public void closeCache(Map<String, Object> psCache) {
        for (Map.Entry<String, Object> entry : psCache.entrySet()) {
            Object obj = entry.getValue();
            if (obj instanceof PreparedStatement) try { ((PreparedStatement) obj).close(); } catch (Throwable ignore) {}
            else if (obj instanceof Statement)   try { ((Statement) obj).close();           } catch (Throwable ignore) {}
        }
        psCache.clear();
    }

    // =====================================================================
    // 4. SQL ?�틸
    // =====================================================================

    public Object[] makeInsertSql(String tableName, Map<String, Object> data, Set<String> numericColumns) throws Exception {
        if (!isValidSqlIdentifier(tableName)) throw new Exception("Invalid target table name: " + tableName);
        StringBuilder columns = new StringBuilder(), values = new StringBuilder();
        List<String> params = new ArrayList<>();
        int i = 0;
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            String key = entry.getKey();
            if (!isValidSqlIdentifier(key)) throw new Exception("Invalid column name: " + key);
            String val = entry.getValue() == null ? "" : String.valueOf(entry.getValue());
            val = val.trim();
            if (val.isEmpty() && numericColumns != null && numericColumns.contains(key.toLowerCase())) val = "0";
            if (i++ > 0) { columns.append(","); values.append(","); }
            columns.append(key);
            values.append("?");
            params.add(val);
        }
        return new Object[]{ "INSERT INTO " + tableName + " (" + columns + ") VALUES (" + values + ")", params.toArray(new String[0]) };
    }

    /**
     * [?�규] UPDATE SQL ?�성
     * SET: upsertKeys�??�외???�머지 컬럼
     * WHERE: upsertKeys 컬럼
     *
     * @return Object[]{sql문자?? paramOrder(List<String>)}
     *         paramOrder = [SET 컬럼??..] + [WHERE 컬럼??..]
     */
    public Object[] makeUpdateSql(String tableName, Map<String, Object> data,
                                   List<String> upsertKeys, Set<String> numericColumns,
                                   boolean keepEmptyValues) throws Exception {
        if (!isValidSqlIdentifier(tableName)) throw new Exception("Invalid target table name: " + tableName);

        StringBuilder setSb = new StringBuilder();
        List<String> paramOrder = new ArrayList<>();

        // SET ?? upsertKeys �?pk_col???�외??컬럼
        boolean firstSet = true;
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            String col = entry.getKey();
            if (upsertKeys.contains(col)) continue;     // WHERE ?�는 SET?�서 ?�외
            if (!isValidSqlIdentifier(col)) throw new Exception("Invalid column: " + col);
            if (!firstSet) setSb.append(", ");
            if (keepEmptyValues) {
                setSb.append(col).append(" = COALESCE(NULLIF(?, ''), ").append(col).append(")");
            } else {
                setSb.append(col).append(" = ?");
            }
            paramOrder.add(col);
            firstSet = false;
        }

        if (setSb.length() == 0) {
            throw new Exception("UPDATE ?�??SET 컬럼???�습?�다. upsert_keys ?�에 매핑??컬럼???�어???�니??");
        }

        // WHERE ??
        StringBuilder whereSb = new StringBuilder();
        for (int i = 0; i < upsertKeys.size(); i++) {
            String col = upsertKeys.get(i);
            if (!isValidSqlIdentifier(col)) throw new Exception("Invalid upsert key column: " + col);
            if (i > 0) whereSb.append(" AND ");
            whereSb.append(col).append(" = ?");
            paramOrder.add(col);  // WHERE ?�라미터??SET ?�라미터 ?�에 ?�치
        }

        String sql = "UPDATE " + tableName + " SET " + setSb + " WHERE " + whereSb;
        return new Object[]{ sql, paramOrder };
    }

    public void executeSqlArray(Connection conn, List<?> sqlArray, String sqlType) throws Exception {
        if (sqlArray == null) return;
        try (Statement stmt = conn.createStatement()) {
            for (Object obj : sqlArray) {
                Map<?, ?> sqlObj = (Map<?, ?>) obj;
                String sql = (String) sqlObj.get("sql");
                if (sql != null && !sql.trim().isEmpty()) {
                    String trimmedSql = sql.trim();
                    if (!trimmedSql.startsWith("--")) {
                        log.info("[ExcelUpload] {} ?�행: {}", sqlType, trimmedSql);
                        logPlainSql(trimmedSql);
                        stmt.execute(trimmedSql);
                    }
                }
            }
        }
    }

    public String replaceTokens(String sql, Map<String, String> tokens) {
        if (sql == null) return "";
        String out = sql;
        if (tokens != null) {
            for (Map.Entry<String, String> entry : tokens.entrySet()) {
                out = out.replace("${" + entry.getKey() + "}", entry.getValue() == null ? "" : entry.getValue());
            }
        }
        return out;
    }

    // =====================================================================
    // 5. ?�류 리포???�성
    // =====================================================================

    /**
     * DB ?�류 메시지?�서 문제가 ??컬럼명을 ?�나 추출?�니?? (?�위 ?�환??
     * ?��??�으�?extractAllErrorColumnNames�??�출?�니??
     */
    public String extractErrorColumnName(String msg) {
        List<String> cols = extractAllErrorColumnNames(msg);
        return cols.isEmpty() ? null : cols.get(0);
    }

    /**
     * DB ?�류 메시지?�서 문제가 ??컬럼�?목록 ?�체�?추출?�니??
     *
     * 지???�턴:
     *   [MULTI_COL] col1:길이초과(...)|col2:?�수값누?? ???�전 검�??�류
     *   MySQL  - Column 'col' cannot be null
     *   MySQL  - Data too long for column 'col'
     *   MySQL  - Incorrect integer/datetime value: '...' for column 'col' at row N
     *   PostgreSQL - null value in column "col" of relation
     *   Oracle ORA-12899 - value too large for column "TBL"."COL"
     *   Oracle ORA-01400 / generic - column "col"
     */
    public List<String> extractAllErrorColumnNames(String msg) {
        if (msg == null) return Collections.emptyList();
        List<String> result = new ArrayList<>();

        // ?�?� [MULTI_COL] col1:길이초과(...)|col2:?�수값누???�식 ?�?�
        if (msg.startsWith("[MULTI_COL]")) {
            String body = msg.substring("[MULTI_COL]".length()).trim();
            for (String part : body.split("\\|")) {
                String colPart = part.trim();
                int colon = colPart.indexOf(':');
                if (colon > 0) {
                    result.add(colPart.substring(0, colon).trim());
                }
            }
            if (!result.isEmpty()) return result;
        }

        java.util.regex.Matcher m;
        // MySQL: Column 'col' cannot be null
        m = java.util.regex.Pattern.compile("Column '([^']+)' cannot be null",
                java.util.regex.Pattern.CASE_INSENSITIVE).matcher(msg);
        if (m.find()) { result.add(m.group(1)); return result; }
        // MySQL: Data too long for column 'col'
        m = java.util.regex.Pattern.compile("Data too long for column '([^']+)'",
                java.util.regex.Pattern.CASE_INSENSITIVE).matcher(msg);
        if (m.find()) { result.add(m.group(1)); return result; }
        // MySQL: Incorrect ... value: '...' for column 'col' at row N
        m = java.util.regex.Pattern.compile("for column '([^']+)' at row",
                java.util.regex.Pattern.CASE_INSENSITIVE).matcher(msg);
        if (m.find()) { result.add(m.group(1)); return result; }
        // PostgreSQL: null value in column "col"
        m = java.util.regex.Pattern.compile("null value in column \"([^\"]+)\"",
                java.util.regex.Pattern.CASE_INSENSITIVE).matcher(msg);
        if (m.find()) { result.add(m.group(1)); return result; }
        // Oracle ORA-12899: value too large for column "TBL"."COL"
        m = java.util.regex.Pattern.compile("column \"[^\"]+\"\\.\"([^\"]+)\"",
                java.util.regex.Pattern.CASE_INSENSITIVE).matcher(msg);
        if (m.find()) { result.add(m.group(1)); return result; }
        // Oracle/generic: column "col"
        m = java.util.regex.Pattern.compile("column \"([^\"]+)\"",
                java.util.regex.Pattern.CASE_INSENSITIVE).matcher(msg);
        if (m.find()) { result.add(m.group(1)); return result; }
        // Generic fallback: column 'col'
        m = java.util.regex.Pattern.compile("[Cc]olumn '([^']+)'").matcher(msg);
        if (m.find()) { result.add(m.group(1)); return result; }

        return result;
    }

    /**
     * ?�스???�류 메시지�??�용??친화?�인 ?�내문으�?변?�합?�다.
     * @return String[2] ??[0] ?�반 ?�내 메시지, [1] ?�결 방법
     */
    public String[] translateErrorForReport(String msg) {
        if (msg == null || msg.trim().isEmpty()) {
            return new String[]{ "?????�는 ?�류", "관리자?�게 문의?�주?�요." };
        }
        String friendly, solution;

        // ?�?� [MULTI_COL] ?�전 검�??�류 (길이초과 / ?�수값누???? ?�?�?�?�?�?�?�?�?�?�?�?�?�?�
        if (msg.startsWith("[MULTI_COL]")) {
            String body = msg.substring("[MULTI_COL]".length()).trim();
            StringBuilder detail = new StringBuilder();
            for (String part : body.split("\\|")) {
                String p = part.trim();
                int colon = p.indexOf(':');
                if (colon > 0) {
                    String col = p.substring(0, colon).trim();
                    String err = p.substring(colon + 1).trim();
                    if (detail.length() > 0) detail.append(" / ");
                    detail.append("[").append(col).append("] ").append(err);
                }
            }
            friendly = "?�력 ?�이???�류: " + detail;
            solution = "빨간 박스�??�시???�??값을 ?�인?�여 ?�식?�나 길이�?맞춘 ???�업로드?�세??";
            return new String[]{ friendly, solution };
        }

        if (msg.contains("cannot be null") || msg.contains("NOT NULL constraint") || msg.contains("null value in column")) {
            friendly = "?�수 ??��(비워?�면 ???�는 �???비어 ?�습?�다.";
            solution = "?�당 ?�에 �?칸이 ?�는지 ?�인?�거?? 반드???�력?�야 ?�는 컬럼???�락?��? ?�았?��? ?��??�세??";
        } else if (msg.contains("Duplicate entry") || msg.contains("unique constraint") || msg.contains("ORA-00001") || msg.contains("duplicate key")) {
            friendly = "?��? ?�록??중복 ?�이?�입?�다.";
            solution = "?��? ?�일 ?�에 같�? ID가 ??�??�상 ?�거?? ?��? ?�스?�에 ?�록???�이?��? 겹칩?�다.";
        } else if (msg.contains("Data too long") || msg.contains("value too large") || msg.contains("ORA-12899") || msg.contains("data would be truncated")) {
            friendly = "?�력???�이?��? ?�용 길이�?초과?�습?�다.";
            solution = "?�당 ?�??값이 DB 컬럼?�서 ?�용?�는 최�? 글???�보??깁니?? ?�용??줄여주세??";
        } else if (msg.contains("Incorrect integer value") || msg.contains("invalid number") || msg.contains("ORA-01722") || msg.contains("invalid input syntax for type")) {
            friendly = "?�자 ?�식???�못?�었?�니??";
            solution = "?�자�??�력?�야 ?�는 칸에 문자???�수기호가 ?�함?�어 ?�는지 ?�인?�세??";
        } else if (msg.contains("Incorrect datetime value") || msg.contains("invalid date") || msg.contains("ORA-01858") || msg.contains("date/time field value out of range")) {
            friendly = "?�짜 ?�식???�바르�? ?�습?�다.";
            solution = "?�짜 칸의 ?�식???�스???�구 ?�식(?? yyyy-MM-dd)�??�릅?�다. ?��??�서 ?�짜 ?�식???�인?�세??";
        } else if (msg.contains("foreign key constraint") || msg.contains("ORA-02291") || msg.contains("violates foreign key")) {
            friendly = "참조?�는 ?�위 ?�이?��? 존재?��? ?�습?�다.";
            solution = "?�력??코드??ID가 ?�결???�른 ?�이블에 먼�? ?�록?�어 ?�어???�니?? ?�이???�서�??�인?�세??";
        } else if (msg.contains("SQL syntax") || msg.contains("bad SQL grammar") || msg.contains("ORA-00907")) {
            friendly = "?�정??SQL 구문???�류가 ?�습?�다.";
            solution = "관리자?�게 Row-SQL ?�는 Pre/Post-SQL ?�정 ?��????�청?�세??";
        } else if (msg.contains("배치 ?�행 ?�류�??�해 취소")) {
            friendly = "?�일 배치 ???�른 ?�의 ?�류�??�해 ?�께 취소?�었?�니??";
            solution = "같�? 묶음(배치)?�서 ?�선 ?�에 ?�류가 발생?????�도 처리?��? ?�았?�니?? ?�류 ?�을 먼�? ?�정 ???�업로드?�세??";
        } else if (msg.contains("SEQ_NOT_FOUND")) {
            friendly = "채번 ?�퀀???�정??찾을 ???�습?�다.";
            solution = "관리자?�게 ?�퀀??SEQ) ?�정 ?�록???�청?�세??";
        } else if (msg.contains("Invalid table") || msg.contains("Invalid column") || msg.contains("ORA-00942")) {
            friendly = "매핑 ?�정???�못?�었?�니?? (?�이�??�는 컬럼 ?�음)";
            solution = "관리자?�게 컬럼 매핑 ?�정 ?�인???�청?�세??";
        } else if (msg.contains("Connection") || msg.contains("timeout") || msg.contains("SocketException")) {
            friendly = "?�버 ?�결???�어졌습?�다.";
            solution = "?�트?�크 ?�태�??�인?�거???�시 ???�시 ?�도?�세??";
        } else if (msg.contains("UPDATE ?�??SET 컬럼???�습?�다")) {
            friendly = "?�데?�트??컬럼???�습?�다.";
            solution = "?�데?�트 ??컬럼 ?�에 최소 1�??�상??매핑 컬럼???�요?�니??";
        } else {
            friendly = "?�이???�??�??�류가 발생?�습?�다.";
            solution = "?�단 '?�스???�류 메시지'�?캡처?�여 관리자?�게 ?�달?�주?�요.";
        }
        return new String[]{ friendly, solution };
    }

    /**
     * ?�류 ?�들???��? ?��? 리포???�일 ?�성 ???�일�?반환
     *
     * 변�??�항:
     *   - "?�류 발생 컬럼�? 컬럼 ?�거
     *   - [MULTI_COL] ?�함 모든 ?�류 컬럼??빨간 박스 강조 (?�중 ?� 지??
     */
    public String buildErrorReport(
            String jobId,
            org.apache.poi.ss.usermodel.Sheet sheet,
            int headerIdx,
            List<org.apache.poi.ss.usermodel.Row> errorRows,
            List<String> errorMsgs,
            Map<?, ?> allMaps
    ) {
        if (errorRows == null || errorRows.isEmpty()) return null;
        String errFileName = null;
        org.apache.poi.ss.usermodel.Workbook errWb = null;
        try {
            errWb = createNewXlsxWorkbook();
            org.apache.poi.ss.usermodel.Sheet errSheet = errWb.createSheet("?�류_목록");

            // ?��????�의
            org.apache.poi.ss.usermodel.CellStyle headerStyle     = createHeaderStyle(errWb, false);
            org.apache.poi.ss.usermodel.CellStyle metaHeaderStyle = createHeaderStyle(errWb, true);
            org.apache.poi.ss.usermodel.CellStyle wrapStyle       = createWrapStyle(errWb);
            org.apache.poi.ss.usermodel.CellStyle rowNumStyle     = createRowNumStyle(errWb);

            org.apache.poi.ss.usermodel.Row origHeaderRow = sheet.getRow(headerIdx);
            int lastCol = (origHeaderRow != null) ? origHeaderRow.getLastCellNum() : 0;

            // ?�더 컬럼�????�덱??�?(?�류 컬럼 ?� 강조???�용)
            Map<String, Integer> headerColMap = new java.util.HashMap<>();
            if (origHeaderRow != null) {
                for (int c = 0; c < lastCol; c++) {
                    org.apache.poi.ss.usermodel.Cell hc = origHeaderRow.getCell(c);
                    if (hc != null) {
                        String hn = getCellValue(hc).trim().toLowerCase();
                        if (!hn.isEmpty()) headerColMap.put(hn, c);
                    }
                }
            }

            // ??DB 컬럼�????�류 리포?????�덱????��??�?구성
// allMaps 구조: { alias: { dbCol: "?��?컬럼?�덱?? } }
// ?�류 리포?�에??col 0 = ?�번?? ?�이?�는 col 1부?�이므�?excelColIdx + 1
Map<String, Integer> dbColToReportColIdx = new java.util.HashMap<>();
if (allMaps != null) {
    for (Map.Entry<?, ?> aliasEntry : allMaps.entrySet()) {
        Object aliasVal = aliasEntry.getValue();
        if (!(aliasVal instanceof Map)) continue;
        for (Map.Entry<?, ?> colEntry : ((Map<?, ?>) aliasVal).entrySet()) {
            String dbCol     = String.valueOf(colEntry.getKey()).trim().toLowerCase();
            String mappingVal = String.valueOf(colEntry.getValue()).trim();
            int excelColIdx  = -1;
            try {
                // ?�순 ?�자 ???��? 컬럼 ?�덱??
                excelColIdx = Integer.parseInt(mappingVal);
            } catch (NumberFormatException ignore) {
                // _REPLACE_:idx:rules ?�는 _UNIQUE_:idx ?�식
                if (mappingVal.startsWith("_REPLACE_:") || mappingVal.startsWith("_UNIQUE_:")) {
                    try {
                        excelColIdx = Integer.parseInt(mappingVal.split(":", 3)[1]);
                    } catch (Throwable ig) {}
                }
                // _AUTO_SEQ_, _FIXED_: ???��? 컬럼 ?�음 ??skip
            }
            if (excelColIdx >= 0) {
                dbColToReportColIdx.put(dbCol, excelColIdx + 1); // +1: col 0 = ?�번??
            }
        }
    }
}

            // ?�류 ?� 강조 ?��???(빨간 ?�두�?+ ?�한 빨간 배경)
            org.apache.poi.ss.usermodel.CellStyle errorCellStyle = errWb.createCellStyle();
            try {
                // 글�? 굵게 + 진한 빨간??
                org.apache.poi.ss.usermodel.Font errFont = errWb.createFont();
                errFont.setBold(true);
                try { errFont.setColor(org.apache.poi.ss.usermodel.IndexedColors.DARK_RED.getIndex()); } catch (Throwable ignore) {}
                errorCellStyle.setFont(errFont);

                // 배경: ?�한 빨간??(FFC8C8)
                try {
                    org.apache.poi.xssf.usermodel.XSSFCellStyle xStyle = (org.apache.poi.xssf.usermodel.XSSFCellStyle) errorCellStyle;
                    xStyle.setFillForegroundColor(new org.apache.poi.xssf.usermodel.XSSFColor(new byte[]{(byte)0xFF,(byte)0xC8,(byte)0xC8}, null));
                    xStyle.setFillPattern(org.apache.poi.ss.usermodel.FillPatternType.SOLID_FOREGROUND);
                } catch (Throwable ignore) {
                    errorCellStyle.setFillForegroundColor(org.apache.poi.ss.usermodel.IndexedColors.ROSE.getIndex());
                    errorCellStyle.setFillPattern(org.apache.poi.ss.usermodel.FillPatternType.SOLID_FOREGROUND);
                }

                // ?�두�? 4방향 모두 ?�꺼??빨간 ?�두�?(MEDIUM)
                try {
                    org.apache.poi.xssf.usermodel.XSSFCellStyle xStyle = (org.apache.poi.xssf.usermodel.XSSFCellStyle) errorCellStyle;
                    org.apache.poi.xssf.usermodel.XSSFColor red = new org.apache.poi.xssf.usermodel.XSSFColor(new byte[]{(byte)0xDC,(byte)0x14,(byte)0x3C}, null);
                    xStyle.setBorderTop(org.apache.poi.ss.usermodel.BorderStyle.MEDIUM);
                    xStyle.setBorderBottom(org.apache.poi.ss.usermodel.BorderStyle.MEDIUM);
                    xStyle.setBorderLeft(org.apache.poi.ss.usermodel.BorderStyle.MEDIUM);
                    xStyle.setBorderRight(org.apache.poi.ss.usermodel.BorderStyle.MEDIUM);
                    xStyle.setTopBorderColor(red);
                    xStyle.setBottomBorderColor(red);
                    xStyle.setLeftBorderColor(red);
                    xStyle.setRightBorderColor(red);
                } catch (Throwable ignore) {
                    errorCellStyle.setBorderTop(org.apache.poi.ss.usermodel.BorderStyle.MEDIUM);
                    errorCellStyle.setBorderBottom(org.apache.poi.ss.usermodel.BorderStyle.MEDIUM);
                    errorCellStyle.setBorderLeft(org.apache.poi.ss.usermodel.BorderStyle.MEDIUM);
                    errorCellStyle.setBorderRight(org.apache.poi.ss.usermodel.BorderStyle.MEDIUM);
                    errorCellStyle.setTopBorderColor(org.apache.poi.ss.usermodel.IndexedColors.RED.getIndex());
                    errorCellStyle.setBottomBorderColor(org.apache.poi.ss.usermodel.IndexedColors.RED.getIndex());
                    errorCellStyle.setLeftBorderColor(org.apache.poi.ss.usermodel.IndexedColors.RED.getIndex());
                    errorCellStyle.setRightBorderColor(org.apache.poi.ss.usermodel.IndexedColors.RED.getIndex());
                }

                errorCellStyle.setWrapText(true);
                errorCellStyle.setVerticalAlignment(org.apache.poi.ss.usermodel.VerticalAlignment.CENTER);
            } catch (Throwable ignore) {}

            // ?�?� ?�더 ??구성 ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
            // col 0       : ?��? ??번호 (주황??
            // col 1~lastCol : ?�본 ?�이??컬럼 (?�색)
            // col lastCol+1 : ?�류 ?�인 (?�반 ?�내) (주황?? ??"?�류 발생 컬럼�? ?�거??
            // col lastCol+2 : ?�결 방법 (주황??
            // col lastCol+3 : ?�스???�류 메시지 (주황??
            int colFriendly = lastCol + 1;
            int colSolution = lastCol + 2;
            int colSystem   = lastCol + 3;

            org.apache.poi.ss.usermodel.Row newHeader = errSheet.createRow(0);
            newHeader.setHeightInPoints(40);

            org.apache.poi.ss.usermodel.Cell hRowNum = newHeader.createCell(0);
            hRowNum.setCellValue("?��?\n??번호");
            try { hRowNum.setCellStyle(metaHeaderStyle); } catch (Throwable ignore) {}

            for (int c = 0; c < lastCol; c++) {
                org.apache.poi.ss.usermodel.Cell oldCell = origHeaderRow != null ? origHeaderRow.getCell(c) : null;
                org.apache.poi.ss.usermodel.Cell newCell = newHeader.createCell(c + 1);
                if (oldCell != null) newCell.setCellValue(getCellValue(oldCell));
                try { newCell.setCellStyle(headerStyle); } catch (Throwable ignore) {}
            }

            org.apache.poi.ss.usermodel.Cell hFriendly = newHeader.createCell(colFriendly);
            hFriendly.setCellValue("?�류 ?�인 (?�반 ?�내)");
            try { hFriendly.setCellStyle(metaHeaderStyle); } catch (Throwable ignore) {}

            org.apache.poi.ss.usermodel.Cell hSolution = newHeader.createCell(colSolution);
            hSolution.setCellValue("?�결 방법");
            try { hSolution.setCellStyle(metaHeaderStyle); } catch (Throwable ignore) {}

            org.apache.poi.ss.usermodel.Cell hSystem = newHeader.createCell(colSystem);
            hSystem.setCellValue("?�스???�류 메시지 (개발?�용)");
            try { hSystem.setCellStyle(metaHeaderStyle); } catch (Throwable ignore) {}

            // ?�?� ?�류 ?�이????기록 ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
            for (int r = 0; r < errorRows.size(); r++) {
                org.apache.poi.ss.usermodel.Row oldRow = errorRows.get(r);
                org.apache.poi.ss.usermodel.Row newRow = errSheet.createRow(r + 1);
                newRow.setHeightInPoints(40);

                int lineNo = (oldRow != null) ? (oldRow.getRowNum() - headerIdx) : -1;
                org.apache.poi.ss.usermodel.Cell cellRowNum = newRow.createCell(0);
                cellRowNum.setCellValue(lineNo > 0 ? String.valueOf(lineNo) : "?");
                try { cellRowNum.setCellStyle(rowNumStyle); } catch (Throwable ignore) {}

                // ?�본 ?�이???� 복사
                for (int c = 0; c < lastCol; c++) {
                    org.apache.poi.ss.usermodel.Cell oldCell = (oldRow != null) ? oldRow.getCell(c) : null;
                    org.apache.poi.ss.usermodel.Cell newCell = newRow.createCell(c + 1);
                    if (oldCell != null) newCell.setCellValue(getCellValue(oldCell));
                }

                String rawMsg = errorMsgs.get(r);

                // ???�류 컬럼 ?�체 추출 ???�당 ?� 모두 빨간 박스 강조
   List<String> errColNames = extractAllErrorColumnNames(rawMsg);
for (String errColName : errColNames) {
    String key = errColName.toLowerCase();

    // 1?�위: DB 컬럼명으�?직접 매핑 (cm_reg_dttm ?????�덱??
    Integer reportColIdx = dbColToReportColIdx.get(key);

    // 2?�위 ?�백: ?�더 ?�시명으�?매핑 (?? "?�록?? ?????�덱??
    if (reportColIdx == null) {
        Integer hIdx = headerColMap.get(key);
        if (hIdx != null) reportColIdx = hIdx + 1; // +1: col 0 = ?�번??
    }

    if (reportColIdx != null && reportColIdx >= 1 && reportColIdx <= lastCol) {
        org.apache.poi.ss.usermodel.Cell errCell = newRow.getCell(reportColIdx);
        if (errCell == null) errCell = newRow.createCell(reportColIdx);
        try { errCell.setCellStyle(errorCellStyle); } catch (Throwable ignore) {}
    }
}

                // ?�류 ?�인 / ?�결 방법 / ?�스??메시지 기록
                String[] translated = translateErrorForReport(rawMsg);

                org.apache.poi.ss.usermodel.Cell cellFriendly = newRow.createCell(colFriendly);
                cellFriendly.setCellValue(translated[0]);
                try { cellFriendly.setCellStyle(wrapStyle); } catch (Throwable ignore) {}

                org.apache.poi.ss.usermodel.Cell cellSolution = newRow.createCell(colSolution);
                cellSolution.setCellValue(translated[1]);
                try { cellSolution.setCellStyle(wrapStyle); } catch (Throwable ignore) {}

                org.apache.poi.ss.usermodel.Cell cellSystem = newRow.createCell(colSystem);
                cellSystem.setCellValue(rawMsg != null ? rawMsg : "");
                try { cellSystem.setCellStyle(wrapStyle); } catch (Throwable ignore) {}
            }

            // ?�?� ???�비 조정 ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
            errSheet.setColumnWidth(0, 14 * 256);                       // ?�번??
            for (int c = 1; c <= lastCol; c++) errSheet.setColumnWidth(c, 20 * 256); // ?�이??
            errSheet.setColumnWidth(colFriendly, 45 * 256);             // ?�류 ?�인
            errSheet.setColumnWidth(colSolution, 55 * 256);             // ?�결 방법
            errSheet.setColumnWidth(colSystem,   65 * 256);             // ?�스??메시지

            errFileName = "ERR_" + (jobId != null ? jobId : UUID.randomUUID().toString()) + ".xlsx";
            java.io.File errFile = new java.io.File(getSampleFileDir(), errFileName);
            try (FileOutputStream errFos = new FileOutputStream(errFile)) { errWb.write(errFos); }
            log.info("[ExcelUpload] ?�류 리포???�성 ?�료: {}", errFileName);

        } catch (Exception e) {
            log.error("[ExcelUpload] ?�류 리포???�성 ?�패: {}", e.getMessage(), e);
        } finally {
            closeWorkbook(errWb);
        }
        return errFileName;
    }

    // =====================================================================
    // 6. JSON ?�싱
    // =====================================================================

    public Object parseJson(String jsonStr) throws Exception {
        if (jsonStr == null || jsonStr.trim().isEmpty()) throw new Exception("JSON 문자?�이 비어?�습?�다.");
        jsonStr = jsonStr.trim();
        try {
            Class<?> mapperClass = Class.forName("com.fasterxml.jackson.databind.ObjectMapper");
            Object mapper = mapperClass.getDeclaredConstructor().newInstance();
            if (jsonStr.startsWith("[")) return mapperClass.getMethod("readValue", String.class, Class.class).invoke(mapper, jsonStr, List.class);
            else return mapperClass.getMethod("readValue", String.class, Class.class).invoke(mapper, jsonStr, Map.class);
        } catch (Throwable ignore) {}
        try {
            Class<?> semClass = Class.forName("javax.script.ScriptEngineManager");
            Object mgr = semClass.getDeclaredConstructor().newInstance();
            Object engine = semClass.getMethod("getEngineByName", String.class).invoke(mgr, "javascript");
            if (engine != null) {
                Class<?> seClass = Class.forName("javax.script.ScriptEngine");
                Object jsResult = seClass.getMethod("eval", String.class).invoke(engine, "var _r=(" + jsonStr + "); JSON.stringify(_r);");
                if (jsResult != null) return new LiteJsonParser(jsResult.toString().trim()).parse();
            }
        } catch (Throwable ignore) {}
        return new LiteJsonParser(jsonStr).parse();
    }

    /** 경량 JSON ?�서 (Jackson/Nashorn 모두 ?�는 ?�경 ?�백) */
    public static class LiteJsonParser {
        private int pos = 0;
        private final String s;
        public LiteJsonParser(String s) { this.s = s; }
        public Object parse() throws Exception { pos = 0; return parseLiteValue(s.trim()); }

        private Object parseLiteValue(String str) throws Exception {
            skipWs();
            if (pos >= str.length()) throw new Exception("JSON parse error: invalid state");
            char c = str.charAt(pos);
            if (c == '{') return parseLiteObject();
            if (c == '[') return parseLiteArray();
            if (c == '"') return parseLiteString();
            if (c == 't') { pos += 4; return Boolean.TRUE; }
            if (c == 'f') { pos += 5; return Boolean.FALSE; }
            if (c == 'n') { pos += 4; return null; }
            return parseLiteNumber();
        }
        private Map<String, Object> parseLiteObject() throws Exception {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            pos++; skipWs();
            if (s.charAt(pos) == '}') { pos++; return m; }
            while (pos < s.length()) {
                skipWs();
                String key = parseLiteString(); skipWs();
                if (s.charAt(pos) != ':') throw new Exception("':' 기�?");
                pos++;
                Object val = parseLiteValue(s); m.put(key, val); skipWs();
                char ch = s.charAt(pos);
                if (ch == '}') { pos++; return m; }
                if (ch == ',') { pos++; continue; }
                throw new Exception("',' ?�는 '}' 기�?");
            }
            throw new Exception("JSON Object ?�히지 ?�음");
        }
        private List<Object> parseLiteArray() throws Exception {
            List<Object> l = new ArrayList<>();
            pos++; skipWs();
            if (s.charAt(pos) == ']') { pos++; return l; }
            while (pos < s.length()) {
                l.add(parseLiteValue(s)); skipWs();
                char ch = s.charAt(pos);
                if (ch == ']') { pos++; return l; }
                if (ch == ',') { pos++; continue; }
                throw new Exception("',' ?�는 ']' 기�?");
            }
            throw new Exception("JSON Array ?�히지 ?�음");
        }
        private String parseLiteString() throws Exception {
            if (s.charAt(pos) != '"') throw new Exception("'\"' 기�?");
            pos++;
            StringBuilder sb = new StringBuilder();
            while (pos < s.length()) {
                char c = s.charAt(pos++);
                if (c == '"') return sb.toString();
                if (c == '\\') {
                    char e = s.charAt(pos++);
                    if (e == '"') sb.append('"');
                    else if (e == '\\') sb.append('\\');
                    else if (e == 'n') sb.append('\n');
                    else if (e == 'r') sb.append('\r');
                    else if (e == 't') sb.append('\t');
                    else sb.append(e);
                } else { sb.append(c); }
            }
            throw new Exception("JSON String ?�히지 ?�음");
        }
        private Number parseLiteNumber() {
            int start = pos;
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if (Character.isDigit(c) || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E') pos++;
                else break;
            }
            String numStr = s.substring(start, pos);
            try { return Long.parseLong(numStr); } catch (NumberFormatException e) {}
            try { return Double.parseDouble(numStr); } catch (NumberFormatException e) {}
            return 0;
        }
        private void skipWs() { while (pos < s.length() && Character.isWhitespace(s.charAt(pos))) pos++; }
    }

    // =====================================================================
    // 7. 공통 문자???�일 ?�틸
    // =====================================================================

    public String decodeSafeBase64(String encoded) {
        if (encoded == null || encoded.trim().isEmpty() || "null".equals(encoded) || "undefined".equals(encoded)) return "";
        try {
            Class<?> clazz = Class.forName("java.util.Base64");
            Object decoder = clazz.getMethod("getDecoder").invoke(null);
            byte[] decodedBytes = (byte[]) decoder.getClass().getMethod("decode", String.class).invoke(decoder, encoded);
            return new String(decodedBytes, "UTF-8");
        } catch (Throwable e) {}
        try {
            Class<?> clazz = Class.forName("org.apache.commons.codec.binary.Base64");
            byte[] decodedBytes = (byte[]) clazz.getMethod("decodeBase64", String.class).invoke(null, encoded);
            return new String(decodedBytes, "UTF-8");
        } catch (Throwable e) {}
        return "";
    }

    public boolean isValidSqlIdentifier(String s) {
        if (s == null || s.trim().isEmpty()) return false;
        return s.matches("^[a-zA-Z0-9_.]+$");
    }

    public int countDataRows(org.apache.poi.ss.usermodel.Sheet sheet, int headerIdx) {
        if (sheet == null) return 0;
        int startRow = Math.max(headerIdx + 1, 0);
        int count = 0;
        for (int rowIdx = startRow; rowIdx <= sheet.getLastRowNum(); rowIdx++) {
            org.apache.poi.ss.usermodel.Row row = sheet.getRow(rowIdx);
            if (hasAnyCellValue(row)) count++;
        }
        return count;
    }

    public boolean hasAnyCellValue(org.apache.poi.ss.usermodel.Row row) {
        if (row == null || row.getLastCellNum() <= 0) return false;
        for (int ci = 0; ci < row.getLastCellNum(); ci++) {
            if (!getCellValue(row.getCell(ci)).trim().isEmpty()) {
                return true;
            }
        }
        return false;
    }

    public String restore(String s) {
        if (s == null) return "";
        return s.replace("&quot;", "\"").replace("&#34;", "\"")
                .replace("&lt;", "<").replace("&#60;", "<")
                .replace("&gt;", ">").replace("&#62;", ">")
                .replace("&amp;", "&").replace("&#38;", "&")
                .replace("&#39;", "'").replace("&apos;", "'");
    }

    public byte[] readStreamToBytes(InputStream is) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
        return baos.toByteArray();
    }

    public String getSampleFileDir() throws Exception {
        String dirPath = "/app/data/attach/loader";
        // String dirPath = "/Users/leejunhyuk/apps/egene/app/data/attach/loader";
        java.io.File dir = new java.io.File(dirPath);
        if (!dir.exists()) {
            if (!dir.mkdirs()) throw new Exception("?�로???�더�??�성??권한???�습?�다: " + dir.getAbsolutePath());
        }
        return dirPath;
    }

    // =====================================================================
    // 8. ?��? ?��????�퍼 (?�류 리포?�용)
    // =====================================================================

    private org.apache.poi.ss.usermodel.CellStyle createHeaderStyle(org.apache.poi.ss.usermodel.Workbook wb, boolean isMeta) {
        try {
            org.apache.poi.ss.usermodel.CellStyle style = wb.createCellStyle();
            org.apache.poi.ss.usermodel.Font font = wb.createFont();

            try { font.getClass().getMethod("setBold", boolean.class).invoke(font, true); }
            catch (Throwable e1) {
                try { font.getClass().getMethod("setBoldweight", short.class).invoke(font, (short) 700); }
                catch (Throwable e2) {}
            }
            style.setFont(font);

            try {
                Class<?> haClass = Class.forName("org.apache.poi.ss.usermodel.HorizontalAlignment");
                Object center = Enum.valueOf((Class<Enum>) haClass, "CENTER");
                style.getClass().getMethod("setAlignment", haClass).invoke(style, center);
            } catch (Throwable e1) {
                try { style.getClass().getMethod("setAlignment", short.class).invoke(style, (short) 2); }
                catch (Throwable e2) {}
            }

            try {
                Class<?> vaClass = Class.forName("org.apache.poi.ss.usermodel.VerticalAlignment");
                Object center = Enum.valueOf((Class<Enum>) vaClass, "CENTER");
                style.getClass().getMethod("setVerticalAlignment", vaClass).invoke(style, center);
            } catch (Throwable e1) {
                try { style.getClass().getMethod("setVerticalAlignment", short.class).invoke(style, (short) 1); }
                catch (Throwable e2) {}
            }

            style.setWrapText(true);

            style.setFillForegroundColor(isMeta
                ? org.apache.poi.ss.usermodel.IndexedColors.LIGHT_ORANGE.getIndex()
                : org.apache.poi.ss.usermodel.IndexedColors.GREY_25_PERCENT.getIndex());
            try {
                Class<?> fpClass = Class.forName("org.apache.poi.ss.usermodel.FillPatternType");
                Object solid = Enum.valueOf((Class<Enum>) fpClass, "SOLID_FOREGROUND");
                style.getClass().getMethod("setFillPattern", fpClass).invoke(style, solid);
            } catch (Throwable e1) {
                try { style.getClass().getMethod("setFillPattern", short.class).invoke(style, (short) 1); }
                catch (Throwable e2) {}
            }

            return style;
        } catch (Throwable e) { return wb.createCellStyle(); }
    }

    private org.apache.poi.ss.usermodel.CellStyle createWrapStyle(org.apache.poi.ss.usermodel.Workbook wb) {
        try {
            org.apache.poi.ss.usermodel.CellStyle style = wb.createCellStyle();
            style.setWrapText(true);

            try {
                Class<?> vaClass = Class.forName("org.apache.poi.ss.usermodel.VerticalAlignment");
                Object top = Enum.valueOf((Class<Enum>) vaClass, "TOP");
                style.getClass().getMethod("setVerticalAlignment", vaClass).invoke(style, top);
            } catch (Throwable e1) {
                try { style.getClass().getMethod("setVerticalAlignment", short.class).invoke(style, (short) 0); }
                catch (Throwable e2) {}
            }

            return style;
        } catch (Throwable e) { return wb.createCellStyle(); }
    }

    private org.apache.poi.ss.usermodel.CellStyle createRowNumStyle(org.apache.poi.ss.usermodel.Workbook wb) {
        try {
            org.apache.poi.ss.usermodel.CellStyle style = wb.createCellStyle();

            try {
                Class<?> haClass = Class.forName("org.apache.poi.ss.usermodel.HorizontalAlignment");
                Object center = Enum.valueOf((Class<Enum>) haClass, "CENTER");
                style.getClass().getMethod("setAlignment", haClass).invoke(style, center);
            } catch (Throwable e1) {
                try { style.getClass().getMethod("setAlignment", short.class).invoke(style, (short) 2); }
                catch (Throwable e2) {}
            }

            try {
                Class<?> vaClass = Class.forName("org.apache.poi.ss.usermodel.VerticalAlignment");
                Object center = Enum.valueOf((Class<Enum>) vaClass, "CENTER");
                style.getClass().getMethod("setVerticalAlignment", vaClass).invoke(style, center);
            } catch (Throwable e1) {
                try { style.getClass().getMethod("setVerticalAlignment", short.class).invoke(style, (short) 1); }
                catch (Throwable e2) {}
            }

            return style;
        } catch (Throwable e) { return wb.createCellStyle(); }
    }
}
