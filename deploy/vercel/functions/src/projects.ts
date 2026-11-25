import { signupEmail } from './signup.ts'
import { consumePageUpload, isPageVersion, pageContentSegment, pageUploads } from './page-transport.ts'
import { first, id, nullableId, projectAccess, queueAttachments, requireProject, requireThat, rows, shape, string } from './collaboration-data.ts'
import type { Database, Row } from './collaboration-data.ts'

const projectShape = ({ id: identifier, name, description }: Row) => ({ id: Number(identifier), name, description })
const invitationSelect = `SELECT member.id, member.project_id, project.name AS project_name, member.user_id,
  CASE WHEN account.account_status = 'WITHDRAWN' THEN '' ELSE account.email END AS email, member.status
  FROM public.project_members member JOIN public.projects project ON project.id = member.project_id
  JOIN public.users account ON account.id = member.user_id`
const invitationShape = (row: Row) => shape(row, 'id', 'project_id', 'user_id')

async function publishInvitation(db: Database, invitation: number, recipient: number) {
  const result = await db.query(`INSERT INTO public.notifications (recipient_id, invitation_id, kind, created_at)
    VALUES ($1, $2, 'PROJECT_INVITATION', statement_timestamp())
    ON CONFLICT (invitation_id) DO UPDATE SET created_at = EXCLUDED.created_at, read_at = NULL
    WHERE notifications.created_at <= EXCLUDED.created_at - interval '1 minute'`, [recipient, invitation])
  requireThat(result.rowCount, 429)
}

async function invitations(db: Database, method: string, path: string[], user: number, input: Row, project?: number) {
  if (project === undefined) {
    if (path.length === 0 && method === 'GET') return [200, (await rows(db, invitationSelect +
      " WHERE member.user_id = $1 AND member.status = 'PENDING' ORDER BY member.id", [user])).map(invitationShape)] as const
    requireThat(path.length === 2 && method === 'POST' && ['accept', 'reject'].includes(path[1]), 404)
    const invitation = id(path[0])
    const match = await first(db, 'SELECT project_id FROM public.project_members WHERE id = $1 AND user_id = $2', [invitation, user])
    requireThat(match, 404)
    const locked = await first(db, 'SELECT id FROM public.projects WHERE id = $1 FOR UPDATE', [match.project_id])
    requireThat(locked, 404)
    const changed = await db.query(`UPDATE public.project_members SET status = $3 WHERE id = $1 AND user_id = $2 AND status = 'PENDING'`,
      [invitation, user, path[1] === 'accept' ? 'ACCEPTED' : 'REJECTED'])
    requireThat(changed.rowCount, 409)
    return [200, invitationShape((await first(db, invitationSelect + ' WHERE member.id = $1', [invitation]))!)] as const
  }

  const target = await requireProject(db, project, user, method !== 'GET', true)
  if (path.length === 0 && method === 'GET') return [200, (await rows(db, invitationSelect +
    ' WHERE member.project_id = $1 ORDER BY member.id', [project])).map(invitationShape)] as const
  if (path.length === 0 && method === 'POST') {
    const email = signupEmail(typeof input.email === 'string' ? input.email.trim() : null)
    requireThat(email, 400)
    const invitee = await first(db, `SELECT id FROM public.users WHERE lower(email) = lower($1)
      AND account_status = 'ACTIVE' FOR SHARE`, [email])
    requireThat(invitee, 404)
    requireThat(Number(invitee.id) !== Number(target.owner_id), 409)
    const created = await first(db, `INSERT INTO public.project_members (project_id, user_id, status)
      VALUES ($1, $2, 'PENDING') ON CONFLICT (project_id, user_id) DO NOTHING RETURNING id`, [project, invitee.id])
    requireThat(created, 409)
    await publishInvitation(db, Number(created.id), Number(invitee.id))
    return [201, invitationShape((await first(db, invitationSelect + ' WHERE member.id = $1', [created.id]))!)] as const
  }
  requireThat(path.length === 2 && path[1] === 'resend' && method === 'POST', 404)
  const invitation = id(path[0])
  const member = await first(db, invitationSelect + ' WHERE member.id = $1 AND member.project_id = $2', [invitation, project])
  requireThat(member, 404)
  requireThat(member.status === 'PENDING', 409)
  requireThat(await first(db, "SELECT id FROM public.users WHERE id = $1 AND account_status = 'ACTIVE' FOR SHARE", [member.user_id]), 404)
  await publishInvitation(db, invitation, Number(member.user_id))
  return [200, invitationShape(member)] as const
}

const pageColumns = `id, project_id, parent_page_id, title, content, content_format,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`
const pageShape = (row: Row) => shape(row, 'id', 'project_id', 'parent_page_id')

async function pages(db: Database, method: string, path: string[], user: number, project: number, input: Row, query: URLSearchParams) {
  await requireProject(db, project, user, method !== 'GET')
  if (path[0] === 'uploads') return pageUploads(db, method, path.slice(1), project, user, input)
  if (method === 'GET' && path.length === 2 && path[1] === 'content') {
    return [200, await pageContentSegment(db, project, id(path[0]), query.get('version'), query.get('offset'))] as const
  }
  if (method === 'GET' && path.length === 1 && path[0] === 'tree') {
    const tree = await rows(db, `WITH RECURSIVE tree AS (
      SELECT id, parent_page_id, title, 0 AS depth, ARRAY[id] AS path FROM public.project_pages
        WHERE project_id = $1 AND parent_page_id IS NULL
      UNION ALL
      SELECT child.id, child.parent_page_id, child.title, tree.depth + 1, tree.path || child.id
      FROM public.project_pages child JOIN tree ON child.parent_page_id = tree.id
      WHERE child.project_id = $1 AND NOT child.id = ANY(tree.path)
    ) SELECT id, parent_page_id, title, depth FROM tree ORDER BY path`, [project])
    return [200, tree.map(pageShape)] as const
  }

  const page = path.length ? id(path[0]) : null
  const segmented = query.get('segmented') === '1'
  const readColumns = segmented ? pageColumns.replace('title, content,', `title,
    CASE WHEN octet_length(content) <= 400000 THEN content END AS content,
    CASE WHEN octet_length(content) > 400000 THEN char_length(content) END AS content_length,`) : pageColumns
  const current = page === null ? undefined : await first(db, `SELECT ${readColumns} FROM public.project_pages
    WHERE project_id = $1 AND id = $2`, [project, page])
  if (page !== null) requireThat(current, 404)
  if (method === 'GET' && path.length === 1) {
    if (segmented && current!.content_length === null) delete current!.content_length
    return [200, pageShape(current!)] as const
  }
  if (method === 'GET' && (path.length === 0 || (path.length === 2 && path[1] === 'children'))) {
    const children = await rows(db, `SELECT id, parent_page_id, title FROM public.project_pages
      WHERE project_id = $1 AND parent_page_id IS NOT DISTINCT FROM $2::bigint ORDER BY id`, [project, page])
    return [200, children.map(pageShape)] as const
  }
  if (method === 'DELETE' && path.length === 1) {
    requireThat(!await first(db, 'SELECT 1 FROM public.project_pages WHERE project_id = $1 AND parent_page_id = $2 LIMIT 1', [project, page]), 409)
    await db.query('DELETE FROM public.project_pages WHERE project_id = $1 AND id = $2', [project, page])
    return [204] as const
  }

  requireThat((method === 'POST' && path.length === 0) || (method === 'PUT' && path.length === 1), 404)
  const title = string(input.title, 200)!.trim()
  requireThat(input.title.length <= 200, 400)
  const format = input.contentFormat ?? 'plain'
  requireThat(format === 'plain' || format === 'rich-v1', 400)
  const staged = input.contentUploadId !== undefined
  requireThat(!staged || (input.content === undefined && format === 'rich-v1'), 400)
  requireThat(!staged || page === null || isPageVersion(input.expectedUpdatedAt), 400)
  const content = staged ? await consumePageUpload(db, project, user, input.contentUploadId,
    input.contentUploadParts, input.contentUploadSize) : input.content ?? ''
  requireThat(typeof content === 'string' && content.length <= (format === 'plain' ? 100_000 : 6_000_000) &&
    !content.includes('\0'), 400)
  const parent = nullableId(input.parentPageId)
  const expected = input.expectedUpdatedAt
  if (expected != null) {
    requireThat(isPageVersion(expected), 400)
    if (current) {
      const comparable = await first(db, 'SELECT updated_at = $3::timestamptz AS matches FROM public.project_pages WHERE project_id = $1 AND id = $2',
        [project, page, expected])
      requireThat(comparable?.matches, 409)
    }
  }
  if (parent !== null) {
    requireThat(await first(db, 'SELECT 1 FROM public.project_pages WHERE project_id = $1 AND id = $2', [project, parent]), 400)
    if (page !== null) {
      const ancestor = await first(db, `WITH RECURSIVE ancestors AS (
        SELECT id, parent_page_id FROM public.project_pages WHERE project_id = $1 AND id = $2
        UNION SELECT page.id, page.parent_page_id FROM public.project_pages page
        JOIN ancestors ON page.id = ancestors.parent_page_id WHERE page.project_id = $1
      ) SELECT 1 FROM ancestors WHERE id = $3`, [project, parent, page])
      requireThat(!ancestor, 400)
    }
  }

  const returnColumns = staged ? pageColumns.replace('title, content,', 'title,') : pageColumns
  const write = page === null
    ? await first(db, `INSERT INTO public.project_pages (project_id, parent_page_id, title, content, content_format)
      VALUES ($1, $2, $3, $4, $5) RETURNING ${returnColumns}`, [project, parent, title, content, format])
    : await first(db, `UPDATE public.project_pages SET parent_page_id = $2, title = $3, content = $4, content_format = $5,
      updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
      WHERE project_id = $1 AND id = $6 RETURNING ${returnColumns}`, [project, parent, title, content, format, page])
  return [page === null ? 201 : 200, pageShape(write!)] as const
}

export async function projectsApi(db: Database, method: string, path: string[], user: number, input: Row, query: URLSearchParams) {
  if (!path.length && method === 'GET') {
    const projects = await rows(db, `SELECT p.id, p.name, p.description FROM public.projects p
      WHERE ${projectAccess('p', '$1')} ORDER BY p.id`, [user])
    return [200, projects.map(projectShape)] as const
  }
  if (!path.length && method === 'POST') {
    const created = await first(db, 'INSERT INTO public.projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING id, name, description',
      [string(input.name, 255, false), string(input.description, 255, false), user])
    return [201, projectShape(created!)] as const
  }
  if (path[0] === 'invitations') return invitations(db, method, path.slice(1), user, input)
  const project = id(path[0], 404)
  if (path[1] === 'pages') return pages(db, method, path.slice(2), user, project, input, query)
  if (path[1] === 'invitations') return invitations(db, method, path.slice(2), user, input, project)
  if (path.length === 2 && method === 'GET' && path[1] === 'members') {
    const target = await requireProject(db, project, user, false)
    const owner = await first(db, 'SELECT id AS user_id, name FROM public.users WHERE id = $1', [target.owner_id])
    requireThat(owner, 404)
    const members = await rows(db, `SELECT account.id AS user_id, account.name FROM public.users account
      JOIN public.project_members member ON member.user_id = account.id WHERE member.project_id = $1
      AND member.status = 'ACCEPTED' ORDER BY member.id`, [project])
    return [200, [{ ...shape(owner, 'user_id'), role: 'OWNER' }, ...members.map(row => ({ ...shape(row, 'user_id'), role: 'MEMBER' }))]] as const
  }
  if (path.length === 2 && method === 'GET' && path[1] === 'activities') {
    await requireProject(db, project, user, false)
    const activities = await rows(db, `SELECT id, task_id, task_title, type, actor_id, actor_name, created_at,
      previous_status, new_status, previous_assignee_id, new_assignee_id FROM public.task_activities
      WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`, [project])
    return [200, activities.map(row => shape(row, 'id', 'task_id', 'actor_id', 'previous_assignee_id', 'new_assignee_id'))] as const
  }
  requireThat(path.length === 1 && ['GET', 'PUT', 'DELETE'].includes(method), 404)
  const target = await requireProject(db, project, user, method !== 'GET', method !== 'GET')
  if (method === 'GET') return [200, projectShape(target)] as const
  if (method === 'PUT') {
    const updated = await first(db, 'UPDATE public.projects SET name = $2, description = $3 WHERE id = $1 RETURNING id, name, description',
      [project, string(input.name, 255, false), string(input.description, 255, false)])
    return [200, projectShape(updated!)] as const
  }
  await queueAttachments(db, 'project', project)
  await db.query('DELETE FROM public.projects WHERE id = $1', [project])
  return [204] as const
}
