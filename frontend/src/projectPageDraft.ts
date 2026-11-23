import type { PageContentFormat } from './projectPageApi'

export type PageDraft = {
  content: string
  baseContent: string
  contentFormat?: PageContentFormat
  baseContentFormat?: PageContentFormat
}

const drafts = new Map<string, PageDraft>()
const memoryOnly = new Set<string>()
const pending = new Map<string, Promise<unknown>>()

export function pageDraftKey(userId: number, projectId: number, pageId: number) {
  return `teamflow:page-draft:${userId}:${projectId}:${pageId}`
}

export function isPageDraftPersisted(key: string) {
  return !memoryOnly.has(key)
}

export function readPageDraft(key: string): PageDraft | null {
  const draft = drafts.get(key)
  if (draft) return draft
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(key) ?? 'null')
    if (typeof stored?.content === 'string' && typeof stored?.baseContent === 'string') return stored
  } catch {
    return null
  }
  return null
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (memoryOnly.size === 0) return
  event.preventDefault()
  event.returnValue = true
}

export function writePageDraft(key: string, draft: PageDraft | null) {
  if (draft) drafts.set(key, draft)
  else drafts.delete(key)
  try {
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft))
    else window.sessionStorage.removeItem(key)
    memoryOnly.delete(key)
  } catch {
    if (draft) memoryOnly.add(key)
    else memoryOnly.delete(key)
  }
  if (memoryOnly.size > 0) window.addEventListener('beforeunload', warnBeforeUnload)
  else window.removeEventListener('beforeunload', warnBeforeUnload)
  return !memoryOnly.has(key)
}

export function acknowledgePageSave(key: string, savedContent: string, savedContentFormat?: PageContentFormat) {
  const current = readPageDraft(key)
  const unchanged = current?.content === savedContent
    && (current.contentFormat ?? 'plain') === (savedContentFormat ?? 'plain')
  const next = current && !unchanged ? { ...current, baseContent: savedContent, baseContentFormat: savedContentFormat } : null
  const persisted = writePageDraft(key, next)
  return { next, persisted }
}

export function trackPageSave<T>(key: string, operation: Promise<T>): Promise<T> {
  const tracked = operation.finally(() => {
    if (pending.get(key) === tracked) pending.delete(key)
  })
  pending.set(key, tracked)
  return tracked
}

export async function waitForPageSave(key: string) {
  await pending.get(key)?.catch(() => undefined)
}
