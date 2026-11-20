import assert from 'node:assert/strict'
import test from 'node:test'
import { findCommentFocus, groupTaskComments, isTaskComment, parseTaskComments } from '../src/taskCommentThreads.ts'

function comment(id, parentCommentId = null, deleted = false) {
  return { id, authorId: 1, authorName: '작성자', content: deleted ? '' : '내용',
    createdAt: '2026-11-20T03:00:00Z', parentCommentId, deleted }
}

test('interleaved API replies appear only under their own parent, including a deleted parent', () => {
  const rows = [comment(1, null, true), comment(2), comment(3, 2), comment(4, 1), comment(5, 2)]
  const { parents, repliesByParent } = groupTaskComments(parseTaskComments(rows))

  assert.deepEqual(parents.map(({ id }) => id), [1, 2])
  assert.equal(parents[0].deleted, true)
  assert.deepEqual(repliesByParent.get(1).map(({ id }) => id), [4])
  assert.deepEqual(repliesByParent.get(2).map(({ id }) => id), [3, 5])
})

test('API replies with missing or invalid parent IDs are not treated as root comments', () => {
  const legacyReply = comment(2, 1)
  delete legacyReply.parentCommentId
  assert.equal(isTaskComment(legacyReply), false)
  assert.equal(parseTaskComments([comment(1), legacyReply]), null)
  assert.equal(parseTaskComments([comment(1), comment(2, '1')]), null)
  assert.equal(parseTaskComments([comment(1), comment(2, 99)]), null)
  assert.equal(parseTaskComments([comment(1), comment(2, 1), comment(3, 2)]), null)
})

test('notification focus prefers its reply and falls back when comments have been deleted', () => {
  const target = { parentCommentId: 1, replyCommentId: 3 }
  assert.equal(findCommentFocus([comment(1, null, true), comment(3, 1)], target), 3)
  assert.equal(findCommentFocus([comment(1), comment(3, 1, true)], target), 1)
  assert.equal(findCommentFocus([comment(1), comment(2), comment(3, 2)], target), 1)
  assert.equal(findCommentFocus([comment(1, null, true)], target), 1)
  assert.equal(findCommentFocus([], target), undefined)
})
