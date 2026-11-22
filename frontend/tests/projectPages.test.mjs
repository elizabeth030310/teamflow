import assert from 'node:assert/strict'
import test from 'node:test'
import { expandPageAncestors, groupProjectPages, PageRequestError, projectPageApi, resolvePageSelection } from '../src/projectPageApi.ts'
import { acknowledgePageSave, pageDraftKey, readPageDraft, trackPageSave, waitForPageSave, writePageDraft } from '../src/projectPageDraft.ts'

const entries = [
  { id: 11, parentPageId: null, title: '계획', depth: 0 },
  { id: 12, parentPageId: 11, title: '이번 주', depth: 1 },
  { id: 13, parentPageId: 12, title: '월요일', depth: 2 },
  { id: 14, parentPageId: null, title: '회의록', depth: 0 },
]

test('nested pages retain API order and reveal ancestors of a restored selection', () => {
  const groups = groupProjectPages(entries)
  assert.deepEqual(groups.get(null), [entries[0], entries[3]])
  assert.deepEqual(groups.get(12), [entries[2]])
  assert.equal(resolvePageSelection(entries, 13), 13)
  assert.deepEqual(expandPageAncestors(entries, 13, new Set([99])), new Set([11, 12]))
})

test('a saved selection from a different or outdated tree falls back within the current project', () => {
  assert.equal(resolvePageSelection(entries, 99), 11)
  assert.equal(resolvePageSelection([], 13), null)
})

test('tree, create, rename and delete use scoped endpoints and the 193-A request contract', async (context) => {
  const calls = []
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body), credentials: options.credentials })
    if (options.method === 'DELETE') return new Response(null, { status: 204 })
    if (url.endsWith('/tree')) return Response.json(entries)
    return Response.json({ id: 12, projectId: 27, parentPageId: 11, content: '저장된 본문', title: '이번 주' })
  })
  const api = projectPageApi(27, new AbortController().signal)
  assert.deepEqual(await api.tree(), entries)
  await api.create({ parentPageId: 11, content: '', title: '새 문서' })
  await api.rename(12, '바뀐 제목')
  await api.remove(12)
  assert.deepEqual(calls, [
    { url: '/api/projects/27/pages/tree', method: 'GET', body: undefined, credentials: 'include' },
    { url: '/api/projects/27/pages', method: 'POST', body: { parentPageId: 11, content: '', title: '새 문서' }, credentials: 'include' },
    { url: '/api/projects/27/pages/12', method: 'GET', body: undefined, credentials: 'include' },
    { url: '/api/projects/27/pages/12', method: 'PUT', body: { parentPageId: 11, content: '저장된 본문', title: '바뀐 제목' }, credentials: 'include' },
    { url: '/api/projects/27/pages/12', method: 'DELETE', body: undefined, credentials: 'include' },
  ])
})

test('API errors preserve session, access, missing page and delete conflict statuses', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch')
  const api = projectPageApi(27, new AbortController().signal)
  for (const status of [401, 403, 404, 409]) {
    fetchMock.mock.mockImplementation(async () => new Response(null, { status }))
    await assert.rejects(api.remove(12), (error) => error instanceof PageRequestError && error.status === status)
  }
})

test('body save retains current page metadata and preserves multiline content', async (context) => {
  const page = { id: 12, projectId: 27, parentPageId: 11, title: '바뀐 제목', content: '기존' }
  const content = '  첫 줄\n\n둘째 줄\n'
  const fetchMock = context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/projects/27/pages/12')
    if (options.method === 'GET') return Response.json(page)
    assert.equal(options.method, 'PUT')
    assert.deepEqual(JSON.parse(options.body), { parentPageId: 11, title: page.title, content })
    return Response.json({ ...page, content })
  })
  const api = projectPageApi(27, new AbortController().signal)
  assert.equal((await api.saveContent(12, content, page.content)).content, content)
  await assert.rejects(api.saveContent(12, content, '오래된 본문'), { status: 409 })
  assert.equal((await api.saveContent(12, page.content, '오래된 본문')).content, page.content)
  assert.deepEqual(fetchMock.mock.calls.map(({ arguments: [, options] }) => options.method), ['GET', 'PUT', 'GET', 'GET'])
})

test('a failed save retains the scoped draft and a successful save rebases newer edits', async () => {
  const storage = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    removeEventListener() {},
  }
  try {
    const key = pageDraftKey(1, 27, 12)
    const initial = { content: '저장 시도', baseContent: '기존' }
    writePageDraft(key, initial)
    const attempt = trackPageSave(key, Promise.reject(new PageRequestError(403)))
    await assert.rejects(attempt, { status: 403 })
    await waitForPageSave(key)
    assert.deepEqual(readPageDraft(key), initial)
    assert.deepEqual(JSON.parse(storage.get(key)), initial)
    for (const otherKey of [pageDraftKey(2, 27, 12), pageDraftKey(1, 28, 12), pageDraftKey(1, 27, 11)]) {
      assert.equal(readPageDraft(otherKey), null)
    }
    writePageDraft(key, { content: '추가 편집', baseContent: '기존' })
    assert.deepEqual(acknowledgePageSave(key, '저장 시도').next, { content: '추가 편집', baseContent: '저장 시도' })
    acknowledgePageSave(key, '추가 편집')
    assert.equal(readPageDraft(key), null)
    assert.equal(storage.has(key), false)
  } finally {
    delete globalThis.window
  }
})
