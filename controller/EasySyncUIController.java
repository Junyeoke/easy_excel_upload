package com.steg.lit.controller;

import com.steg.lit.service.EasySyncService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.PrintWriter;
import java.util.*;

/**
 * Easy Sync Manager - 테이블/컬럼 메타 조회 API
 *
 * [API]
 *   GET/POST /api/easy-sync/ui?mode=get_tables
 *   GET/POST /api/easy-sync/ui?mode=get_columns&table_name={테이블명 또는 SELECT 쿼리}
 */
@Controller
@RequestMapping("/api/easy-sync/ui")
public class EasySyncUIController {

    private static final Logger log = LoggerFactory.getLogger(EasySyncUIController.class);

    private final EasySyncService service;

    public EasySyncUIController(EasySyncService service) {
        this.service = service;
    }

    // =========================================================================
    // 메인 핸들러
    // =========================================================================

    @RequestMapping(method = { RequestMethod.GET, RequestMethod.POST })
    public void handle(HttpServletRequest request, HttpServletResponse response) throws Exception {
        response.setContentType("application/json; charset=UTF-8");
        request.setCharacterEncoding("UTF-8");
        PrintWriter out = response.getWriter();

        String mode = request.getParameter("mode");
        if (mode == null) mode = "";

        try {
            if ("get_tables".equals(mode)) {
                List<Map<String, String>> list = service.getTables();
                out.print(EasySyncService.toJson(list));
                return;
            }

            if ("get_columns".equals(mode)) {
                String rawInput = EasySyncService.restore(request.getParameter("table_name"));
                if (rawInput == null || rawInput.trim().isEmpty()) {
                    out.print("[]");
                    return;
                }
                String input = rawInput.trim();
                boolean isQuery = input.toUpperCase().startsWith("SELECT");
                if (!isQuery && !isValidSqlIdentifier(input)) {
                    Map<String, String> err = new LinkedHashMap<>();
                    err.put("status", "err");
                    err.put("msg", "Invalid table name format.");
                    out.print(EasySyncService.toJson(err));
                    return;
                }
                List<Map<String, String>> list = service.getColumns(input);
                out.print(EasySyncService.toJson(list));
                return;
            }

            Map<String, String> err = new LinkedHashMap<>();
            err.put("status", "err");
            err.put("msg", "Unknown mode: " + mode);
            out.print(EasySyncService.toJson(err));

        } catch (Exception e) {
            log.error("[EasySyncUI] 오류 발생: {}", e.getMessage(), e);
            Map<String, String> err = new LinkedHashMap<>();
            err.put("status", "err");
            err.put("msg", e.getMessage() != null ? e.getMessage() : e.toString());
            out.print(EasySyncService.toJson(err));
        } finally {
            out.flush();
        }
    }

    private static boolean isValidSqlIdentifier(String identifier) {
        if (identifier == null || identifier.trim().isEmpty()) return false;
        return identifier.matches("^[a-zA-Z0-9_.]+$");
    }
}
