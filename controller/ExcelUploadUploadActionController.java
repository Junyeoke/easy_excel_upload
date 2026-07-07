// ExcelUploadUploadActionController.java
package com.steg.lit.controller;

import com.steg.lit.repository.ExcelUploadEngineRepository;
import com.steg.lit.service.ExcelUploadEngineService;
import com.steg.lit.util.ProgressStore;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Handles upload execution for the legacy /api/excel/engine endpoint.
 */
@Component
public class ExcelUploadUploadActionController {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadUploadActionController.class);

    private final ExcelUploadEngineService service;
    private final ExcelUploadEngineRepository repository;
    private final ExcelUploadUploadDebugLogger uploadDebugLogger;
    private final ExcelUploadUploadResultSupport uploadResultSupport;

    public ExcelUploadUploadActionController(ExcelUploadEngineService service,
            ExcelUploadEngineRepository repository,
            ExcelUploadUploadDebugLogger uploadDebugLogger,
            ExcelUploadUploadResultSupport uploadResultSupport) {
        this.service = service;
        this.repository = repository;
        this.uploadDebugLogger = uploadDebugLogger;
        this.uploadResultSupport = uploadResultSupport;
    }
    public void handleUpload(DataSource ds, byte[] fileBytes, Map<String, Object> params,
            HttpServletRequest request, Map<String, Object> result,
            HttpServletResponse response) throws Exception {

        long processStartTime = System.currentTimeMillis();
        String reqJobName = (String) params.get("job_name");
        String reqFileName = (String) params.get("file_name");

        log.info("=====================================================");
        log.info("[ExcelUpload] 대용량 엑셀 업로드 요청 수신");
        log.info("[ExcelUpload] 작업명: {}, 첨부파일명: {}", reqJobName, reqFileName);
        log.info("=====================================================");

        if (fileBytes == null || fileBytes.length == 0) {
            throw new Exception("파일이 없습니다.");
        }

        // 파라미터 디코딩
        String structJson = decodeParam(params, "struct_json_b64", "struct_json");
        String mapJson = decodeParam(params, "mapping_json_b64", "mapping");
        if (mapJson == null) {
            mapJson = decodeParam(params, "mapping_b64", "mapping_json");
        }
        String preSqlJson = decodeParam(params, "pre_sql_json_b64", "pre_sql_json");
        String postSqlJson = decodeParam(params, "post_sql_json_b64", "post_sql_json");
        String rowSqlJson = decodeParam(params, "row_sql_json_b64", "row_sql_json");
        String uploadId = (String) params.get("upload_id");
        String retryMode = (String) params.get("retry_mode");
        String retryReasonTypes = (String) params.get("retry_reason_types");
        // 2026-06-19: UPSERT에서 빈 칸을 기존 값으로 남길지 업로드 경로에 전달한다.
        boolean keepEmptyValues = isTruthy(params.get("upsert_keep_empty_yn"));
        // 2026-07-07: 실패 행이 있으면 업로드 데이터 전체를 한 트랜잭션으로 롤백한다.
        boolean rollbackOnFail = isTruthy(params.get("rollback_on_fail_yn"));
        String histId = null;
        String configSnapshotHash = uploadResultSupport.sha256Hex(
                String.valueOf(structJson == null ? "" : structJson) + "||"
                        + String.valueOf(mapJson == null ? "" : mapJson) + "||"
                        + String.valueOf(preSqlJson == null ? "" : preSqlJson) + "||"
                        + String.valueOf(postSqlJson == null ? "" : postSqlJson) + "||"
                        + String.valueOf(rowSqlJson == null ? "" : rowSqlJson) + "||"
                        + String.valueOf(params.get("upsert_keep_empty_yn") == null ? "" : params.get("upsert_keep_empty_yn")) + "||"
                        + String.valueOf(params.get("rollback_on_fail_yn") == null ? "" : params.get("rollback_on_fail_yn")) + "||"
                        + String.valueOf(params.get("max_upload_rows") == null ? "" : params.get("max_upload_rows")));

        int headerIdx = 0;
        try {
            headerIdx = Integer.parseInt((String) params.get("header_row")) - 1;
        } catch (Throwable e) {
        }
        if (headerIdx < 0) {
            headerIdx = 0;
        }

        List<?> structs = (List<?>) service.parseJson(structJson);
        Map<?, ?> allMaps = (Map<?, ?>) service.parseJson(mapJson);
        Set<Integer> targetRows = null;
        String targetRowsB64 = (String) params.get("target_rows_b64");
        if (targetRowsB64 != null && !targetRowsB64.trim().isEmpty()) {
            try {
                Object parsed = service.parseJson(service.decodeSafeBase64(targetRowsB64));
                if (parsed instanceof List) {
                    targetRows = new LinkedHashSet<>();
                    for (Object n : (List<?>) parsed) {
                        try {
                            int v = Integer.parseInt(String.valueOf(n));
                            if (v > 0) targetRows.add(v);
                        } catch (Throwable ignore) {
                        }
                    }
                    if (targetRows.isEmpty()) targetRows = null;
                }
            } catch (Throwable ignore) {
                targetRows = null;
            }
        }

        List<?> preSqls = null, postSqls = null, rowSqls = null;
        try {
            if (preSqlJson != null && !preSqlJson.trim().isEmpty()) {
                preSqls = (List<?>) service.parseJson(preSqlJson);
            }
        } catch (Throwable e) {
            log.error("[ExcelUpload] Pre-SQL JSON 파싱 실패 - Pre-SQL이 실행되지 않습니다: {}", e.getMessage());
            // ✅ throw 하지 않음: Pre-SQL 없이 계속 진행, 오류는 로그에서 확인
        }
        try {
            if (postSqlJson != null && !postSqlJson.trim().isEmpty()) {
                postSqls = (List<?>) service.parseJson(postSqlJson);
            }
        } catch (Throwable e) {
            log.error("[ExcelUpload] Post-SQL JSON 파싱 실패 - Post-SQL이 실행되지 않습니다: {}", e.getMessage());
            // ✅ throw 하지 않음: Post-SQL 없이 계속 진행, 오류는 로그에서 확인
        }
        try {
            if (rowSqlJson != null && !rowSqlJson.trim().isEmpty()) {
                rowSqls = (List<?>) service.parseJson(rowSqlJson);
            }
        } catch (Throwable e) {
            log.error("[ExcelUpload] Row-SQL JSON 파싱 실패 - Row-SQL이 실행되지 않습니다: {}", e.getMessage());
            // ✅ throw 하지 않음: Row-SQL 없이 계속 진행, 오류는 로그에서 확인
        }

        log.info("[ExcelUpload] 메모리에 엑셀 파일 로딩 및 파싱 시작...");
        org.apache.poi.ss.usermodel.Workbook wb = service.createWorkbook(fileBytes);
        org.apache.poi.ss.usermodel.Sheet sheet = wb.getSheetAt(0);

        // 미리보기에서 수정된 셀 값 적용
        String editedRowsB64 = (String) params.get("edited_rows_b64");
        if (editedRowsB64 != null && !editedRowsB64.trim().isEmpty()) {
            try {
                Map<?, ?> editedMap = (Map<?, ?>) service.parseJson(service.decodeSafeBase64(editedRowsB64));
                int applyCount = 0;
                for (Map.Entry<?, ?> rowEntry : editedMap.entrySet()) {
                    int sheetRowNum = headerIdx + Integer.parseInt(rowEntry.getKey().toString());
                    org.apache.poi.ss.usermodel.Row row = sheet.getRow(sheetRowNum);
                    if (row == null) {
                        row = sheet.createRow(sheetRowNum);
                    }
                    for (Map.Entry<?, ?> colEntry : ((Map<?, ?>) rowEntry.getValue()).entrySet()) {
                        int colIdx = Integer.parseInt(colEntry.getKey().toString());
                        org.apache.poi.ss.usermodel.Cell cell = row.getCell(colIdx);
                        if (cell == null) {
                            cell = row.createCell(colIdx);
                        }
                        cell.setCellValue(colEntry.getValue() != null ? colEntry.getValue().toString() : "");
                        applyCount++;
                    }
                }
                log.info("[ExcelUpload] 미리보기 수정값 {}개 셀 적용 완료", applyCount);
            } catch (Throwable e) {
                log.info("[ExcelUpload] 미리보기 수정값 적용 중 오류 (무시됨): {}", e.getMessage());
            }
        }

        int startRow = headerIdx + 1;
        int totalRows = sheet.getLastRowNum();
        int actualTotalRows = (targetRows != null)
                ? targetRows.size()
                : Math.max(totalRows - startRow + 1, 0);
        if (targetRows == null) {
            actualTotalRows = service.countDataRows(sheet, headerIdx);
        }
        int maxUploadRows = parseIntParam((String) params.get("max_upload_rows"), 0);
        if (maxUploadRows > 0 && actualTotalRows > maxUploadRows) {
            service.closeWorkbook(wb);
            throw new Exception("최대 업로드 가능 건수는 " + maxUploadRows + "건입니다. 현재 엑셀 데이터는 "
                    + actualTotalRows + "건이므로 업로드할 수 없습니다.");
        }
        log.info("[ExcelUpload] 파싱 완료 - 대상 데이터 총 {}행 감지 ({}행부터 시작)", actualTotalRows, startRow + 1);

        Connection conn = null;
        int currentRowForLog = headerIdx + 1;
        Map<String, Object> psCache = new HashMap<>();
        Map<String, List<String>> sqlParamOrderCache = new HashMap<>();
        // 2026-06-20: 컬럼 매핑 특수값(현재 로그인 사용자/MTN) 치환에 사용할 런타임 값을 캐시에 보관한다.
        psCache.put("_LOGIN_USER_", firstValidRuntimeValue(trimParam(params.get("login_user_id")), getSessionUserValue(request, "emp_id")));
        psCache.put("_LOGIN_MTN_", firstValidRuntimeValue(trimParam(params.get("login_mtn_id")), getSessionUserValue(request, "emp_mtn_id")));
        String jobId = (String) params.get("job_id");
        boolean debugDetail = isTruthy(params.get("debug_detail")) || isTruthy(params.get("debug_upload_log"));
        int debugRowLimit = Math.min(Math.max(parseIntParam((String) params.get("debug_row_limit"), 20), 1), 200);
        int debugLoggedRows = 0;

        // ── 로그 리스트 세션 등록 (폴백용 유지) + ProgressStore 초기화 ──
        List<String> uploadLogs = java.util.Collections.synchronizedList(new ArrayList<>());
        if (jobId != null) {
            request.getSession().setAttribute("EXCEL_LOGS_" + jobId, uploadLogs);
        }
        if (jobId != null) {
            ProgressStore.init(jobId, actualTotalRows);
        }

        // ── 로그 헬퍼: 세션 리스트 + ProgressStore 동시 기록 ─────────────
        final String _jobId = jobId;
        java.util.function.Consumer<String> addLog = (msg) -> {
            uploadLogs.add(msg);
            if (_jobId != null) {
                ProgressStore.addLog(_jobId, msg);
            }
        };

        addLog.accept("📂 파일 파싱 완료 - 총 " + actualTotalRows + "행 감지");
        if (targetRows != null) {
            addLog.accept("🎯 실패행 재처리 모드: 지정된 " + targetRows.size() + "개 행만 처리");
        }
        if (debugDetail) {
            addLog.accept("🔎 상세 디버그 로그 활성화");
            addLog.accept("🔎 상세 로그 대상: 상위 " + debugRowLimit + "개 행");
            addLog.accept("🔎 구조 수: " + structs.size() + ", Pre-SQL: " + (preSqls == null ? 0 : preSqls.size())
                    + ", Row-SQL: " + (rowSqls == null ? 0 : rowSqls.size())
                    + ", Post-SQL: " + (postSqls == null ? 0 : postSqls.size()));
        }

        int blockSize = actualTotalRows > 0 ? Math.min(actualTotalRows * structs.size() + 50, 10000) : 100;

        // UniqueKey / ICE 초기화 (Reflection)
        Object ukeyObj = null, iceObj = null;
        try {
            Class<?> ukClass = Class.forName("org.sdf.util.UniqueKey");
            ukeyObj = ukClass.getMethod("getInstance").invoke(null);
            psCache.put("_UKEY_METHOD_", ukClass.getMethod("fetchNewKey"));
        } catch (Throwable e) {
            log.error("[ExcelUpload] UniqueKey 초기화 실패 - PK 채번 시 행별 오류로 처리됩니다: {}", e.getMessage());
            // ✅ throw 하지 않음: 행별 처리 시 PK 오류가 행별 오류 목록에 표시되도록 유지
        }
        try {
            Class<?> iceClass = Class.forName("org.sdf.efc.entity.IcEntityManager");
            Object iceInstance = iceClass.getMethod("getInstance").invoke(null);
            psCache.put("_ICE_ENT_METHOD_", iceClass.getMethod("getEntity", String.class));
            psCache.put("_ICE_MAP_OBJ_", iceInstance);
        } catch (Throwable e) {
            log.info("[ExcelUpload] ICE EntityManager 초기화 실패 (ICE 미사용 환경으로 처리): {}", e.getMessage());
        }

        List<org.apache.poi.ss.usermodel.Row> errorRows = new ArrayList<>();
        List<String> errorMsgs = new ArrayList<>();
        Map<String, String> failedRowMsgMap = new LinkedHashMap<>();
        Set<String> failedExcelRowNums = new LinkedHashSet<>();
        int unknownFailCnt = 0;
        int processedExcelRowCnt = 0;
        int successCnt = 0, failCnt = 0;
        boolean rolledBackOnFail = false;
        String errFileName = null;

        try {
            ExcelUploadEngineRepository.FastSequenceManager seqMgr
                    = new ExcelUploadEngineRepository.FastSequenceManager(ds, blockSize);
            conn = ds.getConnection();

            String nowFuncU = repository.detectNowFunction(conn);

            repository.ensureHistoryTable(conn, nowFuncU);
            conn.setAutoCommit(false);
            repository.ensureTempUploadKeysTable(conn);

            addLog.accept("\uD83D\uDD0C DB \uC5F0\uACB0 \uC644\uB8CC");

            // 테이블 컬럼 메타 캐싱
            Map<String, Set<String>> metaMap = new HashMap<>();
            for (Object sObj : structs) {
                Map<?, ?> s = (Map<?, ?>) sObj;
                String tbl = (String) s.get("table");
                if (tbl != null && !metaMap.containsKey(tbl)) {
                    metaMap.put(tbl, repository.getNumericColumnNames(conn, tbl));
                }
            }

            // Pre-SQL 실행
            if (preSqls != null && !preSqls.isEmpty()) {
                log.info("[ExcelUpload] Pre-SQL 실행 시작...");
                addLog.accept("\u2699\uFE0F Pre-SQL \uC2E4\uD589 \uC911...");
                if (!rollbackOnFail) {
                    conn.commit();
                }
                addLog.accept("\u2705 Pre-SQL \uC644\uB8CC");
                log.info("[ExcelUpload] Pre-SQL 완료");
            }

            int[] counters = {0, 0}; // [성공, 실패]

            addLog.accept("\u25B6\uFE0F \uB370\uC774\uD130 \uD589 \uC0BD\uC785 \uC2DC\uC791...");

            // 행별 처리
            for (int rowIdx = startRow; rowIdx <= totalRows; rowIdx++) {
                if (jobId != null && ProgressStore.isCancelRequested(jobId)) {
                    throw new Exception("사용자 요청으로 업로드가 취소되었습니다.");
                }
                currentRowForLog = rowIdx + 1;
                int dataRowNum = rowIdx - headerIdx;
                if (targetRows != null && !targetRows.contains(dataRowNum)) {
                    continue;
                }
                org.apache.poi.ss.usermodel.Row row = sheet.getRow(rowIdx);
                if (row == null) {
                    continue;
                }
                // ✅ [Fix] 미리보기와 동일하게 모든 셀 기준으로 빈 행 판단
                // 기존: 0번 셀만 체크 → 0번 셀이 비거나 서식만 있으면 데이터 행 전체 스킵
                boolean rowHasValue = false;
                for (int ci = 0; ci < row.getLastCellNum(); ci++) {
                    if (!service.getCellValue(row.getCell(ci)).trim().isEmpty()) {
                        rowHasValue = true;
                        break;
                    }
                }
                if (!rowHasValue) {
                    continue;
                }
                processedExcelRowCnt++;

                if (debugDetail && debugLoggedRows < debugRowLimit) {
                    int debugDataRowNum = row.getRowNum() - headerIdx;
                    addLog.accept("🔍 [" + debugDataRowNum + "행] 상세 업로드 계획 시작");
                    try {
                        uploadDebugLogger.debugCascadePlan(row, structs, allMaps, "ROOT", null, rowSqls, metaMap, keepEmptyValues, addLog, debugDataRowNum);
                    } catch (Throwable debugEx) {
                        addLog.accept("⚠️ [" + debugDataRowNum + "행] 상세 로그 생성 실패: " + debugEx.getMessage());
                        log.info("[ExcelUpload][Debug] {}행 상세 로그 생성 실패: {}", debugDataRowNum, debugEx.getMessage());
                    }
                    addLog.accept("🔍 [" + debugDataRowNum + "행] 상세 업로드 계획 종료");
                    debugLoggedRows++;
                    if (debugLoggedRows == debugRowLimit) {
                        addLog.accept("🔎 상세 로그 행 제한 도달: 이후 행은 요약 로그만 출력됩니다.");
                    }
                }

                try {
                    service.cascadeExcelInsert(conn, row, structs, allMaps, "ROOT", null,
                            iceObj, ukeyObj, metaMap, rowSqls, psCache, sqlParamOrderCache, seqMgr, keepEmptyValues);
                } catch (Exception rowEx) {
                    errorRows.add(row);
                    errorMsgs.add(rowEx.getMessage());
                    dataRowNum = row.getRowNum() - headerIdx; // 1-based 데이터 행 번호
                    failedRowMsgMap.put(String.valueOf(dataRowNum), rowEx.getMessage() != null ? rowEx.getMessage() : "알 수 없는 오류");
                    failedExcelRowNums.add(String.valueOf(dataRowNum));
                    addLog.accept("❌ " + currentRowForLog + "행 오류: " + rowEx.getMessage());
                    log.info("[ExcelUpload] ⚠ {}행 개별 오류: {}", currentRowForLog, rowEx.getMessage());
                    counters[1]++; 
                }

                // 진행률 업데이트 (100행마다)
                if (jobId != null && processedExcelRowCnt > 0 && processedExcelRowCnt % 100 == 0) {
                    int done = processedExcelRowCnt;
                    request.getSession().setAttribute("EXCEL_PROGRESS_" + jobId, done + "/" + actualTotalRows); // 폴백 유지
                    ProgressStore.update(jobId, done);
                    addLog.accept("\uD83D\uDCCB " + done + " / " + actualTotalRows + " \uCC98\uB9AC \uC911...");
                }

                // 5000행마다 Batch flush
                if (processedExcelRowCnt > 0 && processedExcelRowCnt % 5000 == 0) {
                    if (jobId != null && ProgressStore.isCancelRequested(jobId)) {
                        throw new Exception("사용자 요청으로 업로드가 취소되었습니다.");
                    }
                    int done = processedExcelRowCnt;
                    log.info("[ExcelUpload] {} / {} \uCC98\uB9AC \uC911 - Batch Flush...", done, actualTotalRows);
                    addLog.accept("\uD83D\uDCCB " + done + "\uAC74 \uBC30\uCE58 \uC800\uC7A5 \uC911...");
                    int beforeFlush = errorRows.size();
                    service.flushBatch(psCache, errorRows, errorMsgs, counters);
                    // flushBatch에서 새로 추가된 실패 행 → failedRowMsgMap에 등록
                    for (int ei = beforeFlush; ei < errorRows.size(); ei++) {
                        org.apache.poi.ss.usermodel.Row errRow = errorRows.get(ei);
                        String errMsg = (ei < errorMsgs.size()) ? errorMsgs.get(ei) : "배치 처리 실패";
                        if (errRow != null) {
                            int dataRN = errRow.getRowNum() - headerIdx;
                            failedRowMsgMap.put(String.valueOf(dataRN), errMsg);
                            failedExcelRowNums.add(String.valueOf(dataRN));
                            addLog.accept("❌ " + dataRN + "행 오류: " + errMsg);
                        } else {
                            // ✅ 행 특정 불가 오류
                            String unknownKey = "__unknown_" + failedRowMsgMap.size() + "__";
                            failedRowMsgMap.put(unknownKey, errMsg);
                            unknownFailCnt++;
                            addLog.accept("❌ 배치 오류 (행 특정 불가): " + errMsg);
                            log.error("[ExcelUpload] ❌ 행 특정 불가 오류: {}", errMsg);
                        }
                    }
                    if (!rollbackOnFail) {
                        conn.commit();
                        addLog.accept("\u2705 " + done + "\uD589 \uBC30\uCE58 \uC800\uC7A5 \uC644\uB8CC");
                    } else {
                        addLog.accept("\u2705 " + done + "\uD589 \uBC30\uCE58 \uCC98\uB9AC \uC644\uB8CC (\uCD5C\uC885 \uACB0\uACFC\uAE4C\uC9C0 \uCEE4\uBC0B \uBCF4\uB958)");
                    }
                }
            }

            // 잔여 배치 flush
            int beforeFinalFlush = errorRows.size();
            service.flushBatch(psCache, errorRows, errorMsgs, counters);
            // flushBatch에서 새로 추가된 실패 행 → failedRowMsgMap에 등록
            int unknownErrSeq = 0;
            for (int ei = beforeFinalFlush; ei < errorRows.size(); ei++) {
                org.apache.poi.ss.usermodel.Row errRow = errorRows.get(ei);
                String errMsg = (ei < errorMsgs.size()) ? errorMsgs.get(ei) : "배치 처리 실패";
                if (errRow != null) {
                    // 행 특정 가능: 행 번호로 키 설정
                    int dataRN = errRow.getRowNum() - headerIdx;
                    failedRowMsgMap.put(String.valueOf(dataRN), errMsg);
                    failedExcelRowNums.add(String.valueOf(dataRN));
                    addLog.accept("❌ " + dataRN + "행 오류: " + errMsg);
                } else {
                    // ✅ [Fix] trackedRows==null로 행 특정 불가한 오류 → __unknown_N__ 키로 등록
                    String unknownKey = "__unknown_" + (++unknownErrSeq) + "__";
                    failedRowMsgMap.put(unknownKey, errMsg);
                    unknownFailCnt++;
                    addLog.accept("❌ 배치 오류 (행 특정 불가): " + errMsg);
                    log.error("[ExcelUpload] ❌ 행 특정 불가 오류: {}", errMsg);
                }
            }

            // ── 안전망: errorRows 전체를 재스캔하여 failedRowMsgMap 누락 방지 ──
            // (flushBatch 인덱스 불일치 등 예외 상황 대비)
            for (int ei = 0; ei < errorRows.size(); ei++) {
                org.apache.poi.ss.usermodel.Row errRow = errorRows.get(ei);
                if (errRow == null) continue;
                String dataRNKey = String.valueOf(errRow.getRowNum() - headerIdx);
                if (!failedRowMsgMap.containsKey(dataRNKey)) {
                    String errMsg = (ei < errorMsgs.size()) ? errorMsgs.get(ei) : "오류 (상세 정보 없음)";
                    failedRowMsgMap.put(dataRNKey, errMsg);
                    failedExcelRowNums.add(dataRNKey);
                    addLog.accept("❌ " + dataRNKey + "행 오류 (재스캔): " + errMsg);
                    log.info("[ExcelUpload] ⚠ failedRowMsgMap 누락 행 재스캔으로 추가: {}행", dataRNKey);
                }
            }

            // 성공/실패 건수는 실제 INSERT 횟수가 아니라 "엑셀 입력 행" 기준으로 집계한다.
            // root-child 구조에서는 한 행이 여러 테이블에 배치될 수 있으므로 counters[0]/counters[1]를
            // 그대로 쓰면 성공 건수가 중복 집계될 수 있다.
            failCnt = failedExcelRowNums.size() + unknownFailCnt;
            successCnt = Math.max(processedExcelRowCnt - failCnt, 0);
            int attemptedSuccessCnt = successCnt;
            if (rollbackOnFail && failCnt > 0) {
                conn.rollback();
                rolledBackOnFail = true;
                successCnt = 0;
                addLog.accept("↩ 실패 행이 있어 전체 업로드를 롤백했습니다. DB 반영 건수: 0건");
                log.info("[ExcelUpload] rollback_on_fail_yn=Y - 실패 {}건으로 업로드 데이터 전체 롤백 (롤백 전 성공 계산: {}건)",
                        failCnt, attemptedSuccessCnt);
            } else {
                conn.commit();
            }
            log.info("[ExcelUpload] Batch 처리 완료 - 성공(row): {}건, 실패(row): {}건, 처리(row): {}건 (배치성공:{}건/배치실패:{}건, 식별실패행:{}건, 미식별실패:{}건)",
                successCnt, failCnt, processedExcelRowCnt, counters[0], counters[1], failedExcelRowNums.size(), unknownFailCnt);
            String finalStatus = rolledBackOnFail ? "err" : (failCnt > 0 ? "partial" : "ok");
            String finalMsg = rolledBackOnFail
                    ? (failCnt + "\uAC74 \uC2E4\uD328\uB85C \uC804\uCCB4 \uB864\uBC31\uB418\uC5C8\uC2B5\uB2C8\uB2E4. DB \uBC18\uC601: 0\uAC74")
                    : (successCnt + "\uAC74 \uC131\uACF5" + (failCnt > 0 ? ", " + failCnt + "\uAC74 \uC2E4\uD328" : ""));
            addLog.accept("\uD83C\uDFC6 \uC644\uB8CC! " + finalMsg);

            // 최종 진행률 100% 세팅
            if (jobId != null) {
                request.getSession().setAttribute("EXCEL_PROGRESS_" + jobId, actualTotalRows + "/" + actualTotalRows);
                ProgressStore.update(jobId, actualTotalRows);
                ProgressStore.setFinalResult(jobId, null, uploadId, successCnt, failCnt, errFileName, finalStatus);
                ProgressStore.complete(jobId);
            }

            // 오류 리포트 생성
            if (!errorRows.isEmpty()) {
                addLog.accept("📄 오류 리포트 생성 중...");
                errFileName = service.buildErrorReport(jobId, sheet, headerIdx, errorRows, errorMsgs, allMaps);
                addLog.accept("📄 오류 리포트 생성 완료: " + errFileName);
            }

            service.closeWorkbook(wb);

            // 이력 저장 실패는 업로드 성공/실패를 뒤집지 않고 경고로 노출한다.
            String failTypeJson = uploadResultSupport.buildFailTypeJson(failedRowMsgMap);
            histId = UUID.randomUUID().toString();
            String historySaveError = repository.insertHistory(conn, histId,
                    (String) params.get("job_name"), (String) params.get("file_name"),
                    successCnt, failCnt, errFileName, nowFuncU, uploadId, configSnapshotHash, failTypeJson,
                    structJson, mapJson, preSqlJson, postSqlJson, rowSqlJson, retryMode, retryReasonTypes,
                    rolledBackOnFail ? "Y" : "N");
            if (historySaveError != null) {
                String historyWarning = "업로드 이력 저장 실패: " + historySaveError;
                addLog.accept("⚠ " + historyWarning);
                result.put("history_saved", false);
                result.put("warning_msg", historyWarning);
                log.warn("[ExcelUpload] {}", historyWarning);
            } else {
                result.put("history_saved", true);
            }
            if (jobId != null) {
                ProgressStore.setFinalResult(jobId, histId, uploadId, successCnt, failCnt, errFileName, finalStatus);
            }
            // Post-SQL 실행
            if (!rolledBackOnFail && postSqls != null && !postSqls.isEmpty()) {
                log.info("[ExcelUpload] Post-SQL 실행 시작...");
                addLog.accept("\u2699\uFE0F Post-SQL \uC2E4\uD589 \uC911...");
                try {
                    service.executeSqlArray(conn, postSqls, "Post-SQL");
                    conn.commit();
                    addLog.accept("\u2705 Post-SQL \uC644\uB8CC");
                    log.info("[ExcelUpload] Post-SQL 완료");
                } catch (Throwable e) {
                    log.error("[ExcelUpload] Post-SQL 중 오류 발생: {}", e.getMessage(), e);
                    result.put("status", finalStatus);
                    result.put("msg", successCnt + "\uAC74 \uC131\uACF5, " + failCnt + "\uAC74 \uC2E4\uD328 (Post-SQL \uC624\uB958: " + e.getMessage() + ")");
                    result.put("success_cnt", successCnt);
                    result.put("fail_cnt", failCnt);
                    result.put("error_file", errFileName);
                    result.put("hist_id", histId);
                    if (!failedRowMsgMap.isEmpty()) {
                        result.put("failed_row_msgs", failedRowMsgMap);
                    }
                    uploadResultSupport.clearProgressSessionArtifacts(request, jobId);
                    response.setContentType("application/json; charset=UTF-8");
                    response.getWriter().write(jsonToString(result));
                    return;
                }
            }
            long elapsed = System.currentTimeMillis() - processStartTime;
            log.info("=====================================================");
            log.info("[ExcelUpload] 🎉 업로드 프로세스 종료 - 총 소요시간: {} ms", elapsed);
            log.info("[ExcelUpload] \uCD5C\uC885 \uACB0\uACFC - \uC131\uACF5: {}\uAC74, \uC2E4\uD328: {}\uAC74", successCnt, failCnt);
            log.info("=====================================================");

            result.put("status", finalStatus);
            result.put("msg", finalMsg);
            result.put("success_cnt", successCnt);
            result.put("fail_cnt", failCnt);
            result.put("error_file", errFileName);
            result.put("hist_id", histId);
            result.put("upload_id", uploadId);
            result.put("config_snapshot_hash", configSnapshotHash);
            result.put("rollback_on_fail_yn", rollbackOnFail ? "Y" : "N");
            result.put("rolled_back_yn", rolledBackOnFail ? "Y" : "N");
            log.info("[ExcelUpload] completion summary hist_id={}, upload_id={}, job_id={}, file_name={}, success_cnt={}, fail_cnt={}, error_file={}",
                    histId, uploadId, jobId, params.get("file_name"), successCnt, failCnt, errFileName);
            if (jobId != null) {
                ProgressStore.setFinalResult(jobId, histId, uploadId, successCnt, failCnt, errFileName, finalStatus);
            }
            if (!failedRowMsgMap.isEmpty()) {
                result.put("failed_row_msgs", failedRowMsgMap);
            }
            uploadResultSupport.clearProgressSessionArtifacts(request, jobId);

        } catch (Throwable e) {
            log.error("[ExcelUpload] 💣 치명적 오류 발생 ({}행 쯤): {}", currentRowForLog, e.getMessage(), e);
            addLog.accept("💣 치명적 오류 (" + currentRowForLog + "행): " + e.getMessage());
            if (jobId != null) {
                ProgressStore.setFinalResult(jobId, histId, uploadId, successCnt, failCnt, errFileName, "err");
                ProgressStore.error(jobId, e.getMessage()); // SSE에 오류 신호
                uploadResultSupport.clearProgressSessionArtifacts(request, jobId);
            }
            if (conn != null) try {
                conn.rollback();
            } catch (Throwable ex) {
            }
            service.closeCache(psCache);
            service.closeWorkbook(wb);
            throw new Exception("\uC5D1\uC140 [ " + currentRowForLog + " \uBC88\uC9F8 \uD589 ] \uCC98\uB9AC \uC911 \uC624\uB958 \uBC1C\uC0DD:\n" + e.getMessage());
        } finally {
            if (conn != null) try {
                conn.close();
            } catch (Throwable e) {
            }
        }
    }


    private String decodeParam(Map<String, Object> params, String b64Key, String plainKey) {
        String b64 = (String) params.get(b64Key);
        if (b64 != null) {
            return service.decodeSafeBase64(b64);
        }
        return plainKey != null ? (String) params.get(plainKey) : null;
    }

    private int parseIntParam(String val, int def) {
        try {
            return Integer.parseInt(val);
        } catch (Throwable e) {
            return def;
        }
    }

    // 2026-06-20: 업로드 런타임 매핑값을 null 없이 문자열로 정규화한다.
    private String trimParam(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    // 2026-06-20: '*' 와일드카드는 실제 세션 MTN이 아니므로 후순위 값으로 보정한다.
    private String firstValidRuntimeValue(String primary, String fallback) {
        if (isRuntimeValueUsable(primary)) {
            return primary.trim();
        }
        return isRuntimeValueUsable(fallback) ? fallback.trim() : "";
    }

    private boolean isRuntimeValueUsable(String value) {
        return value != null && !value.trim().isEmpty() && !"*".equals(value.trim());
    }

    // 2026-06-20: 컨트롤러에서 User 타입 직접 의존 없이 세션 egene.user 값을 읽는다.
    private String getSessionUserValue(HttpServletRequest request, String key) {
        try {
            Object user = request.getSession().getAttribute("egene.user");
            if (user == null || key == null) {
                return "";
            }
            try {
                java.lang.reflect.Method getMethod = user.getClass().getMethod("get", String.class);
                Object value = getMethod.invoke(user, key);
                return trimParam(value);
            } catch (Throwable ignored) {
                java.lang.reflect.Field field = user.getClass().getField(key);
                Object value = field.get(user);
                return trimParam(value);
            }
        } catch (Throwable e) {
            return "";
        }
    }

    private boolean isTruthy(Object value) {
        if (value == null) {
            return false;
        }
        String s = String.valueOf(value).trim().toLowerCase();
        return "y".equals(s) || "yes".equals(s) || "true".equals(s) || "1".equals(s) || "on".equals(s);
    }

    public String jsonToString(Object obj) {
        if (obj == null) {
            return "null";
        }
        if (obj instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) obj;
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) {
                    sb.append(",");
                }
                sb.append(jsonEscape(String.valueOf(e.getKey()))).append(":").append(jsonToString(e.getValue()));
                first = false;
            }
            sb.append("}");
            return sb.toString();
        }
        if (obj instanceof List) {
            List<?> l = (List<?>) obj;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < l.size(); i++) {
                if (i > 0) {
                    sb.append(",");
                }
                sb.append(jsonToString(l.get(i)));
            }
            sb.append("]");
            return sb.toString();
        }
        if (obj instanceof Boolean || obj instanceof Number) {
            return obj.toString();
        }
        return jsonEscape(obj.toString());
    }

    public String jsonEscape(String s) {
        if (s == null) {
            return "\"null\"";
        }
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"') {
                sb.append("\\\"");
            } else if (c == '\\') {
                sb.append("\\\\");
            } else if (c == '\n') {
                sb.append("\\n");
            } else if (c == '\r') {
                sb.append("\\r");
            } else if (c == '\t') {
                sb.append("\\t");
            } else {
                sb.append(c);
            }
        }
        sb.append("\"");
        return sb.toString();
    }
}
