# Excel Easy Loader 멱등 DDL

2026-08-14 이준혁

동일 스크립트를 여러 번 실행할 수 있도록 만든 설치·업그레이드용 DDL입니다.
테이블이 없으면 전체 테이블을 만들고, 테이블이 이미 있으면 누락된 컬럼과 인덱스만 추가합니다.
기존 컬럼의 데이터 타입, 데이터, 제약조건은 변경하지 않습니다.

| DBMS | 실행 파일 |
| --- | --- |
| Oracle 11g+ | `excel_upload_ddl_oracle.sql` |
| PostgreSQL 9.6+ | `excel_upload_ddl_postgresql.sql` |
| MariaDB 10.2+ | `excel_upload_ddl_mariadb.sql` |
| MySQL 5.7 / 8.0+ | `excel_upload_ddl_mysql.sql` |
| Tibero 6+ | `excel_upload_ddl_tibero.sql` |

생성·보완 대상은 다음과 같습니다.

- `ESO_EXCEL_UPLOAD_CONFIG`: 로더 설정과 컬럼 매핑
- `ESO_EXCEL_UPLOAD_HISTORY`: 업로드 실행 결과
- `ESO_EXCEL_UPLOAD_CHANGE_HIST`: UPSERT UPDATE 전후 값
- `ESO_EXCEL_UPLOAD_POOL_CONFIG`: Worker와 Queue 설정
- `ESO_EXCEL_ALERT_CONFIG`: 실패 알림 설정
- `TMP_EXCEL_UPLOAD_KEYS`: 연결 단위 임시 키

주의 사항:

- 운영 적용 전 동일 DBMS·동일 스키마의 테스트 환경에서 먼저 실행하십시오.
- Oracle/Tibero는 현재 접속 사용자의 `USER_TABLES`, `USER_TAB_COLUMNS`, `USER_INDEXES`를 기준으로 판단합니다.
- PostgreSQL은 현재 `search_path`의 대상 스키마에서 실행하십시오.
- MySQL 스크립트는 구버전까지 지원하기 위해 임시 저장 프로시저 두 개를 생성한 후 제거하므로 `CREATE ROUTINE`, `ALTER`, `CREATE INDEX` 권한이 필요합니다.
- 기존 테이블에 누락된 컬럼을 추가할 때는 기존 데이터 때문에 실패하지 않도록 `NOT NULL`을 강제하지 않습니다. 필요한 데이터 보정 후 별도 제약조건을 적용하십시오.
- 엔터티별 `<테이블명>_HISTORY`는 eGene 솔루션 소유 테이블이므로 이 스크립트가 생성하지 않습니다. 해당 테이블이 없으면 엑셀 업로드가 엔터티 이력 저장만 건너뜁니다.
