import { apiFetch } from './apiFetch.ts'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

type ChecklistItem = {
  id: number
  title: string
  completed: boolean
}

type ChecklistMutation =
  | { method: 'POST'; body: { title: string } }
  | { method: 'PATCH'; itemId: number; body: { completed: boolean } }
  | { method: 'DELETE'; itemId: number }

const maxTitleLength = 200

export default function TaskChecklist({ taskId, revision, connectionRevision, onSessionExpired, onChanged }: {
  taskId: number
  revision: number
  connectionRevision: number
  onSessionExpired: () => void
  onChanged: () => void
}) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null)
  const [draft, setDraft] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [busy, setBusy] = useState(false)
  const [localRevision, setLocalRevision] = useState(0)
  const mutation = useRef<AbortController | null>(null)
  const endpoint = `/api/tasks/${taskId}/checklist-items`
  const title = draft.trim()
  const tooLong = Array.from(title).length > maxTitleLength

  useEffect(() => {
    const timer = window.setInterval(() => setLocalRevision((previous) => previous + 1), 12_000)
    return () => {
      window.clearInterval(timer)
      mutation.current?.abort()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadItems() {
      try {
        const response = await fetch(endpoint, {
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        })
        if (controller.signal.aborted) return
        if (response.status === 401) {
          onSessionExpired()
          return
        }
        if (response.status === 403 || response.status === 404) {
          setItems(null)
          setLoadError('이 카드의 체크리스트에 접근할 수 없습니다.')
          return
        }
        if (!response.ok) throw new Error()
        const list = await response.json() as ChecklistItem[]
        if (controller.signal.aborted) return
        setItems(list)
        setLoadError('')
      } catch {
        if (!controller.signal.aborted) setLoadError('체크리스트를 불러오지 못했습니다.')
      }
    }

    void loadItems()
    return () => controller.abort()
  }, [endpoint, revision, connectionRevision, localRevision, onSessionExpired])

  async function saveItem(change: ChecklistMutation) {
    if (mutation.current || items === null) return
    const controller = new AbortController()
    mutation.current = controller
    setBusy(true)
    setMutationError('')

    try {
      const url = 'itemId' in change ? `${endpoint}/${change.itemId}` : endpoint
      const response = await apiFetch(url, {
        method: change.method,
        credentials: 'include',
        ...('body' in change ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change.body),
        } : {}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      if (response.status === 401) {
        if (!controller.signal.aborted) onSessionExpired()
        return
      }
      if (!response.ok) throw new Error()
      onChanged()
      if (!controller.signal.aborted && change.method === 'POST') setDraft('')
    } catch {
      if (!controller.signal.aborted) setMutationError('체크리스트 항목을 변경하지 못했습니다.')
    } finally {
      mutation.current = null
      if (!controller.signal.aborted) {
        setBusy(false)
        setLocalRevision((previous) => previous + 1)
      }
    }
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (title && !tooLong) void saveItem({ method: 'POST', body: { title } })
  }

  return (
    <section className="tf-task-checklist" id={`task-checklist-${taskId}`} aria-labelledby={`checklist-title-${taskId}`}>
      <h5 id={`checklist-title-${taskId}`}>체크리스트</h5>
      {loadError && (
        <p className="tf-error" role="alert">
          {loadError}{' '}
          <button type="button" onClick={() => setLocalRevision((previous) => previous + 1)}>다시 불러오기</button>
        </p>
      )}
      {items === null && !loadError && <p role="status">체크리스트를 불러오는 중…</p>}
      {items?.length === 0 && <p>아직 항목이 없습니다.</p>}
      {!!items?.length && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={item.completed}
                  disabled={busy}
                  onChange={(event) => void saveItem({
                    method: 'PATCH', itemId: item.id, body: { completed: event.target.checked },
                  })}
                />
                {item.title}
              </label>
              <button
                type="button"
                className="tf-danger"
                aria-label={`${item.title} 삭제`}
                disabled={busy}
                onClick={() => void saveItem({ method: 'DELETE', itemId: item.id })}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
      {mutationError && <p className="tf-error" role="alert">{mutationError}</p>}
      {items !== null && (
        <form onSubmit={submitItem}>
          <label htmlFor={`checklist-draft-${taskId}`}>새 항목</label>
          <input
            id={`checklist-draft-${taskId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
          />
          {tooLong && <p role="status">체크리스트 항목은 200자까지 입력할 수 있습니다.</p>}
          <button type="submit" className="tf-primary" disabled={busy || !title || tooLong}>추가</button>
        </form>
      )}
    </section>
  )
}
