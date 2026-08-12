package com.steg.lit.controller;

import com.steg.lit.repository.ExcelUploadEngineRepository;
import com.steg.lit.util.ExcelUploadTaskExecutor;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.Map;

/**
 * Administrator-only API for the Excel upload worker/queue capacity.
 */
@Component
public class ExcelUploadCapacityActionController {

    private final ExcelUploadTaskExecutor taskExecutor;
    private final ExcelUploadEngineRepository repository;

    public ExcelUploadCapacityActionController(ExcelUploadTaskExecutor taskExecutor,
            ExcelUploadEngineRepository repository) {
        this.taskExecutor = taskExecutor;
        this.repository = repository;
    }

    public void handleGet(DataSource ds, HttpServletRequest request,
            Map<String, Object> result) throws Exception {
        if (!isAdminUser(request)) {
            deny(result);
            return;
        }
        taskExecutor.ensureConfigured(ds);
        result.put("status", "ok");
        result.put("is_admin", true);
        result.putAll(taskExecutor.snapshot());

        try (Connection conn = ds.getConnection()) {
            String nowFunc = repository.detectNowFunction(conn);
            repository.ensureUploadPoolConfigTable(conn, nowFunc);
            Map<String, Object> saved = repository.getUploadPoolConfig(conn);
            result.put("updated_emp_id", saved.get("updated_emp_id"));
            result.put("updated_dttm", saved.get("updated_dttm"));
        }
    }

    public void handleSave(DataSource ds, Map<String, Object> params,
            HttpServletRequest request, Map<String, Object> result) throws Exception {
        if (!isAdminUser(request)) {
            deny(result);
            return;
        }
        String empId = getSessionUserValue(request, "emp_id");
        int workerCount = parseInt(params.get("worker_count"), -1);
        int queueCapacity = parseInt(params.get("queue_capacity"), -1);
        try {
            result.putAll(taskExecutor.reconfigureAndPersist(ds, workerCount, queueCapacity, empId));
            result.put("status", "ok");
            result.put("is_admin", true);
            result.put("msg", "업로드 처리 설정이 저장되고 즉시 적용되었습니다.");
        } catch (IllegalArgumentException | IllegalStateException e) {
            result.put("status", "err");
            result.put("msg", e.getMessage());
        }
    }

    private void deny(Map<String, Object> result) {
        result.put("status", "forbidden");
        result.put("is_admin", false);
        result.put("msg", "관리자만 업로드 처리 설정을 조회하거나 변경할 수 있습니다.");
    }

    private boolean isAdminUser(HttpServletRequest request) {
        return "1".equals(getSessionUserValue(request, "emp_admin_yn"));
    }

    private String getSessionUserValue(HttpServletRequest request, String key) {
        if (request == null || request.getSession(false) == null) {
            return null;
        }
        Object sessionUser = request.getSession(false).getAttribute("egene.user");
        Object value = null;
        if (sessionUser instanceof Map) {
            value = ((Map<?, ?>) sessionUser).get(key);
        } else if (sessionUser != null) {
            try {
                value = sessionUser.getClass().getMethod("get", String.class).invoke(sessionUser, key);
            } catch (Throwable ignore) {
                try {
                    value = sessionUser.getClass().getMethod("get", Object.class).invoke(sessionUser, key);
                } catch (Throwable ignored) {
                }
            }
        }
        return value == null ? null : String.valueOf(value).trim();
    }

    private int parseInt(Object value, int defaultValue) {
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Throwable e) {
            return defaultValue;
        }
    }
}
