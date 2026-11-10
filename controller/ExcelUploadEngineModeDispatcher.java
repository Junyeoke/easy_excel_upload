// ExcelUploadEngineModeDispatcher.java
package com.steg.lit.controller;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import javax.sql.DataSource;
import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.springframework.security.access.AccessDeniedException;

/**
 * Dispatches legacy /api/excel/engine modes to focused action components.
 */
@Component
public class ExcelUploadEngineModeDispatcher {

    private static final Set<String> ADMIN_ONLY_MODES = new HashSet<>(Arrays.asList(
            "save", "get_tables", "get_columns", "get_alert_config",
            "save_alert_config", "send_alert", "save_upload_capacity", "clone"));

    private final ExcelUploadProgressActionController progressActionController;
    private final ExcelUploadConfigActionController configActionController;
    private final ExcelUploadQueryActionController queryActionController;
    private final ExcelUploadHistoryActionController historyActionController;
    private final ExcelUploadAlertActionController alertActionController;
    private final ExcelUploadValidateActionController validateActionController;
    private final ExcelUploadUploadActionController uploadActionController;
    private final ExcelUploadCapacityActionController capacityActionController;

    public ExcelUploadEngineModeDispatcher(ExcelUploadProgressActionController progressActionController,
            ExcelUploadConfigActionController configActionController,
            ExcelUploadQueryActionController queryActionController,
            ExcelUploadHistoryActionController historyActionController,
            ExcelUploadAlertActionController alertActionController,
            ExcelUploadValidateActionController validateActionController,
            ExcelUploadUploadActionController uploadActionController,
            ExcelUploadCapacityActionController capacityActionController) {
        this.progressActionController = progressActionController;
        this.configActionController = configActionController;
        this.queryActionController = queryActionController;
        this.historyActionController = historyActionController;
        this.alertActionController = alertActionController;
        this.validateActionController = validateActionController;
        this.uploadActionController = uploadActionController;
        this.capacityActionController = capacityActionController;
    }

    public boolean dispatch(DataSource ds,
            String mode,
            Map<String, Object> params,
            byte[] fileBytes,
            byte[] sampleFileBytes,
            String sampleFileOrgName,
            HttpServletRequest request,
            HttpServletResponse response,
            Map<String, Object> result) throws Exception {
        if (ADMIN_ONLY_MODES.contains(mode) && !isAdmin(request)) {
            throw new AccessDeniedException("관리자 권한이 필요한 Excel 관리 기능입니다.");
        }
        if ("save".equals(mode)) {
            configActionController.handleSave(ds, params, sampleFileBytes, sampleFileOrgName, request, result);
        } else if ("get_list".equals(mode)) {
            configActionController.handleGetList(ds, request, result);
        } else if ("get_detail".equals(mode)) {
            configActionController.handleGetDetail(ds, params, request, result);
        } else if ("download_sample".equals(mode)) {
            queryActionController.handleDownloadSample(ds, params, response);
            return false;
        } else if ("get_tables".equals(mode)) {
            queryActionController.handleGetTables(ds, response);
            return false;
        } else if ("get_columns".equals(mode)) {
            queryActionController.handleGetColumns(ds, request, params, response);
            return false;
        } else if ("preview".equals(mode)) {
            queryActionController.handlePreview(fileBytes, params, result);
        } else if ("validate".equals(mode)) {
            validateActionController.handleValidate(ds, fileBytes, params, result);
        } else if ("download_error".equals(mode)) {
            queryActionController.handleDownloadError(params, response, result);
            return false;
        } else if ("get_history".equals(mode)) {
            historyActionController.handleGetHistory(ds, params, result);
        } else if ("get_history_detail".equals(mode)) {
            historyActionController.handleGetHistoryDetail(ds, params, result);
        } else if ("get_history_compare".equals(mode)) {
            historyActionController.handleGetHistoryCompare(ds, params, result);
        } else if ("get_alert_config".equals(mode)) {
            alertActionController.handleGetAlertConfig(ds, params, result);
        } else if ("save_alert_config".equals(mode)) {
            alertActionController.handleSaveAlertConfig(ds, params, result);
        } else if ("send_alert".equals(mode)) {
            alertActionController.handleSendAlert(ds, params, result);
        } else if ("get_upload_capacity".equals(mode)) {
            capacityActionController.handleGet(ds, request, result);
        } else if ("save_upload_capacity".equals(mode)) {
            capacityActionController.handleSave(ds, params, request, result);
        } else if ("progress".equals(mode)) {
            progressActionController.handleProgress(request, params, result);
        } else if ("cancel".equals(mode)) {
            progressActionController.handleCancel(params, result);
        } else if ("upload".equals(mode)) {
            uploadActionController.handleUpload(ds, fileBytes, params, request, result, response);
        } else if ("delete".equals(mode)) {
            configActionController.handleDelete(ds, params, request, result);
        } else if ("clone".equals(mode)) {
            configActionController.handleClone(ds, params, request, result);
        } else {
            result.put("status", "err");
            result.put("msg", "Unknown mode: " + mode);
        }
        return true;
    }

    private boolean isAdmin(HttpServletRequest request) {
        if (request == null) return false;
        try {
            if (request.isUserInRole("ADMIN") || request.isUserInRole("ROLE_ADMIN")) return true;
        } catch (Throwable ignore) {
        }
        if (request.getSession(false) == null) return false;
        Object user = request.getSession(false).getAttribute("egene.user");
        Object value = null;
        if (user instanceof Map) {
            value = ((Map<?, ?>) user).get("emp_admin_yn");
            if (value == null) value = ((Map<?, ?>) user).get("admin_yn");
        } else if (user != null) {
            try {
                value = user.getClass().getMethod("get", String.class)
                        .invoke(user, "emp_admin_yn");
            } catch (Throwable ignore) {
            }
            if (value == null) {
                try {
                    Field field = user.getClass().getField("admin_yn");
                    value = field.get(user);
                } catch (Throwable ignore) {
                }
            }
        }
        if (value == null) value = request.getSession(false).getAttribute("emp_admin_yn");
        return Boolean.TRUE.equals(value) || "1".equals(String.valueOf(value))
                || "Y".equalsIgnoreCase(String.valueOf(value))
                || "true".equalsIgnoreCase(String.valueOf(value));
    }
}
