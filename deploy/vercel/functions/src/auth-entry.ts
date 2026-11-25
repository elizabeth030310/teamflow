import { authStore } from './auth-store.ts'
import { authHandler, authSettings } from './auth.ts'
import { databasePool } from './database.ts'

export function authEntry(route: Parameters<typeof authHandler>[0]) {
  return { fetch: authHandler(route, () => authStore(databasePool()), () => authSettings(process.env)) }
}
