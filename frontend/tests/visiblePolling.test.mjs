import assert from 'node:assert/strict'
import test from 'node:test'
import { startVisiblePolling } from '../src/visiblePolling.ts'

test('polling pauses in hidden and offline tabs and resumes without SSE', (context) => {
  const documentSurface = Object.assign(new EventTarget(), { hidden: true })
  const network = { onLine: true }
  let tick
  let stopped = false
  const windowSurface = Object.assign(new EventTarget(), {
    setInterval(callback) { tick = callback; return 27 },
    clearInterval(timer) { assert.equal(timer, 27); stopped = true },
  })
  for (const [key, value] of Object.entries({ window: windowSurface, document: documentSurface, navigator: network })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    context.after(() => {
      if (old) Object.defineProperty(globalThis, key, old)
      else delete globalThis[key]
    })
  }
  let refreshes = 0
  const stop = startVisiblePolling(() => { refreshes += 1 }, 12000)
  tick()
  assert.equal(refreshes, 0)
  documentSurface.hidden = false
  documentSurface.dispatchEvent(new Event('visibilitychange'))
  assert.equal(refreshes, 1)
  network.onLine = false
  tick()
  assert.equal(refreshes, 1)
  network.onLine = true
  windowSurface.dispatchEvent(new Event('online'))
  assert.equal(refreshes, 2)
  stop()
  windowSurface.dispatchEvent(new Event('online'))
  assert.equal(refreshes, 2)
  assert.equal(stopped, true)
})
