import type { Pool, PoolClient } from 'pg'

type Account = {
  id: string
  name: string
  email: string
  role: 'USER' | 'ADMIN'
}
export type LoginAccount = Account & {
  password: string
  account_status: 'ACTIVE' | 'SUSPENDED'
  access_revision: string
}

export const sessionLifetimeSeconds = 30 * 60

export function publicAccount(account: Account) {
  const id = Number(account.id)
  if (!Number.isSafeInteger(id)) throw new Error('Account ID exceeds the JSON numeric range')
  return { id, name: account.name, email: account.email, role: account.role }
}

export async function transaction<Result>(pool: Pool, action: (client: PoolClient) => Promise<Result>) {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('BEGIN')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      broken = true
    }
    throw error
  } finally {
    client.release(broken)
  }
}

export function authStore(pool: Pool) {
  return {
    async reserveLogin(address: string, email: string): Promise<boolean> {
      return transaction(pool, async (client) => {
        const lock = await client.query('SELECT singleton FROM public.teamflow_login_window WHERE singleton FOR UPDATE')
        if (!lock.rowCount) throw new Error('Login limit window is missing')
        const reset = await client.query(`
          UPDATE public.teamflow_login_window SET expires_at = clock_timestamp() + interval '1 minute'
          WHERE singleton AND expires_at <= clock_timestamp()
        `)
        if (reset.rowCount) await client.query('DELETE FROM public.teamflow_login_limits')
        const buckets = await client.query<{ scope: string; attempts: number }>(`
          SELECT scope, attempts FROM public.teamflow_login_limits
          WHERE (scope, bucket) IN (('global', ''), ('address', $1), ('account', $2))
        `, [address, email])
        const limits = new Map([['global', 300], ['address', 20], ['account', 30]])
        if (buckets.rows.some(({ scope, attempts }) => attempts >= limits.get(scope)!)) return false

        await client.query(`
          INSERT INTO public.teamflow_login_limits (scope, bucket, attempts)
          VALUES ('global', '', 1), ('address', $1, 1), ('account', $2, 1)
          ON CONFLICT (scope, bucket) DO UPDATE SET attempts = teamflow_login_limits.attempts + 1
        `, [address, email])
        return true
      })
    },

    async findLogin(email: string, legacyEmail: string): Promise<LoginAccount | undefined> {
      const result = await pool.query<LoginAccount>(`
        SELECT id, name, email, role, password, account_status, access_revision
        FROM public.users
        WHERE account_status <> 'WITHDRAWN' AND lower(email) IN (lower($1), lower($2))
        ORDER BY (lower(email) = lower($1)) DESC, id
        LIMIT 1
      `, [email, legacyEmail])
      return result.rows[0]
    },

    async startSession(account: LoginAccount, tokenHash: Buffer, oldHash: Buffer | null) {
      return transaction(pool, async (client) => {
        const result = await client.query<Account>(`
          WITH eligible AS (
            SELECT id, name, email, role, access_revision FROM public.users
            WHERE id = $1 AND access_revision = $2 AND password = $3 AND account_status = 'ACTIVE'
            FOR SHARE
          ), inserted AS (
            INSERT INTO public.teamflow_sessions (token_hash, user_id, access_revision, expires_at)
            SELECT $4, id, access_revision, clock_timestamp() + $5::int * interval '1 second' FROM eligible
            RETURNING user_id
          )
          SELECT id, name, email, role FROM eligible JOIN inserted ON inserted.user_id = eligible.id
        `, [account.id, account.access_revision, account.password, tokenHash, sessionLifetimeSeconds])
        const current = result.rows[0]
        if (current && oldHash) {
          await client.query('DELETE FROM public.teamflow_sessions WHERE token_hash = $1', [oldHash])
        }
        if (current) {
          await client.query(`
            DELETE FROM public.teamflow_sessions WHERE token_hash IN (
              SELECT token_hash FROM public.teamflow_sessions
              WHERE expires_at <= clock_timestamp() ORDER BY expires_at LIMIT 64 FOR UPDATE SKIP LOCKED
            )
          `)
        }
        return current
      })
    },

    async currentSession(tokenHash: Buffer): Promise<Account | undefined> {
      const result = await pool.query<Account>(`
        UPDATE public.teamflow_sessions AS session
        SET expires_at = GREATEST(session.expires_at, clock_timestamp() + $2::int * interval '1 second')
        FROM public.users AS account
        WHERE session.token_hash = $1 AND session.expires_at > clock_timestamp()
          AND account.id = session.user_id AND account.account_status = 'ACTIVE'
          AND session.access_revision = account.access_revision
        RETURNING account.id, account.name, account.email, account.role
      `, [tokenHash, sessionLifetimeSeconds])
      return result.rows[0]
    },

    async endSession(tokenHash: Buffer) {
      await pool.query('DELETE FROM public.teamflow_sessions WHERE token_hash = $1', [tokenHash])
    },
  }
}
