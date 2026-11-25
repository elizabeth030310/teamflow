import { first, id, nullableId, projectAccess, queueAttachments, requireProject, requireThat, rows, shape, string } from './collaboration-data.ts'
import type { Database, Row } from './collaboration-data.ts'

const taskColumns = 'id, project_id, title, description, status, priority, due_date::text AS due_date, assignee_id'
const taskShape = (row: Row) => shape(row, 'id', 'project_id', 'assignee_id', 'checklist_completed', 'checklist_total')
const priorities = ['HIGH', 'MEDIUM', 'LOW']
const statuses = ['TODO', 'IN_PROGRESS', 'DONE']

function dueDate(value: unknown) {
  if (value == null) return null
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\d$/u.test(value) && !value.startsWith('0000'), 400)
  const date = new Date(value + 'T00:00:00Z')
  requireThat(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value, 400)
  return value
}

async function loadTask(db: Database, task: number, user: number, lock: boolean) {
  const entry = await first(db, `SELECT ${taskColumns} FROM public.tasks WHERE id = $1`, [task])
  requireThat(entry?.project_id != null, 404)
  await requireProject(db, Number(entry.project_id), user, lock)
  if (!lock) return entry
  const current = await first(db, `SELECT ${taskColumns} FROM public.tasks WHERE id = $1 FOR UPDATE`, [task])
  requireThat(current, 404)
  return current
}

async function activity(db: Database, task: Row, user: number, type: string, from: unknown = null, to: unknown = null) {
  const status = type === 'TASK_STATUS_CHANGED'
  const assignment = type === 'TASK_ASSIGNEE_CHANGED'
  await db.query(`INSERT INTO public.task_activities (project_id, task_id, task_title, type, actor_id, actor_name, created_at,
    previous_status, new_status, previous_assignee_id, new_assignee_id)
    SELECT $1, $2, $3, $4, id, name, clock_timestamp(), $6, $7, $8, $9 FROM public.users WHERE id = $5`,
  [task.project_id, task.id, task.title, type, user, status ? from : null, status ? to : null,
    assignment ? from : null, assignment ? to : null])
}

async function checklist(db: Database, method: string, path: string[], task: number, input: Row) {
  if (method === 'GET' && !path.length) {
    const items = await rows(db, 'SELECT id, title, completed FROM public.task_checklist_items WHERE task_id = $1 ORDER BY id', [task])
    return [200, items.map(row => shape(row, 'id'))] as const
  }
  if (method === 'POST' && !path.length) {
    const title = string((typeof input.title === 'string' ? input.title.trim() : input.title), 200)!
    const item = await first(db, `INSERT INTO public.task_checklist_items (task_id, title, completed)
      VALUES ($1, $2, false) RETURNING id, title, completed`, [task, title])
    return [201, shape(item!, 'id')] as const
  }
  requireThat(path.length === 1 && ['PATCH', 'DELETE'].includes(method), 404)
  const item = id(path[0])
  if (method === 'DELETE') {
    requireThat((await db.query('DELETE FROM public.task_checklist_items WHERE task_id = $1 AND id = $2', [task, item])).rowCount, 404)
    return [204] as const
  }
  requireThat(typeof input.completed === 'boolean', 400)
  const updated = await first(db, `UPDATE public.task_checklist_items SET completed = $3 WHERE task_id = $1 AND id = $2
    RETURNING id, title, completed`, [task, item, input.completed])
  requireThat(updated, 404)
  return [200, shape(updated, 'id')] as const
}

const commentSelect = `SELECT c.id, c.task_id, c.author_id, u.name AS author_name, c.content, c.created_at,
  c.parent_comment_id, c.deleted FROM public.task_comments c JOIN public.users u ON u.id = c.author_id`
const commentShape = (row: Row) => shape(row, 'id', 'task_id', 'author_id', 'parent_comment_id')
const commentById = (db: Database, task: string, comment: number | string) => first(db, commentSelect + ' WHERE c.task_id = $1 AND c.id = $2', [task, comment])
const commentContent = (input: unknown) => string(typeof input === 'string' ? input.trim() : input, 1000)!

async function comments(db: Database, method: string, path: string[], task: Row, user: number, input: Row) {
  if (method === 'GET' && !path.length) {
    const found = await rows(db, commentSelect + ' WHERE c.task_id = $1 ORDER BY c.created_at, c.id', [task.id])
    return [200, found.map(commentShape)] as const
  }
  if (method === 'POST' && !path.length) {
    const content = commentContent(input.content)
    const parent = nullableId(input.parentCommentId)
    let root: Row | undefined
    if (parent !== null) {
      root = await commentById(db, task.id, parent)
      requireThat(root && !root.deleted, 404)
      requireThat(root.parent_comment_id === null, 400)
    }
    const created = await first(db, `INSERT INTO public.task_comments (task_id, author_id, parent_comment_id, content, created_at)
      VALUES ($1, $2, $3, $4, clock_timestamp()) RETURNING id`, [task.id, user, parent, content])
    const saved = (await commentById(db, task.id, created!.id))!
    await activity(db, task, user, 'COMMENT_CREATED')
    if (root) {
      if (Number(root.author_id) !== user) await db.query(`
        INSERT INTO public.notifications (recipient_id, task_id, kind, actor_name, parent_comment_id, reply_comment_id)
        SELECT $2, $1, 'COMMENT_REPLY', $3, $4, $5 FROM public.projects p WHERE p.id = $6 AND ${projectAccess('p', '$2')}`,
      [task.id, root.author_id, saved.author_name, parent, saved.id, task.project_id])
    } else {
      await db.query(`INSERT INTO public.notifications (recipient_id, task_id, kind)
        SELECT recipient.user_id, task.id, 'COMMENT' FROM public.tasks task JOIN public.projects p ON p.id = task.project_id
        CROSS JOIN LATERAL (SELECT p.owner_id AS user_id UNION SELECT task.assignee_id
          UNION SELECT author_id FROM public.task_comments WHERE task_id = task.id AND NOT deleted) recipient
        WHERE task.id = $1 AND recipient.user_id <> $2 AND ${projectAccess('p', 'recipient.user_id')}`, [task.id, user])
    }
    return [201, commentShape(saved)] as const
  }

  requireThat(path.length === 1 && ['PATCH', 'DELETE'].includes(method), 404)
  const identifier = id(path[0])
  const current = await commentById(db, task.id, identifier)
  requireThat(current && !current.deleted, 404)
  requireThat(Number(current.author_id) === user, 403)
  if (method === 'PATCH') {
    requireThat(!Object.hasOwn(input, 'parentCommentId'), 400)
    await db.query('UPDATE public.task_comments SET content = $2 WHERE id = $1', [identifier, commentContent(input.content)])
    return [200, commentShape((await commentById(db, task.id, identifier))!)] as const
  }
  const hasReplies = await first(db, 'SELECT 1 FROM public.task_comments WHERE task_id = $1 AND parent_comment_id = $2 LIMIT 1',
    [task.id, identifier])
  if (current.parent_comment_id === null && hasReplies) {
    await db.query("UPDATE public.task_comments SET content = '', deleted = true WHERE id = $1", [identifier])
  } else {
    await db.query('DELETE FROM public.task_comments WHERE id = $1', [identifier])
  }
  await activity(db, task, user, 'COMMENT_DELETED')
  return [204] as const
}

export async function tasksApi(db: Database, method: string, path: string[], user: number, input: Row) {
  if (!path.length && method === 'POST') {
    requireThat(typeof input.projectId === 'number', 400)
    const project = id(input.projectId)
    await requireProject(db, project, user, true)
    const title = string(input.title, 255)!.trim()
    const status = typeof input.status === 'string' && !input.status.trim() || input.status == null ? 'TODO' : input.status
    const priority = typeof input.priority === 'string' && !input.priority.trim() || input.priority == null ? 'MEDIUM' : input.priority
    requireThat(statuses.includes(status) && priorities.includes(priority), 400)
    const created = await first(db, `INSERT INTO public.tasks (project_id, title, description, status, priority, due_date)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${taskColumns}`,
    [project, title, string(input.description, 255, false), status, priority, dueDate(input.dueDate)])
    await activity(db, created!, user, 'TASK_CREATED')
    return [201, taskShape(created!)] as const
  }
  if (path.length === 2 && path[0] === 'project' && method === 'GET') {
    const project = id(path[1])
    await requireProject(db, project, user, false)
    const found = await rows(db, `SELECT ${taskColumns}, progress.checklist_completed, progress.checklist_total FROM public.tasks task
      CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE completed) AS checklist_completed, count(*) AS checklist_total
        FROM public.task_checklist_items WHERE task_id = task.id) progress
      WHERE task.project_id = $1 ORDER BY task.id`, [project])
    return [200, found.map(taskShape)] as const
  }

  const identifier = id(path[0], 404)
  const task = await loadTask(db, identifier, user, method !== 'GET')
  if (path[1] === 'checklist-items') return checklist(db, method, path.slice(2), identifier, input)
  if (path[1] === 'comments') return comments(db, method, path.slice(2), task, user, input)
  if (path.length === 1 && method === 'PUT') {
    const priority = input.priority ?? null
    requireThat(priority === null || priorities.includes(priority), 400)
    const saved = await first(db, `UPDATE public.tasks SET title = $2, description = $3, priority = COALESCE($4, priority), due_date = $5
      WHERE id = $1 RETURNING ${taskColumns}`, [identifier, string(input.title, 255)!.trim(),
      string(input.description, 255, false), priority, dueDate(input.dueDate)])
    return [200, taskShape(saved!)] as const
  }
  if (path.length === 1 && method === 'DELETE') {
    await queueAttachments(db, 'task', identifier)
    await activity(db, task, user, 'TASK_DELETED')
    await db.query('DELETE FROM public.tasks WHERE id = $1', [identifier])
    return [204] as const
  }
  if (path.length === 2 && method === 'PATCH' && path[1] === 'status') {
    requireThat(statuses.includes(input.status), 400)
    if (task.status === input.status) return [200, taskShape(task)] as const
    const saved = await first(db, `UPDATE public.tasks SET status = $2 WHERE id = $1 RETURNING ${taskColumns}`, [identifier, input.status])
    await activity(db, task, user, 'TASK_STATUS_CHANGED', task.status, input.status)
    return [200, taskShape(saved!)] as const
  }
  requireThat(path.length === 2 && method === 'PATCH' && path[1] === 'assignee', 404)
  requireThat(Object.hasOwn(input, 'assigneeId'), 400)
  requireThat(input.assigneeId === null || Number.isSafeInteger(input.assigneeId), 400)
  const assignee = input.assigneeId
  if (assignee !== null) requireThat(await first(db, `SELECT 1 FROM public.projects p
    WHERE p.id = $1 AND ${projectAccess('p', '$2')}`, [task.project_id, assignee]), 400)
  if ((task.assignee_id === null ? null : Number(task.assignee_id)) === assignee) return [200, taskShape(task)] as const
  const saved = await first(db, `UPDATE public.tasks SET assignee_id = $2 WHERE id = $1 RETURNING ${taskColumns}`, [identifier, assignee])
  await activity(db, task, user, 'TASK_ASSIGNEE_CHANGED', task.assignee_id, assignee)
  if (assignee !== null && assignee !== user) await db.query(`
    INSERT INTO public.notifications (recipient_id, task_id, kind) VALUES ($1, $2, 'ASSIGNMENT')`, [assignee, identifier])
  return [200, taskShape(saved!)] as const
}
