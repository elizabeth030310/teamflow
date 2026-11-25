import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPayloadFromClientToken } from '@vercel/blob/client'
import { attachmentMetadata } from '../src/attachments.ts'
import { privateBlob } from '../src/blob-storage.ts'
import { maintenanceHandler } from '../src/maintenance.ts'
import { planMigration } from '../scripts/migrate-attachments.mjs'

test('attachment metadata validates size, strips path, and normalizes the display filename', () => {
  assert.deepEqual(attachmentMetadata('..\\bad/wide\u202e name.PnG', 20), {
    displayName: 'wide name.png', contentType: 'image/png', size: 20,
  })
  assert.throws(() => attachmentMetadata('a.png', 10 * 1024 * 1024 + 1), { status: 413 })
  assert.throws(() => attachmentMetadata('a.svg', 5), { status: 415 })
  assert.throws(() => attachmentMetadata('a.png', 0), { status: 400 })
})

test('maintenance never opens a pool without the configured bearer secret', async () => {
  const secret = 'test-secret-length-is-at-least-thirty-two'
  const fetch = maintenanceHandler(() => assert.fail('no database access'), () => null, () => secret)
  const endpoint = 'https://example.test/api/maintenance'
  assert.equal((await fetch(new Request(endpoint))).status, 401)
  assert.equal((await fetch(new Request(endpoint, { headers: { Authorization: 'Bearer wrong' } }))).status, 401)
  assert.equal((await fetch(new Request(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + secret } }))).status, 405)
})

test('Blob client token is scoped to one immutable path, MIME type, size and brief lifetime', async () => {
  const storage = privateBlob({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_TESTID_syntheticSigningSecret' })
  const before = Date.now()
  const key = randomUUID()
  const token = await storage.token(key, 512, 'image/png')
  const payload = getPayloadFromClientToken(token)
  assert.equal(payload.pathname, 'teamflow/attachments/' + key)
  assert.equal(payload.maximumSizeInBytes, 512)
  assert.deepEqual(payload.allowedContentTypes, ['image/png'])
  assert.equal(payload.allowOverwrite, false)
  assert.equal(payload.addRandomSuffix, false)
  assert.ok(payload.validUntil >= before + 179_000 && payload.validUntil <= Date.now() + 180_000)
})

test('migration dry-run checks UUID, file size and checksum without an object store', async (context) => {
  const backup = await mkdtemp(join(tmpdir(), 'teamflow-file-test-'))
  const storageKey = randomUUID()
  context.after(async () => {
    await unlink(join(backup, storageKey))
    await rmdir(backup)
  })
  await writeFile(join(backup, storageKey), 'fixture')
  const [entry] = await planMigration(backup, [{ storageKey, sizeBytes: 7 }])
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u)
  await assert.rejects(planMigration(backup, [{ ...entry, sha256: 'a'.repeat(64) }]), /checksum/)
  await assert.rejects(planMigration(backup, [{ ...entry, sizeBytes: 8 }]), /size mismatch/)
  await assert.rejects(planMigration(backup, [{ storageKey: '../outside', sizeBytes: 7 }]), /Invalid manifest/)
})
