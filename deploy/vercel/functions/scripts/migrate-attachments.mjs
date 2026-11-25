import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { get, put } from '@vercel/blob'
import { attachmentPath } from '../src/blob-storage.ts'

const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const hexHash = /^[0-9a-f]{64}$/u
const MAX_BYTES = 10 * 1024 * 1024
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function readLocal(root, entry) {
  const path = join(root, entry.storageKey)
  const stats = await lstat(path)
  if (!stats.isFile() || stats.size !== entry.sizeBytes) throw new Error('Missing file or size mismatch: ' + entry.storageKey)
  const data = await readFile(path)
  const sha256 = hash(data)
  if (data.length !== entry.sizeBytes || (entry.sha256 && entry.sha256 !== sha256)) {
    throw new Error('File checksum mismatch: ' + entry.storageKey)
  }
  return { data, sha256 }
}

export async function planMigration(root, manifest) {
  if (!isAbsolute(root) || !(await lstat(root)).isDirectory()) throw new Error('Use an absolute backup directory')
  if (!Array.isArray(manifest)) throw new Error('Manifest must be an array')
  const keys = new Set()
  const plan = []
  for (const entry of manifest) {
    if (!entry || !keyPattern.test(entry.storageKey) || keys.has(entry.storageKey) ||
        !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1 || entry.sizeBytes > MAX_BYTES ||
        (entry.sha256 != null && !hexHash.test(entry.sha256))) throw new Error('Invalid manifest entry')
    keys.add(entry.storageKey)
    const { sha256 } = await readLocal(root, entry)
    plan.push({ storageKey: entry.storageKey, sizeBytes: entry.sizeBytes, sha256 })
  }
  return plan
}

async function copyToPreview(root, entries, token, storeId) {
  if (!/^[a-z0-9]+$/i.test(storeId ?? '') || !token?.startsWith('vercel_blob_rw_' + storeId + '_')) {
    throw new Error('Token and explicitly named private Preview store must match')
  }
  for (const entry of entries) {
    const { data } = await readLocal(root, entry)
    const pathname = attachmentPath(entry.storageKey)
    let copied = await get(pathname, { access: 'private', token, useCache: false })
    if (!copied) {
      try {
        await put(pathname, data, {
          access: 'private', token, contentType: 'application/octet-stream', allowOverwrite: false, addRandomSuffix: false,
        })
      } catch {
        throw new Error('Preview write did not complete: ' + entry.storageKey)
      }
      copied = await get(pathname, { access: 'private', token, useCache: false })
    }
    if (copied?.statusCode !== 200 || copied.blob.size !== entry.sizeBytes) {
      await copied?.stream?.cancel()
      throw new Error('Preview copy missing or invalid size: ' + entry.storageKey)
    }
    const actual = createHash('sha256')
    for await (const buffer of copied.stream) actual.update(buffer)
    if (actual.digest('hex') !== entry.sha256) throw new Error('Preview copy checksum mismatch: ' + entry.storageKey)
  }
}

async function run(args) {
  const [root, manifestPath, option] = args
  if (!root || !manifestPath || args.length > 3 || (option && option !== '--copy-to-preview')) {
    throw new Error('Usage: node scripts/migrate-attachments.mjs BACKUP_DIRECTORY MANIFEST_JSON [--copy-to-preview]')
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (option && (!Array.isArray(manifest) || manifest.some(entry => !hexHash.test(entry?.sha256)))) {
    throw new Error('Copy requires the reviewed dry-run manifest including SHA-256')
  }
  const plan = await planMigration(root, manifest)
  if (option) {
    await copyToPreview(root, plan, process.env.TEAMFLOW_MIGRATION_PREVIEW_BLOB_TOKEN,
      process.env.TEAMFLOW_MIGRATION_PREVIEW_STORE_ID)
    console.error('Verified private Preview copies: ' + plan.length)
  }
  console.log(JSON.stringify(plan, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
