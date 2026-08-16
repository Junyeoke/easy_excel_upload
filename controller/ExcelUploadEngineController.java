// ExcelUploadEngineController.java
package com.steg.lit.controller;

import com.steg.lit.service.ExcelUploadEngineService;        // 추가
import com.steg.lit.repository.ExcelUploadEngineRepository;  // 추가
import com.steg.lit.util.ProgressStore;                      // SSE 진행률 저장소
import com.steg.lit.util.ExcelUploadTaskExecutor;
import com.steg.lit.util.ExcelUploadTempFileStore;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

import jakarta.servlet.annotation.MultipartConfig;
import jakarta.servlet.AsyncContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import javax.sql.DataSource;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.RejectedExecutionException;

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
    private final ExcelUploadTaskExecutor uploadTaskExecutor;
    private final ExcelUploadTempFileStore tempFileStore;

    public ExcelUploadEngineController(ExcelUploadProgressStreamController progressStreamController,
            ExcelUploadMultipartParser multipartParser,
            ExcelUploadJsonResponseWriter jsonResponseWriter,
            ExcelUploadDataSourceProvider dataSourceProvider,
            ExcelUploadEngineModeDispatcher modeDispatcher,
            ExcelUploadTaskExecutor uploadTaskExecutor,
            ExcelUploadTempFileStore tempFileStore) {
        this.progressStreamController = progressStreamController;
        this.multipartParser = multipartParser;
        this.jsonResponseWriter = jsonResponseWriter;
        this.dataSourceProvider = dataSourceProvider;
        this.modeDispatcher = modeDispatcher;
        this.uploadTaskExecutor = uploadTaskExecutor;
        this.tempFileStore = tempFileStore;
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
        // 2026-08-12 이준혁: 대용량 업로드를 웹 요청 스레드와 분리하고 제한된 전용 Queue에서 처리한다.
        // 2026-08-16 이준혁: multipart 임시 Part가 정리되기 전에 요청 스레드에서 파일을 확보한다.
        processEngineInternal(request, response, true);
    }

    private void processEngineInternal(HttpServletRequest request, HttpServletResponse response,
            boolean allowDeferredUpload) {
        Map<String, Object> result = new LinkedHashMap<>();
        Path parsedUploadTempFile = null;
        Path parsedSampleTempFile = null;
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
                ExcelUploadMultipartParser.ParsedMultipart parsed = multipartParser.parse(
                        request, allowDeferredUpload && "upload".equals(mode));
                params = parsed.params;
                fileBytes = parsed.fileBytes;
                sampleFileBytes = parsed.sampleFileBytes;
                parsedUploadTempFile = parsed.fileTempPath;
                parsedSampleTempFile = parsed.sampleFileTempPath;
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

            // Query string에 mode를 넣지 않은 기존 클라이언트도 DB 작업만큼은 전용 Worker로 분리한다.
            if (allowDeferredUpload && "upload".equals(mode)) {
                submitParsedUpload(request, response, ds, params, fileBytes, sampleFileBytes,
                        parsedUploadTempFile, parsedSampleTempFile, sampleFileOrgName);
                parsedUploadTempFile = null;
                parsedSampleTempFile = null;
                return;
            }

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
        } finally {
            tempFileStore.delete(parsedUploadTempFile);
            tempFileStore.delete(parsedSampleTempFile);
        }
    }

    private void submitParsedUpload(HttpServletRequest request, HttpServletResponse response,
            DataSource ds, Map<String, Object> params, byte[] fileBytes,
            byte[] sampleFileBytes, Path parsedUploadTempFile,
            Path parsedSampleTempFile, String sampleFileOrgName) {
        final String jobId = params.get("job_id") == null ? null : String.valueOf(params.get("job_id"));
        try {
            uploadTaskExecutor.ensureConfigured(ds);
        } catch (Throwable e) {
            log.warn("[ExcelUpload] persisted pool configuration could not be loaded; current safe values are used: {}",
                    e.getMessage());
        }
        Path preparedUploadTempFile = parsedUploadTempFile;
        Path preparedSampleTempFile = parsedSampleTempFile;
        try {
            if (preparedUploadTempFile == null) {
                preparedUploadTempFile = tempFileStore.store(fileBytes, ".xlsx");
            }
            if (preparedSampleTempFile == null) {
                preparedSampleTempFile = tempFileStore.store(sampleFileBytes, ".sample.xlsx");
            }
        } catch (Exception e) {
            deleteUploadTempFile(preparedUploadTempFile);
            deleteUploadTempFile(preparedSampleTempFile);
            writeWorkerError(response, new LinkedHashMap<>(),
                    new Exception("업로드 임시파일 저장에 실패했습니다: " + e.getMessage(), e));
            return;
        }
        final Path uploadTempFile = preparedUploadTempFile;
        final Path sampleTempFile = preparedSampleTempFile;

        final AsyncContext asyncContext;
        try {
            asyncContext = request.startAsync();
            asyncContext.setTimeout(0L);
        } catch (IllegalStateException e) {
            deleteUploadTempFile(uploadTempFile);
            deleteUploadTempFile(sampleTempFile);
            writeAsyncUnavailable(response, e);
            return;
        }

        markQueued(jobId);
        try {
            uploadTaskExecutor.execute(() -> {
                Map<String, Object> result = new LinkedHashMap<>();
                HttpServletRequest asyncRequest = (HttpServletRequest) asyncContext.getRequest();
                HttpServletResponse asyncResponse = (HttpServletResponse) asyncContext.getResponse();
                try {
                    byte[] workerFileBytes = readUploadTempFile(uploadTempFile);
                    byte[] workerSampleFileBytes = readUploadTempFile(sampleTempFile);
                    boolean writeJson = modeDispatcher.dispatch(ds, "upload", params, workerFileBytes,
                            workerSampleFileBytes, sampleFileOrgName, asyncRequest, asyncResponse, result);
                    if (writeJson && !asyncResponse.isCommitted()) {
                        asyncResponse.setContentType("application/json; charset=UTF-8");
                        asyncResponse.getWriter().write(jsonResponseWriter.jsonToString(result));
                    }
                } catch (Throwable e) {
                    writeWorkerError(asyncResponse, result, e);
                } finally {
                    deleteUploadTempFile(uploadTempFile);
                    deleteUploadTempFile(sampleTempFile);
                    asyncContext.complete();
                }
            });
        } catch (RejectedExecutionException e) {
            deleteUploadTempFile(uploadTempFile);
            deleteUploadTempFile(sampleTempFile);
            rejectBusy(asyncContext, jobId);
        }
    }

    private byte[] readUploadTempFile(Path tempFile) throws Exception {
        return tempFile == null ? null : tempFileStore.read(tempFile);
    }

    private void deleteUploadTempFile(Path tempFile) {
        tempFileStore.delete(tempFile);
    }

    private void markQueued(String jobId) {
        if (jobId == null || jobId.trim().isEmpty()) {
            return;
        }
        ProgressStore.init(jobId, 0);
        ProgressStore.addLog(jobId, "업로드 작업이 대기열에 등록되었습니다.");
    }

    private void rejectBusy(AsyncContext asyncContext, String jobId) {
        String message = "현재 업로드 작업이 많습니다. 잠시 후 다시 시도해 주세요.";
        if (jobId != null && !jobId.trim().isEmpty()) {
            ProgressStore.error(jobId, message);
        }
        HttpServletResponse response = (HttpServletResponse) asyncContext.getResponse();
        try {
            response.setStatus(429);
            response.setContentType("application/json; charset=UTF-8");
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", "busy");
            result.put("msg", message);
            result.put("active_workers", uploadTaskExecutor.getActiveCount());
            result.put("worker_count", uploadTaskExecutor.getWorkerCount());
            result.put("queue_size", uploadTaskExecutor.getQueueSize());
            result.put("queue_capacity", uploadTaskExecutor.getQueueCapacity());
            response.getWriter().write(jsonResponseWriter.jsonToString(result));
        } catch (Exception writeError) {
            log.warn("[ExcelUpload] busy response write failed: {}", writeError.getMessage());
        } finally {
            asyncContext.complete();
        }
    }

    private void writeAsyncUnavailable(HttpServletResponse response, Throwable cause) {
        log.error("[ExcelUpload] servlet async processing is not available", cause);
        try {
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            response.setContentType("application/json; charset=UTF-8");
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", "err");
            result.put("msg", "업로드 비동기 처리를 사용할 수 없습니다. 서버의 async-supported 설정을 확인해 주세요.");
            response.getWriter().write(jsonResponseWriter.jsonToString(result));
        } catch (Exception ignore) {
        }
    }

    private void writeWorkerError(HttpServletResponse response, Map<String, Object> result, Throwable e) {
        log.error("[ExcelUpload] upload worker failed: {}", e.getMessage(), e);
        try {
            response.setStatus(HttpServletResponse.SC_OK);
            result.clear();
            result.put("status", "err");
            result.put("msg", "서버 오류: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
            response.setContentType("application/json; charset=UTF-8");
            response.getWriter().write(jsonResponseWriter.jsonToString(result));
        } catch (Exception ignore) {
        }
    }

    // =====================================================================
    // mode 핸들러 메서드
    // =====================================================================
    /**
     * 설정 저장 (INSERT or UPDATE)
     */


}
