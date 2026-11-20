export const dashboardHref = '#/'
export const myTasksHref = '#/my-tasks'
export const adminHref = '#/admin'

export const projectTabs = [
  { id: 'kanban', label: '칸반' },
  { id: 'calendar', label: '캘린더' },
  { id: 'stats', label: '통계' },
  { id: 'members', label: '멤버' },
] as const

type ProjectTab = typeof projectTabs[number]['id']

export function projectHref(projectId: number, taskId?: number) {
  return taskId === undefined ? `#/projects/${projectId}` : `#/projects/${projectId}/tasks/${taskId}`
}

export function projectTabHref(projectId: number, tab: ProjectTab) {
  return tab === 'kanban' ? projectHref(projectId) : `${projectHref(projectId)}/${tab}`
}

export function readWorkspaceRoute(hash: string) {
  if (hash === myTasksHref) return { page: 'my-tasks', projectId: null, taskId: null } as const

  const dashboard = { page: 'dashboard', projectId: null, taskId: null } as const
  const match = /^#\/projects\/([1-9]\d*)(?:\/tasks\/([1-9]\d*)|\/([a-z]+))?$/.exec(hash)
  if (!match) return dashboard

  const projectId = Number(match[1])
  const taskId = match[2] ? Number(match[2]) : null
  const tab = projectTabs.find(({ id }) => id === (match[3] ?? 'kanban'))?.id
  if (!tab || !Number.isSafeInteger(projectId) || (taskId !== null && !Number.isSafeInteger(taskId))) {
    return dashboard
  }

  return { page: 'project', projectId, taskId, tab } as const
}
