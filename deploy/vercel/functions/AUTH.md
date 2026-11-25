# Vercel 인증 API

인증 경로는 `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/signup/code`, `POST /api/auth/signup`, `POST /api/auth/change-password`다. 관리자 경로는 `/api/admin/users`, `/api/admin/users/stats`, `/api/admin/audit`, `/api/admin/audit/page`, `/api/admin/users/{id}/status`다. 경로와 성공 응답은 기존 프런트엔드 형식을 유지한다.

## 격리 환경 설정

- `TEAMFLOW_PREVIEW_DATABASE_URL`에 TLS로 접근하는 격리 PostgreSQL 접속 정보를 제공한다. URL은 쿼리 옵션 없이 구성한다. Production에서는 별도 활성화와 별도 운영 접속 설정이 모두 있어야 연결한다.
- `TEAMFLOW_AUTH_ORIGINS`에 Preview의 정확한 HTTPS 원본을 쉼표로 구분해 지정한다. 쓰기 요청은 같은 호스트에서 `X-TeamFlow-Request: 1`을 요구한다. 브라우저가 보낸 `Origin`과 `Sec-Fetch-Site`의 값도 검사한다.
- Spring의 기본 JVM locale에 따라 저장된 구형 이메일이 있다면 `TEAMFLOW_LEGACY_LOGIN_LOCALE`에 확인된 BCP 47 언어 태그를 설정한다. 일반 로그인은 기존처럼 대소문자를 구분하지 않는다.
- `sql/001-auth.sql`은 기존 `public.users`가 있는 격리 DB에 관리 역할로 한 번 적용한다. 런타임 역할에는 사용자 인증 열의 읽기 권한, 세션의 조회·삽입·갱신·삭제, 로그인 카운터의 조회·삽입·갱신·삭제, 윈도우의 조회·갱신만 필요하다.
- 가입은 Spring의 `signup_verifications`, `signup_send_limits`, 탈퇴 회원을 제외한 이메일 부분 유니크 인덱스를 재사용한다. 검증번호는 5분 유효하며 발급 간격은 60초다. 실패 5회 또는 성공 시 코드를 폐기한다. 같은 HMAC 포맷을 사용한다.
- `TEAMFLOW_SIGNUP_HMAC_KEY`, `TEAMFLOW_BREVO_API_KEY`, `TEAMFLOW_BREVO_FROM`은 Preview 환경 설정에 입력한다. 개발·테스트는 별도의 HMAC 키와 허용된 테스트 발신자를 사용한다. Brevo 전송 코드는 기존 API와 같은 형식으로 요청하고 메일 작업을 `waitUntil`로 마무리한다. SMTP 모드는 이 함수에 포함하지 않는다. [Brevo 전송 API](https://developers.brevo.com/reference/sendtransacemail)
- 비밀번호 변경과 관리자 상태 변경은 DB 행을 잠근 뒤 요청 세션을 다시 확인한다. 상태 변경은 감사 기록과 함께 커밋하며 같은 요청 재시도에는 기존 성공 상태를 반환한다. 비밀번호나 계정 상태가 바뀌면 기존 세션의 revision이 달라져 사용이 중단된다.

## 세션과 요청 제한

브라우저는 `__Host-teamflow-session` 쿠키로 토큰을 전달한다. DB에는 SHA-256 토큰 해시만 저장한다. 쿠키는 호스트 전용이고 `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`를 사용한다. 로그인하면 새 토큰으로 회전하고 이전 토큰을 폐기한다. `me`는 만료와 활성 상태 및 `access_revision`을 확인한 뒤 유휴 만료를 30분 연장한다. 로그아웃은 DB 세션과 쿠키를 제거한다. 성공한 로그인에서 만료 행을 최대 64개 정리한다. 운영 전에는 로그인 트래픽이 없는 기간의 정리 방식도 검토한다.

분당 주소 20회, 계정 30회, 전체 300회의 Spring 한도를 PostgreSQL에서 공유한다. Vercel에서는 플랫폼이 제공하는 IP를 사용한다. 로컬이나 IP를 확인할 수 없는 요청은 하나의 주소 한도를 공유한다. [Vercel 요청 헤더](https://vercel.com/docs/headers/request-headers)

## 검증 방법

1. `deploy/vercel/functions`에서 Node.js 24로 `npm ci`, `npm run check`, `npm test`를 실행한다.
2. Docker와 Java 21을 사용할 수 있는 환경에서 `backend`의 `test-isolated.ps1`을 실행한다. 이 스크립트가 생성한 임시 PostgreSQL에서 Spring이 합성 계정과 BCrypt 해시를 만들고 Node가 실제 DB를 사용해 응답을 비교한다. 비교 도구는 이름과 포트가 일치하는 루프백 테스트 DB만 허용한다.
3. 로컬 Edge 브라우저까지 검증하려면 `TEAMFLOW_TEST_BROWSER=1`을 설정하고 `test-isolated.ps1 -MavenArgs @('-Dtest=VercelAuthContractTest')`를 실행한다. 다른 Chromium 실행 경로나 OpenSSL 경로는 `TEAMFLOW_BROWSER_EXECUTABLE`과 `TEAMFLOW_OPENSSL`로 지정할 수 있다. 브라우저 테스트는 임시 HTTPS 서버에서만 테스트 인증서를 허용한다.
4. [Vercel Preview 연결 및 점검 절차](PREVIEW.md)에 따라 실제 라우팅, 브라우저 쿠키 동작, 플랫폼 IP 헤더, 격리 DB 역할 권한을 확인한다. 기존 Spring 세션은 전환 시 다시 로그인해야 한다.

프런트엔드의 Render 프록시는 기존 설정을 사용한다. 프로젝트·작업·문서 등 나머지 보호 API의 이전은 후속 범위다. 운영 DB 변경, 운영 배포, Render 삭제는 각각 별도 승인 사항이다.
