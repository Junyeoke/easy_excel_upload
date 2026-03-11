CREATE TABLE `eso_excel_upload_config` (
  `UPLOAD_ID` varchar(50) NOT NULL COMMENT '업로드 설정 고유 ID',
  `JOB_NAME` varchar(100) NOT NULL COMMENT '설정명 (작업명)',
  `HEADER_ROW` int(11) DEFAULT 1 COMMENT '헤더 행 번호',
  `STRUCT_JSON` text DEFAULT NULL COMMENT '다중 테이블 구조 JSON',
  `MAPPING_JSON` text DEFAULT NULL COMMENT '컬럼 매핑 정보 JSON',
  `REG_DTTM` datetime DEFAULT current_timestamp() COMMENT '등록일시',
  `PRE_SQL_JSON` text DEFAULT NULL COMMENT '엑셀 업로드 전 실행 SQL JSON',
  `POST_SQL_JSON` text DEFAULT NULL COMMENT '엑셀 업로드 후 실행 SQL JSON',
  `SAMPLE_FILE_NAME` varchar(255) DEFAULT NULL,
  `SAMPLE_FILE_ORG_NAME` varchar(255) DEFAULT NULL,
  `ROW_SQL_JSON` longtext DEFAULT NULL,
  PRIMARY KEY (`UPLOAD_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;