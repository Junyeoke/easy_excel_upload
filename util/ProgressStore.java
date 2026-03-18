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
 *   - 완료 후 1시간 자동 TTL 정리
 *   - SSE 스트리밍 스레드가 직접 읽어 push 가능
 *
 * ✅ [Fix v1] 버그 수정 및 성능 개선
 *   1. TTL 기준을 createdAt → updatedAt으로 변경
 *      - 대용량 파일 업로드 중 다른 업로드가 init()을 호출하면
 *        진행 중인 Job이 삭제되어 SSE 진행률이 0%로 리셋되는 버그 수정
 *
 *   2. cleanup()을 ScheduledExecutorService로 주기 실행으로 변경
 *      - init() 호출마다 STORE 전체를 스캔하던 방식 제거
 *      - 백그라운드 스레드가 5분마다 한 번만 정리
 *
 *   3. 로그 리스트 최대 크기 제한 (MAX_LOGS = 2000)
 *      - 오류 행이 많은 파일 업로드 시 무제한 로그 누적 방지
 *
 * ✅ [Fix v2] 다중 사용자 환경 대응
 *   4. 동시 Job 수 상한 제한 (MAX_JOBS = 500)
 *      - 다수 사용자가 동시에 업로드할 때 STORE가 무제한으로 커지는 문제 방지
 *      - 상한 초과 시 updatedAt이 가장 오래된 완료 Job부터 제거 후 등록
 *      - 완료 Job만 제거해도 상한을 넘으면 예외를 던져 업로드를 거부
 *
 *   5. 스케줄러 shutdown 훅 등록 (ShutdownHook)
 *      - WAS 재배포 시 static 블록에서 생성된 스케줄러 스레드가
 *        구 클래스로더에서 계속 실행되는 스레드 누수 방지
 *      - Runtime.addShutdownHook으로 JVM 종료 / 재배포 시 정상 shutdown
 * =====================================================================
 */
public class ProgressStore {

    // ── 상수 ──────────────────────────────────────────────────────────
    /** 로그 최대 보관 건수. 초과 시 오래된 절반을 제거합니다. */
    private static final int MAX_LOGS = 2_000;

    /**
     * 동시에 STORE에 보관할 수 있는 Job 최대 수.
     * 500명이 동시에 업로드하는 경우는 극히 드물며,
     * 초과 시 완료된 Job부터 정리하여 슬롯을 확보합니다.
     */
    private static final int MAX_JOBS = 500;

    // ── 내부 상태 클래스 ──────────────────────────────────────────────
    public static class JobProgress {
        public volatile int     current   = 0;
        public volatile int     total     = 0;
        public volatile boolean done      = false;   // 정상 완료 또는 오류로 종료
        public volatile String  errorMsg  = null;    // null이면 정상
        public final List<String> logs    = Collections.synchronizedList(new ArrayList<>());
        public final long createdAt       = System.currentTimeMillis();
        public volatile long updatedAt    = System.currentTimeMillis();
    }

    // ── 저장소 (jobId → JobProgress) ─────────────────────────────────
    private static final ConcurrentHashMap<String, JobProgress> STORE = new ConcurrentHashMap<>();

    // =====================================================================
    // ✅ [Fix v1] 백그라운드 정리 스케줄러 (5분마다 실행)
    // ✅ [Fix v2] ShutdownHook으로 재배포 시 스레드 누수 방지
    // =====================================================================
    private static final ScheduledExecutorService SCHEDULER;

    static {
        SCHEDULER = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "ProgressStore-Cleanup");
            t.setDaemon(true);
            return t;
        });
        SCHEDULER.scheduleAtFixedRate(ProgressStore::cleanup, 5, 5, TimeUnit.MINUTES);

        // ✅ [Fix v2] JVM 종료 또는 WAS 재배포 시 스케줄러를 정상 종료합니다.
        // static 블록에서 생성한 스케줄러는 shutdown 훅 없이는
        // 재배포 후에도 구 클래스로더에서 계속 실행되어 스레드가 누수됩니다.
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            SCHEDULER.shutdown();
            try {
                if (!SCHEDULER.awaitTermination(5, TimeUnit.SECONDS)) {
                    SCHEDULER.shutdownNow();
                }
            } catch (InterruptedException ie) {
                SCHEDULER.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }, "ProgressStore-Shutdown"));
    }

    // =====================================================================
    // Public API
    // =====================================================================

    /**
     * 새 Job 등록. upload 시작 시 호출.
     *
     * ✅ [Fix v2] MAX_JOBS 초과 시 완료된 Job 중 가장 오래된 것부터 제거합니다.
     * 완료 Job만 제거해도 상한을 넘으면 서버 과부하 방지를 위해 예외를 던집니다.
     *
     * @param jobId  프론트에서 생성한 JOB_ + timestamp 식별자
     * @param total  전체 처리 예정 행 수
     * @throws IllegalStateException 동시 업로드 수가 MAX_JOBS를 초과한 경우
     */
    public static void init(String jobId, int total) {
        // ✅ [Fix v2] 상한 초과 시 완료된 Job부터 정리하여 슬롯 확보
        if (STORE.size() >= MAX_JOBS) {
            evictOldestDoneJobs();
        }
        // 완료 Job 정리 후에도 여전히 상한을 초과하면 업로드 거부
        if (STORE.size() >= MAX_JOBS) {
            throw new IllegalStateException(
                "현재 동시 업로드 수가 상한(" + MAX_JOBS + "건)을 초과했습니다. 잠시 후 다시 시도하세요.");
        }
        JobProgress p = new JobProgress();
        p.total = total;
        STORE.put(jobId, p);
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
     *
     * ✅ [Fix v1] MAX_LOGS(2000) 초과 시 오래된 로그를 제거하고 안내 메시지를 삽입합니다.
     */
    public static void addLog(String jobId, String msg) {
        JobProgress p = STORE.get(jobId);
        if (p != null) {
            synchronized (p.logs) {
                if (p.logs.size() >= MAX_LOGS) {
                    // 앞쪽 절반을 제거하여 최신 로그를 유지
                    int removeCount = MAX_LOGS / 2;
                    p.logs.subList(0, removeCount).clear();
                    p.logs.add(0, "... (이전 로그 " + removeCount + "건 생략됨)");
                }
                p.logs.add(msg);
            }
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
            p.updatedAt = System.currentTimeMillis();
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
            p.updatedAt = System.currentTimeMillis();
        }
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

    // =====================================================================
    // 내부 정리 메서드
    // =====================================================================

    /**
     * ✅ [Fix v1] TTL 자동 정리 — updatedAt 기준 1시간 초과 항목 제거.
     * 5분마다 스케줄러가 호출합니다.
     */
    private static void cleanup() {
        long now = System.currentTimeMillis();
        STORE.entrySet().removeIf(e -> (now - e.getValue().updatedAt) > 3_600_000L);
    }

    /**
     * ✅ [Fix v2] 완료된 Job 중 updatedAt이 가장 오래된 순서로 제거합니다.
     * MAX_JOBS 초과 시 init()에서 호출됩니다.
     * 진행 중인 Job은 건드리지 않습니다.
     */
    private static void evictOldestDoneJobs() {
        STORE.entrySet().stream()
            .filter(e -> e.getValue().done)                        // 완료된 Job만 대상
            .sorted(Comparator.comparingLong(e -> e.getValue().updatedAt)) // 오래된 순
            .limit(MAX_JOBS / 10)                                  // 최대 10%(50개)씩 제거
            .forEach(e -> STORE.remove(e.getKey()));
    }
}