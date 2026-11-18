import { useEffect, useRef, useState } from 'react'
import { startNotificationSync } from './notificationSync'
import type { NotificationInbox, NotificationItem } from './notificationSync'

const labels = {
  ASSIGNMENT: '작업 배정',
  COMMENT: '새 댓글',
  DUE_SOON: '마감 임박',
  OVERDUE: '마감 지남',
}

const timestamp = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

export default function NotificationCenter({ onOpenTask, onSessionExpired }: {
  onOpenTask: (item: NotificationItem) => Promise<void>
  onSessionExpired: () => void
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [snapshot, setSnapshot] = useState<{ page: number; inbox: NotificationInbox }>()
  const [loadingError, setLoadingError] = useState(false)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const sync = useRef<ReturnType<typeof startNotificationSync> | null>(null)

  useEffect(() => {
    const subscription = startNotificationSync(async (signal) => {
      const response = await fetch(`/api/notifications?page=${page}`, {
        credentials: 'include',
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      })
      if (!response.ok) throw new Error(String(response.status))
      return response.json() as Promise<NotificationInbox>
    }, (inbox) => {
      setSnapshot({ page, inbox })
      setLoadingError(false)
    }, (error) => {
      if (error instanceof Error && error.message === '401') onSessionExpired()
      else setLoadingError(true)
    })
    sync.current = subscription
    return () => {
      subscription.close()
      sync.current = null
    }
  }, [onSessionExpired, page])

  const inbox = snapshot?.page === page ? snapshot.inbox : undefined
  const unreadCount = snapshot?.inbox.unreadCount

  async function markRead(item?: NotificationItem, navigate = false) {
    setBusy(true)
    setActionError('')
    try {
      if (!item?.read) {
        const path = item ? `${item.id}/read` : 'read-all'
        const response = await fetch(`/api/notifications/${path}`, {
          method: 'PATCH',
          credentials: 'include',
          signal: AbortSignal.timeout(15_000),
        })
        if (response.status === 401) {
          onSessionExpired()
          return
        }
        if (response.status === 404 && item) {
          setActionError('이 알림의 작업을 더 이상 열 수 없습니다.')
          return
        }
        if (!response.ok) {
          setActionError('읽음 상태를 저장하지 못했습니다.')
          return
        }
      }
      if (item && navigate) {
        await onOpenTask(item)
        setOpen(false)
      }
    } catch {
      setActionError(navigate ? '작업을 열지 못했습니다. 다시 시도해 주세요.' : '읽음 상태를 저장하지 못했습니다.')
    } finally {
      void sync.current?.refresh()
      setBusy(false)
    }
  }

  return (
    <div className="tf-notifications" onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        setOpen(false)
        trigger.current?.focus()
      }
    }}>
      <button ref={trigger} type="button" className="tf-notification-bell" aria-expanded={open}
        aria-controls={open ? 'notification-inbox' : undefined}
        aria-label={unreadCount === undefined ? '알림' : `알림, 읽지 않은 알림 ${unreadCount}개`}
        onClick={() => {
          setOpen(!open)
          if (!open) void sync.current?.refresh()
        }}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" />
        </svg>
        {!!unreadCount && <span aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <section id="notification-inbox" aria-labelledby="notification-title">
          <div className="tf-notification-heading">
            <h2 id="notification-title">알림</h2>
            <button type="button" disabled={!unreadCount || busy} onClick={() => void markRead()}>
              모두 읽음
            </button>
          </div>
          {loadingError && <div className="tf-status" role="status">
            알림을 불러오지 못했습니다.{' '}
            <button type="button" onClick={() => void sync.current?.refresh()}>다시 시도</button>
          </div>}
          {actionError && <p className="tf-error" role="alert">{actionError}</p>}
          {!inbox && !loadingError && <p className="tf-status" role="status">알림을 불러오는 중입니다.</p>}
          {inbox && inbox.items.length === 0 && <p className="tf-empty">표시할 알림이 없습니다.</p>}
          <ul>
            {inbox?.items.map((item) => (
              <li key={item.id} data-unread={!item.read}>
                <button type="button" className="tf-notification-target" disabled={busy}
                  onClick={() => void markRead(item, true)}>
                  <span>{labels[item.kind]}{item.dueDate && ` · ${item.dueDate}`}</span>
                  <strong>{item.taskTitle}</strong>
                  <time dateTime={item.createdAt}>{timestamp.format(new Date(item.createdAt))}</time>
                </button>
                {!item.read && <button type="button" disabled={busy}
                  aria-label={`${labels[item.kind]}, ${item.taskTitle} 읽음 처리`}
                  onClick={() => void markRead(item)}>읽음</button>}
              </li>
            ))}
          </ul>
          {(page > 0 || inbox?.hasMore) && (
            <div className="tf-notification-heading">
              <button type="button" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>이전</button>
              <button type="button" disabled={busy || !inbox?.hasMore} onClick={() => setPage(page + 1)}>다음</button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
