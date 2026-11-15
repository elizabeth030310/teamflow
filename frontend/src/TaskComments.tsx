import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

type TaskComment = {
  id: number
  authorId: number
  authorName: string
  content: string
  createdAt: string
}

const maxCommentLength = 1000
const commentDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

export default function TaskComments({ taskId, userId, revision, connectionRevision, onSessionExpired }: {
  taskId: number
  userId: number
  revision: number
  connectionRevision: number
  onSessionExpired: () => void
}) {
  const [comments, setComments] = useState<TaskComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [busy, setBusy] = useState(false)
  const [localRevision, setLocalRevision] = useState(0)
  const mutation = useRef<AbortController | null>(null)
  const endpoint = `/api/tasks/${taskId}/comments`
  const content = draft.trim()
  const tooLong = Array.from(content).length > maxCommentLength

  useEffect(() => {
    const interval = window.setInterval(() => setLocalRevision((previous) => previous + 1), 12_000)
    return () => {
      window.clearInterval(interval)
      mutation.current?.abort()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadComments() {
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
          setComments(null)
          setLoadError('이 카드의 댓글에 접근할 수 없습니다.')
          return
        }
        if (!response.ok) throw new Error()
        const list = await response.json() as TaskComment[]
        if (controller.signal.aborted) return
        setComments(list)
        setLoadError('')
      } catch {
        if (!controller.signal.aborted) setLoadError('댓글을 불러오지 못했습니다.')
      }
    }

    void loadComments()
    return () => controller.abort()
  }, [endpoint, revision, connectionRevision, localRevision, onSessionExpired])

  async function saveComment(commentId?: number) {
    if (mutation.current || comments === null || (commentId === undefined && (!content || tooLong))) return
    const controller = new AbortController()
    mutation.current = controller
    setBusy(true)
    setMutationError('')
    const creating = commentId === undefined

    try {
      const response = await fetch(creating ? endpoint : `${endpoint}/${commentId}`, {
        method: creating ? 'POST' : 'DELETE',
        credentials: 'include',
        headers: creating ? { 'Content-Type': 'application/json' } : undefined,
        body: creating ? JSON.stringify({ content }) : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      if (controller.signal.aborted) return
      if (response.status === 401) {
        onSessionExpired()
        return
      }
      if (!response.ok) throw new Error()
      if (creating) setDraft('')
    } catch {
      if (!controller.signal.aborted) {
        setMutationError(creating ? '댓글을 등록하지 못했습니다.' : '댓글을 삭제하지 못했습니다.')
      }
    } finally {
      mutation.current = null
      if (!controller.signal.aborted) {
        setBusy(false)
        setLocalRevision((previous) => previous + 1)
      }
    }
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void saveComment()
  }

  return (
    <section className="tf-task-comments" id={`task-comments-${taskId}`} aria-labelledby={`comments-title-${taskId}`}>
      <h5 id={`comments-title-${taskId}`}>댓글</h5>
      {loadError && (
        <p className="tf-error" role="alert">
          {loadError}{' '}
          <button type="button" onClick={() => setLocalRevision((previous) => previous + 1)}>다시 불러오기</button>
        </p>
      )}
      {comments === null && !loadError && <p role="status">댓글을 불러오는 중…</p>}
      {comments?.length === 0 && <p>아직 댓글이 없습니다.</p>}
      {!!comments?.length && (
        <ul>
          {comments.map((comment) => (
            <li key={comment.id}>
              <p>
                <strong>{comment.authorName}</strong>{' '}
                <time dateTime={comment.createdAt}>{commentDate.format(new Date(comment.createdAt))}</time>
              </p>
              <p>{comment.content}</p>
              {comment.authorId === userId && (
                <button type="button" className="tf-danger" disabled={busy} onClick={() => void saveComment(comment.id)}>
                  댓글 삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {mutationError && <p className="tf-error" role="alert">{mutationError}</p>}
      {comments !== null && (
        <form onSubmit={submitComment}>
          <label htmlFor={`comment-draft-${taskId}`}>댓글 작성</label>
          <textarea
            id={`comment-draft-${taskId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
            rows={2}
          />
          {tooLong && <p role="status">댓글은 1,000자까지 입력할 수 있습니다.</p>}
          <button type="submit" className="tf-primary" disabled={busy || !content || tooLong}>
            댓글 등록
          </button>
        </form>
      )}
    </section>
  )
}
