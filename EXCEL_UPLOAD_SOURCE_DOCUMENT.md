# Excel Upload Source Document

## 1. 문서 범위

이 문서는 `C:\apps\.tmp_easy_excel_upload_review` 소스 중 엑셀 업로드 기능과 직접 관련된 Java 백엔드, React 프론트엔드, SQL, 배포 스크립트의 역할을 설명한다.

주요 기능은 다음 흐름으로 구성된다.

1. 관리자가 업로드 로더 설정을 만든다.
2. 사용자가 엑셀 파일을 선택한다.
3. 서버가 엑셀 헤더와 데이터를 미리보기로 분석한다.
4. 업로드 전 검증을 수행한다.
5. 실제 업로드를 실행하고, 진행률을 SSE 또는 polling으로 보여준다.
6. 실패 행은 화면과 오류 리포트 엑셀 파일로 피드백한다.
7. 업로드 이력과 설정 변경 비교를 대시보드에서 확인한다.

## 2. 전체 구조

| 경로 | 의미 |
| --- | --- |
| `controller/` | `/api/excel/engine` 요청을 받아 `mode`별 기능으로 분기하는 Spring MVC 계층 |
| `service/` | Apache POI 기반 엑셀 파싱, 행 검증, DB insert/update, 오류 리포트 생성 등 핵심 업무 로직 |
| `repository/` | JDBC 기반 DB 접근 계층. 업로드 설정, 이력, 테이블/컬럼 메타데이터, 알림 설정을 처리 |
| `util/` | 업로드 진행률과 로그를 JVM 메모리에 저장하는 공통 유틸리티 |
| `react/excel/my-excel-app/` | 엑셀 업로드 관리/사용자/대시보드 React 화면 |
| `sql/` | 운영 DB에 필요한 보조 DDL |
| `scripts/` | React 빌드와 Java 컴파일 배포 스크립트 |
| `react/my-sync-app/`, `service/EasySyncService.java`, `repository/EasySyncRepository.java` | 엑셀 업로드가 아닌 Easy Sync 기능 |
| `out/`, `dist/`, `node_modules/` | 빌드 결과물 또는 의존성. 문서화 대상 원본 소스가 아님 |

## 3. 요청 엔드포인트 구조

엑셀 업로드 API의 중심 엔드포인트는 하나다.

```text
POST/GET /api/excel/engine?mode=...
GET      /api/excel/engine/stream?job_id=...
```

`ExcelUploadEngineController`가 모든 요청을 받고 `mode` 값에 따라 `ExcelUploadEngineModeDispatcher`가 세부 컨트롤러로 위임한다.

| mode | 담당 클래스 | 의미 |
| --- | --- | --- |
| `save` | `ExcelUploadConfigActionController` | 업로드 로더 설정 저장 또는 수정 |
| `get_list` | `ExcelUploadConfigActionController` | 저장된 로더 목록 조회 |
| `get_detail` | `ExcelUploadConfigActionController` | 특정 로더 상세 조회 |
| `delete` | `ExcelUploadConfigActionController` | 로더 삭제 |
| `clone` | `ExcelUploadConfigActionController` | 로더 복제 |
| `download_sample` | `ExcelUploadQueryActionController` | 저장된 샘플 엑셀 다운로드 |
| `get_tables` | `ExcelUploadQueryActionController` | DB 테이블 목록 조회 |
| `get_columns` | `ExcelUploadQueryActionController` | 선택 테이블 컬럼 목록 조회 |
| `preview` | `ExcelUploadQueryActionController` | 엑셀 파일 헤더/데이터 미리보기 |
| `validate` | `ExcelUploadValidateActionController` | 실제 저장 전 행 단위 사전 검증 |
| `upload` | `ExcelUploadUploadActionController` | 실제 업로드 실행 |
| `download_error` | `ExcelUploadQueryActionController` | 실패 행 오류 리포트 다운로드 |
| `progress` | `ExcelUploadProgressActionController` | 진행률 polling 조회 |
| `cancel` | `ExcelUploadProgressActionController` | 진행 중 업로드 취소 요청 |
| `get_history` | `ExcelUploadHistoryActionController` | 업로드 이력 목록 조회 |
| `get_history_detail` | `ExcelUploadHistoryActionController` | 업로드 이력 상세 조회 |
| `get_history_compare` | `ExcelUploadHistoryActionController` | 두 이력의 설정 스냅샷 비교 |
| `get_alert_config` | `ExcelUploadAlertActionController` | 알림 설정 조회 |
| `save_alert_config` | `ExcelUploadAlertActionController` | 알림 설정 저장 |
| `send_alert` | `ExcelUploadAlertActionController` | 업로드 실패율 기준 알림 webhook 전송 |

## 4. 백엔드 Controller

### `controller/ExcelUploadEngineController.java`

엑셀 업로드 API의 진입점이다.

- `/api/excel/engine` 요청을 받는다.
- multipart 요청이면 `ExcelUploadMultipartParser`로 파일과 파라미터를 분리한다.
- 일반 form 요청이면 request parameter를 Map으로 모은다.
- JNDI DataSource를 가져온다.
- `ExcelUploadEngineModeDispatcher`에 `mode`, 파라미터, 파일 바이트를 넘긴다.
- 응답이 파일 다운로드가 아닌 경우 JSON 응답을 쓴다.
- `/api/excel/engine/stream` 요청은 SSE 전용 컨트롤러로 위임한다.

### `controller/ExcelUploadEngineModeDispatcher.java`

`mode`별 분기 테이블 역할이다.

- 컨트롤러가 비대해지지 않도록 기능별 Action Controller에 위임한다.
- 파일 다운로드처럼 직접 response를 쓰는 기능은 `false`를 반환해서 공통 JSON 쓰기를 막는다.
- 알 수 없는 mode는 `{status:"err", msg:"Unknown mode: ..."}`를 반환한다.

### `controller/ExcelUploadMultipartParser.java`

multipart 요청을 다양한 WAS/라이브러리 환경에서 파싱하기 위한 호환 계층이다.

- 1차: Spring `MultipartRequest`
- 2차: Servlet 3 `getParts()`
- 3차: Apache Commons FileUpload
- 4차: raw multipart body 직접 파싱

추출 대상은 다음이다.

- `file`: 실제 업로드할 엑셀 파일
- `sample_file`: 관리자 설정에서 저장하는 샘플 파일
- 기타 form field: `mode`, `struct_json_b64`, `mapping_json_b64`, `header_row` 등

### `controller/ExcelUploadJsonResponseWriter.java`

간단한 Map/List/문자열/숫자/boolean 객체를 JSON 문자열로 직렬화한다.

외부 JSON 라이브러리에 의존하지 않고 legacy 환경에서도 응답을 만들기 위한 보조 컴포넌트다.

### `controller/ExcelUploadDataSourceProvider.java`

JNDI에서 eGene DataSource를 찾는다.

```text
java:comp/env/egene
```

즉, 이 소스는 단독 Spring Boot 앱이 아니라 기존 eGene WAS 런타임에 올라가는 전제다.

### `controller/ExcelUploadConfigActionController.java`

업로드 로더 설정을 저장/조회/삭제/복제한다.

주요 처리:

- 신규 저장 시 `org.sdf.util.UniqueKey`로 `upload_id` 생성
- 샘플 엑셀 파일을 서버 디렉터리에 저장
- 로더명, 헤더 행, 테이블 구조 JSON, 매핑 JSON, pre/post/row SQL, 안내문, 최대 업로드 건수 저장
- `upsert_keep_empty_yn`으로 UPSERT 시 빈 값을 기존 값으로 유지할지 결정
- `delete`, `clone` 기능 제공

로더 설정은 실제 업로드 시 어떤 테이블에 어떤 컬럼으로 데이터를 넣을지를 정의하는 핵심 메타데이터다.

### `controller/ExcelUploadQueryActionController.java`

조회성 기능과 파일 다운로드를 담당한다.

주요 기능:

- `download_sample`: 저장된 샘플 엑셀 파일 다운로드
- `get_tables`: DB 테이블 목록 조회
- `get_columns`: 선택 테이블 컬럼 목록과 컬럼 코멘트 조회
- `preview`: 업로드 파일을 Apache POI로 열어 헤더와 현재 페이지 데이터 반환
- `download_error`: 업로드 실패 행 오류 리포트 다운로드

`preview`는 실제 DB 저장을 하지 않고 엑셀의 첫 시트만 읽어 화면에 보여줄 데이터만 만든다.

### `controller/ExcelUploadValidateActionController.java`

실제 insert/update를 실행하지 않고, 행 단위로 매핑과 DB 제약 검증을 수행한다.

주요 처리:

- 엑셀 파일 필수 체크
- `struct_json`, `mapping_json` 파싱
- `header_row` 기준으로 데이터 행 계산
- `max_upload_rows` 초과 여부 확인
- 화면에서 수정한 셀 값(`edited_rows_b64`)을 Workbook에 반영
- 각 행을 `ExcelUploadEngineService.validateCascadeRow()`로 검증
- 실패 행별 메시지를 `failed_row_msgs`로 반환

### `controller/ExcelUploadUploadActionController.java`

실제 업로드 실행의 중심 컨트롤러다.

주요 처리 순서:

1. 요청 파라미터 디코딩
2. 구조 JSON, 매핑 JSON, pre/post/row SQL JSON 파싱
3. 엑셀 Workbook 생성
4. 화면에서 수정한 셀 값 반영
5. 데이터 행 수와 최대 업로드 건수 검증
6. `ProgressStore`에 job 초기화
7. DB 연결 및 transaction 시작
8. 이력 테이블/임시 키 테이블 보정
9. 행별 `cascadeExcelInsert()` 실행
10. 5,000행 단위 batch flush와 commit
11. 실패 행 수집
12. 오류 리포트 엑셀 생성
13. 업로드 이력 저장
14. post SQL 실행
15. 최종 결과 JSON 반환

결과 상태는 다음 중 하나다.

- `ok`: 전체 성공
- `partial`: 일부 행 실패
- `err`: 치명적 오류로 중단

### `controller/ExcelUploadProgressActionController.java`

진행률 polling과 취소 요청을 담당한다.

- `progress`: `job_id`로 `ProgressStore` 상태를 읽어 현재 처리 건수, 전체 건수, percent, 로그, 성공/실패 수를 반환
- `cancel`: 해당 job의 `cancelRequested` 플래그를 켠다

실제 업로드 루프는 주기적으로 `ProgressStore.isCancelRequested(jobId)`를 확인해 취소 요청을 감지한다.

### `controller/ExcelUploadProgressStreamController.java`

SSE(Server-Sent Events) 기반 실시간 진행률 스트림이다.

- `GET /api/excel/engine/stream?job_id=...`
- 500ms 간격으로 `ProgressStore`를 읽는다.
- `progress`, `done`, `error`, `waiting` 이벤트를 `data: ...` 형식으로 보낸다.
- `job_id`가 없으면 HTTP 400과 JSON 오류를 반환한다.

### `controller/ExcelUploadHistoryActionController.java`

업로드 이력 조회와 설정 스냅샷 비교를 담당한다.

- `get_history`: 업로드 ID, 기간, 결과 상태, 키워드로 이력 목록 조회
- `get_history_detail`: 특정 `hist_id` 상세 조회
- `get_history_compare`: 두 이력의 `struct_json`, `mapping_json`, `pre_sql_json`, `post_sql_json`, `row_sql_json`을 비교

비교 기능은 JSON을 flat path 형태로 펼친 뒤 added/removed/changed를 계산한다.

### `controller/ExcelUploadAlertActionController.java`

업로드 결과 알림 설정과 webhook 발송을 담당한다.

주요 기능:

- 알림 설정 조회/저장
- webhook URL AES-GCM 암호화 저장
- `EXCEL_ALERT_SECRET`, `EXCEL_ALERT_SIGN_SECRET`, `EXCEL_ALERT_ALLOWLIST` 환경변수 또는 시스템 프로퍼티 사용
- 중복 알림 방지를 위해 5분 dedup window 사용
- webhook 요청에 HMAC SHA-256 서명 헤더 추가
- 최대 3회 retry

### `controller/ExcelUploadUploadResultSupport.java`

업로드 결과 후처리 보조 클래스다.

- 설정 스냅샷 hash 생성을 위한 SHA-256 계산
- 실패 메시지를 유형별로 분류해 `fail_type_json` 생성
- session 기반 progress/log 잔여 데이터 정리

분류 예시는 `required_missing`, `duplicate`, `length_exceeded`, `number_format`, `date_format`, `reference`, `timeout`, `cancelled`, `other`다.

### `controller/ExcelUploadUploadDebugLogger.java`

업로드 실행 전 상세 디버그 로그를 만든다.

- alias별 테이블, PK/FK, upsert key 출력
- 컬럼 매핑 결과 출력
- 생성될 INSERT/UPDATE SQL과 파라미터 순서 출력
- row SQL token 치환 결과 출력
- child table 구조를 재귀적으로 추적

`debug_detail` 또는 `debug_upload_log` 옵션이 켜졌을 때 업로드 로그에 활용된다.

## 5. 백엔드 Service

### `service/ExcelUploadEngineService.java`

엑셀 업로드의 실제 업무 로직이 들어 있는 핵심 서비스다.

주요 책임은 다음이다.

| 메서드/영역 | 의미 |
| --- | --- |
| `getCellTypeStr`, `getCellValue` | Apache POI Cell 값을 문자열로 변환. 숫자, 날짜, 수식 등을 처리 |
| `createWorkbook`, `closeWorkbook` | 업로드된 byte array를 Workbook으로 열고 닫음 |
| `cascadeExcelInsert` | 한 엑셀 행을 기준으로 ROOT 테이블과 자식 테이블까지 재귀적으로 insert/update |
| `validateCascadeRow` | 실제 저장 없이 한 행의 매핑값과 DB 컬럼 제약을 검증 |
| `flushBatch` | PreparedStatement batch를 실행하고 실패 행을 수집 |
| `closeCache` | PreparedStatement/cache 자원 정리 |
| `makeInsertSql` | 동적 INSERT SQL 생성 |
| `makeUpdateSql` | upsert key 기준 동적 UPDATE SQL 생성 |
| `executeSqlArray` | pre/post SQL 목록 실행 |
| `replaceTokens` | row SQL 안의 `${TOKEN}`류 값을 행/테이블/PK 값으로 치환 |
| `extractErrorColumnName`, `extractAllErrorColumnNames` | DB 오류 메시지에서 원인 컬럼 추출 |
| `translateErrorForReport` | DB 오류를 사용자 친화적 메시지와 해결 방법으로 변환 |
| `buildErrorReport` | 실패 행만 모은 오류 리포트 xlsx 파일 생성 |
| `parseJson`, `LiteJsonParser` | JSON 파싱. Jackson이 있으면 사용하고 없으면 내장 파서 사용 |
| `decodeSafeBase64` | 프론트에서 base64로 보낸 JSON/문자열 디코딩 |
| `isValidSqlIdentifier` | 테이블명/컬럼명 SQL injection 방어용 식별자 검증 |
| `countDataRows`, `hasAnyCellValue` | 빈 행 제외 데이터 행 수 계산 |
| `getSampleFileDir` | 샘플/오류 리포트 파일 저장 디렉터리 결정 |

#### 컬럼 매핑 값 의미

관리자 화면에서 만든 매핑 JSON은 DB 컬럼별로 아래 값 중 하나를 가진다.

| 매핑 값 | 의미 |
| --- | --- |
| 숫자 문자열, 예: `"0"` | 엑셀 0번 컬럼 값을 사용 |
| `_AUTO_SEQ_` | 서버에서 신규 PK/sequence 값을 생성 |
| `_FIXED_:값` | 고정 문자열 값 사용 |
| `_REPLACE_:컬럼인덱스:원본==치환값||...` | 엑셀 값을 룰에 따라 변환 |
| `_UNIQUE_:컬럼인덱스` | 해당 엑셀 값을 unique/upsert 판단에 사용 |
| `_CURRENT_DTM_COMPACT_` | 현재 일시 `yyyyMMddHHmmss` |
| `_CURRENT_DATE_COMPACT_` | 현재 일자 `yyyyMMdd` |
| `_CURRENT_DATE_` | 현재 일자 `yyyy-MM-dd` |
| `_CURRENT_DATETIME_MIN_` | 현재 일시 `yyyy-MM-dd HH:mm` |
| `_CURRENT_DATETIME_SEC_` | 현재 일시 `yyyy-MM-dd HH:mm:ss` |
| `_LOGIN_USER_` | 현재 로그인 사용자 ID |
| `_LOGIN_MTN_` | 현재 로그인 사용자 MTN |

#### cascade insert 의미

`struct_json`은 업로드 대상 테이블 구조를 나타낸다.

예상 구조:

```json
[
  {
    "alias": "T0",
    "table": "대상테이블",
    "pk_col": "PK컬럼",
    "parent": "ROOT",
    "fk": "",
    "upsert_keys": ["업서트기준컬럼"]
  }
]
```

`cascadeExcelInsert()`는 `parent` 관계를 따라 ROOT부터 자식 테이블까지 같은 엑셀 행의 값을 여러 테이블에 저장한다. `upsert_keys`가 있으면 기존 데이터 존재 여부를 확인해 UPDATE 또는 INSERT를 선택한다.

## 6. 백엔드 Repository

### `repository/ExcelUploadEngineRepository.java`

DB 접근과 메타데이터 조회를 담당한다.

주요 책임은 다음이다.

| 메서드/영역 | 의미 |
| --- | --- |
| `FastSequenceManager` | sequence 값을 block 단위로 미리 가져와 대량 업로드 시 채번 비용 감소 |
| `saveConfig` | 로더 설정 insert/update |
| `getConfigDetail` | 로더 상세 조회 |
| `getSampleFileInfo` | 샘플 파일 저장 경로와 원본 파일명 조회 |
| `getConfigList` | 로더 목록 조회 |
| `ensureHistoryTable` | 업로드 이력 테이블 스키마 보정 |
| `ensureConfigSchema` | 설정 테이블에 필요한 신규 컬럼 보정 |
| `insertHistory` | 업로드 결과 이력 저장 |
| `getHistory` | 이력 목록 조회 |
| `getHistoryDetail` | 이력 상세 조회 |
| `getHistoryCompare` | 비교 대상 이력 원본 조회 |
| `ensureTempUploadKeysTable` | 업로드 중 생성 키 추적 임시 테이블 보정 |
| `insertTempUploadKey` | alias/table/pk 생성값 기록 |
| `getEntityIdByTableName` | eGene entity id 조회 |
| `getNumericColumnNames` | 숫자형 컬럼 목록 조회 |
| `getColumnConstraints` | NOT NULL, 길이, 타입 등 컬럼 제약 조회 |
| `getTables`, `getColumns` | DB 메타데이터 조회 |
| `deleteConfig`, `cloneConfig` | 로더 삭제/복제 |
| `ensureAlertConfigTable` | 알림 설정 테이블 보정 |
| `getAlertConfig`, `saveAlertConfig` | 알림 설정 조회/저장 |
| `detectNowFunction` | DB 종류에 따라 현재시간 함수 선택 |

이 클래스는 MySQL/MariaDB와 Oracle/Tibero 계열을 일부 분기 처리한다.

## 7. 공통 유틸리티

### `util/ProgressStore.java`

업로드 job 진행 상태를 서버 JVM 메모리에 저장한다.

저장 정보:

- `current`, `total`, `percent`
- 완료 여부
- 오류 메시지
- 취소 요청 여부
- `uploadId`, `histId`
- 성공/실패 건수
- 오류 리포트 파일명
- 실시간 로그

특징:

- `ConcurrentHashMap` 기반
- 진행 중 job TTL: 1시간
- 완료 job TTL: 10분
- SSE 스레드와 업로드 처리 스레드가 같은 저장소를 공유

## 8. SQL

### `sql/eso_excel_upload_history_upload_id.sql`

기존 업로드 이력 테이블에 `UPLOAD_ID` 컬럼을 추가하기 위한 DDL이다.

목적:

- 업로드 이력을 특정 로더 설정(`upload_id`)과 연결
- 대시보드에서 로더별 이력 필터링 가능

주석에는 `UPLOAD_ID` 인덱스 생성과 기존 이력 백필 예시도 포함되어 있다.

### `react/excel/my-excel-app/ddl.sql`

엑셀 업로드 설정 테이블의 초기 DDL이다.

대상 테이블:

```text
eso_excel_upload_config
```

주요 컬럼:

| 컬럼 | 의미 |
| --- | --- |
| `UPLOAD_ID` | 로더 설정 고유 ID, PK |
| `JOB_NAME` | 설정명/작업명 |
| `HEADER_ROW` | 엑셀 헤더 행 번호 |
| `STRUCT_JSON` | 다중 테이블 구조 JSON |
| `MAPPING_JSON` | 컬럼 매핑 JSON |
| `PRE_SQL_JSON` | 업로드 전 실행 SQL JSON |
| `POST_SQL_JSON` | 업로드 후 실행 SQL JSON |
| `ROW_SQL_JSON` | 행 단위 실행 SQL JSON |
| `SAMPLE_FILE_NAME` | 서버 저장 샘플 파일 경로 |
| `SAMPLE_FILE_ORG_NAME` | 다운로드 시 보여줄 샘플 파일명 |
| `REG_DTTM` | 등록 일시 |

현재 Java repository는 이후 추가된 컬럼도 runtime schema check로 보정한다. 예: `UPSERT_KEEP_EMPTY_YN`, `MAX_UPLOAD_ROWS`.

## 9. 배포 스크립트

### `scripts/deploy_excel_upload.sh`

기존 eGene webapp 경로로 프론트와 Java 클래스를 배포하는 스크립트다.

처리 순서:

1. `react/excel/my-excel-app`에서 `npm run build`
2. Vite 빌드 결과의 asset을 `xif/jsp/excel/assets`로 복사
3. `vite.svg` 복사
4. `controller`, `service`, `repository`, `util` Java 파일을 `WEB-INF/classes`로 컴파일

이 스크립트의 경로는 macOS/Linux 계열 운영 환경 기준으로 작성되어 있다.

## 10. React 프론트엔드

### `react/excel/my-excel-app/src/main.jsx`

URL query parameter에 따라 화면을 선택한다.

| URL | 화면 |
| --- | --- |
| `?view=dashboard` | `ExcelDashboard` |
| `?admin=true` | `ExcelApp` 관리자 모드 |
| `?admin=true&upload_id=...` | 기존 로더 수정 |
| `?upload_id=...` | 일반 사용자 업로드 화면 |
| 파라미터 없음 | 기본 `ExcelApp` |

### `react/excel/my-excel-app/src/ExcelApp.jsx`

엑셀 업로드 앱의 메인 컨테이너다.

주요 책임:

- 관리자/사용자 모드 판단
- 서버 API 호출 공통 함수 관리
- 로더 설정 상태 관리
- 엑셀 파일 선택 후 preview 요청
- validate 요청
- upload 요청
- SSE/EventSource 기반 진행률 수신
- polling fallback 및 localStorage 기반 detached upload 상태 관리
- 실패 행 이동, 실패 컬럼 강조, 화면 내 셀 수정 상태 관리
- 업로드 완료 후 결과 요약 화면 구성
- 알림 조건 충족 시 `send_alert` 호출

핵심 서버 호출:

- `mode=get_list`
- `mode=get_detail`
- `mode=save`
- `mode=preview`
- `mode=validate`
- `mode=upload`
- `mode=cancel`
- `mode=get_history`
- `mode=send_alert`

### `react/excel/my-excel-app/src/components/AdminWizardScreen.jsx`

관리자용 로더 생성/수정 마법사 UI다.

단계별 의미:

| 단계 | 의미 |
| --- | --- |
| `AdminStep0` | 기본 정보, 안내문, 샘플 파일, 제한 건수, 알림 설정 |
| `AdminStep1` | 업로드 대상 테이블 구조 설정. alias, table, PK, parent, FK, upsert key |
| `AdminStep2` | DB 컬럼과 엑셀 컬럼 매핑 설정. 고정값, 치환값, 시스템값도 여기서 선택 |
| `AdminStep3` | 저장된 설정으로 테스트 업로드, 미리보기, 검증, 실행 |

이 컴포넌트는 실제 비즈니스 로직을 직접 처리하기보다 `ExcelApp.jsx`에서 넘겨준 상태와 함수로 화면을 구성한다.

### `react/excel/my-excel-app/src/components/UserUploadScreen.jsx`

일반 사용자용 업로드 화면이다.

주요 기능:

- 안내문과 샘플 파일 다운로드 표시
- `.xls`, `.xlsx` 파일 drag/drop 또는 file input 선택
- 미리보기 테이블 표시
- 실패 행과 실패 컬럼 강조
- 셀 직접 수정
- 사전 검증 실행
- 업로드 실행
- 실패 행만 재업로드
- 실패 유형별 정책 재시도
- 진행률과 실시간 로그 표시
- 결과 화면에서 오류 리포트 다운로드 또는 수정 워크벤치 재진입

### `react/excel/my-excel-app/src/components/StepIndicator.jsx`

관리자/사용자 wizard 상단의 단계 표시 컴포넌트다.

- 현재 단계 표시
- 진행률 bar 계산
- 클릭 가능한 단계인지 판단해 이동 처리

### `react/excel/my-excel-app/src/ExcelDashboard.jsx`

엑셀 업로드 운영 대시보드다.

주요 기능:

- 로더 목록 조회
- 로더별 업로드 이력 조회
- 성공/실패 건수 및 실패율 통계
- 실패 유형 통계 시각화
- 업로드 이력 상세 확인
- 두 이력의 설정 스냅샷 비교
- 비교 결과 CSV export
- 로더 삭제/복제
- 진행 중이던 업로드가 다른 화면으로 분리된 경우 localStorage 상태를 읽고 floating progress 표시

서버 호출:

- `mode=get_list`
- `mode=get_history`
- `mode=get_history_compare`
- `mode=progress`
- `mode=delete`
- `mode=clone`

### `react/excel/my-excel-app/src/App.css`, `index.css`

엑셀 업로드 화면 전체 스타일이다.

- wizard layout
- 관리자 설정 화면
- 사용자 업로드 화면
- preview table
- 실패 행/셀 표시
- 진행률 UI
- 대시보드 UI

### `react/excel/my-excel-app/package.json`

React/Vite 프로젝트 설정이다.

주요 dependency:

- `react`, `react-dom`: 화면 렌더링
- `react-select`: select UI
- `sweetalert2`: 확인/알림 모달
- `react-toastify`: toast
- `recharts`: 대시보드 차트
- `@uiw/react-codemirror`, `@codemirror/lang-sql`: SQL 입력 편집기

### `react/excel/my-excel-app/vite.config.js`

Vite 빌드 설정이다.

- React plugin 사용
- 배포 base path는 `/xif/jsp/excel/`
- 빌드 파일명에 `20260620_ux2` 버전 문자열을 붙임
- output 파일명을 `easy-excel-*` 패턴으로 고정해 운영 배포 asset을 식별하기 쉽게 함

## 11. 엑셀 업로드 실행 흐름

```text
사용자 화면
  -> ExcelApp.handleUpload()
  -> FormData 생성
     - mode=upload
     - file
     - upload_id
     - job_id
     - struct_json_b64
     - mapping_json_b64
     - pre_sql_json_b64
     - post_sql_json_b64
     - row_sql_json_b64
     - edited_rows_b64
     - target_rows_b64
  -> POST /api/excel/engine
  -> ExcelUploadEngineController
  -> ExcelUploadMultipartParser
  -> ExcelUploadEngineModeDispatcher
  -> ExcelUploadUploadActionController
  -> ExcelUploadEngineService.cascadeExcelInsert()
  -> ExcelUploadEngineRepository.insertHistory()
  -> JSON 결과 반환
```

진행률은 별도 흐름으로 처리된다.

```text
ExcelApp
  -> EventSource /api/excel/engine/stream?job_id=...
  -> ExcelUploadProgressStreamController
  -> ProgressStore.get(job_id)
  -> progress/done/error 이벤트 수신
```

SSE가 끊기거나 화면이 이동된 경우에는 `mode=progress` polling과 localStorage 상태로 진행률을 보완한다.

## 12. 미리보기/검증/수정 흐름

```text
파일 선택
  -> mode=preview
  -> 서버가 헤더와 현재 페이지 데이터 반환
  -> 화면 preview table 표시

검증 버튼
  -> mode=validate
  -> 서버가 DB 저장 없이 행 단위 검증
  -> failed_row_msgs 반환
  -> 실패 행/컬럼 강조

사용자가 셀 수정
  -> editedCells 상태에 저장
  -> validate/upload 요청 때 edited_rows_b64로 서버 전송
  -> 서버가 Workbook에 수정값 반영 후 검증/업로드
```

## 13. 오류 처리 방식

업로드 중 행 단위 오류는 전체 작업을 즉시 중단하지 않고 수집한다.

- 실패 행: `failed_row_msgs`에 행 번호별 메시지 저장
- 오류 리포트: `buildErrorReport()`가 실패 행 중심 xlsx 생성
- 화면: 실패 행과 원인 컬럼을 빨간색으로 표시
- 이력: 성공/실패 건수와 실패 유형 요약 저장

치명적 오류는 transaction rollback 후 `err`로 반환한다.

## 14. 업로드 설정 데이터의 의미

| 설정 | 의미 |
| --- | --- |
| `upload_id` | 로더 식별자 |
| `job_name` | 로더 이름 |
| `header_row` | 엑셀 헤더가 있는 행 번호 |
| `struct_json` | 업로드 대상 테이블 구조 |
| `mapping_json` | alias별 DB 컬럼과 엑셀/고정/시스템 값 매핑 |
| `pre_sql_json` | 업로드 전 실행 SQL |
| `row_sql_json` | 각 행 처리 중 실행할 SQL |
| `post_sql_json` | 업로드 후 실행 SQL |
| `instructions` | 사용자 화면 안내문 |
| `sample_file_name` | 서버에 저장된 샘플 파일 경로 |
| `sample_file_org_name` | 사용자가 다운로드할 샘플 파일명 |
| `upsert_keep_empty_yn` | UPSERT 시 빈 값으로 기존 값을 덮어쓸지 여부 |
| `max_upload_rows` | 이 로더의 최대 업로드 허용 건수 |

## 15. 엑셀 업로드와 직접 관련이 낮은 파일

### Easy Sync Java

| 파일 | 의미 |
| --- | --- |
| `controller/EasySyncAppController.java` | Easy Sync 앱/API 진입점 |
| `controller/EasySyncEngineController.java` | Easy Sync 실행/저장 API |
| `controller/EasySyncUIController.java` | Easy Sync UI 보조 API |
| `service/EasySyncService.java` | 테이블 동기화 작업 저장/실행 로직 |
| `repository/EasySyncRepository.java` | Easy Sync DB 접근 로직 |

이 파일들은 엑셀 업로드가 아니라 DB 간 동기화 기능이다.

### React 샘플/별도 앱

| 경로 | 의미 |
| --- | --- |
| `react/my-app/` | Vite 기본 샘플 성격의 앱으로 보이며 엑셀 업로드 본 기능과 직접 관련 낮음 |
| `react/my-sync-app/` | Easy Sync 전용 React 앱 |

## 16. 운영 시 주의할 점

- Java 주석 일부는 문자 인코딩이 깨져 보인다. 실행 로직 자체는 확인 가능하지만 유지보수 시 UTF-8 원본 복원이 필요하다.
- SQL 식별자는 `isValidSqlIdentifier()`로 방어하지만, 동적 SQL을 많이 생성하므로 테이블/컬럼 입력은 반드시 관리자 권한 화면에서만 다뤄야 한다.
- `ProgressStore`는 JVM 메모리 기반이다. WAS가 여러 대이면 job 상태 공유가 되지 않는다.
- 업로드 transaction은 batch 단위 commit이 포함되어 있어 중간 실패 시 완전 all-or-nothing 구조가 아니다.
- `ExcelUploadAlertActionController`의 기본 secret 값은 운영 보안 기준으로 부적절하므로 환경변수나 시스템 프로퍼티로 반드시 바꿔야 한다.
- `scripts/deploy_excel_upload.sh`는 현재 하드코딩된 운영 경로가 있으므로 다른 서버에서는 경로 수정이 필요하다.
