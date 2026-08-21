import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const { Client } = pg
const migrationsDirectory = resolve(import.meta.dirname, '../src/database/migrations')
const databaseConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? 'jlgmapapp',
  user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'jlgmapapp',
  password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'jlgmapapp_dev',
}
const migrations = (await readdir(migrationsDirectory))
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort()

const client = new Client(databaseConfig)
await client.connect()
try {
  for (const fileName of migrations) {
    const sql = await readFile(resolve(migrationsDirectory, fileName), 'utf8')
    const upStart = sql.indexOf('-- migrate:up')
    const downStart = sql.indexOf('-- migrate:down')
    if (upStart < 0 || downStart <= upStart) {
      throw new Error(`${fileName} must contain migrate:up before migrate:down`)
    }
    await client.query(sql.slice(upStart + '-- migrate:up'.length, downStart))
  }
} finally {
  await client.end()
}

console.log(`Applied ${migrations.length} migrations.`)