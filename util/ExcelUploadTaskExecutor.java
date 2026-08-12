package com.steg.lit.util;

import com.steg.lit.repository.ExcelUploadEngineRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Dedicated, bounded executor for Excel uploads.
 *
 * JVM options:
 *   -Dexcel.upload.worker.count=2
 *   -Dexcel.upload.queue.capacity=8
 */
@Component
public class ExcelUploadTaskExecutor implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadTaskExecutor.class);
    private static final int DEFAULT_WORKER_COUNT = 2;
    private static final int DEFAULT_QUEUE_CAPACITY = 8;

    private final ExcelUploadEngineRepository repository;
    private final boolean workerJvmLocked;
    private final boolean queueJvmLocked;
    private final AtomicInteger threadNumber = new AtomicInteger(1);
    private volatile int workerCount;
    private volatile int queueCapacity;
    private volatile ThreadPoolExecutor executor;
    private volatile boolean persistentConfigLoaded;

    public ExcelUploadTaskExecutor(ExcelUploadEngineRepository repository) {
        this.repository = repository;
        this.workerJvmLocked = hasPositiveSystemProperty("excel.upload.worker.count");
        this.queueJvmLocked = hasPositiveSystemProperty("excel.upload.queue.capacity");
        this.workerCount = positiveSystemProperty("excel.upload.worker.count", DEFAULT_WORKER_COUNT);
        this.queueCapacity = positiveSystemProperty("excel.upload.queue.capacity", DEFAULT_QUEUE_CAPACITY);
        this.executor = createExecutor(workerCount, queueCapacity);

        log.info("[ExcelUpload] dedicated executor initialized - workers={}, queueCapacity={}",
                workerCount, queueCapacity);
    }

    /**
     * Enqueues an upload or throws immediately when all workers and queue slots are occupied.
     */
    public synchronized void execute(Runnable task) throws RejectedExecutionException {
        executor.execute(task);
    }

    public synchronized void ensureConfigured(DataSource dataSource) throws Exception {
        if (persistentConfigLoaded) {
            return;
        }
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            String nowFunc = repository.detectNowFunction(conn);
            repository.ensureUploadPoolConfigTable(conn, nowFunc);
            Map<String, Object> saved = repository.getUploadPoolConfig(conn);
            conn.commit();
            if (!saved.isEmpty()) {
                int savedWorkers = intValue(saved.get("worker_count"), DEFAULT_WORKER_COUNT);
                int savedQueue = intValue(saved.get("queue_capacity"), DEFAULT_QUEUE_CAPACITY);
                int effectiveWorkers = workerJvmLocked ? workerCount : savedWorkers;
                int effectiveQueue = queueJvmLocked ? queueCapacity : savedQueue;
                replaceExecutor(effectiveWorkers, effectiveQueue);
            }
            persistentConfigLoaded = true;
        }
    }

    public synchronized Map<String, Object> reconfigureAndPersist(DataSource dataSource,
            int requestedWorkers, int requestedQueueCapacity, String updatedEmpId) throws Exception {
        ensureConfigured(dataSource);
        if (requestedWorkers < 1 || requestedWorkers > 32) {
            throw new IllegalArgumentException("Worker 수는 1~32 범위로 입력해 주세요.");
        }
        if (requestedQueueCapacity < 1 || requestedQueueCapacity > 100) {
            throw new IllegalArgumentException("Queue 크기는 1~100 범위로 입력해 주세요.");
        }
        if (executor.getActiveCount() > 0 || !executor.getQueue().isEmpty()) {
            throw new IllegalStateException("현재 업로드 작업이 실행 또는 대기 중이므로 설정을 변경할 수 없습니다. 모든 작업이 완료된 후 다시 시도해 주세요.");
        }

        int effectiveWorkers = workerJvmLocked ? workerCount : requestedWorkers;
        int effectiveQueue = queueJvmLocked ? queueCapacity : requestedQueueCapacity;
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                String nowFunc = repository.detectNowFunction(conn);
                repository.ensureUploadPoolConfigTable(conn, nowFunc);
                repository.saveUploadPoolConfig(conn, requestedWorkers, requestedQueueCapacity,
                        updatedEmpId, nowFunc);
                conn.commit();
            } catch (Exception e) {
                try { conn.rollback(); } catch (Throwable ignore) {}
                throw e;
            }
        }
        replaceExecutor(effectiveWorkers, effectiveQueue);
        return snapshot();
    }

    public synchronized Map<String, Object> snapshot() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("worker_count", workerCount);
        out.put("queue_capacity", queueCapacity);
        out.put("active_workers", executor.getActiveCount());
        out.put("queue_size", executor.getQueue().size());
        out.put("max_capacity", workerCount + queueCapacity);
        out.put("worker_jvm_locked", workerJvmLocked);
        out.put("queue_jvm_locked", queueJvmLocked);
        out.put("worker_source", workerJvmLocked ? "JVM" : (persistentConfigLoaded ? "DB" : "DEFAULT"));
        out.put("queue_source", queueJvmLocked ? "JVM" : (persistentConfigLoaded ? "DB" : "DEFAULT"));
        return out;
    }

    public synchronized int getActiveCount() {
        return executor.getActiveCount();
    }

    public synchronized int getQueueSize() {
        return executor.getQueue().size();
    }

    public synchronized int getWorkerCount() {
        return workerCount;
    }

    public synchronized int getQueueCapacity() {
        return queueCapacity;
    }

    @Override
    public synchronized void destroy() {
        executor.shutdownNow();
    }

    private void replaceExecutor(int newWorkerCount, int newQueueCapacity) {
        if (newWorkerCount == workerCount && newQueueCapacity == queueCapacity) {
            return;
        }
        ThreadPoolExecutor previous = executor;
        ThreadPoolExecutor replacement = createExecutor(newWorkerCount, newQueueCapacity);
        executor = replacement;
        workerCount = newWorkerCount;
        queueCapacity = newQueueCapacity;
        previous.shutdown();
        log.info("[ExcelUpload] dedicated executor reconfigured - workers={}, queueCapacity={}",
                workerCount, queueCapacity);
    }

    private ThreadPoolExecutor createExecutor(int workers, int queueSize) {
        ThreadFactory threadFactory = runnable -> {
            Thread thread = new Thread(runnable, "excel-upload-worker-" + threadNumber.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        };
        ThreadPoolExecutor created = new ThreadPoolExecutor(
                workers,
                workers,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(queueSize),
                threadFactory,
                new ThreadPoolExecutor.AbortPolicy());
        created.prestartAllCoreThreads();
        return created;
    }

    private static boolean hasPositiveSystemProperty(String key) {
        String raw = System.getProperty(key);
        if (raw == null || raw.trim().isEmpty()) {
            return false;
        }
        try {
            return Integer.parseInt(raw.trim()) > 0;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private static int intValue(Object value, int defaultValue) {
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Throwable e) {
            return defaultValue;
        }
    }

    private static int positiveSystemProperty(String key, int defaultValue) {
        String raw = System.getProperty(key);
        if (raw == null || raw.trim().isEmpty()) {
            return defaultValue;
        }
        try {
            int parsed = Integer.parseInt(raw.trim());
            return parsed > 0 ? parsed : defaultValue;
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
}
