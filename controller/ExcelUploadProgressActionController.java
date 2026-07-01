// ExcelUploadProgressActionController.java
package com.steg.lit.controller;

import com.steg.lit.util.ProgressStore;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Handles progress polling and cancel actions for the legacy
 * /api/excel/engine?mode=progress|cancel endpoint.
 */
@Component
public class ExcelUploadProgressActionController {

    public void handleProgress(HttpServletRequest request, Map<String, Object> params,
            Map<String, Object> result) {
        String jobId = (String) params.get("job_id");
        if (jobId == null || jobId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "job_id가 필요합니다.");
            return;
        }

        ProgressStore.JobProgress prog = ProgressStore.get(jobId);
        if (prog != null) {
            result.put("status", "ok");
            result.put("job_id", jobId);
            result.put("hist_id", prog.histId);
            result.put("upload_id", prog.uploadId);
            result.put("current", prog.current);
            result.put("total", prog.total);
            result.put("percent", prog.total > 0
                    ? (int) ((double) prog.current / prog.total * 100) : 0);
            result.put("cancel_requested", prog.cancelRequested);
            result.put("success_cnt", prog.successCnt);
            result.put("fail_cnt", prog.failCnt);
            result.put("error_file", prog.errorFile);
            result.put("result_status", prog.status);
            synchronized (prog.logs) {
                result.put("logs", new ArrayList<>(prog.logs));
            }
            return;
        }

        String progObj = (String) request.getSession().getAttribute("EXCEL_PROGRESS_" + jobId);
        if (progObj == null) {
            result.put("status", "none");
        } else {
            String[] parts = progObj.split("/");
            int current = Integer.parseInt(parts[0]);
            int total = Integer.parseInt(parts[1]);
            result.put("status", "ok");
            result.put("job_id", jobId);
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

    public void handleCancel(Map<String, Object> params, Map<String, Object> result) {
        String jobId = (String) params.get("job_id");
        if (jobId == null || jobId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "job_id가 필요합니다.");
            return;
        }
        boolean requested = ProgressStore.requestCancel(jobId);
        if (!requested) {
            result.put("status", "none");
            result.put("msg", "진행 중인 작업을 찾을 수 없습니다.");
            return;
        }
        ProgressStore.addLog(jobId, "사용자에 의해 취소 요청되었습니다.");
        result.put("status", "ok");
        result.put("msg", "취소 요청이 접수되었습니다.");
    }
}
