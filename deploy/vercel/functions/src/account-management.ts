import { compare, hash } from 'bcryptjs'
import type { Pool, PoolClient } from 'pg'
import { publicAccount, transaction } from './auth-store.ts'

export type Status = 'ACTIVE' | 'SUSPENDED' | 'WITHDRAWN'
type AccountRow = {
  id: string; name: string; email: string; role: 'USER' | 'ADMIN'; account_status: Status; access_revision: string
}
type PasswordRow = AccountRow & { password: string }
type AuditRow = {
  id: string; actor_id: string; target_id: string; from_status: Status; to_status: Status; reason: string; occurred_at: Date
}

export function accountStatus(input: unknown): input is Status {
  return input === 'ACTIVE' || input === 'SUSPENDED' || input === 'WITHDRAWN'
}

async function lockActor(client: PoolClient, session: Buffer) {
  const account = (await client.query<AccountRow>(`
    SELECT id, role, account_status, access_revision FROM public.users
    WHERE id = (SELECT user_id FROM public.teamflow_sessions WHERE token_hash = $1) FOR UPDATE
  `, [session])).rows[0]
  if (account?.account_status !== 'ACTIVE') return
  const valid = await client.query(`
    SELECT 1 FROM public.teamflow_sessions WHERE token_hash = $1 AND user_id = $2
      AND access_revision = $3 AND expires_at > clock_timestamp() FOR UPDATE
  `, [session, account.id, account.access_revision])
  if (valid.rowCount) return account
}

export async function changePassword(pool: Pool, session: Buffer, id: number, current: string, replacement: string) {
  const snapshot = (await pool.query<PasswordRow>(
    'SELECT password, access_revision FROM public.users WHERE id = $1', [id])).rows[0]
  if (!snapshot) return 401
  if (Buffer.byteLength(current) > 72 || !await compare(current, snapshot.password)) return 400
  const replacementHash = await hash(replacement, 10)
  return transaction(pool, async client => {
    const actor = await lockActor(client, session)
    if (!actor) return 401
    const updated = await client.query(`
      UPDATE public.users SET password = $1, access_revision = access_revision + 1
      WHERE id = $2 AND password = $3 AND access_revision = $4
    `, [replacementHash, actor.id, snapshot.password, snapshot.access_revision])
    if (!updated.rowCount) return 409
    await client.query('DELETE FROM public.teamflow_sessions WHERE token_hash = $1', [session])
    return 200
  })
}

export async function changeStatus(pool: Pool, session: Buffer, targetId: string, status: Status, revision: number, reason: string) {
  return transaction(pool, async client => {
    const actor = await lockActor(client, session)
    if (!actor) return 401
    if (actor.role !== 'ADMIN' || actor.id === targetId) return 403
    const target = (await client.query<AccountRow>(
      'SELECT id, role, account_status, access_revision FROM public.users WHERE id = $1 FOR UPDATE', [targetId])).rows[0]
    if (!target) return 404
    if (target.role !== 'USER') return 403
    const previousRevision = BigInt(target.access_revision)
    const requestedRevision = BigInt(revision)
    if (target.account_status === status && previousRevision - 1n === requestedRevision) {
      const audit = await client.query(`SELECT 1 FROM public.admin_member_audit
        WHERE target_id = $1 AND target_revision = $2 AND actor_id = $3 AND reason = $4`,
      [targetId, target.access_revision, actor.id, reason])
      if (audit.rowCount) return 204
    }
    if (previousRevision !== requestedRevision || target.account_status === status || target.account_status === 'WITHDRAWN') return 409

    const nextRevision = (previousRevision + 1n).toString()
    await client.query('UPDATE public.users SET account_status = $1, access_revision = $2 WHERE id = $3',
      [status, nextRevision, targetId])
    await client.query(`INSERT INTO public.admin_member_audit
      (actor_id, target_id, from_status, to_status, target_revision, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.id, targetId, target.account_status, status, nextRevision, reason])
    return 204
  })
}

export async function members(pool: Pool) {
  const { rows } = await pool.query<AccountRow>(
    'SELECT id, name, email, role, account_status, access_revision FROM public.users ORDER BY id')
  return rows.map(row => ({ ...publicAccount(row), status: row.account_status, revision: Number(row.access_revision) }))
}

export async function memberStats(pool: Pool) {
  const { rows } = await pool.query<Record<'total' | 'active' | 'suspended' | 'withdrawn', string>>(`
    SELECT count(*) AS total, count(*) FILTER (WHERE account_status = 'ACTIVE') AS active,
      count(*) FILTER (WHERE account_status = 'SUSPENDED') AS suspended,
      count(*) FILTER (WHERE account_status = 'WITHDRAWN') AS withdrawn
    FROM public.users WHERE role = 'USER'
  `)
  const counts = rows[0]
  return { total: Number(counts.total), active: Number(counts.active), suspended: Number(counts.suspended), withdrawn: Number(counts.withdrawn) }
}

export async function auditEntries(pool: Pool, cursor: string, status: string, limit: number) {
  const { rows } = await pool.query<AuditRow>(`
    SELECT id, actor_id, target_id, from_status, to_status, reason, occurred_at FROM public.admin_member_audit
    WHERE id <= $1 AND ($2 = '' OR to_status = $2) ORDER BY id DESC LIMIT $3
  `, [cursor, status, limit])
  return rows.map(row => ({
    entry: { id: Number(row.id), actorId: Number(row.actor_id), targetId: Number(row.target_id), fromStatus: row.from_status,
      toStatus: row.to_status, reason: row.reason, occurredAt: row.occurred_at.toISOString() },
    cursor: row.id,
  }))
}
