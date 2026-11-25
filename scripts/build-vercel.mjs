import { spawnSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this script through npm run build:vercel')

const build = spawnSync(process.execPath, [npm, '--prefix', 'frontend', 'run', 'build'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, VITE_TEAMFLOW_NODE_API: '1' },
  stdio: 'inherit',
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

for (const [source, target] of [['index.html', 'auth-preview.html'], ['preview.js', 'preview.js']]) {
  copyFileSync(new URL('../deploy/vercel/functions/public/' + source, import.meta.url),
    new URL('../frontend/dist/' + target, import.meta.url))
}
