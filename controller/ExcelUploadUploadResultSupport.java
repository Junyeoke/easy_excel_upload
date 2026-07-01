// ExcelUploadUploadResultSupport.java
package com.steg.lit.controller;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.List;
import java.util.Map;

/**
 * Supports upload result summarization and upload progress cleanup.
 */
@Component
public class ExcelUploadUploadResultSupport {

    public String sha256Hex(String text) {
        if (text == null) {
            return "";
        }
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] bytes = md.digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Throwable ignore) {
            return "";
        }
    }

    public String buildFailTypeJson(Map<String, String> failedRowMsgMap) {
        if (failedRowMsgMap == null || failedRowMsgMap.isEmpty()) {
            return "{}";
        }
        Map<String, Integer> summary = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : failedRowMsgMap.entrySet()) {
            String rowKey = e.getKey();
            if (rowKey != null && rowKey.startsWith("__unknown_")) {
                continue;
            }
            String type = classifyFailType(e.getValue());
            summary.put(type, summary.getOrDefault(type, 0) + 1);
        }
        return jsonToString(summary);
    }

    public void clearProgressSessionArtifacts(HttpServletRequest request, String jobId) {
        if (request == null || jobId == null || jobId.trim().isEmpty()) {
            return;
        }
        try {
            request.getSession().removeAttribute("EXCEL_LOGS_" + jobId);
            request.getSession().removeAttribute("EXCEL_PROGRESS_" + jobId);
        } catch (Throwable ignore) {
        }
    }

    private String classifyFailType(String rawMsg) {
        String m = rawMsg == null ? "" : rawMsg.toLowerCase(Locale.ROOT);
        if (m.isEmpty()) {
            return "other";
        }
        if (m.contains("null") && (m.contains("not") || m.contains("cannot"))) {
            return "required_missing";
        }
        if (m.contains("unique") || m.contains("duplicate") || m.contains("duplicate")) {
            return "duplicate";
        }
        if (m.contains("too long") || m.contains("data too long") || m.contains("length") || m.contains("max")) {
            return "length_exceeded";
        }
        if (m.contains("number") || m.contains("numeric")) {
            return "number_format";
        }
        if (m.contains("date") || m.contains("time") || m.contains("yyyy")) {
            return "date_format";
        }
        if (m.contains("foreign key") || m.contains("referential") || m.contains("fk")) {
            return "reference";
        }
        if (m.contains("timeout") || m.contains("timed out")) {
            return "timeout";
        }
        if (m.contains("cancel")) {
            return "cancelled";
        }
        return "other";
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
