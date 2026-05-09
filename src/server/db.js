import pg from 'pg'

const connectionString = process.env.NEON_POSTGRES_CONNECTION_STRING
if (!connectionString) {
  console.warn('Warning: NEON_POSTGRES_CONNECTION_STRING is not set')
}

export const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
})
