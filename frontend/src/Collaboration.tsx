import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

export type Member = {
  userId: number
  name: string
  role: 'OWNER' | 'MEMBER'
}

type Invitation = {
  id: number
  projectId: number
  projectName: string
  email: string
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
}

type InvitationAction = 'accept' | 'reject'

const invitationLabels: Record<Invitation['status'], string> = {
  PENDING: '응답 대기',
  ACCEPTED: '수락됨',
  REJECTED: '거절됨',
}

class ApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

async function request<Data>(path: string, options?: RequestInit): Promise<Data> {
  const response = await fetch(`/api/projects${path}`, {
    ...options,
    credentials: 'include',
  })
  if (!response.ok) throw new ApiError(response.status)
  return response.json() as Promise<Data>
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 401) return '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'
    if (error.status === 403) return '이 작업을 수행할 권한이 없습니다.'
  }
  return fallback
}

type ListState<Item> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: Item[] }

function useProjectList<Item>(path: string, fallback: string, refreshKey?: string) {
  const [state, setState] = useState<ListState<Item>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    request<Item[]>(path, { signal: controller.signal })
      .then((items) => {
        if (!controller.signal.aborted) setState({ status: 'ready', items })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: errorMessage(error, fallback) })
        }
      })

    return () => controller.abort()
  }, [path, fallback, attempt, refreshKey])

  function reload() {
    setState({ status: 'loading' })
    setAttempt((previous) => previous + 1)
  }

  function update(change: (items: Item[]) => Item[]) {
    setState((previous) => previous.status === 'ready'
      ? { status: 'ready', items: change(previous.items) }
      : previous)
  }

  return { state, reload, update }
}

function ListFeedback({ state, loading, reload }: {
  state: ListState<unknown>
  loading: string
  reload: () => void
}) {
  if (state.status === 'loading') return <p role="status">{loading}</p>
  if (state.status === 'ready') return null

  return (
    <>
      <p className="tf-error" role="alert">{state.message}</p>
      <button type="button" onClick={reload}>다시 불러오기</button>
    </>
  )
}

export function InvitationInbox({ workspaceReady, onAccept }: {
  workspaceReady: boolean
  onAccept: (projectId: number) => Promise<void>
}) {
  const invitations = useProjectList<Invitation>('/invitations', '받은 초대를 불러오지 못했습니다.')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [acceptedProjectId, setAcceptedProjectId] = useState<number | null>(null)

  async function loadAcceptedProject(projectId: number) {
    try {
      await onAccept(projectId)
      setAcceptedProjectId(null)
      setNotice('초대를 수락했습니다. 내 프로젝트에서 확인할 수 있습니다.')
    } catch {
      setError('초대는 수락했지만 공유 프로젝트를 불러오지 못했습니다.')
    }
  }

  async function retryProject() {
    if (acceptedProjectId === null || pending) return

    setPending(true)
    setError('')
    try {
      await loadAcceptedProject(acceptedProjectId)
    } finally {
      setPending(false)
    }
  }

  async function respond(invitation: Invitation, action: InvitationAction) {
    if (pending || (action === 'accept' && (!workspaceReady || acceptedProjectId !== null))) return

    setPending(true)
    setError('')
    setNotice('')
    try {
      const result = await request<Invitation>(`/invitations/${invitation.id}/${action}`, { method: 'POST' })
      invitations.update((items) => items.filter((item) => item.id !== invitation.id))

      if (action === 'accept') {
        setAcceptedProjectId(result.projectId)
        await loadAcceptedProject(result.projectId)
      } else {
        setNotice('초대를 거절했습니다.')
      }
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 409)) {
        setError('이미 처리되었거나 더 이상 유효하지 않은 초대입니다.')
        invitations.reload()
      } else {
        setError(errorMessage(failure, '초대 응답을 저장하지 못했습니다. 다시 시도해 주세요.'))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="tf-panel tf-inbox" aria-labelledby="invitations-title">
      <h2 id="invitations-title">받은 프로젝트 초대</h2>
      <ListFeedback state={invitations.state} loading="받은 초대를 불러오는 중입니다." reload={invitations.reload} />
      {invitations.state.status === 'ready' && (
        <>
          {invitations.state.items.length === 0 ? <p>대기 중인 초대가 없습니다.</p> : (
            <ul className="tf-collaboration-list">
              {invitations.state.items.map((invitation) => (
                <li key={invitation.id}>
                  <strong>{invitation.projectName}</strong>
                  <div className="tf-collaboration-actions">
                    <button type="button" className="tf-primary"
                      aria-label={`${invitation.projectName} 초대 수락`}
                      disabled={pending || !workspaceReady || acceptedProjectId !== null}
                      onClick={() => void respond(invitation, 'accept')}>수락</button>
                    <button type="button" aria-label={`${invitation.projectName} 초대 거절`}
                      disabled={pending} onClick={() => void respond(invitation, 'reject')}>거절</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" disabled={pending} onClick={invitations.reload}>초대 새로고침</button>
        </>
      )}
      {pending && <p role="status">처리 중입니다.</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="tf-error" role="alert">{error}</p>}
      {acceptedProjectId !== null && (
        <button type="button" disabled={pending} onClick={() => void retryProject()}>공유 프로젝트 다시 불러오기</button>
      )}
    </section>
  )
}

export function ProjectCollaboration({ projectId, userId, refreshKey, showMembers, renderHeader, children }: {
  projectId: number
  userId: number
  refreshKey: string
  showMembers: boolean
  renderHeader: (isOwner: boolean) => ReactNode
  children: (members: ListState<Member>) => ReactNode
}) {
  const members = useProjectList<Member>(`/${projectId}/members`, '프로젝트 멤버를 불러오지 못했습니다.', refreshKey)
  const isOwner = members.state.status === 'ready' &&
    members.state.items.some((member) => member.role === 'OWNER' && member.userId === userId)

  return (
    <>
      {renderHeader(isOwner)}
      <section className="tf-collaboration" aria-labelledby={`members-${projectId}`} hidden={!showMembers}>
        <h4 id={`members-${projectId}`}>프로젝트 멤버</h4>
        <ListFeedback state={members.state} loading="프로젝트 멤버를 불러오는 중입니다." reload={members.reload} />
        {members.state.status === 'ready' && (
          <ul className="tf-collaboration-list">
            {members.state.items.map((member) => (
              <li key={member.userId}>
                <span>{member.name}{member.userId === userId && ' (나)'}</span>
                <span className="tf-badge tf-date">{member.role === 'OWNER' ? '소유자' : '멤버'}</span>
              </li>
            ))}
          </ul>
        )}
        {members.state.status === 'ready' && (
          <button type="button" onClick={members.reload}>멤버 새로고침</button>
        )}
        {isOwner && <ProjectInvitations projectId={projectId} />}
      </section>
      {children(members.state)}
    </>
  )
}

function ProjectInvitations({ projectId }: { projectId: number }) {
  const path = `/${projectId}/invitations`
  const invitations = useProjectList<Invitation>(path, '보낸 초대를 불러오지 못했습니다.')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim() || sending || invitations.state.status === 'loading') return

    setSending(true)
    setError('')
    setNotice('')
    try {
      const invitation = await request<Invitation>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (invitations.state.status === 'ready') {
        invitations.update((items) => [...items, invitation])
      } else {
        invitations.reload()
      }
      setEmail('')
      setNotice(`${invitation.email}에 초대를 보냈습니다.`)
    } catch (failure) {
      const status = failure instanceof ApiError ? failure.status : null
      const messages: Record<number, string> = {
        400: '이메일 주소를 확인해 주세요.',
        404: '가입된 이메일을 찾을 수 없습니다.',
        409: '이미 소유자이거나 초대 기록이 있는 이메일입니다.',
      }
      setError(errorMessage(failure, messages[status ?? 0] ?? '초대를 보내지 못했습니다. 다시 시도해 주세요.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <details className="tf-invitation-management">
      <summary>초대 관리</summary>
      <form onSubmit={invite}>
        <label htmlFor={`invite-email-${projectId}`}>초대할 이메일</label>
        <div className="tf-invite-form">
          <input id={`invite-email-${projectId}`} type="email" required maxLength={255}
            value={email} disabled={sending} onChange={(event) => setEmail(event.target.value)} />
          <button type="submit" className="tf-primary"
            disabled={sending || invitations.state.status === 'loading'}>
            {sending ? '보내는 중…' : '초대 보내기'}
          </button>
        </div>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && <p className="tf-error" role="alert">{error}</p>}
      <h4>보낸 초대</h4>
      <ListFeedback state={invitations.state} loading="보낸 초대를 불러오는 중입니다." reload={invitations.reload} />
      {invitations.state.status === 'ready' && (
        <>
          {invitations.state.items.length === 0 ? <p>보낸 초대가 없습니다.</p> : (
            <ul className="tf-collaboration-list">
              {invitations.state.items.map((invitation) => (
                <li key={invitation.id}>
                  <span>{invitation.email}</span>
                  <span className="tf-badge tf-date">{invitationLabels[invitation.status]}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" disabled={sending} onClick={invitations.reload}>보낸 초대 새로고침</button>
        </>
      )}
    </details>
  )
}
