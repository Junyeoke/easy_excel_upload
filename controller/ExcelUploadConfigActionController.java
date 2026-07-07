// ExcelUploadConfigActionController.java
package com.steg.lit.controller;

import com.steg.lit.repository.ExcelUploadEngineRepository;
import com.steg.lit.service.ExcelUploadEngineService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.sql.Connection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Handles upload configuration actions for the legacy /api/excel/engine endpoint.
 */
@Component
public class ExcelUploadConfigActionController {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadConfigActionController.class);

    private final ExcelUploadEngineService service;
    private final ExcelUploadEngineRepository repository;

    public ExcelUploadConfigActionController(ExcelUploadEngineService service,
            ExcelUploadEngineRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    public void handleSave(DataSource ds, Map<String, Object> params,
            byte[] sampleFileBytes, String sampleFileOrgName,
            Map<String, Object> result) throws Exception {
        Connection conn = null;
        try {
            conn = ds.getConnection();
            conn.setAutoCommit(false);

            String uploadId = (String) params.get("upload_id");
            boolean isUpdate = uploadId != null && !uploadId.trim().isEmpty() && !"undefined".equals(uploadId);
            String upsertKeepEmptyYn = normalizeYn((String) params.get("upsert_keep_empty_yn"));
            String rollbackOnFailYn = normalizeYn((String) params.get("rollback_on_fail_yn"));
            String postSqlRollbackOnFailYn = normalizeYn((String) params.get("post_sql_rollback_on_fail_yn"));

            Object ukeyObj;
            try {
                Class<?> ukClass = Class.forName("org.sdf.util.UniqueKey");
                ukeyObj = ukClass.getMethod("getInstance").invoke(null);
            } catch (Throwable e) {
                throw new Exception("UniqueKey 라이브러리를 찾을 수 없습니다.");
            }

            if (!isUpdate) {
                uploadId = (String) ukeyObj.getClass().getMethod("fetchNewKey").invoke(ukeyObj);
            }

            String savedSampleFileName = null;
            String savedSampleFileOrgName = null;
            if (sampleFileBytes != null && sampleFileBytes.length > 0) {
                // 2026-06-19: 샘플 파일 저장 위치를 요청 파라미터로 지정할 수 있도록 처리한다.
                String requestedDownloadName = (String) params.get("sample_file_download_name");
                savedSampleFileOrgName = (requestedDownloadName != null && !requestedDownloadName.trim().isEmpty())
                        ? requestedDownloadName.trim()
                        : (sampleFileOrgName != null && !sampleFileOrgName.trim().isEmpty() ? sampleFileOrgName : "sample.xlsx");
                File targetFile = resolveSampleFileTarget(params, uploadId, savedSampleFileOrgName);
                File parentDir = targetFile.getParentFile();
                if (parentDir != null && !parentDir.exists()) {
                    Files.createDirectories(parentDir.toPath());
                }
                savedSampleFileName = targetFile.getAbsolutePath();
                try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                    fos.write(sampleFileBytes);
                } catch (Throwable fex) {
                    throw new Exception("샘플 파일 저장 실패: " + fex.getMessage());
                }
            } else if (isUpdate) {
                String[] info = repository.getSampleFileInfo(conn, uploadId);
                if (info != null) {
                    savedSampleFileName = info[0];
                    savedSampleFileOrgName = info[1];
                }
            }

            Map<String, Object> configData = new LinkedHashMap<>();
            configData.put("upload_id", uploadId);
            configData.put("is_update", isUpdate);
            configData.put("job_name", service.restore(decodeParam(params, "job_name_b64", "job_name")));
            configData.put("header_row", parseIntParam((String) params.get("header_row"), 1));
            configData.put("struct_json", service.restore(decodeParam(params, "struct_json_b64", "struct_json")));
            configData.put("mapping_json", service.restore(decodeParam(params, "mapping_json_b64", "mapping_json")));
            configData.put("pre_sql_json", service.restore(decodeParam(params, "pre_sql_json_b64", "pre_sql_json")));
            configData.put("post_sql_json", service.restore(decodeParam(params, "post_sql_json_b64", "post_sql_json")));
            configData.put("row_sql_json", service.restore(decodeParam(params, "row_sql_json_b64", "row_sql_json")));
            configData.put("instructions", service.restore(decodeParam(params, "instructions_b64", "instructions")));
            configData.put("sample_file_name", savedSampleFileName);
            configData.put("sample_file_org_name", savedSampleFileOrgName);
            // 2026-06-19: UPSERT에서 빈 칸은 기존 값을 유지할지 저장한다.
            configData.put("upsert_keep_empty_yn", upsertKeepEmptyYn);
            // 2026-07-07: 업로드 실패 행이 있으면 전체 업로드 트랜잭션을 롤백할지 저장한다.
            configData.put("rollback_on_fail_yn", rollbackOnFailYn);
            // 2026-07-07: Post-SQL 실패 시 업로드 트랜잭션까지 롤백할지 저장한다.
            configData.put("post_sql_rollback_on_fail_yn", postSqlRollbackOnFailYn);
            // 2026-06-20: 대량 업로드 서버 부하 방지를 위해 로더별 최대 업로드 행 수를 저장한다. 0이면 제한 없음.
            configData.put("max_upload_rows", Math.max(parseIntParam((String) params.get("max_upload_rows"), 0), 0));

            String savedId = repository.saveConfig(conn, configData);
            conn.commit();
            result.put("status", "ok");
            result.put("upload_id", savedId);
        } catch (Throwable e) {
            if (conn != null) try {
                conn.rollback();
            } catch (Throwable ignore) {
            }
            log.error("[ExcelUpload] config save error: {}", e.getMessage(), e);
            throw new Exception("저장 중 오류 발생: " + e.getMessage(), e);
        } finally {
            if (conn != null) try {
                conn.close();
            } catch (Throwable ignore) {
            }
        }
    }

    public void handleGetList(DataSource ds, Map<String, Object> result) throws Exception {
        try (Connection conn = ds.getConnection()) {
            List<Map<String, Object>> list = repository.getConfigList(conn);
            result.put("status", "ok");
            result.put("list", list);
        }
    }

    public void handleGetDetail(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        try (Connection conn = ds.getConnection()) {
            Map<String, Object> row = repository.getConfigDetail(conn, (String) params.get("upload_id"));
            if (row != null) {
                result.put("status", "ok");
                result.putAll(row);
            } else {
                result.put("status", "err");
                result.put("msg", "해당 ID의 설정을 찾을 수 없습니다.");
            }
        }
    }

    public void handleDelete(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        String uploadId = (String) params.get("upload_id");
        if (uploadId == null || uploadId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "upload_id가 필요합니다.");
            return;
        }
        Connection conn = null;
        try {
            conn = ds.getConnection();
            conn.setAutoCommit(false);
            repository.deleteConfig(conn, uploadId);
            conn.commit();
            result.put("status", "ok");
            result.put("msg", "삭제 완료");
        } catch (Throwable e) {
            if (conn != null) try {
                conn.rollback();
            } catch (Throwable ignore) {
            }
            log.error("[ExcelUpload] config delete error: {}", e.getMessage(), e);
            throw new Exception("삭제 중 오류: " + e.getMessage());
        } finally {
            if (conn != null) try {
                conn.close();
            } catch (Throwable ignore) {
            }
        }
    }

    public void handleClone(DataSource ds, Map<String, Object> params,
            Map<String, Object> result) throws Exception {
        String sourceId = (String) params.get("upload_id");
        if (sourceId == null || sourceId.trim().isEmpty()) {
            result.put("status", "err");
            result.put("msg", "upload_id가 필요합니다.");
            return;
        }
        Connection conn = null;
        try {
            String newId;
            try {
                Class<?> ukClass = Class.forName("org.sdf.util.UniqueKey");
                Object ukeyObj = ukClass.getMethod("getInstance").invoke(null);
                newId = (String) ukeyObj.getClass().getMethod("fetchNewKey").invoke(ukeyObj);
            } catch (Throwable e) {
                throw new Exception("UniqueKey 라이브러리를 찾을 수 없습니다.");
            }

            conn = ds.getConnection();
            conn.setAutoCommit(false);
            String nowFunc = repository.detectNowFunction(conn);
            String clonedId = repository.cloneConfig(conn, sourceId, newId, nowFunc);
            conn.commit();
            result.put("status", "ok");
            result.put("msg", "복제 완료");
            result.put("new_upload_id", clonedId);
        } catch (Throwable e) {
            if (conn != null) try {
                conn.rollback();
            } catch (Throwable ignore) {
            }
            log.error("[ExcelUpload] config clone error: {}", e.getMessage(), e);
            throw new Exception("복제 중 오류: " + e.getMessage());
        } finally {
            if (conn != null) try {
                conn.close();
            } catch (Throwable ignore) {
            }
        }
    }

    private String decodeParam(Map<String, Object> params, String b64Key, String plainKey) {
        String b64 = (String) params.get(b64Key);
        if (b64 != null) {
            return service.decodeSafeBase64(b64);
        }
        return plainKey != null ? (String) params.get(plainKey) : null;
    }

    private int parseIntParam(String val, int def) {
        try {
            return Integer.parseInt(val);
        } catch (Throwable e) {
            return def;
        }
    }

    private String normalizeYn(String value) {
        return "Y".equalsIgnoreCase(trimToNull(value)) ? "Y" : "N";
    }

    private File resolveSampleFileTarget(Map<String, Object> params, String uploadId, String downloadName) throws Exception {
        String filePath = trimToNull((String) params.get("sample_file_path"));
        if (filePath != null) {
            return new File(filePath);
        }

        String fileDir = trimToNull((String) params.get("sample_file_dir"));
        String fileExt = ".xlsx";
        if (downloadName != null && downloadName.contains(".")) {
            fileExt = downloadName.substring(downloadName.lastIndexOf("."));
        }
        String fileName = uploadId + "_sample" + fileExt;

        if (fileDir != null) {
            // 2026-06-19: sample_file_dir 는 디렉터리로 해석한다.
            return new File(new File(fileDir), fileName);
        }

        return new File(service.getSampleFileDir(), fileName);
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
