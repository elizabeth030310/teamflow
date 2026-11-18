import type { Task } from './projectTaskSync.ts'
import { getDueDateAlert } from './taskDates.ts'

export const columns = [
  { status: 'TODO', label: '할 일', color: '#64748b' },
  { status: 'IN_PROGRESS', label: '진행 중', color: '#2563eb' },
  { status: 'DONE', label: '완료', color: '#15803d' },
]

export const priorities = [
  { value: 'HIGH', label: '높음', color: '#dc2626', background: '#fee2e2' },
  { value: 'MEDIUM', label: '보통', color: '#b45309', background: '#fef3c7' },
  { value: 'LOW', label: '낮음', color: '#15803d', background: '#dcfce7' },
]

export const getPriority = (priority: string | null) =>
  priorities.find((item) => item.value === priority) ?? priorities[1]

export function getProjectStats(tasks: readonly Task[], today: number) {
  const statusCounts = new Map<string, number>()
  const priorityCounts = new Map<string, number>()
  const assigneeCounts = new Map<number | null, number>()
  const deadlineCounts = { overdue: 0, today: 0, upcoming: 0 }

  for (const task of tasks) {
    const priority = getPriority(task.priority).value
    const assignee = task.assigneeId ?? null
    const deadline = getDueDateAlert(task, today)
    statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1)
    priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1)
    assigneeCounts.set(assignee, (assigneeCounts.get(assignee) ?? 0) + 1)
    if (deadline) deadlineCounts[deadline] += 1
  }

  const total = tasks.length
  const completed = statusCounts.get('DONE') ?? 0
  const otherStatuses = total - columns.reduce(
    (count, { status }) => count + (statusCounts.get(status) ?? 0), 0,
  )

  return {
    total,
    completed,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    statusCounts,
    otherStatuses,
    priorityCounts,
    assigneeCounts,
    deadlineCounts,
  }
}
