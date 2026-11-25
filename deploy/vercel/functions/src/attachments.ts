import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { transaction } from './auth-store.ts'
import { json } from './auth.ts'
import { attachmentPath } from './blob-storage.ts'
import type { AttachmentStorage } from './blob-storage.ts'
import { first, id, requireProject, requireThat, rows, shape } from './collaboration-data.ts'
import type { Database, Row } from './collaboration-data.ts'

const maxFileSize = 10 * 1024 * 1024
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const columns = 'id, uploader_id, display_name, content_type, size_bytes, created_at'
const formats = [
  { extensions: ['.pdf'], type: 'application/pdf', prefix: [37, 80, 68, 70, 45] },
  { extensions: ['.png'], type: 'image/png', prefix: [137, 80, 78, 71, 13, 10, 26, 10] },
  { extensions: ['.jpg', '.jpeg'], type: 'image/jpeg', prefix: [255, 216, 255] },
]

export function attachmentMetadata(name: unknown, size: unknown) {
  requireThat(typeof size === 'number' && Number.isSafeInteger(size) && size > 0, 400)
  requireThat(size <= maxFileSize, 413)
  requireThat(typeof name === 'string' && name.length <= 8192, 400)
  const filename = (name.replaceAll('\\', '/').split('/').at(-1) ?? '').normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/[<>:"|?*]/gu, '_').trim()
  const dot = filename.lastIndexOf('.')
  const extension = filename.slice(dot).toLowerCase()
  const format = formats.find(item => item.extensions.includes(extension))
  requireThat(dot > 0 && format, 415)
  const base = filename.slice(0, dot).replace(/^[.\s]+|[.\s]+$/gu, '') || 'attachment'
  const displayName = [...base].slice(0, 255 - extension.length).join('') + extension
  return { displayName, contentType: format.type, size }
}

async function readPrefix(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const bytes: number[] = []
  try {
    while (bytes.length < 8) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes.push(...chunk.value.subarray(0, 8 - bytes.length))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return bytes
}

async function taskAccess(db: Database, task: number, user: number, lock = false) {
  const target = await first(db, 'SELECT project_id FROM public.tasks WHERE id = $1', [task])
  requireThat(target?.project_id != null, 404)
  await requireProject(db, Number(target.project_id), user, lock)
  if (lock) requireThat(await first(db, 'SELECT id FROM public.tasks WHERE id = $1 FOR UPDATE', [task]), 404)
}

async function activeSession(db: Database, tokenHash: Buffer, user: number) {
  requireThat(await first(db, `SELECT 1 FROM public.users account JOIN public.teamflow_sessions session ON session.user_id = account.id
    WHERE session.token_hash = $1 AND account.id = $2 AND account.account_status = 'ACTIVE'
      AND account.access_revision = session.access_revision AND expires_at > clock_timestamp() FOR SHARE OF account`, [tokenHash, user]), 401)
}

function attachment(row: Row) {
  return shape(row, 'id', 'uploader_id', 'size_bytes')
}

function noContent() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } })
}

async function reserve(pool: Pool, task: number, user: number, tokenHash: Buffer, metadata: ReturnType<typeof attachmentMetadata>) {
  const key = randomUUID()
  await transaction(pool, async client => {
    await activeSession(client, tokenHash, user)
    await taskAccess(client, task, user, true)
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['attachment-user:' + user])
    const count = await first(client, `SELECT count(*)::int AS count FROM public.teamflow_attachment_uploads
      WHERE uploader_id = $1 AND expires_at > clock_timestamp()`, [user])
    requireThat(count && count.count < 4, 429)
    await client.query(`INSERT INTO public.teamflow_attachment_uploads
      VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp() + interval '15 minutes')`,
    [key, task, user, metadata.displayName, metadata.contentType, metadata.size])
  })
  return key
}

async function finish(pool: Pool, storage: AttachmentStorage, task: number, user: number, tokenHash: Buffer, key: string, signal?: AbortSignal) {
  requireThat(uuid.test(key), 400)
  const existing = () => first(pool, `SELECT ${columns} FROM public.task_attachments
    WHERE storage_key = $1 AND task_id = $2 AND uploader_id = $3`, [key, task, user])
  const saved = await existing()
  if (saved) return attachment(saved)
  const pending = await first(pool, `SELECT display_name, content_type, size_bytes FROM public.teamflow_attachment_uploads
    WHERE storage_key = $1 AND task_id = $2 AND uploader_id = $3 AND expires_at > clock_timestamp()`, [key, task, user])
  if (!pending) {
    const committed = await existing()
    requireThat(committed, 404)
    return attachment(committed)
  }
  const blob = await storage.open(key, signal)
  requireThat(blob, 404)
  const prefix = await readPrefix(blob.stream)
  requireThat(blob.size === Number(pending.size_bytes), 400)
  const format = formats.find(item => item.type === pending.content_type)
  requireThat(format?.prefix.every((byte, index) => byte === prefix[index]), 415)

  return transaction(pool, async client => {
    await activeSession(client, tokenHash, user)
    await taskAccess(client, task, user, true)
    const committed = await first(client, `SELECT ${columns} FROM public.task_attachments
      WHERE storage_key = $1 AND task_id = $2 AND uploader_id = $3`, [key, task, user])
    if (committed) return attachment(committed)
    const reservation = await first(client, `DELETE FROM public.teamflow_attachment_uploads
      WHERE storage_key = $1 AND task_id = $2 AND uploader_id = $3 AND expires_at > clock_timestamp()
      RETURNING display_name, content_type, size_bytes`, [key, task, user])
    requireThat(reservation, 404)
    const row = await first(client, `INSERT INTO public.task_attachments
      (task_id, uploader_id, display_name, storage_key, content_type, size_bytes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp()) RETURNING ${columns}`,
    [task, user, reservation.display_name, key, reservation.content_type, reservation.size_bytes])
    return attachment(row!)
  })
}

function disposition(value: string) {
  const filename = value.replace(/[\p{Cc}\p{Cf}]/gu, '').toWellFormed()
  return "attachment; filename=\"attachment\"; filename*=UTF-8''" +
    encodeURIComponent(filename).replace(/['()*]/g, symbol => '%' + symbol.charCodeAt(0).toString(16).toUpperCase())
}

export async function attachmentRoutes(pool: Pool, storage: AttachmentStorage | null, request: Request,
  task: number, path: string[], user: number, tokenHash: Buffer) {
  const method = request.method
  await taskAccess(pool, task, user)
  if (method === 'GET' && !path.length) {
    const found = await rows(pool, `SELECT ${columns} FROM public.task_attachments WHERE task_id = $1 ORDER BY created_at DESC, id DESC`, [task])
    return json(200, found.map(attachment))
  }
  if (method === 'DELETE' && path.length === 1) {
    const identifier = id(path[0])
    await transaction(pool, async client => {
      await activeSession(client, tokenHash, user)
      await taskAccess(client, task, user, true)
      const row = await first(client, 'SELECT storage_key, uploader_id FROM public.task_attachments WHERE task_id = $1 AND id = $2',
        [task, identifier])
      requireThat(row, 404)
      requireThat(Number(row.uploader_id) === user, 403)
      await client.query(`INSERT INTO public.attachment_file_deletions VALUES ($1, clock_timestamp()) ON CONFLICT DO NOTHING`, [row.storage_key])
      await client.query('DELETE FROM public.task_attachments WHERE task_id = $1 AND id = $2', [task, identifier])
    })
    return noContent()
  }
  if (method === 'GET' && path.length === 2 && path[1] === 'download') {
    const row = await first(pool, 'SELECT storage_key, display_name, size_bytes FROM public.task_attachments WHERE task_id = $1 AND id = $2',
      [task, id(path[0])])
    requireThat(row, 404)
    requireThat(storage, 503)
    const blob = await storage.open(row.storage_key, request.signal)
    requireThat(blob, 404)
    if (blob.size !== Number(row.size_bytes)) {
      await blob.stream.cancel().catch(() => {})
      requireThat(false, 503)
    }
    return new Response(blob.stream, { headers: {
      'Cache-Control': 'private, no-store', 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': disposition(row.display_name), 'Content-Length': String(blob.size),
    } })
  }

  requireThat(method === 'POST' && (path.length === 0 || (path.length === 1 && ['upload-token', 'complete'].includes(path[0]))), 404)
  requireThat(storage, 503)
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!path.length) {
    requireThat(/^multipart\/form-data\s*;/i.test(contentType), 415)
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    requireThat(form && [...form.keys()].length === 1 && file instanceof File, 400)
    const metadata = attachmentMetadata(file.name, file.size)
    const prefix = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    requireThat(formats.find(format => format.type === metadata.contentType)?.prefix.every((byte, index) => prefix[index] === byte), 415)
    const key = await reserve(pool, task, user, tokenHash, metadata)
    await storage.write(key, file, metadata.contentType, request.signal)
    return json(201, await finish(pool, storage, task, user, tokenHash, key, request.signal))
  }

  requireThat(/^application\/json(?:\s*;|$)/i.test(contentType), 415)
  const input = await request.json().catch(() => null)
  requireThat(input && typeof input === 'object', 400)
  if (path[0] === 'complete') {
    requireThat(typeof input.storageKey === 'string', 400)
    return json(201, await finish(pool, storage, task, user, tokenHash, input.storageKey, request.signal))
  }
  const metadata = attachmentMetadata(input.name, input.size)
  const key = await reserve(pool, task, user, tokenHash, metadata)
  const clientToken = await storage.token(key, metadata.size, metadata.contentType)
  return json(201, { storageKey: key, pathname: attachmentPath(key), clientToken, contentType: metadata.contentType })
}
