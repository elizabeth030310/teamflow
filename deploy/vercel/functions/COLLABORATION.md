# TeamFlow 협업 API 이전

- `src/projects.ts`는 프로젝트, 소유자·멤버 권한, 초대·수락·거절·재전송, 활동 조회와 문서 계층을 처리한다. 문서 본문은 기존 `plain` 또는 `rich-v1` 문자열을 변환 없이 보존한다. 프로젝트 쓰기 잠금과 마이크로초 정밀도의 `expectedUpdatedAt` 비교로 동시 수정과 순환 관계를 막는다.
- `src/tasks.ts`는 작업, 상태·담당자·우선순위, ISO 날짜, 체크리스트, 댓글·대댓글 및 활동을 처리한다. 댓글 작성자 권한과 부모가 삭제된 스레드의 표시를 보존한다. 쓰기와 관련 활동·알림은 같은 트랜잭션에서 처리한다.
- `src/notifications.ts`는 미커밋 초대 알림의 가시성, 읽음 상태, 재전송 시 미읽음 복원과 정렬을 포함한다. 마감 알림의 생성 시점은 수신자가 알림함을 조회할 때로 옮겼다. 초대 승인과 거절 뒤에는 해당 알림이 숨겨진다.
- 스냅숏의 Spring·UI에는 원본 미커밋 초대·알림 변경과 199 SQL을 가져와 비교한다. Node용 화면 빌드에서는 기존 프로젝트·활동·댓글·체크리스트·알림 갱신을 폴링으로 전환한다. 기존 Vercel 프런트엔드 프록시 설정은 동일하다.

## 생성 실패 재현

`VercelCollaborationContractTest`는 임시 PostgreSQL에 배포 기준 스키마와 실제 앱 역할 권한을 구성한다. 문서의 `content_format`이 누락된 상태, 초대 알림 199 미적용 상태, 199 적용 후 `notifications.created_at` 갱신 권한이 없는 상태를 각각 점검한다. 운영 원인 확정에는 승인된 운영 담당자가 스키마·권한과 실패 요청 당시 로그를 대조해야 한다.

`backend/test-isolated.ps1`로 Spring/Node 계약 비교와 백엔드 회귀 테스트를 실행한다. Node 모드의 프런트엔드 빌드 후 `TEAMFLOW_TEST_COLLAB_BROWSER=1`을 설정하면 로컬 HTTPS에서 실제 React 문서 생성과 편집기 로드도 검증한다. 두 개의 동시 문서 수정과 초대 수락은 각각 한 요청만 성공해야 한다.

승인된 환경의 런타임 역할로 [읽기 전용 진단 SQL](sql/check-collaboration.sql)을 실행하면 문서·초대 관련 컬럼과 그 역할의 권한을 확인할 수 있다. 누락 컬럼은 테스트에서 `42703`, 누락된 갱신 권한은 `42501`이었다. 실제 운영 원인을 확정하려면 당시 실패 로그와 대조한다.

## Preview 준비

1. `New-CollaborationPreview.ps1`을 실행하면 기존 React 앱과 Node API를 같은 호스트에서 제공할 배포 폴더가 만들어진다. 루트는 기존 TeamFlow 화면이며 `/auth-preview.html`에는 인증 점검 화면이 있다. 이 스크립트는 로컬 산출물만 만든다.
2. [격리 Preview 설정](PREVIEW.md)을 사용한다. 스키마에는 기존 협업 테이블과 193-A, 193-D, 199가 필요하다. 기존 알림 권한에 `notifications.created_at` 열 갱신 권한이 추가로 필요하다. `content_format`을 새로 만든 환경에서는 런타임 역할의 해당 열 갱신 권한도 확인한다.
3. 관리 역할로 격리 DB에 `sql/002-page-uploads.sql`을 적용하고 런타임 역할에 `teamflow_page_uploads`의 조회·삽입·갱신·삭제를 허용한다. Node 모드의 React는 큰 `rich-v1` 문서를 분할해 전송하고 저장 내용은 기존 `project_pages`에 그대로 유지한다. 임시 전송은 사용자별로 한 건, 20분 유효하며 완료 시 삭제된다. 분할 읽기는 동일한 버전을 요구한다. Vercel의 기본 본문 제한 아래에서 각 조각이 전송되는지 실제 Preview에서 확인한다. [Vercel Functions 제한](https://vercel.com/docs/functions/limitations)
4. 브라우저에서 프로젝트·문서·작업과 두 계정의 초대 알림을 검증한다.

첨부파일, 알림, 독립 배포 설정은 [최종 이전 가이드](STANDALONE.md)를 따른다. 실제 Vercel Preview 라우팅은 연결 후 확인한다. 큰 문서의 분할 전송은 Node 모드의 TeamFlow 프런트엔드에 적용된다. 기존 JSON API를 직접 호출하는 클라이언트에는 Vercel 본문 한도가 적용된다.
