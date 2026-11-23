import assert from 'node:assert/strict'
import test from 'node:test'
import { expandPageAncestors, groupProjectPages, PageRequestError, projectPageApi, resolvePageSelection } from '../src/projectPageApi.ts'
import { acknowledgePageSave, pageDraftKey, readPageDraft, trackPageSave, waitForPageSave, writePageDraft } from '../src/projectPageDraft.ts'
import { Editor } from '@tiptap/core'
import { decodePageContent, encodePageContent, pageExtensions } from '../src/projectPageContent.ts'
import { activePageBlock, setPageBlock } from '../src/projectPageBlocks.ts'

test('block picker switches among list types and unwraps a task into a paragraph', () => {
  const editor = new Editor({ element: null, extensions: pageExtensions, content: decodePageContent('첫 줄\n다음 줄') })
  try {
    for (const type of ['bulletList', 'orderedList', 'taskList', 'paragraph', 'codeBlock', 'paragraph']) {
      assert.equal(setPageBlock(editor, type), true)
      assert.equal(activePageBlock(editor.state.selection), type)
      assert.deepEqual(editor.state.doc.content.content.map((node) => node.type.name), [type, 'paragraph'])
      assert.equal(editor.state.doc.firstChild.textContent, '첫 줄')
    }
  } finally {
    editor.destroy()
  }
})

test('selecting an existing block type leaves the full selection and document intact', () => {
  const editor = new Editor({ element: null, extensions: pageExtensions, content: decodePageContent('목록') })
  try {
    assert.equal(setPageBlock(editor, 'bulletList'), true)
    const before = editor.getJSON()
    editor.commands.setTextSelection({ from: 3, to: 5 })
    const selection = editor.state.selection
    assert.equal(setPageBlock(editor, 'bulletList'), true)
    assert.deepEqual(editor.getJSON(), before)
    assert.ok(editor.state.selection.eq(selection))
  } finally {
    editor.destroy()
  }
})

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
  const page = { id: 12, projectId: 27, parentPageId: 11, title: '바뀐 제목', content: '기존', updatedAt: '2026-11-22T11:00:00.123456Z' }
  const content = '  첫 줄\n\n둘째 줄\n'
  const fetchMock = context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/projects/27/pages/12')
    if (options.method === 'GET') return Response.json(page)
    assert.equal(options.method, 'PUT')
    assert.deepEqual(JSON.parse(options.body), { parentPageId: 11, title: page.title, content, expectedUpdatedAt: page.updatedAt })
    return Response.json({ ...page, content })
  })
  const api = projectPageApi(27, new AbortController().signal)
  assert.equal((await api.saveContent(12, content, page.content)).content, content)
  await assert.rejects(api.saveContent(12, content, '오래된 본문'), { status: 409 })
  assert.equal((await api.saveContent(12, page.content, '오래된 본문')).content, page.content)
  assert.deepEqual(fetchMock.mock.calls.map(({ arguments: [, options] }) => options.method), ['GET', 'PUT', 'GET', 'GET'])
})

test('a failed save retains the scoped rich draft and a successful save rebases newer edits', async () => {
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
    const initial = { content: encodePageContent(decodePageContent('저장 시도')), contentFormat: 'rich-v1', baseContent: '기존' }
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
    assert.deepEqual(acknowledgePageSave(key, initial.content, 'rich-v1').next, {
      content: '추가 편집', baseContent: initial.content, baseContentFormat: 'rich-v1',
    })
    acknowledgePageSave(key, '추가 편집')
    assert.equal(readPageDraft(key), null)
    assert.equal(storage.has(key), false)
  } finally {
    delete globalThis.window
  }
})

test('literal legacy body preserves whitespace, line endings, markup and trailing blank lines', () => {
  function plainText(document) {
    return document.content.map((paragraph, index) => {
      const text = paragraph.content?.[0].text ?? ''
      const endings = { cr: '\r', crlf: '\r\n' }
      return index === document.content.length - 1 ? text : text + (endings[paragraph.attrs?.lineEnding] ?? '\n')
    }).join('')
  }
  for (const input of ['', '  첫 줄\r\n\n\t<em>literal</em>\r마지막  \n\n', '{"type":"doc","content":[{"type":"paragraph"}]}']) {
    const document = decodePageContent(input)
    assert.equal(plainText(document), input)
    assert.equal(plainText(decodePageContent(encodePageContent(document), 'rich-v1')), input)
  }
})

test('rich content round trips headings, supported marks, lists, task state and code', () => {
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text: '본문' }] }
  const item = { type: 'listItem', content: [paragraph] }
  const document = {
    type: 'doc',
    content: [
      ...[1, 2, 3].map((level) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: '제목' }] })),
      { type: 'paragraph', content: [{ type: 'text', text: '서식', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] }] },
      { type: 'bulletList', content: [item] },
      { type: 'orderedList', attrs: { start: 2, type: null }, content: [item] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph] }] },
      { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: '  const value = "<tag>"\n' }] },
    ],
  }
  const restored = decodePageContent(encodePageContent(document), 'rich-v1')
  assert.deepEqual(JSON.parse(encodePageContent(restored)), document)
})

test('unsupported nodes, marks, and unsafe attributes fall back to literal text', () => {
  for (const child of [
    { type: 'image', attrs: { src: 'https://invalid.test/example.png' } },
    { type: 'heading', attrs: { level: ['img', { src: 'example.png' }] } },
    { type: 'paragraph', attrs: { onclick: 'unexpected' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: '/example' } }] }] },
  ]) {
    const input = encodePageContent({ type: 'doc', content: [child] })
    const document = decodePageContent(input, 'rich-v1')
    assert.deepEqual(document.content.map((paragraph) => paragraph.content[0].text), input.split('\n'))
  }
})

test('format changes participate in conflict detection even when the content string is unchanged', async (context) => {
  const content = encodePageContent(decodePageContent('본문'))
  const page = { id: 12, projectId: 27, parentPageId: 11, title: '제목', content, contentFormat: 'rich-v1' }
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json(page))
  const api = projectPageApi(27, new AbortController().signal)
  await assert.rejects(api.saveContent(12, content, content, 'plain', 'plain'), { status: 409 })
  assert.equal(fetchMock.mock.callCount(), 1)
})
