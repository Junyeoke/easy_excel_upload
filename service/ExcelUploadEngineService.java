// ExcelUploadEngineService.java
package com.steg.lit.service;

import com.steg.lit.repository.ExcelUploadEngineRepository;  // 추가

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.*;
import java.sql.*;
import java.util.*;

/**
 * =====================================================================
 * [ExcelUploadEngineService]
 * 역할: 엑셀 업로드 관련 모든 비즈니스 로직을 담당합니다.
 *   - 엑셀 파일 파싱 / 셀 값 추출
 *   - 계층형 Cascade INSERT / UPSERT 처리
 *   - Batch 실행 / 오류 추적 / 오류 리포트 생성
 *   - Pre/Post/Row SQL 실행
 *   - JSON 파싱 / 직렬화
 *   - Base64 디코딩 및 문자열 유틸
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
    // 1. 엑셀 파일 파싱 유틸
    // =====================================================================

    /**
     * Cell 타입 문자열 반환 (POI 버전 호환)
     *
     * ✅ [Fix] 기존 단일 메서드 캐싱 버그 수정
     * - 색상/서식이 있는 셀은 내부 구현 클래스가 다를 수 있음
     *   (XSSFCell, XSSFFormulaEvaluatingCell 등)
     * - 첫 번째 셀 클래스로 캐싱한 Method를 다른 클래스 인스턴스에 invoke하면
     *   IllegalArgumentException 발생 → catch에서 "BLANK" 반환 → 값 무시
     * - 클래스별로 Method를 캐싱하도록 수정
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
     * 셀 값 문자열 반환
     *
     * ✅ [Fix] 색상/배경색 셀 인식 강화
     * - getCellTypeStr 캐싱 버그 수정으로 서식 셀 타입 정상 인식
     * - DataFormatter 를 추가 폴백으로 사용해 커스텀 숫자 포맷
     *   ([Red]0, [색1]#,##0 등)이 적용된 셀도 값 추출 가능
     * - 리치텍스트(글자별 색상) 셀도 getStringCellValue()로 텍스트 정상 반환
     */
    public String getCellValue(org.apache.poi.ss.usermodel.Cell cell) {
        if (cell == null) return "";
        try {
            String typeStr = getCellTypeStr(cell);

            if ("STRING".equals(typeStr)) {
                // 리치텍스트(글자별 색상 적용)도 getStringCellValue()로 plain text 반환
                return cell.getStringCellValue();
            }

            if ("NUMERIC".equals(typeStr)) {
                if (org.apache.poi.ss.usermodel.DateUtil.isCellDateFormatted(cell)) {
                    return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(cell.getDateCellValue());
                }
                double dVal = cell.getNumericCellValue();
                // ✅ 커스텀 숫자 포맷([Red]0 등)이 적용된 셀: DataFormatter로 표시값 읽기 후
                //    숫자만 추출 시도, 실패하면 원시 숫자값 사용
                try {
                    org.apache.poi.ss.usermodel.DataFormatter df =
                        new org.apache.poi.ss.usermodel.DataFormatter();
                    String formatted = df.formatCellValue(cell).trim();
                    if (!formatted.isEmpty() && !"0".equals(formatted)) {
                        // 포맷 문자열에서 색상 코드([Red],[Blue] 등) 제거 후 반환
                        formatted = formatted.replaceAll("^\\[.*?\\]", "").trim();
                        if (!formatted.isEmpty()) return formatted;
                    }
                } catch (Throwable ignore) {}
                if (dVal == (long) dVal) return String.format("%d", (long) dVal);
                return String.valueOf(dVal);
            }

            if ("BOOLEAN".equals(typeStr)) return String.valueOf(cell.getBooleanCellValue());

            if ("FORMULA".equals(typeStr)) {
                // ✅ FormulaEvaluator로 수식 결과값을 직접 평가
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
                    // 평가 후에도 타입 불명확하면 DataFormatter로 마지막 시도
                    try {
                        org.apache.poi.ss.usermodel.DataFormatter df =
                            new org.apache.poi.ss.usermodel.DataFormatter();
                        String formatted = df.formatCellValue(cell, evaluator).trim();
                        if (!formatted.isEmpty()) return formatted;
                    } catch (Throwable ignore) {}
                    return "";
                } catch (Throwable evalEx) {
                    // FormulaEvaluator 실패 시 원시값으로 폴백
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
            throw new Exception("엑셀 파일을 열 수 없습니다: " + e.getMessage());
        }
    }

    public org.apache.poi.ss.usermodel.Workbook createNewXlsxWorkbook() throws Exception {
        try { return new org.apache.poi.xssf.usermodel.XSSFWorkbook(); }
        catch (Throwable e) {
            try {
                Class<?> cls = Class.forName("org.apache.poi.xssf.usermodel.XSSFWorkbook");
                return (org.apache.poi.ss.usermodel.Workbook) cls.getDeclaredConstructor().newInstance();
            } catch (Throwable ex) { throw new Exception("XSSFWorkbook 생성 실패"); }
        }
    }

    public void closeWorkbook(org.apache.poi.ss.usermodel.Workbook wb) {
        if (wb == null) return;
        try { wb.getClass().getMethod("close").invoke(wb); } catch (Throwable ignore) {}
    }

    // =====================================================================
    // 2. 계층형 Cascade INSERT / UPSERT (핵심 로직)
    // =====================================================================

    @SuppressWarnings("unchecked")
    public void cascadeExcelInsert(
            Connection conn, org.apache.poi.ss.usermodel.Row row, List<?> structs, Map<?, ?> allMaps,
            String currentAlias, String parentId, Object iceObj, Object ukeyObj,
            Map<String, Set<String>> metaMap, List<?> rowSqls,
            Map<String, Object> psCache, Map<String, List<String>> sqlParamOrderCache,
            ExcelUploadEngineRepository.FastSequenceManager seqMgr
    ) throws Exception {

        // 현재 alias에 해당하는 struct 탐색
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

        // ── 업데이트 키 컬럼 파싱 ──
        // struct에 "upsert_keys": ["col1","col2"] 형태로 지정
        List<String> upsertKeys = new ArrayList<>();
        Object upsertKeysObj = currentStruct.get("upsert_keys");
        if (upsertKeysObj instanceof List) {
            for (Object k : (List<?>) upsertKeysObj) {
                String ks = String.valueOf(k).trim();
                if (!ks.isEmpty() && isValidSqlIdentifier(ks)) upsertKeys.add(ks);
            }
        }
        boolean isUpsertMode = !upsertKeys.isEmpty();

        // ── 신규 PK 채번 ──
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
                    log.info("[ExcelUpload] ICE 채번 실패 (UniqueKey로 폴백): entityId={}, err={}", entityId, iceEx.getMessage());
                }
            }
        }
        if (newId == null || newId.trim().isEmpty()) {
            try {
                java.lang.reflect.Method ukeyFetch = (java.lang.reflect.Method) psCache.get("_UKEY_METHOD_");
                if (ukeyFetch != null) newId = (String) ukeyFetch.invoke(ukeyObj);
            } catch (Throwable ukEx) {
                log.error("[ExcelUpload] ❌ UniqueKey 채번 실패 - PK 생성 불가: {}", ukEx.getMessage());
                throw new Exception("PK 채번 오류: " + ukEx.getMessage());
                // ✅ 여기서 throw는 유지 - 행별 catch(Exception rowEx)에서 잡혀 행별 오류로 표시됨
            }
        }

        // ── 컬럼 매핑 처리 ──
        for (Map.Entry<?, ?> entry : aliasMap.entrySet()) {
            String dbCol    = (String) entry.getKey();
            String mappingVal = String.valueOf(entry.getValue());
            if (mappingVal == null || mappingVal.trim().isEmpty() || "null".equals(mappingVal)) continue;
            if (!isValidSqlIdentifier(dbCol)) throw new Exception("Invalid dest column: [" + dbCol + "]");

            if ("_AUTO_SEQ_".equals(mappingVal)) {
                data.put(dbCol, newId);
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

        // ── PK / FK 세팅 ──
        String pkCol = (String) currentStruct.get("pk_col");
        if (pkCol != null && !pkCol.trim().isEmpty()) {
            if (!isValidSqlIdentifier(pkCol)) throw new Exception("Invalid PK column: [" + pkCol + "]");
            // upsert 모드일 때 PK는 UPDATE 분기에서 사용 안 함 (새 채번 불필요)
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

        // ── 컬럼 제약 사전 검증 (DB 전송 전 모든 오류 컬럼 탐지) ──────────────
        if (!data.isEmpty()) {
            Map<String, Object> colConstraints = (Map<String, Object>) psCache.get("_COL_CONSTRAINTS_:" + tableName);
            if (colConstraints == null) {
                colConstraints = repository.getColumnConstraints(conn, tableName);
                psCache.put("_COL_CONSTRAINTS_:" + tableName, colConstraints);
                log.info("[ExcelUpload][PreValid] 테이블 '{}' 컬럼 제약 로드 완료 - lengths={}, notnulls={}",
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
                // String.length() = Java 문자 수 (character count, not bytes)
                // colLengths의 maxLen도 getPrecision() 기준 character count
                String val = entry.getValue() == null ? "" : String.valueOf(entry.getValue()).trim();

                // 길이 초과 검사 (문자 수 기준)
                if (colLengths != null) {
                    Integer maxLen = colLengths.get(colLower);
                    if (maxLen != null && maxLen > 0 && val.length() > maxLen) {
                        log.info("[ExcelUpload][PreValid] 길이 초과 감지: col={}, maxLen={}, inputLen={}", colLower, maxLen, val.length());
                        colErrors.add(entry.getKey() + ":길이초과(최대" + maxLen + "자,입력" + val.length() + "자)");
                    }
                }
                // NOT NULL 검사 (PK/FK 컬럼은 시스템 생성이므로 제외)
                if (colNotNulls != null && colNotNulls.contains(colLower)) {
                    boolean isPkOrFk = colLower.equals(
                            currentStruct.get("pk_col") != null ? ((String)currentStruct.get("pk_col")).toLowerCase() : "__none__")
                            || (parentId != null && colLower.equals(
                            currentStruct.get("fk") != null ? ((String)currentStruct.get("fk")).toLowerCase() : "__none__"));
                    if (!isPkOrFk && val.isEmpty()) {
                        log.info("[ExcelUpload][PreValid] NOT NULL 위반 감지: col={}", colLower);
                        colErrors.add(entry.getKey() + ":필수값누락");
                    }
                }
            }
            if (!colErrors.isEmpty()) {
                throw new Exception("[MULTI_COL] " + String.join("|", colErrors));
            }
        }

        // ── UPSERT 분기 처리 ──
        if (!data.isEmpty()) {

            if (isUpsertMode) {
                // ── upsert_keys로 DB 존재 여부 확인 ──
                boolean recordExists = checkRecordExists(conn, tableName, upsertKeys, data, psCache);

                if (recordExists) {
                    // ─── UPDATE 경로 ─────────────────────────────────────
                    String updCacheKey = "UPD::" + tableName + "::" + currentAlias;
                    PreparedStatement updPs = (PreparedStatement) psCache.get(updCacheKey);
                    List<String> updParamOrder = sqlParamOrderCache.get(updCacheKey);

                    if (updPs == null) {
                        Set<String> numericColumns = metaMap.get(tableName);
                        Object[] sqlInfo = makeUpdateSql(tableName, data, upsertKeys, numericColumns);
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
                        if (val.isEmpty() && numericColumns != null && numericColumns.contains(col.toLowerCase())) val = "0";
                        updPs.setString(pi + 1, val);
                    }
                    List<String> updLogParams = new ArrayList<>();
                    for (String col : updParamOrder) {
                        updLogParams.add(data.get(col) == null ? null : String.valueOf(data.get(col)).trim());
                    }
                    logPreparedSql(getCachedSqlText(psCache, updCacheKey), updLogParams);
                    updPs.addBatch();

                    // 배치 트래커에 UPDATE 행 등록
                    Map<String, List<org.apache.poi.ss.usermodel.Row>> batchTracker =
                        (Map<String, List<org.apache.poi.ss.usermodel.Row>>) psCache.get("_BATCH_TRACKER_");
                    if (batchTracker == null) {
                        batchTracker = new java.util.LinkedHashMap<>();
                        psCache.put("_BATCH_TRACKER_", batchTracker);
                    }
                    List<org.apache.poi.ss.usermodel.Row> rowQueue = batchTracker.get(updCacheKey);
                    if (rowQueue == null) { rowQueue = new ArrayList<>(); batchTracker.put(updCacheKey, rowQueue); }
                    rowQueue.add(row);

                    log.info("[ExcelUpload][UPDATE] 레코드 업데이트 배치 등록 완료 (키: {})", upsertKeys);

                } else {
                    // ─── INSERT 경로 (신규) ──────────────────────────────
                    // 신규 INSERT 시에는 PK 채번값 세팅
                    if (pkCol != null && !pkCol.trim().isEmpty()) {
                        data.put(pkCol, newId);
                    }
                    addInsertBatch(conn, tableName, currentAlias, pkCol, newId, data, metaMap, psCache, sqlParamOrderCache, row);
                    log.info("[ExcelUpload][INSERT] 신규 레코드 삽입 배치 등록 (upsert 모드)");
                }

            } else {
                // ─── 순수 INSERT 경로 (기존 동작) ───────────────────────
                addInsertBatch(conn, tableName, currentAlias, pkCol, newId, data, metaMap, psCache, sqlParamOrderCache, row);
            }

            // 임시 키 테이블 기록 (INSERT 시에만 의미 있음)
            if (!isUpsertMode && pkCol != null && !pkCol.trim().isEmpty() && newId != null && !newId.trim().isEmpty()) {
                repository.insertTempUploadKey(conn, currentAlias, tableName, pkCol, newId, psCache);
            }

            // Row-SQL 배치 추가
            if (rowSqls != null && !rowSqls.isEmpty()) {
                Map<String, String> tokens = new HashMap<>();
                tokens.put("ALIAS",     currentAlias);
                tokens.put("TABLE",     tableName);
                tokens.put("PK_COL",    pkCol == null ? "" : pkCol);
                tokens.put("NEW_ID",    newId == null ? "" : newId);
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
                    throw new Exception("Row-SQL 쿼리 배치 추가 오류 (NEW_ID=" + newId + "): " + rowSqlEx.getMessage());
                }
            }
        }

        // ── 자식 구조 재귀 처리 ──
        for (Object sObj : structs) {
            Map<String, Object> s = (Map<String, Object>) sObj;
            if (currentAlias.equals(s.get("parent"))) {
                cascadeExcelInsert(conn, row, structs, allMaps, (String) s.get("alias"),
                        newId, iceObj, ukeyObj, metaMap, rowSqls, psCache, sqlParamOrderCache, seqMgr);
            }
        }
    }

    /**
     * [내부 헬퍼] INSERT 배치에 행 추가 (공통화)
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

        // Row 추적 (배치 오류 식별용)
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
     * [신규] DB에 해당 키 값으로 레코드가 존재하는지 확인합니다.
     * 존재 확인용 PreparedStatement는 "_CHK_" 접두사로 캐싱하여
     * flushBatch 시 배치 실행 대상에서 제외됩니다.
     */
    @SuppressWarnings("unchecked")
    private boolean checkRecordExists(
            Connection conn, String tableName,
            List<String> keyCols, Map<String, Object> data,
            Map<String, Object> psCache
    ) {
        // 키 컬럼 중 하나라도 값이 없으면 존재 확인 불가 → INSERT로 처리
        for (String keyCol : keyCols) {
            Object val = data.get(keyCol);
            if (val == null || String.valueOf(val).trim().isEmpty()) {
                log.info("[ExcelUpload][UPSERT] 업데이트 키 컬럼 '{}' 값이 비어있어 INSERT로 처리합니다.", keyCol);
                return false;
            }
        }

        // 캐시 키: "_CHK_" 접두사 → flushBatch에서 자동 제외됨
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
                log.info("[ExcelUpload][UPSERT] 존재 확인 SQL 캐싱: {}", chkSql);
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
            log.info("[ExcelUpload][UPSERT] 존재 확인 중 오류 (INSERT로 처리): {}", e.getMessage());
            return false;
        }
    }

    // =====================================================================
    // 2-1. 업로드 전 검증 전용 (DB 저장 없음)
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
                    colErrors.add(entry.getKey() + ":필수값누락");
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

    private int parseExcelIndex(String raw) throws Exception {
        try {
            return Integer.parseInt(raw.trim());
        } catch (Throwable e) {
            throw new Exception("Invalid excel column index: " + raw);
        }
    }

    // =====================================================================
    // 3. Batch 실행 / 캐시 정리
    // =====================================================================

    @SuppressWarnings("unchecked")
    public void flushBatch(
            Map<String, Object> psCache,
            List<org.apache.poi.ss.usermodel.Row> errorRows,
            List<String> errorMsgs,
            int[] counters  // [0]=성공 증분, [1]=실패 증분
    ) {
        Map<String, List<org.apache.poi.ss.usermodel.Row>> batchTracker =
            (Map<String, List<org.apache.poi.ss.usermodel.Row>>) psCache.get("_BATCH_TRACKER_");

        for (Map.Entry<String, Object> entry : psCache.entrySet()) {
            String key = entry.getKey();

            // "_CHK_" 접두사 키는 존재 확인용 PS → 배치 실행 제외
            if (key.startsWith("_CHK_")) continue;

            // 기타 내부 캐시 키 제외 (기존 동작 유지)
            if (key.startsWith("_") && !key.equals("_TMP_KEY_PS_") && !key.equals("_ROW_SQL_STMT_")) continue;

            Object obj = entry.getValue();
            List<org.apache.poi.ss.usermodel.Row> trackedRows = (batchTracker != null) ? batchTracker.get(key) : null;

            if (obj instanceof PreparedStatement) {
                PreparedStatement ps = (PreparedStatement) obj;

                if ("_TMP_KEY_PS_".equals(key)) {
                    try {
                        ps.executeBatch();
                    } catch (Throwable ignore) {
                        log.info("[ExcelUpload] _TMP_KEY_PS_ 배치 실행 중 무시된 오류: {}", ignore.getMessage());
                    }
                    continue;
                }

                // UPD:: 접두사 여부로 INSERT/UPDATE 구분 로그 출력
                boolean isUpdateBatch = key.startsWith("UPD::");

                try {
                    int[] updateCounts = ps.executeBatch();
                    counters[0] += (trackedRows != null) ? trackedRows.size() : updateCounts.length;
                    if (isUpdateBatch) log.info("[ExcelUpload] UPDATE 배치 {}건 완료", updateCounts.length);

                } catch (java.sql.BatchUpdateException bue) {
                    int[] updateCounts = bue.getUpdateCounts();
                    String batchType = isUpdateBatch ? "UPDATE" : "INSERT";
                    log.error("[ExcelUpload] BatchUpdateException [{}][{}] - updateCounts 길이={}, 전체 행 수={}",
                            batchType, key, updateCounts.length, trackedRows != null ? trackedRows.size() : "unknown");

                    if (trackedRows != null) {
                        for (int idx = 0; idx < trackedRows.size(); idx++) {
                            if (idx < updateCounts.length) {
                                if (updateCounts[idx] == Statement.EXECUTE_FAILED) {
                                    // 명확한 실패
                                    counters[1]++;
                                    errorRows.add(trackedRows.get(idx));
                                    errorMsgs.add(batchType + " 배치 실패: " + bue.getMessage());
                                    log.error("[ExcelUpload] ❌ 배치 내 {}번째 행 실패 (EXECUTE_FAILED): {}", idx + 1, bue.getMessage());
                                } else {
                                    // SUCCESS_NO_INFO(-2) 포함, 0 초과 → 성공으로 처리
                                    counters[0]++;
                                }
                            } else {
                                // updateCounts 배열 범위 밖 → 드라이버가 중단하여 미실행된 행
                                counters[1]++;
                                errorRows.add(trackedRows.get(idx));
                                errorMsgs.add(batchType + " 배치 선행 오류로 취소 (미실행): " + bue.getMessage());
                                log.info("[ExcelUpload] ⚠ 배치 내 {}번째 행은 선행 오류로 취소 처리", idx + 1);
                            }
                        }
                    } else {
                        // ✅ [Fix] trackedRows==null: 행 특정은 불가하지만 카운터/메시지는 기록
                        counters[1]++;
                        errorRows.add(null); // null placeholder - failedRowMsgMap 루프에서 null 체크됨
                        errorMsgs.add("배치 실패 (행 특정 불가): " + bue.getMessage());
                        log.error("[ExcelUpload] ❌ 배치 오류 (Row 추적 없음): {}", bue.getMessage());
                    }

                } catch (Throwable e) {
                    String errMsg = (e.getMessage() != null) ? e.getMessage() : e.toString();
                    log.error("[ExcelUpload] ❌ executeBatch() 미분류 오류 [{}]: {}", key, errMsg);
                    if (trackedRows != null) {
                        for (org.apache.poi.ss.usermodel.Row r : trackedRows) {
                            counters[1]++;
                            errorRows.add(r);
                            errorMsgs.add("배치 실행 오류: " + errMsg);
                        }
                    } else {
                        // ✅ [Fix] trackedRows==null: 행 특정 불가하지만 카운터/메시지 기록
                        counters[1]++;
                        errorRows.add(null); // null placeholder
                        errorMsgs.add("배치 실행 오류 (행 특정 불가): " + errMsg);
                        log.error("[ExcelUpload] ❌ 배치 오류 (Row 추적 없음): {}", errMsg);
                    }
                }

            } else if (obj instanceof Statement) {
                try {
                    ((Statement) obj).executeBatch();
                }
                catch (Throwable e) {
                    log.error("[ExcelUpload] ❌ Row-SQL Statement 배치 실행 오류 [{}]: {}", key, e.getMessage());
                    counters[1]++;
                    errorRows.addAll(trackedRows != null ? trackedRows : java.util.Collections.emptyList());
                    errorMsgs.add("Row-SQL 배치 실행 오류: " + e.getMessage());
                }
            }

            if (batchTracker != null) batchTracker.remove(key);
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
    // 4. SQL 유틸
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
     * [신규] UPDATE SQL 생성
     * SET: upsertKeys를 제외한 나머지 컬럼
     * WHERE: upsertKeys 컬럼
     *
     * @return Object[]{sql문자열, paramOrder(List<String>)}
     *         paramOrder = [SET 컬럼들...] + [WHERE 컬럼들...]
     */
    public Object[] makeUpdateSql(String tableName, Map<String, Object> data,
                                   List<String> upsertKeys, Set<String> numericColumns) throws Exception {
        if (!isValidSqlIdentifier(tableName)) throw new Exception("Invalid target table name: " + tableName);

        StringBuilder setSb = new StringBuilder();
        List<String> paramOrder = new ArrayList<>();

        // SET 절: upsertKeys 및 pk_col을 제외한 컬럼
        boolean firstSet = true;
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            String col = entry.getKey();
            if (upsertKeys.contains(col)) continue;     // WHERE 키는 SET에서 제외
            if (!isValidSqlIdentifier(col)) throw new Exception("Invalid column: " + col);
            if (!firstSet) setSb.append(", ");
            setSb.append(col).append(" = ?");
            paramOrder.add(col);
            firstSet = false;
        }

        if (setSb.length() == 0) {
            throw new Exception("UPDATE 대상 SET 컬럼이 없습니다. upsert_keys 외에 매핑된 컬럼이 있어야 합니다.");
        }

        // WHERE 절
        StringBuilder whereSb = new StringBuilder();
        for (int i = 0; i < upsertKeys.size(); i++) {
            String col = upsertKeys.get(i);
            if (!isValidSqlIdentifier(col)) throw new Exception("Invalid upsert key column: " + col);
            if (i > 0) whereSb.append(" AND ");
            whereSb.append(col).append(" = ?");
            paramOrder.add(col);  // WHERE 파라미터는 SET 파라미터 뒤에 위치
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
                        log.info("[ExcelUpload] {} 실행: {}", sqlType, trimmedSql);
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
    // 5. 오류 리포트 생성
    // =====================================================================

    /**
     * DB 오류 메시지에서 문제가 된 컬럼명을 하나 추출합니다. (하위 호환용)
     * 내부적으로 extractAllErrorColumnNames를 호출합니다.
     */
    public String extractErrorColumnName(String msg) {
        List<String> cols = extractAllErrorColumnNames(msg);
        return cols.isEmpty() ? null : cols.get(0);
    }

    /**
     * DB 오류 메시지에서 문제가 된 컬럼명 목록 전체를 추출합니다.
     *
     * 지원 패턴:
     *   [MULTI_COL] col1:길이초과(...)|col2:필수값누락  ← 사전 검증 오류
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

        // ── [MULTI_COL] col1:길이초과(...)|col2:필수값누락 형식 ──
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
     * 시스템 오류 메시지를 사용자 친화적인 안내문으로 변환합니다.
     * @return String[2] — [0] 일반 안내 메시지, [1] 해결 방법
     */
    public String[] translateErrorForReport(String msg) {
        if (msg == null || msg.trim().isEmpty()) {
            return new String[]{ "알 수 없는 오류", "관리자에게 문의해주세요." };
        }
        String friendly, solution;

        // ── [MULTI_COL] 사전 검증 오류 (길이초과 / 필수값누락 등) ──────────────
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
            friendly = "입력 데이터 오류: " + detail;
            solution = "빨간 박스로 표시된 셀의 값을 확인하여 형식이나 길이를 맞춘 후 재업로드하세요.";
            return new String[]{ friendly, solution };
        }

        if (msg.contains("cannot be null") || msg.contains("NOT NULL constraint") || msg.contains("null value in column")) {
            friendly = "필수 항목(비워두면 안 되는 칸)이 비어 있습니다.";
            solution = "해당 행에 빈 칸이 있는지 확인하거나, 반드시 입력해야 하는 컬럼이 누락되지 않았는지 점검하세요.";
        } else if (msg.contains("Duplicate entry") || msg.contains("unique constraint") || msg.contains("ORA-00001") || msg.contains("duplicate key")) {
            friendly = "이미 등록된 중복 데이터입니다.";
            solution = "엑셀 파일 안에 같은 ID가 두 번 이상 있거나, 이미 시스템에 등록된 데이터와 겹칩니다.";
        } else if (msg.contains("Data too long") || msg.contains("value too large") || msg.contains("ORA-12899") || msg.contains("data would be truncated")) {
            friendly = "입력된 데이터가 허용 길이를 초과했습니다.";
            solution = "해당 셀의 값이 DB 컬럼에서 허용하는 최대 글자 수보다 깁니다. 내용을 줄여주세요.";
        } else if (msg.contains("Incorrect integer value") || msg.contains("invalid number") || msg.contains("ORA-01722") || msg.contains("invalid input syntax for type")) {
            friendly = "숫자 형식이 잘못되었습니다.";
            solution = "숫자만 입력해야 하는 칸에 문자나 특수기호가 포함되어 있는지 확인하세요.";
        } else if (msg.contains("Incorrect datetime value") || msg.contains("invalid date") || msg.contains("ORA-01858") || msg.contains("date/time field value out of range")) {
            friendly = "날짜 형식이 올바르지 않습니다.";
            solution = "날짜 칸의 형식이 시스템 요구 형식(예: yyyy-MM-dd)과 다릅니다. 엑셀에서 날짜 형식을 확인하세요.";
        } else if (msg.contains("foreign key constraint") || msg.contains("ORA-02291") || msg.contains("violates foreign key")) {
            friendly = "참조하는 상위 데이터가 존재하지 않습니다.";
            solution = "입력한 코드나 ID가 연결된 다른 테이블에 먼저 등록되어 있어야 합니다. 데이터 순서를 확인하세요.";
        } else if (msg.contains("SQL syntax") || msg.contains("bad SQL grammar") || msg.contains("ORA-00907")) {
            friendly = "설정된 SQL 구문에 오류가 있습니다.";
            solution = "관리자에게 Row-SQL 또는 Pre/Post-SQL 설정 점검을 요청하세요.";
        } else if (msg.contains("배치 선행 오류로 인해 취소")) {
            friendly = "동일 배치 내 다른 행의 오류로 인해 함께 취소되었습니다.";
            solution = "같은 묶음(배치)에서 앞선 행에 오류가 발생해 이 행도 처리되지 않았습니다. 오류 행을 먼저 수정 후 재업로드하세요.";
        } else if (msg.contains("SEQ_NOT_FOUND")) {
            friendly = "채번 시퀀스 설정을 찾을 수 없습니다.";
            solution = "관리자에게 시퀀스(SEQ) 설정 등록을 요청하세요.";
        } else if (msg.contains("Invalid table") || msg.contains("Invalid column") || msg.contains("ORA-00942")) {
            friendly = "매핑 설정이 잘못되었습니다. (테이블 또는 컬럼 없음)";
            solution = "관리자에게 컬럼 매핑 설정 확인을 요청하세요.";
        } else if (msg.contains("Connection") || msg.contains("timeout") || msg.contains("SocketException")) {
            friendly = "서버 연결이 끊어졌습니다.";
            solution = "네트워크 상태를 확인하거나 잠시 후 다시 시도하세요.";
        } else if (msg.contains("UPDATE 대상 SET 컬럼이 없습니다")) {
            friendly = "업데이트할 컬럼이 없습니다.";
            solution = "업데이트 키 컬럼 외에 최소 1개 이상의 매핑 컬럼이 필요합니다.";
        } else {
            friendly = "데이터 저장 중 오류가 발생했습니다.";
            solution = "하단 '시스템 오류 메시지'를 캡처하여 관리자에게 전달해주세요.";
        }
        return new String[]{ friendly, solution };
    }

    /**
     * 오류 행들을 담은 엑셀 리포트 파일 생성 후 파일명 반환
     *
     * 변경 사항:
     *   - "오류 발생 컬럼명" 컬럼 제거
     *   - [MULTI_COL] 포함 모든 오류 컬럼에 빨간 박스 강조 (다중 셀 지원)
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
            org.apache.poi.ss.usermodel.Sheet errSheet = errWb.createSheet("오류_목록");

            // 스타일 정의
            org.apache.poi.ss.usermodel.CellStyle headerStyle     = createHeaderStyle(errWb, false);
            org.apache.poi.ss.usermodel.CellStyle metaHeaderStyle = createHeaderStyle(errWb, true);
            org.apache.poi.ss.usermodel.CellStyle wrapStyle       = createWrapStyle(errWb);
            org.apache.poi.ss.usermodel.CellStyle rowNumStyle     = createRowNumStyle(errWb);

            org.apache.poi.ss.usermodel.Row origHeaderRow = sheet.getRow(headerIdx);
            int lastCol = (origHeaderRow != null) ? origHeaderRow.getLastCellNum() : 0;

            // 헤더 컬럼명 → 인덱스 맵 (오류 컬럼 셀 강조에 사용)
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

            // ★ DB 컬럼명 → 오류 리포트 열 인덱스 역방향 맵 구성
// allMaps 구조: { alias: { dbCol: "엑셀컬럼인덱스" } }
// 오류 리포트에서 col 0 = 행번호, 데이터는 col 1부터이므로 excelColIdx + 1
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
                // 단순 숫자 → 엑셀 컬럼 인덱스
                excelColIdx = Integer.parseInt(mappingVal);
            } catch (NumberFormatException ignore) {
                // _REPLACE_:idx:rules 또는 _UNIQUE_:idx 형식
                if (mappingVal.startsWith("_REPLACE_:") || mappingVal.startsWith("_UNIQUE_:")) {
                    try {
                        excelColIdx = Integer.parseInt(mappingVal.split(":", 3)[1]);
                    } catch (Throwable ig) {}
                }
                // _AUTO_SEQ_, _FIXED_: 는 엑셀 컬럼 없음 → skip
            }
            if (excelColIdx >= 0) {
                dbColToReportColIdx.put(dbCol, excelColIdx + 1); // +1: col 0 = 행번호
            }
        }
    }
}

            // 오류 셀 강조 스타일 (빨간 테두리 + 연한 빨간 배경)
            org.apache.poi.ss.usermodel.CellStyle errorCellStyle = errWb.createCellStyle();
            try {
                // 글꼴: 굵게 + 진한 빨간색
                org.apache.poi.ss.usermodel.Font errFont = errWb.createFont();
                errFont.setBold(true);
                try { errFont.setColor(org.apache.poi.ss.usermodel.IndexedColors.DARK_RED.getIndex()); } catch (Throwable ignore) {}
                errorCellStyle.setFont(errFont);

                // 배경: 연한 빨간색 (FFC8C8)
                try {
                    org.apache.poi.xssf.usermodel.XSSFCellStyle xStyle = (org.apache.poi.xssf.usermodel.XSSFCellStyle) errorCellStyle;
                    xStyle.setFillForegroundColor(new org.apache.poi.xssf.usermodel.XSSFColor(new byte[]{(byte)0xFF,(byte)0xC8,(byte)0xC8}, null));
                    xStyle.setFillPattern(org.apache.poi.ss.usermodel.FillPatternType.SOLID_FOREGROUND);
                } catch (Throwable ignore) {
                    errorCellStyle.setFillForegroundColor(org.apache.poi.ss.usermodel.IndexedColors.ROSE.getIndex());
                    errorCellStyle.setFillPattern(org.apache.poi.ss.usermodel.FillPatternType.SOLID_FOREGROUND);
                }

                // 테두리: 4방향 모두 두꺼운 빨간 테두리 (MEDIUM)
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

            // ── 헤더 행 구성 ──────────────────────────────────────────────────
            // col 0       : 엑셀 행 번호 (주황색)
            // col 1~lastCol : 원본 데이터 컬럼 (회색)
            // col lastCol+1 : 오류 원인 (일반 안내) (주황색) ← "오류 발생 컬럼명" 제거됨
            // col lastCol+2 : 해결 방법 (주황색)
            // col lastCol+3 : 시스템 오류 메시지 (주황색)
            int colFriendly = lastCol + 1;
            int colSolution = lastCol + 2;
            int colSystem   = lastCol + 3;

            org.apache.poi.ss.usermodel.Row newHeader = errSheet.createRow(0);
            newHeader.setHeightInPoints(40);

            org.apache.poi.ss.usermodel.Cell hRowNum = newHeader.createCell(0);
            hRowNum.setCellValue("엑셀\n행 번호");
            try { hRowNum.setCellStyle(metaHeaderStyle); } catch (Throwable ignore) {}

            for (int c = 0; c < lastCol; c++) {
                org.apache.poi.ss.usermodel.Cell oldCell = origHeaderRow != null ? origHeaderRow.getCell(c) : null;
                org.apache.poi.ss.usermodel.Cell newCell = newHeader.createCell(c + 1);
                if (oldCell != null) newCell.setCellValue(getCellValue(oldCell));
                try { newCell.setCellStyle(headerStyle); } catch (Throwable ignore) {}
            }

            org.apache.poi.ss.usermodel.Cell hFriendly = newHeader.createCell(colFriendly);
            hFriendly.setCellValue("오류 원인 (일반 안내)");
            try { hFriendly.setCellStyle(metaHeaderStyle); } catch (Throwable ignore) {}

            org.apache.poi.ss.usermodel.Cell hSolution = newHeader.createCell(colSolution);
            hSolution.setCellValue("해결 방법");
            try { hSolution.setCellStyle(metaHeaderStyle); } catch (Throwable ignore) {}

            org.apache.poi.ss.usermodel.Cell hSystem = newHeader.createCell(colSystem);
            hSystem.setCellValue("시스템 오류 메시지 (개발자용)");
            try { hSystem.setCellStyle(metaHeaderStyle); } catch (Throwable ignore) {}

            // ── 오류 데이터 행 기록 ───────────────────────────────────────────
            for (int r = 0; r < errorRows.size(); r++) {
                org.apache.poi.ss.usermodel.Row oldRow = errorRows.get(r);
                org.apache.poi.ss.usermodel.Row newRow = errSheet.createRow(r + 1);
                newRow.setHeightInPoints(40);

                int lineNo = (oldRow != null) ? (oldRow.getRowNum() - headerIdx) : -1;
                org.apache.poi.ss.usermodel.Cell cellRowNum = newRow.createCell(0);
                cellRowNum.setCellValue(lineNo > 0 ? String.valueOf(lineNo) : "?");
                try { cellRowNum.setCellStyle(rowNumStyle); } catch (Throwable ignore) {}

                // 원본 데이터 셀 복사
                for (int c = 0; c < lastCol; c++) {
                    org.apache.poi.ss.usermodel.Cell oldCell = (oldRow != null) ? oldRow.getCell(c) : null;
                    org.apache.poi.ss.usermodel.Cell newCell = newRow.createCell(c + 1);
                    if (oldCell != null) newCell.setCellValue(getCellValue(oldCell));
                }

                String rawMsg = errorMsgs.get(r);

                // ★ 오류 컬럼 전체 추출 → 해당 셀 모두 빨간 박스 강조
   List<String> errColNames = extractAllErrorColumnNames(rawMsg);
for (String errColName : errColNames) {
    String key = errColName.toLowerCase();

    // 1순위: DB 컬럼명으로 직접 매핑 (cm_reg_dttm → 열 인덱스)
    Integer reportColIdx = dbColToReportColIdx.get(key);

    // 2순위 폴백: 헤더 표시명으로 매핑 (예: "등록일" → 열 인덱스)
    if (reportColIdx == null) {
        Integer hIdx = headerColMap.get(key);
        if (hIdx != null) reportColIdx = hIdx + 1; // +1: col 0 = 행번호
    }

    if (reportColIdx != null && reportColIdx >= 1 && reportColIdx <= lastCol) {
        org.apache.poi.ss.usermodel.Cell errCell = newRow.getCell(reportColIdx);
        if (errCell == null) errCell = newRow.createCell(reportColIdx);
        try { errCell.setCellStyle(errorCellStyle); } catch (Throwable ignore) {}
    }
}

                // 오류 원인 / 해결 방법 / 시스템 메시지 기록
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

            // ── 열 너비 조정 ──────────────────────────────────────────────────
            errSheet.setColumnWidth(0, 14 * 256);                       // 행번호
            for (int c = 1; c <= lastCol; c++) errSheet.setColumnWidth(c, 20 * 256); // 데이터
            errSheet.setColumnWidth(colFriendly, 45 * 256);             // 오류 원인
            errSheet.setColumnWidth(colSolution, 55 * 256);             // 해결 방법
            errSheet.setColumnWidth(colSystem,   65 * 256);             // 시스템 메시지

            errFileName = "ERR_" + (jobId != null ? jobId : UUID.randomUUID().toString()) + ".xlsx";
            java.io.File errFile = new java.io.File(getSampleFileDir(), errFileName);
            try (FileOutputStream errFos = new FileOutputStream(errFile)) { errWb.write(errFos); }
            log.info("[ExcelUpload] 오류 리포트 생성 완료: {}", errFileName);

        } catch (Exception e) {
            log.error("[ExcelUpload] 오류 리포트 생성 실패: {}", e.getMessage(), e);
        } finally {
            closeWorkbook(errWb);
        }
        return errFileName;
    }

    // =====================================================================
    // 6. JSON 파싱
    // =====================================================================

    public Object parseJson(String jsonStr) throws Exception {
        if (jsonStr == null || jsonStr.trim().isEmpty()) throw new Exception("JSON 문자열이 비어있습니다.");
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

    /** 경량 JSON 파서 (Jackson/Nashorn 모두 없는 환경 폴백) */
    public static class LiteJsonParser {
        private int pos = 0;
        private final String s;
        public LiteJsonParser(String s) { this.s = s; }
        public Object parse() throws Exception { pos = 0; return parseLiteValue(s.trim()); }

        private Object parseLiteValue(String str) throws Exception {
            skipWs();
            if (pos >= str.length()) throw new Exception("JSON 파싱 오류: 예상치 못한 끝");
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
                if (s.charAt(pos) != ':') throw new Exception("':' 기대");
                pos++;
                Object val = parseLiteValue(s); m.put(key, val); skipWs();
                char ch = s.charAt(pos);
                if (ch == '}') { pos++; return m; }
                if (ch == ',') { pos++; continue; }
                throw new Exception("',' 또는 '}' 기대");
            }
            throw new Exception("JSON Object 닫히지 않음");
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
                throw new Exception("',' 또는 ']' 기대");
            }
            throw new Exception("JSON Array 닫히지 않음");
        }
        private String parseLiteString() throws Exception {
            if (s.charAt(pos) != '"') throw new Exception("'\"' 기대");
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
            throw new Exception("JSON String 닫히지 않음");
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
    // 7. 공통 문자열/파일 유틸
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
            if (!dir.mkdirs()) throw new Exception("업로드 폴더를 생성할 권한이 없습니다: " + dir.getAbsolutePath());
        }
        return dirPath;
    }

    // =====================================================================
    // 8. 내부 스타일 헬퍼 (오류 리포트용)
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
