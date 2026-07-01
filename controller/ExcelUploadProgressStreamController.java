// ExcelUploadProgressStreamController.java
package com.steg.lit.controller;

import com.steg.lit.util.ProgressStore;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Excel upload progress SSE endpoint.
 *
 * ExcelUploadEngineController keeps the existing route and delegates the
 * streaming response here.
 */
@Component
public class ExcelUploadProgressStreamController {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadProgressStreamController.class);

    public void stream(HttpServletRequest request, HttpServletResponse response) {
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

        response.setContentType("text/event-stream; charset=UTF-8");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("X-Accel-Buffering", "no");
        response.setStatus(HttpServletResponse.SC_OK);

        int lastLogIdx = 0;
        final int maxIter = 1200;
        boolean terminalEventSent = false;

        try (PrintWriter writer = response.getWriter()) {
            for (int iter = 0; iter < maxIter; iter++) {
                if (writer.checkError()) {
                    break;
                }

                ProgressStore.JobProgress prog = ProgressStore.get(jobId);
                if (prog == null) {
                    sseWrite(writer, "{\"type\":\"waiting\"}");
                    Thread.sleep(500);
                    continue;
                }

                List<String> newLogs;
                int currentLogSize;
                synchronized (prog.logs) {
                    currentLogSize = prog.logs.size();
                    newLogs = (lastLogIdx < currentLogSize)
                            ? new ArrayList<>(prog.logs.subList(lastLogIdx, currentLogSize))
                            : Collections.emptyList();
                }
                lastLogIdx = currentLogSize;

                if (prog.done && prog.errorMsg != null) {
                    sseWrite(writer, "{\"type\":\"error\",\"msg\":\"" + sseEscape(prog.errorMsg) + "\"}");
                    terminalEventSent = true;
                    break;
                }

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

                if (prog.done) {
                    sseWrite(writer, "{\"type\":\"done\"}");
                    terminalEventSent = true;
                    break;
                }

                Thread.sleep(500);
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.info("[SSE] stream interrupted (jobId={})", jobId);
        } catch (Throwable e) {
            log.info("[SSE] stream finished with exception (jobId={}): {}", jobId, e.getMessage());
        } finally {
            if (terminalEventSent) {
                clearProgressSessionArtifacts(request, jobId);
            }
        }
    }

    private void sseWrite(PrintWriter writer, String jsonData) {
        writer.write("data: " + jsonData + "\n\n");
        writer.flush();
    }

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

    private void clearProgressSessionArtifacts(HttpServletRequest request, String jobId) {
        if (request == null || jobId == null || jobId.trim().isEmpty()) {
            return;
        }
        try {
            request.getSession().removeAttribute("EXCEL_LOGS_" + jobId);
            request.getSession().removeAttribute("EXCEL_PROGRESS_" + jobId);
        } catch (Throwable ignore) {
        }
    }
}
