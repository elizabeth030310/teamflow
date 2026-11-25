import { randomUUID } from 'node:crypto'
import { first, requireThat } from './collaboration-data.ts'
import type { Database, Row } from './collaboration-data.ts'

const uploadIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const segmentSize = 400_000

export function isPageVersion(input: unknown): input is string {
  return typeof input === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/u.test(input)
    && Number.isFinite(Date.parse(input))
}

export async function pageUploads(db: Database, method: string, path: string[], project: number, user: number, input: Row) {
  if (method === 'POST' && path.length === 0) {
    const uploadId = randomUUID()
    await db.query(`INSERT INTO public.teamflow_page_uploads (user_id, project_id, upload_id, expires_at)
      VALUES ($1, $2, $3, clock_timestamp() + interval '20 minutes')
      ON CONFLICT (user_id) DO UPDATE SET project_id = EXCLUDED.project_id, upload_id = EXCLUDED.upload_id,
      content = '', next_part = 0, expires_at = EXCLUDED.expires_at`, [user, project, uploadId])
    await db.query(`DELETE FROM public.teamflow_page_uploads WHERE user_id IN (
      SELECT user_id FROM public.teamflow_page_uploads WHERE expires_at <= statement_timestamp()
      ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED
    )`)
    return [201, { uploadId }] as const
  }

  requireThat(method === 'PUT' && path.length === 2 && uploadIdPattern.test(path[0]) && /^\d{1,2}$/u.test(path[1]), 404)
  const part = Number(path[1])
  const content = input.content
  requireThat(part < 24 && typeof content === 'string' && content.length > 0 && content.length <= segmentSize &&
    !content.includes('\0') && content.isWellFormed(), 400)
  const upload = await first(db, `UPDATE public.teamflow_page_uploads SET content = content || $5, next_part = next_part + 1
    WHERE user_id = $1 AND project_id = $2 AND upload_id = $3 AND next_part = $4
      AND expires_at > clock_timestamp() AND char_length(content) + char_length($5) <= 6000000
    RETURNING next_part`, [user, project, path[0], part, content])
  requireThat(upload, 409)
  return [204] as const
}

export async function consumePageUpload(db: Database, project: number, user: number, uploadId: unknown, parts: unknown, size: unknown) {
  requireThat(typeof uploadId === 'string' && uploadIdPattern.test(uploadId) &&
    typeof parts === 'number' && Number.isSafeInteger(parts) && parts >= 1 && parts <= 24 &&
    typeof size === 'number' && Number.isSafeInteger(size) && size >= 1 && size <= 6_000_000, 400)
  const upload = await first(db, `DELETE FROM public.teamflow_page_uploads WHERE user_id = $1 AND project_id = $2
    AND upload_id = $3 AND next_part = $4 AND expires_at > clock_timestamp() RETURNING content`, [user, project, uploadId, parts])
  requireThat(upload?.content.length === size, 409)
  return upload.content as string
}

export async function pageContentSegment(db: Database, project: number, page: number, version: unknown, offset: unknown) {
  requireThat(isPageVersion(version) && typeof offset === 'string' && /^\d{1,7}$/u.test(offset) && Number(offset) <= 6_000_000, 400)
  const segment = await first(db, `SELECT updated_at = $3::timestamptz AS current,
    substring(content, $4::int + 1, $5) AS content, char_length(content) AS length
    FROM public.project_pages WHERE project_id = $1 AND id = $2`, [project, page, version, Number(offset), segmentSize])
  requireThat(segment, 404)
  requireThat(segment.current, 409)
  requireThat(Number(offset) < segment.length, 400)
  const following = Number(offset) + segmentSize
  return { content: segment.content, nextOffset: following < segment.length ? following : null }
}
