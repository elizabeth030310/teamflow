# TeamFlow 197-A 비공개 VPS 테스트 배포

Hetzner VPS에 Docker Compose로 Nginx, Spring Boot 4.1.2 / Java 21, PostgreSQL 16을 실행합니다. Tailscale Serve가 테스트 참여자에게 HTTPS 주소를 제공합니다. VPS가 실행 중이면 개발 PC를 꺼도 접속할 수 있습니다. [Hetzner 요금](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)과 [Tailscale 개인용 요금](https://tailscale.com/pricing)을 확인하세요.

## 1. VPS를 만들기 전

이 폴더는 배포 템플릿입니다. VPS 생성, 계정 설정, 새 테스트 DB 초기화, 마이그레이션 적용은 별도의 승인 후 진행합니다. 테스트 서버에는 합성 데이터와 전용 테스트 계정을 사용합니다. 기존 개발 DB, 볼륨, 첨부 디렉터리, 루트 `.env` 및 비공개 SQL 파일은 사용하지 않습니다.

Ubuntu VPS에서 최신 Docker Engine과 Compose 플러그인, Tailscale을 준비합니다. VPS 방화벽에서 관리용 SSH를 필요한 IP로 제한하고 TeamFlow의 포트를 인터넷에 열지 않습니다. Tailscale 접근 정책에서 승인된 사용자에게만 이 VPS의 HTTPS 포트 접근을 허용합니다. 테스트 참여자도 Tailscale에 연결해야 합니다.

이 폴더에서 아래 서식 검사 명령을 실행할 수 있습니다. 두 예시 값은 검사 전용입니다. 이 명령은 컨테이너나 볼륨을 만들지 않습니다.

```sh
STAGING_DB_OWNER_PASSWORD=fixture STAGING_DB_APP_PASSWORD=fixture \
  docker compose --env-file .env.example config --quiet
```

## 2. 승인된 VPS에서 테스트 전용 비밀값 준비

- 이 폴더의 `.env.example`을 `.env`로 복사하고 두 항목에 각각 다른 임의 비밀번호를 저장합니다. 파일 권한은 `0600`으로 설정합니다. 루트 `.env`를 복사하지 않습니다.
- 테스트 전용 CA로 PostgreSQL 서버 인증서를 발급합니다. 서버 인증서의 SAN은 `DNS:db`입니다. `secrets/ca.crt`에는 공개 CA 인증서, `secrets/db/server.crt`와 `secrets/db/server.key`에는 서버 인증서와 암호화되지 않은 서버 키를 둡니다. CA 개인키는 컨테이너에 제공하지 않습니다.
- 인증서 파일은 컨테이너가 읽을 수 있어야 합니다. 서버 키는 사용 중인 `postgres:16-alpine` 이미지의 `postgres` 사용자 UID/GID를 확인해 해당 소유권과 `0600`을 설정합니다. 키를 담은 디렉터리에도 해당 사용자의 탐색 권한이 있어야 합니다. [PostgreSQL TLS 파일 권한](https://www.postgresql.org/docs/16/ssl-tcp.html)
- 백엔드는 `prod` 프로필로 CA와 서버 이름을 검증합니다. PostgreSQL과 백엔드 포트는 호스트에 게시하지 않습니다. 두 영속 볼륨은 Compose 프로젝트 `teamflow-197a-vps`에 속합니다. 기존 볼륨을 마운트하거나 `docker compose down -v`를 실행하지 않습니다.

## 3. 새 스테이징 DB를 검토한 뒤 기동

승인된 VPS에서 이 폴더를 기준으로 다음 순서로 진행합니다.

1. `docker compose --env-file .env config --quiet`로 설정을 확인합니다. `docker compose --env-file .env up -d db`는 이 VPS의 새 DB를 초기화합니다.
2. 스키마 기준본과 증분 SQL 적용 목록을 먼저 검토합니다. 빈 DB에 합성 데이터용 스키마를 준비한 뒤 누락된 증분만 적용합니다. `teamflow_staging_owner`는 초기 설정과 마이그레이션에만 사용합니다. `teamflow_staging_app`을 별도로 만들고 앱에 필요한 테이블·열·시퀀스 권한만 부여합니다. 테스트 계정은 이 DB에만 준비합니다. [스키마 순서와 앱 권한](../../backend/db/PRODUCTION_DATABASE.md)
3. `docker compose --env-file .env up -d --build backend gateway`로 앱을 시작합니다. 개발 프로필이나 자동 스키마 업데이트로 시작 실패를 우회하지 않습니다. `docker compose ps`와 `docker compose logs --tail=100 backend gateway`로 시작 상태를 확인합니다.
4. Tailscale HTTPS를 활성화하고, VPS에서 `sudo tailscale serve --bg http://127.0.0.1:19780`을 실행합니다. 표시된 HTTPS 주소 하나로 UI와 `/api`에 접속합니다. `tailscale serve status`와 접근 정책을 확인합니다. 경유지에서 시작이 확인될 때까지 테스터에게 주소를 전달하지 않습니다. [Tailscale Serve 명령](https://tailscale.com/docs/reference/tailscale-cli/serve)

## 4. 접속 점검과 운영

- 승인된 테스트 계정으로 로그인·로그아웃하고 브라우저에서 세션 쿠키의 Secure, HttpOnly, SameSite=Lax를 확인합니다. 가입과 인증코드 발급은 Nginx가 403으로 차단합니다. 가입 버튼이 UI에 남아 있을 수 있으므로 참여자에게 지급된 계정으로 접속하도록 안내합니다.
- 같은 HTTPS 주소에서 작업 변경, 합성 첨부파일 업로드·다운로드, 실시간 알림과 프로젝트 이벤트를 확인합니다. 프록시는 요청 본문을 최대 11 MiB까지 받고, 이벤트 응답을 버퍼링하지 않습니다. 요청에 전달된 클라이언트 IP를 신뢰하지 않으므로 IP 기반 로그인 제한은 여러 테스터에게 공동으로 적용될 수 있습니다.
- 프록시는 외부 Host와 HTTPS 정보를 백엔드에 전달합니다. 승인된 기기에서 정상 접속을 확인하고, 허용되지 않은 기기에서는 접속이 막히는지 확인합니다. 백엔드가 컨테이너 내부에서만 접근 가능한지도 확인합니다.
- 스테이징에서 합성 데이터만 사용해 컨테이너를 재기동하고 DB 행과 첨부파일이 남는지 확인합니다. 재기동 후 다시 로그인해야 할 수 있습니다. DB와 첨부 백업은 같은 복구 시점으로 관리합니다.
