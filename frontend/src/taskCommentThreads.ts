export type TaskComment = {
  id: number
  authorId: number
  authorName: string
  content: string | null
  createdAt: string
  parentCommentId: number | null
  deleted: boolean
}

export type CommentFocusTarget = {
  parentCommentId: number
  replyCommentId: number | null
}

export function findCommentFocus(comments: TaskComment[], target: CommentFocusTarget) {
  const reply = comments.find((comment) => comment.id === target.replyCommentId
    && comment.parentCommentId === target.parentCommentId && !comment.deleted)
  if (reply) return reply.id
  return comments.find((comment) => comment.id === target.parentCommentId
    && comment.parentCommentId === null)?.id
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function isTaskComment(value: unknown): value is TaskComment {
  if (typeof value !== 'object' || value === null) return false
  const comment = value as Partial<Record<keyof TaskComment, unknown>>
  return isId(comment.id)
    && isId(comment.authorId)
    && typeof comment.authorName === 'string'
    && (comment.content === null || typeof comment.content === 'string')
    && typeof comment.createdAt === 'string' && Number.isFinite(Date.parse(comment.createdAt))
    && (comment.parentCommentId === null || isId(comment.parentCommentId))
    && typeof comment.deleted === 'boolean'
}

export function parseTaskComments(value: unknown): TaskComment[] | null {
  if (!Array.isArray(value) || !value.every(isTaskComment)) return null
  const parentIds = new Set(value.filter((comment) => comment.parentCommentId === null).map((comment) => comment.id))
  return value.every((comment) => comment.parentCommentId === null || parentIds.has(comment.parentCommentId))
    ? value
    : null
}

export function groupTaskComments(comments: TaskComment[]) {
  const parents: TaskComment[] = []
  const repliesByParent = new Map<number, TaskComment[]>()
  for (const comment of comments) {
    if (comment.parentCommentId === null) {
      parents.push(comment)
    } else {
      const replies = repliesByParent.get(comment.parentCommentId) ?? []
      replies.push(comment)
      repliesByParent.set(comment.parentCommentId, replies)
    }
  }
  return { parents, repliesByParent }
}
