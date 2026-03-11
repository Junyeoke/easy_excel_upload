package com.steg.lit.repository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

import javax.naming.Context;
import javax.naming.InitialContext;
import javax.sql.DataSource;
import java.sql.*;
import java.util.*;

/**
 * =====================================================================
 * [EasySyncRepository]
 * 역할: 데이터베이스 접근(CRUD)만 담당합니다.
 *   - ESO_SYNC_CONFIG 설정 저장 / 조회 / 삭제
 *   - efc_sequence 시퀀스 블록 할당
 *   - 테이블 / 컬럼 메타 조회
 *   - 동기화 실행 중 DB 조작 (적재 INSERT, 상태 UPDATE, PostSQL)
 * =====================================================================
 */
@Repository
public class EasySyncRepository {

    private static final Logger log = LoggerFactory.getLogger(EasySyncRepository.class);

    // =========================================================================
    // DataSource
    // =========================================================================

    public DataSource getDataSource() throws Exception {
        Context ctx = new InitialContext();
        return (DataSource) ((Context) ctx.lookup("java:comp/env")).lookup("egene");
    }

    public Connection getConnection() throws Exception {
        return getDataSource().getConnection();
    }

    // =========================================================================
    // 공통 유틸
    // =========================================================================

    public static void close(AutoCloseable... resources) {
        for (AutoCloseable r : resources) {
            if (r != null) try { r.close(); } catch (Exception ignore) {}
        }
    }

    private String getString(String s) { return s == null ? "" : s.trim(); }

    // =========================================================================
    // Job 목록 조회
    // =========================================================================

    public List<Map<String, Object>> getJobList() throws Exception {
        Connection conn = null;
        PreparedStatement pstmt = null;
        ResultSet rs = null;
        try {
            conn = getConnection();
            pstmt = conn.prepareStatement(
                "SELECT SYNC_ID, JOB_NAME, CRON_EXP, USE_YN, LAST_RUN_DTTM, LAST_RESULT"
                + " FROM ESO_SYNC_CONFIG ORDER BY REG_DTTM DESC"
            );
            rs = pstmt.executeQuery();

            List<Map<String, Object>> list = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> o = new LinkedHashMap<>();
                o.put("sync_id",       getString(rs.getString("SYNC_ID")));
                o.put("job_name",      getString(rs.getString("JOB_NAME")));
                o.put("cron_exp",      getString(rs.getString("CRON_EXP")));
                o.put("use_yn",        getString(rs.getString("USE_YN")));
                o.put("last_run_dttm", getString(rs.getString("LAST_RUN_DTTM")));
                o.put("last_result",   getString(rs.getString("LAST_RESULT")));
                list.add(o);
            }
            return list;
        } finally {
            close(rs, pstmt, conn);
        }
    }

    // =========================================================================
    // Job 단건 조회
    // =========================================================================

    public Map<String, Object> getJobDetail(String syncId) throws Exception {
        Connection conn = null;
        PreparedStatement pstmt = null;
        ResultSet rs = null;
        try {
            conn = getConnection();
            pstmt = conn.prepareStatement("SELECT * FROM ESO_SYNC_CONFIG WHERE SYNC_ID=?");
            pstmt.setString(1, syncId);
            rs = pstmt.executeQuery();

            Map<String, Object> detail = new LinkedHashMap<>();
            if (rs.next()) {
                ResultSetMetaData rsmd = rs.getMetaData();
                for (int i = 1; i <= rsmd.getColumnCount(); i++) {
                    String colName = rsmd.getColumnLabel(i).toLowerCase();
                    detail.put(colName, getString(rs.getString(i)));
                }
            }
            return detail;
        } finally {
            close(rs, pstmt, conn);
        }
    }

    // =========================================================================
    // Job 저장 (INSERT or UPDATE)
    // =========================================================================

    public void saveJob(Connection conn, String syncId, boolean isUpdate, Map<String, String> fields) throws Exception {
        String sql = isUpdate
            ? "UPDATE ESO_SYNC_CONFIG SET JOB_NAME=?, CRON_EXP=?, USE_YN=?,"
                + " SRC_TABLE=?, TGT_TABLE=?, TGT_PK_COL=?, ENT_ID=?,"
                + " CMP_TABLE=?, STATUS_COL=?, VAL_NEW=?, VAL_MATCH=?, VAL_DIFF=?,"
                + " MATCH_CMP_PK=?, MATCH_TGT_FK=?,"
                + " LOAD_MAP_JSON=?, CMP_KEY_JSON=?, CMP_MAP_JSON=?, POST_SQL_JSON=?"
                + " WHERE SYNC_ID=?"
            : "INSERT INTO ESO_SYNC_CONFIG"
                + " (JOB_NAME, CRON_EXP, USE_YN,"
                + "  SRC_TABLE, TGT_TABLE, TGT_PK_COL, ENT_ID,"
                + "  CMP_TABLE, STATUS_COL, VAL_NEW, VAL_MATCH, VAL_DIFF,"
                + "  MATCH_CMP_PK, MATCH_TGT_FK,"
                + "  LOAD_MAP_JSON, CMP_KEY_JSON, CMP_MAP_JSON, POST_SQL_JSON,"
                + "  SYNC_ID, REG_DTTM)"
                + " VALUES (?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?, ?,CURRENT_TIMESTAMP)";

        try (PreparedStatement pstmt = conn.prepareStatement(sql)) {
            int idx = 1;
            pstmt.setString(idx++, fields.get("job_name"));
            pstmt.setString(idx++, fields.get("cron_exp"));
            pstmt.setString(idx++, fields.get("use_yn"));
            pstmt.setString(idx++, fields.get("src_table"));
            pstmt.setString(idx++, fields.get("tgt_table"));
            pstmt.setString(idx++, fields.get("tgt_pk_col"));
            pstmt.setString(idx++, fields.get("ent_id"));
            pstmt.setString(idx++, fields.get("cmp_table"));
            pstmt.setString(idx++, fields.get("status_col"));
            pstmt.setString(idx++, fields.get("val_new"));
            pstmt.setString(idx++, fields.get("val_match"));
            pstmt.setString(idx++, fields.get("val_diff"));
            pstmt.setString(idx++, fields.get("match_cmp_pk"));
            pstmt.setString(idx++, fields.get("match_tgt_fk"));
            pstmt.setString(idx++, fields.get("load_map_json"));
            pstmt.setString(idx++, fields.get("cmp_key_json"));
            pstmt.setString(idx++, fields.get("cmp_map_json"));
            pstmt.setString(idx++, fields.get("post_sql_json"));
            pstmt.setString(idx++, syncId);
            pstmt.executeUpdate();
        }
        log.info("[EasySync] Job {} 완료 (sync_id={})", isUpdate ? "수정" : "저장", syncId);
    }

    // =========================================================================
    // Job 삭제
    // =========================================================================

    public void deleteJob(Connection conn, String syncId) throws Exception {
        try (PreparedStatement pstmt = conn.prepareStatement("DELETE FROM ESO_SYNC_CONFIG WHERE SYNC_ID=?")) {
            pstmt.setString(1, syncId);
            pstmt.executeUpdate();
        }
        log.info("[EasySync] Job 삭제 완료 (sync_id={})", syncId);
    }

    // =========================================================================
    // 마지막 실행 결과 업데이트
    // =========================================================================

    public void updateLastRun(Connection conn, String syncId, String lastResult) throws Exception {
        try (PreparedStatement pstmt = conn.prepareStatement(
                "UPDATE ESO_SYNC_CONFIG SET LAST_RUN_DTTM=CURRENT_TIMESTAMP, LAST_RESULT=? WHERE SYNC_ID=?")) {
            pstmt.setString(1, lastResult);
            pstmt.setString(2, syncId);
            pstmt.executeUpdate();
        }
    }

    // =========================================================================
    // 동기화 설정 데이터 조회 (processSync용)
    // =========================================================================

    public Map<String, String> getSyncConfig(Connection conn, String syncId) throws Exception {
        PreparedStatement pstmt = null;
        ResultSet rs = null;
        try {
            pstmt = conn.prepareStatement("SELECT * FROM ESO_SYNC_CONFIG WHERE SYNC_ID=?");
            pstmt.setString(1, syncId);
            rs = pstmt.executeQuery();
            if (!rs.next()) throw new Exception("설정 정보를 찾을 수 없습니다. (Job ID: [" + syncId + "])");

            Map<String, String> cfg = new LinkedHashMap<>();
            cfg.put("src_table",    getString(rs.getString("src_table")));
            cfg.put("tgt_table",    getString(rs.getString("tgt_table")));
            cfg.put("tgt_pk_col",   getString(rs.getString("tgt_pk_col")));
            cfg.put("ent_id",       getString(rs.getString("ent_id")));
            cfg.put("cmp_table",    getString(rs.getString("cmp_table")));
            cfg.put("status_col",   getString(rs.getString("status_col")));
            cfg.put("val_new",      getString(rs.getString("val_new")));
            cfg.put("val_match",    getString(rs.getString("val_match")));
            cfg.put("val_diff",     getString(rs.getString("val_diff")));
            cfg.put("match_cmp_pk", getString(rs.getString("match_cmp_pk")));
            cfg.put("match_tgt_fk", getString(rs.getString("match_tgt_fk")));
            cfg.put("load_map_json", rs.getString("load_map_json"));
            cfg.put("cmp_key_json",  rs.getString("cmp_key_json"));
            cfg.put("cmp_map_json",  rs.getString("cmp_map_json"));
            cfg.put("post_sql_json", rs.getString("post_sql_json"));
            return cfg;
        } finally {
            close(rs, pstmt);
        }
    }

    // =========================================================================
    // 시퀀스 블록 할당 (FOR UPDATE 잠금 후 한 번에 예약)
    // =========================================================================

    /**
     * efc_sequence 테이블에서 블록 할당 후 시작 번호 반환.
     * @return int[4] { currentSeqNo, seqLength, prefix존재여부(0/1), midno존재여부(0/1) }
     *         prefix, midno는 별도로 map에 담아 반환
     */
    public Map<String, Object> allocateSequenceBlock(Connection conn, String entId, int count) throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        String seqQry = "SELECT SEQ_PREFIX, SEQ_MIDNO, SEQ_NO, SEQ_LENGTH FROM efc_sequence WHERE SEQ_ID = ? FOR UPDATE";
        try (PreparedStatement psSeq = conn.prepareStatement(seqQry)) {
            psSeq.setString(1, entId);
            try (ResultSet rsSeq = psSeq.executeQuery()) {
                if (!rsSeq.next()) return result; // 시퀀스 없음
                result.put("seq_prefix",  getString(rsSeq.getString("SEQ_PREFIX")));
                result.put("seq_midno",   getString(rsSeq.getString("SEQ_MIDNO")));
                result.put("current_no",  rsSeq.getInt("SEQ_NO"));
                result.put("seq_length",  rsSeq.getInt("SEQ_LENGTH"));
                result.put("found",       true);
            }
        }

        // 블록 예약
        try (PreparedStatement psUpd = conn.prepareStatement(
                "UPDATE efc_sequence SET SEQ_NO = SEQ_NO + ? WHERE SEQ_ID = ?")) {
            psUpd.setInt(1, count);
            psUpd.setString(2, entId);
            psUpd.executeUpdate();
        }
        return result;
    }

    // =========================================================================
    // 원본 → 대상 테이블 배치 INSERT
    // =========================================================================

    public int batchInsertFromSource(Connection conn, String srcQuery, String insertSql,
                                      List<Map<String, Object>> loadMaps,
                                      boolean hasPk, boolean useEntitySeq,
                                      String seqPrefix, String seqMidno,
                                      int startSeqNo, int seqLength) throws Exception {
        try (PreparedStatement psSrc = conn.prepareStatement(srcQuery);
             ResultSet rsSrc = psSrc.executeQuery();
             PreparedStatement psInsert = conn.prepareStatement(insertSql)) {

            int loadCount = 0;
            int currentSeqNo = startSeqNo;

            while (rsSrc.next()) {
                int pIdx = 1;
                if (hasPk) {
                    String newPk;
                    if (useEntitySeq) {
                        currentSeqNo++;
                        String paddedNo = String.format("%0" + seqLength + "d", currentSeqNo);
                        // midno가 있으면 prefix + midno + "-" + no, 없으면 prefix + no
                        String mid = (seqMidno != null && !seqMidno.isEmpty()) ? seqMidno + "-" : "";
                        newPk = seqPrefix + mid + paddedNo;
                    } else {
                        newPk = java.util.UUID.randomUUID().toString()
                            .replace("-", "").toUpperCase().substring(0, 15);
                    }
                    psInsert.setString(pIdx++, newPk);
                }
                for (Map<String, Object> m : loadMaps) {
                    psInsert.setString(pIdx++, rsSrc.getString((String) m.get("src")));
                }
                psInsert.addBatch();

                if (++loadCount % 1000 == 0) {
                    psInsert.executeBatch();
                    psInsert.clearBatch();
                }
            }
            psInsert.executeBatch();
            return loadCount;
        }
    }

    // =========================================================================
    // 원본 행 건수 조회
    // =========================================================================

    public int countSourceRows(Connection conn, String srcQuery) throws Exception {
        String countSql = "SELECT COUNT(*) FROM (" + srcQuery + ") AS T_CNT";
        try (PreparedStatement psCnt = conn.prepareStatement(countSql);
             ResultSet rsCnt = psCnt.executeQuery()) {
            if (rsCnt.next()) return rsCnt.getInt(1);
        }
        return 0;
    }

    // =========================================================================
    // 비교 테이블 상태 UPDATE (New / Match / Diff)
    // =========================================================================

    public int updateStatusNew(Connection conn, String tgtTable, String statusCol,
                                String valNew, String joinCond, String cmpTable) throws Exception {
        String sql = "UPDATE " + tgtTable + " T"
            + " SET T." + statusCol + " = ?"
            + " WHERE NOT EXISTS (SELECT 1 FROM " + cmpTable + " C WHERE " + joinCond + ")";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, valNew);
            return ps.executeUpdate();
        }
    }

    public int updateStatusMatchDiff(Connection conn, String sqlMatchDiff,
                                      boolean hasCmpMaps, String valDiff, String valMatch) throws Exception {
        try (PreparedStatement ps = conn.prepareStatement(sqlMatchDiff)) {
            int pIdx = 1;
            if (hasCmpMaps) {
                ps.setString(pIdx++, valDiff);
                ps.setString(pIdx++, valMatch);
            } else {
                ps.setString(pIdx++, valMatch);
            }
            return ps.executeUpdate();
        }
    }

    // =========================================================================
    // 후처리 SQL 실행
    // =========================================================================

    public int executePostSqls(Connection conn, List<Map<String, Object>> postSqls) throws Exception {
        int count = 0;
        for (Map<String, Object> obj : postSqls) {
            String sql = (String) obj.get("sql");
            if (sql != null && !sql.trim().isEmpty()) {
                try (PreparedStatement ps = conn.prepareStatement(sql.trim())) {
                    ps.executeUpdate();
                    count++;
                }
            }
        }
        return count;
    }

    // =========================================================================
    // 테이블 목록 조회 (UI용)
    // =========================================================================

    public List<Map<String, String>> getTables() throws Exception {
        Connection conn = null;
        PreparedStatement pstmt = null;
        ResultSet rs = null;
        try {
            conn = getConnection();
            String sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name";
            // Oracle/Tibero 대응
            try {
                String dbProd = conn.getMetaData().getDatabaseProductName();
                if (dbProd != null && (dbProd.toLowerCase().contains("oracle") || dbProd.toLowerCase().contains("tibero"))) {
                    sql = "SELECT table_name FROM user_tables ORDER BY table_name";
                }
            } catch (Throwable ignore) {}

            pstmt = conn.prepareStatement(sql);
            rs = pstmt.executeQuery();

            List<Map<String, String>> list = new ArrayList<>();
            while (rs.next()) {
                String tableName = rs.getString(1);
                Map<String, String> obj = new LinkedHashMap<>();
                obj.put("value", tableName);
                obj.put("label", tableName);
                list.add(obj);
            }
            return list;
        } finally {
            close(rs, pstmt, conn);
        }
    }

    // =========================================================================
    // 컬럼 목록 조회 (UI용)
    // =========================================================================

    public List<Map<String, String>> getColumns(String input) throws Exception {
        boolean isQuery = input.toUpperCase().startsWith("SELECT");
        String sql = isQuery
            ? "SELECT * FROM (" + input + ") AS V_META WHERE 1=0"
            : "SELECT * FROM " + input + " WHERE 1=0";

        Connection conn = null;
        PreparedStatement pstmt = null;
        ResultSet rs = null;
        try {
            conn = getConnection();
            pstmt = conn.prepareStatement(sql);
            rs = pstmt.executeQuery();
            ResultSetMetaData meta = rs.getMetaData();

            List<Map<String, String>> list = new ArrayList<>();
            for (int i = 1; i <= meta.getColumnCount(); i++) {
                String colName = meta.getColumnLabel(i).toLowerCase();
                Map<String, String> obj = new LinkedHashMap<>();
                obj.put("value", colName);
                obj.put("label", colName);
                list.add(obj);
            }
            return list;
        } finally {
            close(rs, pstmt, conn);
        }
    }
}
