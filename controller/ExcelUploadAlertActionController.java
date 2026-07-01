// ExcelUploadAlertActionController.java
package com.steg.lit.controller;

import com.steg.lit.repository.ExcelUploadEngineRepository;
import com.steg.lit.service.ExcelUploadEngineService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import javax.sql.DataSource;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Connection;
import java.util.Arrays;
import java.util.Base64;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Handles alert configuration and webhook delivery actions for the legacy
 * /api/excel/engine endpoint.
 */
@Component
public class ExcelUploadAlertActionController {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadAlertActionController.class);
    private static final SecureRandom ALERT_RANDOM = new SecureRandom();
    private static final long ALERT_DEDUP_WINDOW_MS = 5 * 60 * 1000L;
    private static final Map<String, Long> ALERT_DEDUP_MAP = new ConcurrentHashMap<>();

    private final ExcelUploadEngineService service;
    private final ExcelUploadEngineRepository repository;

    public ExcelUploadAlertActionController(ExcelUploadEngineService service,
            ExcelUploadEngineRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    public void handleGetAlertConfig(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) {
        String uploadId = (String) params.get("upload_id");
        if (uploadId == null || uploadId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "upload_id is required.");
            return;
        }
        try (Connection conn = ds.getConnection()) {
            conn.setAutoCommit(false);
            String nowFunc = repository.detectNowFunction(conn);
            repository.ensureAlertConfigTable(conn, nowFunc);
            Map<String, Object> cfg = repository.getAlertConfig(conn, uploadId.trim());
            result.put("status", "ok");
            result.put("enabled", isTruthy(cfg.get("enabled")));
            result.put("fail_rate_threshold", String.valueOf(cfg.getOrDefault("fail_rate_threshold", "30")));
            result.put("fail_count_threshold", String.valueOf(cfg.getOrDefault("fail_count_threshold", "50")));
            result.put("webhook_url", decryptAlertValue((String) cfg.get("webhook_url_enc")));
        } catch (Throwable e) {
            result.put("status", "err");
            result.put("msg", "Alert config lookup failed: " + e.getMessage());
        }
    }

    public void handleSaveAlertConfig(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) {
        String uploadId = (String) params.get("upload_id");
        if (uploadId == null || uploadId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "upload_id is required.");
            return;
        }
        try (Connection conn = ds.getConnection()) {
            conn.setAutoCommit(false);
            String nowFunc = repository.detectNowFunction(conn);
            repository.ensureAlertConfigTable(conn, nowFunc);
            String enabled = isTruthy(params.get("enabled")) ? "Y" : "N";
            int failRateThreshold = parseIntParam((String) params.get("fail_rate_threshold"), 30);
            int failCountThreshold = parseIntParam((String) params.get("fail_count_threshold"), 50);
            String webhookUrl = (String) params.get("webhook_url");
            String webhookUrlEnc = encryptAlertValue(webhookUrl == null ? "" : webhookUrl.trim());
            repository.saveAlertConfig(conn, uploadId.trim(), enabled, webhookUrlEnc,
                    failRateThreshold, failCountThreshold, nowFunc);
            conn.commit();
            result.put("status", "ok");
        } catch (Throwable e) {
            result.put("status", "err");
            result.put("msg", "Alert config save failed: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    public void handleSendAlert(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) {
        String uploadId = (String) params.get("upload_id");
        String eventType = (String) params.get("event_type");
        if (uploadId == null || uploadId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "upload_id is required.");
            return;
        }
        if (eventType == null || eventType.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "event_type is required.");
            return;
        }
        try (Connection conn = ds.getConnection()) {
            conn.setAutoCommit(false);
            String nowFunc = repository.detectNowFunction(conn);
            repository.ensureAlertConfigTable(conn, nowFunc);
            Map<String, Object> cfg = repository.getAlertConfig(conn, uploadId.trim());
            if (!isTruthy(cfg.get("enabled"))) {
                result.put("status", "skip");
                result.put("msg", "Alert is disabled.");
                return;
            }
            String webhookUrl = decryptAlertValue((String) cfg.get("webhook_url_enc"));
            if (webhookUrl == null || webhookUrl.trim().isEmpty()) {
                result.put("status", "skip");
                result.put("msg", "Webhook URL is empty.");
                return;
            }

            String payloadJson = (String) params.get("payload_json");
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("event_type", eventType);
            payload.put("upload_id", uploadId);
            payload.put("event_time", String.valueOf(System.currentTimeMillis()));
            if (payloadJson != null && !payloadJson.trim().isEmpty()) {
                try {
                    Object parsed = service.parseJson(payloadJson);
                    if (parsed instanceof Map) {
                        payload.putAll((Map<String, Object>) parsed);
                    }
                } catch (Throwable ignore) {
                }
            }

            String dedupKey = (String) params.get("dedup_key");
            if (dedupKey == null || dedupKey.trim().isEmpty()) {
                dedupKey = sha256Hex(uploadId + "|" + eventType + "|" + jsonToString(payload));
            }
            long now = System.currentTimeMillis();
            cleanupDedup(now);
            Long last = ALERT_DEDUP_MAP.get(dedupKey);
            if (last != null && now - last < ALERT_DEDUP_WINDOW_MS) {
                result.put("status", "skip");
                result.put("msg", "Duplicate alert suppressed.");
                return;
            }

            boolean sent = sendWebhookWithRetry(webhookUrl, jsonToString(payload), 3, dedupKey);
            if (!sent) {
                result.put("status", "err");
                result.put("msg", "Alert delivery failed.");
                return;
            }
            ALERT_DEDUP_MAP.put(dedupKey, now);
            result.put("status", "ok");
        } catch (Throwable e) {
            result.put("status", "err");
            result.put("msg", "Alert delivery error: " + e.getMessage());
        }
    }

    private SecretKeySpec getAlertKey() throws Exception {
        String secret = System.getenv("EXCEL_ALERT_SECRET");
        if (secret == null || secret.trim().isEmpty()) {
            secret = System.getProperty("excel.alert.secret");
        }
        if (secret == null || secret.trim().isEmpty()) {
            secret = "excel-alert-default-key-change-me";
        }
        byte[] keySrc = MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8));
        byte[] key = Arrays.copyOf(keySrc, 16);
        return new SecretKeySpec(key, "AES");
    }

    private String encryptAlertValue(String plain) throws Exception {
        if (plain == null || plain.isEmpty()) {
            return "";
        }
        byte[] iv = new byte[12];
        ALERT_RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getAlertKey(), new GCMParameterSpec(128, iv));
        byte[] enc = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + enc.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(enc, 0, all, iv.length, enc.length);
        return Base64.getEncoder().encodeToString(all);
    }

    private String decryptAlertValue(String encoded) throws Exception {
        if (encoded == null || encoded.trim().isEmpty()) {
            return "";
        }
        byte[] all = Base64.getDecoder().decode(encoded);
        if (all.length < 13) {
            return "";
        }
        byte[] iv = Arrays.copyOfRange(all, 0, 12);
        byte[] enc = Arrays.copyOfRange(all, 12, all.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getAlertKey(), new GCMParameterSpec(128, iv));
        byte[] dec = cipher.doFinal(enc);
        return new String(dec, StandardCharsets.UTF_8);
    }

    private void cleanupDedup(long now) {
        for (Iterator<Map.Entry<String, Long>> it = ALERT_DEDUP_MAP.entrySet().iterator(); it.hasNext();) {
            Map.Entry<String, Long> e = it.next();
            if (now - e.getValue() > ALERT_DEDUP_WINDOW_MS) {
                it.remove();
            }
        }
    }

    private boolean isWebhookAllowed(String webhookUrl) {
        try {
            String allowlist = System.getenv("EXCEL_ALERT_ALLOWLIST");
            if (allowlist == null || allowlist.trim().isEmpty()) {
                allowlist = System.getProperty("excel.alert.allowlist");
            }
            URL url = new URL(webhookUrl);
            String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
            if (allowlist == null || allowlist.trim().isEmpty()) {
                return true;
            }
            for (String raw : allowlist.split(",")) {
                String d = raw.trim().toLowerCase(Locale.ROOT);
                if (d.isEmpty()) {
                    continue;
                }
                if (host.equals(d) || host.endsWith("." + d)) {
                    return true;
                }
            }
            return false;
        } catch (Throwable e) {
            return false;
        }
    }

    private String buildAlertSignature(String timestamp, String bodyJson) throws Exception {
        String signSecret = System.getenv("EXCEL_ALERT_SIGN_SECRET");
        if (signSecret == null || signSecret.trim().isEmpty()) {
            signSecret = System.getProperty("excel.alert.sign.secret");
        }
        if (signSecret == null || signSecret.trim().isEmpty()) {
            signSecret = "excel-alert-sign-default-change-me";
        }
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(signSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] sig = mac.doFinal((timestamp + "." + bodyJson).getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder(sig.length * 2);
        for (byte b : sig) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private boolean sendWebhookWithRetry(String webhookUrl, String bodyJson, int maxTry, String dedupKey) {
        if (!isWebhookAllowed(webhookUrl)) {
            log.warn("[ExcelUpload] Webhook allowlist rejected: {}", webhookUrl);
            return false;
        }
        int[] delays = new int[]{200, 700, 1600};
        for (int i = 0; i < maxTry; i++) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(webhookUrl);
                conn = (HttpURLConnection) url.openConnection();
                String ts = String.valueOf(System.currentTimeMillis());
                String sig = buildAlertSignature(ts, bodyJson);
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(6000);
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("X-Excel-Alert-Timestamp", ts);
                conn.setRequestProperty("X-Excel-Alert-Signature", sig);
                if (dedupKey != null && !dedupKey.trim().isEmpty()) {
                    conn.setRequestProperty("X-Excel-Alert-Dedup-Key", dedupKey);
                }
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bodyJson.getBytes(StandardCharsets.UTF_8));
                }
                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    return true;
                }
            } catch (Throwable ignore) {
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
            if (i < maxTry - 1) {
                try {
                    Thread.sleep(delays[Math.min(i, delays.length - 1)]);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
        }
        return false;
    }

    private String sha256Hex(String text) {
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
        } catch (Exception e) {
            return "";
        }
    }

    private int parseIntParam(String val, int def) {
        try {
            return (val == null || val.trim().isEmpty()) ? def : Integer.parseInt(val.trim());
        } catch (Exception e) {
            return def;
        }
    }

    private boolean isTruthy(Object value) {
        if (value == null) {
            return false;
        }
        String s = String.valueOf(value).trim();
        return "true".equalsIgnoreCase(s) || "Y".equalsIgnoreCase(s) || "1".equals(s) || "on".equalsIgnoreCase(s);
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
