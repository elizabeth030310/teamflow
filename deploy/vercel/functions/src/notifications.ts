import { first, id, projectAccess, requireThat, rows, shape } from './collaboration-data.ts'
import type { Database } from './collaboration-data.ts'

const visible = `FROM public.notifications notification
  LEFT JOIN public.tasks task ON task.id = notification.task_id
  LEFT JOIN public.project_members invitation ON invitation.id = notification.invitation_id
  JOIN public.projects p ON p.id = COALESCE(task.project_id, invitation.project_id)
  WHERE notification.recipient_id = $1 AND (
    (invitation.id IS NOT NULL AND invitation.user_id = $1 AND invitation.status = 'PENDING')
    OR (task.id IS NOT NULL AND ${projectAccess('p', '$1')})
  )`

export async function generateDeadlines(db: Database, user: number | null = null) {
  const result = await db.query(`INSERT INTO public.notifications (recipient_id, task_id, kind, due_date)
      SELECT recipient.user_id, task.id, CASE WHEN task.due_date < today.date THEN 'OVERDUE' ELSE 'DUE_SOON' END, task.due_date
      FROM public.tasks task JOIN public.projects p ON p.id = task.project_id
      CROSS JOIN (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date AS date) today
      CROSS JOIN LATERAL (SELECT COALESCE(task.assignee_id, p.owner_id) AS user_id) recipient
      JOIN public.users account ON account.id = recipient.user_id AND account.account_status = 'ACTIVE'
      WHERE ($1::bigint IS NULL OR recipient.user_id = $1) AND task.due_date <= today.date + 3
        AND task.status IN ('TODO', 'IN_PROGRESS') AND ${projectAccess('p', 'recipient.user_id')}
      ON CONFLICT (recipient_id, task_id, kind, due_date) DO NOTHING`, [user])
  return result.rowCount ?? 0
}

export async function notificationsApi(db: Database, method: string, path: string[], user: number, url: URL) {
  if (method === 'GET' && !path.length) {
    const page = url.searchParams.get('page') || '0'
    requireThat(/^\d+$/u.test(page) && Number(page) <= 2_147_483_647, 400)
    if (Number(page) === 0) await generateDeadlines(db, user)
    const inbox = await first(db, `WITH visible AS MATERIALIZED (
      SELECT notification.id, p.id AS project_id, task.id AS task_id, task.title AS task_title,
        CASE WHEN invitation.id IS NOT NULL THEN p.name END AS project_name, notification.kind,
        notification.due_date::text AS due_date, notification.created_at, notification.read_at IS NOT NULL AS read,
        notification.actor_name, notification.parent_comment_id, notification.reply_comment_id ${visible}
      ), page AS (SELECT * FROM visible ORDER BY created_at DESC, id DESC LIMIT 31 OFFSET $2)
      SELECT (SELECT count(*) FROM visible WHERE NOT read) AS unread,
        COALESCE((SELECT jsonb_agg(page ORDER BY created_at DESC, id DESC) FROM page), '[]'::jsonb) AS items`,
    [user, Number(page) * 30])
    return [200, { items: inbox!.items.slice(0, 30).map((row: Record<string, unknown>) => shape(row, 'id', 'project_id', 'task_id',
      'parent_comment_id', 'reply_comment_id')), unreadCount: Number(inbox!.unread), hasMore: inbox!.items.length > 30 }] as const
  }
  requireThat(method === 'PATCH', 404)
  if (path.length === 1 && path[0] === 'read-all') {
    await db.query(`UPDATE public.notifications SET read_at = CURRENT_TIMESTAMP WHERE read_at IS NULL
      AND id IN (SELECT notification.id ${visible})`, [user])
    return [204] as const
  }
  requireThat(path.length === 2 && path[1] === 'read', 404)
  const notification = id(path[0])
  const result = await rows(db, `UPDATE public.notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
    WHERE id IN (SELECT notification.id ${visible} AND notification.id = $2) RETURNING id`, [user, notification])
  requireThat(result.length, 404)
  return [204] as const
}
