import assert from 'node:assert/strict'
import test from 'node:test'
import { getCalendarDate, getDueDateAlert, getLocalCalendarDay, getMonthWeeks } from '../src/taskDates.ts'

test('deadline warnings use local calendar days and skip completed or undated tasks', () => {
  const today = getLocalCalendarDay(new Date(2028, 1, 28, 23, 45))
  assert.equal(getCalendarDate(today).toISOString().slice(0, 10), '2028-02-28')

  const alert = (dueDate, status = 'TODO') => getDueDateAlert({ dueDate, status }, today)
  assert.equal(alert('2028-02-27'), 'overdue')
  assert.equal(alert('2028-02-28'), 'today')
  assert.equal(alert('2028-02-29', 'IN_PROGRESS'), 'upcoming')
  assert.equal(alert('2028-03-02'), 'upcoming')
  assert.equal(alert('2028-03-03'), null)
  assert.equal(alert('2028-02-27', 'DONE'), null)
  assert.equal(alert(null), null)
  assert.equal(alert('2028-02-30'), null)
})

test('the month grid aligns weekdays and includes leap day', () => {
  const weeks = getMonthWeeks(2028, 1)
  assert.equal(weeks.length, 5)
  assert.ok(weeks.every((week) => week.length === 7))
  assert.equal(weeks[0][1], null)
  assert.deepEqual(weeks[0][2], { day: 1, date: '2028-02-01' })
  assert.deepEqual(weeks[4][2], { day: 29, date: '2028-02-29' })
  assert.equal(weeks[4][3], null)
  assert.equal(weeks.flat().filter(Boolean).length, 29)
})

test('month navigation can cross year boundaries', () => {
  assert.deepEqual(getMonthWeeks(2028, -1), getMonthWeeks(2027, 11))
  assert.deepEqual(getMonthWeeks(2028, 12), getMonthWeeks(2029, 0))
})
