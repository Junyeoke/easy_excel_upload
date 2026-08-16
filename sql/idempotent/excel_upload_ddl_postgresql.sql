-- Excel Easy Loader idempotent DDL - PostgreSQL 9.6+
-- 2026-08-14 이준혁
-- 현재 스키마(search_path의 첫 스키마)에 반복 실행할 수 있다.

CREATE TABLE IF NOT EXISTS eso_excel_upload_config (
    upload_id varchar(64) PRIMARY KEY, job_name varchar(128) NOT NULL,
    header_row integer DEFAULT 1 NOT NULL, struct_json text, mapping_json text,
    pre_sql_json text, post_sql_json text, row_sql_json text,
    sample_file_name varchar(256), sample_file_org_name varchar(256), instructions text,
    upsert_keep_empty_yn char(1) DEFAULT 'N' NOT NULL,
    rollback_on_fail_yn char(1) DEFAULT 'N' NOT NULL,
    post_sql_rollback_on_fail_yn char(1) DEFAULT 'N' NOT NULL,
    max_upload_rows integer DEFAULT 0 NOT NULL, reg_emp_id varchar(64),
    reg_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS upload_id varchar(64);
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS job_name varchar(128);
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS header_row integer DEFAULT 1;
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS struct_json text;
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS mapping_json text;
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS pre_sql_json text;
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS post_sql_json text;
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS row_sql_json text;
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS sample_file_name varchar(256);
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS sample_file_org_name varchar(256);
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS instructions text;
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS upsert_keep_empty_yn char(1) DEFAULT 'N';
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS rollback_on_fail_yn char(1) DEFAULT 'N';
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS post_sql_rollback_on_fail_yn char(1) DEFAULT 'N';
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS max_upload_rows integer DEFAULT 0;
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS reg_emp_id varchar(64);
ALTER TABLE eso_excel_upload_config ADD COLUMN IF NOT EXISTS reg_dttm timestamp DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_excel_config_reg_dttm ON eso_excel_upload_config (reg_dttm);

CREATE TABLE IF NOT EXISTS eso_excel_upload_history (
    hist_id varchar(64) PRIMARY KEY, job_name varchar(128), file_name varchar(256),
    success_cnt integer DEFAULT 0 NOT NULL, fail_cnt integer DEFAULT 0 NOT NULL,
    attempt_success_cnt integer DEFAULT 0 NOT NULL, error_file varchar(256), upload_id varchar(64),
    config_snapshot_hash varchar(128), fail_type_json text, config_struct_json text,
    config_mapping_json text, config_pre_sql_json text, config_post_sql_json text,
    config_row_sql_json text, retry_mode varchar(32), retry_reason_types varchar(1000),
    rolled_back_yn char(1) DEFAULT 'N' NOT NULL,
    reg_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS hist_id varchar(64);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS job_name varchar(128);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS file_name varchar(256);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS success_cnt integer DEFAULT 0;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS fail_cnt integer DEFAULT 0;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS attempt_success_cnt integer DEFAULT 0;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS error_file varchar(256);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS upload_id varchar(64);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS config_snapshot_hash varchar(128);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS fail_type_json text;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS config_struct_json text;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS config_mapping_json text;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS config_pre_sql_json text;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS config_post_sql_json text;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS config_row_sql_json text;
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS retry_mode varchar(32);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS retry_reason_types varchar(1000);
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS rolled_back_yn char(1) DEFAULT 'N';
ALTER TABLE eso_excel_upload_history ADD COLUMN IF NOT EXISTS reg_dttm timestamp DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_eso_excel_upload_history_upload_id ON eso_excel_upload_history (upload_id);
CREATE INDEX IF NOT EXISTS idx_excel_hist_reg_dttm ON eso_excel_upload_history (reg_dttm);

CREATE TABLE IF NOT EXISTS eso_excel_upload_change_hist (
    change_id varchar(64) PRIMARY KEY, hist_id varchar(64) NOT NULL, upload_id varchar(64),
    job_id varchar(64), table_name varchar(128) NOT NULL, key_json text, before_json text,
    after_json text, changed_columns_json text, excel_row_no integer, updated_emp_id varchar(64),
    updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS change_id varchar(64);
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS hist_id varchar(64);
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS upload_id varchar(64);
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS job_id varchar(64);
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS table_name varchar(128);
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS key_json text;
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS before_json text;
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS after_json text;
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS changed_columns_json text;
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS excel_row_no integer;
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS updated_emp_id varchar(64);
ALTER TABLE eso_excel_upload_change_hist ADD COLUMN IF NOT EXISTS updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_excel_change_hist_id ON eso_excel_upload_change_hist (hist_id);
CREATE INDEX IF NOT EXISTS idx_excel_change_upload_id ON eso_excel_upload_change_hist (upload_id);

CREATE TABLE IF NOT EXISTS eso_excel_upload_pool_config (
    config_id varchar(32) PRIMARY KEY, worker_count integer NOT NULL,
    queue_capacity integer NOT NULL, updated_emp_id varchar(64),
    updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE eso_excel_upload_pool_config ADD COLUMN IF NOT EXISTS config_id varchar(32);
ALTER TABLE eso_excel_upload_pool_config ADD COLUMN IF NOT EXISTS worker_count integer;
ALTER TABLE eso_excel_upload_pool_config ADD COLUMN IF NOT EXISTS queue_capacity integer;
ALTER TABLE eso_excel_upload_pool_config ADD COLUMN IF NOT EXISTS updated_emp_id varchar(64);
ALTER TABLE eso_excel_upload_pool_config ADD COLUMN IF NOT EXISTS updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS eso_excel_alert_config (
    upload_id varchar(64) PRIMARY KEY, enabled char(1) DEFAULT 'N' NOT NULL,
    webhook_url_enc text, fail_rate_threshold integer DEFAULT 0 NOT NULL,
    fail_count_threshold integer DEFAULT 0 NOT NULL,
    updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE eso_excel_alert_config ADD COLUMN IF NOT EXISTS upload_id varchar(64);
ALTER TABLE eso_excel_alert_config ADD COLUMN IF NOT EXISTS enabled char(1) DEFAULT 'N';
ALTER TABLE eso_excel_alert_config ADD COLUMN IF NOT EXISTS webhook_url_enc text;
ALTER TABLE eso_excel_alert_config ADD COLUMN IF NOT EXISTS fail_rate_threshold integer DEFAULT 0;
ALTER TABLE eso_excel_alert_config ADD COLUMN IF NOT EXISTS fail_count_threshold integer DEFAULT 0;
ALTER TABLE eso_excel_alert_config ADD COLUMN IF NOT EXISTS updated_dttm timestamp DEFAULT CURRENT_TIMESTAMP;

-- 애플리케이션이 연결 단위로 생성하지만, 수동 점검이 필요하면 같은 세션에서 실행한다.
CREATE TEMPORARY TABLE IF NOT EXISTS tmp_excel_upload_keys (
    alias varchar(64), table_name varchar(128), pk_col varchar(128), pk_val varchar(128)
) ON COMMIT PRESERVE ROWS;
