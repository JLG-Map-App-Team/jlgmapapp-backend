import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repositoryRoot = resolve(import.meta.dirname, '..')
const migrationsDirectory = resolve(repositoryRoot, 'src/database/migrations')
const composeProject = process.env.COMPOSE_PROJECT_NAME ?? 'jlgmapapp-c2'
const databaseName = process.env.POSTGRES_DB ?? 'jlgmapapp'
const databaseUser = process.env.POSTGRES_USER ?? 'jlgmapapp'

const migrations = readdirSync(migrationsDirectory)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort()
  .map((fileName) => {
    const sql = readFileSync(resolve(migrationsDirectory, fileName), 'utf8')
    const upMarker = /^-- migrate:up\s*$/m
    const downMarker = /^-- migrate:down\s*$/m
    const upStart = sql.search(upMarker)
    const downStart = sql.search(downMarker)

    if (upStart < 0 || downStart < 0 || downStart <= upStart) {
      throw new Error(`${fileName} must contain migrate:up before migrate:down`)
    }

    return {
      fileName,
      up: sql.slice(upStart).replace(upMarker, '').slice(0, downStart - upStart).trim(),
      down: sql.slice(downStart).replace(downMarker, '').trim(),
    }
  })

function compose(...args) {
  return execFileSync('docker', ['compose', '-p', composeProject, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PORT: process.env.POSTGRES_PORT ?? '55432' },
    stdio: ['pipe', 'inherit', 'inherit'],
  })
}

function runSql(sql) {
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      composeProject,
      'exec',
      '-T',
      'database',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      databaseUser,
      '-d',
      databaseName,
    ],
    { cwd: repositoryRoot, input: `${sql}\n`, stdio: ['pipe', 'inherit', 'inherit'] },
  )
}

console.log(`Resetting Compose project ${composeProject}...`)
compose('down', '-v')
compose('up', '-d', '--wait')

console.log(`Applying ${migrations.length} migrations...`)
for (const migration of migrations) {
  console.log(`  up ${migration.fileName}`)
  runSql(migration.up)
}

console.log('Rolling back migrations...')
for (const migration of [...migrations].reverse()) {
  console.log(`  down ${migration.fileName}`)
  runSql(migration.down)
}

console.log('Migration up/down verification passed.')
compose('down', '-v')
