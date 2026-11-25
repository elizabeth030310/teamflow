import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { authHandler, authSettings } from '../src/auth.ts'
import { authStore } from '../src/auth-store.ts'
import { collaborationHandler } from '../src/collaboration.ts'
import { maintenanceHandler } from '../src/maintenance.ts'

const source = /^jdbc:postgresql:\/\/127\.0\.0\.1:(\d{4,5})\/(teamflow_test_[0-9a-f]{32})$/
  .exec(process.env.TEAMFLOW_TEST_DB_URL ?? '')
const password = process.env.TEAMFLOW_TEST_DB_PASSWORD ?? ''
const port = Number(source?.[1])
assert.ok(source && port >= 1024 && port <= 65535 && ![5432, 5433].includes(port) && /^[0-9a-f]{32}$/.test(password),
  'Expected only the disposable Spring test database')
const { owner, member, outsider, contracts } = JSON.parse(readFileSync(0, 'utf8'))
const suffix = randomBytes(12).toString('hex')
const database = 'teamflow_collab_' + suffix
const role = 'teamflow_app_' + suffix
const runtimePassword = randomBytes(24).toString('hex')
const local = { host: '127.0.0.1', port, ssl: false, connectionTimeoutMillis: 3_000 }
const manager = new Pool({ ...local, database: source[2], user: 'teamflow_test', password })
let setup
let runtime
const root = new URL('../../../../', import.meta.url)
const load = relative => readFileSync(new URL(relative, root), 'utf8')
const origin = 'https://collaboration.example.test'
const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-TeamFlow-Request': '1', 'Content-Type': 'application/json' }
const clean = body => Object.fromEntries(Object.entries(body).map(([key, value]) => [
  key, /^(id|\w+Id)$/u.test(key) && value != null ? '<id>' : /At$/u.test(key) && value != null ? '<time>' : value,
]))

try {
  await manager.query('CREATE DATABASE ' + database)
  await manager.query(`CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD '${runtimePassword}'`)
  setup = new Pool({ ...local, database, user: 'teamflow_test', password })
  const bootstrap = load('deploy/vps/197b-bootstrap.sql')
  const schema = bootstrap.slice(bootstrap.indexOf('CREATE TABLE users ('), bootstrap.indexOf('GRANT CONNECT ON DATABASE'))
  const grants = bootstrap.slice(bootstrap.indexOf('GRANT CONNECT ON DATABASE'), bootstrap.lastIndexOf('COMMIT;'))
    .replaceAll('teamflow_staging_app', role).replace('DATABASE teamflow_staging', 'DATABASE ' + database)
  await setup.query(schema + grants)
  await setup.query(load('deploy/vercel/functions/sql/001-auth.sql'))
  await setup.query(load('deploy/vercel/functions/sql/002-page-uploads.sql'))
  await setup.query(load('deploy/vercel/functions/sql/003-attachment-uploads.sql'))
  await setup.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.teamflow_sessions TO ${role}`)
  await setup.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.teamflow_page_uploads TO ${role}`)
  await setup.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.teamflow_attachment_uploads TO ${role}`)
  runtime = new Pool({ ...local, database, user: role, password: runtimePassword })
  const objects = new Map()
  let retryKey
  const storage = {
    open: async key => {
      const bytes = objects.get(key)
      return bytes ? { size: bytes.length, stream: new Blob([bytes]).stream() } : null
    },
    token: async key => 'test-scope:' + key,
    write: async (key, file) => { objects.set(key, Buffer.from(await file.arrayBuffer())) },
    remove: async key => {
      if (key === retryKey) throw new Error('temporary provider failure')
      objects.delete(key)
    },
  }
  const fetch = collaborationHandler(() => runtime, () => authSettings({ TEAMFLOW_AUTH_ORIGINS: origin }), () => storage)
  const sessions = new Map()
  for (const [email, name] of [[owner, 'Owner'], [member, 'Member'], [outsider, 'Outsider']]) {
    const account = (await setup.query(`INSERT INTO users (name, email, password, created_at)
      VALUES ($1, $2, 'unused', LOCALTIMESTAMP) RETURNING id`, [name, email])).rows[0]
    const token = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(token).digest()
    await setup.query("INSERT INTO teamflow_sessions VALUES ($1, $2, 0, clock_timestamp() + interval '30 minutes')", [hash, account.id])
    sessions.set(email, { token, id: Number(account.id) })
  }

  const call = (method, path, actor = owner, body, extra = {}) => fetch(new Request(origin + path, {
    method, headers: { ...headers, ...(actor && { Cookie: '__Host-teamflow-session=' + sessions.get(actor).token }), ...extra },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }))
  const expected = async (response, status) => {
    assert.equal(response.status, status)
    return status === 204 ? null : response.json()
  }
  const schemaCheck = async () => (await runtime.query(load('deploy/vercel/functions/sql/check-collaboration.sql')))[1].rows
  const compare = async (name, response) => {
    const signature = contracts[name]
    assert.equal(response.status, signature.status, name)
    const body = signature.body ? await response.json() : null
    if (body) assert.deepEqual(clean(body), clean(signature.body), name)
    return body
  }

  await expected(await call('GET', '/api/projects', null), 401)
  await expected(await call('GET', '/api/hello', null), 401)
  assert.deepEqual(await expected(await call('GET', '/api/hello', member), 200), { message: 'Hello TeamFlow!' })
  await expected(await call('POST', '/api/projects', owner, { name: 'Blocked' }, { Origin: 'https://foreign.example.test' }), 403)
  const rewritten = await expected(await call('POST', '/api/collaboration?_teamflowPath=projects', owner, { name: 'Rewritten' }), 201)
  await expected(await call('DELETE', '/api/projects/' + rewritten.id, owner), 204)
  const project = await compare('project', await call('POST', '/api/projects', owner, { name: 'Parity', description: 'Team' }))
  const projectPath = '/api/projects/' + project.id
  await compare('privateProject', await call('GET', projectPath, outsider))
  await compare('updatedProject', await call('PUT', projectPath, owner, { name: 'Renamed', description: 'Team' }))

  await setup.query('ALTER TABLE project_pages DROP COLUMN content_format CASCADE')
  assert.ok((await schemaCheck()).some(row => row.column_name === 'content_format' && !row.column_present))
  await expected(await call('POST', projectPath + '/pages', owner, { title: 'Missing format' }), 500)
  assert.equal((await setup.query('SELECT count(*)::int AS count FROM project_pages')).rows[0].count, 0)
  await setup.query(load('backend/db/193-d-project-page-content-format.sql'))
  await expected(await call('POST', projectPath + '/invitations', owner, { email: member }), 500)
  assert.equal((await setup.query('SELECT count(*)::int AS count FROM project_members')).rows[0].count, 0)
  await setup.query(load('backend/db/199-project-invitation-notifications.sql'))
  await expected(await call('POST', projectPath + '/invitations', owner, { email: member }), 500)
  assert.equal((await setup.query('SELECT count(*)::int AS count FROM project_members')).rows[0].count, 0)
  await setup.query(`GRANT UPDATE (created_at) ON notifications TO ${role}`)

  const invite = await compare('invite', await call('POST', projectPath + '/invitations', owner, { email: member }))
  const resendPath = projectPath + '/invitations/' + invite.id + '/resend'
  await compare('inviteCooldown', await call('POST', resendPath, owner))
  const inbox = await expected(await call('GET', '/api/notifications', member), 200)
  assert.equal(inbox.items[0].kind, 'PROJECT_INVITATION')
  assert.equal(inbox.items[0].projectName, 'Renamed')
  await expected(await call('PATCH', '/api/notifications/' + inbox.items[0].id + '/read', outsider), 404)
  await expected(await call('PATCH', '/api/notifications/' + inbox.items[0].id + '/read', member), 204)
  await setup.query("UPDATE notifications SET created_at = clock_timestamp() - interval '2 minutes' WHERE invitation_id = $1", [invite.id])
  await expected(await call('POST', resendPath, owner), 200)
  assert.equal((await expected(await call('GET', '/api/notifications', member), 200)).unreadCount, 1)
  const acceptPath = '/api/projects/invitations/' + invite.id + '/accept'
  await expected(await call('POST', acceptPath, outsider), 404)
  const accepted = await Promise.all([call('POST', acceptPath, member), call('POST', acceptPath, member)])
  assert.deepEqual(accepted.map(response => response.status).sort(), [200, 409])
  const successful = accepted.find(response => response.status === 200)
  await compare('accept', successful)
  assert.equal((await expected(await call('GET', '/api/notifications', member), 200)).unreadCount, 0)
  const rejected = await expected(await call('POST', projectPath + '/invitations', owner, { email: outsider }), 201)
  assert.equal((await expected(await call('POST', '/api/projects/invitations/' + rejected.id + '/reject', outsider), 200)).status, 'REJECTED')
  await expected(await call('PUT', projectPath, member, { name: 'Blocked' }), 404)

  const page = await compare('page', await call('POST', projectPath + '/pages', member,
    { title: 'Root', content: '{"type":"doc"}', contentFormat: 'rich-v1' }))
  assert.match(page.updatedAt, /\.\d{6}Z$/u)
  const pagePath = projectPath + '/pages/' + page.id
  await expected(await call('PUT', pagePath, owner, { title: 'Missing grant', expectedUpdatedAt: page.updatedAt }), 500)
  await setup.query(`GRANT UPDATE (content_format) ON project_pages TO ${role}`)
  assert.ok((await schemaCheck()).every(row => row.table_present && row.column_present && row.granted))
  await compare('updatedPage', await call('PUT', pagePath, owner, { title: 'Updated', expectedUpdatedAt: page.updatedAt }))
  await compare('stalePage', await call('PUT', pagePath, member, { title: 'Stale', expectedUpdatedAt: page.updatedAt }))
  const child = await expected(await call('POST', projectPath + '/pages', member, { title: 'Child', parentPageId: page.id }), 201)
  const tree = await expected(await call('GET', projectPath + '/pages/tree', member), 200)
  assert.deepEqual(tree.map(entry => entry.depth), [0, 1])
  const parallelEdits = await Promise.all(['First', 'Second'].map(title => call('PUT',
    projectPath + '/pages/' + child.id, member, { title, parentPageId: page.id, expectedUpdatedAt: child.updatedAt })))
  assert.deepEqual(parallelEdits.map(response => response.status).sort(), [200, 409])
  await expected(await call('PUT', pagePath, member, { title: 'Cycle', parentPageId: child.id }), 400)
  await expected(await call('DELETE', pagePath, member), 409)
  await expected(await call('GET', projectPath + '/pages/' + child.id, outsider), 404)
  await expected(await call('DELETE', projectPath + '/pages/' + child.id, member), 204)
  await expected(await call('DELETE', pagePath, member), 204)

  const { projectPageApi } = await import(new URL('frontend/src/projectPageApi.ts', root))
  const transportSizes = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (path, options) => {
    if (options.body) transportSizes.push(Buffer.byteLength(options.body))
    return call(options.method, path, member, options.body ? JSON.parse(options.body) : undefined)
  }
  const editor = projectPageApi(project.id, new AbortController().signal, true)
  const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
    content: [{ type: 'text', text: '😀' + '한'.repeat(1_550_000) + '😀' }] }] })
  assert.ok(Buffer.byteLength(content) > 4_500_000)
  try {
    const large = await editor.create({ parentPageId: null, title: 'Large document', content, contentFormat: 'rich-v1' })
    assert.equal(large.content, content)
    assert.equal((await editor.get(large.id)).content, content)
    assert.ok(transportSizes.length > 3 && transportSizes.every(size => size < 3_500_000))
    const largePath = projectPath + '/pages/' + large.id
    await expected(await call('GET', largePath + '/content?offset=0&version=' + encodeURIComponent(large.updatedAt), outsider), 404)
    const updated = await editor.rename(large.id, 'Large renamed')
    assert.equal(updated.content, content)
    await expected(await call('GET', largePath + '/content?offset=0&version=' + encodeURIComponent(large.updatedAt), member), 409)
    const edit = await editor.saveContent(large.id, content.replace('한', '글'), content, 'rich-v1', 'rich-v1')
    assert.equal((await editor.get(large.id)).content, edit.content)
    const uploads = projectPath + '/pages/uploads'
    const { uploadId } = await expected(await call('POST', uploads, owner), 201)
    await expected(await call('PUT', uploads + '/' + uploadId + '/0', member, { content: 'Foreign upload' }), 409)
    await expected(await call('PUT', uploads + '/' + uploadId + '/1', owner, { content: 'Out of order' }), 409)
    await expected(await call('PUT', uploads + '/' + uploadId + '/0', owner, { content: 'Partial' }), 204)
    await expected(await call('PUT', largePath, owner, { title: 'Incomplete', contentFormat: 'rich-v1',
      contentUploadId: uploadId, contentUploadParts: 2, contentUploadSize: 7, expectedUpdatedAt: edit.updatedAt }), 409)
    assert.equal((await editor.get(large.id)).content, edit.content)
    await editor.remove(large.id)
  } finally {
    globalThis.fetch = originalFetch
  }

  const task = await compare('task', await call('POST', '/api/tasks', member, { projectId: project.id, title: 'Task', dueDate: '2030-02-28' }))
  const taskPath = '/api/tasks/' + task.id
  await expected(await call('PATCH', taskPath + '/assignee', owner, { assigneeId: sessions.get(outsider).id }), 400)
  await compare('assign', await call('PATCH', taskPath + '/assignee', owner, { assigneeId: sessions.get(member).id }))
  await compare('status', await call('PATCH', taskPath + '/status', member, { status: 'DONE' }))
  const item = await compare('checklist', await call('POST', taskPath + '/checklist-items', member, { title: 'Checklist' }))
  await compare('completed', await call('PATCH', taskPath + '/checklist-items/' + item.id, owner, { completed: true }))
  const tasks = await expected(await call('GET', '/api/tasks/project/' + project.id, member), 200)
  assert.equal(tasks[0].checklistCompleted, 1)
  assert.equal(tasks[0].checklistTotal, 1)
  const comment = await compare('comment', await call('POST', taskPath + '/comments', owner, { content: 'Root comment' }))
  const reply = await compare('reply', await call('POST', taskPath + '/comments', member, { content: 'Reply', parentCommentId: comment.id }))
  await compare('foreignCommentEdit', await call('PATCH', taskPath + '/comments/' + comment.id, member, { content: 'No' }))
  await expected(await call('POST', taskPath + '/comments', owner, { content: 'Invalid', parentCommentId: reply.id }), 400)
  await expected(await call('PATCH', taskPath + '/comments/' + reply.id, member, { content: 'Edited' }), 200)
  await expected(await call('DELETE', taskPath + '/comments/' + comment.id, owner), 204)
  assert.equal((await expected(await call('GET', taskPath + '/comments', member), 200))[0].deleted, true)
  await expected(await call('PUT', taskPath, member, { title: 'Updated', priority: 'HIGH', dueDate: null }), 200)

  const attachmentPath = taskPath + '/attachments'
  const fileBytes = Buffer.alloc(6 * 1024 * 1024)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(fileBytes)
  await expected(await call('POST', attachmentPath + '/upload-token', outsider, { name: 'private.png', size: fileBytes.length }), 404)
  await expected(await call('POST', attachmentPath + '/upload-token', owner,
    { name: 'private.png', size: fileBytes.length }, { Origin: 'https://foreign.example.test' }), 403)
  await expected(await call('POST', attachmentPath + '/upload-token', owner,
    { name: 'private.png', size: 10 * 1024 * 1024 + 1 }), 413)
  const uploaded = await expected(await call('POST', attachmentPath + '/upload-token', owner,
    { name: '문서.PNG', size: fileBytes.length }), 201)
  assert.equal(uploaded.pathname, 'teamflow/attachments/' + uploaded.storageKey)
  objects.set(uploaded.storageKey, fileBytes)
  const complete = actor => call('POST', attachmentPath + '/complete', actor, { storageKey: uploaded.storageKey })
  await expected(await complete(member), 404)
  const record = await expected(await complete(owner), 201)
  assert.equal(record.displayName, '문서.png')
  assert.equal(record.sizeBytes, fileBytes.length)
  assert.equal((await expected(await complete(owner), 201)).id, record.id)
  assert.equal((await expected(await call('GET', attachmentPath, member), 200)).length, 1)
  const download = await call('GET', attachmentPath + '/' + record.id + '/download', member)
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('cache-control'), 'private, no-store')
  assert.match(download.headers.get('content-disposition'), /^attachment;.*UTF-8/)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fileBytes)
  await expected(await call('GET', attachmentPath + '/' + record.id + '/download', outsider), 404)
  await expected(await call('DELETE', attachmentPath + '/' + record.id, member), 403)
  await expected(await call('DELETE', attachmentPath + '/' + record.id, owner), 204)
  await expected(await call('GET', attachmentPath + '/' + record.id + '/download', member), 404)

  const invalid = await expected(await call('POST', attachmentPath + '/upload-token', member,
    { name: 'not-an-image.png', size: 8 }), 201)
  objects.set(invalid.storageKey, Buffer.alloc(8))
  await expected(await call('POST', attachmentPath + '/complete', member, { storageKey: invalid.storageKey }), 415)
  await setup.query('UPDATE teamflow_attachment_uploads SET expires_at = clock_timestamp() WHERE storage_key = $1', [invalid.storageKey])
  const legacyForm = new FormData()
  legacyForm.append('file', new File(['%PDF-1.4'], 'fixture.pdf'))
  const legacy = await fetch(new Request(origin + attachmentPath, {
    method: 'POST', body: legacyForm, headers: { Origin: origin, 'X-TeamFlow-Request': '1',
      Cookie: '__Host-teamflow-session=' + sessions.get(owner).token },
  }))
  assert.equal(legacy.status, 201)

  const dueSoon = await expected(await call('POST', '/api/tasks', member,
    { projectId: project.id, title: 'Deadline', dueDate: '2020-01-01' }), 201)
  const secret = 'test-cron-secret-of-at-least-thirty-two'
  const maintain = maintenanceHandler(() => runtime, () => storage, () => secret)
  const runMaintenance = () => maintain(new Request(origin + '/api/maintenance', { headers: { Authorization: 'Bearer ' + secret } }))
  retryKey = uploaded.storageKey
  const maintenance = await expected(await runMaintenance(), 200)
  assert.equal(maintenance.attachments.queued, 1)
  assert.equal(maintenance.attachments.retried, 1)
  assert.equal(objects.has(invalid.storageKey), false)
  assert.ok(maintenance.notices >= 1)
  assert.equal((await expected(await call('GET', '/api/notifications', owner), 200)).items
    .filter(item => item.taskId === dueSoon.id && item.kind === 'OVERDUE').length, 1)
  assert.equal((await expected(await runMaintenance(), 200)).notices, 0)
  await expected(await call('PATCH', '/api/notifications/read-all', owner), 204)
  assert.equal((await expected(await call('GET', '/api/notifications', owner), 200)).unreadCount, 0)
  retryKey = undefined
  await setup.query('UPDATE attachment_file_deletions SET next_attempt_at = clock_timestamp()')
  assert.equal((await expected(await runMaintenance(), 200)).attachments.removed, 1)
  assert.equal(objects.has(uploaded.storageKey), false)
  await expected(await call('DELETE', taskPath, member), 204)
  const activities = await expected(await call('GET', projectPath + '/activities', member), 200)
  assert.equal(activities[0].type, 'TASK_DELETED')
  assert.equal(activities.filter(activity => activity.type === 'TASK_STATUS_CHANGED').length, 1)
  if (process.env.TEAMFLOW_TEST_COLLAB_BROWSER === '1') {
    const { withLocalBrowser } = await import('./browser.mjs')
    await withLocalBrowser(browserOrigin => {
      const settings = () => authSettings({ TEAMFLOW_AUTH_ORIGINS: browserOrigin })
      const dispatcher = collaborationHandler(() => runtime, settings)
      const currentAccount = authHandler('me', () => authStore(runtime), settings)
      return request => new URL(request.url).pathname === '/api/auth/me' ? currentAccount(request) : dispatcher(request)
    }, async ({ origin: browserOrigin, context, page }) => {
      await context.addCookies([{
        name: '__Host-teamflow-session', value: sessions.get(member).token, url: browserOrigin,
        secure: true, httpOnly: true, sameSite: 'Lax',
      }])
      await page.goto(browserOrigin + '/#/projects/' + project.id + '/pages')
      await page.locator('.tf-page-workspace').getByRole('button', { name: '+ 새 페이지' }).click()
      await page.getByLabel('페이지 제목').fill('Browser document')
      const created = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === projectPath + '/pages')
      await page.getByRole('button', { name: '만들기', exact: true }).click()
      assert.equal((await created).status(), 201)
      await page.locator('.tf-page-workspace [contenteditable="true"]').first().waitFor()
    }, new URL('frontend/dist/', root))
  }
  await expected(await call('DELETE', projectPath, owner), 204)
  await expected(await call('GET', '/api/collaboration?_teamflowPath=projects%2Finvitations', member), 200)
  console.log('Spring/Node parity, least-privilege PostgreSQL, concurrent acceptance, and schema failures passed')
} finally {
  await runtime?.end()
  await setup?.end()
  await manager.query('DROP DATABASE IF EXISTS ' + database)
  await manager.query('DROP ROLE IF EXISTS ' + role)
  await manager.end()
}
