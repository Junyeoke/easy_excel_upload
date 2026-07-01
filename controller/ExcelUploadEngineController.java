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

import javax.sql.DataSource;
import java.util.*;

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

    private final ExcelUploadProgressStreamController progressStreamController;
    private final ExcelUploadMultipartParser multipartParser;
    private final ExcelUploadJsonResponseWriter jsonResponseWriter;
    private final ExcelUploadDataSourceProvider dataSourceProvider;
    private final ExcelUploadEngineModeDispatcher modeDispatcher;

    public ExcelUploadEngineController(ExcelUploadProgressStreamController progressStreamController,
            ExcelUploadMultipartParser multipartParser,
            ExcelUploadJsonResponseWriter jsonResponseWriter,
            ExcelUploadDataSourceProvider dataSourceProvider,
            ExcelUploadEngineModeDispatcher modeDispatcher) {
        this.progressStreamController = progressStreamController;
        this.multipartParser = multipartParser;
        this.jsonResponseWriter = jsonResponseWriter;
        this.dataSourceProvider = dataSourceProvider;
        this.modeDispatcher = modeDispatcher;
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
        progressStreamController.stream(request, response);
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
                ExcelUploadMultipartParser.ParsedMultipart parsed = multipartParser.parse(request);
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
            DataSource ds = dataSourceProvider.getDataSource();

            boolean writeJson = modeDispatcher.dispatch(ds, mode, params, fileBytes,
                    sampleFileBytes, sampleFileOrgName, request, response, result);
            if (!writeJson) {
                return;
            }
            // ── JSON 응답 출력 ────────────────────────────────────────────────
            if (!response.isCommitted()) {
                response.setContentType("application/json; charset=UTF-8");
                response.getWriter().write(jsonResponseWriter.jsonToString(result));
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
                response.getWriter().write(jsonResponseWriter.jsonToString(result));
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


}
