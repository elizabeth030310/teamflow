import { attachDatabasePool } from '@vercel/functions'
import { Pool } from 'pg'

let pool: Pool | undefined

export function databaseUrl(environment: NodeJS.ProcessEnv): string {
  const production = environment.VERCEL_ENV === 'production'
  const connectionString = production ? environment.TEAMFLOW_PRODUCTION_DATABASE_URL : environment.TEAMFLOW_PREVIEW_DATABASE_URL
  if (!connectionString || (production && environment.TEAMFLOW_ENABLE_PRODUCTION !== '1')) {
    throw new Error('Database is unavailable')
  }

  const url = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      !url.username || !url.password || url.pathname.length <= 1 || url.search || url.hash) {
    throw new Error('Invalid database configuration')
  }

  return connectionString
}

export function databasePool(): Pool {
  if (!pool) {
    const connectionString = databaseUrl(process.env)
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: true },
      enableChannelBinding: true,
      max: 4,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 3_000,
    })
    pool.on('error', () => console.error('TeamFlow: idle database connection failed'))
    attachDatabasePool(pool)
  }
  return pool
}

export async function checkDatabase(): Promise<void> {
  await databasePool().query('SELECT 1')
}
