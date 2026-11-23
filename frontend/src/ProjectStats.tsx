import type { Member } from './Collaboration'
import type { Task } from './projectTaskSync'
import { columns, getProjectStats, priorities } from './projectTaskStats'
import { dueDateAlerts } from './taskDates'
import type { DueDateAlert } from './taskDates'

type ChartRow = { key: string | number; label: string; count: number; color: string }

const deadlineGroups: { key: DueDateAlert; label: string }[] = [
  { key: 'overdue', label: dueDateAlerts.overdue.label },
  { key: 'today', label: dueDateAlerts.today.label },
  { key: 'upcoming', label: '3일 이내' },
]

function Distribution({ title, rows, total }: { title: string; rows: ChartRow[]; total: number }) {
  return (
    <div className="tf-stats-card">
      <h5>{title}</h5>
      {rows.length === 0 ? (
        <p className="tf-stats-caption">표시할 작업이 없습니다.</p>
      ) : (
        <dl className="tf-stats-distribution">
          {rows.map(({ key, label, count, color }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{count}개</dd>
              <dd className="tf-stats-track" aria-hidden="true">
                <span style={{ width: `${total > 0 ? (count / total) * 100 : 0}%`, backgroundColor: color }} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

export default function ProjectStats({
  project, tasks, members, today,
}: {
  project: { id: number; name: string }
  tasks: readonly Task[]
  members: readonly Member[]
  today: number
}) {
  const stats = getProjectStats(tasks, today)
  const memberNames = new Map(members.map(({ userId, name }) => [userId, name]))
  const statusRows = columns.map(({ status, label, color }) => ({
    key: status, label, color, count: stats.statusCounts.get(status) ?? 0,
  }))
  if (stats.otherStatuses > 0) {
    statusRows.push({ key: 'OTHER', label: '기타', color: 'var(--tf-status-other)', count: stats.otherStatuses })
  }
  const priorityRows = priorities.map(({ value, label, color }) => ({
    key: value, label, color, count: stats.priorityCounts.get(value) ?? 0,
  }))
  const assigneeRows = [...stats.assigneeCounts]
    .map(([assignee, count]) => ({
      key: assignee ?? 'unassigned',
      label: assignee === null ? '미배정' : memberNames.get(assignee) ?? `사용자 #${assignee}`,
      count,
      color: assignee === null ? 'var(--tf-status-todo)' : 'var(--tf-status-progress)',
    }))
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label, 'ko'))

  return (
    <section className="tf-project-stats" aria-labelledby={`project-stats-${project.id}`}>
      <h4 id={`project-stats-${project.id}`}>프로젝트 대시보드</h4>
      <p className="tf-stats-caption">전체 프로젝트 작업 기준</p>

      <div className="tf-stats-overview">
        <div className="tf-stats-card">
          <div className="tf-stats-heading">
            <h5>작업 완료율</h5>
            <strong>{stats.completionRate}%</strong>
          </div>
          <progress
            className="tf-project-progress"
            aria-label={`${project.name} 작업 완료율`}
            max={100}
            value={stats.completionRate}
          />
          <p className="tf-stats-caption">전체 {stats.total}개 중 {stats.completed}개 완료</p>
        </div>

        <div className="tf-stats-card">
          <h5>미완료 작업 마감일</h5>
          <dl className="tf-stats-deadlines">
            {deadlineGroups.map(({ key, label }) => (
              <div key={key} style={{ backgroundColor: dueDateAlerts[key].background, color: dueDateAlerts[key].color }}>
                <dt>{label}</dt>
                <dd>{stats.deadlineCounts[key]}개</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="tf-stats-charts">
        <Distribution title="상태별 작업" rows={statusRows} total={stats.total} />
        <Distribution title="우선순위별 작업" rows={priorityRows} total={stats.total} />
        <Distribution title="담당자별 작업" rows={assigneeRows} total={stats.total} />
      </div>
    </section>
  )
}
