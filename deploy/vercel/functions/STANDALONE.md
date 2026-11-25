# Render 없는 TeamFlow 배포

## API 대조

[API 목록](API-INVENTORY.json)은 Spring 컨트롤러의 55개 메서드·경로를 기록한다. 자동 테스트가 실제 Spring 선언과 비교한다. 인증과 관리자는 `api/auth` 및 `src/account-api.ts`, 프로젝트·초대·문서·활동은 `src/projects.ts`, 작업·체크리스트·댓글은 `src/tasks.ts`, 첨부파일은 `src/attachments.ts`, 알림은 `src/notifications.ts`가 담당한다. 인증이 필요한 Spring의 `GET /api/hello`도 제공한다.

- 알림 목록, 페이지 매김, 읽지 않음 건수, 단건·전체 읽음을 제공한다. 초대·작업 배정·댓글·대댓글·마감 임박·기한 초과를 포함하며 수신자와 프로젝트 접근 권한을 확인한다.
- 프로젝트와 알림의 두 기존 SSE 주소는 권한 확인 후 204로 종료한다. Node 모드의 React 화면은 프로젝트·작업 패널을 12초, 알림을 30초 주기로 조회한다. 숨긴 탭과 오프라인에서는 주기 조회를 쉬고 복귀하면 갱신한다.
- 기존 첨부 목록·다운로드·삭제 주소와 작은 파일의 multipart POST를 유지한다. Vercel 요청 본문 한도를 넘는 기존 multipart 호출은 플랫폼에서 거절될 수 있다. Node 프런트엔드는 제한된 토큰으로 비공개 Blob에 직접 올려 10 MiB까지 지원한다. 완료 시 크기와 실제 PDF·PNG·JPEG 시그니처를 확인한다. 다운로드는 프로젝트 권한을 확인한 뒤 비공개 스트림으로 보낸다. 삭제는 업로더만 가능하며 접근 차단과 파일 삭제 대기열 추가를 함께 커밋한다. [Vercel 비공개 Blob](https://vercel.com/docs/vercel-blob/private-storage)

## 기존 첨부 데이터 이전

1. 승인된 동일 시점의 DB 백업과 파일 디렉터리 복사본을 확보한다. 운영 Render 시작 스크립트가 첨부 저장을 비활성화하지만, 이력 파일 유무는 별도로 확인한다. 운영 서비스를 직접 대상으로 복사 도구를 실행하지 않는다.
2. 읽기 전용 복제본에서 아래 SQL 결과를 `manifest.json`으로 내보낸다. 파일 디렉터리에서 UUID 파일명과 실제 바이트 크기를 대조한다.

   ```sql
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'storageKey', storage_key, 'sizeBytes', size_bytes) ORDER BY id), '[]'::jsonb)
   FROM public.task_attachments;
   ```

3. 이 디렉터리에서 `node scripts/migrate-attachments.mjs <절대-백업경로> <manifest.json>`을 실행한다. 이 단계는 네트워크를 사용하지 않으며 UUID·크기·SHA-256 대조표를 출력한다. 누락·불일치를 먼저 해결한다. 검토된 SHA-256 포함 대조표, 별도 비공개 Preview 저장소의 ID와 토큰을 준비한 뒤에만 `--copy-to-preview`를 사용한다. 환경 변수는 `TEAMFLOW_MIGRATION_PREVIEW_STORE_ID`, `TEAMFLOW_MIGRATION_PREVIEW_BLOB_TOKEN`이다. 도구는 기존 객체를 덮어쓰지 않고 원격 파일을 다시 읽어 SHA-256을 확인한다.
4. 기존 DB의 `task_attachments.storage_key`를 유지한다. 객체 경로는 `teamflow/attachments/<UUID>`다. 복제 DB와 Blob으로 수량과 다운로드 표본을 검증하고 업로더·멤버·외부 사용자별 권한을 재확인한다. 운영 전환과 실제 복사는 별도 검토 및 승인 항목이다.

## Preview 설정과 유지보수

- Vercel 테스트 프로젝트를 연결하고 [격리 DB 설정](PREVIEW.md)에 따라 001·002·003 SQL을 적용한다. 003은 새 업로드 예약 테이블만 추가한다. 런타임 역할에 `teamflow_attachment_uploads`의 조회·삽입·갱신·삭제를 허용한다. 기존 `task_attachments`와 삭제 대기열에는 문서화된 앱 권한을 유지한다.
- Hobby 범위의 비공개 Vercel Blob 저장소를 Preview에 연결해 `BLOB_READ_WRITE_TOKEN`을 설정한다. 테스트 프로젝트의 `TEAMFLOW_AUTH_ORIGINS`를 고정 Preview 주소로 설정한다. 사용량 한도에 도달하면 파일 사용이 중단될 수 있다. [Blob Hobby 사용량](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- `CRON_SECRET`에 최소 32자의 비공개 값을 설정한다. 유지보수는 하루 한 번으로 설정했다. Cron은 Vercel의 Production 배포에서만 자동 호출되므로 Preview에서는 보호된 `GET /api/maintenance`를 Bearer 인증으로 직접 호출해 확인한다. 작업은 미완료 업로드, 파일 삭제 재시도, 만료된 가입 코드·요청 한도·세션·문서 임시 데이터, 마감일 알림을 처리한다. 마감일 알림은 알림함 첫 페이지 조회에서도 생성하며 중복을 차단한다. 실패한 객체 삭제는 대기열을 보존하여 다음 실행에서 재시도한다. [Vercel Cron](https://vercel.com/docs/cron-jobs)
- `New-CollaborationPreview.ps1`이 생성한 폴더를 배포 대상으로 사용한다. 이 폴더에는 기존 React 화면, 자체 Node 함수, 내부 rewrite와 Cron 설정이 포함된다. Render로 향하는 rewrite는 없다. 운영 DB는 기본 차단하며 승인 뒤 Production 전용 `TEAMFLOW_PRODUCTION_DATABASE_URL`과 `TEAMFLOW_ENABLE_PRODUCTION=1`이 모두 있어야 연결한다.
