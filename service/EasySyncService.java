package com.steg.lit.service;

import com.steg.lit.repository.EasySyncRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.text.SimpleDateFormat;
import java.util.*;

/**
 * =====================================================================
 * [EasySyncService]
 * 역할: 비즈니스 로직을 담당합니다.
 *   - 동기화 실행 (processSync) — STEP1~4 오케스트레이션
 *   - Job CRUD 비즈니스 처리 (save / delete)
 *   - MiniJsonParser (경량 JSON 파싱)
 *   - 공통 문자열 유틸 (restore, toJson, fetchNewKey 등)
 * =====================================================================
 */
@Service
public class EasySyncService {

    private static final Logger log = LoggerFactory.getLogger(EasySyncService.class);

    private final EasySyncRepository repository;

    public EasySyncService(EasySyncRepository repository) {
        this.repository = repository;
    }

    // =========================================================================
    // 1. 공통 유틸
    // =========================================================================

    public static String restore(String s) {
        if (s == null) return "";
        return s.replace("&quot;", "\"").replace("&#34;", "\"")
                .replace("&lt;", "<").replace("&#60;", "<")
                .replace("&gt;", ">").replace("&#62;", ">")
                .replace("&amp;", "&").replace("&#38;", "&")
                .replace("&#039;", "'").replace("&apos;", "'");
    }

    public static String restoreJson(String s) {
        if (s == null || s.trim().isEmpty()) return "[]";
        return restore(s);
    }

    public static String getString(String s) { return s == null ? "" : s.trim(); }

    public static boolean isValid(String s) { return s != null && !s.trim().isEmpty(); }

    /** UniqueKey.getInstance().fetchNewKey() — Reflection으로 프레임워크 의존성 분리 */
    public String fetchNewKey() throws Exception {
        Class<?> ukClass = Class.forName("org.sdf.util.UniqueKey");
        Object instance = ukClass.getMethod("getInstance").invoke(null);
        return (String) instance.getClass().getMethod("fetchNewKey").invoke(instance);
    }

    // =========================================================================
    // 2. JSON 직렬화
    // =========================================================================

    public static String toJson(Object obj) {
        if (obj == null) return "null";
        if (obj instanceof String) {
            String s = (String) obj;
            s = s.replace("\\", "\\\\").replace("\"", "\\\"")
                 .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
            return "\"" + s + "\"";
        }
        if (obj instanceof Boolean) return obj.toString();
        if (obj instanceof Number)  return obj.toString();
        if (obj instanceof Map) {
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) obj).entrySet()) {
                if (!first) sb.append(",");
                sb.append("\"").append(e.getKey()).append("\":").append(toJson(e.getValue()));
                first = false;
            }
            return sb.append("}").toString();
        }
        if (obj instanceof List) {
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object item : (List<?>) obj) {
                if (!first) sb.append(",");
                sb.append(toJson(item));
                first = false;
            }
            return sb.append("]").toString();
        }
        return "\"" + obj + "\"";
    }

    // =========================================================================
    // 3. 경량 JSON 파서
    // =========================================================================

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> parseJsonArray(String json) {
        Object parsed = MiniJsonParser.parse(json);
        if (parsed instanceof List) return (List<Map<String, Object>>) parsed;
        return new ArrayList<>();
    }

    public static class MiniJsonParser {
        public static Object parse(String s) {
            if (s == null || s.trim().isEmpty()) return null;
            try { return new Parser(s.trim()).parse(); }
            catch (Exception e) { return null; }
        }

        private static class Parser {
            final String s; int i = 0;
            Parser(String str) { this.s = str; }

            void skip() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

            Object parse() {
                skip();
                if (i >= s.length()) return null;
                char c = s.charAt(i);
                if (c == '{') return parseObj();
                if (c == '[') return parseArr();
                if (c == '"') return parseStr();
                if (s.startsWith("true",  i)) { i += 4; return true; }
                if (s.startsWith("false", i)) { i += 5; return false; }
                if (s.startsWith("null",  i)) { i += 4; return null; }
                return parseNum();
            }

            Map<String, Object> parseObj() {
                Map<String, Object> m = new LinkedHashMap<>();
                i++; skip();
                if (i < s.length() && s.charAt(i) == '}') { i++; return m; }
                while (i < s.length()) {
                    String k = parseStr(); skip();
                    if (i < s.length() && s.charAt(i) == ':') i++;
                    skip();
                    m.put(k, parse()); skip();
                    if (i < s.length() && s.charAt(i) == ',') { i++; skip(); }
                    else if (i < s.length() && s.charAt(i) == '}') { i++; break; }
                }
                return m;
            }

            List<Object> parseArr() {
                List<Object> l = new ArrayList<>();
                i++; skip();
                if (i < s.length() && s.charAt(i) == ']') { i++; return l; }
                while (i < s.length()) {
                    l.add(parse()); skip();
                    if (i < s.length() && s.charAt(i) == ',') { i++; skip(); }
                    else if (i < s.length() && s.charAt(i) == ']') { i++; break; }
                }
                return l;
            }

            String parseStr() {
                if (i < s.length() && s.charAt(i) == '"') i++;
                StringBuilder sb = new StringBuilder();
                while (i < s.length()) {
                    char c = s.charAt(i++);
                    if (c == '"') break;
                    if (c == '\\' && i < s.length()) {
                        char esc = s.charAt(i++);
                        if (esc == 'n') sb.append('\n');
                        else if (esc == 'r') sb.append('\r');
                        else if (esc == 't') sb.append('\t');
                        else sb.append(esc);
                    } else {
                        sb.append(c);
                    }
                }
                return sb.toString();
            }

            String parseNum() {
                int start = i;
                while (i < s.length() && "-0123456789.eE+".indexOf(s.charAt(i)) >= 0) i++;
                return s.substring(start, i);
            }
        }
    }

    // =========================================================================
    // 4. Job CRUD 비즈니스 처리
    // =========================================================================

    public List<Map<String, Object>> getJobList() throws Exception {
        return repository.getJobList();
    }

    public Map<String, Object> getJobDetail(String syncId) throws Exception {
        return repository.getJobDetail(syncId);
    }

    /**
     * Job 저장 (신규/수정)
     * @return 저장된 sync_id
     */
    public String saveJob(Map<String, String> fields) throws Exception {
        String syncId = getString(fields.get("sync_id"));
        boolean isUpdate = isValid(syncId);
        if (!isUpdate) syncId = fetchNewKey();

        Connection conn = null;
        try {
            conn = repository.getConnection();
            conn.setAutoCommit(false);
            repository.saveJob(conn, syncId, isUpdate, fields);
            conn.commit();
        } catch (Exception e) {
            if (conn != null) try { conn.rollback(); } catch (Exception ignore) {}
            throw e;
        } finally {
            EasySyncRepository.close(conn);
        }
        return syncId;
    }

    /**
     * Job 삭제
     */
    public void deleteJob(String syncId) throws Exception {
        Connection conn = null;
        try {
            conn = repository.getConnection();
            conn.setAutoCommit(false);
            repository.deleteJob(conn, syncId);
            conn.commit();
        } catch (Exception e) {
            if (conn != null) try { conn.rollback(); } catch (Exception ignore) {}
            throw e;
        } finally {
            EasySyncRepository.close(conn);
        }
    }

    // =========================================================================
    // 5. 동기화 실행 엔진 (핵심 비즈니스 로직)
    // =========================================================================

    public Map<String, Object> processSync(String syncId) {
        Map<String, Object> result = new HashMap<>();
        List<String> logs = new ArrayList<>();
        SimpleDateFormat sdf = new SimpleDateFormat("[yyyy-MM-dd HH:mm:ss] ");

        Connection conn = null;
        try {
            conn = repository.getConnection();
            conn.setAutoCommit(false);

            // ── 설정 데이터 로드 ──────────────────────────────────────────
            Map<String, String> cfg = repository.getSyncConfig(conn, syncId);

            String srcTable   = restore(cfg.get("src_table"));
            String tgtTable   = restore(cfg.get("tgt_table"));
            String tgtPkCol   = restore(cfg.get("tgt_pk_col"));
            String entId      = restore(cfg.get("ent_id"));
            String cmpTable   = restore(cfg.get("cmp_table"));
            String statusCol  = restore(cfg.get("status_col"));
            String valNew     = restore(cfg.get("val_new"));
            String valMatch   = restore(cfg.get("val_match"));
            String valDiff    = restore(cfg.get("val_diff"));
            String matchCmpPk = restore(cfg.get("match_cmp_pk"));
            String matchTgtFk = restore(cfg.get("match_tgt_fk"));
            boolean useMatchFk = !matchCmpPk.isEmpty() && !matchTgtFk.isEmpty();

            List<Map<String, Object>> loadMaps = parseJsonArray(restoreJson(cfg.get("load_map_json")));
            List<Map<String, Object>> cmpKeys  = parseJsonArray(restoreJson(cfg.get("cmp_key_json")));
            List<Map<String, Object>> cmpMaps  = parseJsonArray(restoreJson(cfg.get("cmp_map_json")));
            List<Map<String, Object>> postSqls = parseJsonArray(restoreJson(cfg.get("post_sql_json")));

            logs.add(sdf.format(new Date()) + "🚀 동기화 작업 시작: " + syncId);

            // ─────────────────────────────────────────────────────────────
            // STEP 1 & 2: 원본 스트리밍 조회 → 대상 테이블 적재 (Batch Insert)
            // ─────────────────────────────────────────────────────────────
            if (!loadMaps.isEmpty() && isValid(tgtTable)) {
                boolean hasPk = !tgtPkCol.isEmpty();

                // INSERT SQL 구성
                StringBuilder insertCols = new StringBuilder();
                StringBuilder insertVals = new StringBuilder();
                if (hasPk) { insertCols.append(tgtPkCol).append(","); insertVals.append("?,"); }
                for (int i = 0; i < loadMaps.size(); i++) {
                    insertCols.append((String) loadMaps.get(i).get("tgt")).append(i < loadMaps.size() - 1 ? "," : "");
                    insertVals.append("?").append(i < loadMaps.size() - 1 ? "," : "");
                }
                String insertSql = "INSERT INTO " + tgtTable + " (" + insertCols + ") VALUES (" + insertVals + ")";
                String srcQuery  = srcTable.trim().toUpperCase().startsWith("SELECT")
                    ? srcTable.trim() : "SELECT * FROM " + srcTable;

                // 전체 건수 파악 (시퀀스 블록 할당용)
                int totalRows = repository.countSourceRows(conn, srcQuery);

                // 시퀀스 벌크 할당
                String seqPrefix = "", seqMidno = "";
                int currentSeqNo = 0, seqLength = 5;
                boolean useEntitySeq = false;

                if (hasPk && totalRows > 0 && isValid(entId)) {
                    Map<String, Object> seqInfo = repository.allocateSequenceBlock(conn, entId, totalRows);
                    if (Boolean.TRUE.equals(seqInfo.get("found"))) {
                        seqPrefix    = getString((String) seqInfo.get("seq_prefix"));
                        seqMidno     = getString((String) seqInfo.get("seq_midno"));
                        currentSeqNo = (Integer) seqInfo.get("current_no");
                        seqLength    = (Integer) seqInfo.get("seq_length");
                        useEntitySeq = true;
                        logs.add(sdf.format(new Date())
                            + "⚡ 시퀀스 벌크 할당 완료: " + entId + " (총 " + totalRows + "개 예약)");
                    }
                }

                int loadCount = repository.batchInsertFromSource(
                    conn, srcQuery, insertSql, loadMaps,
                    hasPk, useEntitySeq, seqPrefix, seqMidno, currentSeqNo, seqLength
                );
                logs.add(sdf.format(new Date())
                    + "💾 원본 추출 및 대상 테이블(" + tgtTable + ") 적재 완료: " + loadCount + "건");
            } else {
                logs.add(sdf.format(new Date()) + "⚠️ 적재 매핑이 없어 Insert 단계를 건너뜁니다.");
            }

            // ─────────────────────────────────────────────────────────────
            // STEP 3: 비교 테이블 대사 (Bulk UPDATE)
            // ─────────────────────────────────────────────────────────────
            if (!cmpKeys.isEmpty() && isValid(cmpTable) && !statusCol.isEmpty()) {
                logs.add(sdf.format(new Date()) + "🔍 비교 테이블(" + cmpTable + ") 대사 작업 시작...");

                // JOIN 조건 구성
                StringBuilder joinCond = new StringBuilder();
                for (int i = 0; i < cmpKeys.size(); i++) {
                    if (i > 0) joinCond.append(" AND ");
                    joinCond.append("T.").append((String) cmpKeys.get(i).get("tgt"))
                            .append(" = C.").append((String) cmpKeys.get(i).get("cmp"));
                }

                // 1) New 상태 갱신
                int newCnt = repository.updateStatusNew(conn, tgtTable, statusCol, valNew, joinCond.toString(), cmpTable);
                logs.add(sdf.format(new Date()) + "📊 상태값 [New] 갱신 완료: " + newCnt + "건");

                // 2) Match / Diff 상태 갱신 SQL 구성
                boolean hasCmpMaps = !cmpMaps.isEmpty();
                StringBuilder sqlMatch = new StringBuilder();
                sqlMatch.append("UPDATE ").append(tgtTable).append(" T SET T.").append(statusCol).append(" = ");

                if (hasCmpMaps) {
                    sqlMatch.append("CASE WHEN ");
                    for (int i = 0; i < cmpMaps.size(); i++) {
                        if (i > 0) sqlMatch.append(" OR ");
                        String tCol     = "T." + (String) cmpMaps.get(i).get("tgt");
                        String cColName = (String) cmpMaps.get(i).get("cmp");
                        String scalarSub = "(SELECT C." + cColName + " FROM " + cmpTable + " C WHERE " + joinCond + ")";
                        sqlMatch.append("COALESCE(").append(tCol).append(",'') != COALESCE(").append(scalarSub).append(",'')");
                    }
                    sqlMatch.append(" THEN ? ELSE ? END");
                } else {
                    sqlMatch.append("?");
                }

                if (useMatchFk) {
                    String fkScalar = "(SELECT C." + matchCmpPk + " FROM " + cmpTable + " C WHERE " + joinCond + ")";
                    sqlMatch.append(", T.").append(matchTgtFk).append(" = ").append(fkScalar);
                }
                sqlMatch.append(" WHERE EXISTS (SELECT 1 FROM ").append(cmpTable).append(" C WHERE ").append(joinCond).append(")");

                int updatedCnt = repository.updateStatusMatchDiff(conn, sqlMatch.toString(), hasCmpMaps, valDiff, valMatch);
                logs.add(sdf.format(new Date()) + "📊 상태값 [Match/Diff] 갱신 완료: " + updatedCnt + "건");
            }

            // ─────────────────────────────────────────────────────────────
            // STEP 4: 후처리 SQL
            // ─────────────────────────────────────────────────────────────
            int postCount = repository.executePostSqls(conn, postSqls);
            if (postCount > 0)
                logs.add(sdf.format(new Date()) + "🛠️ 후처리 SQL " + postCount + "건 실행 완료");

            // 완료 처리
            logs.add(sdf.format(new Date()) + "✅ 동기화 작업이 성공적으로 완료되었습니다.");
            repository.updateLastRun(conn, syncId, "성공");
            conn.commit();

            result.put("status", "ok");
            result.put("msg", "Job executed successfully.");
            result.put("logs", logs);

        } catch (Exception e) {
            if (conn != null) try { conn.rollback(); } catch (Exception ignore) {}
            log.error("[EasySync] processSync 오류: {}", e.getMessage(), e);
            logs.add(sdf.format(new Date()) + "❌ 치명적 오류 발생: " + e.getMessage());
            result.put("status", "err");
            result.put("msg", e.getMessage());
            result.put("logs", logs);
        } finally {
            EasySyncRepository.close(conn);
        }
        return result;
    }

    // =========================================================================
    // 6. UI용 메타 조회 위임
    // =========================================================================

    public List<Map<String, String>> getTables() throws Exception {
        return repository.getTables();
    }

    public List<Map<String, String>> getColumns(String input) throws Exception {
        return repository.getColumns(input);
    }
}
