import assert from 'node:assert/strict'
import test from 'node:test'
import { getProjectStats } from '../src/projectTaskStats.ts'
import { getLocalCalendarDay } from '../src/taskDates.ts'

const today = getLocalCalendarDay(new Date(2028, 1, 28))

test('project totals include completed, unassigned and legacy tasks', () => {
  const tasks = [
    { status: 'TODO', priority: 'HIGH', assigneeId: 10, dueDate: '2028-02-27' },
    { status: 'IN_PROGRESS', priority: 'LOW', assigneeId: 10, dueDate: '2028-02-28' },
    { status: 'TODO', priority: null, assigneeId: null, dueDate: '2028-03-02' },
    { status: 'DONE', priority: 'MEDIUM', assigneeId: 20, dueDate: '2028-02-27' },
    { status: 'LEGACY', priority: 'LEGACY', dueDate: '2028-03-03' },
    { status: 'DONE', priority: 'HIGH', assigneeId: 20, dueDate: null },
  ]
  const stats = getProjectStats(tasks, today)

  assert.equal(stats.total, 6)
  assert.equal(stats.completed, 2)
  assert.equal(stats.completionRate, 33)
  assert.deepEqual(stats.statusCounts, new Map([['TODO', 2], ['IN_PROGRESS', 1], ['DONE', 2], ['LEGACY', 1]]))
  assert.equal(stats.otherStatuses, 1)
  assert.deepEqual(stats.priorityCounts, new Map([['HIGH', 2], ['LOW', 1], ['MEDIUM', 3]]))
  assert.deepEqual(stats.assigneeCounts, new Map([[10, 2], [20, 2], [null, 2]]))
  assert.deepEqual(stats.deadlineCounts, { overdue: 1, today: 1, upcoming: 1 })
})

test('replacement task snapshots and a new local day refresh the counts', () => {
  const task = { status: 'TODO', priority: 'LOW', assigneeId: null, dueDate: '2028-02-28' }
  assert.deepEqual(getProjectStats([task], today + 1).deadlineCounts, { overdue: 1, today: 0, upcoming: 0 })

  const updated = getProjectStats([{ ...task, status: 'DONE', priority: 'HIGH', assigneeId: 20 }], today)
  assert.equal(updated.completionRate, 100)
  assert.equal(updated.priorityCounts.get('HIGH'), 1)
  assert.equal(updated.assigneeCounts.get(20), 1)
  assert.deepEqual(updated.deadlineCounts, { overdue: 0, today: 0, upcoming: 0 })

  const empty = getProjectStats([], today)
  assert.equal(empty.total, 0)
  assert.equal(empty.completionRate, 0)
  assert.equal(empty.assigneeCounts.size, 0)
})
