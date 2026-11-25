import type { Pool } from 'pg'

export type Database = Pick<Pool, 'query'>
export type Row = Record<string, any>
export class ApiError extends Error {
  readonly status: number
  constructor(status: number) {
    super('Collaboration request rejected')
    this.status = status
  }
}
export function requireThat(condition: unknown, status: number): asserts condition {
  if (!condition) throw new ApiError(status)
}
export function id(value: unknown, status = 400) {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
  requireThat(typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0, status)
  return parsed
}
export function nullableId(value: unknown) {
  return value == null ? null : (requireThat(typeof value === 'number', 400), id(value))
}
export function string(value: unknown, max: number, required = true) {
  if (!required && value == null) return null
  requireThat(typeof value === 'string' && [...value].length <= max && !value.includes('\0') &&
    (!required || value.trim().length > 0), 400)
  return value
}
export async function rows(db: Database, statement: string, args: unknown[] = []): Promise<Row[]> {
  return (await db.query(statement, args)).rows
}
export async function first(db: Database, statement: string, args: unknown[] = []): Promise<Row | undefined> {
  return (await rows(db, statement, args))[0]
}
export function shape(row: Row, ...numeric: string[]) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    numeric.includes(key) && value != null ? Number(value) : value,
  ]))
}

export const projectAccess = (project: string, user: string) => `(${project}.owner_id = ${user} OR EXISTS (
  SELECT 1 FROM public.project_members membership WHERE membership.project_id = ${project}.id
  AND membership.user_id = ${user} AND membership.status = 'ACCEPTED'))`

export async function requireProject(db: Database, project: number, user: number, lock: boolean, owner = false) {
  const condition = owner ? 'p.owner_id = $2' : projectAccess('p', '$2')
  const target = await first(db, `SELECT p.id, p.name, p.description, p.owner_id FROM public.projects p
    WHERE p.id = $1 AND ${condition} ${lock ? 'FOR UPDATE OF p' : ''}`, [project, user])
  requireThat(target, 404)
  return target
}

export async function queueAttachments(db: Database, scope: 'project' | 'task', target: number) {
  const filter = scope === 'project' ? 'task.project_id = $1' : 'attachment.task_id = $1'
  await db.query(`INSERT INTO public.attachment_file_deletions (storage_key, next_attempt_at)
    SELECT attachment.storage_key, clock_timestamp() FROM public.task_attachments attachment
    JOIN public.tasks task ON task.id = attachment.task_id WHERE ${filter}
    ON CONFLICT (storage_key) DO NOTHING`, [target])
}
