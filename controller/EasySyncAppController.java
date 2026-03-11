package com.steg.lit.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.PrintWriter;

/**
 * Easy Sync Manager - HTML 앱 페이지 컨트롤러
 */
@Controller
@RequestMapping("/api/easy-sync/app")
public class EasySyncAppController {

    @RequestMapping(method = { RequestMethod.GET, RequestMethod.POST })
    public void handle(HttpServletRequest request, HttpServletResponse response) throws Exception {
        response.setContentType("text/html; charset=UTF-8");

        // Spring Security CSRF 토큰 추출 (Reflection으로 의존성 없이 처리)
        String csrfHeader = "X-CSRF-TOKEN";
        String csrfToken  = "";
        try {
            Object token = request.getAttribute("org.springframework.security.web.csrf.CsrfToken");
            if (token != null) {
                csrfHeader = (String) token.getClass().getMethod("getHeaderName").invoke(token);
                csrfToken  = (String) token.getClass().getMethod("getToken").invoke(token);
            }
        } catch (Throwable ignore) {}

        PrintWriter out = response.getWriter();
        out.println("<!DOCTYPE html>");
        out.println("<html lang=\"ko\">");
        out.println("<head>");
        out.println("    <meta charset=\"UTF-8\">");
        out.println("    <title>Easy Sync Manager</title>");
        out.println("    <meta name=\"_csrf\" content=\"" + escapeHtml(csrfToken) + "\"/>");
        out.println("    <meta name=\"_csrf_header\" content=\"" + escapeHtml(csrfHeader) + "\"/>");
        out.println("    <link rel=\"stylesheet\" href=\"/xif/jsp/cm/assets/easy-sync-style.css\">");
        out.println("    <style>");
        out.println("        body { margin: 0; display: flex; height: 100vh; }");
        out.println("        #root { width: 100%; height: 100%; }");
        out.println("        .container { display: flex; width: 100%; height: 100%; }");
        out.println("        .sidebar { width: 300px; border-right: 1px solid #ccc; }");
        out.println("        .main { flex: 1; padding: 20px; background: #f9f9f9; }");
        out.println("    </style>");
        out.println("</head>");
        out.println("<body>");
        out.println("<div id=\"root\"></div>");
        out.println("<script type=\"module\" src=\"/xif/jsp/cm/assets/easy-sync-app.js\"></script>");
        out.println("</body>");
        out.println("</html>");
        out.flush();
    }

    private String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
