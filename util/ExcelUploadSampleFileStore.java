package com.steg.lit.util;

import org.springframework.stereotype.Component;

import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Locale;

/** Stores and resolves sample workbooks inside one server-controlled directory. */
@Component
public class ExcelUploadSampleFileStore {

    private static final String DEFAULT_ROOT = "/app/egene/attach/loader";
    private static final long DEFAULT_MAX_BYTES = 20L * 1024L * 1024L;

    private final Path rootDirectory;
    private final long maxFileBytes;

    public ExcelUploadSampleFileStore() {
        String configuredRoot = System.getProperty("excel.upload.sample.dir", DEFAULT_ROOT);
        this.rootDirectory = Paths.get(configuredRoot).toAbsolutePath().normalize();
        this.maxFileBytes = positiveLongProperty(
                "excel.upload.sample.max.bytes", DEFAULT_MAX_BYTES);
    }

    public StoredSample store(String uploadId, String requestedDownloadName,
            byte[] bytes) throws Exception {
        String safeUploadId = validateUploadId(uploadId);
        String safeDownloadName = sanitizeDownloadName(requestedDownloadName);
        validateSize(bytes == null ? 0L : bytes.length);
        ensureSafeRoot();

        String storedName = safeUploadId + "_sample.xlsx";
        Path target = resolveDirectChild(storedName);
        if (Files.isSymbolicLink(target)) {
            throw new SecurityException("심볼릭 링크 대상에는 샘플 파일을 저장할 수 없습니다.");
        }

        Path temp = Files.createTempFile(rootDirectory, ".sample-upload-", ".xlsx");
        boolean moved = false;
        try {
            try (OutputStream output = Files.newOutputStream(temp,
                    StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING,
                    LinkOption.NOFOLLOW_LINKS)) {
                output.write(bytes);
            }
            try {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
            }
            moved = true;
            return new StoredSample(storedName, safeDownloadName);
        } finally {
            if (!moved) Files.deleteIfExists(temp);
        }
    }

    public Path resolveForRead(String storedReference) throws Exception {
        Path resolved = resolveStoredReference(storedReference);
        if (Files.isSymbolicLink(resolved)
                || !Files.isRegularFile(resolved, LinkOption.NOFOLLOW_LINKS)) {
            throw new SecurityException("허용된 샘플 파일을 찾을 수 없습니다.");
        }
        validateSize(Files.size(resolved));
        return resolved;
    }

    /** Converts legacy absolute paths under the allowed root to a relative DB value. */
    public String normalizeStoredReference(String storedReference) throws Exception {
        if (storedReference == null || storedReference.trim().isEmpty()) return null;
        return resolveStoredReference(storedReference).getFileName().toString();
    }

    public String sanitizeDownloadName(String name) throws Exception {
        if (name == null || name.trim().isEmpty()) return "sample.xlsx";
        String value = name.trim();
        if (value.length() > 200 || value.indexOf('\0') >= 0
                || value.contains("/") || value.contains("\\")
                || value.contains("\r") || value.contains("\n")) {
            throw new SecurityException("다운로드 파일명이 올바르지 않습니다.");
        }
        for (int i = 0; i < value.length(); i++) {
            if (Character.isISOControl(value.charAt(i))) {
                throw new SecurityException("다운로드 파일명이 올바르지 않습니다.");
            }
        }
        if (!value.toLowerCase(Locale.ROOT).endsWith(".xlsx")) {
            throw new SecurityException("다운로드 파일명은 .xlsx 확장자만 사용할 수 있습니다.");
        }
        return value;
    }

    public long getMaxFileBytes() {
        return maxFileBytes;
    }

    private Path resolveStoredReference(String storedReference) throws Exception {
        if (storedReference == null || storedReference.trim().isEmpty()) {
            throw new SecurityException("샘플 파일 경로가 없습니다.");
        }
        ensureSafeRoot();
        Path supplied = Paths.get(storedReference.trim());
        Path resolved = supplied.isAbsolute()
                ? supplied.toAbsolutePath().normalize()
                : rootDirectory.resolve(supplied).normalize();
        if (!resolved.startsWith(rootDirectory)
                || resolved.getParent() == null
                || !resolved.getParent().equals(rootDirectory)
                || !resolved.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".xlsx")) {
            throw new SecurityException("허용된 샘플 파일 디렉터리 밖의 경로입니다.");
        }
        return resolved;
    }

    private Path resolveDirectChild(String fileName) throws Exception {
        Path target = rootDirectory.resolve(fileName).normalize();
        if (!target.startsWith(rootDirectory) || !rootDirectory.equals(target.getParent())) {
            throw new SecurityException("허용된 샘플 파일 디렉터리 밖의 경로입니다.");
        }
        return target;
    }

    private void ensureSafeRoot() throws Exception {
        Files.createDirectories(rootDirectory);
        if (Files.isSymbolicLink(rootDirectory)
                || !Files.isDirectory(rootDirectory, LinkOption.NOFOLLOW_LINKS)) {
            throw new SecurityException("샘플 파일 저장 디렉터리가 안전하지 않습니다.");
        }
    }

    private String validateUploadId(String uploadId) throws Exception {
        String value = uploadId == null ? "" : uploadId.trim();
        if (!value.matches("^[A-Za-z0-9_-]{1,128}$")) {
            throw new SecurityException("upload_id 형식이 올바르지 않습니다.");
        }
        return value;
    }

    private void validateSize(long size) throws Exception {
        if (size <= 0L) throw new SecurityException("빈 샘플 파일은 저장할 수 없습니다.");
        if (size > maxFileBytes) {
            throw new SecurityException("샘플 파일은 최대 "
                    + (maxFileBytes / 1024L / 1024L) + "MB까지 업로드할 수 있습니다.");
        }
    }

    private long positiveLongProperty(String key, long fallback) {
        try {
            long value = Long.parseLong(System.getProperty(key, String.valueOf(fallback)));
            return value > 0L ? value : fallback;
        } catch (Exception e) {
            return fallback;
        }
    }

    public static final class StoredSample {
        private final String storedName;
        private final String downloadName;

        StoredSample(String storedName, String downloadName) {
            this.storedName = storedName;
            this.downloadName = downloadName;
        }

        public String getStoredName() { return storedName; }
        public String getDownloadName() { return downloadName; }
    }
}
