# Excel Easy Loader DB 초기 DDL

2026-08-12 이준혁

신규 환경에서 Excel Easy Loader를 사용하기 위한 전체 테이블 생성 스크립트입니다.

| DBMS | 실행 파일 |
| --- | --- |
| Oracle | `excel_upload_ddl_oracle.sql` |
| PostgreSQL | `excel_upload_ddl_postgresql.sql` |
| MariaDB | `excel_upload_ddl_mariadb.sql` |
| MySQL | `excel_upload_ddl_mysql.sql` |
| Tibero | `excel_upload_ddl_tibero.sql` |

스크립트는 다음 영구 테이블을 생성합니다.

- `ESO_EXCEL_UPLOAD_CONFIG`: 로더 및 컬럼 매핑 설정
- `ESO_EXCEL_UPLOAD_HISTORY`: 업로드 실행 결과와 설정 스냅샷
- `ESO_EXCEL_UPLOAD_CHANGE_HIST`: UPSERT UPDATE 변경 전·후 이력
- `ESO_EXCEL_UPLOAD_POOL_CONFIG`: Worker 및 Queue 관리자 설정
- `ESO_EXCEL_ALERT_CONFIG`: 로더별 실패 알림 설정

`TMP_EXCEL_UPLOAD_KEYS`는 연결 단위 임시 테이블입니다. Oracle/Tibero의 Global Temporary Table은 DBA가 미리 생성할 수 있습니다. PostgreSQL/MariaDB/MySQL은 연결마다 애플리케이션이 생성하므로 애플리케이션 계정에 임시 테이블 생성 권한이 필요합니다.

주의 사항:

- 신규 설치용 스크립트이므로 같은 테이블이 이미 있으면 실행 오류가 발생할 수 있습니다.
- 운영 적용 전 대상 스키마와 동일한 테스트 환경에서 먼저 실행하십시오.
- 애플리케이션 계정에는 위 영구 테이블의 `SELECT`, `INSERT`, `UPDATE`, `DELETE` 권한이 필요합니다.
- PostgreSQL/MariaDB/MySQL 애플리케이션 계정에는 세션 임시 테이블을 만들 수 있는 권한도 필요합니다.
- `ESO_EXCEL_UPLOAD_CHANGE_HIST`는 실행 이력 상세 화면에서 최대 2,000건까지 조회합니다. 데이터 보존 기간에 맞춰 별도 정리 정책을 권장합니다.
- 대상 업무 테이블과 eGene 기본 메타데이터/채번 테이블은 이 스크립트의 생성 범위에 포함되지 않습니다.
