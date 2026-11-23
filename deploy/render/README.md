# TeamFlow 공개 HTTPS 배포 준비

2026-11-23 기준. Render Free Web Service 하나에 React와 Nginx, Spring Boot를 배치하고, Neon Free PostgreSQL 18과 Brevo Free를 연결하는 포트폴리오 구성을 검토한다. 플랫폼 기본 HTTPS 주소를 사용한다. 낮은 트래픽과 콜드 스타트를 감수하는 조건으로 월 0원을 목표로 한다.

## 무료 옵션

| 구성 | 무료 한도와 제약 | 결제수단과 데이터 |
| --- | --- | --- |
| Render + Neon | Render 워크스페이스 월 750시간, 송신 5GB, 빌드 500분, RAM 512MB. 15분 무요청 후 절전, 재기동 약 1분. 외부 DB·메일·스토리지 트래픽이 과다하면 중단될 수 있다. Neon 프로젝트당 100 CU시간/월, 송신 5GB/월, DB 1GB. DB 연산은 5분 유휴 후 절전, 다음 쿼리에 자동 재개한다. | 둘 다 카드 없이 시작 가능. Neon Free에 고정 만료가 없으며, 월 연산·송신 한도를 넘으면 데이터는 유지되고 다음 달까지 연결이 막힌다. DB 1GB를 넘으면 용량을 늘리는 작업이 차단된다. 독립 백업 권장. [Render 무료](https://render.com/docs/free) · [Render 요금](https://render.com/pricing) · [Neon 요금](https://neon.com/pricing) |
| Render + Render Free PostgreSQL | DB 1GB, 워크스페이스당 1개, 백업 없음. | 카드 없이 시작 가능. 생성 30일 뒤 만료, 추가 14일 후 삭제. 이 프로젝트의 저장 요구에 부적합하다. [Render 무료](https://render.com/docs/free) |
| Render + Supabase Free | DB 500MB, 파일 1GB, 송신 5GB와 캐시 송신 5GB, 활성 프로젝트 2개. 저활동 7일 후 일시 정지되며 수동 복구가 필요하다. | 카드 없이 시작 가능. 정지 90일 후 같은 프로젝트의 복원 대신 백업·파일 다운로드 방식이다. [요금](https://supabase.com/pricing) · [카드 정책](https://supabase.com/blog/observability-for-every-supabase-project-with-grafana-cloud) · [정지 정책](https://supabase.com/docs/guides/platform/free-project-pausing) · [복구 기한](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days) |
| OCI Always Free VM | A1 Arm 총 2 OCPU, 12GB RAM, 부팅·블록 볼륨 합계 200GB, 볼륨 백업 5개. 홈 리전 용량 부족과 7일 저사용 VM 회수 가능성이 있다. | 대부분 카드 검증 필요. PostgreSQL과 첨부 볼륨을 직접 운영한다. 공개 HTTPS, OS 보안 업데이트, 복구를 직접 맡는다. [가입](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm) · [한도](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| Cloud Run + Neon | 요청 기반 월 200만 요청, 18만 vCPU초, 메모리 36만 GB초. 최소 인스턴스 0이면 콜드 스타트가 생긴다. 이미지 저장·네트워크도 과금 조건을 확인해야 한다. | Cloud Billing이 필요하며 신규 가입에는 유효한 결제수단이 필요하다. 초과 과금 가능. Neon에 데이터를 둔다. [Google 무료 한도](https://docs.cloud.google.com/free/docs/free-cloud-features) · [Cloud Run 요금](https://cloud.google.com/run/pricing) |

## 공개 전 로컬 준비

- Docker 빌드 컨텍스트는 저장소 루트, Dockerfile은 `deploy/render/Dockerfile`이다. 컨테이너의 `PORT`는 기본 10000, Spring은 루프백 8081에만 연결한다. `/healthz`는 Spring이 수신을 시작한 뒤 열린다. 배포 화면에서는 Free, 자동 배포 끔, `/healthz`를 선택할 예정이다. GitHub Desktop은 Git 작업에 사용한다.
- React와 `/api`를 같은 HTTPS 주소로 제공한다. 기존 `Secure`, `HttpOnly`, `SameSite=Lax`와 `X-TeamFlow-Request` 및 동일 출처 검사에 의한 CSRF 방어를 유지한다. CORS 허용을 추가하지 않는다. Render가 덮어쓰는 `CF-Connecting-IP`만 클라이언트 IP 입력으로 사용한다. 로컬 신뢰 경계는 루프백이고 실제 Render에서 위조 헤더가 통과하지 않는지도 확인한다. 앱 재시작 시 메모리 로그인 세션은 다시 로그인해야 한다. [Render 헤더 동작](https://render.com/articles/host-pocketbase-on-render)
- 신규 Neon DB는 아래의 **Neon PostgreSQL 18 초기화** 순서로 준비한다.
- `TEAMFLOW_PROD_DB_HOST`에는 직접 연결 DNS 이름, `TEAMFLOW_PROD_DB_NAME`에는 `neondb`, `TEAMFLOW_PROD_DB_USER`에는 `teamflow_public_app`을 사용한다. `TEAMFLOW_PROD_DB_PASSWORD`는 호스팅 환경의 비밀 설정에 저장한다. `prod`의 `verify-full`과 컨테이너 CA 묶음으로 인증서와 호스트를 검증한다. 포트 기본값은 5432다. Hibernate `validate`를 유지하고 런타임 역할이 DDL이나 관리자 승격을 실행할 수 없는지 점검한다. PostgreSQL과 첨부를 별도로 백업하고 실제 복구를 시험한다. [pgJDBC TLS](https://jdbc.postgresql.org/documentation/ssl/)
- 기존 가입은 메일 인증이 필수다. Brevo Free 300통/일과 SMTP `2525`의 STARTTLS를 검증한다. Render Free는 25·465·587을 막는다. `TEAMFLOW_SMTP_HOST`, `TEAMFLOW_SMTP_PORT`, `TEAMFLOW_SMTP_FROM`, `TEAMFLOW_SMTP_USERNAME`, `TEAMFLOW_SMTP_PASSWORD`, `TEAMFLOW_SIGNUP_HMAC_KEY`를 호스팅 비밀 설정에서 관리한다. 소유 도메인이 없으면 Brevo의 발신 주소 재작성 및 실제 수신을 검증한다. 2525가 막힐 경우 가입 인증을 유지하면서 HTTPS 메일 API를 별도 적용한다. [메일 한도](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans) · [SMTP 포트](https://help.brevo.com/hc/en-us/articles/10905415650322-Which-SMTP-port-should-I-use-Port-587-465-or-2525) · [발신 주소](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication)
- 첫 버전에서 첨부 파일 업로드를 비활성화한다. 앱의 상세 페이지에 저장되는 콘텐츠도 DB 용량을 사용한다. 첨부가 필요하면 Neon의 비공개 객체 저장소 5GB를 후보로 두고 권한, 업로드·다운로드·삭제, DB 백업과 파일 복구를 함께 구현·검증한다. [Neon 요금](https://neon.com/pricing)
- 마감 알림 배치가 실행 중 매분 DB에 접근한다. Hikari 유휴 연결 수를 줄여도 이 쿼리가 Neon 절전을 막을 수 있다. 이용량이 늘기 전에 배치를 요청 기반으로 바꾸거나 실행 간격을 조정하고, 알림 지연과 실제 CU 시간을 함께 확인한다.

## Neon PostgreSQL 18 초기화

1. Neon SQL Editor에서 프로젝트 `teamflow`, 브랜치 `production`, DB `neondb`를 선택한다. 아래 읽기 전용 조회에서 연결된 역할이 DB 소유자(보통 `neondb_owner`)이고, DB 이름이 `neondb`, 메이저 버전이 `18`이며 세 불리언 열이 모두 `true`일 때만 다음 단계로 간다. [Neon SQL Editor](https://neon.com/docs/get-started/query-with-neon-sql-editor)

   ```sql
   SELECT current_database() AS db, current_user AS connected_role,
          current_setting('server_version_num')::integer / 10000 AS pg_major,
          datdba = current_user::regrole AS is_owner,
          NOT EXISTS (
              SELECT FROM pg_catalog.pg_depend
              WHERE refclassid = 'pg_catalog.pg_namespace'::pg_catalog.regclass
                AND refobjid = 'public'::pg_catalog.regnamespace
                AND classid <> 'pg_catalog.pg_default_acl'::pg_catalog.regclass
          ) AS public_empty,
          to_regrole('teamflow_public_app') IS NULL AS app_role_missing
   FROM pg_database WHERE datname = current_database();
   ```

2. 같은 설정에서 `CREATE ROLE teamflow_public_app LOGIN NOINHERIT;`만 따로 실행한다. SQL로 만든 역할에는 Neon 관리 역할이 자동 부여되지 않는다. [Neon 역할 관리](https://neon.com/docs/manage/roles)
3. 저장소 루트에서 아래 명령으로 파일을 만든다. 파일 전체를 같은 SQL Editor에 붙여 넣고 한 번에 실행한다. 오류가 나면 원인을 확인하고 멈춘다. 초기화는 빈 스키마에서 한 번만 실행하며 앱 역할에 필요한 테이블·열 권한을 부여한다.

   ```powershell
   & .\deploy\render\New-BootstrapSql.ps1 -Neon | Set-Content -Encoding UTF8 (Join-Path $env:TEMP 'teamflow-neon-bootstrap.sql')
   ```

4. 아래 조회 결과는 `14`여야 한다. 배포 시 자격 증명이 필요하면 같은 브랜치의 **Roles**에서 기존 `teamflow_public_app`의 **Reset password**로 생성하고 비밀 설정에만 저장한다. [Neon 비밀번호 재설정](https://neon.com/docs/manage/roles#reset-a-password)

   ```sql
   SELECT count(*) AS teamflow_tables
   FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
   ```

옵션 없이 생성하면 기존 `psql`용 PostgreSQL 16 `teamflow_public` 초기화 SQL을 출력한다.

## 승인 뒤 확인할 항목

신규 테스트 DB에서 권한, TLS 불일치 거부, SMTP 인증코드 수신을 검증한다. 공개 승인 후 브라우저로 가입, 로그인·로그아웃, 쿠키와 교차 출처 차단, 일반 회원의 관리자 기능 차단을 확인한다. 앱 재시작 후 재로그인해 프로젝트를 조회하고, 첨부 비활성화 응답, 첫 요청 지연, SSE 재연결, 512MB 메모리 사용량을 점검한다. DB와 트래픽 한도 경고를 설정하고 백업 복구가 끝나면 실제 사용자에게 URL을 공유한다.
