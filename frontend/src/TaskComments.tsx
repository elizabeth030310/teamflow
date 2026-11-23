import { apiFetch } from './apiFetch.ts'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { findCommentFocus, groupTaskComments, isTaskComment, parseTaskComments } from './taskCommentThreads'
import type { CommentFocusTarget, TaskComment } from './taskCommentThreads'

type InlineDraft = { mode: 'reply' | 'edit'; commentId: number; content: string }
type CommentAction =
  | { method: 'POST'; content: string; parentCommentId?: number }
  | { method: 'PATCH'; commentId: number; content: string }
  | { method: 'DELETE'; commentId: number }

const maxCommentLength = 1000
const commentDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

function canSubmit(content: string) {
  return !!content.trim() && Array.from(content.trim()).length <= maxCommentLength
}

function CommentForm({ id, label, submitLabel, value, busy, saving, onChange, onSubmit, onCancel }: {
  id: string
  label: string
  submitLabel: string
  value: string
  busy: boolean
  saving: boolean
  onChange: (value: string) => void
  onSubmit: (content: string) => void
  onCancel?: () => void
}) {
  const tooLong = Array.from(value.trim()).length > maxCommentLength

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!busy && canSubmit(value)) onSubmit(value.trim())
  }

  return (
    <form onSubmit={submit} aria-busy={saving}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
        aria-invalid={tooLong || undefined}
        aria-describedby={tooLong ? `${id}-limit` : undefined}
        rows={2}
      />
      {tooLong && <p id={`${id}-limit`} role="status">댓글은 1,000자까지 입력할 수 있습니다.</p>}
      <div className="tf-comment-actions">
        <button type="submit" className="tf-primary" disabled={busy || !canSubmit(value)}>
          {saving ? '저장 중…' : submitLabel}
        </button>
        {onCancel && <button type="button" disabled={busy} onClick={onCancel}>취소</button>}
      </div>
    </form>
  )
}

function CommentRow({ comment, taskId, userId, inlineDraft, activeAction, openInlineDraft, setInlineDraft, cancelDraft, saveComment }: {
  comment: TaskComment
  taskId: number
  userId: number
  inlineDraft: InlineDraft | null
  activeAction: CommentAction | null
  openInlineDraft: (mode: InlineDraft['mode'], comment: TaskComment) => void
  setInlineDraft: (draft: InlineDraft) => void
  cancelDraft: () => void
  saveComment: (action: CommentAction) => Promise<void>
}) {
  const busy = activeAction !== null
  if (comment.deleted) return <p className="tf-comment-deleted">삭제된 댓글입니다</p>
  const inline = inlineDraft?.commentId === comment.id ? inlineDraft : null
  const isReply = comment.parentCommentId != null
  const isAuthor = comment.authorId === userId
  const deleting = activeAction?.method === 'DELETE' && activeAction.commentId === comment.id

  function renderInlineForm(mode: InlineDraft['mode'], value: string) {
    const editing = mode === 'edit'
    const label = editing ? (isReply ? '답글 수정' : '댓글 수정') : '답글 작성'
    const saving = editing
      ? activeAction?.method === 'PATCH' && activeAction.commentId === comment.id
      : activeAction?.method === 'POST' && activeAction.parentCommentId === comment.id

    return (
      <CommentForm
        id={`comment-${mode}-${taskId}-${comment.id}`}
        label={label}
        submitLabel={editing ? '수정 저장' : '답글 등록'}
        value={value}
        busy={busy}
        saving={saving}
        onChange={(content) => setInlineDraft({ mode, commentId: comment.id, content })}
        onSubmit={(content) => void saveComment(editing
          ? { method: 'PATCH', commentId: comment.id, content }
          : { method: 'POST', parentCommentId: comment.id, content })}
        onCancel={cancelDraft}
      />
    )
  }

  return (
    <>
      <p>
        {isReply && (
          <span className="tf-comment-reply-label"><span aria-hidden="true">↳</span> 답글</span>
        )}
        <strong>{comment.authorName}</strong>{' '}
        <time dateTime={comment.createdAt}>{commentDate.format(new Date(comment.createdAt))}</time>
      </p>
      {inline?.mode === 'edit' ? renderInlineForm('edit', inline.content) : <p>{comment.content}</p>}
      <div className="tf-comment-actions">
        {!isReply && (
          <button type="button" disabled={busy || inlineDraft !== null} onClick={() => openInlineDraft('reply', comment)}>
            답글 작성
          </button>
        )}
        {isAuthor && (
          <>
            <button type="button" disabled={busy || inlineDraft !== null} onClick={() => openInlineDraft('edit', comment)}>
              {isReply ? '답글 수정' : '댓글 수정'}
            </button>
            <button
              type="button"
              className="tf-danger"
              disabled={busy || inline !== null}
              onClick={() => void saveComment({ method: 'DELETE', commentId: comment.id })}
            >
              {deleting ? '삭제 중…' : isReply ? '답글 삭제' : '댓글 삭제'}
            </button>
          </>
        )}
      </div>
      {inline?.mode === 'reply' && (
        <div className="tf-comment-branch">{renderInlineForm('reply', inline.content)}</div>
      )}
    </>
  )
}

export default function TaskComments({ taskId, userId, revision, focusTarget, connectionRevision, onSessionExpired }: {
  taskId: number
  userId: number
  revision: number
  focusTarget?: CommentFocusTarget
  connectionRevision: number
  onSessionExpired: () => void
}) {
  const [comments, setComments] = useState<TaskComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [inlineDraft, setInlineDraft] = useState<InlineDraft | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
  const [loadError, setLoadError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [activeAction, setActiveAction] = useState<CommentAction | null>(null)
  const [localRevision, setLocalRevision] = useState(0)
  const mutation = useRef<AbortController | null>(null)
  const handledFocus = useRef<CommentFocusTarget | undefined>(undefined)
  const [readyFocus, setReadyFocus] = useState<CommentFocusTarget>()
  const endpoint = `/api/tasks/${taskId}/comments`
  const busy = activeAction !== null
  const { parents, repliesByParent } = groupTaskComments(comments ?? [])

  function setThreadCollapsed(commentId: number, isCollapsed: boolean) {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (isCollapsed) next.add(commentId)
      else next.delete(commentId)
      return next
    })
  }

  function openInlineDraft(mode: InlineDraft['mode'], comment: TaskComment) {
    setMutationError('')
    setInlineDraft({ mode, commentId: comment.id, content: mode === 'edit' ? comment.content ?? '' : '' })
    if (mode === 'reply') setThreadCollapsed(comment.id, false)
  }

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
        const list = parseTaskComments(await response.json())
        if (controller.signal.aborted) return
        if (list === null) {
          setLoadError('서버 응답에서 댓글과 답글의 관계를 확인할 수 없습니다.')
          return
        }
        setComments(list)
        setLoadError('')
        if (focusTarget && handledFocus.current !== focusTarget) {
          setThreadCollapsed(focusTarget.parentCommentId, false)
          setReadyFocus(focusTarget)
        }
      } catch {
        if (!controller.signal.aborted) setLoadError('댓글을 불러오지 못했습니다.')
      }
    }

    void loadComments()
    return () => controller.abort()
  }, [endpoint, revision, focusTarget, connectionRevision, localRevision, onSessionExpired])

  useEffect(() => {
    if (!comments || !focusTarget || readyFocus !== focusTarget || handledFocus.current === focusTarget) return
    const commentId = findCommentFocus(comments, focusTarget)
    const target = document.getElementById(commentId === undefined
      ? `task-comments-${taskId}`
      : `task-comment-${taskId}-${commentId}`)
    if (!target) return
    handledFocus.current = focusTarget
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [comments, focusTarget, readyFocus, taskId])

  async function saveComment(action: CommentAction) {
    if (mutation.current || comments === null) return
    if (action.method !== 'DELETE' && !canSubmit(action.content)) return
    const controller = new AbortController()
    mutation.current = controller
    setActiveAction(action)
    setMutationError('')
    const body = action.method === 'POST'
      ? { content: action.content, parentCommentId: action.parentCommentId }
      : action.method === 'PATCH' ? { content: action.content } : undefined

    try {
      const response = await apiFetch(action.method === 'POST' ? endpoint : `${endpoint}/${action.commentId}`, {
        method: action.method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      if (controller.signal.aborted) return
      if (response.status === 401) {
        onSessionExpired()
        return
      }
      if (response.status === 403 || response.status === 404) {
        setMutationError(response.status === 403
          ? '이 작업을 수행할 권한이 없습니다.'
          : '댓글을 찾을 수 없거나 이 카드에 접근할 수 없습니다.')
        return
      }
      if (!response.ok) throw new Error()
      if (action.method === 'POST' && action.parentCommentId !== undefined) {
        const saved: unknown = await response.json().catch(() => null)
        if (controller.signal.aborted) return
        setInlineDraft(null)
        if (!isTaskComment(saved) || saved.parentCommentId !== action.parentCommentId) {
          setMutationError('서버에서 답글 연결을 확인하지 못했습니다. 다시 등록하기 전에 댓글 목록을 확인해 주세요.')
        }
      } else if (action.method === 'POST') setDraft('')
      else if (action.method !== 'DELETE') setInlineDraft(null)
    } catch {
      if (!controller.signal.aborted) {
        const failure = action.method === 'PATCH'
          ? '댓글을 수정하지 못했습니다.'
          : action.method === 'DELETE'
            ? '댓글을 삭제하지 못했습니다.'
            : action.parentCommentId === undefined ? '댓글을 등록하지 못했습니다.' : '답글을 등록하지 못했습니다.'
        setMutationError(failure)
      }
    } finally {
      mutation.current = null
      if (!controller.signal.aborted) {
        setActiveAction(null)
        setLocalRevision((previous) => previous + 1)
      }
    }
  }

  const inlineTarget = inlineDraft && comments?.find((comment) => comment.id === inlineDraft.commentId && !comment.deleted)
  const unavailableDraft = inlineDraft && comments !== null && !inlineTarget
  const rowProps = {
    taskId, userId, inlineDraft, activeAction, openInlineDraft, setInlineDraft, saveComment,
    cancelDraft: () => {
      setInlineDraft(null)
      setMutationError('')
    },
  }
  return (
    <section className="tf-task-comments" id={`task-comments-${taskId}`} tabIndex={-1}
      aria-labelledby={`comments-title-${taskId}`}>
      <h5 id={`comments-title-${taskId}`}>댓글</h5>
      {loadError && (
        <p className="tf-error" role="alert">
          {loadError}{' '}
          <button type="button" onClick={() => setLocalRevision((previous) => previous + 1)}>다시 불러오기</button>
        </p>
      )}
      {comments === null && !loadError && <p role="status">댓글을 불러오는 중…</p>}
      {mutationError && <p className="tf-error" role="alert">{mutationError}</p>}
      {unavailableDraft && (
        <p role="status">
          대상 댓글을 사용할 수 없습니다.{' '}
          <button type="button" onClick={() => setInlineDraft(null)}>작성 취소</button>
        </p>
      )}
      {comments?.length === 0 && <p>아직 댓글이 없습니다.</p>}
      {!!comments?.length && (
        <ul>
          {parents.map((comment) => {
            const replies = repliesByParent.get(comment.id) ?? []
            const expanded = !collapsed.has(comment.id) || inlineTarget?.parentCommentId === comment.id
            const repliesId = `comment-replies-${taskId}-${comment.id}`

            return (
              <li key={comment.id} id={`task-comment-${taskId}-${comment.id}`} tabIndex={-1}>
                <CommentRow comment={comment} {...rowProps} />
                {replies.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="tf-comment-toggle"
                      aria-expanded={expanded}
                      aria-controls={repliesId}
                      disabled={inlineTarget?.parentCommentId === comment.id}
                      onClick={() => setThreadCollapsed(comment.id, expanded)}
                    >
                      답글 {replies.length}개 {expanded ? '접기' : '펼치기'}
                    </button>
                    <ul className="tf-comment-branch tf-comment-replies" id={repliesId} hidden={!expanded}>
                      {replies.map((reply) => (
                        <li key={reply.id} id={`task-comment-${taskId}-${reply.id}`} tabIndex={-1}>
                          <CommentRow comment={reply} {...rowProps} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {comments !== null && (
        <CommentForm
          id={`comment-draft-${taskId}`}
          label="댓글 작성"
          submitLabel="댓글 등록"
          value={draft}
          busy={busy}
          saving={activeAction?.method === 'POST' && activeAction.parentCommentId === undefined}
          onChange={setDraft}
          onSubmit={(content) => void saveComment({ method: 'POST', content })}
        />
      )}
    </section>
  )
}
