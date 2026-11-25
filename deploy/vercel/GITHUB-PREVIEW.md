# GitHub 연결형 TeamFlow Preview

## Vercel 설정

프로젝트는 `teamflow-test`, 테스트 소스 브랜치는 `test/vercel-standalone`이다. 이 프로젝트는 저장소 최상위의 설정을 사용한다. 기존 `frontend/vercel.json`은 이전 배포 설정으로 유지한다.

| Vercel 항목 | 값 |
| --- | --- |
| Root Directory | 저장소 루트 `.` (입력란을 비워도 동일) |
| Application / Framework Preset | Other |
| Node.js Version | 24.x |
| Build Command | `npm run build:vercel` |
| Output Directory | `frontend/dist` |
| Install Command | `npm ci && npm --prefix frontend ci` |

코드의 루트 `vercel.json`이 빌드 설정을 명시한다. 프런트엔드 빌드 스크립트가 Node API 모드를 켜므로 Vercel에서 `VITE_TEAMFLOW_NODE_API`를 별도로 설정할 필요가 없다. 정적 React 화면과 `/api`가 같은 호스트에서 동작한다.

실제 팀 운영 프로젝트와 연결하기 전에 테스트 프로젝트의 환경과 브랜치를 확인한다. 이 브랜치는 Preview 환경에서 테스트한다. `TEAMFLOW_ENABLE_PRODUCTION`과 `TEAMFLOW_PRODUCTION_DATABASE_URL`은 설정하지 않는다. Preview에 사용할 변수는 다음과 같다.

| 환경 변수 | 용도 |
| --- | --- |
| `TEAMFLOW_PREVIEW_DATABASE_URL` | 격리 PostgreSQL TLS 연결 URL. 쿼리 옵션은 제외한다. |
| `TEAMFLOW_AUTH_ORIGINS` | 브라우저가 접속할 정확한 HTTPS Preview Origin. 여럿이면 쉼표로 구분한다. |
| `TEAMFLOW_SIGNUP_HMAC_KEY` | 이메일 코드 발급 및 검증에 사용할 별도 32바이트 이상 Base64 키. |
| `TEAMFLOW_BREVO_API_KEY` | 승인된 테스트용 Brevo 전송 키. |
| `TEAMFLOW_BREVO_FROM` | Brevo에서 검증한 테스트 발신 이메일. |
| `BLOB_READ_WRITE_TOKEN` | 격리 비공개 Blob 저장소를 연결하면 제공되는 토큰. |
| `CRON_SECRET` | 최소 32자의 유지보수 API 인증 값. |

기본 메일 제공자는 Brevo다. 구형 JVM locale 호환이 필요한 경우에만 `TEAMFLOW_LEGACY_LOGIN_LOCALE`을 설정한다. 실제 값은 Vercel의 해당 환경에 입력한다. Cron 자동 실행은 Vercel Production 범위의 동작이다. Preview에서는 보호된 유지보수 엔드포인트를 직접 검증한다.

GitHub 커밋을 연결하면 Vercel이 배포를 시작할 수 있다. 연결 전에 배포 환경과 브랜치를 검토한다. 운영 라우팅 전환과 운영 데이터 접근은 별도 승인 사항이다. [Vercel 빌드 설정](https://vercel.com/docs/builds/configure-a-build)

격리 DB에 필요한 스키마와 권한은 [독립 배포 가이드](functions/STANDALONE.md)를 따른다. 브라우저 인증 점검 화면은 `/auth-preview.html`에서 열린다.
