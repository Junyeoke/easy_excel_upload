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

## What this branch improves

Compared with `main`, this branch focuses on low-risk maintenance improvements:

1. Reject SSE requests early when `job_id` is missing.
2. Return a consistent error payload for unsupported `mode` values.
3. Prevent repeated runtime DDL checks from running on every request path once schema verification has already completed in the JVM.
4. Ignore common local artifacts such as `.DS_Store`, `node_modules`, and `dist`.

## Notes

- The Java code assumes an existing eGene runtime, Spring MVC wiring, and JNDI datasource named `egene`.
- Frontend projects should be built separately and then copied into the deployed webapp path.
- This repository is best treated as a source snapshot for extension features, not as a standalone bootable app.
