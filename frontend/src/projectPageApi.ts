import { apiFetch } from './apiFetch.ts'

export type PageSummary = {
  id: number
  parentPageId: number | null
  title: string
}

export type PageTreeEntry = PageSummary & { depth: number }
export type PageContentFormat = 'plain' | 'rich-v1'
export type ProjectPage = PageSummary & {
  projectId: number
  content: string
  contentFormat?: PageContentFormat
  createdAt: string
  updatedAt: string
}

type PageInput = Pick<ProjectPage, 'parentPageId' | 'title' | 'content' | 'contentFormat'> & { expectedUpdatedAt?: string }

export class PageRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Project pages request failed (${status})`)
    this.status = status
  }
}

const uploadSegmentLength = 400_000

export function projectPageApi(projectId: number, signal: AbortSignal,
  nodeTransport = import.meta.env?.VITE_TEAMFLOW_NODE_API === '1') {
  const base = `/api/projects/${projectId}/pages`

  async function request(path: string, method = 'GET', input?: object) {
    const response = await apiFetch(`${base}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      ...(input && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
    })
    if (!response.ok) throw new PageRequestError(response.status)
    return response
  }

  async function get(pageId: number): Promise<ProjectPage> {
    const result = await (await request(`/${pageId}${nodeTransport ? '?segmented=1' : ''}`)).json() as
      ProjectPage & { contentLength?: number }
    if (result.contentLength === undefined) return result
    const { contentLength, ...page } = result
    if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > 6_000_000) throw new PageRequestError(502)
    const segments: string[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const query = new URLSearchParams({ offset: String(offset), version: page.updatedAt })
      const segment = await (await request(`/${pageId}/content?${query}`)).json() as
        { content: string; nextOffset: number | null }
      if (typeof segment.content !== 'string' || !segment.content.length ||
          (segment.nextOffset !== null && (!Number.isSafeInteger(segment.nextOffset) ||
            segment.nextOffset <= offset || segment.nextOffset >= contentLength))) throw new PageRequestError(502)
      segments.push(segment.content)
      offset = segment.nextOffset
    }
    return { ...page, content: segments.join('') }
  }

  async function save(path: string, method: 'POST' | 'PUT', input: PageInput): Promise<ProjectPage> {
    if (!nodeTransport || input.contentFormat !== 'rich-v1' ||
        new TextEncoder().encode(JSON.stringify(input)).byteLength <= 3_500_000) {
      return (await request(path, method, input)).json()
    }

    const { uploadId } = await (await request('/uploads', 'POST')).json() as { uploadId: string }
    const { content, ...metadata } = input
    let part = 0
    for (let offset = 0; offset < content.length;) {
      let end = Math.min(content.length, offset + uploadSegmentLength)
      const trailing = content.charCodeAt(end - 1)
      if (end < content.length && trailing >= 0xd800 && trailing <= 0xdbff) end -= 1
      await request(`/uploads/${encodeURIComponent(uploadId)}/${part}`, 'PUT', { content: content.slice(offset, end) })
      offset = end
      part += 1
    }
    const saved = await (await request(path, method, {
      ...metadata, contentUploadId: uploadId, contentUploadParts: part, contentUploadSize: content.length,
    })).json() as Omit<ProjectPage, 'content'>
    return { ...saved, content }
  }

  return {
    tree: async (): Promise<PageTreeEntry[]> => (await request('/tree')).json(),
    get,
    create: (input: PageInput): Promise<ProjectPage> => save('', 'POST', input),
    rename: async (pageId: number, title: string): Promise<ProjectPage> => {
      const { parentPageId, content, contentFormat, updatedAt } = await get(pageId)
      return save(`/${pageId}`, 'PUT', { parentPageId, title, content, contentFormat, expectedUpdatedAt: updatedAt })
    },
    saveContent: async (pageId: number, content: string, baseContent: string,
      contentFormat?: PageContentFormat, baseContentFormat?: PageContentFormat): Promise<ProjectPage> => {
      const page = await get(pageId)
      const format = page.contentFormat ?? 'plain'
      if (page.content === content && format === (contentFormat ?? 'plain')) return page
      if (page.content !== baseContent || format !== (baseContentFormat ?? 'plain')) throw new PageRequestError(409)
      const { parentPageId, title, updatedAt } = page
      return save(`/${pageId}`, 'PUT', { parentPageId, title, content, contentFormat, expectedUpdatedAt: updatedAt })
    },
    remove: async (pageId: number) => { await request(`/${pageId}`, 'DELETE') },
  }
}

export function resolvePageSelection(entries: readonly PageTreeEntry[], preferredId: number | null) {
  return entries.find(({ id }) => id === preferredId)?.id ?? entries[0]?.id ?? null
}

export function expandPageAncestors(entries: readonly PageTreeEntry[], pageId: number | null,
  expanded: ReadonlySet<number>) {
  const parents = new Map(entries.map(({ id, parentPageId }) => [id, parentPageId]))
  const next = new Set([...expanded].filter((id) => parents.has(id)))
  for (let parent = pageId === null ? null : parents.get(pageId); parent != null; parent = parents.get(parent)) {
    next.add(parent)
  }
  return next
}

export function groupProjectPages(entries: readonly PageTreeEntry[]) {
  const groups = new Map<number | null, PageTreeEntry[]>()
  for (const page of entries) {
    const siblings = groups.get(page.parentPageId)
    if (siblings) siblings.push(page)
    else groups.set(page.parentPageId, [page])
  }
  return groups
}
