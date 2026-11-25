# TeamFlow Vercel 백엔드 이전 계획

## 작업 기준

이 폴더는 `deploy/vercel`의 `d38abb4`를 내보낸 로컬 스냅숏이다. 기존 저장소의 초대·알림 작업은 원본 체크아웃에 있으며 이 스냅숏에는 포함하지 않았다. 통합 전에 해당 diff와 신규 파일을 검토해 API 동등성 기준에 포함한다. 이 작업의 추가 파일은 이 문서와 `functions/`에 있다. 운영 프런트엔드의 `frontend/vercel.json`은 기존 Render 프록시를 사용한다.

## 현행 구조와 이전 설계

| 영역 | 현행 및 이전 기준 |
| --- | --- |
| 라우팅 | Vite SPA와 Spring Boot를 Render의 Nginx가 제공하고 Vercel의 `/api/*`가 Render로 rewrite된다. 최종적으로 같은 Vercel 호스트에서 SPA와 Node.js TypeScript API를 제공한다. 고정 URL의 Preview에서 정적 asset, SPA 직접 진입, API 404와 JSON 응답을 분리 검증한다. |
| API | Spring 컨트롤러를 기준으로 메서드, URL, 요청 헤더·본문, 응답 상태·JSON·정렬·페이지 매김을 계약 테스트로 고정한다. 인증·회원 관리, 프로젝트·멤버·초대, 카드·댓글·체크리스트·활동, 문서, 알림·첨부 순으로 옮긴다. 소유자·수락 멤버·대기 초대·외부 사용자·관리자를 구분한다. 읽기·쓰기 SQL 자체에서 접근 범위를 제한하고 동시 초대, 수락, 알림 생성은 트랜잭션으로 검증한다. |
| 인증 | Spring BCrypt 해시를 그대로 유지하고 Spring에서 만든 테스트 해시로 Node 비교기를 양방향 검증한다. 현재 72바이트 검증과 비교 비용, 더미 비교, 로그인 제한과 가입 코드 제한을 유지한다. 가입 검증 코드의 저장 형식과 만료·사용 규칙, Brevo 메일 계약도 비교한다. |
| 세션 | Spring HTTP 세션은 프로세스 메모리에 있다. Node에서는 PostgreSQL에 무작위 불투명 세션 토큰의 해시와 사용자 ID, `access_revision`, 만료 시간을 저장하는 방안을 채택한다. 쿠키는 호스트 전용·`Secure`·`HttpOnly`·`SameSite=Lax`와 30분 유휴 만료를 유지한다. 로그인 시 회전하고 로그아웃·비밀번호 변경·상태 변경 후 서버에서 폐기 또는 무효화한다. 보호 요청마다 활성 상태와 revision을 확인한다. 변경 요청은 기존 `X-TeamFlow-Request: 1`, 허용 Origin과 Fetch Metadata 규칙을 이식한다. 전환 시 기존 Java 세션은 종료되며 사용자는 한 번 다시 로그인한다. |
| PostgreSQL | Render 배포 문서는 외부 Neon PostgreSQL 18의 `neondb`를 가리킨다. 앱 설정은 호스트를 환경 변수에서 받아 Render PostgreSQL에 고정되지 않는다. 운영의 실제 호스트와 DB 소유 주체는 Render 환경 설정에서 확인이 필요하다. 승인된 운영 담당자가 호스트 접미사와 프로젝트 소유권만 확인하고 비밀번호·접속 문자열은 공유하지 않는다. Neon으로 확인되면 기존 DB와 사용자 데이터를 유지할 수 있다. Render 전용 DB라면 승인을 받아 백업·복원 경로를 별도 검증한다. |
| 스키마·ORM | 기존 SQL을 기준으로 삼고 초기 버전은 `pg`로 구현한다. 관리자 단일 제한·이메일 재사용용 부분 인덱스, CHECK, 문서·댓글·알림 제약, 앱 역할의 열 단위 권한, 트리거·시퀀스·트랜잭션을 복구 DB에서 대조한다. Prisma는 CHECK 등 DB 제약을 Prisma 모델만으로 표현할 수 없으므로 초기 도입을 보류한다. 재검토는 격리 복제본에서 introspection과 SQL 차이 검토부터 진행한다. [Prisma introspection](https://docs.prisma.io/docs/orm/prisma-schema/introspection) |
| 서버리스 연결 | TLS 검증을 강제한다. 앱은 Neon pooled 주소를 쓰고 직접 연결은 승인된 백업·마이그레이션에 사용한다. 함수 인스턴스별 최대 4개, 유휴 5초에서 시작해 부하 테스트로 조정한다. 연결·쿼리 대기를 제한하고 Vercel의 풀 수명 주기 기능을 사용한다. 요청 전체 트랜잭션은 같은 client에서 처리한다. 트랜잭션 풀에 세션 단위 상태나 `LISTEN`을 의존시키지 않는다. [Vercel 연결 풀](https://vercel.com/kb/guide/connection-pooling-with-functions) · [Neon 연결 풀](https://neon.com/docs/connect/connection-pooling) |
| 첨부 | Render 시작 스크립트는 첨부 저장을 비활성화한다. 과거에 저장된 파일이 있는지는 DB 메타데이터와 저장소 백업 목록을 대조한다. 후보는 비공개 객체 저장소(Vercel Blob 또는 S3 호환)다. 기존 10MB 지원에는 브라우저 직접 업로드를 검토하고 함수의 기본 4.5MB 본문 한도를 고려한다. 다운로드·삭제 시 카드 권한을 재확인한다. 업로드 의도에 사용자·카드·최대 크기·만료를 묶고 완료 후 실제 객체를 검증한다. 삭제 대기열과 고아 객체 정리 규칙을 보존한다. 다운로드 계약과 접근 철회를 검증할 때까지 현행 비활성 응답을 유지한다. [Vercel Functions 한도](https://vercel.com/docs/functions/limitations) · [비공개 Blob](https://vercel.com/docs/vercel-blob/private-storage) |
| 알림·실시간 | 기존 SSE는 세션과 프로젝트 접근을 재확인하는 Spring 메모리 구독이다. 알림은 기존 30초 갱신과 DB 읽음 상태를 이용한다. 프로젝트는 서버 상태를 기준으로 포커스·가시성에 맞춘 폴링을 먼저 검증한다. 기존 SSE URL을 사용하는 클라이언트가 남아 있다면 종료 계약을 확인하고, 필요 시 짧은 재연결형 SSE를 검토한다. 의미 있는 지연 기준을 달성하지 못하면 승인 후 외부 실시간 채널을 검토한다. 마감·가입코드·파일정리는 멱등 실행과 중복 방지, 경쟁 제어를 유지하며 허용되는 잡 주기와 비용을 검증한다. |

## 지금 실행할 수 있는 검증

`deploy/vercel/functions`에서 Node.js 24로 `npm ci`, `npm run check`, `npm test`를 실행한다. `GET /api/ready`는 독립 API의 초기 진단이며 공개 응답에 DB 상세 정보를 포함하지 않는다. 연결 성공 여부만 확인한다.

격리 DB에서 사용할 때만 `TEAMFLOW_PREVIEW_DATABASE_URL`을 지정한다. URL에는 사용자·비밀번호·호스트·DB명을 포함하고 쿼리 옵션을 제외한다. TLS 검증은 코드가 설정한다. Vercel Preview를 만들면 별도 프로젝트 루트를 `deploy/vercel/functions`로 지정한다. 운영으로 표시된 실행 환경에서는 연결을 거부한다.

2026-11-25 로컬 검증에서 TypeScript 검사와 새 함수 테스트 5개가 통과했다. 임시 PostgreSQL 16에서 신뢰된 인증서로 200, 인증서 호스트 불일치와 신뢰할 수 없는 인증서에서 각각 503을 확인했다. 기준본 프런트엔드 테스트 42개와 빌드, 격리 PostgreSQL을 사용하는 Spring 테스트 78개가 통과했다. 원본 체크아웃의 초대 및 알림 관련 프런트엔드 테스트 3개도 통과했다. Vercel Preview와 운영 DB 호스트는 확인 대기 상태다.

## 실행 순서와 승인 지점

1. 로그인·`/api/auth/me`·로그아웃을 Node로 구현했다. Spring과 Node가 같은 임시 PostgreSQL과 합성 계정을 쓰는 계약 테스트에서 BCrypt, 응답, 세션, 쿠키, 접근 제한을 검증한다. [인증 구현과 재현 절차](functions/AUTH.md)
2. 프로젝트 및 나머지 API를 옮긴다. 기존 미커밋 초대·알림 동작과 199 SQL을 함께 검토한다. 복구 리허설에서 테이블 건수·시퀀스·기존 해시의 그대로 보존·역할 권한·첨부 목록을 검증한다.
3. 격리 DB만 사용하는 Vercel Preview에서 브라우저·부하·동시 수정·백그라운드 잡을 검증한다. 운영 데이터나 메일 전송은 별도 권한과 보호 조치 적용 후 다룬다.
4. 운영 DB 변경과 운영 배포는 각각 별도 승인 사항이다. 전환 전 복구 시점과 쓰기 중지 구간을 합의한다. 전환 후 문제가 생기면 도메인/프록시를 기존 경로로 복귀시키고, 신규 쓰기가 있었다면 호환성과 데이터 차이를 확인한 뒤 DB 조치를 승인받는다. Render 서비스 삭제 및 유료 서비스 가입도 각각 별도 승인 사항이다.
