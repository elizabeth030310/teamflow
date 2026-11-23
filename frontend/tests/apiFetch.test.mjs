import assert from 'node:assert/strict'
import test from 'node:test'
import { apiFetch } from '../src/apiFetch.ts'

test('read requests keep their options and write requests carry the same-origin header', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }))
  const form = new FormData()
  form.append('note', 'example')
  const signal = new AbortController().signal
  const readOptions = { signal }
  await apiFetch('/api/projects', readOptions)
  await apiFetch('/api/tasks/1/attachments', { method: 'POST', body: form, signal, credentials: 'include' })
  await apiFetch('/api/admin/users/1/status', { method: 'POST', headers: { 'X-TeamFlow-Admin': 'member-status' } })
  const [read, upload, admin] = fetchMock.mock.calls.map((call) => call.arguments[1])
  assert.equal(read, readOptions)
  assert.equal(upload.headers.get('X-TeamFlow-Request'), '1')
  assert.equal(upload.headers.has('Content-Type'), false)
  assert.equal(upload.mode, 'same-origin')
  assert.equal(upload.body, form)
  assert.equal(upload.signal, signal)
  assert.equal(upload.credentials, 'include')
  assert.equal(admin.headers.get('X-TeamFlow-Admin'), 'member-status')
  assert.equal(admin.headers.get('X-TeamFlow-Request'), '1')
})
