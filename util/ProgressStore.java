package com.steg.lit.util;

import java.util.*;
import java.util.concurrent.*;

/**
 * =====================================================================
 * [ProgressStore]
 * 엑셀 업로드 진행률 / 로그를 서버 인메모리에 저장합니다.
 *
 * 기존 HttpSession 방식의 문제점:
 *   - 세션 타임아웃 시 진행률 데이터 유실
 *   - 세션 클러스터링 환경에서 sticky session 필요
 *   - SSE 스트리밍 스레드와 업로드 처리 스레드 간 공유 불가
 *
 * 개선 포인트:
 *   - ConcurrentHashMap 기반 → 멀티스레드 안전
 *   - 진행 중 Job은 1시간, 완료 Job은 10분 TTL 후 자동 정리
 *   - SSE 스트리밍 스레드가 직접 읽어 push 가능
 * =====================================================================
 */
public class ProgressStore {
    private static final long ACTIVE_JOB_TTL_MS = 3_600_000L;
    private static final long FINISHED_JOB_TTL_MS = 600_000L;
    private static final ScheduledExecutorService CLEANUP_EXECUTOR =
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "excel-progress-cleanup");
            t.setDaemon(true);
            return t;
        });

    // ── 내부 상태 클래스 ──────────────────────────────────────────────
    public static class JobProgress {
        public volatile int     current   = 0;
        public volatile int     total     = 0;
        public volatile boolean done      = false;   // 정상 완료 또는 오류로 종료
        public volatile String  errorMsg  = null;    // null이면 정상
        public volatile boolean cancelRequested = false; // 사용자 취소 요청 여부
        public volatile String  uploadId  = "";
        public volatile String  status    = "running";
        public volatile int     successCnt = 0;
        public volatile int     failCnt    = 0;
        public volatile String  errorFile  = "";
        public final List<String> logs    = Collections.synchronizedList(new ArrayList<>());
        public final long createdAt       = System.currentTimeMillis();
        public volatile long updatedAt    = System.currentTimeMillis();
    }

    // ── 저장소 (jobId → JobProgress) ─────────────────────────────────
    private static final ConcurrentHashMap<String, JobProgress> STORE = new ConcurrentHashMap<>();

    // =====================================================================
    // Public API
    // =====================================================================

    /**
     * 새 Job 등록. upload 시작 시 호출.
     * @param jobId     프론트에서 생성한 JOB_ + timestamp 식별자
     * @param total     전체 처리 예정 행 수
     */
    public static void init(String jobId, int total) {
        JobProgress p = new JobProgress();
        p.total = total;
        STORE.put(jobId, p);
        cleanup(); // 오래된 항목 정리
    }

    /**
     * 현재 처리된 행 수 갱신.
     */
    public static void update(String jobId, int current) {
        JobProgress p = STORE.get(jobId);
        if (p != null) {
            p.current   = current;
            p.updatedAt = System.currentTimeMillis();
        }
    }

    /**
     * 로그 메시지 추가.
     */
    public static void addLog(String jobId, String msg) {
        JobProgress p = STORE.get(jobId);
        if (p != null) {
            p.logs.add(msg);
            p.updatedAt = System.currentTimeMillis();
        }
    }

    /**
     * 업로드 정상 완료 마킹.
     */
    public static void complete(String jobId) {
        JobProgress p = STORE.get(jobId);
        if (p != null) {
            p.current   = p.total;
            p.done      = true;
            if (p.status == null || p.status.isEmpty() || "running".equalsIgnoreCase(p.status)) {
                p.status = "done";
            }
            p.updatedAt = System.currentTimeMillis();
            scheduleRemove(jobId, FINISHED_JOB_TTL_MS);
        }
    }

    /**
     * 업로드 오류 종료 마킹.
     */
    public static void error(String jobId, String msg) {
        JobProgress p = STORE.get(jobId);
        if (p != null) {
            p.errorMsg  = msg;
            p.done      = true;
            p.status    = "err";
            p.updatedAt = System.currentTimeMillis();
            scheduleRemove(jobId, FINISHED_JOB_TTL_MS);
        }
    }

    /**
     * 업로드 최종 집계값 저장.
     */
    public static void setFinalResult(String jobId, String uploadId, int successCnt, int failCnt, String errorFile, String status) {
        JobProgress p = STORE.get(jobId);
        if (p != null) {
            if (uploadId != null) {
                p.uploadId = uploadId;
            }
            p.successCnt = Math.max(successCnt, 0);
            p.failCnt = Math.max(failCnt, 0);
            p.errorFile = errorFile == null ? "" : errorFile;
            if (status != null && !status.trim().isEmpty()) {
                p.status = status;
            }
            p.updatedAt = System.currentTimeMillis();
        }
    }

    /**
     * 업로드 취소 요청.
     * @return job 존재 여부
     */
    public static boolean requestCancel(String jobId) {
        JobProgress p = STORE.get(jobId);
        if (p == null) {
            return false;
        }
        p.cancelRequested = true;
        p.updatedAt = System.currentTimeMillis();
        return true;
    }

    /**
     * 업로드 취소 요청 여부 조회.
     */
    public static boolean isCancelRequested(String jobId) {
        JobProgress p = STORE.get(jobId);
        return p != null && p.cancelRequested;
    }

    /**
     * 진행 상태 조회.
     */
    public static JobProgress get(String jobId) {
        return STORE.get(jobId);
    }

    /**
     * 완료된 Job 명시적 삭제 (선택적 호출).
     */
    public static void remove(String jobId) {
        STORE.remove(jobId);
    }

    public static void scheduleRemove(String jobId, long delayMs) {
        if (jobId == null || jobId.trim().isEmpty()) {
            return;
        }
        CLEANUP_EXECUTOR.schedule(() -> STORE.remove(jobId), Math.max(delayMs, 0L), TimeUnit.MILLISECONDS);
    }

    // =====================================================================
    // TTL 자동 정리
    // =====================================================================
    private static void cleanup() {
        long now = System.currentTimeMillis();
        STORE.entrySet().removeIf(e -> {
            JobProgress p = e.getValue();
            long ttl = p.done ? FINISHED_JOB_TTL_MS : ACTIVE_JOB_TTL_MS;
            return (now - p.updatedAt) > ttl;
        });
    }
}
