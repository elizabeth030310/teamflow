import { checkDatabase } from '../src/database.ts'
import { readinessHandler } from '../src/readiness.ts'

export default { fetch: readinessHandler(checkDatabase) }
