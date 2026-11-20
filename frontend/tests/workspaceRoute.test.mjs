import assert from 'node:assert/strict'
import test from 'node:test'
import { adminHref, dashboardHref, myTasksHref, projectHref, projectTabHref, readWorkspaceRoute } from '../src/workspaceRoute.ts'

test('the administrator hash does not open an administrator page in the member workspace', () => {
  assert.equal(adminHref, '#/admin')
  assert.deepEqual(readWorkspaceRoute(adminHref), { page: 'dashboard', projectId: null, taskId: null })
})

test('project and task links restore their selected page from the URL', () => {
  assert.deepEqual(readWorkspaceRoute(projectHref(27)), { page: 'project', projectId: 27, taskId: null, tab: 'kanban' })
  assert.deepEqual(readWorkspaceRoute(projectHref(27, 91)), { page: 'project', projectId: 27, taskId: 91, tab: 'kanban' })
  assert.deepEqual(readWorkspaceRoute(myTasksHref), { page: 'my-tasks', projectId: null, taskId: null })
})

test('project tab links restore their tab without changing the canonical project link', () => {
  assert.equal(projectTabHref(27, 'kanban'), projectHref(27))
  for (const tab of ['calendar', 'stats', 'members']) {
    const href = projectTabHref(27, tab)
    assert.equal(href, `#/projects/27/${tab}`)
    assert.deepEqual(readWorkspaceRoute(href), { page: 'project', projectId: 27, taskId: null, tab })
  }
})

test('the dashboard is used for missing, legacy, and invalid routes', () => {
  for (const hash of [dashboardHref, '', '#task-91', '#/projects/0', '#/projects/27/tasks/-1', '#/projects/9007199254740992', '#/projects/27/unknown', '#/projects/27/calendar/tasks/91']) {
    assert.deepEqual(readWorkspaceRoute(hash), { page: 'dashboard', projectId: null, taskId: null })
  }
})
