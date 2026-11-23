import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]

function runBootstrap(readTheme) {
  assert.ok(bootstrap)
  const dataset = {}
  runInNewContext(bootstrap, {
    document: { documentElement: { dataset } },
    localStorage: {
      getItem(key) {
        assert.equal(key, 'teamflow:theme')
        return readTheme()
      },
    },
  })
  return dataset.theme
}

test('the theme bootstrap runs before the app and restores an explicit preference', () => {
  assert.ok(html.indexOf('<script>') < html.indexOf('<body>'))
  for (const theme of ['light', 'dark']) {
    assert.equal(runBootstrap(() => theme), theme)
  }
})

test('the theme bootstrap leaves color scheme to the system without a usable preference', () => {
  for (const theme of [null, 'system', 'invalid']) {
    assert.equal(runBootstrap(() => theme), undefined)
  }
  assert.equal(runBootstrap(() => { throw new Error('Storage is blocked') }), undefined)
})
