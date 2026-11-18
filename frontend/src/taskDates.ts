export const dueDateAlerts = {
  overdue: { label: '기한 초과', color: '#991b1b', background: '#fee2e2' },
  today: { label: '오늘 마감', color: '#9a3412', background: '#ffedd5' },
  upcoming: { label: '마감 임박', color: '#854d0e', background: '#fef9c3' },
}

export type DueDateAlert = keyof typeof dueDateAlerts

export function showDatePicker(input: HTMLInputElement | null) {
  if (typeof input?.showPicker !== 'function') return

  try {
    input.showPicker()
  } catch {
    return
  }
}

const millisecondsPerDay = 86_400_000

export const getLocalCalendarDay = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / millisecondsPerDay

export const getCalendarDate = (day: number) => new Date(day * millisecondsPerDay)

export function getDueDateAlert(
  { dueDate, status }: { dueDate: string | null; status: string },
  today: number,
): DueDateAlert | null {
  if (status === 'DONE' || !dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null

  const date = new Date(`${dueDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dueDate) return null

  const daysRemaining = date.getTime() / millisecondsPerDay - today
  if (daysRemaining < 0) return 'overdue'
  if (daysRemaining === 0) return 'today'
  if (daysRemaining <= 3) return 'upcoming'
  return null
}

export function getMonthWeeks(year: number, month: number) {
  const firstDate = new Date(Date.UTC(year, month, 1))
  const leadingDays = firstDate.getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const weekCount = Math.ceil((leadingDays + daysInMonth) / 7)

  return Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const day = week * 7 + weekday - leadingDays + 1
      if (day < 1 || day > daysInMonth) return null

      const date = new Date(firstDate)
      date.setUTCDate(day)
      return { day, date: date.toISOString().slice(0, 10) }
    }),
  )
}
