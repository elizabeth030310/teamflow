# Vercel Preview 인증 검증

## 계정 소유자가 연결할 항목

1. 사용할 Vercel 테스트 프로젝트에 접근 권한을 연결한다. 프로젝트 루트는 `deploy/vercel/functions`다. Preview에만 환경 변수를 설정한다. 운영 프로젝트의 도메인과 프록시는 그대로 둔다. [Vercel Preview 가이드](https://vercel.com/academy/build-and-launch-with-ai/deploy-a-preview)
2. Vercel 함수에서 TLS로 접근 가능한 별도의 PostgreSQL을 준비하고 기존 스키마 기준본을 합성 데이터로 구성한다. 최소한 `users`, 역할과 상태 제약, 이메일 부분 유니크 인덱스, `admin_member_audit`, `signup_verifications`, `signup_send_limits`가 필요하다. 기존 스키마의 189-A3, 192-A, 192-B, 198 적용 여부를 확인한 뒤 이 프로젝트의 `sql/001-auth.sql`을 적용한다.
3. 격리 DB의 전용 역할만 함수에 제공한다. 해당 역할은 앱 데이터 조회와 가입·비밀번호·계정 상태에 필요한 열 단위 쓰기, 가입 검증·세션·요청 제한 테이블의 필요한 읽기·쓰기, 감사 테이블의 조회·삽입 권한을 가진다. 역할 열 변경, 감사 변경·삭제, DDL은 제외한다. 관리자 테스트 계정은 격리 DB의 관리 역할로만 생성한다.
4. `TEAMFLOW_PREVIEW_DATABASE_URL`과 `TEAMFLOW_AUTH_ORIGINS`를 Vercel 대시보드에 입력한다. 접근 제한이 있는 고정 Preview 주소를 우선 사용한다. 생성 뒤 실제 브라우저 주소와 등록된 HTTPS 원본이 같은지 확인한다. 메일 검증을 진행할 경우 `TEAMFLOW_SIGNUP_HMAC_KEY`, `TEAMFLOW_BREVO_API_KEY`, `TEAMFLOW_BREVO_FROM`도 입력한다. 비밀 값은 채팅에 붙여 넣지 않는다.

## Preview 확인 순서

1. [Preview 배포](https://vercel.com/docs/cli/deploy)를 만들고 동일 호스트에서 `/api/ready`가 200, 익명 `/api/auth/me`가 401인지 확인한다. 프로젝트 설정에 Render로 향하는 rewrite가 없는지 확인하고 Vercel 함수 요청 로그에서 직접 호출을 확인한다.
2. Preview 루트의 인증 점검 화면에서 합성 회원으로 로그인한다. `/api/auth/login` 200, `/api/auth/me` 200을 확인한다. 브라우저 저장소에서 쿠키 속성만 확인한다. 값은 기록하지 않는다.
3. 페이지를 새로고침해 로그인 상태가 유지되고 로그아웃 뒤 쿠키가 사라지는지 본다. 한 번 더 새로고침해 `/api/auth/me`가 401인지 확인한다.
4. 승인된 테스트 수신함에서만 Brevo 메일을 받아 코드 입력, 만료, 재전송을 확인한다. 별도의 관리자 합성 계정으로 일반 회원 접근 거부와 상태 변경 후 세션 무효화를 확인한다.
