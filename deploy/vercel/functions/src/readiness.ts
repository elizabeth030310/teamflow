export function readinessHandler(checkDatabase: () => Promise<void>) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'private, no-store' }

    if (request.method !== 'GET') {
      return Response.json({ status: 'method_not_allowed' }, {
        status: 405,
        headers: { ...headers, Allow: 'GET' },
      })
    }

    try {
      await checkDatabase()
      return Response.json({ status: 'ready' }, { headers })
    } catch {
      return Response.json({ status: 'unavailable' }, { status: 503, headers })
    }
  }
}
