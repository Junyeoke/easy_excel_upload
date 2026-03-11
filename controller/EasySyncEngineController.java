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
 * Easy Sync Manager - 동기화 엔진 & CRUD API
 *
 * [API]
 *   GET/POST /api/easy-sync/engine?mode=get_job_list
 *   GET/POST /api/easy-sync/engine?mode=get_job_detail&sync_id={id}
 *   POST     /api/easy-sync/engine?mode=save
 *   POST     /api/easy-sync/engine?mode=delete&sync_id={id}
 *   POST     /api/easy-sync/engine?mode=run_job&sync_id={id}
 */
@Controller
@RequestMapping("/api/easy-sync/engine")
public class EasySyncEngineController {

    private static final Logger log = LoggerFactory.getLogger(EasySyncEngineController.class);

    private final EasySyncService service;

    public EasySyncEngineController(EasySyncService service) {
        this.service = service;
    }

    // =========================================================================
    // 파라미터 유틸
    // =========================================================================

    private String param(HttpServletRequest request, String key) {
        String v = request.getParameter(key);
        return v != null ? EasySyncService.restore(v) : "";
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
        if (mode == null || mode.isEmpty()) mode = "";

        Map<String, Object> result = new LinkedHashMap<>();

        try {
            if ("get_job_list".equals(mode)) {
                List<Map<String, Object>> list = service.getJobList();
                out.print(EasySyncService.toJson(list));
                return;
            }

            if ("get_job_detail".equals(mode)) {
                String syncId = param(request, "sync_id");
                Map<String, Object> detail = service.getJobDetail(syncId);
                out.print(EasySyncService.toJson(detail));
                return;
            }

            if ("run_job".equals(mode)) {
                String syncId = param(request, "sync_id");
                Map<String, Object> runResult = service.processSync(syncId);
                out.print(EasySyncService.toJson(runResult));
                return;
            }

            if ("save".equals(mode)) {
                Map<String, String> fields = new LinkedHashMap<>();
                String[] keys = {
                    "sync_id", "job_name", "cron_exp", "use_yn",
                    "src_table", "tgt_table", "tgt_pk_col", "ent_id",
                    "cmp_table", "status_col", "val_new", "val_match", "val_diff",
                    "match_cmp_pk", "match_tgt_fk",
                    "load_map_json", "cmp_key_json", "cmp_map_json", "post_sql_json"
                };
                for (String key : keys) fields.put(key, param(request, key));
                String savedId = service.saveJob(fields);
                result.put("status", "ok");
                result.put("msg", "Successfully saved.");
                result.put("sync_id", savedId);
                out.print(EasySyncService.toJson(result));
                return;
            }

            if ("delete".equals(mode)) {
                String syncId = param(request, "sync_id");
                service.deleteJob(syncId);
                result.put("status", "ok");
                result.put("msg", "Successfully deleted.");
                out.print(EasySyncService.toJson(result));
                return;
            }

            result.put("status", "err");
            result.put("msg", "Unknown mode: " + mode);
            out.print(EasySyncService.toJson(result));

        } catch (Exception e) {
            log.error("[EasySyncEngine] 오류 발생 (mode={}): {}", mode, e.getMessage(), e);
            result.put("status", "err");
            result.put("msg", e.getMessage() != null ? e.getMessage() : e.toString());
            out.print(EasySyncService.toJson(result));
        } finally {
            out.flush();
        }
    }
}
