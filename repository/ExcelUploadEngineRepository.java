// ExcelUploadEngineRepository.java
package com.steg.lit.repository;



import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

import javax.sql.DataSource;
import java.sql.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * =====================================================================
 * [ExcelUploadEngineRepository]
 * 역할: 데이터베이스 접근(CRUD)만 담당합니다.
 *   - ESO_EXCEL_UPLOAD_CONFIG 설정 저장 / 조회
 *   - ESO_EXCEL_UPLOAD_HISTORY 이력 저장
 *   - TMP_EXCEL_UPLOAD_KEYS 임시 키 테이블
 *   - efc_sequence / ecf_entity 시퀀스 & 메타 조회
 *   - 테이블/컬럼 메타 조회
 * =====================================================================
 */
@Repository
public class ExcelUploadEngineRepository {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadEngineRepository.class);
    private static final Logger sqlLog = LoggerFactory.getLogger("com.steg.sql");
    private static final AtomicBoolean CONFIG_SCHEMA_VERIFIED = new AtomicBoolean(false);
    private static final AtomicBoolean HISTORY_SCHEMA_VERIFIED = new AtomicBoolean(false);

    private final DataSource dataSource;

    public ExcelUploadEngineRepository(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public DataSource getDataSource() {
        return dataSource;
    }

    private String sqlValue(Object value) {
        if (value == null) {
            return "NULL";
        }
        String text = String.valueOf(value).replace("\r", "\\r").replace("\n", "\\n");
        if (text.length() > 300) {
            text = text.substring(0, 300) + "...(" + text.length() + " chars)";
        }
        return "'" + text + "'";
    }

    // =====================================================================
    // 1. FastSequenceManager (시퀀스 채번 - 블록 단위 캐싱)
    // =====================================================================

    public static class FastSequenceManager {
        private final DataSource ds;
        private final int blockSize;

        static class SeqState {
            String prefix, midNo, suffix;
            int length;
            long currentNo, maxNo;
        }

        private final Map<String, SeqState> cache = new HashMap<>();

        public FastSequenceManager(DataSource ds, int blockSize) {
            this.ds = ds;
            this.blockSize = blockSize;
        }

        public String getNextId(String seqId) throws Exception {
            if (seqId == null || seqId.trim().isEmpty()) return "";
            seqId = seqId.toUpperCase();

            SeqState state = cache.get(seqId);
            if (state == null || state.currentNo >= state.maxNo) {
                state = fetchBlock(seqId);
                cache.put(seqId, state);
            }

            long no = state.currentNo++;
            String noStr = String.valueOf(no);
            while (noStr.length() < state.length) noStr = "0" + noStr;

            StringBuilder id = new StringBuilder();
            if (state.prefix != null) id.append(state.prefix.trim());
            if (state.midNo != null && !state.midNo.trim().isEmpty()) {
                id.append(state.midNo.trim());
                if (!id.toString().endsWith("-")) id.append("-");
            }
            id.append(noStr);
            if (state.suffix != null) id.append(state.suffix.trim());

            return id.toString();
        }

        private SeqState fetchBlock(String seqId) throws Exception {
            SeqState state = new SeqState();
            Connection conn = null;
            PreparedStatement pstmt = null;
            ResultSet rs = null;
            try {
                conn = ds.getConnection();
                conn.setAutoCommit(false);
                pstmt = conn.prepareStatement("SELECT * FROM efc_sequence WHERE seq_id = ? FOR UPDATE");
                pstmt.setString(1, seqId);
                rs = pstmt.executeQuery();
                if (rs.next()) {
                    state.prefix    = rs.getString("SEQ_PREFIX");
                    state.midNo     = rs.getString("SEQ_MIDNO");
                    state.suffix    = rs.getString("SEQ_SUFFIX");
                    state.length    = rs.getInt("SEQ_LENGTH");
                    long dbNo       = rs.getLong("SEQ_NO");
                    state.currentNo = dbNo + 1;
                    state.maxNo     = state.currentNo + blockSize;

                    rs.close();
                    pstmt.close();

                    pstmt = conn.prepareStatement("UPDATE efc_sequence SET seq_no = ? WHERE seq_id = ?");
                    pstmt.setLong(1, dbNo + blockSize);
                    pstmt.setString(2, seqId);
                    pstmt.executeUpdate();
                    conn.commit();
                } else {
                    try { conn.rollback(); } catch (Exception ex) {}
                    throw new Exception("SEQ_NOT_FOUND");
                }
            } catch (Exception e) {
                if (conn != null) try { conn.rollback(); } catch (Exception ex) {}
                throw e;
            } finally {
                if (rs    != null) try { rs.close();    } catch (Exception e) {}
                if (pstmt != null) try { pstmt.close(); } catch (Exception e) {}
                if (conn  != null) try { conn.close();  } catch (Exception e) {}
            }
            return state;
        }
    }

    // =====================================================================
    // 2. 설정(Config) CRUD
    // =====================================================================

    /**
     * 설정 저장 (INSERT or UPDATE)
     */
    public String saveConfig(Connection conn, Map<String, Object> configData) throws Exception {
        String uploadId = (String) configData.get("upload_id");
        // Controller에서 이미 isUpdate 여부를 판단하고 새 ID를 발급했으므로,
        // 여기서 다시 판별하면 "새 ID가 있으니 UPDATE"로 잘못 분기됩니다.
        // 반드시 Controller가 전달한 플래그를 사용해야 합니다.
        Object isUpdateFlag = configData.get("is_update");
        boolean isUpdate = Boolean.TRUE.equals(isUpdateFlag);

        ensureConfigSchema(conn);

        String nowFunc = detectNowFunction(conn);

        String sql = isUpdate
            ? "UPDATE ESO_EXCEL_UPLOAD_CONFIG SET JOB_NAME=?, HEADER_ROW=?, STRUCT_JSON=?, MAPPING_JSON=?, " +
              "PRE_SQL_JSON=?, POST_SQL_JSON=?, ROW_SQL_JSON=?, SAMPLE_FILE_NAME=?, SAMPLE_FILE_ORG_NAME=?, " +
              "INSTRUCTIONS=?, REG_DTTM=" + nowFunc + " WHERE UPLOAD_ID=?"
            : "INSERT INTO ESO_EXCEL_UPLOAD_CONFIG " +
              "(JOB_NAME, HEADER_ROW, STRUCT_JSON, MAPPING_JSON, PRE_SQL_JSON, POST_SQL_JSON, ROW_SQL_JSON, " +
              "SAMPLE_FILE_NAME, SAMPLE_FILE_ORG_NAME, INSTRUCTIONS, UPLOAD_ID, REG_DTTM) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, " + nowFunc + ")";

        try (PreparedStatement pstmt = conn.prepareStatement(sql)) {
            int idx = 1;
            pstmt.setString(idx++, (String) configData.get("job_name"));
            pstmt.setInt(idx++, (Integer) configData.get("header_row"));
            pstmt.setString(idx++, (String) configData.get("struct_json"));
            pstmt.setString(idx++, (String) configData.get("mapping_json"));
            pstmt.setString(idx++, (String) configData.get("pre_sql_json"));
            pstmt.setString(idx++, (String) configData.get("post_sql_json"));
            pstmt.setString(idx++, (String) configData.get("row_sql_json"));
            pstmt.setString(idx++, (String) configData.get("sample_file_name"));
            pstmt.setString(idx++, (String) configData.get("sample_file_org_name"));
            pstmt.setString(idx++, (String) configData.get("instructions"));
            pstmt.setString(idx++, uploadId);
            int affected = pstmt.executeUpdate();
            if (isUpdate && affected == 0) {
                throw new Exception("업데이트할 레코드가 없습니다. (UPLOAD_ID=" + uploadId +
                    ") - 데이터가 DB에 존재하는지 확인하세요.");
            }
        }
        log.info("[ExcelUpload] 설정 저장 완료 (Upload ID: {}, isUpdate: {})", uploadId, isUpdate);
        return uploadId;
    }

    /**
     * 설정 단건 조회
     */
    public Map<String, Object> getConfigDetail(Connection conn, String uploadId) throws Exception {
        try (PreparedStatement pstmt = conn.prepareStatement(
                "SELECT * FROM ESO_EXCEL_UPLOAD_CONFIG WHERE UPLOAD_ID = ?")) {
            pstmt.setString(1, uploadId);
            try (ResultSet rs = pstmt.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("upload_id",            rs.getString("UPLOAD_ID"));
                    row.put("job_name",              rs.getString("JOB_NAME"));
                    row.put("header_row",            rs.getInt("HEADER_ROW"));
                    row.put("struct_json",           nullToDefault(rs.getString("STRUCT_JSON"),   "[]"));
                    row.put("mapping_json",          nullToDefault(rs.getString("MAPPING_JSON"),  "{}"));
                    row.put("pre_sql_json",          nullToDefault(rs.getString("PRE_SQL_JSON"),  "[]"));
                    row.put("post_sql_json",         nullToDefault(rs.getString("POST_SQL_JSON"), "[]"));
                    row.put("row_sql_json",          nullToDefault(rs.getString("ROW_SQL_JSON"),  "[]"));
                    row.put("sample_file_name",      rs.getString("SAMPLE_FILE_NAME"));
                    row.put("sample_file_org_name",  rs.getString("SAMPLE_FILE_ORG_NAME"));
                    try { row.put("instructions", rs.getString("INSTRUCTIONS")); } catch (Throwable ignore) {}
                    return row;
                }
            }
        }
        return null;
    }

    /**
     * 샘플 파일 정보 조회
     */
    public String[] getSampleFileInfo(Connection conn, String uploadId) throws Exception {
        try (PreparedStatement pstmt = conn.prepareStatement(
                "SELECT SAMPLE_FILE_NAME, SAMPLE_FILE_ORG_NAME FROM ESO_EXCEL_UPLOAD_CONFIG WHERE UPLOAD_ID = ?")) {
            pstmt.setString(1, uploadId);
            try (ResultSet rs = pstmt.executeQuery()) {
                if (rs.next()) {
                    return new String[]{ rs.getString("SAMPLE_FILE_NAME"), rs.getString("SAMPLE_FILE_ORG_NAME") };
                }
            }
        }
        return null;
    }

    /**
     * 설정 목록 조회
     */
    public List<Map<String, Object>> getConfigList(Connection conn) throws Exception {
        List<Map<String, Object>> list = new ArrayList<>();
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(
                 "SELECT UPLOAD_ID, JOB_NAME, HEADER_ROW, SAMPLE_FILE_ORG_NAME, REG_DTTM " +
                 "FROM ESO_EXCEL_UPLOAD_CONFIG ORDER BY REG_DTTM DESC")) {
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("upload_id",           rs.getString("UPLOAD_ID"));
                row.put("job_name",             rs.getString("JOB_NAME"));
                row.put("header_row",           rs.getInt("HEADER_ROW"));
                row.put("sample_file_org_name", rs.getString("SAMPLE_FILE_ORG_NAME"));
                row.put("reg_dttm",             String.valueOf(rs.getObject("REG_DTTM")));
                list.add(row);
            }
        }
        return list;
    }

    // =====================================================================
    // 3. 이력 (History) 저장
    // =====================================================================

    /**
     * 업로드 이력 테이블 스키마 검증
     */
    public void ensureHistoryTable(Connection conn, String nowFunc) throws Exception {
        if (HISTORY_SCHEMA_VERIFIED.get()) {
            return;
        }
        validateTableAndColumns(conn, "ESO_EXCEL_UPLOAD_HISTORY",
                new String[]{"HIST_ID", "JOB_NAME", "FILE_NAME", "SUCCESS_CNT", "FAIL_CNT", "ERROR_FILE", "REG_DTTM"},
                "CREATE TABLE ESO_EXCEL_UPLOAD_HISTORY (\n" +
                "    HIST_ID VARCHAR2(64) PRIMARY KEY,\n" +
                "    JOB_NAME VARCHAR2(128),\n" +
                "    FILE_NAME VARCHAR2(256),\n" +
                "    SUCCESS_CNT NUMBER(10),\n" +
                "    FAIL_CNT NUMBER(10),\n" +
                "    ERROR_FILE VARCHAR2(256),\n" +
                "    REG_DTTM DATE\n" +
                ");");
        HISTORY_SCHEMA_VERIFIED.set(true);
    }

    private void ensureConfigSchema(Connection conn) throws Exception {
        if (CONFIG_SCHEMA_VERIFIED.get()) {
            return;
        }
        validateTableAndColumns(conn, "ESO_EXCEL_UPLOAD_CONFIG",
                new String[]{"UPLOAD_ID", "JOB_NAME", "HEADER_ROW", "STRUCT_JSON", "MAPPING_JSON",
                        "PRE_SQL_JSON", "POST_SQL_JSON", "ROW_SQL_JSON", "SAMPLE_FILE_NAME",
                        "SAMPLE_FILE_ORG_NAME", "INSTRUCTIONS", "REG_DTTM"},
                "ALTER TABLE ESO_EXCEL_UPLOAD_CONFIG ADD INSTRUCTIONS CLOB;");
        CONFIG_SCHEMA_VERIFIED.set(true);
    }

    private void validateTableAndColumns(Connection conn, String tableName, String[] requiredColumns,
                                         String migrationGuideSql) throws Exception {
        DatabaseMetaData metaData = conn.getMetaData();
        if (!tableExists(metaData, tableName)) {
            throw new Exception("필수 테이블이 없습니다: " + tableName + "\n필요 SQL 예시:\n" + migrationGuideSql);
        }
        for (String columnName : requiredColumns) {
            if (!columnExists(metaData, tableName, columnName)) {
                throw new Exception("필수 컬럼이 없습니다: " + tableName + "." + columnName +
                        "\n필요 SQL 예시:\n" + migrationGuideSql);
            }
        }
    }

    private boolean tableExists(DatabaseMetaData metaData, String tableName) throws SQLException {
        return metadataLookupExists(() -> metaData.getTables(null, null, tableName, null))
                || metadataLookupExists(() -> metaData.getTables(null, null, tableName.toUpperCase(Locale.ROOT), null))
                || metadataLookupExists(() -> metaData.getTables(null, null, tableName.toLowerCase(Locale.ROOT), null));
    }

    private boolean columnExists(DatabaseMetaData metaData, String tableName, String columnName) throws SQLException {
        return metadataLookupExists(() -> metaData.getColumns(null, null, tableName, columnName))
                || metadataLookupExists(() -> metaData.getColumns(null, null,
                        tableName.toUpperCase(Locale.ROOT), columnName.toUpperCase(Locale.ROOT)))
                || metadataLookupExists(() -> metaData.getColumns(null, null,
                        tableName.toLowerCase(Locale.ROOT), columnName.toLowerCase(Locale.ROOT)));
    }

    private boolean metadataLookupExists(ResultSetSupplier supplier) throws SQLException {
        try (ResultSet rs = supplier.get()) {
            return rs.next();
        }
    }

    @FunctionalInterface
    private interface ResultSetSupplier {
        ResultSet get() throws SQLException;
    }

    /**
     * 업로드 이력 저장
     */
    public String insertHistory(Connection conn, String histId, String jobName, String fileName,
                                int successCnt, int failCnt, String errorFile, String nowFunc) {
        String sql = "INSERT INTO ESO_EXCEL_UPLOAD_HISTORY " +
                "(HIST_ID, JOB_NAME, FILE_NAME, SUCCESS_CNT, FAIL_CNT, ERROR_FILE, REG_DTTM) " +
                "VALUES (?, ?, ?, ?, ?, ?, " + nowFunc + ")";
        try (PreparedStatement histPs = conn.prepareStatement(
                sql)) {
            histPs.setString(1, histId);
            histPs.setString(2, jobName == null || jobName.trim().isEmpty() ? "일반 데이터 업로드" : jobName);
            histPs.setString(3, fileName);
            histPs.setInt(4, successCnt);
            histPs.setInt(5, failCnt);
            histPs.setString(6, errorFile);
            sqlLog.info("[ExcelUpload][HISTORY-INSERT] SQL={} | params={{HIST_ID={}, JOB_NAME={}, FILE_NAME={}, SUCCESS_CNT={}, FAIL_CNT={}, ERROR_FILE={}}}",
                    sql,
                    sqlValue(histId),
                    sqlValue(jobName == null || jobName.trim().isEmpty() ? "일반 데이터 업로드" : jobName),
                    sqlValue(fileName),
                    successCnt,
                    failCnt,
                    sqlValue(errorFile));
            histPs.executeUpdate();
            conn.commit();
            return null;
        } catch (Throwable e) {
            String message = e.getMessage() != null ? e.getMessage() : e.toString();
            log.warn("[ExcelUpload] 업로드 이력 저장 실패 - histId={}, jobName={}, fileName={}: {}",
                    histId, jobName, fileName, message, e);
            return message;
        }
    }

    /**
     * 업로드 이력 목록 조회
     */
    public List<Map<String, Object>> getHistory(Connection conn, String uploadId) throws Exception {
        List<Map<String, Object>> list = new ArrayList<>();
        String sql = "SELECT HIST_ID, JOB_NAME, FILE_NAME, SUCCESS_CNT, FAIL_CNT, ERROR_FILE, REG_DTTM " +
                     "FROM ESO_EXCEL_UPLOAD_HISTORY ORDER BY REG_DTTM DESC";
        try (PreparedStatement pstmt = conn.prepareStatement(sql);
             ResultSet rs = pstmt.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("hist_id",      rs.getString("HIST_ID"));
                row.put("job_name",     rs.getString("JOB_NAME"));
                row.put("file_name",    rs.getString("FILE_NAME"));
                row.put("success_cnt",  rs.getInt("SUCCESS_CNT"));
                row.put("fail_cnt",     rs.getInt("FAIL_CNT"));
                row.put("error_file",   rs.getString("ERROR_FILE"));
                row.put("reg_dttm",     String.valueOf(rs.getObject("REG_DTTM")));
                list.add(row);
            }
        }
        return list;
    }

    // =====================================================================
    // 4. 임시 업로드 키 테이블
    // =====================================================================

    public void ensureTempUploadKeysTable(Connection conn) {
        try (Statement stmt = conn.createStatement()) {
            try {
                stmt.execute("CREATE TEMPORARY TABLE IF NOT EXISTS TMP_EXCEL_UPLOAD_KEYS " +
                             "(alias VARCHAR(64), table_name VARCHAR(128), pk_col VARCHAR(128), pk_val VARCHAR(128))");
            } catch (Throwable e1) {
                try {
                    stmt.execute("CREATE GLOBAL TEMPORARY TABLE TMP_EXCEL_UPLOAD_KEYS " +
                                 "(alias VARCHAR2(64), table_name VARCHAR2(128), pk_col VARCHAR2(128), pk_val VARCHAR2(128)) " +
                                 "ON COMMIT PRESERVE ROWS");
                } catch (Throwable e2) {}
            }
        } catch (Throwable e) {}
    }

    public void insertTempUploadKey(Connection conn, String alias, String tableName,
                                    String pkCol, String pkVal, Map<String, Object> psCache) {
        final String TMP_KEY_PS = "_TMP_KEY_PS_";
        try {
            PreparedStatement ps = (PreparedStatement) psCache.get(TMP_KEY_PS);
            String sql = "INSERT INTO TMP_EXCEL_UPLOAD_KEYS (alias, table_name, pk_col, pk_val) VALUES (?, ?, ?, ?)";
            if (ps == null) {
                ps = conn.prepareStatement(sql);
                psCache.put(TMP_KEY_PS, ps);
            }
            ps.setString(1, alias);
            ps.setString(2, tableName);
            ps.setString(3, pkCol);
            ps.setString(4, pkVal);
            sqlLog.info("[ExcelUpload][TEMP-KEY-BATCH-ADD] SQL={} | params={{alias={}, table_name={}, pk_col={}, pk_val={}}}",
                    sql, sqlValue(alias), sqlValue(tableName), sqlValue(pkCol), sqlValue(pkVal));
            ps.addBatch();
        } catch (Throwable e) {}
    }

    // =====================================================================
    // 5. 엔티티 & 컬럼 메타 조회
    // =====================================================================

    public String getEntityIdByTableName(Connection conn, String tableName) {
        if (!isValidSqlIdentifier(tableName)) return null;
        try (PreparedStatement pstmt = conn.prepareStatement(
                "SELECT ent_id FROM ecf_entity WHERE lower(ent_tab_master)=?")) {
            pstmt.setString(1, tableName.toLowerCase());
            try (ResultSet rs = pstmt.executeQuery()) {
                if (rs.next()) return rs.getString(1);
            }
        } catch (Exception e) {}
        return null;
    }

    public Set<String> getNumericColumnNames(Connection conn, String tableName) {
        Set<String> numericColumns = new HashSet<>();
        if (!isValidSqlIdentifier(tableName)) return numericColumns;
        try (PreparedStatement pstmt = conn.prepareStatement("SELECT * FROM " + tableName + " WHERE 1=0");
             ResultSet rs = pstmt.executeQuery()) {
            ResultSetMetaData meta = rs.getMetaData();
            for (int i = 1; i <= meta.getColumnCount(); i++) {
                int type = meta.getColumnType(i);
                if (type == Types.INTEGER || type == Types.BIGINT  || type == Types.DECIMAL ||
                    type == Types.NUMERIC  || type == Types.FLOAT  || type == Types.DOUBLE  || type == Types.SMALLINT) {
                    numericColumns.add(meta.getColumnName(i).toLowerCase());
                }
            }
        } catch (Exception e) {}
        return numericColumns;
    }

    /**
     * 테이블의 문자열 컬럼별 최대 길이(바이트)와 NOT NULL 컬럼 목록을 반환합니다.
     * Pre-validation 에서 DB 에 보내기 전에 모든 오류 컬럼을 한꺼번에 탐지하는 데 사용합니다.
     *
     * 반환 구조:
     *   result.get("lengths")  → Map<String(colName_lower), Integer(maxLen)>
     *   result.get("notnulls") → Set<String(colName_lower)>
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getColumnConstraints(Connection conn, String tableName) {
        Map<String, Object> result = new HashMap<>();
        Map<String, Integer> lengths  = new HashMap<>();
        Set<String>          notNulls = new HashSet<>();
        result.put("lengths",  lengths);
        result.put("notnulls", notNulls);

        if (!isValidSqlIdentifier(tableName)) return result;
        try (PreparedStatement pstmt = conn.prepareStatement("SELECT * FROM " + tableName + " WHERE 1=0");
             ResultSet rs = pstmt.executeQuery()) {
            ResultSetMetaData meta = rs.getMetaData();
            for (int i = 1; i <= meta.getColumnCount(); i++) {
                String colName = meta.getColumnName(i).toLowerCase();
                int type = meta.getColumnType(i);
                // 문자열 계열 컬럼만 길이 제약 수집
                // ★ getPrecision() 사용: MySQL utf8mb4 환경에서 getColumnDisplaySize()는
                //   bytes × charset_multiplier(4)를 반환하지만, getPrecision()은
                //   항상 실제 문자 수(character count)를 반환합니다.
                //   VARCHAR(100) → getPrecision()=100, getColumnDisplaySize()=400 (utf8mb4)
                if (type == Types.VARCHAR || type == Types.CHAR ||
                    type == Types.NVARCHAR || type == Types.NCHAR) {
                    // getPrecision() = 실제 컬럼 선언 문자 수 (e.g. VARCHAR(100) → 100)
                    int charLen = meta.getPrecision(i);
                    // 안전망: getPrecision이 0이거나 비정상이면 getColumnDisplaySize로 폴백
                    // 단, getColumnDisplaySize가 charset 배수로 부풀려지는 경우를 대비해
                    // 둘 중 작은 값을 사용합니다.
                    if (charLen <= 0) {
                        charLen = meta.getColumnDisplaySize(i);
                    } else {
                        int displaySize = meta.getColumnDisplaySize(i);
                        if (displaySize > 0 && displaySize < charLen) {
                            charLen = displaySize; // 드물지만 더 작은 쪽이 실제 제약일 수 있음
                        }
                    }
                    if (charLen > 0 && charLen < 100_000) { // TEXT/LONGTEXT 계열 제외
                        lengths.put(colName, charLen);
                    }
                }
                // NOT NULL 컬럼 수집
                try {
                    if (meta.isNullable(i) == ResultSetMetaData.columnNoNulls) {
                        notNulls.add(colName);
                    }
                } catch (Throwable ignore) {}
            }
        } catch (Exception e) {
            log.debug("[ExcelUpload] getColumnConstraints 실패 ({}): {}", tableName, e.getMessage());
        }
        return result;
    }

    /**
     * DB 테이블 목록 조회
     */
    public List<Map<String, Object>> getTables(Connection conn) throws Exception {
        List<Map<String, Object>> list = new ArrayList<>();
        try (ResultSet rs = conn.getMetaData().getTables(null, null, "%", new String[]{"TABLE"})) {
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("table_name",   rs.getString("TABLE_NAME"));
                row.put("table_schema", rs.getString("TABLE_SCHEM"));
                list.add(row);
            }
        }
        return list;
    }

    /**
     * 특정 테이블의 컬럼 목록 조회
     */
    public List<Map<String, Object>> getColumns(Connection conn, String tableName) throws Exception {
        List<Map<String, Object>> list = new ArrayList<>();
        if (!isValidSqlIdentifier(tableName)) throw new Exception("Invalid table name: " + tableName);
        try (ResultSet rs = conn.getMetaData().getColumns(null, null, tableName.toUpperCase(), "%")) {
            while (rs.next()) {
                Map<String, Object> col = new LinkedHashMap<>();
                col.put("column_name", rs.getString("COLUMN_NAME"));
                col.put("data_type",   rs.getString("TYPE_NAME"));
                col.put("column_size", rs.getInt("COLUMN_SIZE"));
                col.put("nullable",    rs.getString("IS_NULLABLE"));
                list.add(col);
            }
        }
        // Oracle/Tibero fallback
        if (list.isEmpty()) {
            try (PreparedStatement pstmt = conn.prepareStatement(
                    "SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = ? ORDER BY COLUMN_ID")) {
                pstmt.setString(1, tableName.toUpperCase());
                try (ResultSet rs = pstmt.executeQuery()) {
                    while (rs.next()) {
                        Map<String, Object> col = new LinkedHashMap<>();
                        col.put("column_name", rs.getString("COLUMN_NAME"));
                        col.put("data_type",   rs.getString("DATA_TYPE"));
                        col.put("column_size", rs.getInt("DATA_LENGTH"));
                        col.put("nullable",    "Y".equals(rs.getString("NULLABLE")) ? "YES" : "NO");
                        list.add(col);
                    }
                }
            } catch (Throwable ignore) {}
        }
        return list;
    }

    /**
 * 설정 삭제
 */
public void deleteConfig(Connection conn, String uploadId) throws Exception {
    try (PreparedStatement pstmt = conn.prepareStatement(
            "DELETE FROM ESO_EXCEL_UPLOAD_CONFIG WHERE UPLOAD_ID = ?")) {
        pstmt.setString(1, uploadId);
        int affected = pstmt.executeUpdate();
        if (affected == 0) throw new Exception("삭제할 설정을 찾을 수 없습니다. (UPLOAD_ID=" + uploadId + ")");
    }
    log.info("[ExcelUpload] 설정 삭제 완료 (Upload ID: {})", uploadId);
}

/**
 * 설정 복제 (새 ID로 INSERT, job_name에 "(복제)" 접미사)
 */
public String cloneConfig(Connection conn, String sourceId, String newId, String nowFunc) throws Exception {
    String sql =
        "INSERT INTO ESO_EXCEL_UPLOAD_CONFIG " +
        "(UPLOAD_ID, JOB_NAME, HEADER_ROW, STRUCT_JSON, MAPPING_JSON, " +
        " PRE_SQL_JSON, POST_SQL_JSON, ROW_SQL_JSON, INSTRUCTIONS, REG_DTTM) " +
        "SELECT ?, CONCAT(JOB_NAME, ' (복제)'), HEADER_ROW, STRUCT_JSON, MAPPING_JSON, " +
        "       PRE_SQL_JSON, POST_SQL_JSON, ROW_SQL_JSON, INSTRUCTIONS, " + nowFunc +
        " FROM ESO_EXCEL_UPLOAD_CONFIG WHERE UPLOAD_ID = ?";

    // Oracle/Tibero는 CONCAT 대신 || 연산자 사용
    try (PreparedStatement pstmt = conn.prepareStatement(sql)) {
        pstmt.setString(1, newId);
        pstmt.setString(2, sourceId);
        int affected = pstmt.executeUpdate();
        if (affected == 0) {
            // Oracle 폴백: || 연산자
            String oracleSql =
                "INSERT INTO ESO_EXCEL_UPLOAD_CONFIG " +
                "(UPLOAD_ID, JOB_NAME, HEADER_ROW, STRUCT_JSON, MAPPING_JSON, " +
                " PRE_SQL_JSON, POST_SQL_JSON, ROW_SQL_JSON, INSTRUCTIONS, REG_DTTM) " +
                "SELECT ?, JOB_NAME || ' (복제)', HEADER_ROW, STRUCT_JSON, MAPPING_JSON, " +
                "       PRE_SQL_JSON, POST_SQL_JSON, ROW_SQL_JSON, INSTRUCTIONS, " + nowFunc +
                " FROM ESO_EXCEL_UPLOAD_CONFIG WHERE UPLOAD_ID = ?";
            try (PreparedStatement ps2 = conn.prepareStatement(oracleSql)) {
                ps2.setString(1, newId);
                ps2.setString(2, sourceId);
                affected = ps2.executeUpdate();
            }
        }
        if (affected == 0) throw new Exception("복제 원본 설정을 찾을 수 없습니다. (UPLOAD_ID=" + sourceId + ")");
    }
    log.info("[ExcelUpload] 설정 복제 완료 ({} → {})", sourceId, newId);
    return newId;
}

    // =====================================================================
    // 6. 공통 유틸
    // =====================================================================

    /**
     * DB 종류에 맞는 현재시각 함수 반환 (NOW() or SYSDATE)
     */
    public String detectNowFunction(Connection conn) {
        try {
            String dbProd = conn.getMetaData().getDatabaseProductName();
            if (dbProd != null && (dbProd.toLowerCase().contains("oracle") || dbProd.toLowerCase().contains("tibero"))) {
                return "SYSDATE";
            }
        } catch (Throwable ignore) {}
        return "NOW()";
    }

    private boolean isValidSqlIdentifier(String s) {
        if (s == null || s.trim().isEmpty()) return false;
        return s.matches("^[a-zA-Z0-9_.]+$");
    }

    private String nullToDefault(String val, String def) {
        return (val == null || val.trim().isEmpty()) ? def : val;
    }



}
