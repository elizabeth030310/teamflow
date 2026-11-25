import { startVisiblePolling } from './visiblePolling.ts'

type NotificationDetails = {
  id: number
  projectId: number
  actorName?: string | null
  parentCommentId?: number | null
  replyCommentId?: number | null
  dueDate: string | null
  createdAt: string
  read: boolean
}

export type TaskNotification = NotificationDetails & {
  taskId: number
  taskTitle: string
  kind: 'ASSIGNMENT' | 'COMMENT' | 'COMMENT_REPLY' | 'DUE_SOON' | 'OVERDUE'
}

export type NotificationItem = TaskNotification | (NotificationDetails & {
  kind: 'PROJECT_INVITATION'
  projectName: string
})

export type NotificationInbox = {
  items: NotificationItem[]
  unreadCount: number
  hasMore: boolean
}

export function startNotificationSync(
  load: (signal: AbortSignal) => Promise<NotificationInbox>,
  receive: (inbox: NotificationInbox) => void,
  fail: (error: unknown) => void,
) {
  const controller = new AbortController()
  const source = import.meta.env?.VITE_TEAMFLOW_NODE_API === '1' ? null : new EventSource('/api/notifications/events')
  let running = false
  let pending = false

  async function refresh() {
    if (controller.signal.aborted) return
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      const inbox = await load(controller.signal)
      if (!controller.signal.aborted && !pending) receive(inbox)
    } catch (error) {
      if (!controller.signal.aborted && !pending) fail(error)
    } finally {
      running = false
      if (pending) {
        pending = false
        void refresh()
      }
    }
  }

  source?.addEventListener('open', refresh)
  source?.addEventListener('notifications-changed', refresh)
  const stopPolling = source ? (() => {
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  })() : startVisiblePolling(refresh, 30_000)
  void refresh()

  return {
    refresh,
    close() {
      controller.abort()
      source?.close()
      stopPolling()
    },
  }
}
