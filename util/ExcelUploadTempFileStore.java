package com.steg.lit.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.FileTime;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

/** Application-owned spool storage for queued Excel uploads. */
@Component
public class ExcelUploadTempFileStore implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadTempFileStore.class);
    private static final String FILE_PREFIX = "egene-excel-upload-";
    private static final long DEFAULT_MAX_AGE_HOURS = 24L;
    private static final long DEFAULT_CLEANUP_INTERVAL_MINUTES = 30L;

    private final Path rootDirectory;
    private final long maxAgeMillis;
    private final ScheduledExecutorService cleanupExecutor;
    private final Set<Path> activeFiles = ConcurrentHashMap.newKeySet();

    public ExcelUploadTempFileStore() {
        this.rootDirectory = resolveRootDirectory();
        this.maxAgeMillis = TimeUnit.HOURS.toMillis(positiveLongProperty(
                "excel.upload.temp.max.age.hours", DEFAULT_MAX_AGE_HOURS));
        long cleanupMinutes = positiveLongProperty(
                "excel.upload.temp.cleanup.interval.minutes", DEFAULT_CLEANUP_INTERVAL_MINUTES);
        try {
            Files.createDirectories(rootDirectory);
        } catch (Exception e) {
            throw new IllegalStateException("엑셀 업로드 임시 디렉터리를 생성할 수 없습니다: " + rootDirectory, e);
        }

        cleanupExpiredFiles();
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(runnable, "excel-upload-temp-cleaner");
            thread.setDaemon(true);
            return thread;
        };
        cleanupExecutor = Executors.newSingleThreadScheduledExecutor(factory);
        cleanupExecutor.scheduleWithFixedDelay(this::cleanupExpiredFiles,
                cleanupMinutes, cleanupMinutes, TimeUnit.MINUTES);
        log.info("[ExcelUpload] temp file store initialized - dir={}, maxAgeHours={}, cleanupMinutes={}",
                rootDirectory, TimeUnit.MILLISECONDS.toHours(maxAgeMillis), cleanupMinutes);
    }

    public Path store(InputStream input, String suffix) throws Exception {
        if (input == null) return null;
        Files.createDirectories(rootDirectory);
        Path tempFile = Files.createTempFile(rootDirectory, FILE_PREFIX, safeSuffix(suffix)).toAbsolutePath().normalize();
        activeFiles.add(tempFile);
        boolean stored = false;
        try (InputStream in = input) {
            long copied = Files.copy(in, tempFile, StandardCopyOption.REPLACE_EXISTING);
            if (copied <= 0L) return null;
            stored = true;
            return tempFile;
        } finally {
            if (!stored) delete(tempFile);
        }
    }

    public Path store(byte[] bytes, String suffix) throws Exception {
        if (bytes == null || bytes.length == 0) return null;
        return store(new ByteArrayInputStream(bytes), suffix);
    }

    public byte[] read(Path tempFile) throws Exception {
        if (!isOwnedPath(tempFile)) {
            throw new IllegalArgumentException("허용되지 않은 업로드 임시파일 경로입니다.");
        }
        return Files.readAllBytes(tempFile);
    }

    public boolean existsAndNotEmpty(Path tempFile) {
        if (!isOwnedPath(tempFile)) return false;
        try {
            return Files.isRegularFile(tempFile, LinkOption.NOFOLLOW_LINKS) && Files.size(tempFile) > 0L;
        } catch (Exception e) {
            return false;
        }
    }

    public void delete(Path tempFile) {
        if (!isOwnedPath(tempFile)) return;
        activeFiles.remove(tempFile.toAbsolutePath().normalize());
        try {
            Files.deleteIfExists(tempFile);
        } catch (Exception e) {
            log.warn("[ExcelUpload] temp file cleanup failed: {} ({})", tempFile, e.getMessage());
        }
    }

    public void cleanupExpiredFiles() {
        long cutoff = System.currentTimeMillis() - maxAgeMillis;
        int deleted = 0;
        try {
            Files.createDirectories(rootDirectory);
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(rootDirectory, FILE_PREFIX + "*")) {
                for (Path candidate : stream) {
                    Path normalized = candidate.toAbsolutePath().normalize();
                    if (activeFiles.contains(normalized)
                            || !Files.isRegularFile(normalized, LinkOption.NOFOLLOW_LINKS)) continue;
                    FileTime modified = Files.getLastModifiedTime(normalized, LinkOption.NOFOLLOW_LINKS);
                    if (modified.toMillis() < cutoff && Files.deleteIfExists(normalized)) deleted++;
                }
            }
        } catch (Exception e) {
            log.warn("[ExcelUpload] expired temp file cleanup failed: {}", e.getMessage());
        }
        if (deleted > 0) log.info("[ExcelUpload] expired temp files removed: {}", deleted);
    }

    public Path getRootDirectory() {
        return rootDirectory;
    }

    @Override
    public void destroy() {
        cleanupExecutor.shutdownNow();
    }

    private boolean isOwnedPath(Path path) {
        if (path == null) return false;
        Path normalized = path.toAbsolutePath().normalize();
        Path parent = normalized.getParent();
        return parent != null && parent.equals(rootDirectory)
                && normalized.getFileName().toString().startsWith(FILE_PREFIX);
    }

    private Path resolveRootDirectory() {
        String configured = System.getProperty("excel.upload.temp.dir");
        if (configured != null && !configured.trim().isEmpty()) {
            return Paths.get(configured.trim()).toAbsolutePath().normalize();
        }
        return Paths.get(System.getProperty("java.io.tmpdir"), "egene-excel-upload")
                .toAbsolutePath().normalize();
    }

    private String safeSuffix(String suffix) {
        if (suffix == null || !suffix.matches("^\\.[a-zA-Z0-9._-]{1,32}$")) return ".tmp";
        return suffix;
    }

    private long positiveLongProperty(String key, long defaultValue) {
        String raw = System.getProperty(key);
        if (raw == null || raw.trim().isEmpty()) return defaultValue;
        try {
            long parsed = Long.parseLong(raw.trim());
            return parsed > 0L ? parsed : defaultValue;
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
}
