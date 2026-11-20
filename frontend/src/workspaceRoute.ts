export const dashboardHref = '#/'
export const myTasksHref = '#/my-tasks'

export function projectHref(projectId: number, taskId?: number) {
  return taskId === undefined ? `#/projects/${projectId}` : `#/projects/${projectId}/tasks/${taskId}`
}

export function readWorkspaceRoute(hash: string) {
  if (hash === myTasksHref) return { page: 'my-tasks', projectId: null, taskId: null } as const

  const dashboard = { page: 'dashboard', projectId: null, taskId: null } as const
  const match = /^#\/projects\/([1-9]\d*)(?:\/tasks\/([1-9]\d*))?$/.exec(hash)
  if (!match) return dashboard

  const projectId = Number(match[1])
  const taskId = match[2] ? Number(match[2]) : null
  if (!Number.isSafeInteger(projectId) || (taskId !== null && !Number.isSafeInteger(taskId))) {
    return dashboard
  }

  return { page: 'project', projectId, taskId } as const
}
