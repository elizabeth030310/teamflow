import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../../../', import.meta.url)
const backend = new URL('backend/src/main/java/com/teamflow/backend/', root)
const inventory = JSON.parse(readFileSync(new URL('../API-INVENTORY.json', import.meta.url), 'utf8'))

test('every Spring route is included in the Node API comparison', () => {
  const controllers = [backend, new URL('controller/', backend)].flatMap(folder => readdirSync(folder)
    .filter(file => file.endsWith('Controller.java')).map(file => ({ file, folder })))
  const actual = Object.fromEntries(controllers.map(({ file, folder }) => {
    const java = readFileSync(new URL(file, folder), 'utf8')
    const prefix = /@RequestMapping\("([^"]+)"\)/u.exec(java)?.[1] ?? ''
    const routes = [...java.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping(?:\(([^)]*)\))?/gu)]
      .map(([, method, annotation]) => method.toUpperCase() + ' ' + prefix + (/"([^"]+)"/u.exec(annotation ?? '')?.[1] ?? ''))
    return [file.replace('.java', ''), routes.sort()]
  }))
  assert.deepEqual(actual, inventory)
  assert.equal(Object.values(actual).flat().length, 55)
})
