# 회원가입 이메일 인증

## 배포

1. 적용 대상 DB를 확인하고 승인을 받은 뒤 `189-a3-signup-verification.sql`을 `psql`의 오류 중단 옵션(`-v ON_ERROR_STOP=1`)과 함께 적용합니다. 새 테이블 두 개만 추가합니다. `users`에는 이미 이메일 고유 제약이 있으며 기존 계정에는 인증 절차가 추가되지 않습니다.
2. 메일 공급자에서 발신자 주소 또는 도메인을 인증하고 SMTP 제출 호스트와 STARTTLS 포트를 확인합니다. 백엔드 프로세스에 아래 값을 주입한 뒤 재시작합니다. 인증 정보와 HMAC 키는 배포 환경의 비밀 저장소에서 주입합니다.
3. 최종 브라우저 검증은 격리된 개발 DB와 Mailpit으로 시작합니다. 메일 수신, 오답, 재발송, 가입 완료, 로그인 순서로 확인합니다.

| 환경변수 | 값 |
| --- | --- |
| `TEAMFLOW_SIGNUP_HMAC_KEY` | 암호학적 난수 32바이트 이상의 Base64. 모든 백엔드 인스턴스에서 같은 값을 사용합니다. 키를 바꾸면 기존 인증번호와 이메일·IP별 제한 창이 무효화됩니다. |
| `TEAMFLOW_SMTP_HOST` | 메일 공급자의 SMTP 제출 호스트 |
| `TEAMFLOW_SMTP_PORT` | STARTTLS 제출 포트. 기본값 `587` |
| `TEAMFLOW_SMTP_USERNAME`, `TEAMFLOW_SMTP_PASSWORD` | 메일 공급자의 SMTP 자격 증명 |
| `TEAMFLOW_SMTP_FROM` | 공급자가 인증한 발신자 주소 |
| `TEAMFLOW_SMTP_AUTH`, `TEAMFLOW_SMTP_STARTTLS` | 기본값 `true`. 운영 환경에서는 둘 다 사용합니다. |

## 인증 정책

- 6자리 난수는 5분간 유효합니다. 번호별 오답 5회까지 허용하며 재발송하면 이전 번호가 무효화됩니다. 확인과 계정 생성은 단일 DB 트랜잭션에서 처리합니다.
- 재발송은 60초 뒤 가능합니다. DB 공용 발송 한도는 1시간 창마다 이메일 5건, 접속 IP 20건, 서비스 전체 300건입니다. 메일 전송 실패도 한도에 포함됩니다. 가입된 주소는 메일을 보내지 않고 같은 접수 응답을 반환합니다.
- DB에는 솔트를 포함해 계산한 인증번호 HMAC과 이메일·IP의 HMAC 식별자를 저장합니다. SMTP 디버그, HTTP 요청 본문 로깅, SQL 바인딩 로깅은 비활성 상태로 운영합니다.
- IP 제한은 서블릿이 보고한 접속 주소를 사용합니다. 프록시 뒤에서는 신뢰하는 프록시만 백엔드에 접근하도록 제한하고, 클라이언트가 보낸 전달 헤더를 프록시가 덮어쓰도록 설정한 뒤 전달 주소 사용 여부를 결정합니다. 이 설정 없이 프록시를 두면 IP 한도가 해당 프록시에서 공유됩니다.

## 로컬 메일 확인

별도의 개발 PostgreSQL DB를 준비합니다. `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD`에 개발 DB 설정을 주입하고 그 DB에 마이그레이션을 적용합니다. 다음 테스트용 수신함의 포트는 이 PC에서만 접근할 수 있습니다. [Mailpit Docker 문서](https://mailpit.axllent.org/docs/install/docker/)

```powershell
docker run --rm --detach --name teamflow-mailpit --publish 127.0.0.1:1025:1025 --publish 127.0.0.1:8025:8025 axllent/mailpit
$env:TEAMFLOW_SMTP_HOST = '127.0.0.1'
$env:TEAMFLOW_SMTP_PORT = '1025'
$env:TEAMFLOW_SMTP_FROM = 'teamflow@example.test'
$env:TEAMFLOW_SMTP_AUTH = 'false'
$env:TEAMFLOW_SMTP_STARTTLS = 'false'
$keyBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($keyBytes) } finally { $generator.Dispose() }
$env:TEAMFLOW_SIGNUP_HMAC_KEY = [Convert]::ToBase64String($keyBytes)
```

같은 PowerShell에서 개발 백엔드를 실행합니다. 가입 화면에서 `signup@example.test`로 번호를 요청하고 [로컬 수신함](http://127.0.0.1:8025)에서 확인합니다. 확인을 마치면 `docker stop teamflow-mailpit`으로 수신함을 종료합니다.

백엔드 자동 테스트는 `backend`에서 `powershell -File .\test-isolated.ps1`로 실행합니다. 임시 PostgreSQL 컨테이너와 메일 모의 객체를 사용합니다.
