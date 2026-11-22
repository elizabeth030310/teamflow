export type PageSummary = {
  id: number
  parentPageId: number | null
  title: string
}

export type PageTreeEntry = PageSummary & { depth: number }
export type ProjectPage = PageSummary & {
  projectId: number
  content: string
  createdAt: string
  updatedAt: string
}

type PageInput = Pick<ProjectPage, 'parentPageId' | 'title' | 'content'>

export class PageRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Project pages request failed (${status})`)
    this.status = status
  }
}

export function projectPageApi(projectId: number, signal: AbortSignal) {
  const base = `/api/projects/${projectId}/pages`

  async function request(path: string, method = 'GET', input?: PageInput) {
    const response = await fetch(`${base}${path}`, {
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
    return (await request(`/${pageId}`)).json()
  }

  return {
    tree: async (): Promise<PageTreeEntry[]> => (await request('/tree')).json(),
    get,
    create: async (input: PageInput): Promise<ProjectPage> => (await request('', 'POST', input)).json(),
    rename: async (pageId: number, title: string): Promise<ProjectPage> => {
      const { parentPageId, content } = await get(pageId)
      return (await request(`/${pageId}`, 'PUT', { parentPageId, title, content })).json()
    },
    saveContent: async (pageId: number, content: string, baseContent: string): Promise<ProjectPage> => {
      const page = await get(pageId)
      if (page.content === content) return page
      if (page.content !== baseContent) throw new PageRequestError(409)
      const { parentPageId, title } = page
      return (await request(`/${pageId}`, 'PUT', { parentPageId, title, content })).json()
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
