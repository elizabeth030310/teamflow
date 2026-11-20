import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardHref, myTasksHref, projectHref, readWorkspaceRoute } from '../src/workspaceRoute.ts'

test('project and task links restore their selected page from the URL', () => {
  assert.deepEqual(readWorkspaceRoute(projectHref(27)), { page: 'project', projectId: 27, taskId: null })
  assert.deepEqual(readWorkspaceRoute(projectHref(27, 91)), { page: 'project', projectId: 27, taskId: 91 })
  assert.deepEqual(readWorkspaceRoute(myTasksHref), { page: 'my-tasks', projectId: null, taskId: null })
})

test('the dashboard is used for missing, legacy, and invalid routes', () => {
  for (const hash of [dashboardHref, '', '#task-91', '#/projects/0', '#/projects/27/tasks/-1', '#/projects/9007199254740992']) {
    assert.deepEqual(readWorkspaceRoute(hash), { page: 'dashboard', projectId: null, taskId: null })
  }
})
