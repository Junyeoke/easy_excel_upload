// ExcelUploadJsonResponseWriter.java
package com.steg.lit.controller;

import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Serializes simple response maps/lists for the legacy /api/excel/engine endpoint.
 */
@Component
public class ExcelUploadJsonResponseWriter {

    public String jsonToString(Object obj) {
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

    public String jsonEscape(String s) {
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
