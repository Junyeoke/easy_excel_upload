// ExcelUploadMultipartParser.java
package com.steg.lit.controller;

import com.steg.lit.service.ExcelUploadEngineService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Scanner;

/**
 * Parses multipart and raw upload requests for the legacy /api/excel/engine endpoint.
 */
@Component
public class ExcelUploadMultipartParser {

    private static final Logger log = LoggerFactory.getLogger(ExcelUploadMultipartParser.class);

    private final ExcelUploadEngineService service;

    public ExcelUploadMultipartParser(ExcelUploadEngineService service) {
        this.service = service;
    }
    public static class ParsedMultipart {

        Map<String, Object> params = new HashMap<>();
        byte[] fileBytes;
        byte[] sampleFileBytes;
        String sampleFileOrgName;
    }

    @SuppressWarnings("unchecked")
    public ParsedMultipart parse(HttpServletRequest request) throws Exception {
        ParsedMultipart out = new ParsedMultipart();
        boolean isParsed = false;

        // 시도 1: Spring MultipartRequest
        try {
            Class<?> multiReqClass = Class.forName("org.springframework.web.multipart.MultipartRequest");
            Object cur = request;
            Object multipartReqObj = null;
            for (int depth = 0; depth < 10; depth++) {
                if (multiReqClass.isInstance(cur)) {
                    multipartReqObj = cur;
                    break;
                }
                Object next = null;
                try {
                    next = cur.getClass().getMethod("getRequest").invoke(cur);
                } catch (Throwable ig) {
                }
                if (next == null) try {
                    next = cur.getClass().getMethod("getWrappedRequest").invoke(cur);
                } catch (Throwable ig) {
                }
                if (next == null || next == cur) {
                    break;
                }
                cur = next;
            }
            if (multipartReqObj != null && multiReqClass.isInstance(multipartReqObj)) {
                java.util.Map<?, ?> paramMap = (java.util.Map<?, ?>) multipartReqObj.getClass().getMethod("getParameterMap").invoke(multipartReqObj);
                for (Map.Entry<?, ?> e : paramMap.entrySet()) {
                    String k = String.valueOf(e.getKey());
                    Object v = e.getValue();
                    if (v instanceof String[]) {
                        if (((String[]) v).length > 0) {
                            out.params.put(k, ((String[]) v)[0]);
                    
                        }} else if (v != null) {
                        out.params.put(k, v.toString());
                    }
                }
                Class<?> fileClass = Class.forName("org.springframework.web.multipart.MultipartFile");
                Object fileObj = multiReqClass.getMethod("getFile", String.class).invoke(multipartReqObj, "file");
                if (fileObj != null) {
                    out.fileBytes = service.readStreamToBytes((InputStream) fileClass.getMethod("getInputStream").invoke(fileObj));
                }
                Object sampleFileObj = multiReqClass.getMethod("getFile", String.class).invoke(multipartReqObj, "sample_file");
                if (sampleFileObj != null) {
                    out.sampleFileBytes = service.readStreamToBytes((InputStream) fileClass.getMethod("getInputStream").invoke(sampleFileObj));
                    out.sampleFileOrgName = (String) fileClass.getMethod("getOriginalFilename").invoke(sampleFileObj);
                }
                isParsed = true;
                log.info("[Multipart] 시도 1 (Spring MultipartRequest) 파싱 성공");
            }
        } catch (Throwable ignore) {
            log.info("[Multipart] 시도 1 (Spring MultipartRequest) 실패: {} → 다음 파싱 방식으로 폴백", ignore.getMessage());
        }
        if (!isParsed) {
            try {
                java.util.Collection<?> parts = (java.util.Collection<?>) request.getClass().getMethod("getParts").invoke(request);
                for (Object p : parts) {
                    String pName = (String) p.getClass().getMethod("getName").invoke(p);
                    long pSize = (Long) p.getClass().getMethod("getSize").invoke(p);
                    if (pSize > 0) {
                        if ("file".equals(pName)) {
                            out.fileBytes = service.readStreamToBytes((InputStream) p.getClass().getMethod("getInputStream").invoke(p));
                        } else if ("sample_file".equals(pName)) {
                            out.sampleFileBytes = service.readStreamToBytes((InputStream) p.getClass().getMethod("getInputStream").invoke(p));
                            try {
                                out.sampleFileOrgName = (String) p.getClass().getMethod("getSubmittedFileName").invoke(p);
                            } catch (Throwable ex) {
                                out.sampleFileOrgName = "sample.xlsx";
                            }
                        } else {
                            Scanner sc = new Scanner((InputStream) p.getClass().getMethod("getInputStream").invoke(p), "UTF-8").useDelimiter("\\A");
                            out.params.put(pName, sc.hasNext() ? sc.next() : "");
                            sc.close();
                        }
                    }
                }
                // ✅ [JEUS Fix] 빈 컬렉션 반환 시에도 isParsed=true가 되던 버그 수정
                // 파일이 실제로 수신된 경우에만 파싱 성공으로 간주
                if (out.fileBytes != null && out.fileBytes.length > 0) {
                    isParsed = true;
                    log.info("[Multipart] 시도 2 (getParts) 파싱 성공");
                } else {
                    log.info("[Multipart] 시도 2 (getParts) 호출은 됐으나 파일 없음 → 다음 파싱 방식으로 폴백");
                }
            } catch (Throwable ignore) {
                log.info("[Multipart] 시도 2 (getParts) 실패: {} → 다음 파싱 방식으로 폴백", ignore.getMessage());
            }
        }

        // 시도 3: Apache Commons FileUpload
        if (!isParsed) {
            try {
                Class<?> sfuClass = Class.forName("org.apache.commons.fileupload.servlet.ServletFileUpload");
                Class<?> dfifClass = Class.forName("org.apache.commons.fileupload.disk.DiskFileItemFactory");
                Class<?> fiFactoryClass = Class.forName("org.apache.commons.fileupload.FileItemFactory");
                Object factory = dfifClass.getDeclaredConstructor().newInstance();
                Object upload = sfuClass.getConstructor(fiFactoryClass).newInstance(factory);
                sfuClass.getMethod("setHeaderEncoding", String.class).invoke(upload, "UTF-8");
                java.lang.reflect.Method parseMethod = null;
                for (java.lang.reflect.Method m : sfuClass.getMethods()) {
                    if (m.getName().equals("parseRequest") && m.getParameterTypes().length == 1) {
                        parseMethod = m;
                        break;
                    }
                }
                if (parseMethod != null) {
                    List<?> fileItems = (List<?>) parseMethod.invoke(upload, request);
                    for (Object item : fileItems) {
                        boolean isForm = (Boolean) item.getClass().getMethod("isFormField").invoke(item);
                        String fieldName = (String) item.getClass().getMethod("getFieldName").invoke(item);
                        if (isForm) {
                            out.params.put(fieldName, item.getClass().getMethod("getString", String.class).invoke(item, "UTF-8"));
                        } else {
                            long size = (Long) item.getClass().getMethod("getSize").invoke(item);
                            if (size > 0) {
                                InputStream is = (InputStream) item.getClass().getMethod("getInputStream").invoke(item);
                                if ("file".equals(fieldName)) {
                                    out.fileBytes = service.readStreamToBytes(is); 
                                }else if ("sample_file".equals(fieldName)) {
                                    out.sampleFileBytes = service.readStreamToBytes(is);
                                    String n = (String) item.getClass().getMethod("getName").invoke(item);
                                    out.sampleFileOrgName = (n != null && n.contains("\\")) ? n.substring(n.lastIndexOf("\\") + 1) : n;
                                }
                            }
                        }
                    }
                    isParsed = true;
                    log.info("[Multipart] 시도 3 (Commons FileUpload) 파싱 성공");
                }
            } catch (Throwable ignore) {
                log.info("[Multipart] 시도 3 (Commons FileUpload) 실패: {} → Raw 파싱으로 폴백", ignore.getMessage());
            }
        }
        if (!isParsed) {
            try {
                String ct = request.getContentType();
                String boundary = null;
                for (String seg : ct.split(";")) {
                    String s = seg.trim();
                    if (s.toLowerCase().startsWith("boundary=")) {
                        boundary = s.substring(9).trim();
                        if (boundary.startsWith("\"") && boundary.endsWith("\"")) {
                            boundary = boundary.substring(1, boundary.length() - 1);
                        }
                        break;
                    }
                }
                if (boundary != null) {
                    byte[] boundaryBytes = ("--" + boundary).getBytes("ISO-8859-1");
                    byte[] bodyBytes = service.readStreamToBytes(request.getInputStream());
                    int bLen = boundaryBytes.length;
                    List<int[]> partRanges = new ArrayList<>();
                    int partStart = -1;
                    for (int i = 0; i <= bodyBytes.length - bLen; i++) {
                        boolean match = true;
                        for (int j = 0; j < bLen; j++) {
                            if (bodyBytes[i + j] != boundaryBytes[j]) {
                                match = false;
                                break;
                            }
                        }
                        if (!match) {
                            continue;
                        }
                        if (partStart >= 0) {
                            partRanges.add(new int[]{partStart, i - 2});
                        }
                        if (i + bLen + 1 < bodyBytes.length && bodyBytes[i + bLen] == '-' && bodyBytes[i + bLen + 1] == '-') {
                            break;
                        }
                        partStart = i + bLen + 2;
                        i += bLen - 1;
                    }
                    for (int[] range : partRanges) {
                        if (range[1] <= range[0]) {
                            continue;
                        }
                        byte[] partBytes = new byte[range[1] - range[0]];
                        System.arraycopy(bodyBytes, range[0], partBytes, 0, partBytes.length);
                        int headerEnd = -1;
                        for (int i = 0; i < partBytes.length - 3; i++) {
                            if (partBytes[i] == 13 && partBytes[i + 1] == 10 && partBytes[i + 2] == 13 && partBytes[i + 3] == 10) {
                                headerEnd = i;
                                break;
                            }
                        }
                        if (headerEnd < 0) {
                            continue;
                        }
                        String headerStr = new String(partBytes, 0, headerEnd, "UTF-8");
                        byte[] bodyPart = new byte[partBytes.length - headerEnd - 4];
                        System.arraycopy(partBytes, headerEnd + 4, bodyPart, 0, bodyPart.length);
                        String fieldName = null, fileName = null;
                        for (String hLine : headerStr.split("\r\n")) {
                            if (hLine.toLowerCase().startsWith("content-disposition:")) {
                                for (String seg : hLine.split(";")) {
                                    String s = seg.trim();
                                    if (s.startsWith("name=")) {
                                        fieldName = s.substring(5).replace("\"", "").trim(); 
                                    }else if (s.startsWith("filename=")) {
                                        fileName = s.substring(9).replace("\"", "").trim();
                                    }
                                }
                            }
                        }
                        if (fieldName == null) {
                            continue;
                        }
                        if (fileName != null && bodyPart.length > 0) {
                            if ("file".equals(fieldName)) {
                                out.fileBytes = bodyPart; 
                            }else if ("sample_file".equals(fieldName)) {
                                out.sampleFileBytes = bodyPart;
                                out.sampleFileOrgName = fileName.contains("\\") ? fileName.substring(fileName.lastIndexOf("\\") + 1) : fileName;
                            }
                        } else {
                            out.params.put(fieldName, new String(bodyPart, "UTF-8"));
                        }
                    }
                }
                if (out.fileBytes != null && out.fileBytes.length > 0) {
                    log.info("[Multipart] 시도 4 (Raw) 파싱 성공");
                } else {
                    log.info("[Multipart] 시도 4 (Raw) 완료됐으나 파일 없음 - 파일 수신 실패 가능성 있음");
                }
            } catch (Throwable ignore) {
                log.info("[Multipart] 시도 4 (Raw) 실패: {}", ignore.getMessage());
            }
        }

        return out;
    }


}
