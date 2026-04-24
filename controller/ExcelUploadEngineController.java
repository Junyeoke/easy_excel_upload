// ExcelUploadEngineController.java
package com.steg.lit.controller;

import com.steg.lit.service.ExcelUploadEngineService;        // 추가
import com.steg.lit.repository.ExcelUploadEngineRepository;  // 추가
import com.steg.lit.util.ProgressStore;                      // SSE 진행률 저장소

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

import jakarta.servlet.annotation.MultipartConfig;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import javax.naming.Context;
import javax.naming.InitialContext;
import javax.sql.DataSource;
import java.io.*;
import java.sql.*;
import java.util.*;
import java.io.PrintWriter;

/**
 * =====================================================================
 * [ExcelUploadEngineController] 역할: HTTP 요청 수신 / 파라미터 파싱 / 응답 직렬화만 담당합니다. -
 * Multipart 파일 파싱 (Spring / Servlet3 / Commons-FileUpload / Raw 폴백) - mode 값에
 * 따라 Service 메서드 호출 후 JSON 응답 반환 - JSON 직렬화 유틸 (jsonToString / jsonEscape)
 *
 * ┌─────────────────────────────────────────────────┐ │ Controller → Service →
 * Repository → DB │ └─────────────────────────────────────────────────┘
 * =====================================================================
 */
@Controller
@RequestMapping("/api/excel")
@MultipartConfig(
    maxFileSize       = 200L * 1024 * 1024,  // 파일 최대 200MB
    maxRequestSize    = 210L * 1024 * 1024,  // 요청 최대 210MB
    fileSizeThreshold =   1  * 1024 * 1024   // 1MB 이상은 디스크로 처리 (JEUS getParts() 활성화)
)
public class ExcelUploadEngineController {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadEngineController.class);

    private final ExcelUploadEngineService service;
    private final ExcelUploadEngineRepository repository;

    public ExcelUploadEngineController(ExcelUploadEngineService service,
            ExcelUploadEngineRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    // =====================================================================
    // SSE 진행률 스트리밍 엔드포인트
    // =====================================================================
    /**
     * GET /api/excel/engine/stream?job_id=JOB_xxx
     *
     * 업로드 진행률과 로그를 Server-Sent Events(SSE)로 스트리밍합니다.
     *
     * 클라이언트가 새 EventSource를 열면 이 메서드가 실행되고, ProgressStore에서 500ms마다 최신 상태를 읽어
     * push합니다.
     *
     * 전송 이벤트 포맷: data:
     * {"type":"progress","current":N,"total":M,"percent":P,"logs":["..."]}
     * data: {"type":"done"} data: {"type":"error","msg":"..."} data:
     * {"type":"waiting"} ← Job이 아직 등록 안 됐을 때
     */
    @RequestMapping(value = "/engine/stream", method = RequestMethod.GET)
    public void progressStream(HttpServletRequest request, HttpServletResponse response) {
        String jobId = request.getParameter("job_id");

        if (jobId == null || jobId.trim().isEmpty()) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.setContentType("application/json; charset=UTF-8");
            try {
                response.getWriter().write("{\"status\":\"err\",\"msg\":\"job_id is required\"}");
            } catch (IOException ignore) {
            }
            return;
        }

        // ── 응답 헤더 설정 ────────────────────────────────────────────
        response.setContentType("text/event-stream; charset=UTF-8");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("X-Accel-Buffering", "no");  // Nginx 버퍼링 해제
        response.setStatus(HttpServletResponse.SC_OK);

        // ── SSE 스트리밍 루프 ─────────────────────────────────────────
        // 최대 10분(1200 * 500ms) 대기, 완료 시 조기 종료
        int lastLogIdx = 0;
        final int MAX_ITER = 1200;

        try (PrintWriter writer = response.getWriter()) {

            for (int iter = 0; iter < MAX_ITER; iter++) {

                // 클라이언트 연결이 끊어졌으면 스트림 종료
                if (writer.checkError()) {
                    break;
                }

                ProgressStore.JobProgress prog = ProgressStore.get(jobId);

                // Job이 아직 ProgressStore에 등록되지 않은 경우 (업로드 요청 도달 전)
                if (prog == null) {
                    sseWrite(writer, "{\"type\":\"waiting\"}");
                    Thread.sleep(500);
                    continue;
                }

                // ── 새 로그만 추출 (이전에 보낸 인덱스 이후) ──────────
                List<String> newLogs;
                int currentLogSize;
                synchronized (prog.logs) {
                    currentLogSize = prog.logs.size();
                    newLogs = (lastLogIdx < currentLogSize)
                            ? new ArrayList<>(prog.logs.subList(lastLogIdx, currentLogSize))
                            : Collections.emptyList();
                }
                lastLogIdx = currentLogSize;

                // ── 오류 종료 이벤트 ──────────────────────────────────
                if (prog.done && prog.errorMsg != null) {
                    sseWrite(writer, "{\"type\":\"error\",\"msg\":\"" + sseEscape(prog.errorMsg) + "\"}");
                    break;
                }

                // ── 진행률 이벤트 조립 ────────────────────────────────
                int pct = (prog.total > 0)
                        ? (int) ((double) prog.current / prog.total * 100) : 0;

                StringBuilder sb = new StringBuilder();
                sb.append("{\"type\":\"progress\"")
                        .append(",\"current\":").append(prog.current)
                        .append(",\"total\":").append(prog.total)
                        .append(",\"percent\":").append(pct);

                if (!newLogs.isEmpty()) {
                    sb.append(",\"logs\":[");
                    for (int li = 0; li < newLogs.size(); li++) {
                        if (li > 0) {
                            sb.append(",");
                        }
                        sb.append("\"").append(sseEscape(newLogs.get(li))).append("\"");
                    }
                    sb.append("]");
                }
                sb.append("}");
                sseWrite(writer, sb.toString());

                // ── 정상 완료 이벤트 후 스트림 종료 ──────────────────
                if (prog.done) {
                    sseWrite(writer, "{\"type\":\"done\"}");
                    break;
                }

                Thread.sleep(500);
            }

        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.info("[SSE] 스트림 인터럽트 (jobId={})", jobId);
        } catch (Throwable e) {
            log.info("[SSE] 스트림 예외 종료 (jobId={}): {}", jobId, e.getMessage());
        }
    }

    /**
     * SSE 단일 이벤트 전송
     */
    private void sseWrite(PrintWriter writer, String jsonData) {
        writer.write("data: " + jsonData + "\n\n");
        writer.flush();
    }

    /**
     * SSE JSON 문자열 이스케이프 (jsonEscape와 별도 유지)
     */
    private String sseEscape(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    // =====================================================================
    // 메인 엔드포인트
    // =====================================================================
    @RequestMapping(value = "/engine", method = {RequestMethod.GET, RequestMethod.POST})
    public void processEngine(HttpServletRequest request, HttpServletResponse response) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            request.setCharacterEncoding("UTF-8");

            String mode = request.getParameter("mode");
            if (mode == null) {
                mode = "";
            }

            Map<String, Object> params = new HashMap<>();
            byte[] fileBytes = null;
            byte[] sampleFileBytes = null;
            String sampleFileOrgName = null;
            String contentType = request.getContentType();

            // ── Multipart 파싱 ─────────────────────────────────────────────
            if (contentType != null && contentType.toLowerCase().startsWith("multipart/")) {
                ParsedMultipart parsed = parseMultipart(request);
                params = parsed.params;
                fileBytes = parsed.fileBytes;
                sampleFileBytes = parsed.sampleFileBytes;
                sampleFileOrgName = parsed.sampleFileOrgName;
                if (mode.isEmpty() && params.containsKey("mode")) {
                    mode = (String) params.get("mode");
                }
            } else {
                Enumeration<String> paramNames = request.getParameterNames();
                while (paramNames.hasMoreElements()) {
                    String paramName = paramNames.nextElement();
                    params.put(paramName, request.getParameter(paramName));
                }
                if (mode.isEmpty() && params.containsKey("mode")) {
                    mode = (String) params.get("mode");
                }
            }

            if (mode == null) {
                mode = "";
            }

            // ── DataSource 획득 ────────────────────────────────────────────
            Context ctx = new InitialContext();
            DataSource ds = (DataSource) ((Context) ctx.lookup("java:comp/env")).lookup("egene");

            // =====================================================================
            // mode 분기 처리
            // =====================================================================
            // ── save: 설정 저장 ──────────────────────────────────────────────
            if ("save".equals(mode)) {
                handleSave(ds, params, sampleFileBytes, sampleFileOrgName, result);
            } // ── 조회/다운로드 모드들 ──────────────────────────────────────────
            else if ("get_list".equals(mode)) {
                handleGetList(ds, result); 
            }else if ("get_detail".equals(mode)) {
                handleGetDetail(ds, params, result); 
            }else if ("download_sample".equals(mode)) {
                handleDownloadSample(ds, params, response);
                return;
            } // ← return 추가
            else if ("get_tables".equals(mode)) {
                handleGetTables(ds, response);
                return;
            } // ← return 추가
            else if ("get_columns".equals(mode)) {
                handleGetColumns(ds, request, params, response);
                return;
            } // ← return 추가
            else if ("preview".equals(mode)) {
                handlePreview(fileBytes, params, result); 
            }else if ("download_error".equals(mode)) {
                handleDownloadError(params, response, result);
                return;
            } // ← return 추가
            else if ("get_history".equals(mode)) {
                handleGetHistory(ds, params, result); 
            }else if ("progress".equals(mode)) {
                handleProgress(request, params, result); 
            }// ── upload: 대용량 엑셀 업로드 ───────────────────────────────────
            else if ("upload".equals(mode)) {
                handleUpload(ds, fileBytes, params, request, result, response);
            } else if ("delete".equals(mode)) {
    handleDelete(ds, params, result);
} else if ("clone".equals(mode)) {
    handleClone(ds, params, result);
} else {
    result.put("status", "err");
    result.put("msg", "Unknown mode: " + mode);
}
            

            // ── JSON 응답 출력 ────────────────────────────────────────────────
            if (!response.isCommitted()) {
                response.setContentType("application/json; charset=UTF-8");
                response.getWriter().write(jsonToString(result));
            }

        } catch (Throwable e) {
            log.error("[ExcelUpload] 서버 최상단 에러 캡처: {}", e.getMessage(), e);
            try {
                response.setStatus(200);
            } catch (Throwable ignore) {
            }
            result.put("status", "err");
            result.put("msg", "서버 오류: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
            try {
                response.setContentType("application/json; charset=UTF-8");
                response.getWriter().write(jsonToString(result));
            } catch (Exception ex) {
            }
        }
    }

    // =====================================================================
    // mode 핸들러 메서드
    // =====================================================================
    /**
     * 설정 저장 (INSERT or UPDATE)
     */
    @SuppressWarnings("unchecked")
    private void handleSave(DataSource ds, Map<String, Object> params,
            byte[] sampleFileBytes, String sampleFileOrgName,
            Map<String, Object> result) throws Exception {
        Connection conn = null;
        try {
            conn = ds.getConnection();
            conn.setAutoCommit(false);

            String uploadId = (String) params.get("upload_id");
            boolean isUpdate = uploadId != null && !uploadId.trim().isEmpty() && !"undefined".equals(uploadId);

            // UniqueKey로 신규 ID 발급
            Object ukeyObj = null;
            try {
                Class<?> ukClass = Class.forName("org.sdf.util.UniqueKey");
                ukeyObj = ukClass.getMethod("getInstance").invoke(null);
            } catch (Throwable e) {
                throw new Exception("UniqueKey 라이브러리를 찾을 수 없습니다.");
            }

            if (!isUpdate) {
                uploadId = (String) ukeyObj.getClass().getMethod("fetchNewKey").invoke(ukeyObj);
            }

            // 샘플 파일 저장 처리
            String savedSampleFileName = null, savedSampleFileOrgName = null;
            if (sampleFileBytes != null && sampleFileBytes.length > 0) {
                String requestedDownloadName = (String) params.get("sample_file_download_name");
                savedSampleFileOrgName = (requestedDownloadName != null && !requestedDownloadName.trim().isEmpty())
                        ? requestedDownloadName.trim()
                        : (sampleFileOrgName != null && !sampleFileOrgName.trim().isEmpty() ? sampleFileOrgName : "sample.xlsx");
                String dirPath = service.getSampleFileDir();
                String fileExt = savedSampleFileOrgName.contains(".")
                        ? savedSampleFileOrgName.substring(savedSampleFileOrgName.lastIndexOf(".")) : ".xlsx";
                savedSampleFileName = uploadId + "_sample" + fileExt;
                try (FileOutputStream fos = new FileOutputStream(new java.io.File(dirPath, savedSampleFileName))) {
                    fos.write(sampleFileBytes);
                } catch (Throwable fex) {
                    throw new Exception("샘플 파일 저장 실패: " + fex.getMessage());
                }
            } else if (isUpdate) {
                String[] info = repository.getSampleFileInfo(conn, uploadId);
                if (info != null) {
                    savedSampleFileName = info[0];
                    savedSampleFileOrgName = info[1];
                }
            }

            // 파라미터 디코딩
            Map<String, Object> configData = new LinkedHashMap<>();
            configData.put("upload_id", uploadId);
            configData.put("is_update", isUpdate);
            configData.put("job_name", service.restore(decodeParam(params, "job_name_b64", "job_name")));
            configData.put("header_row", parseIntParam((String) params.get("header_row"), 1));
            configData.put("struct_json", service.restore(decodeParam(params, "struct_json_b64", "struct_json")));
            configData.put("mapping_json", service.restore(decodeParam(params, "mapping_json_b64", "mapping_json")));
            configData.put("pre_sql_json", service.restore(decodeParam(params, "pre_sql_json_b64", "pre_sql_json")));
            configData.put("post_sql_json", service.restore(decodeParam(params, "post_sql_json_b64", "post_sql_json")));
            configData.put("row_sql_json", service.restore(decodeParam(params, "row_sql_json_b64", "row_sql_json")));
            configData.put("instructions", service.restore(decodeParam(params, "instructions_b64", "instructions")));
            configData.put("sample_file_name", savedSampleFileName);
            configData.put("sample_file_org_name", savedSampleFileOrgName);

            String savedId = repository.saveConfig(conn, configData);
            conn.commit();
            result.put("status", "ok");
            result.put("upload_id", savedId);

        } catch (Throwable e) {
            if (conn != null) try {
                conn.rollback();
            } catch (Throwable ignore) {
            }
            log.error("[ExcelUpload] 설정 저장 중 오류 발생: {}", e.getMessage(), e);
            throw new Exception("저장 중 오류 발생: " + e.getMessage(), e);
        } finally {
            if (conn != null) try {
                conn.close();
            } catch (Throwable ignore) {
            }
        }
    }

    /**
     * 설정 전체 목록 조회
     */
    private void handleGetList(DataSource ds, Map<String, Object> result) throws Exception {
        try (Connection conn = ds.getConnection()) {
            List<Map<String, Object>> list = repository.getConfigList(conn);
            result.put("status", "ok");
            result.put("list", list);
        }
    }

    /**
     * 설정 단건 조회
     */
    private void handleGetDetail(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        try (Connection conn = ds.getConnection()) {
            Map<String, Object> row = repository.getConfigDetail(conn, (String) params.get("upload_id"));
            if (row != null) {
                result.put("status", "ok");
                result.putAll(row);
            } else {
                result.put("status", "err");
                result.put("msg", "해당 ID의 설정을 찾을 수 없습니다.");
            }
        }
    }

    /**
     * 샘플 파일 다운로드
     */
    private void handleDownloadSample(DataSource ds, Map<String, Object> params,
            HttpServletResponse response) throws Exception {
        try (Connection conn = ds.getConnection()) {
            String[] info = repository.getSampleFileInfo(conn, (String) params.get("upload_id"));
            if (info != null && info[0] != null && !info[0].trim().isEmpty()) {
                java.io.File sampleFile = new java.io.File(service.getSampleFileDir(), info[0]);
                if (sampleFile.exists() && sampleFile.isFile()) {
                    String downloadName = (info[1] != null && !info[1].trim().isEmpty()) ? info[1] : info[0];
                    response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                    response.setHeader("Content-Disposition",
                            "attachment; filename=\"" + java.net.URLEncoder.encode(downloadName, "UTF-8").replace("+", "%20") + "\"");
                    try {
                        response.setHeader("Content-Length", String.valueOf(sampleFile.length()));
                    } catch (Throwable ignore) {
                    }
                    try (FileInputStream fis = new FileInputStream(sampleFile); BufferedOutputStream bos = new BufferedOutputStream(response.getOutputStream())) {
                        byte[] buffer = new byte[8192];
                        int n;
                        while ((n = fis.read(buffer)) != -1) {
                            bos.write(buffer, 0, n);
                        }
                        bos.flush();
                    }
                }
            }
        }
    }

    /**
     * 테이블 목록 조회
     */
    private void handleGetTables(DataSource ds, HttpServletResponse response) throws Exception {
        try (Connection conn = ds.getConnection()) {
            String sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name";
            try {
                String dbProd = conn.getMetaData().getDatabaseProductName();
                if (dbProd != null && (dbProd.toLowerCase().contains("oracle") || dbProd.toLowerCase().contains("tibero"))) {
                    sql = "SELECT table_name FROM user_tables ORDER BY table_name";
                }
            } catch (Throwable ignore) {
            }
            List<Map<String, String>> list = new ArrayList<>();
            try (PreparedStatement pstmt = conn.prepareStatement(sql); ResultSet rs = pstmt.executeQuery()) {
                while (rs.next()) {
                    Map<String, String> o = new LinkedHashMap<>();
                    o.put("value", rs.getString(1));
                    o.put("label", rs.getString(1));
                    list.add(o);
                }
            }
            response.setContentType("application/json; charset=UTF-8");
            response.getWriter().write(jsonToString(list));
        }
    }

    /**
     * 컬럼 목록 조회
     */
    private void handleGetColumns(DataSource ds, HttpServletRequest request,
            Map<String, Object> params,
            HttpServletResponse response) throws Exception {
        // GET 파라미터 먼저, 없으면 multipart params 맵에서 읽기
        String t = request.getParameter("table_name");
        if (t == null || t.trim().isEmpty()) {
            t = (String) params.get("table_name");
        }
        if (!service.isValidSqlIdentifier(t)) {
            response.getWriter().write("[]");
            return;
        }
        try (Connection conn = ds.getConnection(); PreparedStatement pstmt = conn.prepareStatement("SELECT * FROM " + t + " WHERE 1=0"); ResultSet rs = pstmt.executeQuery()) {
            ResultSetMetaData m = rs.getMetaData();
            List<Map<String, String>> list = new ArrayList<>();
            for (int i = 1; i <= m.getColumnCount(); i++) {
                Map<String, String> o = new LinkedHashMap<>();
                String c = m.getColumnLabel(i).toLowerCase();
                o.put("value", c);
                o.put("label", c);
                list.add(o);
            }
            response.setContentType("application/json; charset=UTF-8");
            response.getWriter().write(jsonToString(list));
        }
    }

    /**
     * 엑셀 미리보기 (페이징)
     */
    private void handlePreview(byte[] fileBytes, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        if (fileBytes == null || fileBytes.length == 0) {
            throw new Exception("파일이 없습니다.");
        }

        int headerIdx = 0;
        try {
            headerIdx = Integer.parseInt((String) params.get("header_row")) - 1;
        } catch (Throwable e) {
        }
        if (headerIdx < 0) {
            headerIdx = 0;
        }
        int page = 1;
        try {
            page = Integer.parseInt((String) params.get("page"));
        } catch (Throwable e) {
        }
        int pageSize = 20;
        try {
            pageSize = Integer.parseInt((String) params.get("page_size"));
        } catch (Throwable e) {
        }
        if (pageSize < 1) {
            pageSize = 20;
        
        }if (pageSize > 500) {
            pageSize = 500;
        }

        org.apache.poi.ss.usermodel.Workbook wb = service.createWorkbook(fileBytes);
        try {
            org.apache.poi.ss.usermodel.Sheet sheet = wb.getSheetAt(0);
            org.apache.poi.ss.usermodel.Row headerRow = sheet.getRow(headerIdx);
            if (headerRow == null || headerRow.getLastCellNum() <= 0) {
                throw new Exception((headerIdx + 1) + "번째 줄에 헤더가 없습니다.");
            }

            int colCount = headerRow.getLastCellNum();
            List<String> headers = new ArrayList<>();
            for (int i = 0; i < colCount; i++) {
                String hVal = service.getCellValue(headerRow.getCell(i));
                headers.add(hVal.trim().isEmpty() ? "미확인_컬럼_" + (i + 1) : hVal);
            }

            List<Integer> dataRowIdxs = new ArrayList<>();
            for (int i = headerIdx + 1; i <= sheet.getLastRowNum(); i++) {
                org.apache.poi.ss.usermodel.Row r = sheet.getRow(i);
                if (r == null) continue;
                // ✅ [Fix] 0번 셀만 보지 않고 모든 셀 중 하나라도 값이 있으면 데이터 행으로 인식
                // 서식(배경색·테두리)만 있는 빈 행은 자연스럽게 제외됨
                boolean hasValue = false;
                int lastCell = r.getLastCellNum();
                for (int ci = 0; ci < lastCell; ci++) {
                    if (!service.getCellValue(r.getCell(ci)).trim().isEmpty()) {
                        hasValue = true;
                        break;
                    }
                }
                if (hasValue) dataRowIdxs.add(i);
            }
            int totalDataRows = dataRowIdxs.size();
            int totalPages = (int) Math.ceil((double) totalDataRows / pageSize);
            int startIdx = (page - 1) * pageSize;
            int endIdx = Math.min(startIdx + pageSize, totalDataRows);

            List<Map<String, String>> previewRows = new ArrayList<>();
            for (int i = startIdx; i < endIdx; i++) {
                org.apache.poi.ss.usermodel.Row row = sheet.getRow(dataRowIdxs.get(i));
                if (row == null) {
                    continue;
                }
                Map<String, String> rowData = new LinkedHashMap<>();
                rowData.put("_rowNum", String.valueOf(dataRowIdxs.get(i) - headerIdx));
                for (int j = 0; j < colCount; j++) {
                    rowData.put(String.valueOf(j), service.getCellValue(row.getCell(j)));
                }
                previewRows.add(rowData);
            }
            result.put("status", "ok");
            result.put("headers", headers);
            result.put("preview", previewRows);
            result.put("total_rows", totalDataRows);
            result.put("total_pages", totalPages);
            result.put("page", page);
            result.put("page_size", pageSize);
            result.put("header_count", colCount);
        } finally {
            service.closeWorkbook(wb);
        }
    }

    /**
     * 오류 리포트 다운로드
     */
    private void handleDownloadError(Map<String, Object> params, HttpServletResponse response,
            Map<String, Object> result) throws Exception {
        String errFile = (String) params.get("error_file");
        if (errFile != null && !errFile.trim().isEmpty()) {
            java.io.File file = new java.io.File(service.getSampleFileDir(), errFile);
            if (file.exists() && file.isFile()) {
                response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                response.setHeader("Content-Disposition", "attachment; filename=\"Error_Report_Failed_Rows.xlsx\"");
                try {
                    response.setHeader("Content-Length", String.valueOf(file.length()));
                } catch (Throwable ignore) {
                }
                try (FileInputStream fis = new FileInputStream(file); BufferedOutputStream bos = new BufferedOutputStream(response.getOutputStream())) {
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = fis.read(buffer)) != -1) {
                        bos.write(buffer, 0, n);
                    }
                    bos.flush();
                }
                return;
            }
        }
        result.put("status", "err");
        result.put("msg", "오류 리포트 파일이 존재하지 않습니다.");
    }

    /**
     * 업로드 이력 조회
     */
    private void handleGetHistory(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        try (Connection conn = ds.getConnection()) {
            List<Map<String, Object>> list = repository.getHistory(conn, (String) params.get("upload_id"));
            result.put("status", "ok");
            result.put("list", list);
        }
    }

    /**
 * 설정 삭제
 */
private void handleDelete(DataSource ds, Map<String, Object> params,
        Map<String, Object> result) throws Exception {
    String uploadId = (String) params.get("upload_id");
    if (uploadId == null || uploadId.trim().isEmpty()) {
        result.put("status", "err");
        result.put("msg", "upload_id가 필요합니다.");
        return;
    }
    Connection conn = null;
    try {
        conn = ds.getConnection();
        conn.setAutoCommit(false);
        repository.deleteConfig(conn, uploadId);
        conn.commit();
        result.put("status", "ok");
        result.put("msg", "삭제 완료");
    } catch (Throwable e) {
        if (conn != null) try { conn.rollback(); } catch (Throwable ignore) {}
        log.error("[ExcelUpload] 설정 삭제 오류: {}", e.getMessage(), e);
        throw new Exception("삭제 중 오류: " + e.getMessage());
    } finally {
        if (conn != null) try { conn.close(); } catch (Throwable ignore) {}
    }
}

/**
 * 설정 복제
 */
private void handleClone(DataSource ds, Map<String, Object> params,
        Map<String, Object> result) throws Exception {
    String sourceId = (String) params.get("upload_id");
    if (sourceId == null || sourceId.trim().isEmpty()) {
        result.put("status", "err");
        result.put("msg", "upload_id가 필요합니다.");
        return;
    }
    Connection conn = null;
    try {
        // 새 ID 발급
        Object ukeyObj = null;
        String newId;
        try {
            Class<?> ukClass = Class.forName("org.sdf.util.UniqueKey");
            ukeyObj = ukClass.getMethod("getInstance").invoke(null);
            newId = (String) ukeyObj.getClass().getMethod("fetchNewKey").invoke(ukeyObj);
        } catch (Throwable e) {
            throw new Exception("UniqueKey 라이브러리를 찾을 수 없습니다.");
        }

        conn = ds.getConnection();
        conn.setAutoCommit(false);
        String nowFunc = repository.detectNowFunction(conn);
        String clonedId = repository.cloneConfig(conn, sourceId, newId, nowFunc);
        conn.commit();
        result.put("status", "ok");
        result.put("msg", "복제 완료");
        result.put("new_upload_id", clonedId);
    } catch (Throwable e) {
        if (conn != null) try { conn.rollback(); } catch (Throwable ignore) {}
        log.error("[ExcelUpload] 설정 복제 오류: {}", e.getMessage(), e);
        throw new Exception("복제 중 오류: " + e.getMessage());
    } finally {
        if (conn != null) try { conn.close(); } catch (Throwable ignore) {}
    }
}

    /**
     * 업로드 진행 상황 조회 (폴링 폴백용 — SSE 미지원 환경 대비)
     */
    @SuppressWarnings("unchecked")
    private void handleProgress(HttpServletRequest request, Map<String, Object> params,
            Map<String, Object> result) {
        String jobId = (String) params.get("job_id");
        if (jobId == null || jobId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "job_id가 필요합니다.");
            return;
        }

        // ① ProgressStore 우선 조회
        ProgressStore.JobProgress prog = ProgressStore.get(jobId);
        if (prog != null) {
            result.put("status", "ok");
            result.put("current", prog.current);
            result.put("total", prog.total);
            result.put("percent", prog.total > 0
                    ? (int) ((double) prog.current / prog.total * 100) : 0);
            synchronized (prog.logs) {
                result.put("logs", new ArrayList<>(prog.logs));
            }
            return;
        }

        // ② ProgressStore에 없으면 세션 폴백 (구버전 호환)
        String progObj = (String) request.getSession().getAttribute("EXCEL_PROGRESS_" + jobId);
        if (progObj == null) {
            result.put("status", "none");
        } else {
            String[] parts = progObj.split("/");
            int current = Integer.parseInt(parts[0]), total = Integer.parseInt(parts[1]);
            result.put("status", "ok");
            result.put("current", current);
            result.put("total", total);
            result.put("percent", total > 0 ? (int) (((double) current / total) * 100) : 0);
            List<?> sessionLogs = (List<?>) request.getSession().getAttribute("EXCEL_LOGS_" + jobId);
            if (sessionLogs != null) {
                synchronized (sessionLogs) {
                    result.put("logs", new ArrayList<>(sessionLogs));
                }
            }
        }
    }

    /**
     * 엑셀 업로드 처리 (대용량 Batch 최적화)
     */
    @SuppressWarnings("unchecked")
    private void handleUpload(DataSource ds, byte[] fileBytes, Map<String, Object> params,
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
        int actualTotalRows = Math.max(totalRows - startRow + 1, 0);
        log.info("[ExcelUpload] 파싱 완료 - 대상 데이터 총 {}행 감지 ({}행부터 시작)", actualTotalRows, startRow + 1);

        Connection conn = null;
        int currentRowForLog = headerIdx + 1;
        Map<String, Object> psCache = new HashMap<>();
        Map<String, List<String>> sqlParamOrderCache = new HashMap<>();
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
        String errFileName = null;

        try {
            ExcelUploadEngineRepository.FastSequenceManager seqMgr
                    = new ExcelUploadEngineRepository.FastSequenceManager(ds, blockSize);
            conn = ds.getConnection();

            String nowFuncU = repository.detectNowFunction(conn);

            repository.ensureHistoryTable(conn, nowFuncU);
            conn.setAutoCommit(false);
            repository.ensureTempUploadKeysTable(conn);

            addLog.accept("🔌 DB 연결 완료");

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
                addLog.accept("⚙️ Pre-SQL 실행 중...");
                service.executeSqlArray(conn, preSqls, "Pre-SQL");
                conn.commit();
                addLog.accept("✅ Pre-SQL 완료");
                log.info("[ExcelUpload] Pre-SQL 완료");
            }

            int[] counters = {0, 0}; // [성공, 실패]
            org.apache.poi.ss.usermodel.DataFormatter dataFormatter =
                    new org.apache.poi.ss.usermodel.DataFormatter();
            org.apache.poi.ss.usermodel.FormulaEvaluator formulaEvaluator =
                    wb.getCreationHelper().createFormulaEvaluator();

            addLog.accept("▶️ 데이터 행 삽입 시작...");

            // 행별 처리
            for (int rowIdx = startRow; rowIdx <= totalRows; rowIdx++) {
                currentRowForLog = rowIdx + 1;
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
                    int dataRowNum = row.getRowNum() - headerIdx;
                    addLog.accept("🔍 [" + dataRowNum + "행] 상세 업로드 계획 시작");
                    try {
                        debugCascadePlan(row, structs, allMaps, "ROOT", null, rowSqls, metaMap, addLog, dataRowNum);
                    } catch (Throwable debugEx) {
                        addLog.accept("⚠️ [" + dataRowNum + "행] 상세 로그 생성 실패: " + debugEx.getMessage());
                        log.info("[ExcelUpload][Debug] {}행 상세 로그 생성 실패: {}", dataRowNum, debugEx.getMessage());
                    }
                    addLog.accept("🔍 [" + dataRowNum + "행] 상세 업로드 계획 종료");
                    debugLoggedRows++;
                    if (debugLoggedRows == debugRowLimit) {
                        addLog.accept("🔎 상세 로그 행 제한 도달: 이후 행은 요약 로그만 출력됩니다.");
                    }
                }

                try {
                    service.cascadeExcelInsert(conn, row, structs, allMaps, "ROOT", null,
                            iceObj, ukeyObj, metaMap, rowSqls, psCache, sqlParamOrderCache, seqMgr,
                            dataFormatter, formulaEvaluator);
                } catch (Exception rowEx) {
                    errorRows.add(row);
                    errorMsgs.add(rowEx.getMessage());
                    int dataRowNum = row.getRowNum() - headerIdx; // 1-based 데이터 행 번호
                    failedRowMsgMap.put(String.valueOf(dataRowNum), rowEx.getMessage() != null ? rowEx.getMessage() : "알 수 없는 오류");
                    failedExcelRowNums.add(String.valueOf(dataRowNum));
                    addLog.accept("❌ " + currentRowForLog + "행 오류: " + rowEx.getMessage());
                    log.info("[ExcelUpload] ⚠ {}행 개별 오류: {}", currentRowForLog, rowEx.getMessage());
                    counters[1]++; 
                }

                // 진행률 업데이트 (100행마다)
                if (jobId != null && (rowIdx - startRow + 1) % 100 == 0) {
                    int done = rowIdx - startRow + 1;
                    request.getSession().setAttribute("EXCEL_PROGRESS_" + jobId, done + "/" + actualTotalRows); // 폴백 유지
                    ProgressStore.update(jobId, done);
                    addLog.accept("📋 " + done + " / " + actualTotalRows + " 행 처리 중...");
                }

                // 5000행마다 Batch flush
                if ((rowIdx - startRow + 1) % 5000 == 0) {
                    int done = rowIdx - startRow + 1;
                    log.info("[ExcelUpload] {} / {} 행 처리 중 - Batch Flush...", done, actualTotalRows);
                    addLog.accept("💾 " + done + "행 배치 저장 중...");
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
                    conn.commit();
                    addLog.accept("✅ " + done + "행 배치 저장 완료");
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
            conn.commit();

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
            log.info("[ExcelUpload] Batch 처리 완료 - 성공(row): {}건, 실패(row): {}건, 처리(row): {}건 (배치성공:{}건/배치실패:{}건, 식별실패행:{}건, 미식별실패:{}건)",
                successCnt, failCnt, processedExcelRowCnt, counters[0], counters[1], failedExcelRowNums.size(), unknownFailCnt);
            addLog.accept("🎉 완료! 성공: " + successCnt + "건" + (failCnt > 0 ? ", 실패: " + failCnt + "건" : ""));

            // 최종 진행률 100% 세팅
            if (jobId != null) {
                request.getSession().setAttribute("EXCEL_PROGRESS_" + jobId, actualTotalRows + "/" + actualTotalRows);
                ProgressStore.update(jobId, actualTotalRows);
                ProgressStore.complete(jobId);
            }

            // 오류 리포트 생성
            if (!errorRows.isEmpty()) {
                addLog.accept("📄 오류 리포트 생성 중...");
                errFileName = service.buildErrorReport(jobId, sheet, headerIdx, errorRows, errorMsgs, allMaps);
                addLog.accept("📄 오류 리포트 생성 완료: " + errFileName);
            }

            service.closeWorkbook(wb);

            // 이력 저장
            repository.insertHistory(conn, UUID.randomUUID().toString(),
                    (String) params.get("job_name"), (String) params.get("file_name"),
                    successCnt, failCnt, errFileName, nowFuncU);

            // Post-SQL 실행
            if (postSqls != null && !postSqls.isEmpty()) {
                log.info("[ExcelUpload] Post-SQL 실행 시작...");
                addLog.accept("⚙️ Post-SQL 실행 중...");
                try {
                    service.executeSqlArray(conn, postSqls, "Post-SQL");
                    conn.commit();
                    addLog.accept("✅ Post-SQL 완료");
                    log.info("[ExcelUpload] Post-SQL 완료");
                } catch (Throwable e) {
                    log.error("[ExcelUpload] Post-SQL 중 오류 발생: {}", e.getMessage(), e);
                    addLog.accept("❌ Post-SQL 오류: " + e.getMessage());
                    result.put("status", failCnt > 0 ? "partial" : "ok");
                    result.put("msg", successCnt + "건 성공, " + failCnt + "건 실패 (Post-SQL 오류: " + e.getMessage() + ")");
                    result.put("success_cnt", successCnt);
                    result.put("fail_cnt", failCnt);
                    result.put("error_file", errFileName);
                    if (!failedRowMsgMap.isEmpty()) {
                        result.put("failed_row_msgs", failedRowMsgMap);
                    }
                    response.setContentType("application/json; charset=UTF-8");
                    response.getWriter().write(jsonToString(result));
                    return;
                }
            }

            long elapsed = System.currentTimeMillis() - processStartTime;
            log.info("=====================================================");
            log.info("[ExcelUpload] 🎉 업로드 프로세스 종료 - 총 소요시간: {} ms", elapsed);
            log.info("[ExcelUpload] 최종 결과 - 성공: {}건, 실패: {}건", successCnt, failCnt);
            log.info("=====================================================");

            result.put("status", failCnt > 0 ? "partial" : "ok");
            result.put("msg", successCnt + "건 성공" + (failCnt > 0 ? ", " + failCnt + "건 실패" : ""));
            result.put("success_cnt", successCnt);
            result.put("fail_cnt", failCnt);
            result.put("error_file", errFileName);
            if (!failedRowMsgMap.isEmpty()) {
                result.put("failed_row_msgs", failedRowMsgMap);
            }

        } catch (Throwable e) {
            log.error("[ExcelUpload] 💣 치명적 오류 발생 ({}행 쯤): {}", currentRowForLog, e.getMessage(), e);
            addLog.accept("💣 치명적 오류 (" + currentRowForLog + "행): " + e.getMessage());
            if (jobId != null) {
                ProgressStore.error(jobId, e.getMessage()); // SSE에 오류 신호

                        }if (conn != null) try {
                conn.rollback();
            } catch (Throwable ex) {
            }
            service.closeCache(psCache);
            service.closeWorkbook(wb);
            throw new Exception("엑셀 [ " + currentRowForLog + " 번째 행 ] 처리 중 오류 발생:\n" + e.getMessage());
        } finally {
            if (conn != null) try {
                conn.close();
            } catch (Throwable e) {
            }
        }
    }

    // =====================================================================
    // Multipart 파싱
    // =====================================================================
    private static class ParsedMultipart {

        Map<String, Object> params = new HashMap<>();
        byte[] fileBytes;
        byte[] sampleFileBytes;
        String sampleFileOrgName;
    }

    @SuppressWarnings("unchecked")
    private ParsedMultipart parseMultipart(HttpServletRequest request) throws Exception {
        ParsedMultipart out = new ParsedMultipart();
        boolean isParsed = false;

        // 시도 1: Spring MultipartRequest
        try {
            Class<?> multiReqClass = Class.forName("org.springframework.web.multipart.MultipartRequest");
            Object cur = request;
            Object multipartReqObj = null;
            for (int depth = 0; depth < 10; depth++) {
                if (multiReqClass.isInstance(cur)) {
                    multipartReqObj = cur;
                    break;
                }
                Object next = null;
                try {
                    next = cur.getClass().getMethod("getRequest").invoke(cur);
                } catch (Throwable ig) {
                }
                if (next == null) try {
                    next = cur.getClass().getMethod("getWrappedRequest").invoke(cur);
                } catch (Throwable ig) {
                }
                if (next == null || next == cur) {
                    break;
                }
                cur = next;
            }
            if (multipartReqObj != null && multiReqClass.isInstance(multipartReqObj)) {
                java.util.Map<?, ?> paramMap = (java.util.Map<?, ?>) multipartReqObj.getClass().getMethod("getParameterMap").invoke(multipartReqObj);
                for (Map.Entry<?, ?> e : paramMap.entrySet()) {
                    String k = String.valueOf(e.getKey());
                    Object v = e.getValue();
                    if (v instanceof String[]) {
                        if (((String[]) v).length > 0) {
                            out.params.put(k, ((String[]) v)[0]);
                    
                        }} else if (v != null) {
                        out.params.put(k, v.toString());
                    }
                }
                Class<?> fileClass = Class.forName("org.springframework.web.multipart.MultipartFile");
                Object fileObj = multiReqClass.getMethod("getFile", String.class).invoke(multipartReqObj, "file");
                if (fileObj != null) {
                    out.fileBytes = service.readStreamToBytes((InputStream) fileClass.getMethod("getInputStream").invoke(fileObj));
                }
                Object sampleFileObj = multiReqClass.getMethod("getFile", String.class).invoke(multipartReqObj, "sample_file");
                if (sampleFileObj != null) {
                    out.sampleFileBytes = service.readStreamToBytes((InputStream) fileClass.getMethod("getInputStream").invoke(sampleFileObj));
                    out.sampleFileOrgName = (String) fileClass.getMethod("getOriginalFilename").invoke(sampleFileObj);
                }
                isParsed = true;
                log.info("[Multipart] 시도 1 (Spring MultipartRequest) 파싱 성공");
            }
        } catch (Throwable ignore) {
            log.info("[Multipart] 시도 1 (Spring MultipartRequest) 실패: {} → 다음 파싱 방식으로 폴백", ignore.getMessage());
        }
        if (!isParsed) {
            try {
                java.util.Collection<?> parts = (java.util.Collection<?>) request.getClass().getMethod("getParts").invoke(request);
                for (Object p : parts) {
                    String pName = (String) p.getClass().getMethod("getName").invoke(p);
                    long pSize = (Long) p.getClass().getMethod("getSize").invoke(p);
                    if (pSize > 0) {
                        if ("file".equals(pName)) {
                            out.fileBytes = service.readStreamToBytes((InputStream) p.getClass().getMethod("getInputStream").invoke(p));
                        } else if ("sample_file".equals(pName)) {
                            out.sampleFileBytes = service.readStreamToBytes((InputStream) p.getClass().getMethod("getInputStream").invoke(p));
                            try {
                                out.sampleFileOrgName = (String) p.getClass().getMethod("getSubmittedFileName").invoke(p);
                            } catch (Throwable ex) {
                                out.sampleFileOrgName = "sample.xlsx";
                            }
                        } else {
                            Scanner sc = new Scanner((InputStream) p.getClass().getMethod("getInputStream").invoke(p), "UTF-8").useDelimiter("\\A");
                            out.params.put(pName, sc.hasNext() ? sc.next() : "");
                            sc.close();
                        }
                    }
                }
                // ✅ [JEUS Fix] 빈 컬렉션 반환 시에도 isParsed=true가 되던 버그 수정
                // 파일이 실제로 수신된 경우에만 파싱 성공으로 간주
                if (out.fileBytes != null && out.fileBytes.length > 0) {
                    isParsed = true;
                    log.info("[Multipart] 시도 2 (getParts) 파싱 성공");
                } else {
                    log.info("[Multipart] 시도 2 (getParts) 호출은 됐으나 파일 없음 → 다음 파싱 방식으로 폴백");
                }
            } catch (Throwable ignore) {
                log.info("[Multipart] 시도 2 (getParts) 실패: {} → 다음 파싱 방식으로 폴백", ignore.getMessage());
            }
        }

        // 시도 3: Apache Commons FileUpload
        if (!isParsed) {
            try {
                Class<?> sfuClass = Class.forName("org.apache.commons.fileupload.servlet.ServletFileUpload");
                Class<?> dfifClass = Class.forName("org.apache.commons.fileupload.disk.DiskFileItemFactory");
                Class<?> fiFactoryClass = Class.forName("org.apache.commons.fileupload.FileItemFactory");
                Object factory = dfifClass.getDeclaredConstructor().newInstance();
                Object upload = sfuClass.getConstructor(fiFactoryClass).newInstance(factory);
                sfuClass.getMethod("setHeaderEncoding", String.class).invoke(upload, "UTF-8");
                java.lang.reflect.Method parseMethod = null;
                for (java.lang.reflect.Method m : sfuClass.getMethods()) {
                    if (m.getName().equals("parseRequest") && m.getParameterTypes().length == 1) {
                        parseMethod = m;
                        break;
                    }
                }
                if (parseMethod != null) {
                    List<?> fileItems = (List<?>) parseMethod.invoke(upload, request);
                    for (Object item : fileItems) {
                        boolean isForm = (Boolean) item.getClass().getMethod("isFormField").invoke(item);
                        String fieldName = (String) item.getClass().getMethod("getFieldName").invoke(item);
                        if (isForm) {
                            out.params.put(fieldName, item.getClass().getMethod("getString", String.class).invoke(item, "UTF-8"));
                        } else {
                            long size = (Long) item.getClass().getMethod("getSize").invoke(item);
                            if (size > 0) {
                                InputStream is = (InputStream) item.getClass().getMethod("getInputStream").invoke(item);
                                if ("file".equals(fieldName)) {
                                    out.fileBytes = service.readStreamToBytes(is); 
                                }else if ("sample_file".equals(fieldName)) {
                                    out.sampleFileBytes = service.readStreamToBytes(is);
                                    String n = (String) item.getClass().getMethod("getName").invoke(item);
                                    out.sampleFileOrgName = (n != null && n.contains("\\")) ? n.substring(n.lastIndexOf("\\") + 1) : n;
                                }
                            }
                        }
                    }
                    isParsed = true;
                    log.info("[Multipart] 시도 3 (Commons FileUpload) 파싱 성공");
                }
            } catch (Throwable ignore) {
                log.info("[Multipart] 시도 3 (Commons FileUpload) 실패: {} → Raw 파싱으로 폴백", ignore.getMessage());
            }
        }
        if (!isParsed) {
            try {
                String ct = request.getContentType();
                String boundary = null;
                for (String seg : ct.split(";")) {
                    String s = seg.trim();
                    if (s.toLowerCase().startsWith("boundary=")) {
                        boundary = s.substring(9).trim();
                        if (boundary.startsWith("\"") && boundary.endsWith("\"")) {
                            boundary = boundary.substring(1, boundary.length() - 1);
                        }
                        break;
                    }
                }
                if (boundary != null) {
                    byte[] boundaryBytes = ("--" + boundary).getBytes("ISO-8859-1");
                    byte[] bodyBytes = service.readStreamToBytes(request.getInputStream());
                    int bLen = boundaryBytes.length;
                    List<int[]> partRanges = new ArrayList<>();
                    int partStart = -1;
                    for (int i = 0; i <= bodyBytes.length - bLen; i++) {
                        boolean match = true;
                        for (int j = 0; j < bLen; j++) {
                            if (bodyBytes[i + j] != boundaryBytes[j]) {
                                match = false;
                                break;
                            }
                        }
                        if (!match) {
                            continue;
                        }
                        if (partStart >= 0) {
                            partRanges.add(new int[]{partStart, i - 2});
                        }
                        if (i + bLen + 1 < bodyBytes.length && bodyBytes[i + bLen] == '-' && bodyBytes[i + bLen + 1] == '-') {
                            break;
                        }
                        partStart = i + bLen + 2;
                        i += bLen - 1;
                    }
                    for (int[] range : partRanges) {
                        if (range[1] <= range[0]) {
                            continue;
                        }
                        byte[] partBytes = new byte[range[1] - range[0]];
                        System.arraycopy(bodyBytes, range[0], partBytes, 0, partBytes.length);
                        int headerEnd = -1;
                        for (int i = 0; i < partBytes.length - 3; i++) {
                            if (partBytes[i] == 13 && partBytes[i + 1] == 10 && partBytes[i + 2] == 13 && partBytes[i + 3] == 10) {
                                headerEnd = i;
                                break;
                            }
                        }
                        if (headerEnd < 0) {
                            continue;
                        }
                        String headerStr = new String(partBytes, 0, headerEnd, "UTF-8");
                        byte[] bodyPart = new byte[partBytes.length - headerEnd - 4];
                        System.arraycopy(partBytes, headerEnd + 4, bodyPart, 0, bodyPart.length);
                        String fieldName = null, fileName = null;
                        for (String hLine : headerStr.split("\r\n")) {
                            if (hLine.toLowerCase().startsWith("content-disposition:")) {
                                for (String seg : hLine.split(";")) {
                                    String s = seg.trim();
                                    if (s.startsWith("name=")) {
                                        fieldName = s.substring(5).replace("\"", "").trim(); 
                                    }else if (s.startsWith("filename=")) {
                                        fileName = s.substring(9).replace("\"", "").trim();
                                    }
                                }
                            }
                        }
                        if (fieldName == null) {
                            continue;
                        }
                        if (fileName != null && bodyPart.length > 0) {
                            if ("file".equals(fieldName)) {
                                out.fileBytes = bodyPart; 
                            }else if ("sample_file".equals(fieldName)) {
                                out.sampleFileBytes = bodyPart;
                                out.sampleFileOrgName = fileName.contains("\\") ? fileName.substring(fileName.lastIndexOf("\\") + 1) : fileName;
                            }
                        } else {
                            out.params.put(fieldName, new String(bodyPart, "UTF-8"));
                        }
                    }
                }
                if (out.fileBytes != null && out.fileBytes.length > 0) {
                    log.info("[Multipart] 시도 4 (Raw) 파싱 성공");
                } else {
                    log.info("[Multipart] 시도 4 (Raw) 완료됐으나 파일 없음 - 파일 수신 실패 가능성 있음");
                }
            } catch (Throwable ignore) {
                log.info("[Multipart] 시도 4 (Raw) 실패: {}", ignore.getMessage());
            }
        }

        return out;
    }

    // =====================================================================
    // JSON 직렬화 유틸
    // =====================================================================
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
            }else if (c == '\\') {
                sb.append("\\\\"); 
            }else if (c == '\n') {
                sb.append("\\n"); 
            }else if (c == '\r') {
                sb.append("\\r"); 
            }else if (c == '\t') {
                sb.append("\\t"); 
            }else {
                sb.append(c);
            }
        }
        sb.append("\"");
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private void debugCascadePlan(
            org.apache.poi.ss.usermodel.Row row,
            List<?> structs,
            Map<?, ?> allMaps,
            String currentAlias,
            String parentIdPlaceholder,
            List<?> rowSqls,
            Map<String, Set<String>> metaMap,
            java.util.function.Consumer<String> addLog,
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

        addLog.accept("  • alias=" + currentAlias
                + ", table=" + safeLogValue(tableName)
                + (pkCol != null && !pkCol.trim().isEmpty() ? ", pk=" + pkCol : "")
                + (fkCol != null && !fkCol.trim().isEmpty() ? ", fk=" + fkCol : "")
                + (!upsertKeys.isEmpty() ? ", upsertKeys=" + upsertKeys : ""));
        addLog.accept("    - 컬럼 매핑값: " + formatDebugMap(data));

        Set<String> numericColumns = metaMap.get(tableName);
        if (tableName != null && service.isValidSqlIdentifier(tableName) && !data.isEmpty()) {
            try {
                Object[] insertSqlInfo = service.makeInsertSql(tableName, data, numericColumns);
                String insertSql = (String) insertSqlInfo[0];
                String[] insertParams = (String[]) insertSqlInfo[1];
                addLog.accept("    - INSERT SQL: " + safeLogValue(insertSql));
                addLog.accept("    - INSERT PARAM ORDER: " + Arrays.toString(insertParams));
            } catch (Throwable insertEx) {
                addLog.accept("    - INSERT SQL 생성 실패: " + safeLogValue(insertEx.getMessage()));
            }

            if (!upsertKeys.isEmpty()) {
                try {
                    Object[] updateSqlInfo = service.makeUpdateSql(tableName, data, upsertKeys, numericColumns);
                    String updateSql = (String) updateSqlInfo[0];
                    List<String> updateParams = (List<String>) updateSqlInfo[1];
                    addLog.accept("    - UPDATE SQL: " + safeLogValue(updateSql));
                    addLog.accept("    - UPDATE PARAM ORDER: " + updateParams);
                } catch (Throwable updateEx) {
                    addLog.accept("    - UPDATE SQL 생성 실패: " + safeLogValue(updateEx.getMessage()));
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
                        addLog,
                        dataRowNum
                );
            }
        }
    }

    // =====================================================================
    // 내부 헬퍼
    // =====================================================================
    /**
     * b64 파라미터 우선, 없으면 plain 파라미터 반환
     */
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

    private boolean isTruthy(Object value) {
        if (value == null) {
            return false;
        }
        String s = String.valueOf(value).trim().toLowerCase();
        return "y".equals(s) || "yes".equals(s) || "true".equals(s) || "1".equals(s) || "on".equals(s);
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
