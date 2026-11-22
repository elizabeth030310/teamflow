import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createSearchMatcher } from './search'

type Status = 'ACTIVE' | 'SUSPENDED' | 'WITHDRAWN'
type Member = { id: number; name: string; email: string; role: 'ADMIN' | 'USER'; status: Status; revision: number }
type AuditEntry = {
  id: number; actorId: number; targetId: number; fromStatus: Status; toStatus: Status; reason: string; occurredAt: string
}
type AuditPage = { entries: AuditEntry[]; nextCursor: string | null }
type MemberStats = { total: number; active: number; suspended: number; withdrawn: number }
type Confirmation = { member: Member; status: Status }

const statuses: Record<Status, string> = { ACTIVE: '정상', SUSPENDED: '정지', WITHDRAWN: '강제탈퇴' }
const actions: Record<Status, string> = { ACTIVE: '정지 해제', SUSPENDED: '정지', WITHDRAWN: '강제탈퇴' }
const statLabels: Record<keyof MemberStats, string> = {
  total: '전체 회원', active: '정상', suspended: '정지', withdrawn: '강제탈퇴',
}
const numberFormat = new Intl.NumberFormat('ko-KR')
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

function useAdminResource<T>(url: string, refresh: number, onSessionExpired: () => void) {
  const [attempt, setAttempt] = useState(0)
  const request = useMemo(() => ({ url, refresh, attempt }), [url, refresh, attempt])
  const [result, setResult] = useState<{ request: typeof request } &
    ({ data: T; error?: never } | { data?: never; error: true })>()
  const current = result?.request === request ? result : undefined

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    async function load() {
      try {
        const response = await fetch(request.url, { signal })
        if (controller.signal.aborted) return
        if (response.status === 401 || response.status === 403) {
          onSessionExpired()
          return
        }
        if (!response.ok) throw new Error('Admin request failed')
        const data = await response.json() as T
        if (!controller.signal.aborted) setResult({ request, data })
      } catch {
        if (!controller.signal.aborted) setResult({ request, error: true })
      }
    }

    void load()
    return () => controller.abort()
  }, [request, onSessionExpired])

  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    retry: () => setAttempt((previous) => previous + 1),
  }
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="tf-admin-error">
    <p className="tf-error" role="alert">{message}</p>
    <button type="button" onClick={onRetry}>다시 시도</button>
  </div>
}

export default function AdminDashboard({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [refresh, setRefresh] = useState(0)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Status | ''>('')
  const [auditFilter, setAuditFilter] = useState<Status | ''>('')
  // Each cursor points to the first record of the next page.
  const [auditCursors, setAuditCursors] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [dialogError, setDialogError] = useState('')
  const [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  const auditParams = new URLSearchParams()
  const cursor = auditCursors.at(-1)
  if (cursor) auditParams.set('cursor', cursor)
  if (auditFilter) auditParams.set('toStatus', auditFilter)
  const members = useAdminResource<Member[]>('/api/admin/users', refresh, onSessionExpired)
  const stats = useAdminResource<MemberStats>('/api/admin/users/stats', refresh, onSessionExpired)
  const audit = useAdminResource<AuditPage>(`/api/admin/audit/page?${auditParams}`, refresh, onSessionExpired)

  useEffect(() => {
    if (confirmation) dialog.current?.showModal()
  }, [confirmation])

  function reload() {
    setAuditCursors([])
    setRefresh((previous) => previous + 1)
  }

  function openConfirmation(member: Member, status: Status) {
    setNotice('')
    setDialogError('')
    setConfirmation({ member, status })
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirmation || saving) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    if (!reason) {
      setDialogError('사유를 입력해 주세요.')
      return
    }
    const { member, status } = confirmation
    setSaving(true)
    setDialogError('')
    try {
      const response = await fetch(`/api/admin/users/${member.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TeamFlow-Admin': 'member-status' },
        body: JSON.stringify({ status, revision: member.revision, reason }),
        signal: AbortSignal.timeout(15_000),
      })
      if (response.status === 401 || response.status === 403) {
        onSessionExpired()
      } else if (response.ok || response.status === 409 || response.status === 404) {
        dialog.current?.close()
        setNotice(response.ok ? '회원 상태를 변경했습니다.' : '회원 정보가 변경되었습니다. 최신 상태를 확인해 주세요.')
        reload()
      } else {
        setDialogError('회원 상태를 변경하지 못했습니다. 입력 내용을 확인해 주세요.')
      }
    } catch {
      setDialogError('처리 결과를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  const matches = createSearchMatcher(search)
  const visibleMembers = members.data?.filter((member) =>
    (!filter || filter === member.status) && (matches(member.name) || matches(member.email)))
  const memberNames = new Map(members.data?.map(({ id, name }) => [id, name]))
  const memberStats = stats.data
  const nextCursor = audit.data?.nextCursor

  function memberLabel(id: number) {
    const name = memberNames.get(id)
    return name ? `${name} (#${id})` : `#${id}`
  }

  return (
    <main className="tf-app tf-admin" aria-labelledby="admin-title">
      <h1 id="admin-title">회원 관리</h1>
      {notice && <p className="tf-status" role="status">{notice}</p>}
      <section className="tf-panel" aria-labelledby="admin-stats-title">
        <h2 id="admin-stats-title">회원 상태 통계</h2>
        <p>일반 회원 기준 · 회원 목록의 검색 및 필터와 별개</p>
        {stats.loading && <p className="tf-status" role="status">회원 통계를 불러오는 중입니다.</p>}
        {stats.error && <LoadError message="회원 통계를 불러오지 못했습니다." onRetry={stats.retry} />}
        {memberStats && <dl className="tf-admin-stats">
          {(Object.keys(statLabels) as (keyof MemberStats)[]).map((key) => (
            <div key={key}><dt>{statLabels[key]}</dt><dd>{numberFormat.format(memberStats[key])}</dd></div>
          ))}
        </dl>}
        {memberStats?.total === 0 && <p>등록된 일반 회원이 없습니다.</p>}
      </section>
      <section className="tf-panel" aria-labelledby="admin-members-title">
        <h2 id="admin-members-title">회원 목록</h2>
        <div className="tf-admin-controls">
          <label>회원 검색<input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="이름 또는 이메일" /></label>
          <label>회원 상태<select value={filter} onChange={(event) => setFilter(event.target.value as Status | '')}>
            <option value="">전체</option>
            {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
        {members.loading && <p className="tf-status" role="status">회원 목록을 불러오는 중입니다.</p>}
        {members.error && <LoadError message="회원 목록을 불러오지 못했습니다." onRetry={members.retry} />}
        {visibleMembers?.length === 0 && (
          <p role="status">{search.trim() || filter ? '조건에 맞는 회원이 없습니다.' : '등록된 회원이 없습니다.'}</p>
        )}
        {visibleMembers && visibleMembers.length > 0 && (
          <div className="tf-admin-table" role="region" aria-labelledby="admin-members-title" tabIndex={0}>
            <table className="tf-admin-users" aria-labelledby="admin-members-title">
              <thead><tr><th scope="col">이름</th><th scope="col">이메일</th><th scope="col">상태</th><th scope="col">조치</th></tr></thead>
              <tbody>
                {visibleMembers.map((member) => (
                  <tr key={member.id}>
                    <th scope="row">{member.name}{member.role === 'ADMIN' && ' (관리자)'}</th>
                    <td>{member.email}</td><td>{statuses[member.status]}</td>
                    <td>{member.role === 'ADMIN' || member.status === 'WITHDRAWN' ? '—' : (
                      <div className="tf-actions">
                        {([member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', 'WITHDRAWN'] as const).map((status) => (
                          <button key={status} type="button"
                            onClick={() => openConfirmation(member, status)}>{actions[status]}</button>
                        ))}
                      </div>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="tf-panel" aria-labelledby="admin-audit-title">
        <h2 id="admin-audit-title">회원 조치 감사 기록</h2>
        <div className="tf-admin-controls">
          <label>변경 후 상태<select value={auditFilter} onChange={(event) => {
            setAuditFilter(event.target.value as Status | '')
            setAuditCursors([])
          }}>
            <option value="">전체</option>
            {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <button type="button" onClick={() => { setAuditCursors([]); audit.retry() }}>최신 기록 새로고침</button>
        </div>
        {audit.loading && <p className="tf-status" role="status">감사 기록을 불러오는 중입니다.</p>}
        {audit.error && <LoadError message="감사 기록을 불러오지 못했습니다." onRetry={audit.retry} />}
        {audit.data?.entries.length === 0 && <p role="status">
          {auditFilter ? '선택한 상태에 해당하는 감사 기록이 없습니다.' : '기록된 회원 조치가 없습니다.'}
        </p>}
        {audit.data && audit.data.entries.length > 0 && (
          <div className="tf-admin-table" role="region" aria-labelledby="admin-audit-title" tabIndex={0}>
            <table className="tf-admin-users" aria-labelledby="admin-audit-title">
              <thead><tr><th scope="col">처리 일시</th><th scope="col">처리자</th><th scope="col">대상 회원</th><th scope="col">상태 변경</th><th scope="col">사유</th></tr></thead>
              <tbody>{audit.data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td><time dateTime={entry.occurredAt}>{dateFormat.format(new Date(entry.occurredAt))}</time></td>
                  <td>{memberLabel(entry.actorId)}</td>
                  <td>{memberLabel(entry.targetId)}</td>
                  <td>{statuses[entry.fromStatus]} → {statuses[entry.toStatus]}</td>
                  <td className="tf-admin-reason">{entry.reason}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <nav className="tf-admin-pagination" aria-label="감사 기록 페이지">
          <button type="button" disabled={!cursor || audit.loading}
            onClick={() => setAuditCursors(auditCursors.slice(0, -1))}>더 최신</button>
          <span aria-live="polite">{auditCursors.length + 1}페이지</span>
          <button type="button" disabled={!nextCursor}
            onClick={() => { if (nextCursor) setAuditCursors([...auditCursors, nextCursor]) }}>더 이전</button>
        </nav>
      </section>
      {confirmation && (
        <dialog ref={dialog} className="tf-panel tf-admin-dialog" aria-labelledby="admin-dialog-title"
          onClose={() => setConfirmation(null)} onCancel={(event) => { if (saving) event.preventDefault() }}>
          <form onSubmit={changeStatus}>
            <h2 id="admin-dialog-title">{actions[confirmation.status]} 확인</h2>
            <p>{confirmation.member.name} ({confirmation.member.email})</p>
            {confirmation.status === 'WITHDRAWN' && <p>로그인과 기존 세션을 차단합니다. 협업 기록은 유지되며 관리자 화면에서 되돌릴 수 없습니다.</p>}
            {confirmation.status === 'SUSPENDED' && <p>로그인과 기존 세션을 즉시 차단합니다.</p>}
            <label htmlFor="admin-reason">사유</label>
            <textarea id="admin-reason" name="reason" rows={3} maxLength={300} required readOnly={saving}
              placeholder="민감한 개인정보 없이 조치 사유를 입력해 주세요." />
            {dialogError && <p className="tf-error" role="alert">{dialogError}</p>}
            <div className="tf-actions">
              <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>취소</button>
              <button className="tf-primary" type="submit" disabled={saving}>
                {saving ? '처리 중…' : actions[confirmation.status]}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </main>
  )
}
