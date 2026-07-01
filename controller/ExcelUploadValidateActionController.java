// ExcelUploadValidateActionController.java
package com.steg.lit.controller;

import com.steg.lit.service.ExcelUploadEngineService;

import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Handles validate-only requests for the legacy /api/excel/engine endpoint.
 */
@Component
public class ExcelUploadValidateActionController {

    private final ExcelUploadEngineService service;

    public ExcelUploadValidateActionController(ExcelUploadEngineService service) {
        this.service = service;
    }

    public void handleValidate(DataSource ds, byte[] fileBytes, Map<String, Object> params,
            Map<String, Object> result) throws Exception {

        if (fileBytes == null || fileBytes.length == 0) {
            throw new Exception("File is required.");
        }

        String structJson = decodeParam(params, "struct_json_b64", "struct_json");
        String mapJson = decodeParam(params, "mapping_json_b64", "mapping");
        if (mapJson == null) {
            mapJson = decodeParam(params, "mapping_b64", "mapping_json");
        }

        int headerIdx = 0;
        try {
            headerIdx = Integer.parseInt((String) params.get("header_row")) - 1;
        } catch (Throwable ignore) {
        }
        if (headerIdx < 0) {
            headerIdx = 0;
        }

        List<?> structs = (List<?>) service.parseJson(structJson);
        Map<?, ?> allMaps = (Map<?, ?>) service.parseJson(mapJson);

        org.apache.poi.ss.usermodel.Workbook wb = service.createWorkbook(fileBytes);
        org.apache.poi.ss.usermodel.Sheet sheet = wb.getSheetAt(0);
        int maxUploadRows = parseIntParam((String) params.get("max_upload_rows"), 0);
        int actualTotalRows = service.countDataRows(sheet, headerIdx);
        if (maxUploadRows > 0 && actualTotalRows > maxUploadRows) {
            service.closeWorkbook(wb);
            throw new Exception("최대 업로드 가능 건수는 " + maxUploadRows + "건입니다. 현재 엑셀 데이터는 "
                    + actualTotalRows + "건이므로 검증할 수 없습니다.");
        }

        String editedRowsB64 = (String) params.get("edited_rows_b64");
        if (editedRowsB64 != null && !editedRowsB64.trim().isEmpty()) {
            try {
                Map<?, ?> editedMap = (Map<?, ?>) service.parseJson(service.decodeSafeBase64(editedRowsB64));
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
                    }
                }
            } catch (Throwable ignore) {
            }
        }

        int startRow = headerIdx + 1;
        int totalRows = sheet.getLastRowNum();
        int processedExcelRowCnt = 0;
        Map<String, String> failedRowMsgMap = new LinkedHashMap<>();
        Map<String, Object> validateCache = new HashMap<>();

        Connection conn = null;
        try {
            conn = ds.getConnection();
            for (int rowIdx = startRow; rowIdx <= totalRows; rowIdx++) {
                org.apache.poi.ss.usermodel.Row row = sheet.getRow(rowIdx);
                if (row == null) {
                    continue;
                }
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
                int dataRowNum = row.getRowNum() - headerIdx;
                try {
                    service.validateCascadeRow(conn, row, structs, allMaps, "ROOT", null, validateCache);
                } catch (Throwable rowEx) {
                    String msg = rowEx.getMessage() != null ? rowEx.getMessage() : "Validation failed.";
                    failedRowMsgMap.put(String.valueOf(dataRowNum), msg);
                }
            }

            int failCnt = failedRowMsgMap.size();
            int successCnt = Math.max(processedExcelRowCnt - failCnt, 0);
            result.put("status", "ok");
            result.put("mode", "validate");
            result.put("msg", failCnt > 0
                    ? ("Validation completed: " + failCnt + " failed")
                    : "Validation completed.");
            result.put("valid", failCnt == 0);
            result.put("success_cnt", successCnt);
            result.put("fail_cnt", failCnt);
            if (!failedRowMsgMap.isEmpty()) {
                result.put("failed_row_msgs", failedRowMsgMap);
            }
            result.put("total_rows", processedExcelRowCnt);
        } finally {
            if (conn != null) {
                try {
                    conn.close();
                } catch (Throwable ignore) {
                }
            }
            service.closeWorkbook(wb);
        }
    }

    private String decodeParam(Map<String, Object> params, String b64Key, String plainKey) {
        String b64 = (String) params.get(b64Key);
        if (b64 != null && !b64.isEmpty()) {
            return service.decodeSafeBase64(b64);
        }
        return (String) params.get(plainKey);
    }

    private int parseIntParam(String val, int def) {
        try {
            return Integer.parseInt(val);
        } catch (Throwable e) {
            return def;
        }
    }
}
