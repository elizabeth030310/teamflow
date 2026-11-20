import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createSearchMatcher } from './search'

type Status = 'ACTIVE' | 'SUSPENDED' | 'WITHDRAWN'
type Member = { id: number; name: string; email: string; role: 'ADMIN' | 'USER'; status: Status; revision: number }
type AuditEntry = {
  id: number; actorId: number; targetId: number; fromStatus: Status; toStatus: Status; reason: string; occurredAt: string
}
type Confirmation = { member: Member; status: Status }

const statuses: Record<Status, string> = { ACTIVE: '정상', SUSPENDED: '정지', WITHDRAWN: '강제탈퇴' }
const actions: Record<Status, string> = { ACTIVE: '정지 해제', SUSPENDED: '정지', WITHDRAWN: '강제탈퇴' }

export default function AdminDashboard({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<{ members: Member[]; audit: AuditEntry[] } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Status | ''>('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [dialogError, setDialogError] = useState('')
  const [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }
    async function loadMembers() {
      try {
        const [members, audit] = await Promise.all([
          fetch('/api/admin/users', options),
          fetch('/api/admin/audit', options),
        ])
        if (controller.signal.aborted) return
        if ([members, audit].some(({ status }) => status === 401 || status === 403)) {
          onSessionExpired()
          return
        }
        if (!members.ok || !audit.ok) throw new Error('Could not load member management')
        const next = { members: await members.json() as Member[], audit: await audit.json() as AuditEntry[] }
        if (!controller.signal.aborted) setData(next)
      } catch {
        if (!controller.signal.aborted) setError('회원 목록과 감사 기록을 불러오지 못했습니다.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadMembers()
    return () => controller.abort()
  }, [attempt, onSessionExpired])

  useEffect(() => {
    if (confirmation) dialog.current?.showModal()
  }, [confirmation])

  function reload() {
    setLoading(true)
    setError('')
    setAttempt((previous) => previous + 1)
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
  const members = data?.members.filter((member) =>
    (!filter || filter === member.status) && (matches(member.name) || matches(member.email))) ?? []

  return (
    <main className="tf-app tf-admin" aria-labelledby="admin-title">
      <h1 id="admin-title">회원 관리</h1>
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
        {notice && <p className="tf-status" role="status">{notice}</p>}
        {loading && <p className="tf-status" role="status">회원 정보를 불러오는 중입니다.</p>}
        {error && <p className="tf-error" role="alert">{error} <button type="button" onClick={reload}>다시 시도</button></p>}
        {data && (
          <div className="tf-admin-table">
            <table className="tf-admin-users" aria-labelledby="admin-members-title">
              <thead><tr><th scope="col">이름</th><th scope="col">이메일</th><th scope="col">상태</th><th scope="col">조치</th></tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <th scope="row">{member.name}{member.role === 'ADMIN' && ' (관리자)'}</th>
                    <td>{member.email}</td><td>{statuses[member.status]}</td>
                    <td>{member.role === 'ADMIN' || member.status === 'WITHDRAWN' ? '—' : (
                      <div className="tf-actions">
                        {([member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', 'WITHDRAWN'] as const).map((status) => (
                          <button key={status} type="button" disabled={loading || Boolean(error)}
                            onClick={() => openConfirmation(member, status)}>{actions[status]}</button>
                        ))}
                      </div>
                    )}</td>
                  </tr>
                ))}
                {members.length === 0 && <tr><td colSpan={4}>조건에 맞는 회원이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="tf-panel" aria-labelledby="admin-audit-title">
        <h2 id="admin-audit-title">최근 감사 기록</h2>
        {data && (data.audit.length === 0 ? <p>기록된 회원 조치가 없습니다.</p> : (
          <div className="tf-admin-table">
            <table className="tf-admin-users" aria-labelledby="admin-audit-title">
              <thead><tr><th scope="col">처리 일시</th><th scope="col">처리자 / 대상</th><th scope="col">상태 변경</th><th scope="col">사유</th></tr></thead>
              <tbody>{data.audit.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.occurredAt).toLocaleString('ko-KR')}</td>
                  <td>#{entry.actorId} / #{entry.targetId} {data.members.find(({ id }) => id === entry.targetId)?.name}</td>
                  <td>{statuses[entry.fromStatus]} → {statuses[entry.toStatus]}</td><td>{entry.reason}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ))}
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
