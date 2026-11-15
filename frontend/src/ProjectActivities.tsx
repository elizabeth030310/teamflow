import { useEffect, useState } from 'react'
import type { Member } from './Collaboration'

type Activity = {
  id: number
  taskTitle: string
  actorName: string
  type: string
  createdAt: string
  previousStatus: string | null
  newStatus: string | null
  previousAssigneeId: number | null
  newAssigneeId: number | null
}

type ActivityState =
  | { status: 'loading' | 'error' | 'blocked' }
  | { status: 'ready'; items: Activity[] }

const activityDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

function describeActivity(activity: Activity, members: Member[], statusLabels: ReadonlyMap<string, string>) {
  const title = activity.taskTitle
  const statusName = (status: string | null) => status === null ? '알 수 없음' : statusLabels.get(status) ?? status
  const assigneeName = (id: number | null) => id === null
    ? '미배정'
    : members.find((member) => member.userId === id)?.name ?? `사용자 #${id}`

  switch (activity.type) {
    case 'TASK_CREATED':
      return `‘${title}’ 작업을 만들었습니다.`
    case 'TASK_STATUS_CHANGED':
      return `‘${title}’ 상태를 변경했습니다 (${statusName(activity.previousStatus)} → ${statusName(activity.newStatus)}).`
    case 'TASK_ASSIGNEE_CHANGED':
      return `‘${title}’ 담당자를 변경했습니다 (${assigneeName(activity.previousAssigneeId)} → ${assigneeName(activity.newAssigneeId)}).`
    case 'COMMENT_CREATED':
      return `‘${title}’에 댓글을 작성했습니다.`
    case 'COMMENT_DELETED':
      return `‘${title}’에서 댓글을 삭제했습니다.`
    case 'TASK_DELETED':
      return `‘${title}’ 작업을 삭제했습니다.`
    default:
      return `‘${title}’에서 활동을 기록했습니다.`
  }
}

type Props = {
  projectId: number
  refreshKey: number
  members: Member[]
  statusLabels: ReadonlyMap<string, string>
  onSessionExpired: () => void
}

function ActivityList({ projectId, refreshKey, members, statusLabels, onSessionExpired }: Props) {
  const [state, setState] = useState<ActivityState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadActivities() {
      try {
        const response = await fetch(`/api/projects/${projectId}/activities`, {
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        })
        if (controller.signal.aborted) return
        if (response.status === 401) {
          onSessionExpired()
          return
        }
        if ([403, 404].includes(response.status)) {
          setState({ status: 'blocked' })
          return
        }
        if (!response.ok) throw new Error()
        const items = await response.json() as Activity[]
        if (!controller.signal.aborted) setState({ status: 'ready', items })
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error' })
      }
    }

    void loadActivities()
    return () => controller.abort()
  }, [projectId, refreshKey, revision, onSessionExpired])

  function refresh() {
    setState({ status: 'loading' })
    setRevision((previous) => previous + 1)
  }

  return (
    <div className="tf-activity-content">
      {state.status !== 'blocked' && (
        <button type="button" onClick={refresh}>
          {state.status === 'error' ? '다시 불러오기' : '활동 기록 새로고침'}
        </button>
      )}
      {state.status === 'loading' && <p role="status">활동 기록을 불러오는 중…</p>}
      {state.status === 'error' && <p className="tf-error" role="alert">활동 기록을 불러오지 못했습니다.</p>}
      {state.status === 'blocked' && <p className="tf-error" role="alert">이 프로젝트의 활동 기록에 접근할 수 없습니다.</p>}
      {state.status === 'ready' && (state.items.length === 0 ? <p>아직 활동 기록이 없습니다.</p> : (
        <ol className="tf-activity-list" aria-label="최근 활동 기록" tabIndex={0}>
          {state.items.map((activity) => (
            <li key={activity.id}>
              <div>
                <strong>{activity.actorName}</strong>{' '}
                {describeActivity(activity, members, statusLabels)}
              </div>
              <time dateTime={activity.createdAt}>{activityDate.format(new Date(activity.createdAt))}</time>
            </li>
          ))}
        </ol>
      ))}
    </div>
  )
}

export default function ProjectActivities(props: Props) {
  const [open, setOpen] = useState(false)

  return (
    <details className="tf-project-activities" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>활동 기록</summary>
      {open && <ActivityList {...props} />}
    </details>
  )
}
