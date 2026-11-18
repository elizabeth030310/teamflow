import assert from 'node:assert/strict'
import test from 'node:test'
import { startNotificationSync } from '../src/notificationSync.ts'

test('loads initially, refreshes on reconnect and changes, and drops stale responses', async (context) => {
  let source
  class TestEventSource extends EventTarget {
    constructor(url) {
      super()
      assert.equal(url, '/api/notifications/events')
      source = this
    }

    close() {
      this.closed = true
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: TestEventSource })
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'EventSource', original)
    else delete globalThis.EventSource
  })

  const requests = []
  const snapshots = []
  const sync = startNotificationSync(
    (signal) => new Promise((resolve) => requests.push({ resolve, signal })),
    (inbox) => snapshots.push(inbox.unreadCount),
    assert.fail,
  )
  context.after(() => sync.close())
  const complete = async (index, unreadCount) => {
    requests[index].resolve({ items: [], unreadCount, hasMore: false })
    await Promise.resolve()
  }

  assert.equal(requests.length, 1)
  source.dispatchEvent(new Event('open'))
  await complete(0, 1)
  assert.deepEqual(snapshots, [])
  await complete(1, 2)
  assert.deepEqual(snapshots, [2])

  source.dispatchEvent(new Event('notifications-changed'))
  await complete(2, 3)
  source.dispatchEvent(new Event('open'))
  await complete(3, 4)
  assert.deepEqual(snapshots, [2, 3, 4])

  source.dispatchEvent(new Event('notifications-changed'))
  sync.close()
  assert.equal(source.closed, true)
  assert.equal(requests[4].signal.aborted, true)
  await complete(4, 5)
  assert.deepEqual(snapshots, [2, 3, 4])
})
