export type Task = {
  id: number
  projectId: number
  title: string
  description: string
  status: string
  priority: string | null
  dueDate: string | null
  assigneeId?: number | null
}

export class TaskListError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`작업 카드 조회 실패 (HTTP ${status})`)
    this.status = status
  }
}

export async function loadProjectTasks(projectId: number, signal?: AbortSignal): Promise<Task[]> {
  const timeout = AbortSignal.timeout(15_000)
  const response = await fetch(`/api/tasks/project/${projectId}`, {
    credentials: 'include',
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) throw new TaskListError(response.status)
  return response.json() as Promise<Task[]>
}

export function getProjectStreamLimit() {
  const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  const protocol = navigation?.nextHopProtocol
  return protocol === 'h2' || protocol?.startsWith('h3') ? Infinity : 2
}

export function startProjectTaskSync(
  projectId: number,
  streaming: boolean,
  callbacks: {
    onTasks: (tasks: Task[]) => void
    onCommentChange: (taskId: number) => void
    onOpen: () => void
    onError: (failed: boolean) => void
    onAccessError: (status: number) => void
  },
) {
  const controller = new AbortController()
  const { signal } = controller
  let source: EventSource | undefined
  let refreshTimer: number | undefined
  let reconnectTimer: number | undefined
  let openTimer: number | undefined
  let pollingTimer: number | undefined
  let retryDelay = 1000
  let refreshing = false
  let pending = false
  let connectionFailed = false
  let taskFetchFailed = false
  let localRevision = 0

  function scheduleRefresh(delay = 80) {
    if (signal.aborted) return
    pending = true
    if (refreshing || refreshTimer !== undefined) return
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined
      void refresh()
    }, delay)
  }

  async function refresh() {
    pending = false
    refreshing = true
    let retry = false
    const revision = localRevision

    try {
      const tasks = await loadProjectTasks(projectId, signal)
      if (signal.aborted) return
      if (revision === localRevision) callbacks.onTasks(tasks)
      taskFetchFailed = false
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof TaskListError && [401, 403, 404].includes(error.status)) {
        close()
        callbacks.onAccessError(error.status)
        return
      }
      taskFetchFailed = true
      retry = true
    } finally {
      refreshing = false
      if (!signal.aborted) {
        callbacks.onError(connectionFailed || taskFetchFailed)
        if (pending || retry) scheduleRefresh(retry ? 5000 : 80)
      }
    }
  }

  function connect() {
    if (signal.aborted) return
    const connection = new EventSource(`/api/projects/${projectId}/events`)
    source = connection

    function reconnect() {
      if (signal.aborted || source !== connection) return
      window.clearTimeout(openTimer)
      connection.close()
      source = undefined
      connectionFailed = true
      callbacks.onError(true)
      scheduleRefresh()
      reconnectTimer = window.setTimeout(connect, retryDelay + Math.random() * 500)
      retryDelay = Math.min(retryDelay * 2, 30_000)
    }

    openTimer = window.setTimeout(reconnect, 25_000)
    connection.addEventListener('open', () => {
      if (signal.aborted || source !== connection) return
      window.clearTimeout(openTimer)
      connectionFailed = false
      retryDelay = 1000
      callbacks.onOpen()
      callbacks.onError(taskFetchFailed)
      scheduleRefresh()
    })
    connection.addEventListener('task-changed', (event: MessageEvent<string>) => {
      if (source !== connection) return
      try {
        const change = JSON.parse(event.data) as { projectId?: number } | null
        if (change?.projectId === projectId) scheduleRefresh()
      } catch {
        return
      }
    })
    connection.addEventListener('comment-changed', (event: MessageEvent<string>) => {
      if (signal.aborted || source !== connection) return
      try {
        const change = JSON.parse(event.data) as { projectId?: number; taskId?: number } | null
        if (change?.projectId === projectId && typeof change.taskId === 'number') {
          callbacks.onCommentChange(change.taskId)
        }
      } catch {
        return
      }
    })
    connection.addEventListener('error', reconnect)
  }

  function close() {
    controller.abort()
    source?.close()
    window.clearTimeout(refreshTimer)
    window.clearTimeout(reconnectTimer)
    window.clearTimeout(openTimer)
    window.clearInterval(pollingTimer)
  }

  if (streaming) connect()
  else {
    scheduleRefresh()
    pollingTimer = window.setInterval(() => scheduleRefresh(), 12_000)
  }

  return {
    streaming,
    invalidate: () => {
      localRevision += 1
      scheduleRefresh()
    },
    close,
  }
}
