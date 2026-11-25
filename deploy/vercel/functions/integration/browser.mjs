import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

export async function browserSmoke(email, password, buildRoutes) {
  return withLocalBrowser(buildRoutes, async ({ origin, context, page }) => {
    const waitFor = value => page.getByText(value, { exact: true }).waitFor()
    await page.goto(origin)
    await waitFor('로그아웃 상태')
    await page.getByLabel('테스트 이메일').fill(email)
    await page.getByLabel('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await waitFor('로그인 상태 (USER)')
    const cookie = (await context.cookies(origin)).find(candidate => candidate.name === '__Host-teamflow-session')
    assert.ok(cookie)
    assert.deepEqual({ secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, domain: cookie.domain },
      { secure: true, httpOnly: true, sameSite: 'Lax', domain: 'localhost' })
    assert.equal(await page.evaluate(() => document.cookie.includes('__Host-teamflow-session')), false)
    await page.reload()
    await waitFor('로그인 상태 (USER)')
    await page.getByRole('button', { name: '로그아웃', exact: true }).click()
    await waitFor('로그아웃 상태')
    assert.equal((await context.cookies(origin)).some(candidate => candidate.name === cookie.name), false)
    await page.reload()
    await waitFor('로그아웃 상태')
  })
}

export async function withLocalBrowser(buildRoutes, inspect, spaRoot) {
  const scratch = mkdtempSync(join(tmpdir(), 'teamflow-browser-'))
  const certificate = join(scratch, 'cert.pem')
  const key = join(scratch, 'key.pem')
  const browserPath = process.env.TEAMFLOW_BROWSER_EXECUTABLE
    || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  const openssl = process.env.TEAMFLOW_OPENSSL || 'C:/Program Files/Git/usr/bin/openssl.exe'
  let browser
  let server
  try {
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', key, '-out', certificate],
    { stdio: 'ignore', windowsHide: true })
    let routes
    let origin
    server = createServer({ key: readFileSync(key), cert: readFileSync(certificate) }, async (incoming, outgoing) => {
      const pathname = new URL(incoming.url, origin).pathname
      if (spaRoot && (pathname === '/' || /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css)$/u.test(pathname))) {
        const file = pathname === '/' ? 'index.html' : pathname.slice(1)
        const type = pathname === '/' ? 'text/html' : pathname.endsWith('.css') ? 'text/css' : 'text/javascript'
        try {
          outgoing.setHeader('Content-Type', type + '; charset=utf-8')
          outgoing.end(readFileSync(new URL(file, spaRoot)))
        } catch {
          outgoing.writeHead(404).end()
        }
        return
      }
      if (pathname === '/' || pathname === '/preview.js') {
        const file = pathname === '/' ? 'index.html' : 'preview.js'
        outgoing.setHeader('Content-Type', pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8')
        outgoing.end(readFileSync(new URL('../public/' + file, import.meta.url)))
        return
      }
      const route = typeof routes === 'function' ? routes : routes[pathname]
      if (!route) {
        outgoing.writeHead(404).end()
        return
      }
      try {
        const chunks = []
        for await (const chunk of incoming) chunks.push(chunk)
        const response = await route(new Request(origin + incoming.url, {
          method: incoming.method, headers: incoming.headers,
          ...(chunks.length && { body: Buffer.concat(chunks) }),
        }))
        outgoing.writeHead(response.status, Object.fromEntries(response.headers))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
      } catch {
        outgoing.writeHead(500).end()
      }
    })
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
    origin = 'https://localhost:' + server.address().port
    routes = buildRoutes(origin)

    browser = await chromium.launch({ executablePath: browserPath, headless: true })
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    page.setDefaultTimeout(5_000)
    await inspect({ origin, context, page })
  } finally {
    await browser?.close()
    if (server?.listening) await new Promise(resolve => server.close(resolve))
    for (const path of [certificate, key]) {
      try { unlinkSync(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    rmdirSync(scratch)
  }
}
