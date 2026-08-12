-- Excel Easy Loader 전체 초기 DDL - PostgreSQL
-- 2026-08-12 이준혁

CREATE TABLE eso_excel_upload_config (
    upload_id varchar(64) PRIMARY KEY,
    job_name varchar(128) NOT NULL,
    header_row integer DEFAULT 1 NOT NULL,
    struct_json text, mapping_json text, pre_sql_json text, post_sql_json text, row_sql_json text,
    sample_file_name varchar(256), sample_file_org_name varchar(256), instructions text,
    upsert_keep_empty_yn char(1) DEFAULT 'N' NOT NULL CHECK (upsert_keep_empty_yn IN ('Y','N')),
    rollback_on_fail_yn char(1) DEFAULT 'N' NOT NULL CHECK (rollback_on_fail_yn IN ('Y','N')),
    post_sql_rollback_on_fail_yn char(1) DEFAULT 'N' NOT NULL CHECK (post_sql_rollback_on_fail_yn IN ('Y','N')),
    max_upload_rows integer DEFAULT 0 NOT NULL,
    reg_emp_id varchar(64), reg_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX idx_excel_config_reg_dttm ON eso_excel_upload_config (reg_dttm);

CREATE TABLE eso_excel_upload_history (
    hist_id varchar(64) PRIMARY KEY,
    job_name varchar(128), file_name varchar(256),
    success_cnt integer DEFAULT 0 NOT NULL, fail_cnt integer DEFAULT 0 NOT NULL,
    attempt_success_cnt integer DEFAULT 0 NOT NULL, error_file varchar(256), upload_id varchar(64),
    config_snapshot_hash varchar(128), fail_type_json text, config_struct_json text,
    config_mapping_json text, config_pre_sql_json text, config_post_sql_json text, config_row_sql_json text,
    retry_mode varchar(32), retry_reason_types varchar(1000),
    rolled_back_yn char(1) DEFAULT 'N' NOT NULL CHECK (rolled_back_yn IN ('Y','N')),
    reg_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX idx_eso_excel_upload_history_upload_id ON eso_excel_upload_history (upload_id);
CREATE INDEX idx_excel_hist_reg_dttm ON eso_excel_upload_history (reg_dttm);

CREATE TABLE eso_excel_upload_change_hist (
    change_id varchar(64) PRIMARY KEY, hist_id varchar(64) NOT NULL, upload_id varchar(64), job_id varchar(64),
    table_name varchar(128) NOT NULL, key_json text, before_json text, after_json text,
    changed_columns_json text, excel_row_no integer, updated_emp_id varchar(64),
    updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX idx_excel_change_hist_id ON eso_excel_upload_change_hist (hist_id);
CREATE INDEX idx_excel_change_upload_id ON eso_excel_upload_change_hist (upload_id);

CREATE TABLE eso_excel_upload_pool_config (
    config_id varchar(32) PRIMARY KEY,
    worker_count integer NOT NULL CHECK (worker_count BETWEEN 1 AND 32),
    queue_capacity integer NOT NULL CHECK (queue_capacity BETWEEN 1 AND 100),
    updated_emp_id varchar(64), updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE eso_excel_alert_config (
    upload_id varchar(64) PRIMARY KEY, enabled char(1) DEFAULT 'N' NOT NULL CHECK (enabled IN ('Y','N')),
    webhook_url_enc text, fail_rate_threshold integer DEFAULT 0 NOT NULL,
    fail_count_threshold integer DEFAULT 0 NOT NULL, updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 연결마다 생성되는 세션 임시 테이블이다. 애플리케이션도 자동 생성을 시도한다.
CREATE TEMPORARY TABLE tmp_excel_upload_keys (
    alias varchar(64), table_name varchar(128), pk_col varchar(128), pk_val varchar(128)
) ON COMMIT PRESERVE ROWS;
