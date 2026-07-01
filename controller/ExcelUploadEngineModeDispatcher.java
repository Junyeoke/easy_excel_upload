// ExcelUploadEngineModeDispatcher.java
package com.steg.lit.controller;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import javax.sql.DataSource;
import java.util.Map;

/**
 * Dispatches legacy /api/excel/engine modes to focused action components.
 */
@Component
public class ExcelUploadEngineModeDispatcher {

    private final ExcelUploadProgressActionController progressActionController;
    private final ExcelUploadConfigActionController configActionController;
    private final ExcelUploadQueryActionController queryActionController;
    private final ExcelUploadHistoryActionController historyActionController;
    private final ExcelUploadAlertActionController alertActionController;
    private final ExcelUploadValidateActionController validateActionController;
    private final ExcelUploadUploadActionController uploadActionController;

    public ExcelUploadEngineModeDispatcher(ExcelUploadProgressActionController progressActionController,
            ExcelUploadConfigActionController configActionController,
            ExcelUploadQueryActionController queryActionController,
            ExcelUploadHistoryActionController historyActionController,
            ExcelUploadAlertActionController alertActionController,
            ExcelUploadValidateActionController validateActionController,
            ExcelUploadUploadActionController uploadActionController) {
        this.progressActionController = progressActionController;
        this.configActionController = configActionController;
        this.queryActionController = queryActionController;
        this.historyActionController = historyActionController;
        this.alertActionController = alertActionController;
        this.validateActionController = validateActionController;
        this.uploadActionController = uploadActionController;
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
        if ("save".equals(mode)) {
            configActionController.handleSave(ds, params, sampleFileBytes, sampleFileOrgName, result);
        } else if ("get_list".equals(mode)) {
            configActionController.handleGetList(ds, result);
        } else if ("get_detail".equals(mode)) {
            configActionController.handleGetDetail(ds, params, result);
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
        } else if ("progress".equals(mode)) {
            progressActionController.handleProgress(request, params, result);
        } else if ("cancel".equals(mode)) {
            progressActionController.handleCancel(params, result);
        } else if ("upload".equals(mode)) {
            uploadActionController.handleUpload(ds, fileBytes, params, request, result, response);
        } else if ("delete".equals(mode)) {
            configActionController.handleDelete(ds, params, result);
        } else if ("clone".equals(mode)) {
            configActionController.handleClone(ds, params, result);
        } else {
            result.put("status", "err");
            result.put("msg", "Unknown mode: " + mode);
        }
        return true;
    }
}
