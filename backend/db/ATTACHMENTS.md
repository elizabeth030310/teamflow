# 작업 카드 첨부파일 적용 안내

## 1. 비공개 저장 폴더

백엔드를 실행하는 계정에 웹 공개 경로 밖의 전용 폴더를 지정합니다. 프로젝트 저장소와 프런트엔드의 `public`, `dist` 폴더 밖에 두고, 서비스 계정만 파일을 읽고 쓸 수 있도록 권한을 설정합니다. 서버를 다시 띄워도 파일이 남는 디스크나 볼륨을 사용합니다.

로컬 Windows에서 백엔드를 시작할 PowerShell 창에 다음을 설정할 수 있습니다.

```powershell
$env:TEAMFLOW_ATTACHMENT_STORAGE_ROOT = Join-Path $env:LOCALAPPDATA 'TeamFlow\attachments'
```

경로는 절대 경로여야 합니다. 설정이 비어 있으면 기존 카드 기능은 그대로 동작하며 첨부파일 업로드·다운로드는 사용할 수 없습니다. 첨부파일을 이미 사용 중인 환경에서는 백업과 복구 시 PostgreSQL과 이 폴더를 같은 시점의 데이터로 관리합니다.

## 2. 기존 PostgreSQL에 테이블 추가

배포 전에 쓰기 작업을 멈추고 현재 DB와 첨부 저장 폴더를 백업합니다. 이전 단계의 스키마가 준비된 DB에서 `184-task-checklist-items.sql` 다음으로 다음 파일을 적용합니다.

1. [185-task-attachments.sql](185-task-attachments.sql)에서 카드별 첨부파일 정보를 저장하는 테이블을 만듭니다.
2. [186-attachment-file-deletions.sql](186-attachment-file-deletions.sql)에서 디스크 파일 삭제를 재시도할 수 있도록 대기열 테이블을 만듭니다.

아래 명령은 TeamFlow 루트의 기본 Docker Compose 환경용입니다. 다른 환경에서는 해당 PostgreSQL 연결 정보를 사용합니다. 먼저 연결 대상과 테이블 존재 여부를 확인합니다.

```powershell
docker compose exec -T postgres psql -U teamflow -d teamflow -c "select current_database(), to_regclass('public.tasks') as tasks, to_regclass('public.users') as users, to_regclass('public.task_attachments') as attachments, to_regclass('public.attachment_file_deletions') as deletion_queue;"
```

DB가 `teamflow`이고 `tasks`와 `users`가 존재하는지 확인합니다. 조회 결과에서 `attachments`와 `deletion_queue`가 둘 다 빈 칸이면 두 테이블이 아직 없으므로 아래 명령으로 SQL을 적용합니다.

```powershell
Get-Content -LiteralPath 'backend/db/185-task-attachments.sql', 'backend/db/186-attachment-file-deletions.sql' |
    docker compose exec -T postgres psql -U teamflow -d teamflow -v ON_ERROR_STOP=1 --single-transaction -f -
```

기존 개발 설정인 `ddl-auto=update`로 새 백엔드를 먼저 실행했다면 Hibernate가 테이블을 이미 만들었을 수 있습니다. 그 경우 기존 테이블의 외래 키·인덱스와 컬럼을 SQL 파일과 대조한 뒤, 아직 없는 테이블의 SQL만 적용합니다. 기존 테이블을 지우고 다시 만들면 저장된 첨부파일 정보나 삭제 대기열이 사라질 수 있습니다. 적용 후 같은 조회 명령으로 두 테이블의 존재를 확인합니다. 배포에서 스키마를 SQL로 관리한다면 백엔드 실행 전에 `SPRING_JPA_HIBERNATE_DDL_AUTO=validate`를 설정해 스키마 검증을 사용합니다.

## 3. 빌드와 실행 확인

Java 21과 프로젝트의 Maven Wrapper를 사용합니다. Maven 캐시가 처음 준비되는 환경은 의존성 다운로드가 필요합니다.

```powershell
Push-Location backend
.\mvnw.cmd -DskipTests package
Pop-Location

Push-Location frontend
npm.cmd ci
npm.cmd run build
Pop-Location
```

백엔드 배포 산출물은 `backend/target/backend-0.0.1-SNAPSHOT.jar`이고 화면 산출물은 `frontend/dist`입니다. 백엔드에는 배포 환경의 DB 접속 설정과 비공개 저장 경로를 지정하고, Java 21로 `java -jar backend/target/backend-0.0.1-SNAPSHOT.jar`를 실행합니다.

배포 프록시는 화면과 `/api`를 동일 출처로 제공하고, 백엔드가 원래 요청의 호스트·스킴·포트를 확인할 수 있도록 전달합니다. 실시간 갱신에 쓰는 `/api/projects/{projectId}/events` 응답은 버퍼링하지 않습니다. 마지막으로 프로젝트 소유자와 수락한 멤버 계정에서 파일 첨부·다운로드·삭제와 상대 화면의 자동 갱신을 확인합니다.
