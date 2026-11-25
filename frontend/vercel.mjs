const backendUrl = process.env.TEAMFLOW_BACKEND_ORIGIN
const backend = backendUrl ? new URL(backendUrl) : null

if (!backend || backend.protocol !== 'https:' ||
    (backendUrl !== backend.origin && backendUrl !== `${backend.origin}/`)) {
  throw new Error('Set TEAMFLOW_BACKEND_ORIGIN to the public HTTPS origin of the existing backend')
}

export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/api/:path*', destination: `${backend.origin}/api/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
  headers: [
    {
      source: '/api/:path*',
      headers: [
        { key: 'x-vercel-enable-rewrite-caching', value: '0' },
        { key: 'Cache-Control', value: 'private, no-store' },
      ],
    },
  ],
}
