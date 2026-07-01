// ExcelUploadQueryActionController.java
package com.steg.lit.controller;

import com.steg.lit.repository.ExcelUploadEngineRepository;
import com.steg.lit.service.ExcelUploadEngineService;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import javax.sql.DataSource;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Handles read, preview, and file-download actions for the legacy
 * /api/excel/engine endpoint.
 */
@Component
public class ExcelUploadQueryActionController {

    private final ExcelUploadEngineService service;
    private final ExcelUploadEngineRepository repository;

    public ExcelUploadQueryActionController(ExcelUploadEngineService service,
            ExcelUploadEngineRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    public void handleDownloadSample(DataSource ds, Map<String, Object> params,
            HttpServletResponse response) throws Exception {
        try (Connection conn = ds.getConnection()) {
            String[] info = repository.getSampleFileInfo(conn, (String) params.get("upload_id"));
            if (info != null && info[0] != null && !info[0].trim().isEmpty()) {
                // 2026-06-17: 저장된 샘플 파일 경로가 절대경로면 그대로 따라가고, 아니면 기본 폴더를 사용한다.
                File sampleFile = resolveSampleFile(info[0]);
                if (sampleFile.exists() && sampleFile.isFile()) {
                    String downloadName = (info[1] != null && !info[1].trim().isEmpty())
                            ? info[1]
                            : sampleFile.getName();
                    response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                    response.setHeader("Content-Disposition",
                            "attachment; filename=\"" + java.net.URLEncoder.encode(downloadName, "UTF-8").replace("+", "%20") + "\"");
                    try {
                        response.setHeader("Content-Length", String.valueOf(sampleFile.length()));
                    } catch (Throwable ignore) {
                    }
                    try (FileInputStream fis = new FileInputStream(sampleFile);
                         BufferedOutputStream bos = new BufferedOutputStream(response.getOutputStream())) {
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

    public void handleGetTables(DataSource ds, HttpServletResponse response) throws Exception {
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

    public void handleGetColumns(DataSource ds, HttpServletRequest request,
            Map<String, Object> params,
            HttpServletResponse response) throws Exception {
        String t = request.getParameter("table_name");
        if (t == null || t.trim().isEmpty()) {
            t = (String) params.get("table_name");
        }
        if (!service.isValidSqlIdentifier(t)) {
            response.getWriter().write("[]");
            return;
        }
        try (Connection conn = ds.getConnection();
             PreparedStatement pstmt = conn.prepareStatement("SELECT * FROM " + t + " WHERE 1=0");
             ResultSet rs = pstmt.executeQuery()) {
            // 2026-06-20: 컬럼 매핑 화면에서 한글 컬럼명/코멘트를 함께 보여주기 위해 DB 컬럼 코멘트를 조회한다.
            Map<String, String> comments = loadColumnComments(conn, t);
            ResultSetMetaData m = rs.getMetaData();
            List<Map<String, String>> list = new ArrayList<>();
            for (int i = 1; i <= m.getColumnCount(); i++) {
                Map<String, String> o = new LinkedHashMap<>();
                String c = m.getColumnLabel(i).toLowerCase();
                String comment = comments.get(c.toLowerCase());
                o.put("value", c);
                o.put("label", c);
                if (comment != null && !comment.trim().isEmpty()) {
                    o.put("comment", comment.trim());
                    o.put("display_label", c + " (" + comment.trim() + ")");
                }
                list.add(o);
            }
            response.setContentType("application/json; charset=UTF-8");
            response.getWriter().write(jsonToString(list));
        }
    }

    public void handlePreview(byte[] fileBytes, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        if (fileBytes == null || fileBytes.length == 0) {
            throw new Exception("파일이 없습니다.");
        }

        int headerIdx = parseIntParam((String) params.get("header_row"), 1) - 1;
        if (headerIdx < 0) {
            headerIdx = 0;
        }
        int page = parseIntParam((String) params.get("page"), 1);
        int pageSize = parseIntParam((String) params.get("page_size"), 20);
        if (pageSize < 1) {
            pageSize = 20;
        }
        if (pageSize > 500) {
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

            int maxUploadRows = parseIntParam((String) params.get("max_upload_rows"), 0);
            List<Integer> dataRowIdxs = new ArrayList<>();
            for (int i = headerIdx + 1; i <= sheet.getLastRowNum(); i++) {
                org.apache.poi.ss.usermodel.Row r = sheet.getRow(i);
                if (r == null) continue;
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
            if (maxUploadRows > 0 && totalDataRows > maxUploadRows) {
                throw new Exception("최대 업로드 가능 건수는 " + maxUploadRows + "건입니다. 현재 엑셀 데이터는 "
                        + totalDataRows + "건이므로 미리보기를 생성할 수 없습니다.");
            }
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

    public void handleDownloadError(Map<String, Object> params, HttpServletResponse response,
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
                try (FileInputStream fis = new FileInputStream(file);
                     BufferedOutputStream bos = new BufferedOutputStream(response.getOutputStream())) {
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

    private int parseIntParam(String val, int def) {
        try {
            return Integer.parseInt(val);
        } catch (Throwable e) {
            return def;
        }
    }

    private Map<String, String> loadColumnComments(Connection conn, String tableName) {
        Map<String, String> comments = new HashMap<>();
        String dbProd = "";
        try {
            DatabaseMetaData meta = conn.getMetaData();
            dbProd = meta.getDatabaseProductName();
        } catch (Throwable ignore) {
        }

        String lowerProd = dbProd == null ? "" : dbProd.toLowerCase();
        if (lowerProd.contains("oracle") || lowerProd.contains("tibero")) {
            loadOracleColumnComments(conn, tableName, comments);
        } else {
            loadMysqlColumnComments(conn, tableName, comments);
        }
        return comments;
    }

    private void loadOracleColumnComments(Connection conn, String tableName, Map<String, String> comments) {
        String sql = "SELECT COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE TABLE_NAME = ?";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, tableName.toUpperCase());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String col = rs.getString("COLUMN_NAME");
                    String comment = rs.getString("COMMENTS");
                    if (col != null && comment != null && !comment.trim().isEmpty()) {
                        comments.put(col.toLowerCase(), comment.trim());
                    }
                }
            }
        } catch (Throwable ignore) {
        }
    }

    private void loadMysqlColumnComments(Connection conn, String tableName, Map<String, String> comments) {
        String sql = "SELECT COLUMN_NAME, COLUMN_COMMENT FROM information_schema.columns " +
                "WHERE table_schema = DATABASE() AND table_name = ?";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, tableName);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String col = rs.getString("COLUMN_NAME");
                    String comment = rs.getString("COLUMN_COMMENT");
                    if (col != null && comment != null && !comment.trim().isEmpty()) {
                        comments.put(col.toLowerCase(), comment.trim());
                    }
                }
            }
        } catch (Throwable ignore) {
        }
    }

    private File resolveSampleFile(String storedValue) throws Exception {
        String value = storedValue == null ? null : storedValue.trim();
        if (value == null || value.isEmpty()) {
            return new File(service.getSampleFileDir());
        }
        File direct = new File(value);
        if (direct.isAbsolute() || value.contains("/") || value.contains("\\")) {
            return direct;
        }
        return new File(service.getSampleFileDir(), value);
    }

    private String jsonToString(Object obj) {
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

    private String jsonEscape(String s) {
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
