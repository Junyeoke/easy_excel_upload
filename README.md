# easy_excel_upload

`easy_excel_upload` is a source repository for eGene-integrated Excel upload and sync features. It contains Java server-side classes and React frontend projects that are later deployed into an existing eGene runtime.

## Structure

- `controller/`
  Spring MVC controllers for Excel upload and Easy Sync APIs.
- `service/`
  Business logic for Excel parsing, upload processing, and sync execution.
- `repository/`
  JDBC-based data access and metadata helpers.
- `util/`
  Shared utilities such as in-memory progress tracking.
- `react/excel/my-excel-app/`
  React source for the Excel upload UI.
- `react/my-sync-app/`
  React source for the Easy Sync UI.

## Runtime deployment

This repository is not the final runtime location by itself. In your current environment, the generated artifacts are deployed to:

- Java classes:
  `/Users/leejunhyuk/apps/egene/webapps/itsm/WEB-INF/classes/com/steg/lit`
- Excel frontend:
  `/Users/leejunhyuk/apps/egene/webapps/itsm/xif/jsp/excel`

Recommended deployment helper:

- `scripts/deploy_excel_upload.sh`

The script rebuilds the Excel frontend, copies the Vite output into the exact runtime asset directory, and compiles the Java sources into the target `WEB-INF/classes` tree without creating an extra nested `assets/` directory.

## What this branch improves

Compared with `main`, this branch focuses on low-risk maintenance improvements:

1. Reject SSE requests early when `job_id` is missing.
2. Return a consistent error payload for unsupported `mode` values.
3. Prevent repeated runtime DDL checks from running on every request path once schema verification has already completed in the JVM.
4. Ignore common local artifacts such as `.DS_Store`, `node_modules`, and `dist`.

## Database notes

If `ESO_EXCEL_UPLOAD_HISTORY` does not yet have `UPLOAD_ID`, apply the SQL in:

- `sql/eso_excel_upload_history_upload_id.sql`

## Notes

- The Java code assumes an existing eGene runtime, Spring MVC wiring, and JNDI datasource named `egene`.
- Frontend projects should be built separately and then copied into the deployed webapp path.
- This repository is best treated as a source snapshot for extension features, not as a standalone bootable app.

## Upload concurrency limits

Excel uploads run on a dedicated fixed-size worker pool with a bounded queue, so long-running uploads do not occupy the web request thread pool. Defaults:

- Workers: `2`
- Waiting queue: `8`

Override them with JVM system properties when starting the application server:

```text
-Dexcel.upload.worker.count=2
-Dexcel.upload.queue.capacity=8
```

When both the workers and queue are full, the API returns HTTP `429` with `status: "busy"` and asks the user to retry later. Servlet async processing must be enabled for the Spring DispatcherServlet and every filter in the upload request chain.

Administrators (`egene.user.emp_admin_yn = "1"`) can also change these values from the dashboard's **업로드 처리 설정** dialog. The values are stored in `ESO_EXCEL_UPLOAD_POOL_CONFIG` and are applied immediately only when there are no running or queued uploads. JVM system properties take precedence and lock the corresponding dashboard field.
