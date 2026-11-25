import { createHash, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import { json } from './auth.ts'
import { transaction } from './auth-store.ts'
import { privateBlob } from './blob-storage.ts'
import type { AttachmentStorage } from './blob-storage.ts'
import { rows } from './collaboration-data.ts'
import { databasePool } from './database.ts'
import { generateDeadlines } from './notifications.ts'

const digest = (value: string) => createHash('sha256').update(value).digest()

export async function cleanupAttachments(pool: Pool, storage: AttachmentStorage | null) {
  const queued = await pool.query(`WITH expired AS (
    SELECT storage_key FROM public.teamflow_attachment_uploads WHERE expires_at <= statement_timestamp()
    ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
  ), removed AS (
    DELETE FROM public.teamflow_attachment_uploads upload USING expired
    WHERE upload.storage_key = expired.storage_key RETURNING upload.storage_key
  ) INSERT INTO public.attachment_file_deletions (storage_key, next_attempt_at)
  SELECT storage_key, clock_timestamp() FROM removed ON CONFLICT DO NOTHING`)
  if (!storage) return { queued: queued.rowCount ?? 0, removed: 0, retried: 0 }

  const work = await rows(pool, `WITH ready AS (
    SELECT storage_key FROM public.attachment_file_deletions WHERE next_attempt_at <= statement_timestamp()
    ORDER BY next_attempt_at LIMIT 40 FOR UPDATE SKIP LOCKED
  ) UPDATE public.attachment_file_deletions pending SET next_attempt_at = clock_timestamp() + interval '3 minutes'
    FROM ready WHERE pending.storage_key = ready.storage_key RETURNING pending.storage_key`)
  let removed = 0
  let retried = 0
  for (let offset = 0; offset < work.length; offset += 8) {
    await Promise.all(work.slice(offset, offset + 8).map(async ({ storage_key: key }) => {
      try {
        await storage.remove(key)
        await pool.query('DELETE FROM public.attachment_file_deletions WHERE storage_key = $1', [key])
        removed += 1
      } catch {
        retried += 1
      }
    }))
  }
  return { queued: queued.rowCount ?? 0, removed, retried }
}

export function maintenanceHandler(getPool: () => Pool, getStorage: () => AttachmentStorage | null, getSecret: () => string | undefined) {
  return async (request: Request) => {
    if (request.method !== 'GET') return json(405, { status: 'method_not_allowed' }, { Allow: 'GET' })
    const secret = getSecret()
    if (!secret || secret.length < 32 ||
        !timingSafeEqual(digest(request.headers.get('Authorization') ?? ''), digest('Bearer ' + secret))) {
      return json(401, { status: 'unauthorized' })
    }
    try {
      const pool = getPool()
      const daily = await transaction(pool, async client => {
        const notices = await generateDeadlines(client)
        const sessions = await client.query('DELETE FROM public.teamflow_sessions WHERE expires_at <= statement_timestamp()')
        const verifications = await client.query('DELETE FROM public.signup_verifications WHERE expires_at <= statement_timestamp()')
        const limits = await client.query('DELETE FROM public.signup_send_limits WHERE window_ends_at <= statement_timestamp()')
        const pages = await client.query('DELETE FROM public.teamflow_page_uploads WHERE expires_at <= statement_timestamp()')
        return { notices, sessions: sessions.rowCount, verifications: verifications.rowCount, limits: limits.rowCount, pages: pages.rowCount }
      })
      const attachments = await cleanupAttachments(pool, getStorage())
      return json(200, { ...daily, attachments })
    } catch {
      console.error('TeamFlow: maintenance job failed')
      return json(503, { status: 'unavailable' })
    }
  }
}

export const maintenance = { fetch: maintenanceHandler(databasePool, () => privateBlob(process.env), () => process.env.CRON_SECRET) }
