export function apiFetch(path: string, options: RequestInit = {}) {
  const method = options.method?.toUpperCase() ?? 'GET'
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return fetch(path, options)
  }
  const headers = new Headers(options.headers)
  headers.set('X-TeamFlow-Request', '1')
  return fetch(path, { ...options, headers, mode: 'same-origin' })
}
