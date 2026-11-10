package com.steg.lit.util;

import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Enumeration;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;

/** Server-side allow-list validation for uploaded Excel workbooks. */
@Component
public class ExcelUploadFileValidator {

    private static final int MAX_ZIP_ENTRIES = 10_000;
    private static final long MAX_DECLARED_UNCOMPRESSED_SIZE = 512L * 1024L * 1024L;

    public void validate(String originalFilename, byte[] bytes) throws Exception {
        String extension = validateFilename(originalFilename);
        if (bytes == null || bytes.length == 0) {
            throw rejected("빈 파일은 업로드할 수 없습니다.");
        }
        validateSignature(extension, bytes);
        if (".xlsx".equals(extension)) {
            validateXlsxEntries(bytes);
        }
        try (InputStream input = new ByteArrayInputStream(bytes)) {
            validatePoiWorkbook(extension, input);
        }
    }

    public void validate(String originalFilename, Path path) throws Exception {
        String extension = validateFilename(originalFilename);
        if (path == null || !Files.isRegularFile(path) || Files.size(path) <= 0L) {
            throw rejected("빈 파일은 업로드할 수 없습니다.");
        }
        byte[] header = new byte[8];
        try (InputStream input = Files.newInputStream(path)) {
            int offset = 0;
            while (offset < header.length) {
                int read = input.read(header, offset, header.length - offset);
                if (read < 0) break;
                offset += read;
            }
        }
        validateSignature(extension, header);
        if (".xlsx".equals(extension)) {
            validateXlsxEntries(path);
        }
        try (InputStream input = Files.newInputStream(path)) {
            validatePoiWorkbook(extension, input);
        }
    }

    private String validateFilename(String originalFilename) throws Exception {
        if (originalFilename == null || originalFilename.trim().isEmpty()
                || originalFilename.indexOf('\0') >= 0) {
            throw rejected("파일명을 확인할 수 없습니다.");
        }
        String normalized = originalFilename.replace('\\', '/');
        String baseName = normalized.substring(normalized.lastIndexOf('/') + 1).trim();
        String lower = baseName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".xlsx")) return ".xlsx";
        throw rejected("매크로가 없는 .xlsx 파일만 업로드할 수 있습니다.");
    }

    private void validateSignature(String extension, byte[] header) throws Exception {
        if (header.length < 4 || header[0] != 'P' || header[1] != 'K'
                || !((header[2] == 3 && header[3] == 4)
                || (header[2] == 5 && header[3] == 6)
                || (header[2] == 7 && header[3] == 8))) {
            throw rejected("확장자와 실제 Excel 파일 형식이 일치하지 않습니다.");
        }
    }

    private void validateXlsxEntries(Path path) throws Exception {
        try (ZipFile zip = new ZipFile(path.toFile())) {
            inspectEntries(zip.entries());
        } catch (ExcelUploadRejectedException e) {
            throw e;
        } catch (Exception e) {
            throw rejected("손상되었거나 올바르지 않은 .xlsx 파일입니다.");
        }
    }

    private void validateXlsxEntries(byte[] bytes) throws Exception {
        boolean contentTypes = false;
        boolean rootRels = false;
        boolean workbook = false;
        int entryCount = 0;
        long declaredSize = 0L;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entryCount++;
                if (entryCount > MAX_ZIP_ENTRIES) {
                    throw rejected("Excel 파일 내부 항목 수가 허용 범위를 초과했습니다.");
                }
                String name = normalizeEntryName(entry.getName());
                rejectUnsafeEntry(name);
                if (entry.getSize() > 0L) {
                    declaredSize += entry.getSize();
                    if (declaredSize > MAX_DECLARED_UNCOMPRESSED_SIZE) {
                        throw rejected("Excel 파일의 압축 해제 크기가 허용 범위를 초과했습니다.");
                    }
                }
                if ("[content_types].xml".equals(name)) contentTypes = true;
                else if ("_rels/.rels".equals(name)) rootRels = true;
                else if ("xl/workbook.xml".equals(name)) workbook = true;
                zip.closeEntry();
            }
        } catch (ExcelUploadRejectedException e) {
            throw e;
        } catch (Exception e) {
            throw rejected("손상되었거나 올바르지 않은 .xlsx 파일입니다.");
        }
        requireXlsxCoreEntries(contentTypes, rootRels, workbook);
    }

    private void inspectEntries(Enumeration<? extends ZipEntry> entries) throws Exception {
        boolean contentTypes = false;
        boolean rootRels = false;
        boolean workbook = false;
        int entryCount = 0;
        long declaredSize = 0L;
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            entryCount++;
            if (entryCount > MAX_ZIP_ENTRIES) {
                throw rejected("Excel 파일 내부 항목 수가 허용 범위를 초과했습니다.");
            }
            String name = normalizeEntryName(entry.getName());
            rejectUnsafeEntry(name);
            if (entry.getSize() > 0L) {
                declaredSize += entry.getSize();
                if (declaredSize > MAX_DECLARED_UNCOMPRESSED_SIZE) {
                    throw rejected("Excel 파일의 압축 해제 크기가 허용 범위를 초과했습니다.");
                }
            }
            if ("[content_types].xml".equals(name)) contentTypes = true;
            else if ("_rels/.rels".equals(name)) rootRels = true;
            else if ("xl/workbook.xml".equals(name)) workbook = true;
        }
        requireXlsxCoreEntries(contentTypes, rootRels, workbook);
    }

    private String normalizeEntryName(String name) {
        return name == null ? "" : name.replace('\\', '/').toLowerCase(Locale.ROOT);
    }

    private void rejectUnsafeEntry(String name) throws Exception {
        if (name.isEmpty() || name.startsWith("/") || name.contains("../")
                || name.equals("..") || name.contains(":/")) {
            throw rejected("Excel 파일 내부 경로가 안전하지 않습니다.");
        }
        if (name.equals("xl/vbaproject.bin") || name.startsWith("xl/embeddings/")) {
            throw rejected("매크로 또는 첨부 개체가 포함된 Excel 파일은 업로드할 수 없습니다.");
        }
    }

    private void requireXlsxCoreEntries(boolean contentTypes, boolean rootRels,
            boolean workbook) throws Exception {
        if (!contentTypes || !rootRels || !workbook) {
            throw rejected("Excel 통합문서 구조를 확인할 수 없습니다.");
        }
    }

    private void validatePoiWorkbook(String extension, InputStream input) throws Exception {
        try (Workbook workbook = WorkbookFactory.create(input)) {
            boolean matches = ".xlsx".equals(extension) && workbook instanceof XSSFWorkbook;
            if (!matches) {
                throw rejected("확장자와 실제 Excel 파일 형식이 일치하지 않습니다.");
            }
        } catch (ExcelUploadRejectedException e) {
            throw e;
        } catch (Throwable e) {
            throw rejected("손상되었거나 암호화된 Excel 파일은 업로드할 수 없습니다.");
        }
    }

    private ExcelUploadRejectedException rejected(String message) {
        return new ExcelUploadRejectedException(message);
    }

    public static class ExcelUploadRejectedException extends Exception {
        public ExcelUploadRejectedException(String message) {
            super(message);
        }
    }
}
