export type NotificationItem = {
  id: number
  projectId: number
  taskId: number
  taskTitle: string
  kind: 'ASSIGNMENT' | 'COMMENT' | 'DUE_SOON' | 'OVERDUE'
  dueDate: string | null
  createdAt: string
  read: boolean
}

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
  const source = new EventSource('/api/notifications/events')
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

  source.addEventListener('open', refresh)
  source.addEventListener('notifications-changed', refresh)
  const timer = setInterval(refresh, 30_000)
  void refresh()

  return {
    refresh,
    close() {
      controller.abort()
      source.close()
      clearInterval(timer)
    },
  }
}
