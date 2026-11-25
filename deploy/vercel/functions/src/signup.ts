import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { domainToASCII } from 'node:url'
import { hash } from 'bcryptjs'
import type { Pool, PoolClient } from 'pg'
import { transaction } from './auth-store.ts'

type Challenge = { salt: string; code_mac: Buffer | null; expired: boolean; resend_seconds: number; failed_attempts: number }

export class SignupThrottle extends Error {
  readonly seconds: number
  constructor(seconds: number) {
    super('Signup limit reached')
    this.seconds = Math.max(1, seconds)
  }
}

export function signupKey(encoded: string | undefined): Buffer | null {
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const decoded = Buffer.from(encoded, 'base64')
  return decoded.length >= 32 && decoded.toString('base64').replace(/=+$/, '') === encoded.replace(/=+$/, '')
    ? decoded : null
}

export function signupEmail(input: unknown) {
  if (typeof input !== 'string' || input.length > 255) return null
  const at = input.lastIndexOf('@')
  if (at < 1 || at > 64) return null
  const local = input.slice(0, at)
  const domain = input.slice(at + 1)
  const atom = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+$/u
  if (!local.split('.').every(part => atom.test(part)) &&
      !/^"(?:[^"\\\u0000-\u001f\u007f]|\\[^\u0000-\u001f\u007f])+"$/u.test(local)) return null
  if (!domain || /[\s\u0000-\u001f\u007f/:?#@\\%]/u.test(domain) ||
      !domainToASCII(domain).split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null
  const email = input.toLowerCase()
  return email.length <= 255 ? email : null
}

function signupMac(key: Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest()
}

async function reserve(client: PoolClient, scope: string, maximum: number) {
  const result = await client.query(`
    INSERT INTO public.signup_send_limits (scope_key, window_ends_at, sends)
    VALUES ($1, clock_timestamp() + interval '1 hour', 1)
    ON CONFLICT (scope_key) DO UPDATE SET
      sends = CASE WHEN signup_send_limits.window_ends_at <= clock_timestamp() THEN 1 ELSE signup_send_limits.sends + 1 END,
      window_ends_at = CASE WHEN signup_send_limits.window_ends_at <= clock_timestamp()
        THEN clock_timestamp() + interval '1 hour' ELSE signup_send_limits.window_ends_at END
    WHERE signup_send_limits.window_ends_at <= clock_timestamp() OR signup_send_limits.sends < $2
    RETURNING window_ends_at
  `, [scope, maximum])
  if (!result.rowCount) {
    const limit = await client.query<{ seconds: number }>(`
      SELECT CEIL(EXTRACT(EPOCH FROM window_ends_at - clock_timestamp()))::int AS seconds
      FROM public.signup_send_limits WHERE scope_key = $1`, [scope])
    throw new SignupThrottle(limit.rows[0]?.seconds ?? 1)
  }
}

async function lockChallenge(client: PoolClient, emailKey: string) {
  const result = await client.query<Challenge>(`
    SELECT salt, code_mac, expires_at <= clock_timestamp() AS expired,
      CEIL(EXTRACT(EPOCH FROM resend_at - clock_timestamp()))::int AS resend_seconds, failed_attempts
    FROM public.signup_verifications WHERE email_key = $1 FOR UPDATE`, [emailKey])
  return result.rows[0]
}

export function signupStore(pool: Pool, key: Buffer) {
  const emailKeyOf = (email: string) => signupMac(key, 'email:' + email).toString('hex')
  const codeMac = (emailKey: string, salt: string, code: string) => signupMac(key, `code:${emailKey}:${salt}:${code}`)
  const matches = (challenge: Challenge, emailKey: string, code: string) =>
    challenge.code_mac?.length === 32 && timingSafeEqual(challenge.code_mac, codeMac(emailKey, challenge.salt, code))

  return {
    async issue(email: string, address: string) {
      const emailKey = emailKeyOf(email)
      return transaction(pool, async client => {
        await reserve(client, 'ip:' + signupMac(key, 'ip:' + address).toString('hex'), 20)
        await reserve(client, 'email:' + emailKey, 5)
        const previous = await lockChallenge(client, emailKey)
        if (previous && previous.resend_seconds > 0) throw new SignupThrottle(previous.resend_seconds)
        await reserve(client, 'global', 300)
        const registered = (await client.query<{ registered: boolean }>(`
          SELECT EXISTS (SELECT 1 FROM public.users WHERE lower(email) = lower($1)
            AND account_status <> 'WITHDRAWN') AS registered
        `, [email])).rows[0].registered
        const salt = randomUUID()
        let code: string
        do {
          code = String(randomInt(1_000_000)).padStart(6, '0')
        } while (previous && matches(previous, emailKey, code))
        await client.query(`
          INSERT INTO public.signup_verifications (email_key, salt, code_mac, expires_at, resend_at, failed_attempts)
          VALUES ($1, $2, $3, clock_timestamp() + interval '5 minutes', clock_timestamp() + interval '1 minute', 0)
          ON CONFLICT (email_key) DO UPDATE SET salt = EXCLUDED.salt, code_mac = EXCLUDED.code_mac,
            expires_at = EXCLUDED.expires_at, resend_at = EXCLUDED.resend_at, failed_attempts = 0
        `, [emailKey, salt, registered ? null : codeMac(emailKey, salt, code)])
        await client.query(`
          DELETE FROM public.signup_verifications WHERE email_key IN (
            SELECT email_key FROM public.signup_verifications WHERE expires_at <= statement_timestamp()
            ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED
          )
        `)
        await client.query(`
          DELETE FROM public.signup_send_limits WHERE scope_key IN (
            SELECT scope_key FROM public.signup_send_limits WHERE window_ends_at <= statement_timestamp()
            ORDER BY window_ends_at LIMIT 32 FOR UPDATE SKIP LOCKED
          )
        `)
        return registered ? null : code
      })
    },

    async complete(email: string, name: string, password: string, code: string) {
      const emailKey = emailKeyOf(email)
      return transaction(pool, async client => {
        const challenge = await lockChallenge(client, emailKey)
        if (!challenge?.code_mac || challenge.failed_attempts >= 5 || challenge.expired) return
        if (!matches(challenge, emailKey, code)) {
          await client.query(`
            UPDATE public.signup_verifications SET failed_attempts = failed_attempts + 1,
              code_mac = CASE WHEN failed_attempts >= 4 THEN NULL ELSE code_mac END WHERE email_key = $1
          `, [emailKey])
          return
        }
        await client.query('UPDATE public.signup_verifications SET code_mac = NULL WHERE email_key = $1', [emailKey])
        const result = await client.query<{ id: string; name: string; email: string }>(`
          INSERT INTO public.users (name, email, password, created_at) VALUES ($1, $2, $3, LOCALTIMESTAMP)
          ON CONFLICT (lower(email)) WHERE account_status <> 'WITHDRAWN' DO NOTHING RETURNING id, name, email
        `, [name, email, await hash(password, 10)])
        return result.rows[0]
      })
    },
  }
}
