# TeamFlow Vercel 배포

Vercel은 `frontend`의 Vite 빌드와 SPA 경로를 제공한다. 브라우저의 상대 경로 `/api/…`는 Vercel 외부 rewrite를 거쳐 기존 Render의 Nginx와 Spring Boot Java 21로 전달된다. PostgreSQL 연결, 메일 설정, 기존 Render 주소는 그대로 사용한다.

## GitHub 연결과 배포 승인

1. 검토한 변경을 별도 브랜치에 올린다. 같은 체크아웃에 있던 초대 관련 미커밋 변경을 이 배포에 포함하려면 별도 검토와 DB 호환성 확인이 필요하다.
2. [Vercel 프로젝트 설정](https://vercel.com/docs/project-configuration)에서 GitHub 연결을 승인하고 TeamFlow 저장소에 대한 접근 권한을 부여한다. 프로젝트의 Root Directory는 `frontend`, Framework는 Vite, Node.js는 24.x로 설정한다. 첫 Git 가져오기는 초기 배포를 시작할 수 있으므로 이 작업은 연결 승인 후 진행한다. 기존 사용자 도메인은 Preview 검증이 끝날 때까지 연결하지 않는다.
3. Preview와 Production의 Config 환경 변수 `TEAMFLOW_BACKEND_ORIGIN`에 Render 대시보드의 기존 공개 HTTPS 주소를 입력한다. 경로와 쿼리는 제외한다. Vercel에 DB, SMTP, Render 토큰 또는 세션 값을 복사할 필요가 없다.
4. 로그인에 사용할 고정 Preview 브랜치 주소와 최종 Vercel HTTPS 주소를 확인한다. Render에 검토된 백엔드 빌드를 배포할 때 `TEAMFLOW_FRONTEND_ORIGINS`에 그 주소들을 쉼표로 구분해 설정한다. 경로, 끝 슬래시, 와일드카드는 사용하지 않는다. Render 재배포와 메모리 세션 만료를 고려해 적용 시간을 승인받는다. 이 변경에는 DB 초기화나 마이그레이션이 필요 없다. 기존 운영 브라우저에서도 로그인과 API를 재확인한다.
5. 아래 항목을 Preview에서 검증한다. 운영 반영은 별도 승인 후 프로덕션 환경 변수와 최종 호스트를 확인하고 배포한다. 문제가 있으면 기존 Render URL을 사용하고 필요하면 Vercel 도메인 할당을 이전 배포로 되돌린다. Render 서비스와 PostgreSQL은 유지한다. [Preview 승격](https://vercel.com/docs/deployments/promote-preview-to-production)

## Preview 통과 기준

- SPA 내부 URL에 직접 진입하거나 새로고침해도 열린다. 정적 자산은 올바른 콘텐츠 타입으로 내려온다. 로그인 전 Vercel의 `/api/auth/me`는 401을 반환하고 SPA HTML로 바뀌지 않는다. 쿼리 문자열과 POST/PATCH 본문이 원본에 전달되고 API 응답을 공유 캐시에 저장하지 않는지 확인한다.
- 테스트 계정으로 로그인한다. 브라우저에서 세션 쿠키가 Vercel 호스트 전용이고 `Secure`, `HttpOnly`, `SameSite=Lax`인지 속성만 확인한다. 쿠키 값은 기록하지 않는다. 새로고침 뒤 `/api/auth/me`는 200, 로그아웃 뒤에는 401이어야 한다. 기존 Render 호스트의 쿠키는 새 호스트로 이전되지 않으므로 최초 방문 시 다시 로그인한다.
- 정상 로그인 및 쓰기 요청의 `X-TeamFlow-Request: 1`, `Origin`, `Sec-Fetch-Site: same-origin`이 전달되는지 확인한다. 테스트 환경에서는 의도 헤더가 없거나 출처가 허용되지 않은 변경 요청이 403이어야 한다. Nginx는 기존대로 Render 호스트를 Spring에 전달한다. Spring은 정확히 등록된 출처와 브라우저의 동일 출처 메타데이터를 함께 검사하며 CORS를 열지 않는다. Render에서 접속 IP가 Vercel 중계 IP로 집계될 수 있으므로 로그인과 가입의 IP 기반 제한도 Preview에서 점검한다.
- 테스트 프로젝트와 두 계정으로 프로젝트 SSE와 알림 SSE를 각각 검사한다. 로그인 상태에서 `text/event-stream` 응답과 약 15초 간격 하트비트가 요청이 열려 있는 동안 도착하는지 본다. 120초 전후를 넘겨 연결 유지 또는 재접속과 목록 갱신을 기록한다. 이벤트 누락, 묶음 전송, 세션 종료 후 계속 수신, 비동기 접근 거부가 있으면 운영 전환을 보류한다. 연결 종료 후 프로젝트 쪽은 재시도와 폴링을 사용하고 알림 목록은 30초 주기 갱신도 수행한다.

## 프록시 한도

- 외부 rewrite는 업스트림 응답에 대한 문서상 최대 대기 120초를 적용한다. 응답 시작 후 장시간 SSE가 어떻게 처리되는지는 실제 Preview에서 측정해야 한다. Render Nginx의 75초 읽기 타임아웃은 읽기 사이의 유휴 시간이며, Spring SSE 자체 타임아웃은 5분이다. Render의 콜드 스타트도 첫 응답에 영향을 준다. [Vercel 제한](https://vercel.com/docs/limits) · [라우터 오류](https://vercel.com/docs/errors/router_external_target_error)
- Vercel Functions의 4.5 MB 본문 한도는 이 외부 rewrite 경로의 확인된 한도가 아니다. 현재 Render 시작 스크립트는 첨부 파일 저장을 비활성화한다. 활성화할 경우 작은 요청과 Spring의 10 MB 파일·11 MB 요청 경계에서 업로드와 다운로드를 직접 검증한다. API 중계에 함수는 사용하지 않는다. [Functions 제한](https://vercel.com/docs/functions/limitations)
- API rewrite에 CDN 캐시 비활성화와 `private, no-store`를 명시했다. Preview에서 인증 응답과 SSE에 캐시 HIT가 없는지 확인한다. [Vercel 외부 rewrite 캐시 변경](https://vercel.com/changelog/vercels-cdn-now-respects-cache-control-headers-from-external-origins-by-default)

## 별도 추적하는 기존 오류

- **문서 생성 실패** — Render와 Vercel에서 같은 입력과 권한으로 각각 재현하고 HTTP 상태 및 응답 시각과 Spring 로그를 대조한다. 운영 스키마, 문서 관련 마이그레이션, 앱 역할 권한을 확인하기 전에는 원인과 해결 여부를 확정할 수 없다.
- **초대 실패 또는 알림 누락** — 초대 API의 응답, 받은 초대 목록, 알림 목록과 SSE 각각을 비교한다. 작업 중인 초대 변경사항과 `199-project-invitation-notifications.sql`의 운영 적용 여부는 별도 확인 사항이다. 이번 이전 과정에서 운영 SQL을 실행하지 않는다.
