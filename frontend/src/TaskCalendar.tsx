import { useState } from 'react'
import type { Task } from './projectTaskSync'
import { dueDateAlerts, getCalendarDate, getMonthWeeks } from './taskDates'
import type { DueDateAlert } from './taskDates'
import ScrollRegion from './ScrollRegion'
import { projectHref } from './workspaceRoute'

const weekdays = ['일', '월', '화', '수', '목', '금', '토']

export default function TaskCalendar({ today, tasks, projectNames, alertsByTaskId, status, onTaskClick }: {
  today: number
  tasks: Task[]
  projectNames: ReadonlyMap<number, string>
  alertsByTaskId: ReadonlyMap<number, DueDateAlert>
  status: 'loading' | 'ready' | 'error'
  onTaskClick: (task: Task) => void
}) {
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null)
  const currentDate = getCalendarDate(today)
  const month = selectedMonth ?? currentDate
  const year = month.getUTCFullYear()
  const monthIndex = month.getUTCMonth()
  const monthLabel = `${year}년 ${monthIndex + 1}월`
  const todayDate = currentDate.toISOString().slice(0, 10)
  const weeks = getMonthWeeks(year, monthIndex)
  const tasksByDate = new Map<string, Task[]>()

  for (const task of tasks) {
    if (!task.dueDate) continue
    const dueTasks = tasksByDate.get(task.dueDate) ?? []
    dueTasks.push(task)
    tasksByDate.set(task.dueDate, dueTasks)
  }

  const hasDueTasks = weeks.some((week) =>
    week.some((entry) => entry && tasksByDate.has(entry.date)))

  function moveMonth(offset: number) {
    setSelectedMonth(new Date(Date.UTC(year, monthIndex + offset, 1)))
  }

  return (
    <section className="tf-panel tf-calendar" aria-labelledby="task-calendar-title">
      <div className="tf-calendar-header">
        <h2 id="task-calendar-title">월간 캘린더</h2>
        <div className="tf-calendar-controls">
          <button type="button" onClick={() => moveMonth(-1)}>이전 달</button>
          <button type="button" onClick={() => setSelectedMonth(null)}>이번 달</button>
          <button type="button" onClick={() => moveMonth(1)}>다음 달</button>
        </div>
      </div>
      <h3 id="task-calendar-month" aria-live="polite">{monthLabel}</h3>
      {status === 'loading' && <p className="tf-status" role="status">작업 일정을 불러오는 중입니다.</p>}
      {status === 'error' && <p className="tf-error" role="status">작업 일정을 불러오지 못했습니다.</p>}
      <ScrollRegion kind="calendar" labelId="task-calendar-month">
        <table aria-labelledby="task-calendar-month">
          <thead>
            <tr>{weekdays.map((weekday) => <th key={weekday} scope="col">{weekday}</th>)}</tr>
          </thead>
          <tbody>
            {weeks.map((week, weekIndex) => (
              <tr key={weekIndex}>
                {week.map((entry, weekday) => (
                  <td key={weekday} data-today={entry?.date === todayDate}>
                    {entry && (
                      <>
                        <time dateTime={entry.date} aria-current={entry.date === todayDate ? 'date' : undefined}>
                          {entry.day}
                        </time>
                        {tasksByDate.has(entry.date) && (
                          <ul>
                            {tasksByDate.get(entry.date)?.map((task) => {
                              const alert = alertsByTaskId.get(task.id)
                              const badge = alert && dueDateAlerts[alert]
                              return (
                                <li key={task.id}>
                                  <a href={projectHref(task.projectId, task.id)} onClick={() => onTaskClick(task)}>
                                    {task.title}
                                    <small>{projectNames.get(task.projectId)}</small>
                                  </a>
                                  {task.status === 'DONE' && <span className="tf-date">완료</span>}
                                  {badge && (
                                    <span className="tf-badge" style={{ color: badge.color, background: badge.background }}>
                                      {badge.label}
                                    </span>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {status === 'ready' && !hasDueTasks && <p className="tf-empty">이 달에 표시할 마감 일정이 없습니다.</p>}
    </section>
  )
}
